import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@escapelab/core';
import { voiced } from '../src/radio.js';
import {
  BAND_HIGH,
  BAND_LOW,
  KEY_LEVEL,
  KEY_S,
  NOISE_BED,
  OPEN_S,
  radioChain,
  SHAPER_DRIVE,
  shaperCurve,
  SPEECH_PEAK,
  TAIL_S,
  type VoiceLine,
  type VoiceManifest,
} from '../src/world/radioVoice.js';
import {
  chainFrom,
  endAll,
  fakeGraph,
  FakeContext,
  lastContext,
  type FakeBufferSource,
  type FakeFilter,
  type FakeGain,
  type FakeNode,
  type FakeShaper,
} from './fakeGraph.js';
import { serveSamples } from './fakeSamples.js';

/** A line as Helmut says it, the operator on duty these tests hear. */
const helmut = (text: string): VoiceLine => ({ text, person: 'helmut' });
const LEVER_LINE = helmut(
  'Notlicht steht, danke. Jetzt der Notstrom: Die Anleitung dafür hängt im Archiv, der ' +
    'Kasten ist im Maschinenraum, das Prüfpult im Flur.',
);
const START_LINE = helmut('Leitstelle an Nachtschicht. Stromausfall im ganzen Trakt.');
const BEIDE = helmut('Beide hin.');
/** Two more lines of the run, for the files a page keeps (FILES_KEPT). */
const FOURTH = helmut('Der Kasten steht im Maschinenraum.');
const FIFTH = helmut('Die Pulte stehen im Flur.');
/** What every one of Helmut's recordings here is: the Leitstelle's, in Blackout. */
const HIS = { missions: ['blackout'], role: 'operator', person: 'helmut' } as const;
const MANIFEST: VoiceManifest = {
  lines: {
    // A file a person put on the /record page, an MP3: the radio plays whatever the entry names.
    aaaaaaaaaaaa: {
      ...HIS,
      text: LEVER_LINE.text,
      ms: 2000,
      moment: 'solved',
      source: 'upload',
      file: 'aaaaaaaaaaaa.mp3',
    },
    bbbbbbbbbbbb: {
      ...HIS,
      text: BEIDE.text,
      ms: 900,
      missions: ['systemcheck'],
      moment: 'nudge',
      file: 'bbbbbbbbbbbb.m4a',
    },
    cccccccccccc: {
      ...HIS,
      text: START_LINE.text,
      ms: 2500,
      moment: 'start',
      opens: true,
      file: 'cccccccccccc.m4a',
    },
    ffffffffffff: {
      ...HIS,
      text: FOURTH.text,
      ms: 2000,
      moment: 'nudge',
      file: 'ffffffffffff.m4a',
    },
    abcdefabcdef: { ...HIS, text: FIFTH.text, ms: 1800, moment: 'nudge', file: 'abcdefabcdef.m4a' },
    // The lever's line as Marta says it, on the nights she has the desk: a recording of her own.
    'marta-aaaa': {
      ...HIS,
      person: 'marta',
      text: LEVER_LINE.text,
      ms: 2200,
      moment: 'solved',
      file: 'marta-aaaa.mp3',
    },
  },
};

/** The share of a sine at `peak` that the shaper turns into its harmonics (THD), 0–1. */
function distortionAt(peak: number): number {
  const curve = shaperCurve(4097);
  const n = 4096;
  const out = Array.from({ length: n }, (_, i) => {
    const x = peak * Math.sin((2 * Math.PI * i) / n);
    return curve[Math.round(((x + 1) / 2) * 4096)] ?? 0;
  });
  const harmonic = (k: number): number => {
    const phase = (i: number): number => (2 * Math.PI * k * i) / n;
    const sin = out.reduce((sum, y, i) => sum + y * Math.sin(phase(i)), 0);
    const cos = out.reduce((sum, y, i) => sum + y * Math.cos(phase(i)), 0);
    return Math.hypot(sin, cos);
  };
  return Math.hypot(...[2, 3, 4, 5, 6, 7, 8, 9].map(harmonic)) / harmonic(1);
}

describe('the radio’s chain', () => {
  it('runs high-pass 300 Hz, low-pass 3.4 kHz, each fourth order, and a light shaper', () => {
    const ctx = new FakeContext();
    const into = ctx.destination as unknown as AudioNode;
    const chain = radioChain(ctx as unknown as BaseAudioContext, into, 0.5);
    const nodes = chainFrom(chain.input as unknown as FakeNode);
    expect(nodes.map((node) => node.kind)).toEqual([
      'gain',
      'biquad',
      'biquad',
      'biquad',
      'biquad',
      'shaper',
      'gain',
      'destination',
    ]);
    const filters = nodes.slice(1, 5) as FakeFilter[];
    expect(filters.map((f) => [f.type, f.frequency.value])).toEqual([
      ['highpass', BAND_LOW],
      ['highpass', BAND_LOW],
      ['lowpass', BAND_HIGH],
      ['lowpass', BAND_HIGH],
    ]);
    // Web Audio takes a high- or low-pass's Q in dB: the Butterworth pair, 0.5412 and 1.3066.
    const qs = filters.map((f) => 10 ** (f.Q.value / 20));
    expect(qs).toEqual([0.5412, 1.3066, 0.5412, 1.3066].map((q) => expect.closeTo(q, 9)));
    expect((nodes[5] as FakeShaper).oversample).toBe('2x');
    expect((nodes[6] as FakeGain).gain.value).toBe(0.5);
  });

  it('bends gently: odd, rising, full scale at the ends and rounded towards them', () => {
    const curve = shaperCurve(1025);
    expect(curve[0]).toBeCloseTo(-1, 6);
    expect(curve[1024]).toBeCloseTo(1, 6);
    expect(curve[512]).toBeCloseTo(0, 6);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i] ?? 0).toBeGreaterThan(curve[i - 1] ?? 0);
      expect(curve[i] ?? 0).toBeCloseTo(-(curve[1024 - i] ?? 0), 6);
    }
    const half = curve[768] ?? 0; // x = 0.5
    expect(half).toBeCloseTo(Math.tanh(SHAPER_DRIVE / 2) / Math.tanh(SHAPER_DRIVE), 4);
    expect(half).toBeGreaterThan(0.5); // it lifts the quiet parts…
    expect(half).toBeLessThan(0.9); // …but does not square them off
  });

  it('bends lightly, so that consonants stay clear: under 10 % distortion at the speech peak', () => {
    expect(SHAPER_DRIVE).toBe(1.2);
    expect(SPEECH_PEAK).toBe(0.9);
    const thd = distortionAt(SPEECH_PEAK);
    expect(thd).toBeLessThan(0.1);
    expect(thd).toBeGreaterThan(0.05); // still a handset, not a studio
    // The quiet parts come up 3 dB against the peaks, no more.
    const slope = SHAPER_DRIVE / Math.tanh(SHAPER_DRIVE);
    expect(20 * Math.log10(slope)).toBeCloseTo(3.2, 1);
  });

  it('lays the static 33 dB under the speech', () => {
    expect(20 * Math.log10(NOISE_BED)).toBeCloseTo(-33, 9);
  });

  it('voices mission control’s lines, never a note of the last shift', () => {
    const line = (kind: RunEvent['kind']): RunEvent => ({ at: 0, kind, label: 'x', seconds: null });
    expect(voiced(line('radio'))).toBe(true);
    expect(voiced(line('hint'))).toBe(false);
  });
});

describe('a line spoken over the radio', () => {
  let fetched: string[] = [];

  beforeEach(() => {
    fakeGraph();
    fetched = [];
    // The squelches' recordings as the samples serve them; mission control's lines as here.
    serveSamples({}, (url: string) => {
      fetched.push(url);
      const json = (): Promise<VoiceManifest> => Promise.resolve(MANIFEST);
      const arrayBuffer = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(8));
      return Promise.resolve({ ok: true, status: 200, json, arrayBuffer });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function voice() {
    vi.resetModules();
    await (await import('../src/world/samples.js')).preloadSamples();
    return import('../src/world/radioVoice.js');
  }

  /** The recordings of `id` played on `ctx`, by when they start. */
  const keysOf = (ctx: ReturnType<typeof lastContext>, id: string): number[] =>
    ctx
      .all<FakeBufferSource>('buffer')
      .filter((s) => s.buffer?.tag === id)
      .map((s) => s.startedAt as number);

  /** Lets the fetches and the decoding settle. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /** The ducks of the engine the radio plays on (mix.ts). */
  async function ducks(): Promise<{ musicDuck: FakeGain; ambienceDuck: FakeGain }> {
    const engine = (await import('../src/world/audio.js')).audioEngine();
    return engine as unknown as { musicDuck: FakeGain; ambienceDuck: FakeGain };
  }

  it('fetches the list as a run starts, a line’s file as it queues, decoded on air', async () => {
    const radio = await voice();
    const { decodedBytes } = await import('../src/world/audioMemory.js');
    radio.voiceForRun();
    await settle();
    expect(fetched).toEqual(['/voice/manifest.json']);
    expect(decodedBytes().voice).toBe(0);
    // The run's first line queued: its file alone, and nothing decoded yet.
    radio.fetchLines([START_LINE]);
    await settle();
    expect(fetched).toEqual(['/voice/manifest.json', '/voice/cccccccccccc.m4a']);
    expect(radio.clipOf(START_LINE)).toBeNull();
    expect(decodedBytes().voice).toBe(0);
    // On the air it is decoded, from the file here: one channel at 22.05 kHz, the fake's 1.5 s.
    await radio.sayLine(START_LINE);
    expect(fetched).toHaveLength(2);
    expect(radio.VOICE_RATE).toBe(22050);
    expect(decodedBytes().voice).toBe(1.5 * 22050 * 4);
    radio.fetchLines([BEIDE, helmut('Etwas ohne Aufnahme.')]);
    await settle();
    expect(fetched.at(-1)).toBe('/voice/bbbbbbbbbbbb.m4a');
    expect(fetched).toHaveLength(3);
    expect(radio.clipOf(BEIDE)).toBeNull(); // queued: fetched, not decoded
    expect(radio.clipOf(LEVER_LINE)).toBeNull(); // never queued: never fetched
  });

  it('finds a line by who says it and its words: the same words in two voices, two', async () => {
    const radio = await voice();
    radio.voiceForRun();
    await settle();
    const hers = { text: LEVER_LINE.text, person: 'marta' };
    radio.fetchLines([hers]);
    await settle();
    expect(fetched).toEqual(['/voice/manifest.json', '/voice/marta-aaaa.mp3']);
    expect(radio.recordedMs(hers)).toBe(2200);
    expect(radio.recordedMs(LEVER_LINE)).toBe(2000);
    expect(await radio.sayLine(hers)).not.toBeNull();
    expect(radio.voiceProbe().lastId).toBe('marta-aaaa');
    expect(await radio.sayLine(LEVER_LINE)).not.toBeNull();
    expect(radio.voiceProbe().lastId).toBe('aaaaaaaaaaaa');
    // Nobody else's recording stands in for a voice that has none: the caller chirps.
    const his = { text: LEVER_LINE.text, person: 'jonas' };
    expect([radio.recordedMs(his), radio.airtimeMs(his), await radio.sayLine(his)]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('keeps the files of the last few lines, as they came, and none of a run before', async () => {
    const radio = await voice();
    radio.voiceForRun();
    await settle();
    const lines = [LEVER_LINE, BEIDE, START_LINE];
    const again = async (line: VoiceLine): Promise<string[]> => {
      const before = fetched.length;
      radio.fetchLines([line]);
      await settle();
      return fetched.slice(before);
    };
    radio.fetchLines(lines);
    await settle();
    // Queued again within the run: its file is here still, nothing fetched.
    expect(await again(LEVER_LINE)).toEqual([]);
    // Two more lines: past FILES_KEPT the oldest file goes, the one asked for again lately stays.
    expect(radio.FILES_KEPT).toBe(4);
    radio.fetchLines([FOURTH, FIFTH]);
    await settle();
    expect(await again(BEIDE)).toEqual(['/voice/bbbbbbbbbbbb.m4a']);
    expect(await again(FIFTH)).toEqual([]);
    // A new run lets the files of the last one go.
    radio.voiceForRun();
    await settle();
    expect(await again(FIFTH)).toEqual(['/voice/abcdefabcdef.m4a']);
  });

  it('speaks a recorded line through the chain: squelch, speech over static, tail', async () => {
    const radio = await voice();
    radio.voiceForRun();
    await settle();
    // Decoded as it comes over the air: on it, it tells how long it keeps the air.
    expect(await radio.sayLine(LEVER_LINE)).toBe(Math.round((KEY_S + 1.5 + TAIL_S) * 1000));
    const ctx = lastContext();
    const sources = ctx.all<FakeBufferSource>('buffer');
    const speech = sources.find((s) => s.buffer?.duration === 1.5);
    expect(speech?.startedAt).toBeCloseTo(10.08, 9); // after the key's squelch
    const normal = speech?.outputs[0] as FakeGain;
    expect(normal.gain.value).toBeCloseTo(0.9 / 0.45, 6); // the recording’s peak at 0.9
    const chain = chainFrom(normal.outputs[0] as FakeNode).map((node) => node.kind);
    expect(chain).toEqual([
      'gain',
      'biquad',
      'biquad',
      'biquad',
      'biquad',
      'shaper',
      'gain', // the voice's level
      'gain', // the radio's bus, at the Funk volume
      'gain', // the master gain
      'compressor', // the brickwall
      'gain', // its makeup taken back
      'destination',
    ]);
    const bed = sources.find((s) => s.loop);
    expect((bed?.outputs[0] as FakeGain).gain.value).toBe(NOISE_BED);
    expect(bed?.startedAt).toBeCloseTo(10.08, 9);
    expect(bed?.stoppedAt).toBeCloseTo(11.58, 9);
    expect(keysOf(ctx, 'radio-key')).toEqual([expect.closeTo(10.01, 9)]); // keyed up
    expect(keysOf(ctx, 'radio-tail')).toEqual([expect.closeTo(11.6, 9)]); // and down
    const key = sources.find((s) => s.buffer?.tag === 'radio-key');
    const keys = key?.outputs[0] as FakeGain;
    expect(keys.gain.value).toBe(KEY_LEVEL); // into the chain, under the speech's peak
    expect(keys.outputs[0]).toBe(normal.outputs[0]);
    expect(20 * Math.log10((KEY_LEVEL * 10 ** (-3 / 20)) / SPEECH_PEAK)).toBeCloseTo(-5.8, 1);
  });

  it('pulls the music 8 dB and the beds 4 dB down while it speaks, and reports it', async () => {
    const radio = await voice();
    radio.voiceForRun();
    await settle();
    await radio.sayLine(LEVER_LINE);
    const ctx = lastContext();
    const { musicDuck, ambienceDuck } = await ducks();
    const music = 10 ** (-8 / 20);
    expect(musicDuck.gain.ramps()).toEqual([
      [1, expect.closeTo(10.08, 9)], // as the speech starts…
      [expect.closeTo(music, 9), expect.closeTo(10.13, 9)], // …down in 50 ms…
      [expect.closeTo(music, 9), expect.closeTo(11.58, 9)], // …until it ends…
      [1, expect.closeTo(11.98, 9)], // …and back in 400 ms
    ]);
    expect(ambienceDuck.gain.ramps()[1]).toEqual([
      expect.closeTo(10 ** (-4 / 20), 9),
      expect.closeTo(10.13, 9),
    ]);
    ctx.currentTime = 10.05;
    expect(radio.voiceProbe()).toEqual({ playing: false, lastId: 'aaaaaaaaaaaa', opened: false });
    ctx.currentTime = 11;
    expect(radio.voiceProbe()).toEqual({ playing: true, lastId: 'aaaaaaaaaaaa', opened: false });
    ctx.currentTime = 11.6;
    expect(radio.voiceProbe().playing).toBe(false);
  });

  it('opens the run’s first line with the Leitstelle’s squelch, and no other line', async () => {
    const radio = await voice();
    radio.voiceForRun();
    radio.preloadLines([START_LINE]);
    await settle();
    // Decoded already: on the air at once, the opening counted in its airtime.
    const said = radio.sayLine(START_LINE);
    const ctx = lastContext();
    const sources = ctx.all<FakeBufferSource>('buffer');
    const speech = sources.find((s) => s.buffer?.duration === 1.5);
    expect(await said).toBe(Math.round((OPEN_S + KEY_S + 1.5 + TAIL_S) * 1000));
    // Keyed at 10.01: the opening, then the key's squelch, then the voice.
    expect(speech?.startedAt).toBeCloseTo(10.01 + OPEN_S + KEY_S, 9);
    // The opening's recording from the start — static swelling, snapping shut — then the key.
    expect(keysOf(ctx, 'radio-open')).toEqual([expect.closeTo(10.01, 9)]);
    expect(keysOf(ctx, 'radio-key')).toEqual([expect.closeTo(10.01 + OPEN_S, 9)]);
    const { musicDuck } = await ducks();
    // Pulled down as the Leitstelle opens the channel, not as the voice comes in.
    expect(musicDuck.gain.ramps()[1]).toEqual([expect.closeTo(10 ** (-8 / 20), 9), 10.06]);
    expect(radio.voiceProbe()).toMatchObject({ lastId: 'cccccccccccc', opened: true });
    ctx.currentTime = 10.45; // the opening plays, the voice has not begun
    expect(radio.voiceProbe().playing).toBe(false);
    ctx.currentTime = 11;
    expect(await radio.sayLine(LEVER_LINE)).toBe(Math.round((KEY_S + 1.5 + TAIL_S) * 1000));
    expect(radio.voiceProbe()).toMatchObject({ lastId: 'aaaaaaaaaaaa', opened: false });
    const lever = ctx.all<FakeBufferSource>('buffer').filter((s) => s.buffer?.duration === 1.5);
    expect(lever.at(-1)?.startedAt).toBeCloseTo(11.01 + KEY_S, 9);
  });

  it('tells how long a line keeps the air: the opening, the key, the recording, the tail', async () => {
    const radio = await voice();
    expect(radio.airtimeMs(LEVER_LINE)).toBeNull(); // no manifest yet
    radio.voiceForRun();
    await settle();
    // Not decoded yet: by the manifest's 2 s; decoded, by its recording's 1.5 s.
    expect(radio.airtimeMs(LEVER_LINE)).toBe(Math.round((KEY_S + 2 + TAIL_S) * 1000));
    radio.preloadLines([LEVER_LINE, START_LINE]);
    await settle();
    expect(radio.airtimeMs(LEVER_LINE)).toBe(Math.round((KEY_S + 1.5 + TAIL_S) * 1000));
    expect(radio.airtimeMs(START_LINE)).toBe(Math.round((OPEN_S + KEY_S + 1.5 + TAIL_S) * 1000));
    expect(radio.airtimeMs(START_LINE)).toBe(2130);
    expect(radio.airtimeMs(helmut('Eine Zeile aus dem Editor.'))).toBeNull();
  });

  it('cuts a line short for a newer one, leaves one without a recording to the chirp', async () => {
    const radio = await voice();
    radio.voiceForRun();
    await settle();
    await radio.sayLine(LEVER_LINE);
    const ctx = lastContext();
    ctx.currentTime = 11;
    expect(await radio.sayLine(BEIDE)).not.toBeNull();
    const clips = ctx.all<FakeBufferSource>('buffer').filter((s) => s.buffer?.duration === 1.5);
    const [first, second] = clips;
    expect(first?.stoppedAt).toBeCloseTo(11.1, 9);
    expect(second?.startedAt).toBeCloseTo(11.08, 9);
    expect(radio.voiceProbe().lastId).toBe('bbbbbbbbbbbb');
    expect(await radio.sayLine(helmut('Eine Zeile aus dem Editor.'))).toBeNull();
  });

  it('speaks only the newest of two lines asked for while the first still decoded', async () => {
    const radio = await voice();
    radio.voiceForRun();
    await settle();
    const first = radio.sayLine(LEVER_LINE);
    const second = radio.sayLine(BEIDE); // before the first is decoded
    expect(await first).toBeNull(); // made moot: it never goes on the air…
    expect(radio.clipOf(LEVER_LINE)).toBeNull(); // …and what it decoded is let go
    expect(await second).toBe(Math.round((KEY_S + 1.5 + TAIL_S) * 1000));
    const speech = (): FakeBufferSource[] =>
      lastContext()
        .all<FakeBufferSource>('buffer')
        .filter((s) => s.buffer?.duration === 1.5);
    expect(speech()).toHaveLength(1);
    expect(radio.voiceProbe().lastId).toBe('bbbbbbbbbbbb');
    // The same line asked for twice while it decodes goes on the air once, for the newer ask,
    // which keeps what the older decoded.
    const asks = [radio.sayLine(FOURTH), radio.sayLine(FOURTH)];
    expect(await Promise.all(asks)).toEqual([null, Math.round((KEY_S + 1.5 + TAIL_S) * 1000)]);
    expect(speech()).toHaveLength(2);
    expect(radio.clipOf(FOURTH)).not.toBeNull();
  });

  it('lets go of a line still decoding as the voice stops: nothing airs after', async () => {
    const radio = await voice();
    const { decodedBytes } = await import('../src/world/audioMemory.js');
    radio.voiceForRun();
    await settle();
    const saying = radio.sayLine(LEVER_LINE); // not decoded yet
    radio.stopVoice(); // the screen goes before it is
    expect(await saying).toBeNull();
    await settle();
    const clips = lastContext()
      .all<FakeBufferSource>('buffer')
      .filter((s) => s.buffer?.duration === 1.5);
    expect(clips).toEqual([]);
    expect(radio.voiceProbe().lastId).toBeNull();
    expect(decodedBytes().voice).toBe(0); // nothing of it kept
  });

  it('lets a line go once its sound has ended, however late, and decodes it anew', async () => {
    vi.useFakeTimers();
    try {
      const radio = await voice();
      const { decodedBytes } = await import('../src/world/audioMemory.js');
      radio.voiceForRun();
      await vi.advanceTimersByTimeAsync(0);
      void radio.sayLine(LEVER_LINE);
      await vi.advanceTimersByTimeAsync(0);
      const ctx = lastContext();
      expect(radio.clipOf(LEVER_LINE)).not.toBeNull();
      // A context held back while it speaks: long past its end by the page's clock, it has not
      // been heard yet, and stays.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(radio.clipOf(LEVER_LINE)).not.toBeNull();
      // Its speech, static and squelches play out: it is let go, and nothing else stays.
      endAll(ctx);
      expect(radio.clipOf(LEVER_LINE)).toBeNull();
      expect(decodedBytes().voice).toBe(0);
      const again = radio.sayLine(LEVER_LINE); // its file still here
      await vi.advanceTimersByTimeAsync(0);
      expect(await again).not.toBeNull();
      expect(radio.voiceProbe()).toMatchObject({ lastId: 'aaaaaaaaaaaa' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a line cut short go as its sound ends, not while it is on the air again', async () => {
    const radio = await voice();
    radio.voiceForRun();
    await settle();
    await radio.sayLine(LEVER_LINE);
    const ctx = lastContext();
    const firstTime = ctx.all<FakeBufferSource>('buffer').filter((s) => s.startedAt !== null);
    // Asked again, it cuts its first airing short; that airing's sound ends, the second speaks on.
    await radio.sayLine(LEVER_LINE);
    for (const source of firstTime) source.end();
    expect(radio.clipOf(LEVER_LINE)).not.toBeNull();
    // A newer line cuts the second short: as its sound ends it goes, and the newer once said.
    await radio.sayLine(BEIDE);
    endAll(ctx);
    expect(radio.clipOf(LEVER_LINE)).toBeNull();
    expect(radio.clipOf(BEIDE)).toBeNull();
  });

  it('says nothing before a gesture woke the sound, nor anything not loaded', async () => {
    const radio = await voice();
    expect(await radio.sayLine(LEVER_LINE)).toBeNull(); // no manifest yet
    radio.voiceForRun();
    await settle();
    lastContext().state = 'suspended';
    expect(await radio.sayLine(LEVER_LINE)).toBeNull();
    expect(radio.voiceProbe()).toEqual({ playing: false, lastId: null, opened: false });
  });

  /** An offline context that renders a quarter of full scale, `length` samples long. */
  class Offline extends FakeContext {
    constructor(
      readonly channels: number,
      readonly length: number,
      rate: number,
    ) {
      super();
      this.sampleRate = rate;
    }
    startRendering(): Promise<{ getChannelData: () => Float32Array }> {
      const out = new Float32Array(this.length).fill(0.25);
      return Promise.resolve({ getChannelData: () => out });
    }
  }

  it('renders a recorded line through the chain offline, its peak where a line goes in', async () => {
    vi.stubGlobal('OfflineAudioContext', Offline);
    const radio = await voice();
    const render = await radio.renderRadio('aaaaaaaaaaaa');
    expect(fetched).toEqual(['/voice/manifest.json', '/voice/aaaaaaaaaaaa.mp3']);
    await expect(radio.renderRadio('dddddddddddd')).rejects.toThrow(/not in the manifest/);
    // The fake decodes any recording to 1.5 s at the render's 44.1 kHz, its peak 0.45.
    expect(render.input).toHaveLength(66150);
    expect(Math.max(...render.input.map(Math.abs))).toBeCloseTo(SPEECH_PEAK, 6);
    expect(render.output).toHaveLength(66150);
    const chainKinds = chainFrom(lastContext().all<FakeBufferSource>('buffer')[0] as FakeNode);
    expect(chainKinds.map((node) => node.kind)).toEqual([
      'buffer',
      'gain',
      'biquad',
      'biquad',
      'biquad',
      'biquad',
      'shaper',
      'gain',
      'destination',
    ]);
  });

  it('renders the chain offline on white noise, for the harness to measure', async () => {
    vi.stubGlobal('OfflineAudioContext', Offline);
    const radio = await voice();
    const render = await radio.renderRadio();
    expect(render.rate).toBe(44100);
    expect(render.input).toHaveLength(32768);
    expect(render.output).toHaveLength(32768);
    expect(Math.max(...render.input.map(Math.abs))).toBeLessThanOrEqual(0.5);
    const offline = lastContext();
    const noise = offline.all<FakeBufferSource>('buffer')[0];
    expect(chainFrom(noise as FakeNode).map((node) => node.kind)).toEqual([
      'buffer',
      'gain',
      'biquad',
      'biquad',
      'biquad',
      'biquad',
      'shaper',
      'gain',
      'destination',
    ]);
  });
});

describe('the lines that may open a run', () => {
  /** Blackout opens on one of two starts, each recorded: the run picks one (core `pickLine`). */
  const OTHER_START = helmut('Leitstelle an Nachtschicht. Der Trakt ist dunkel.');
  const OPENERS: VoiceManifest = {
    lines: {
      ...MANIFEST.lines,
      dddddddddddd: {
        ...HIS,
        text: OTHER_START.text,
        ms: 2000,
        moment: 'start',
        opens: true,
        file: 'dddddddddddd.mp3',
      },
    },
  };

  /** The voice's files the page asked for, in order. */
  let asked: string[] = [];

  beforeEach(() => {
    fakeGraph();
    asked = [];
    serveSamples({}, (url: string) => {
      asked.push(url);
      const json = (): Promise<VoiceManifest> => Promise.resolve(OPENERS);
      const arrayBuffer = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(8));
      return Promise.resolve({ ok: true, status: 200, json, arrayBuffer });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('come as any line does: the take the run picked, fetched as it queues, no other', async () => {
    vi.resetModules();
    await (await import('../src/world/samples.js')).preloadSamples();
    const radio = await import('../src/world/radioVoice.js');
    const { decodedBytes } = await import('../src/world/audioMemory.js');
    radio.voiceForRun();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toEqual(['/voice/manifest.json']);
    expect(decodedBytes().voice).toBe(0);
    // The run picked the other take: its event names it, and only its file comes.
    radio.fetchLines([OTHER_START]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toEqual(['/voice/manifest.json', '/voice/dddddddddddd.mp3']);
    expect(await radio.sayLine(OTHER_START)).toBe(
      Math.round((OPEN_S + KEY_S + 1.5 + TAIL_S) * 1000),
    );
    expect(radio.clipOf(START_LINE)).toBeNull();
    expect(decodedBytes().voice).toBe(1.5 * 22050 * 4);
    expect(radio.voiceProbe()).toMatchObject({ lastId: 'dddddddddddd', opened: true });
  });
});
