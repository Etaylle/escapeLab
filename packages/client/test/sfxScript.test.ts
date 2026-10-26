import { describe, expect, it, vi } from 'vitest';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import type { SoundClient } from '../scripts/elevenlabs.js';
import {
  CAPS,
  checkCatalog,
  costOf,
  creditsLeft,
  effectRequest,
  flawsOf,
  gainOf,
  groupOf,
  hashOf,
  LEAD_MS,
  loudnessOf,
  make,
  MAX_GAIN,
  MIN_CREDITS,
  musicRequest,
  optionsOf,
  parseWav,
  planOf,
  priced,
  readCatalog,
  refuseBelow,
  startMsOf,
  TARGETS,
  tooQuiet,
  type CatalogEntry,
  type Manifest,
  type ManifestEntry,
  type Pcm,
} from '../scripts/sfx.js';

/**
 * The sound script against a client of the tests' own — no request ever leaves — and PCM
 * made here, whose loudness is known.
 */

const catalog = readCatalog();

const CLACK: CatalogEntry = {
  id: 'test-clack',
  kind: 'oneshot',
  prompt: 'A steel latch snapping shut on a cabinet door, close-up and dry.',
  durationSeconds: 0.6,
  loop: false,
  target: { measure: 'peak', dbfs: -3 },
  usedBy: ['src/world/audio.ts#leverChunk'],
};

const CALM: CatalogEntry = {
  id: 'test-calm',
  kind: 'stem',
  prompt: 'Instrumental underscore for a dark lab at night, A minor, 90 BPM, steady, made to loop.',
  durationSeconds: 72,
  loop: true,
  target: { measure: 'rms', dbfs: -20 },
  usedBy: ['src/world/music.ts#STEMS'],
};

describe('the catalog', () => {
  it('names every sound once, each keeping every rule', () => {
    expect(() => checkCatalog(catalog)).not.toThrow();
    expect(catalog.length).toBeGreaterThan(60);
    expect(new Set(catalog.map((entry) => entry.id)).size).toBe(catalog.length);
  });

  it('brings one-shots to a −3 dBFS peak, beds and stems to −20 dBFS RMS, stings to −14', () => {
    expect(TARGETS).toEqual({
      oneshot: { measure: 'peak', dbfs: -3 },
      bed: { measure: 'rms', dbfs: -20 },
      stem: { measure: 'rms', dbfs: -20 },
      sting: { measure: 'rms', dbfs: -14 },
    });
    for (const entry of catalog) expect(entry.target, entry.id).toEqual(TARGETS[entry.kind]);
  });

  it('has the three stems in one key and tempo, 60 to 90 s, and the stings 8 to 12 s', () => {
    const stems = catalog.filter((entry) => entry.kind === 'stem');
    expect(stems.map((entry) => entry.id)).toEqual(['calm', 'tense', 'critical']);
    for (const stem of stems) {
      expect(stem.prompt, stem.id).toMatch(/A minor, 90 BPM/);
      expect(stem.durationSeconds).toBeGreaterThanOrEqual(60);
      expect(stem.durationSeconds).toBeLessThanOrEqual(90);
    }
    const stings = catalog.filter((entry) => entry.kind === 'sting').map((entry) => entry.id);
    expect(stings).toEqual(['won', 'lost']);
  });

  it('finds every flaw of an entry, and a twice-named id', () => {
    expect(flawsOf(CLACK)).toEqual([]);
    const broken = {
      ...CLACK,
      id: 'Bad Id',
      prompt: 'Ein Klick.',
      durationSeconds: 40,
      loop: true,
      target: { measure: 'rms', dbfs: -20 },
      usedBy: ['audio.ts'],
    } as const;
    expect(flawsOf(broken)).toHaveLength(6);
    expect(flawsOf({ ...CLACK, kind: 'jingle' as never })).toContainEqual(
      expect.stringMatching(/kind "jingle"/),
    );
    expect(flawsOf({ ...CALM, durationSeconds: 30 })).toEqual([
      expect.stringMatching(/30 s, outside 60–90 s/),
    ]);
    expect(() => checkCatalog([CLACK, CLACK])).toThrow(/test-clack: its id comes twice/);
  });
});

describe('a request', () => {
  it('asks text-to-sound-effects v2 for MP3 at 128 kbit/s, a bed as a seamless loop', () => {
    expect(effectRequest(CLACK)).toEqual({
      text: CLACK.prompt,
      durationSeconds: 0.6,
      loop: false,
      promptInfluence: 0.5,
      modelId: 'eleven_text_to_sound_v2',
      outputFormat: 'mp3_44100_128',
    });
    const bed = catalog.find((entry) => entry.id === 'bed-server') as CatalogEntry;
    expect(effectRequest(bed).loop).toBe(true);
  });

  it('asks Eleven Music for an instrumental piece as long as the catalog says', () => {
    expect(musicRequest(CALM)).toEqual({
      prompt: CALM.prompt,
      musicLengthMs: 72_000,
      forceInstrumental: true,
      modelId: 'music_v2_5',
      outputFormat: 'mp3_44100_128',
    });
    expect(groupOf(CALM)).toBe('music');
    expect(groupOf({ kind: 'sting' })).toBe('music');
    expect(groupOf(CLACK)).toBe('sfx');
    expect(groupOf({ kind: 'bed' })).toBe('sfx');
  });

  it('is hashed by all that makes it, and nothing else', () => {
    const hash = hashOf(CLACK);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(hashOf({ ...CLACK, usedBy: ['src/world/audio.ts#doorSlide'] })).toBe(hash);
    expect(hashOf({ ...CLACK, id: 'other' })).toBe(hash);
    const changed = [
      hashOf({ ...CLACK, prompt: `${CLACK.prompt} Louder.` }),
      hashOf({ ...CLACK, durationSeconds: 0.7 }),
      hashOf({ ...CLACK, kind: 'bed', loop: true }),
    ];
    expect(new Set([hash, ...changed]).size).toBe(4);
  });

  it('costs about 4 credits a second of an effect, 18 of music, and keeps within the caps', () => {
    expect(costOf(CLACK)).toBe(3);
    expect(costOf(CALM)).toBe(1296);
    expect(CAPS).toEqual({ sfx: 12_000, music: 18_000 });
    for (const group of ['sfx', 'music'] as const) {
      const all = catalog.filter((entry) => groupOf(entry) === group);
      expect(all.reduce((sum, entry) => sum + costOf(entry), 0)).toBeLessThan(CAPS[group] / 1.5);
    }
  });
});

/** A client that answers with `audio` for effects and music, and `left` credits. */
function clientOf(audio: Uint8Array<ArrayBuffer> | Error, left = 50_000) {
  const effects: ElevenLabs.CreateSoundEffectRequest[] = [];
  const pieces: ElevenLabs.BodyComposeMusicV1MusicPost[] = [];
  const answer = (): Promise<ReadableStream<Uint8Array>> =>
    audio instanceof Error ? Promise.reject(audio) : Promise.resolve(new Blob([audio]).stream());
  const client: SoundClient = {
    user: {
      subscription: {
        get: () => Promise.resolve({ characterCount: 131_000 - left, characterLimit: 131_000 }),
      },
    },
    textToSoundEffects: { convert: (request) => (effects.push(request), answer()) },
    music: { compose: (request) => (pieces.push(request), answer()) },
  };
  return { client, effects, pieces };
}

describe('making a recording', () => {
  const MP3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x44, 7]);

  it('asks for an effect or a piece of music by the entry’s group', async () => {
    const { client, effects, pieces } = clientOf(MP3);
    expect([...(await make(client, CLACK))]).toEqual([...MP3]);
    expect(effects).toEqual([effectRequest(CLACK)]);
    await make(client, CALM);
    expect(pieces).toEqual([musicRequest(CALM)]);
  });

  it('names the entry ElevenLabs refuses, and waits out a 429 as the voice does', async () => {
    const refused = Object.assign(new Error('Status code: 422'), {
      statusCode: 422,
      body: { detail: 'bad prompt' },
    });
    await expect(make(clientOf(refused).client, CLACK)).rejects.toThrow(
      /^sfx: ElevenLabs did not make test-clack \(422\): .*bad prompt/,
    );
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const busy = Object.assign(new Error('Status code: 429'), {
      statusCode: 429,
      rawResponse: { headers: new Headers({ 'retry-after': '2' }) },
    });
    const waits: number[] = [];
    const wait = (ms: number): Promise<void> => (waits.push(ms), Promise.resolve());
    await expect(make(clientOf(busy).client, CLACK, wait)).rejects.toThrow(/\(429\)/);
    expect(waits).toEqual([2000, 2000, 2000, 2000, 2000]);
    expect(said).toHaveBeenCalledWith(expect.stringMatching(/^sfx: ElevenLabs asks for a pause/));
    said.mockRestore();
  });

  it('reads the credits left, and refuses to ask with fewer than 40 000', async () => {
    expect(await creditsLeft(clientOf(MP3, 129_249).client)).toBe(129_249);
    expect(MIN_CREDITS).toBe(40_000);
    expect(() => refuseBelow(40_000)).not.toThrow();
    expect(() => refuseBelow(39_999)).toThrow(/39999 credits left.*nothing asked/);
  });

  it('prices a group at what its first request cost, and stops it over its cap', () => {
    const rest = [CLACK, { ...CLACK, durationSeconds: 1.2 }];
    expect(priced(24, CLACK, rest)).toEqual({ perSecond: 40, total: 96, over: false });
    expect(priced(600, CLACK, Array.from({ length: 30 }, () => CLACK)).over).toBe(true);
    expect(priced(0, CLACK, rest).total).toBe(0); // the account not caught up yet: no stop
  });
});

describe('a run', () => {
  const manifestEntry = (entry: CatalogEntry): ManifestEntry => ({
    file: `${entry.id}.mp3`,
    ms: 600,
    gain: 1,
    startMs: 0,
    loop: entry.loop,
    hash: hashOf(entry),
    source: 'elevenlabs',
  });
  const sfx: Manifest = { [CLACK.id]: manifestEntry(CLACK) };
  const manifests = { sfx, music: {} };
  const everything = optionsOf([]);

  it('makes what is new, changed or gone, and keeps what is there unchanged', () => {
    const always = (): boolean => true;
    const kept = planOf([CLACK, CALM], manifests, always, everything);
    expect(kept.map((job) => [job.entry.id, job.group, job.make])).toEqual([
      ['test-clack', 'sfx', false],
      ['test-calm', 'music', true],
    ]);
    const louder = { ...CLACK, prompt: `${CLACK.prompt} Louder.` };
    expect(planOf([louder], manifests, always, everything)[0]?.make).toBe(true);
    const gone = planOf([CLACK], manifests, () => false, everything);
    expect(gone[0]?.make).toBe(true);
  });

  it('takes the groups asked for, or the one entry --only names, made anew', () => {
    const always = (): boolean => true;
    const music = planOf([CLACK, CALM], manifests, always, optionsOf(['music']));
    expect(music.map((job) => job.entry.id)).toEqual(['test-calm']);
    const only = planOf([CLACK, CALM], manifests, always, optionsOf(['--only', 'test-clack']));
    expect(only.map((job) => [job.entry.id, job.make])).toEqual([['test-clack', true]]);
    expect(() => planOf([CLACK], manifests, always, optionsOf(['--only', 'nope']))).toThrow(
      /--only nope.*no such entry/,
    );
  });

  it('names every take too quiet for its kind, its gain and the most it may take', () => {
    expect(MAX_GAIN).toEqual({ oneshot: 6, bed: 4, stem: 4, sting: 4 });
    const BED = { ...CALM, id: 'test-bed', kind: 'bed', durationSeconds: 10 } as const;
    const STING = { ...CALM, id: 'test-sting', kind: 'sting', loop: false } as const;
    const at = (gain: number, entry: CatalogEntry): ManifestEntry => ({
      ...manifestEntry(entry),
      gain,
    });
    const loud = { sfx: { [CLACK.id]: at(6, CLACK), [BED.id]: at(4, BED) }, music: {} };
    expect(tooQuiet([CLACK, BED, CALM], loud)).toEqual([]);
    const quiet = {
      sfx: { [CLACK.id]: at(6.01, CLACK), [BED.id]: at(4.5, BED) },
      music: { [CALM.id]: at(0.7, CALM), [STING.id]: at(11, STING) },
    };
    expect(tooQuiet([CLACK, BED, CALM, STING], quiet)).toEqual([
      { id: 'test-clack', gain: 6.01, max: 6 },
      { id: 'test-bed', gain: 4.5, max: 4 },
      { id: 'test-sting', gain: 11, max: 4 },
    ]);
  });

  it('reads the command line, pnpm’s -- and all, and refuses anything else', () => {
    expect(optionsOf([])).toEqual({ groups: ['sfx', 'music'], dryRun: false, only: null });
    expect(optionsOf(['--', '--dry-run'])).toEqual({
      groups: ['sfx', 'music'],
      dryRun: true,
      only: null,
    });
    expect(optionsOf(['sfx', '--only', 'klaxon'])).toEqual({
      groups: ['sfx'],
      dryRun: false,
      only: 'klaxon',
    });
    expect(() => optionsOf(['--fresh'])).toThrow(/--fresh — it takes sfx, music/);
    expect(() => optionsOf(['--only'])).toThrow(/--only — it takes/);
    expect(() => optionsOf(['--only', '--dry-run'])).toThrow(/--only — it takes/);
  });
});

/** A WAV file as afconvert writes one: 16-bit PCM, interleaved, a chunk before the data. */
function wavOf(rate: number, channels: readonly number[][]): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  const data = frames * channels.length * 2;
  const bytes = new Uint8Array(12 + 24 + 12 + 8 + data);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string): void => {
    for (let i = 0; i < 4; i++) bytes[at + i] = text.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'FLLR'); // afconvert's padding chunk, skipped
  view.setUint32(40, 4, true);
  tag(48, 'data');
  view.setUint32(52, data, true);
  for (let i = 0; i < frames; i++) {
    channels.forEach((channel, c) => {
      const at = 56 + (i * channels.length + c) * 2;
      view.setInt16(at, Math.round((channel[i] ?? 0) * 32767), true);
    });
  }
  return bytes;
}

/** `ms` of silence, then a sine at `amplitude` for `soundMs`, at `rate`. */
function toneAfter(rate: number, ms: number, amplitude: number, soundMs: number): number[] {
  const quiet = Math.round((rate * ms) / 1000);
  const sound = Math.round((rate * soundMs) / 1000);
  const wave = (i: number): number => amplitude * Math.sin((2 * Math.PI * 441 * i) / rate);
  return [
    ...Array.from({ length: quiet }, () => 0),
    ...Array.from({ length: sound }, (_, i) => wave(i)),
  ];
}

describe('the loudness of a recording', () => {
  it('reads a WAV’s 16-bit samples, every channel, past the chunks before its data', () => {
    const pcm = parseWav(wavOf(8000, [[0, 0.5, -0.5], [0.25, 0, -1]]));
    expect(pcm.rate).toBe(8000);
    expect(pcm.channels).toHaveLength(2);
    expect([...(pcm.channels[0] ?? [])].map((x) => Number(x.toFixed(3)))).toEqual([0, 0.5, -0.5]);
    expect(pcm.channels[1]?.[2]).toBeCloseTo(-1, 3);
    expect(() => parseWav(new Uint8Array(44))).toThrow(/not a WAV/);
  });

  it('measures the peak and the RMS from where the sound starts, and how long it is', () => {
    const rate = 44100;
    const pcm: Pcm = parseWav(wavOf(rate, [toneAfter(rate, 50, 0.5, 500)]));
    const loudness = loudnessOf(pcm);
    expect(loudness.ms).toBe(550);
    expect(loudness.peak).toBeCloseTo(0.5, 3);
    expect(loudness.rms).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(loudness.leadMs).toBeCloseTo(50, 0);
  });

  it('brings a one-shot’s peak to −3 dBFS, a bed’s RMS to −20 and a sting’s to −14', () => {
    const loudness = { ms: 550, peak: 0.5, rms: 0.5 / Math.SQRT2, leadMs: 50 };
    expect(gainOf(TARGETS.oneshot, loudness, 'x')).toBeCloseTo(10 ** (-3 / 20) / 0.5, 4);
    expect(gainOf(TARGETS.bed, loudness, 'x')).toBeCloseTo((0.1 * Math.SQRT2) / 0.5, 4);
    const sting = (10 ** (-14 / 20) * Math.SQRT2) / 0.5;
    expect(gainOf(TARGETS.sting, loudness, 'x')).toBeCloseTo(sting, 4);
    const silent = { ms: 500, peak: 0, rms: 0, leadMs: 500 };
    const silence = /drip came back silent.*--only drip/;
    expect(() => gainOf(TARGETS.oneshot, silent, 'drip')).toThrow(silence);
  });

  it('starts a sound past more than 30 ms of silence, a bed always at its start', () => {
    const at = (leadMs: number) => ({ ms: 600, peak: 0.5, rms: 0.3, leadMs });
    expect(LEAD_MS).toBe(30);
    expect(startMsOf('oneshot', at(50.7))).toBe(50);
    expect(startMsOf('sting', at(120))).toBe(120);
    expect(startMsOf('oneshot', at(30))).toBe(0);
    expect(startMsOf('bed', at(200))).toBe(0);
    const rate = 8000;
    const late = loudnessOf(parseWav(wavOf(rate, [toneAfter(rate, 40, 0.2, 100)])));
    expect(startMsOf('oneshot', late)).toBe(40);
  });
});
