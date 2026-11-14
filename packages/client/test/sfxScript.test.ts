import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import type { SoundClient } from '../scripts/elevenlabs.js';
import {
  FLOOR_WINDOW_MS,
  floorOf,
  loudnessOf,
  parseWav,
  silenceOf,
  type Pcm,
} from '../scripts/pcm.js';
import {
  asTakes,
  AUDIBLE_FLOOR_DBFS,
  CAPS,
  checkCatalog,
  costOf,
  creditsLeft,
  effectRequest,
  flawsOf,
  floorHeard,
  gainOf,
  groupOf,
  hashOf,
  heardDbfs,
  influencesFor,
  isSuite,
  keepTake,
  LEAD_MS,
  LENGTHS,
  lengthOff,
  make,
  MASKED_WITHIN_DB,
  MAX_BED_GAIN_DB,
  MAX_MUSIC_TAKES,
  measuredAnew,
  MIN_CREDITS,
  missesOf,
  musicFormatOf,
  musicRequest,
  noisyTakes,
  offLength,
  optionsOf,
  pickTake,
  planLines,
  planOf,
  priced,
  readCatalog,
  readManifest,
  readTakes,
  refuseBelow,
  remakeArgs,
  remakeCommands,
  runWith,
  settingsOf,
  startMsOf,
  takesLines,
  TARGETS,
  tempoOf,
  upToDate,
  type Bench,
  type CatalogEntry,
  type CatalogItem,
  type Floor,
  type Keep,
  type Manifest,
  type ManifestEntry,
  type Places,
  type Studio,
  type Take,
} from '../scripts/sfx.js';
import {
  answering,
  benchOf,
  digest,
  piece,
  placesIn,
  runOf,
  studioOf,
  toneAfter,
  wavOf,
} from './sfxFakes.js';

/**
 * The sound script against a client of the tests' own — no request ever leaves — and PCM
 * made here, whose loudness is known.
 */

const catalog = readCatalog();
/** The catalog's sounds, each made on its own: every item but the suites. */
const sounds = catalog.filter((item): item is CatalogEntry => !isSuite(item));

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
  bpm: 90,
  target: { measure: 'rms', dbfs: -20 },
  usedBy: ['src/world/music.ts#STEMS'],
};

describe('the catalog', () => {
  it('names every sound once, each keeping every rule', () => {
    expect(() => checkCatalog(catalog)).not.toThrow();
    expect(catalog.length).toBeGreaterThan(60);
    expect(new Set(catalog.map((entry) => entry.id)).size).toBe(catalog.length);
  });

  it('brings one-shots to a −3 dBFS peak, the rest to −20 dBFS RMS, stings to −14', () => {
    expect(TARGETS).toEqual({
      oneshot: { measure: 'peak', dbfs: -3 },
      bed: { measure: 'rms', dbfs: -20 },
      stem: { measure: 'rms', dbfs: -20 },
      sting: { measure: 'rms', dbfs: -14 },
      theme: { measure: 'rms', dbfs: -20 },
    });
    for (const entry of sounds) expect(entry.target, entry.id).toEqual(TARGETS[entry.kind]);
  });

  it('has the end card’s two stings, 8–12 s, beside the score holding the rest', () => {
    const music = catalog.filter((item) => groupOf(item) === 'music').map((item) => item.id);
    expect(music).toEqual(['won', 'lost', 'score']);
    const stings = sounds.filter((entry) => entry.kind === 'sting');
    expect(stings.map((entry) => [entry.id, entry.loop, entry.durationSeconds])).toEqual([
      ['won', false, 10],
      ['lost', false, 10],
    ]);
    expect(LENGTHS.sting).toEqual([8, 12]);
  });

  it('makes a theme at 128 kbit/s, every other piece of music at 192, a suite too', () => {
    const theme: CatalogEntry = {
      id: 'test-theme',
      kind: 'theme',
      prompt: CALM.prompt,
      durationSeconds: 32,
      loop: false,
      target: { measure: 'rms', dbfs: -20 },
      usedBy: CALM.usedBy,
    };
    expect(musicRequest(theme).outputFormat).toBe('mp3_44100_128');
    expect(flawsOf({ ...CLACK, kind: 'theme', durationSeconds: 32, loop: true })).toEqual([
      'loop has to be true for a bed or a stem, and false for the rest',
      'its target has to be {"measure":"rms","dbfs":-20}',
    ]);
    // The stems and stings keep 192 kbit/s, and with it the requests they were made from.
    expect(musicFormatOf(CALM)).toBe('mp3_44100_192');
    expect(musicFormatOf({ kind: 'sting' })).toBe('mp3_44100_192');
    expect(musicFormatOf({ kind: 'suite' })).toBe('mp3_44100_192');
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

  it('gives each stem the tempo its prompt states, one for all three, no other kind one', () => {
    expect(tempoOf(CALM.prompt)).toBe(90);
    expect(tempoOf('steady, 92.5 bpm, no drums')).toBe(92.5);
    expect(tempoOf(CLACK.prompt)).toBeNull();
    const untimed: CatalogEntry = {
      id: CALM.id,
      kind: 'stem',
      prompt: CALM.prompt,
      durationSeconds: CALM.durationSeconds,
      loop: true,
      target: CALM.target,
      usedBy: CALM.usedBy,
    };
    expect(flawsOf(untimed)).toEqual([expect.stringMatching(/the tempo its prompt states \(90\)/)]);
    expect(flawsOf({ ...CALM, bpm: 120 })).toHaveLength(1);
    expect(flawsOf({ ...CLACK, bpm: 90 })).toEqual(['only a stem has a bpm']);
    const prompt = CALM.prompt.replace('90', '120');
    const quicker = { ...CALM, id: 'test-quick', prompt, bpm: 120 };
    expect(() => checkCatalog([CALM, quicker])).toThrow(/share one tempo, not 90, 120 bpm/);
    for (const stem of sounds.filter((entry) => entry.kind === 'stem')) {
      expect(stem.bpm, stem.id).toBe(90);
    }
    expect(hashOf({ ...CALM, bpm: 120 })).toBe(hashOf(CALM)); // the tempo asks nothing anew
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
    const bed = sounds.find((entry) => entry.id === 'bed-server') as CatalogEntry;
    expect(effectRequest(bed).loop).toBe(true);
    expect(effectRequest(CLACK, 0.9).promptInfluence).toBe(0.9);
  });

  it('asks Eleven Music for an instrumental piece at 192 kbit/s, as long as asked', () => {
    expect(musicRequest(CALM)).toEqual({
      prompt: CALM.prompt,
      musicLengthMs: 72_000,
      forceInstrumental: true,
      modelId: 'music_v2_5',
      outputFormat: 'mp3_44100_192',
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
      hashOf(CLACK, 0.9),
    ];
    expect(new Set([hash, ...changed]).size).toBe(5);
    expect(hashOf(CALM, 0.9)).toBe(hashOf(CALM)); // music follows no influence
  });

  it('spreads an effect’s candidates from loose to close, one made once at 0.5', () => {
    expect(influencesFor(1)).toEqual([0.5]);
    expect(influencesFor(2)).toEqual([0.3, 0.9]);
    expect(influencesFor(3)).toEqual([0.3, 0.6, 0.9]);
    expect(influencesFor(5)).toEqual([0.3, 0.45, 0.6, 0.75, 0.9]);
  });

  it('costs about 4 credits a second of an effect, 18 of music, and keeps within the caps', () => {
    expect(costOf(CLACK)).toBe(3);
    expect(costOf(CLACK, 3)).toBe(8); // three candidates
    expect(costOf(CALM)).toBe(1296);
    expect(costOf(CALM, 3)).toBe(3888); // three takes of the piece, too
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
    await make(client, CLACK, { influence: 0.3 });
    expect(effects).toEqual([effectRequest(CLACK), effectRequest(CLACK, 0.3)]);
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
    await expect(make(clientOf(busy).client, CLACK, { wait })).rejects.toThrow(/\(429\)/);
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

  it('prices a group at what its first entry cost a second, and stops it over its cap', () => {
    expect(priced(24, 0.6, 1.8, 'sfx')).toEqual({ perSecond: 40, total: 96, over: false });
    expect(priced(600, 0.6, 18, 'sfx').over).toBe(true);
    expect(priced(600, 0.6, 18, 'music').over).toBe(true);
    expect(priced(0, 0.6, 1.8, 'sfx').total).toBe(0); // the account not caught up yet: no stop
  });
});

describe('a run', () => {
  const manifestEntry = (entry: CatalogEntry): ManifestEntry => ({
    file: `${entry.id}.mp3`,
    ms: 600,
    gain: 1,
    startMs: 0,
    floor: 0.0001,
    rms: 0.1,
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
    const both = optionsOf(['--only', 'test-calm,test-clack']);
    expect(planOf([CLACK, CALM], manifests, always, both).map((job) => job.make)).toEqual([
      true,
      true,
    ]);
    expect(() => planOf([CLACK], manifests, always, optionsOf(['--only', 'nope']))).toThrow(
      /--only nope.*no such entry/,
    );
    const stray = optionsOf(['--only', 'test-clack,nope,zap']);
    expect(() => planOf([CLACK], manifests, always, stray)).toThrow(/--only nope,zap /);
  });

  it('keeps a candidate made at another influence, as long as its prompt stands', () => {
    const at = (influence: number): ManifestEntry => ({
      ...manifestEntry(CLACK),
      hash: hashOf(CLACK, influence),
      influence,
    });
    expect(upToDate(CLACK, at(0.9))).toBe(true);
    expect(upToDate(CLACK, manifestEntry(CLACK))).toBe(true); // made once, at 0.5
    const unnamed = { ...manifestEntry(CLACK), hash: hashOf(CLACK, 0.9) };
    expect(upToDate(CLACK, unnamed)).toBe(false); // whose influence goes unsaid: 0.5
    expect(upToDate({ ...CLACK, prompt: `${CLACK.prompt} Louder.` }, at(0.9))).toBe(false);
    const kept = { sfx: { [CLACK.id]: at(0.6) }, music: {} };
    const fresh = planOf([CLACK], kept, () => true, everything);
    expect(fresh[0]?.make).toBe(false);
  });

  it('names every recording whose floor is heard, with its gain and that floor', () => {
    const BED = { ...CALM, id: 'test-bed', kind: 'bed', durationSeconds: 10 } as const;
    const at = (entry: CatalogEntry, gain: number, floorDbfs: number, rmsDbfs: number) => ({
      ...manifestEntry(entry),
      gain,
      floor: 10 ** (floorDbfs / 20),
      rms: 10 ** (rmsDbfs / 20),
    });
    const manifests = {
      sfx: { [CLACK.id]: at(CLACK, 12, -70, -30), [BED.id]: at(BED, 8, -40, -38) },
      music: { [CALM.id]: at(CALM, 1, -90, -20) },
    };
    expect(noisyTakes([CLACK, BED, CALM], manifests)).toEqual([
      { id: 'test-clack', gain: 12, heardDbfs: -48.4 },
    ]);
    const softer = { ...manifests, sfx: { [CLACK.id]: at(CLACK, 8, -70, -30) } };
    expect(noisyTakes([CLACK, BED, CALM], softer)).toEqual([]);
  });

  it('names every recording more than a fifth off the length it asked for', () => {
    const at = (ms: number) => ({ sfx: {}, music: { [CALM.id]: { ...manifestEntry(CALM), ms } } });
    expect(lengthOff(CALM, 86_400)).toBeCloseTo(0.2, 9);
    expect(offLength([CALM], at(86_400))).toEqual([]); // 72 s and a fifth
    expect(offLength([CALM], at(57_600))).toEqual([]);
    const long = [{ id: 'test-calm', ms: 86_500, asked: 72_000 }];
    expect(offLength([CALM], at(86_500))).toEqual(long);
    expect(offLength([CALM], { sfx: {}, music: {} })).toEqual([]); // nothing made yet
  });

  it('reads the command line, pnpm’s -- and all, and refuses anything else', () => {
    const none = { groups: ['sfx', 'music'], dryRun: false, only: null, candidates: 1, keep: null };
    expect(optionsOf([])).toEqual(none);
    expect(optionsOf(['--', '--dry-run'])).toEqual({ ...none, dryRun: true });
    expect(optionsOf(['sfx', '--only', 'klaxon'])).toEqual({
      ...none,
      groups: ['sfx'],
      only: ['klaxon'],
    });
    const list = optionsOf(['--candidates', '3', '--only', 'step-1,step-2, ,ping']);
    expect(list).toEqual({ ...none, only: ['step-1', 'step-2', 'ping'], candidates: 3 });
    expect(() => optionsOf(['--fresh'])).toThrow(/--fresh — it takes sfx, music/);
    expect(() => optionsOf(['--only'])).toThrow(/--only — it takes/);
    expect(() => optionsOf(['--only', '--dry-run'])).toThrow(/--only — it takes/);
    expect(() => optionsOf(['--candidates'])).toThrow(/--candidates — it takes a number/);
    for (const bad of ['0', '6', '2.5', 'drei']) {
      expect(() => optionsOf(['--candidates', bad]), bad).toThrow(/from 1 to 5/);
    }
  });
});

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

  it('measures the floor as the RMS of the quietest 100 ms, every channel at once', () => {
    expect(FLOOR_WINDOW_MS).toBe(100);
    const rate = 8000;
    const loud = toneAfter(rate, 0, 0.5, 300);
    const gap = Float32Array.from([...loud, ...toneAfter(rate, 0, 0.001, 200), ...loud]);
    expect(floorOf({ rate, channels: [gap] }) / (0.001 / Math.SQRT2)).toBeCloseTo(1, 2);
    // A dip shorter than 100 ms is no floor: every window takes in some of the sound.
    const dip = Float32Array.from([...loud, ...toneAfter(rate, 0, 0.001, 60), ...loud]);
    expect(floorOf({ rate, channels: [dip] })).toBeGreaterThan(0.1);
    const steady = Float32Array.from(toneAfter(rate, 0, 0.5, 800));
    expect(floorOf({ rate, channels: [gap, steady] })).toBeCloseTo(0.25, 2); // both at once
    const short = Float32Array.from(toneAfter(rate, 0, 0.2, 50)); // shorter: all of it
    expect(floorOf({ rate, channels: [short] }) / (0.2 / Math.SQRT2)).toBeCloseTo(1, 2);
    expect(floorOf({ rate, channels: [new Float32Array(1600)] })).toBe(0);
    expect(floorOf({ rate, channels: [new Float32Array(0)] })).toBe(0);
  });

  it('hears a floor only in a gap of the sound, over −50 dBFS once the gain is applied', () => {
    expect([AUDIBLE_FLOOR_DBFS, MASKED_WITHIN_DB]).toEqual([-50, 20]);
    const at = (floorDbfs: number, rmsDbfs: number, gain: number): Floor => ({
      floor: 10 ** (floorDbfs / 20),
      rms: 10 ** (rmsDbfs / 20),
      gain,
    });
    // A click's tail at −70 dBFS, brought up 12×, comes out at −48.4 dBFS; at 8×, at −51.9.
    expect(heardDbfs(at(-70, -30, 12))).toBeCloseTo(-48.42, 2);
    expect(floorHeard(at(-70, -30, 12))).toBe(true);
    expect(floorHeard(at(-70, -30, 8))).toBe(false);
    // A take played softer than made still plays a loud floor: a hiss after a door.
    expect(floorHeard(at(-42, -14, 0.7))).toBe(true);
    // A bed's quietest 100 ms is the bed: within 20 dB of its RMS, the sound masks it.
    expect(floorHeard(at(-40, -38, 8))).toBe(false);
    expect(floorHeard(at(-58.01, -38, 8))).toBe(true);
    expect(floorHeard({ floor: 0, rms: 0.1, gain: 100 })).toBe(false); // digital silence
  });
});

describe('picking a candidate', () => {
  /** How a take measures: its peak, RMS and floor in dBFS, its start, silence, gain, length. */
  interface Measured {
    readonly peakDbfs?: number;
    readonly rmsDbfs?: number;
    readonly floorDbfs?: number;
    readonly leadMs?: number;
    readonly silence?: number;
    readonly gain?: number;
    readonly lengthOff?: number;
  }

  /** A take measured as `over` says: by default one that keeps every rule. */
  const take = (over: Measured = {}): Take => ({
    path: `/tmp/${Math.random()}.mp3`,
    influence: 0.6,
    loudness: {
      ms: 500,
      peak: 10 ** ((over.peakDbfs ?? -2) / 20),
      rms: 10 ** ((over.rmsDbfs ?? -18) / 20),
      leadMs: over.leadMs ?? 0,
    },
    silence: over.silence ?? 0.05,
    floor: over.floorDbfs === undefined ? 0 : 10 ** (over.floorDbfs / 20),
    gain: over.gain ?? 1,
    lengthOff: over.lengthOff ?? 0.04,
  });

  it('measures silence as the share of 10 ms frames under −60 dBFS, every channel at once', () => {
    const rate = 8000;
    const tone = toneAfter(rate, 50, 0.5, 450);
    expect(silenceOf({ rate, channels: [Float32Array.from(tone)] })).toBeCloseTo(0.1, 9);
    const faint = Float32Array.from(toneAfter(rate, 0, 10 ** (-70 / 20), 500));
    const soft = Float32Array.from(toneAfter(rate, 0, 10 ** (-50 / 20), 500));
    expect(silenceOf({ rate, channels: [faint] })).toBe(1);
    expect(silenceOf({ rate, channels: [soft] })).toBe(0);
    expect(silenceOf({ rate, channels: [faint, soft] })).toBe(0); // the other channel sounds
  });

  it('names the rules a take misses: peak, start, silence, length and floor', () => {
    expect(missesOf(take())).toEqual([]);
    const late = take({ peakDbfs: -7, leadMs: 60, silence: 0.11, lengthOff: 0.25 });
    expect(missesOf(late)).toEqual(['peak', 'start', 'silence', 'length']);
    const hiss = take({ rmsDbfs: -30, floorDbfs: -70, gain: 12 });
    expect(missesOf(hiss)).toEqual(['floor']);
    // The peak before the gain at −6 dBFS or more; the sound within 50 ms; a tenth silent.
    const edge = take({ peakDbfs: -5.99, leadMs: 50, silence: 0.1, lengthOff: 0.2 });
    expect(missesOf(edge)).toEqual([]);
    expect(missesOf(take({ peakDbfs: -6.01 }))).toEqual(['peak']);
  });

  it('keeps of the takes missing fewest rules the one with the loudest RMS', () => {
    const keeps = take({ rmsDbfs: -20 });
    const quiet = take({ rmsDbfs: -10, peakDbfs: -8 });
    const late = take({ rmsDbfs: -12, leadMs: 80 });
    expect(pickTake([quiet, late, keeps])).toBe(keeps); // valid beats louder
    const louder = take({ rmsDbfs: -15 });
    expect(pickTake([keeps, louder])).toBe(louder);
    const hiss = take({ rmsDbfs: -10, floorDbfs: -40 }); // its floor heard at −40 dBFS
    expect(pickTake([hiss, keeps])).toBe(keeps);
    // Clicks: each misses the silence rule with its tail; the loudest RMS wins.
    const soft = take({ silence: 0.7, rmsDbfs: -30 });
    const full = take({ silence: 0.6, rmsDbfs: -26 });
    expect(pickTake([soft, full])).toBe(full);
    expect(() => pickTake([])).toThrow(/no take/);
  });
});

/** A manifest entry of `entry`, as a run would write it for a recording made from its request. */
function manifestOf(entry: CatalogEntry): ManifestEntry {
  return {
    file: `${entry.id}.mp3`,
    ms: entry.durationSeconds * 1000,
    gain: 1,
    startMs: 0,
    floor: 0.0001,
    rms: 0.1,
    loop: entry.loop,
    hash: hashOf(entry),
    source: 'elevenlabs',
  };
}

const STING: CatalogEntry = {
  id: 'test-sting',
  kind: 'sting',
  prompt: 'A short orchestral sting, strings and soft brass rising to a C major chord, 10 s.',
  durationSeconds: 10,
  loop: false,
  target: { measure: 'rms', dbfs: -14 },
  usedBy: ['src/world/music.ts#playSting'],
};

describe('the music’s takes, asked for and priced', () => {
  const none = { sfx: {}, music: {} };
  const always = (): boolean => true;

  it('are three of a piece at most, its cost running by the second; an effect keeps five', () => {
    expect(MAX_MUSIC_TAKES).toBe(3);
    const four = optionsOf(['--candidates', '4', '--only', 'test-calm,test-sting']);
    const refusal =
      'sfx: --candidates 4 — music is made in 3 takes at most, its cost runs by the second: ' +
      '--candidates 3 --only test-calm,test-sting';
    expect(() => planOf([CLACK, CALM, STING], none, always, four)).toThrow(refusal);
    expect(planOf([CLACK], none, always, optionsOf(['--candidates', '5']))).toHaveLength(1);
    // Music already made, and so not asked for, does not stop the effects' five candidates.
    const made = { ...none, music: { [CALM.id]: manifestOf(CALM) } };
    const five = planOf([CLACK, CALM], made, always, optionsOf(['--candidates', '5']));
    expect(five.map((job) => [job.entry.id, job.make])).toEqual([
      ['test-clack', true],
      ['test-calm', false],
    ]);
    const music = { entry: CALM, group: 'music' } as const;
    expect([asTakes(music, 3), asTakes(music, 2), asTakes(music, 1)]).toEqual([true, true, false]);
    expect(asTakes({ entry: CLACK, group: 'sfx' }, 3)).toBe(false);
  });

  it('are asked for with the piece’s request, its settings listed beside the prompt', () => {
    expect(settingsOf(CALM)).toEqual({
      musicLengthMs: 72_000,
      forceInstrumental: true,
      modelId: 'music_v2_5',
      outputFormat: 'mp3_44100_192',
    });
    expect(musicRequest(CALM)).toEqual({ prompt: CALM.prompt, ...settingsOf(CALM) });
    // In this order: the request's JSON is what every recording's hash is taken of.
    const order = ['prompt', 'musicLengthMs', 'forceInstrumental', 'modelId', 'outputFormat'];
    expect(Object.keys(musicRequest(CALM))).toEqual(order);
  });

  it('are priced in the plan, every take counted at 18 credits a second', () => {
    const music = planOf(catalog, none, always, optionsOf(['--only', 'won,lost']));
    expect(planLines(music, 3)).toEqual([
      'sfx: music — 2 of 2 to make, 3 takes each, into takes/ for the ear, 20.0 s a take, ' +
        'about 1080 credits (cap 18000)',
      '  won  10 s  sting',
      '  lost  10 s  sting',
    ]);
    const once = 'sfx: music — 2 of 2 to make, 20.0 s, about 360 credits (cap 18000)';
    expect(planLines(music, 1)[0]).toBe(once);
    const effect = planOf([CLACK], none, always, optionsOf([]));
    expect(planLines(effect, 3)[0]).toBe(
      'sfx: sfx — 1 of 1 to make, 3 takes each, the best one kept, 0.6 s a take, ' +
        'about 8 credits (cap 12000)',
    );
  });

  it('are made again, for a recording that fails, in three takes; an effect in five', () => {
    expect(remakeArgs('sfx', ['ping', 'drip'])).toBe('--candidates 5 --only ping,drip');
    expect(remakeArgs('music', ['lost'])).toBe('--candidates 3 --only lost');
  });
});

describe('the music’s takes on disk', () => {
  const always = (): boolean => true;

  it('land in takes/<id>/, none of them kept and nothing public, each listed as made', async () => {
    const places = placesIn();
    const { client, pieces, asked } = answering({
      music: [0.6, 0.8, 0.7].map((a) => piece(10, a)),
    });
    const manifests = await runOf([STING], 3, benchOf(client, places));
    expect(pieces).toEqual([musicRequest(STING), musicRequest(STING), musicRequest(STING)]);
    expect(asked).toEqual([undefined, undefined, undefined]); // a piece of seconds: the SDK's wait
    const folder = join(places.takes, STING.id);
    expect(readdirSync(folder).sort()).toEqual(['1.mp3', '2.mp3', '3.mp3', 'index.json']);
    expect(existsSync(places.dirs.music)).toBe(false);
    expect(manifests.music).toEqual({});
    const list = readTakes(places.takes, STING.id);
    expect(list?.id).toBe(STING.id);
    expect(list?.takes.map((take) => [take.n, take.file])).toEqual([
      [1, '1.mp3'],
      [2, '2.mp3'],
      [3, '3.mp3'],
    ]);
    const second = list?.takes[1];
    expect(second).toMatchObject({
      hash: hashOf(STING),
      settings: settingsOf(STING),
      madeAt: '2026-11-13T17:40:00.000Z',
      ms: 10_000,
      startMs: 0,
      silence: 0,
      misses: [],
    });
    // A steady tone: its quietest 100 ms is the tone itself.
    expect(second?.rms).toBeCloseTo(0.8 / Math.SQRT2, 2);
    expect(second?.floor).toBeCloseTo(0.8 / Math.SQRT2, 2);
    expect(second?.peak).toBeCloseTo(0.8, 3);
    expect(second?.gain).toBeCloseTo(10 ** (-14 / 20) / (0.8 / Math.SQRT2), 3);
    expect(digest(readFileSync(join(folder, '2.mp3')))).toBe(digest(piece(10, 0.8)));
  });

  it('number on from the takes there, and leave the effects as they were made', async () => {
    const places = placesIn();
    const { client, effects } = answering({ music: [piece(10, 0.7)], effects: [piece(0.6, 0.9)] });
    const bench = benchOf(client, places);
    await runOf([STING], 2, bench);
    const manifests = await runOf([STING, CLACK], 2, bench);
    expect(readTakes(places.takes, STING.id)?.takes.map((take) => take.n)).toEqual([1, 2, 3, 4]);
    // The effect: two candidates, the first of two alike kept in the project and its manifest.
    expect(effects.map((request) => request.promptInfluence)).toEqual([0.3, 0.9]);
    expect(existsSync(join(places.takes, CLACK.id))).toBe(false);
    expect(readdirSync(places.dirs.sfx).sort()).toEqual(['manifest.json', 'test-clack.mp3']);
    const clack = { file: 'test-clack.mp3', hash: hashOf(CLACK, 0.3), influence: 0.3 };
    expect(manifests.sfx[CLACK.id]).toMatchObject(clack);
    expect(readManifest(places, 'sfx')).toEqual(manifests.sfx);
    expect(existsSync(places.dirs.music)).toBe(false);
  });

  it('are made once into the project where a run asks for one take, as before', async () => {
    const places = placesIn();
    const { client } = answering({ music: [piece(10, 0.7)] });
    const manifests = await runOf([STING], 1, benchOf(client, places));
    expect(existsSync(places.takes)).toBe(false);
    expect(readdirSync(places.dirs.music).sort()).toEqual(['manifest.json', 'test-sting.mp3']);
    const sting = { file: 'test-sting.mp3', hash: hashOf(STING) };
    expect(manifests.music[STING.id]).toMatchObject(sting);
  });

  it('leave the recording the game plays, and its entry, as they were', () => {
    const made = { sfx: { [CLACK.id]: manifestOf(CLACK) }, music: { [CALM.id]: manifestOf(CALM) } };
    const jobs = planOf([CLACK, CALM, STING], made, always, optionsOf(['--only', 'test-calm']));
    const ids = (count: number): string[] => measuredAnew(jobs, count).map((job) => job.entry.id);
    expect(ids(3)).toEqual([]); // the stem goes into takes: its old recording is not measured
    expect(ids(1)).toEqual(['test-calm']); // made once, into the project: measured as made
    const all = planOf([CLACK, CALM], made, always, optionsOf(['--candidates', '3']));
    expect(measuredAnew(all, 3).map((job) => [job.entry.id, job.make])).toEqual([
      ['test-clack', false],
      ['test-calm', false],
    ]);
  });

  it('are said where they lie, and that none of them is kept', async () => {
    const places = placesIn();
    const { client } = answering({ music: [piece(10, 0.7)] });
    await runOf([STING], 3, benchOf(client, places));
    expect(takesLines([], places)).toEqual([]);
    const [folder, files] = takesLines([STING.id], places);
    expect(folder).toBe(`sfx: none of this music is kept yet; its takes wait in ${places.takes}:`);
    expect(files).toBe('  test-sting/  1.mp3, 2.mp3, 3.mp3, listed in test-sting/index.json');
  });
});

/** Three takes of the sting, at 0.6, 0.8 and 0.7, and two of the calm stem, in `places`. */
async function takesIn(places: Places): Promise<Bench> {
  const sting = answering({ music: [0.6, 0.8, 0.7].map((a) => piece(10, a)) });
  await runOf([STING], 3, benchOf(sting.client, places));
  const calm = answering({ music: [piece(72, 0.5), piece(72, 0.9)] });
  const bench = benchOf(calm.client, places);
  await runOf([CALM], 2, bench);
  return bench;
}

const keep = (id: string, n: number): Keep => ({ id, n });

/** Why keeping `asked` with `bench` is refused, in its one line; „kept" where it is not. */
function refusalOf(
  asked: Keep,
  bench: Bench,
  catalog: readonly CatalogItem[] = [STING, CALM, CLACK],
): string {
  try {
    keepTake(asked, catalog, bench);
  } catch (error) {
    return (error as Error).message;
  }
  return 'kept';
}

describe('keeping a take, as asked', () => {
  it('is asked for as --keep <id>=<n>, alone, one take a run', () => {
    const none = { groups: ['sfx', 'music'], dryRun: false, only: null, candidates: 1 };
    expect(optionsOf(['--', '--keep', 'menu-theme=2'])).toEqual({
      ...none,
      keep: { id: 'menu-theme', n: 2 },
    });
    expect(optionsOf(['--keep', 'end-won=12']).keep).toEqual({ id: 'end-won', n: 12 });
    const malformed =
      /^sfx: --keep \S* — it takes an entry's id and a take's number: --keep menu-theme=2$/;
    for (const bad of ['menu-theme', 'menu-theme=0', 'menu-theme=2.5', 'Menu=1', '=1', 'a=b']) {
      expect(() => optionsOf(['--keep', bad]), bad).toThrow(malformed);
    }
    expect(() => optionsOf(['--keep'])).toThrow(/^sfx: --keep — it takes an entry's id/);
    const twice = ['--keep', 'a=1', '--keep', 'b=2'];
    expect(() => optionsOf(twice)).toThrow(/^sfx: --keep twice — a run keeps one take$/);
    for (const more of [['music'], ['--dry-run'], ['--only', 'a'], ['--candidates', '3']]) {
      expect(() => optionsOf(['--keep', 'a=1', ...more]), more.join(' ')).toThrow(
        /^sfx: --keep keeps a take and makes nothing: it comes alone$/,
      );
    }
  });

  it('is said after a run that made takes, a command for each entry', async () => {
    const places = placesIn();
    await takesIn(places);
    const lines = takesLines([STING.id, CALM.id], places);
    expect(lines.slice(-3)).toEqual([
      'sfx: the ear chooses: with pnpm dev, http://localhost:5173/sounds plays each take ' +
        'under its piece; in packages/client, this keeps take <n> and deletes the others:',
      '  node scripts/sfx.ts --keep test-sting=<n>',
      '  node scripts/sfx.ts --keep test-calm=<n>',
    ]);
  });
});

describe('keeping a take, on disk', () => {
  it('moves it into the music, writes its entry as a render would, deletes the rest', async () => {
    const places = placesIn();
    const bench = await takesIn(places);
    const before = readManifest(places, 'music');
    const { group, kept: all } = keepTake(keep(STING.id, 2), [STING, CALM], bench);
    expect(group).toBe('music');
    expect(Object.keys(all)).toEqual([STING.id]);
    const kept = all[STING.id] as ManifestEntry;
    const file = join(places.dirs.music, 'test-sting.mp3');
    expect(digest(readFileSync(file))).toBe(digest(piece(10, 0.8)));
    expect(existsSync(join(places.takes, STING.id))).toBe(false);
    expect(readTakes(places.takes, CALM.id)?.takes).toHaveLength(2); // another's takes stay
    const manifest = readManifest(places, 'music');
    expect(manifest).toEqual({ ...before, [STING.id]: kept });
    expect(kept).toEqual({
      file: 'test-sting.mp3',
      ms: 10_000,
      gain: expect.closeTo(10 ** (-14 / 20) / (0.8 / Math.SQRT2), 3),
      startMs: 0,
      floor: expect.closeTo(0.8 / Math.SQRT2, 2),
      rms: expect.closeTo(0.8 / Math.SQRT2, 2),
      loop: false,
      hash: hashOf(STING),
      source: 'elevenlabs',
    });
    // As sampleManifest.test.ts holds the game's recordings: made from the request as it stands,
    // as long as asked, starting within itself, unclipped, its floor not heard.
    const music = { sfx: {}, music: manifest };
    expect(upToDate(STING, kept)).toBe(true);
    expect([offLength([STING], music), noisyTakes([STING], music)]).toEqual([[], []]);
    expect(kept.gain).toBeGreaterThan(0.1);
    expect(kept.startMs).toBeLessThan(kept.ms / 4);
  });

  it('keeps a stem round and round at its tempo, beside the music kept before', async () => {
    const places = placesIn();
    const bench = await takesIn(places);
    keepTake(keep(STING.id, 1), [STING, CALM], bench);
    const { kept } = keepTake(keep(CALM.id, 2), [STING, CALM], bench);
    const calmKept = { file: 'test-calm.mp3', loop: true, bpm: 90, hash: hashOf(CALM) };
    expect(kept[CALM.id]).toMatchObject(calmKept);
    expect(Object.keys(readManifest(places, 'music'))).toEqual(['test-calm', 'test-sting']);
    expect(readdirSync(places.takes)).toEqual([]);
    const calm = readFileSync(join(places.dirs.music, 'test-calm.mp3'));
    expect(digest(calm)).toBe(digest(piece(72, 0.9)));
  });

});

describe('keeping a take, refused', () => {
  it('refuses, in one line and moving nothing, an id or a take it cannot keep', async () => {
    const places = placesIn();
    const bench = await takesIn(places);
    const refusal = (asked: Keep, catalog?: readonly CatalogEntry[]): string =>
      refusalOf(asked, bench, catalog);
    const unknown = 'sfx: --keep nope=1 — audio/catalog.json has no such entry';
    expect(refusal(keep('nope', 1))).toBe(unknown);
    const lost = { ...STING, id: 'test-lost' };
    expect(refusal(keep('test-lost', 1), [lost])).toBe(
      'sfx: --keep test-lost=1 — test-lost has no takes; make some: ' +
        '--candidates 3 --only test-lost',
    );
    expect(refusal(keep(CLACK.id, 1))).toBe(
      'sfx: --keep test-clack=1 — test-clack is an effect, whose best take a run keeps itself: ' +
        'none waits for the ear',
    );
    expect(refusal(keep(STING.id, 4))).toBe(
      'sfx: --keep test-sting=4 — test-sting has takes 1, 2, 3, and no take 4',
    );
    const changed = { ...STING, prompt: `${STING.prompt} Louder.` };
    expect(refusal(keep(STING.id, 2), [changed])).toBe(
      "sfx: --keep test-sting=2 — it was made from another request than the catalog's: " +
        '--candidates 3 --only test-sting',
    );
    rmSync(join(places.takes, STING.id, '3.mp3'));
    expect(refusal(keep(STING.id, 3))).toBe(
      `sfx: --keep test-sting=3 — its file test-sting/3.mp3 is gone from ${places.takes}`,
    );
    expect(existsSync(places.dirs.music)).toBe(false);
    const left = readdirSync(join(places.takes, STING.id)).sort();
    expect(left).toEqual(['1.mp3', '2.mp3', 'index.json']);
  });

  it('says a piece is kept already where a second keep asks for it', async () => {
    const places = placesIn();
    const bench = await takesIn(places);
    keepTake(keep(STING.id, 2), [STING, CALM], bench);
    expect(refusalOf(keep(STING.id, 2), bench)).toBe(
      'sfx: --keep test-sting=2 — test-sting is kept already, as public/music/test-sting.mp3, ' +
        'and no takes of it wait',
    );
    // An older recording is no keep: the catalog's request has changed since it was made.
    const changed = { ...STING, prompt: `${STING.prompt} Louder.` };
    expect(refusalOf(keep(STING.id, 2), bench, [changed])).toBe(
      'sfx: --keep test-sting=2 — test-sting has no takes; make some: ' +
        '--candidates 3 --only test-sting',
    );
  });

  it('names a list of takes that does not read, as the plan and a keep come to it', async () => {
    const places = placesIn();
    const bench = await takesIn(places);
    const list = join(places.takes, STING.id, 'index.json');
    writeFileSync(list, '{ "id": "test-sting", "takes": [');
    const named = `sfx: ${list} does not read as a list of takes: `;
    expect(() => readTakes(places.takes, STING.id)).toThrow(named);
    expect(refusalOf(keep(STING.id, 1), bench)).toMatch(/^sfx: \S+index\.json does/);
    const { studio } = studioOf(answering({}).client, places);
    await expect(runWith(optionsOf(['music']), [STING], studio)).rejects.toThrow(named);
  });
});

/** The sting as an older prompt made it: its file in the project, its entry that request's. */
const OLDER: CatalogEntry = { ...STING, prompt: `${STING.prompt} Softer.` };

/** Puts the older sting into `places`: piece(10, 0.5), listed as OLDER's. */
function olderIn(places: Places): void {
  mkdirSync(places.dirs.music, { recursive: true });
  writeFileSync(join(places.dirs.music, 'test-sting.mp3'), piece(10, 0.5));
  const manifest = { [STING.id]: manifestOf(OLDER) };
  writeFileSync(join(places.dirs.music, 'manifest.json'), JSON.stringify(manifest));
}

/**
 * Runs the script with `args` over the sting in `studio`, quietly; returns what it said, and
 * fails where it named a recording that fails the game's or set the exit code.
 */
async function runOver(args: readonly string[], studio: Studio): Promise<string[]> {
  const said: string[] = [];
  const exit = process.exitCode;
  const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void said.push(line));
  const error = vi.spyOn(console, 'error');
  try {
    await runWith(optionsOf(args), [STING], studio);
    expect([error.mock.calls, process.exitCode]).toEqual([[], exit]);
  } finally {
    log.mockRestore();
    error.mockRestore();
    process.exitCode = exit;
  }
  return said;
}

describe('a run as the command line asks', () => {
  it('makes takes, the old recording left as made; a keep asks the account nothing', async () => {
    const places = placesIn();
    olderIn(places);
    const { client, pieces } = answering({ music: [0.6, 0.8, 0.7].map((a) => piece(10, a)) });
    const { studio, opened } = studioOf(client, places);
    await runOver(['--candidates', '3', '--only', 'test-sting'], studio);
    expect([pieces.length, opened()]).toEqual([3, 1]);
    // Not measured anew: the recording the game plays keeps the older request's hash.
    expect(readManifest(places, 'music')[STING.id]).toEqual(manifestOf(OLDER));
    const [keptSaid] = await runOver(['--keep', 'test-sting=2'], studio);
    expect(keptSaid).toMatch(/^sfx: take 2 of test-sting is public\/music\/test-sting\.mp3 now, /);
    expect(keptSaid).toMatch(/ — reload \/sounds to hear it as the game plays it$/);
    expect([pieces.length, opened()]).toEqual([3, 1]);
    expect(readManifest(places, 'music')[STING.id]?.hash).toBe(hashOf(STING));
    const kept = readFileSync(join(places.dirs.music, 'test-sting.mp3'));
    expect(digest(kept)).toBe(digest(piece(10, 0.8)));
    expect(existsSync(join(places.takes, STING.id))).toBe(false);
  });

  it('leaves a piece whose takes wait as it is, unless new takes are asked for', async () => {
    const places = placesIn();
    olderIn(places);
    const { client, pieces } = answering({ music: [piece(10, 0.7)] });
    const { studio } = studioOf(client, places);
    await runOver(['--candidates', '2', '--only', 'test-sting'], studio);
    for (const args of [['--only', 'test-sting'], ['music'], []]) {
      const said = await runOver(args, studio);
      expect(said, args.join(' ')).toContain(
        'sfx: test-sting is left as it is, its takes waiting: --keep test-sting=<n> keeps ' +
          'one, --candidates 3 --only test-sting makes new ones',
      );
    }
    expect(pieces).toHaveLength(2);
    expect(readManifest(places, 'music')[STING.id]).toEqual(manifestOf(OLDER));
    const old = readFileSync(join(places.dirs.music, 'test-sting.mp3'));
    expect(digest(old)).toBe(digest(piece(10, 0.5)));
    await runOver(['--candidates', '2', '--only', 'test-sting'], studio);
    expect(readTakes(places.takes, STING.id)?.takes.map((take) => take.n)).toEqual([1, 2, 3, 4]);
  });

  it('plans a piece whose takes wait to be left, and measures it not anew', () => {
    const made = { sfx: {}, music: { [CALM.id]: { ...manifestOf(CALM), hash: hashOf(OLDER) } } };
    const waits = (id: string): boolean => id === CALM.id;
    const always = (): boolean => true;
    const once = planOf([CLACK, CALM], made, always, optionsOf([]), waits);
    expect(once.map((job) => [job.entry.id, job.make, job.waiting])).toEqual([
      ['test-clack', true, false],
      ['test-calm', false, true],
    ]);
    expect(measuredAnew(once, 1).map((job) => job.entry.id)).toEqual(['test-clack']);
    const takes = planOf([CALM], made, always, optionsOf(['--candidates', '3']), waits);
    expect(takes.map((job) => [job.make, job.waiting])).toEqual([[true, false]]);
    // A piece made from the request as it stands is not due: nothing waits for it.
    const current = { sfx: {}, music: { [CALM.id]: manifestOf(CALM) } };
    const fresh = planOf([CALM], current, always, optionsOf([]), waits);
    expect(fresh.map((job) => [job.make, job.waiting])).toEqual([[false, false]]);
  });

  it('names what makes a recording again: a command for each group, in the catalog’s order', () => {
    expect(remakeCommands([CLACK, CALM, STING], ['test-sting', 'test-clack', 'nope'])).toEqual([
      'pnpm --filter client sfx -- --candidates 5 --only test-clack',
      'pnpm --filter client sfx -- --candidates 3 --only test-sting',
    ]);
    expect(remakeCommands([CLACK, CALM], [])).toEqual([]);
  });
});

/** The facility's hum as a test asks for it: a bed of 10 s. */
const HUM: CatalogEntry = {
  id: 'test-hum',
  kind: 'bed',
  prompt: 'Room tone of a large research facility at night: distant transformers and ventilation.',
  durationSeconds: 10,
  loop: true,
  target: { measure: 'rms', dbfs: -20 },
  usedBy: ['src/world/menuSound.ts#HUM'],
};

/** Runs `items` through `bench`, `count` takes each; returns what it said on the error stream. */
async function refusedIn(items: readonly CatalogEntry[], count: number, bench: Bench) {
  const exit = process.exitCode;
  const said: string[] = [];
  const keep = (line: string): void => void said.push(line);
  const error = vi.spyOn(console, 'error').mockImplementation(keep);
  try {
    const manifests = await runOf(items, count, bench);
    return { manifests, said, failed: process.exitCode === 1 };
  } finally {
    error.mockRestore();
    process.exitCode = exit;
  }
}

describe('a bed too quiet to bring up', () => {
  it('is refused in one line where every take needs over +12 dB, landing nowhere', async () => {
    expect(MAX_BED_GAIN_DB).toBe(12);
    const places = placesIn();
    // A tone at 0.004: −51 dBFS RMS, some +31 dB short of a bed's −20.
    const { client } = answering({ effects: [piece(10, 0.004)] });
    const { manifests, said, failed } = await refusedIn([HUM], 1, benchOf(client, places));
    expect(said).toEqual([
      'sfx: test-hum — a bed may be brought up 12 dB and every take needs more (the least ' +
        '+31.0 dB): it came back near silent, none kept; make it again: ' +
        '--candidates 5 --only test-hum',
    ]);
    expect(failed).toBe(true);
    expect(manifests.sfx).toEqual({});
    expect(readdirSync(places.dirs.sfx)).toEqual([]); // no file, no part of one
  });

  it('keeps of its candidates one within +12 dB, however loud the others', async () => {
    const places = placesIn();
    const takes = [piece(10, 0.004), piece(10, 0.05), piece(10, 0.003)];
    const { client } = answering({ effects: takes });
    const { manifests, said } = await refusedIn([HUM], 3, benchOf(client, places));
    expect(said).toEqual([]);
    expect(manifests.sfx[HUM.id]).toMatchObject({ influence: 0.6 }); // the 0.05 one: +9 dB
    expect(manifests.sfx[HUM.id]?.gain).toBeCloseTo(0.1 / (0.05 / Math.SQRT2), 2);
    expect(readdirSync(places.dirs.sfx).sort()).toEqual(['manifest.json', 'test-hum.mp3']);
  });

  it('holds a bed alone to it: a one-shot is brought up as far as it needs', async () => {
    const places = placesIn();
    const { client } = answering({ effects: [piece(0.6, 0.07)] }); // a peak +20 dB short
    const { manifests, said } = await refusedIn([CLACK], 1, benchOf(client, places));
    expect(said).toEqual([]);
    expect(manifests.sfx[CLACK.id]?.gain).toBeCloseTo(10 ** (-3 / 20) / 0.07, 2);
  });
});
