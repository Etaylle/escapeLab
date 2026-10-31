import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPS, EFFECTS_LEVEL } from '../src/world/audio.js';
import { STEER_MAX } from '../src/world/audioStream.js';
import { RETRY_MS } from '../src/world/samples.js';
import {
  ALARM_HOLD_MS,
  barOf,
  BEATS_PER_BAR,
  clockTension,
  CROSSFADE_S,
  layersFor,
  MUSIC_LEVEL,
  nextBar,
  passPeriod,
  pressureOf,
  SEAM_LEAD_BARS,
  SEAM_S,
  stemFor,
  STING_LEVEL,
  type Layers,
  type Tension,
} from '../src/world/music.js';
import {
  fakeGraph,
  lastContext,
  type FakeBufferSource,
  type FakeContext,
  type FakeFilter,
  type FakeGain,
  type FakeNode,
  type FakeParam,
} from './fakeGraph.js';
import { elements, fakeMedia, type FakeAudio } from './fakeMedia.js';
import { loadedSamples, serveSamples, type Served } from './fakeSamples.js';

const NONE: Layers = { calm: false, pressure: false, last: false };
const BAR = barOf(90);

describe('the pressure the music follows', () => {
  it('keeps the lab’s tension curve: nothing in the first half, then up to 1', () => {
    expect(clockTension(660, 660)).toBe(0);
    expect(clockTension(330, 660)).toBe(0);
    expect(clockTension(165, 660)).toBe(0.5);
    expect(clockTension(0, 660)).toBe(1);
    expect(clockTension(-3, 660)).toBe(1);
  });

  it('is at least 0.8 in the last minute and in the escape, and rises with every alarm', () => {
    const calm = { left: 600, budget: 660, alarms: 0, escaping: false };
    expect(pressureOf(calm)).toBe(0);
    expect(pressureOf({ ...calm, left: 61, budget: 420 })).toBeCloseTo(1 - 61 / 210, 9);
    expect(pressureOf({ ...calm, left: 59, budget: 420 })).toBeCloseTo(0.8 + 0.2 / 60, 9);
    expect(pressureOf({ ...calm, left: 0, budget: 420 })).toBe(1);
    expect(pressureOf({ ...calm, escaping: true })).toBe(0.8);
    expect(pressureOf({ ...calm, alarms: 2 })).toBeCloseTo(0.3, 9);
    expect(pressureOf({ ...calm, alarms: 2, escaping: true })).toBe(1);
  });

  it('brings a layer in at its threshold and lets it go only a little under it', () => {
    expect(layersFor(0.34, false, NONE)).toEqual({ calm: true, pressure: false, last: false });
    const under = layersFor(0.35, false, NONE);
    expect(under).toEqual({ calm: true, pressure: true, last: false });
    expect(layersFor(0.31, false, under).pressure).toBe(true);
    expect(layersFor(0.29, false, under).pressure).toBe(false);
    const last = layersFor(0.8, false, under);
    expect(last.last).toBe(true);
    expect(layersFor(0.76, false, last).last).toBe(true);
    expect(layersFor(0.74, false, last).last).toBe(false);
    expect(layersFor(0.9, true, last)).toEqual({ calm: false, pressure: true, last: true });
  });

  it('plays the calm stem, the tense under pressure, the critical in the last minute', () => {
    expect(stemFor(layersFor(0.1, false, NONE))).toBe('calm');
    expect(stemFor(layersFor(0.5, false, NONE))).toBe('tense');
    expect(stemFor(layersFor(0.85, false, NONE))).toBe('critical');
    expect(stemFor(layersFor(0.8, true, NONE))).toBe('critical'); // the escape
  });

  it('counts in bars of four beats from where the music started', () => {
    expect(BEATS_PER_BAR).toBe(4);
    expect(BAR).toBeCloseTo(8 / 3, 12); // four beats at 90 bpm
    const grid = { origin: 10, bpm: 90 };
    expect(nextBar(9, grid)).toBe(10);
    expect(nextBar(10, grid)).toBe(10);
    expect(nextBar(10.1, grid)).toBeCloseTo(10 + BAR, 9);
    expect(nextBar(10 + 2 * BAR - 1e-12, grid)).toBeCloseTo(10 + 2 * BAR, 9);
    expect(CROSSFADE_S).toBe(2);
  });

  it('starts each next pass on a bar, leaving room for its lead bar and the seam', () => {
    expect(passPeriod(72.046, 90)).toBeCloseTo(24 * BAR, 9); // 64 s: 25 bars fit, one leads
    for (let seconds = 20; seconds <= 120; seconds += 0.7) {
      const period = passPeriod(seconds, 90);
      const bars = period / BAR;
      expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-9);
      expect(period + SEAM_LEAD_BARS * BAR + SEAM_S).toBeLessThanOrEqual(seconds + 1e-9);
      expect(period + 2 * BAR + SEAM_S).toBeGreaterThan(seconds);
    }
  });
});

/** The last linear ramp on `param`, with the time the one before it set out from. */
function lastFade(param: FakeParam): { start: number; end: number; to: number } {
  const events = param.events.filter((e) => e[0] === 'set' || e[0] === 'linear');
  const end = events.at(-1);
  const start = events.at(-2);
  return { start: start?.[2] as number, end: end?.[2] as number, to: end?.[1] as number };
}

/** The curve scheduled on `param`: its values, from when, for how long. */
function curveOn(param: FakeParam): { values: number[]; at: number; seconds: number } | null {
  const curve = param.events.find((e) => e[0] === 'curve');
  if (curve === undefined) return null;
  return { values: [...(curve[1] as Float32Array)], at: curve[2] as number, seconds: curve[3] };
}

describe('the music as it plays', () => {
  /** The blob addresses the stems' files get, in the order they are fetched. */
  let blobs: string[] = [];
  let fetched: string[] = [];

  beforeEach(() => {
    fakeGraph();
    fakeMedia();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    blobs = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      blobs.push(`blob:stem-${blobs.length}`);
      return blobs.at(-1) as string;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function music(served: Readonly<Record<string, Served>> = {}) {
    vi.resetModules();
    await loadedSamples(served);
    fetched = serveSamples(served);
    const module = await import('../src/world/music.js');
    const audio = await import('../src/world/audio.js');
    return { ...module, inUse: audio.inUse, claim: audio.claim, release: audio.release };
  }

  /** Lets the stems' files come in: their fetches and their blobs. */
  const fetchIn = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };

  const tension = (over: Partial<Tension> = {}): Tension => ({
    run: 1,
    startAt: Date.now() - 1000,
    left: 600,
    budget: 660,
    alarms: 0,
    escaping: false,
    ending: null,
    ...over,
  });

  /** A stem's elements, by the blob its file came as: calm's first, tense's, critical's. */
  const decksOf = (stem: 'calm' | 'tense' | 'critical'): FakeAudio[] => {
    const blob = `blob:stem-${['calm', 'tense', 'critical'].indexOf(stem)}`;
    return elements.filter((element) => element.src === blob);
  };

  /** The level an element's sound comes in at: its stream's own gain. */
  const outOf = (ctx: FakeContext, element: FakeAudio | undefined): FakeGain => {
    const source = ctx.all<FakeNode & { mediaElement: unknown }>('media').find(
      (node) => node.mediaElement === element,
    );
    return source?.outputs[0] as FakeGain;
  };

  /** A stem's bus, which its fade moves: the gain its elements' levels feed. */
  const busOf = (ctx: FakeContext, element: FakeAudio | undefined): FakeGain =>
    outOf(ctx, element).outputs[0] as FakeGain;

  it('plays nothing while the lab has its power, then starts under the effects', async () => {
    const m = await music();
    m.setTension(tension({ startAt: null }));
    expect(m.musicProbe()).toMatchObject({ calm: 0, pressure: 0, last: 0, level: 0, streams: 0 });
    m.setTension(tension());
    await fetchIn();
    const ctx = lastContext();
    // A stem's RMS (−20 dBFS after its gain) lands 26 dB under the effects' level.
    expect(20 * Math.log10((MUSIC_LEVEL * 0.1) / EFFECTS_LEVEL)).toBeCloseTo(-26, 9);
    expect(ctx.all<FakeGain>('gain').some((g) => g.gain.value === MUSIC_LEVEL)).toBe(true);
    // Every stem's file fetched once as it starts, none of them decoded.
    const files = fetched.filter((url) => url.endsWith('.mp3'));
    expect(files.sort()).toEqual(['/music/calm.mp3', '/music/critical.mp3', '/music/tense.mp3']);
    expect(ctx.all<FakeBufferSource>('buffer').filter((b) => b.buffer?.tag === 'calm')).toEqual(
      [],
    );
  });

  it('starts the calm stem from its start on its first bar, a loop of the budget', async () => {
    const m = await music({ calm: { startMs: 400 } });
    m.setTension(tension({ startAt: Date.now() + 1500 }));
    await fetchIn();
    const ctx = lastContext();
    m.setTension(tension({ startAt: Date.now() + 1500 }));
    const [first] = decksOf('calm'); // ready, its file in it
    expect(first?.src).toBe('blob:stem-0');
    ctx.currentTime = 10.6;
    m.setTension(tension({ startAt: Date.now() + 1500 }));
    expect(first?.plays).toBe(0);
    // Its sound starts 0.4 s into its file: the file starts so that it lands on 11.51.
    vi.advanceTimersByTime((11.51 - 0.4 - 10.6) * 1000 - 1);
    expect(first?.plays).toBe(0);
    vi.advanceTimersByTime(1);
    expect(first?.plays).toBe(1);
    expect(first?.currentTime).toBe(0); // from its start, never by a seek
    expect(lastFade(busOf(ctx, first).gain)).toEqual({
      start: expect.closeTo(11.51, 9),
      end: expect.closeTo(11.51 + CROSSFADE_S, 9),
      to: 1,
    });
    expect(outOf(ctx, first).gain.events.at(-1)).toEqual(['set', 1, 10.6]);
    expect(m.inUse().loop).toBe(1);
    expect(ctx.all('oscillator')).toHaveLength(0); // nothing made
  });

  it('starts each next pass a bar before it comes in over a 3 s seam, equal in power', async () => {
    const m = await music();
    m.setTension(tension());
    await fetchIn();
    const ctx = lastContext();
    m.setTension(tension());
    vi.advanceTimersByTime(300);
    const zero = 10.3; // its start had passed: as soon as its timer can make it
    const period = passPeriod(72, 90);
    ctx.currentTime = zero + period - 1.2; // more than a second before the next: nothing new
    m.setTension(tension());
    expect(decksOf('calm').filter((d) => d.plays > 0)).toHaveLength(1);
    ctx.currentTime = zero + period - 0.9;
    m.setTension(tension());
    const [first, second] = decksOf('calm');
    vi.advanceTimersByTime(900);
    expect(second?.plays).toBe(1);
    const into = curveOn(outOf(ctx, second).gain);
    const out = curveOn(outOf(ctx, first).gain);
    const cross = zero + period + BAR;
    expect([into?.at, into?.seconds]).toEqual([expect.closeTo(cross, 9), SEAM_S]);
    expect([out?.at, out?.seconds]).toEqual([expect.closeTo(cross, 9), SEAM_S]);
    expect([into?.values[0], into?.values.at(-1)]).toEqual([0, 1]);
    into?.values.forEach((level, i) => {
      expect(level ** 2 + (out?.values[i] ?? NaN) ** 2).toBeCloseTo(1, 6);
    });
    expect(m.inUse().loop).toBe(1); // one stem, its two elements taking turns
    vi.advanceTimersByTime((cross + SEAM_S + 0.05 - ctx.currentTime) * 1000);
    expect([first?.paused, first?.currentTime]).toEqual([true, 0]); // rewound for its next turn
  });

  it('crosses to the tense stem on the next bar as the clock runs down, calm let go', async () => {
    const m = await music();
    m.setTension(tension());
    await fetchIn();
    const ctx = lastContext();
    m.setTension(tension());
    ctx.currentTime = 15.3;
    m.setTension(tension({ left: 200 })); // 1 − 200/330: pressure ≈ 0.39
    m.setTension(tension({ left: 200 }));
    const bar = nextBar(15.3 + 0.3, { origin: 10.3, bpm: 90 });
    const [tense] = decksOf('tense');
    expect(lastFade(busOf(ctx, tense).gain)).toEqual({
      start: expect.closeTo(bar, 9),
      end: expect.closeTo(bar + CROSSFADE_S, 9),
      to: 1,
    });
    const [calm] = decksOf('calm');
    expect(lastFade(busOf(ctx, calm).gain)).toMatchObject({ start: bar, to: 0 });
    ctx.currentTime = bar - 0.9;
    m.setTension(tension({ left: 200 }));
    vi.advanceTimersByTime(900);
    expect(tense?.plays).toBe(1); // from its start on that bar
    expect(m.inUse().loop).toBe(2); // both, while they cross
    ctx.currentTime = bar + CROSSFADE_S;
    m.setTension(tension({ left: 199 }));
    vi.advanceTimersByTime(200);
    expect(calm?.paused).toBe(true);
    expect(calm?.src).toBe(''); // its elements let go
    expect(m.inUse().loop).toBe(1);
    expect(m.musicProbe()).toMatchObject({ calm: 0, pressure: 1, last: 0 });
  });

  it('catches a pass that came in late up with its bar, at most 3 % faster', async () => {
    const m = await music();
    m.setTension(tension());
    await fetchIn();
    const ctx = lastContext();
    m.setTension(tension());
    await vi.advanceTimersByTimeAsync(300); // its first pass starts on 10.3
    const [calm] = decksOf('calm');
    ctx.currentTime = 12.01;
    (calm as FakeAudio).currentTime = 12.01 - 10.3 - 0.02; // 20 ms behind where its bar puts it
    m.setTension(tension());
    expect(calm?.playbackRate).toBeCloseTo(1 + STEER_MAX, 9);
    expect(m.musicProbe().lagMs).toBeCloseTo(20, 1);
    (calm as FakeAudio).currentTime = 12.01 - 10.3;
    m.setTension(tension());
    expect(calm?.playbackRate).toBe(1);
  });

  it('brings the critical stem in for the last minute, and keeps it under the siren', async () => {
    const m = await music();
    m.setTension(tension({ left: 100 }));
    await fetchIn();
    const ctx = lastContext();
    ctx.currentTime = 20;
    m.setTension(tension({ left: 45 }));
    ctx.currentTime = 30;
    m.setTension(tension({ left: 40, escaping: true }));
    ctx.currentTime = 40;
    m.setTension(tension({ left: 39, escaping: true }));
    const probe = m.musicProbe();
    expect(probe).toMatchObject({ calm: 0, pressure: 1, last: 1 });
    expect(probe.level).toBeGreaterThanOrEqual(0.8);
    expect(decksOf('critical').length).toBeGreaterThan(0);
  });

  it('pushes the pressure for 20 s with each alarm', async () => {
    const m = await music();
    m.setTension(tension({ alarms: 3 })); // alarms from before the music: no push
    expect(m.musicProbe().level).toBe(0);
    m.setTension(tension({ alarms: 5 }));
    expect(m.musicProbe().level).toBeCloseTo(0.3, 9);
    vi.setSystemTime(Date.now() + ALARM_HOLD_MS);
    m.setTension(tension({ alarms: 5 }));
    expect(m.musicProbe().level).toBe(0);
  });

  it('answers each alarm with its sting on the effects’ bus, none from before it', async () => {
    const m = await music();
    m.setTension(tension({ alarms: 3 })); // alarms from before the music: no sting
    const ctx = lastContext();
    const stings = (): FakeBufferSource[] =>
      ctx.all<FakeBufferSource>('buffer').filter((b) => b.buffer?.tag === 'alarm-sting');
    expect(stings()).toHaveLength(0);
    m.setTension(tension({ alarms: 4 }));
    m.setTension(tension({ alarms: 4 }));
    expect(stings()).toHaveLength(1);
    m.setTension(tension({ alarms: 6 })); // two at once: one sting
    expect(stings()).toHaveLength(2);
  });

  it('waits with a stem that finds no loop in the budget, and starts it with room', async () => {
    const m = await music();
    expect(m.claim({ loop: CAPS.loop })).toBe(true);
    m.setTension(tension());
    await fetchIn();
    m.setTension(tension());
    vi.advanceTimersByTime(1000);
    expect(decksOf('calm').some((deck) => deck.plays > 0)).toBe(false);
    m.release({ loop: 1 });
    lastContext().currentTime = 12.1; // its first pass on the next bar it can make: 12.97
    m.setTension(tension());
    vi.advanceTimersByTime(900);
    expect(decksOf('calm').filter((deck) => deck.plays > 0)).toHaveLength(1);
  });

  it('plays no stem whose file could not be had, keeps no loop, and asks again later', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const served: Record<string, Served> = { calm: { status: 404 } };
    const m = await music(served);
    m.setTension(tension());
    await fetchIn();
    m.setTension(tension());
    expect(decksOf('calm')).toHaveLength(0);
    expect(m.inUse().loop).toBe(0);
    served['calm'] = {}; // the file can be had again
    m.setTension(tension());
    await fetchIn();
    expect(fetched.filter((url) => url === '/music/calm.mp3')).toHaveLength(1); // not yet
    vi.setSystemTime(Date.now() + RETRY_MS);
    m.setTension(tension());
    await fetchIn();
    m.setTension(tension());
    expect(fetched.filter((url) => url === '/music/calm.mp3')).toHaveLength(2);
    // Its file came last, after the tense's and the critical's: its elements stand ready.
    expect(elements.filter((element) => element.src === blobs.at(-1))).toHaveLength(2);
  });

  it('fades out for a run won, and drains for a run lost, letting every stem go', async () => {
    const won = await music();
    won.setTension(tension());
    await fetchIn();
    won.setTension(tension());
    won.setTension(tension({ ending: 'won' }));
    const ctx = lastContext();
    const out = ctx.all<FakeGain>('gain').find((g) => g.gain.value === MUSIC_LEVEL) as FakeGain;
    expect(lastFade(out.gain)).toEqual({ start: 10, end: 11.5, to: 0 });
    expect(won.inUse().loop).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(elements.every((element) => element.src === '')).toBe(true);
    fakeGraph();
    fakeMedia();
    const lost = await music();
    lost.setTension(tension());
    await fetchIn();
    lost.setTension(tension());
    vi.advanceTimersByTime(10);
    lost.setTension(tension({ ending: 'lost' }));
    const drained = lastContext();
    const drain = drained.all<FakeFilter>('biquad').find((f) => f.frequency.value === 20000);
    expect(drain?.frequency.ramps()).toEqual([[120, 11.5]]);
    const [calm] = elements;
    vi.advanceTimersByTime(750);
    expect(calm?.playbackRate).toBeCloseTo(0.75, 9); // slowing as it drains
  });

  it('streams the end card’s sting once on the music’s bus, none it cannot play now', async () => {
    const m = await music();
    m.playSting('won');
    await fetchIn();
    const ctx = lastContext();
    const [sting] = elements;
    expect(sting?.src).toBe('/music/won.mp3');
    expect(outOf(ctx, sting).gain.value).toBe(STING_LEVEL);
    expect(20 * Math.log10((STING_LEVEL * 10 ** (-14 / 20)) / EFFECTS_LEVEL)).toBeCloseTo(-8, 9);
    vi.advanceTimersByTime(20);
    expect(sting?.plays).toBe(1);
    sting?.fire('ended');
    expect(sting?.src).toBe(''); // let go once played
    ctx.state = 'suspended';
    m.playSting('lost');
    await fetchIn();
    expect(elements).toHaveLength(1);
  });

  it('starts over for a new run, and never throws without audio', async () => {
    const m = await music();
    m.setTension(tension());
    m.setTension(tension({ run: 2 }));
    const ctx = lastContext();
    const outs = ctx.all<FakeGain>('gain').filter((g) => g.gain.value === MUSIC_LEVEL);
    expect(outs).toHaveLength(2);
    expect(lastFade((outs[0] as FakeGain).gain)).toEqual({ start: 10, end: 10.3, to: 0 });
    vi.stubGlobal('AudioContext', undefined);
    const none = await music();
    expect(() => {
      none.setTension(tension());
      none.setTension(tension({ ending: 'lost' }));
      none.stopMusic();
      none.playSting('won');
    }).not.toThrow();
  });
});
