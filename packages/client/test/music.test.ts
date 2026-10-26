import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPS, EFFECTS_LEVEL } from '../src/world/audio.js';
import {
  ALARM_HOLD_MS,
  clockTension,
  crossfadeBeats,
  layersFor,
  MUSIC_BPM,
  MUSIC_LEVEL,
  nextBeat,
  pressureOf,
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
  type FakeParam,
} from './fakeGraph.js';
import { loadedSamples, type Served } from './fakeSamples.js';

const NONE: Layers = { calm: false, pressure: false, last: false };

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

  it('crossfades on the beat over whole beats, 2 s at least', () => {
    const grid = { origin: 10, bpm: MUSIC_BPM };
    expect(MUSIC_BPM).toBe(90);
    expect(nextBeat(9, grid)).toBe(10);
    expect(nextBeat(10, grid)).toBe(10);
    expect(nextBeat(10.1, grid)).toBeCloseTo(10 + 2 / 3, 9);
    expect(nextBeat(11.3334, grid)).toBeCloseTo(12, 9);
    expect(crossfadeBeats(MUSIC_BPM)).toBe(3);
    expect(crossfadeBeats(120)).toBe(4);
    for (const bpm of [MUSIC_BPM, 120, 100]) {
      expect((crossfadeBeats(bpm) * 60) / bpm).toBeGreaterThanOrEqual(2);
    }
  });
});

/** How far `at` lies off the beat of the grid from `origin`, in beats: 0 on the beat. */
function offBeat(at: number, origin: number, bpm: number): number {
  const beats = (at - origin) / (60 / bpm);
  return Math.abs(beats - Math.round(beats));
}

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
  beforeEach(() => {
    fakeGraph();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function music(served: Readonly<Record<string, Served>> = {}) {
    vi.resetModules();
    await loadedSamples(served);
    const module = await import('../src/world/music.js');
    const audio = await import('../src/world/audio.js');
    return { ...module, inUse: audio.inUse, claim: audio.claim, release: audio.release };
  }

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

  /** The passes of the stem `id` played on `ctx`, in the order they were made. */
  const passesOf = (ctx: FakeContext, id: string): FakeBufferSource[] =>
    ctx.all<FakeBufferSource>('buffer').filter((b) => b.buffer?.tag === id);

  /** The stage a pass fades in and out through: the gain it feeds. */
  const seamOf = (pass: FakeBufferSource | undefined): FakeGain => pass?.outputs[0] as FakeGain;

  /** A stem's bus: the gain its passes' seams feed. */
  const busOf = (pass: FakeBufferSource | undefined): FakeGain =>
    seamOf(pass).outputs[0] as FakeGain;

  it('plays nothing while the lab has its power, then starts under the effects', async () => {
    const m = await music();
    m.setTension(tension({ startAt: null }));
    expect(m.musicProbe()).toEqual({ calm: 0, pressure: 0, last: 0, level: 0 });
    m.setTension(tension());
    const ctx = lastContext();
    // A stem's RMS (−20 dBFS after its gain) lands 26 dB under the effects' level.
    expect(20 * Math.log10((MUSIC_LEVEL * 0.1) / EFFECTS_LEVEL)).toBeCloseTo(-26, 9);
    expect(ctx.all<FakeGain>('gain').some((g) => g.gain.value === MUSIC_LEVEL)).toBe(true);
  });

  it('starts the calm stem as its fade comes in on the beat, a loop of the budget', async () => {
    const m = await music({ calm: { startMs: 400 } });
    m.setTension(tension({ startAt: Date.now() + 1500 }));
    const ctx = lastContext();
    expect(passesOf(ctx, 'calm')).toHaveLength(0); // scheduled 0.3 s ahead, not sooner
    ctx.currentTime = 11.3;
    m.setTension(tension({ startAt: Date.now() + 1500 }));
    const [first] = passesOf(ctx, 'calm');
    expect(first?.startedAt).toBeCloseTo(11.51, 9); // 2 s after the click: where it was told
    expect(first?.offset).toBe(0.4); // past the silence before its sound
    expect(lastFade(busOf(first).gain)).toEqual({
      start: expect.closeTo(11.51, 9),
      end: expect.closeTo(13.51, 9),
      to: 1,
    });
    expect(m.inUse().loop).toBe(1);
    expect(ctx.all('oscillator')).toHaveLength(0); // nothing made
  });

  it('loops a stem by a 3 s seam: the next pass comes in as the last ends, in power', async () => {
    const m = await music({ calm: { startMs: 500 } });
    m.setTension(tension());
    const ctx = lastContext();
    const period = 72 - 0.5 - SEAM_S;
    ctx.currentTime = 10.01 + period - 1; // a second before the seam: nothing new yet
    m.setTension(tension());
    expect(passesOf(ctx, 'calm')).toHaveLength(1);
    ctx.currentTime = 10.01 + period - 0.2; // within the 0.3 s scheduled ahead
    m.setTension(tension());
    const [first, second] = passesOf(ctx, 'calm');
    expect(second?.startedAt).toBeCloseTo(10.01 + period, 9);
    expect(second?.offset).toBe(0.5);
    expect(first?.stoppedAt).toBeCloseTo(10.01 + period + SEAM_S + 0.05, 9);
    const into = curveOn(seamOf(second).gain);
    const out = curveOn(seamOf(first).gain);
    expect([into?.at, into?.seconds]).toEqual([expect.closeTo(10.01 + period, 9), SEAM_S]);
    expect([out?.at, out?.seconds]).toEqual([expect.closeTo(10.01 + period, 9), SEAM_S]);
    expect([into?.values[0], into?.values.at(-1)]).toEqual([0, 1]);
    into?.values.forEach((level, i) => {
      expect(level ** 2 + (out?.values[i] ?? NaN) ** 2).toBeCloseTo(1, 6);
    });
    expect(m.inUse().loop).toBe(1); // one stem, its seam's second source included
  });

  it('crossfades to the tense stem on the beat as the clock runs down, calm let go', async () => {
    const m = await music();
    m.setTension(tension());
    const ctx = lastContext();
    ctx.currentTime = 15.3;
    m.setTension(tension({ left: 200 })); // 1 − 200/330: pressure ≈ 0.39
    const [tense] = passesOf(ctx, 'tense');
    const fade = lastFade(busOf(tense).gain);
    expect(fade.to).toBe(1);
    expect(fade.end - fade.start).toBeCloseTo((3 * 60) / MUSIC_BPM, 9);
    expect(offBeat(fade.start, 10.01, MUSIC_BPM)).toBeCloseTo(0, 6); // on the beat
    expect(tense?.startedAt).toBeCloseTo(fade.start, 9); // the pass comes in with its fade
    const [calm] = passesOf(ctx, 'calm');
    expect(lastFade(busOf(calm).gain)).toEqual({ ...fade, to: 0 });
    expect(m.inUse().loop).toBe(2); // both, while they cross
    ctx.currentTime = fade.end;
    m.setTension(tension({ left: 199 }));
    expect(calm?.stoppedAt).toBeCloseTo(fade.end + 0.05, 9);
    expect(m.inUse().loop).toBe(1);
    expect(m.musicProbe()).toEqual({ calm: 0, pressure: 1, last: 0, level: expect.any(Number) });
  });

  it('brings the critical stem in for the last minute, and keeps it under the siren', async () => {
    const m = await music();
    m.setTension(tension({ left: 100 }));
    const ctx = lastContext();
    ctx.currentTime = 20;
    m.setTension(tension({ left: 45 }));
    ctx.currentTime = 30;
    m.setTension(tension({ left: 40, escaping: true }));
    ctx.currentTime = 40;
    m.setTension(tension({ left: 39, escaping: true }));
    const probe = m.musicProbe();
    expect(probe).toEqual({ calm: 0, pressure: 1, last: 1, level: expect.any(Number) });
    expect(probe.level).toBeGreaterThanOrEqual(0.8);
    expect(passesOf(ctx, 'critical')).toHaveLength(1);
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

  it('waits with a stem that finds no loop in the budget, and starts it with room', async () => {
    const m = await music();
    expect(m.claim({ loop: CAPS.loop })).toBe(true);
    m.setTension(tension());
    const ctx = lastContext();
    expect(passesOf(ctx, 'calm')).toHaveLength(0);
    m.release({ loop: 1 });
    ctx.currentTime = 10.5;
    m.setTension(tension());
    expect(passesOf(ctx, 'calm').map((pass) => pass.startedAt)).toEqual([10.51]);
  });

  it('plays no stem whose recording failed, and keeps no loop for it', async () => {
    const said = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = await music({ calm: { status: 404 } });
    m.setTension(tension());
    expect(passesOf(lastContext(), 'calm')).toHaveLength(0);
    expect(m.inUse().loop).toBe(0);
    expect(said).toHaveBeenCalledTimes(1);
  });

  it('fades out for a run won, and drains for a run lost, letting every stem go', async () => {
    const won = await music();
    won.setTension(tension());
    won.setTension(tension({ ending: 'won' }));
    const ctx = lastContext();
    const out = ctx.all<FakeGain>('gain').find((g) => g.gain.value === MUSIC_LEVEL) as FakeGain;
    expect(lastFade(out.gain)).toEqual({ start: 10, end: 11.5, to: 0 });
    expect(won.inUse().loop).toBe(0);
    fakeGraph();
    const lost = await music();
    lost.setTension(tension());
    lost.setTension(tension({ ending: 'lost' }));
    const drained = lastContext();
    const drain = drained.all<FakeFilter>('biquad').find((f) => f.frequency.value === 20000);
    expect(drain?.frequency.ramps()).toEqual([[120, 11.5]]);
    const [calm] = passesOf(drained, 'calm');
    expect(calm?.playbackRate.ramps()).toEqual([[0.5, 11.5]]);
    expect(calm?.stoppedAt).toBeCloseTo(11.55, 9);
  });

  it('plays the end card’s sting once on the music’s bus, none it cannot play now', async () => {
    const m = await music();
    m.playSting('won');
    const ctx = lastContext();
    const [sting] = passesOf(ctx, 'won');
    expect(sting?.startedAt).toBeCloseTo(10.01, 9);
    expect(seamOf(sting).gain.value).toBe(STING_LEVEL);
    expect(20 * Math.log10((STING_LEVEL * 10 ** (-14 / 20)) / EFFECTS_LEVEL)).toBeCloseTo(-8, 9);
    ctx.state = 'suspended';
    m.playSting('lost');
    expect(passesOf(ctx, 'lost')).toHaveLength(0);
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
