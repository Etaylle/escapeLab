import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPS, EFFECTS_LEVEL } from '../src/world/audio.js';
import {
  ALARM_HOLD_MS,
  clockTension,
  crossfadeBeats,
  heartBpm,
  LAST_BPM,
  layersFor,
  MUSIC_LEVEL,
  nextBeat,
  pressureOf,
  PULSE_BPM,
  sweepHz,
  type Layers,
  type Tension,
} from '../src/world/music.js';
import {
  endAll,
  fakeGraph,
  FakeOfflineContext,
  flush,
  lastContext,
  type FakeBufferSource,
  type FakeContext,
  type FakeFilter,
  type FakeGain,
  type FakeNode,
  type FakeOscillator,
  type FakeParam,
} from './fakeGraph.js';

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

  it('quickens the heartbeat from 70 to 120 bpm as the last minute runs out', () => {
    expect(heartBpm(300)).toBe(70);
    expect(heartBpm(60)).toBe(70);
    expect(heartBpm(30)).toBe(95);
    expect(heartBpm(0)).toBe(120);
    expect(heartBpm(-5)).toBe(120);
  });

  it('crossfades on the beat over whole beats, 2 s at least', () => {
    const grid = { origin: 10, bpm: PULSE_BPM };
    expect(nextBeat(9, grid)).toBe(10);
    expect(nextBeat(10, grid)).toBe(10);
    expect(nextBeat(10.1, grid)).toBeCloseTo(10 + 2 / 3, 9);
    expect(nextBeat(11.3334, grid)).toBeCloseTo(12, 9);
    expect(crossfadeBeats(PULSE_BPM)).toBe(3);
    expect(crossfadeBeats(LAST_BPM)).toBe(4);
    expect(crossfadeBeats(100)).toBe(4);
    for (const bpm of [PULSE_BPM, LAST_BPM, 100]) {
      expect((crossfadeBeats(bpm) * 60) / bpm).toBeGreaterThanOrEqual(2);
    }
  });
});

/** The music's buses: the gain stages wired into its drain filter, in the order made. */
function buses(ctx: FakeContext): FakeGain[] {
  const drain = ctx.all<FakeFilter>('biquad').find((f) => f.frequency.value === 20000);
  return ctx.all<FakeGain>('gain').filter((g) => g.outputs.includes(drain as FakeNode));
}

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

  async function music() {
    vi.resetModules();
    const module = await import('../src/world/music.js');
    const audio = await import('../src/world/audio.js');
    return { ...module, inUse: audio.inUse, claim: audio.claim };
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

  /** The pad's loop: the looping buffer source the music made. */
  const padOf = (ctx: FakeContext): FakeBufferSource | undefined =>
    ctx.all<FakeBufferSource>('buffer').find((b) => b.loop);

  /** The notes played on `ctx`: the sources of its samples, each with its sample's first tone. */
  const notesOf = (ctx: FakeContext): { source: FakeBufferSource; tone?: FakeOscillator }[] =>
    ctx
      .all<FakeBufferSource>('buffer')
      .filter((source) => source.buffer?.renderedBy != null)
      .map((source) => {
        const tone = source.buffer?.renderedBy?.all<FakeOscillator>('oscillator')[0];
        return tone === undefined ? { source } : { source, tone };
      });

  it('plays nothing while the lab has its power, then starts 18 dB under the effects', async () => {
    const m = await music();
    m.setTension(tension({ startAt: null }));
    expect(m.musicProbe()).toEqual({ calm: 0, pressure: 0, last: 0, level: 0 });
    m.setTension(tension());
    const ctx = lastContext();
    expect(20 * Math.log10(MUSIC_LEVEL / EFFECTS_LEVEL)).toBeCloseTo(-18, 9);
    expect(ctx.all<FakeGain>('gain').some((g) => g.gain.value === MUSIC_LEVEL)).toBe(true);
  });

  it('plays the pad as a loop rendered once — two sines beating once a second', async () => {
    const m = await music();
    m.setTension(tension({ startAt: Date.now() + 1500 }));
    await flush();
    m.setTension(tension({ startAt: Date.now() + 1500 }));
    const ctx = lastContext();
    const pad = padOf(ctx);
    expect(pad?.buffer?.duration).toBe(1);
    expect(pad?.startedAt).toBeCloseTo(11.51, 9); // 2 s after the click: where it was told
    expect(ctx.all<FakeOscillator>('oscillator')).toHaveLength(0);
    expect(m.inUse().loop).toBe(1);
  });

  it('steps the pad’s lowpass along its 20 s sweep, ahead of the clock', async () => {
    const m = await music();
    m.setTension(tension());
    const ctx = lastContext();
    const lowpass = ctx.all<FakeFilter>('biquad').find((f) => f.Q.value === 6);
    const steps = lowpass?.frequency.events.filter((e) => e[0] === 'set') ?? [];
    expect(steps.length).toBeGreaterThan(0);
    for (const [, hz, at] of steps as (readonly ['set', number, number])[]) {
      expect(hz).toBeCloseTo(sweepHz(at - 10.01), 6);
    }
    expect(sweepHz(5)).toBeCloseTo(690, 6);
    expect(sweepHz(15)).toBeCloseTo(150, 6);
  });

  it('fades the pad in on the first beat, the pressure layer as the clock runs down', async () => {
    const m = await music();
    m.setTension(tension());
    const ctx = lastContext();
    const [calm, pulse] = buses(ctx);
    expect(lastFade((calm as FakeGain).gain)).toEqual({
      start: expect.closeTo(10.01, 9),
      end: expect.closeTo(12.01, 9),
      to: 1,
    });
    ctx.currentTime = 15.3;
    m.setTension(tension({ left: 200 })); // 1 − 200/330: pressure ≈ 0.39
    const fade = lastFade((pulse as FakeGain).gain);
    expect(fade.to).toBe(1);
    expect(fade.end - fade.start).toBeCloseTo((3 * 60) / PULSE_BPM, 9);
    expect(offBeat(fade.start, 10.01, PULSE_BPM)).toBeCloseTo(0, 6); // on the beat
    expect(fade.start).toBeGreaterThanOrEqual(15.3);
    ctx.currentTime = fade.end;
    const level = expect.closeTo(1 - 200 / 330, 9);
    expect(m.musicProbe()).toEqual({ calm: 1, pressure: 1, last: 0, level });
  });

  it('brings the last minute in at 120 bpm; the siren takes the pad, then stops it', async () => {
    const m = await music();
    m.setTension(tension({ left: 100 }));
    await flush();
    m.setTension(tension({ left: 100 }));
    const ctx = lastContext();
    ctx.currentTime = 20;
    m.setTension(tension({ left: 45 }));
    const heart = buses(ctx)[4] as FakeGain;
    const fade = lastFade(heart.gain);
    expect(fade.end - fade.start).toBeCloseTo((4 * 60) / LAST_BPM, 9);
    ctx.currentTime = 30;
    m.setTension(tension({ left: 40, escaping: true }));
    ctx.currentTime = 40;
    m.setTension(tension({ left: 39, escaping: true }));
    const probe = m.musicProbe();
    expect(probe).toEqual({ calm: 0, pressure: 1, last: 1, level: expect.any(Number) });
    expect(probe.level).toBeGreaterThanOrEqual(0.8);
    const [, , arp, double] = buses(ctx);
    expect(lastFade((arp as FakeGain).gain).to).toBe(0); // the siren keeps the pulse and the heart
    expect(lastFade((double as FakeGain).gain).to).toBe(0);
    expect(padOf(ctx)?.stoppedAt).toBeCloseTo(40.05, 9); // its layer silent: the pad stops
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

  it('schedules ahead on each call: a pulse a beat, the arpeggio every other', async () => {
    const m = await music();
    const ctx = lastContextAfter(() => m.setTension(tension({ left: 200 })));
    await flush(); // the notes' samples, rendered as the music starts
    const renders = FakeOfflineContext.rendered.length;
    for (let t = 10; t < 16; t += 0.1) {
      ctx.currentTime = t;
      m.setTension(tension({ left: 200 }));
      endAll(ctx); // every note played out: its budget back
    }
    const started = (type: string, hz: number): number[] =>
      notesOf(ctx)
        .filter(({ tone }) => tone?.type === type && tone.frequency.events[0]?.[1] === hz)
        .map(({ source }) => source.startedAt as number);
    const bass = started('triangle', 55);
    expect(bass.length).toBeGreaterThan(3);
    for (const at of bass) expect(offBeat(at, 10.01, PULSE_BPM)).toBeCloseTo(0, 6);
    const arpeggio = started('triangle', 440);
    expect(arpeggio.length).toBeGreaterThan(0);
    for (const at of arpeggio) expect(Math.round((at - 10.01) / (60 / PULSE_BPM)) % 2).toBe(0);
    expect(started('sine', 62)).toEqual([]); // no heartbeat before the last minute
    expect(FakeOfflineContext.rendered).toHaveLength(renders); // each sample rendered once
    expect(ctx.all<FakeOscillator>('oscillator')).toHaveLength(0); // no live tones
  });

  it('breathes a swell 8 s long, its noise looped, and the heartbeat in the last minute', async () => {
    const m = await music();
    const ctx = lastContextAfter(() => m.setTension(tension({ left: 50 })));
    await flush();
    for (let t = 10; t < 26; t += 0.1) {
      ctx.currentTime = t;
      m.setTension(tension({ left: 50 }));
      endAll(ctx);
    }
    const breaths = notesOf(ctx).filter(({ source }) => source.buffer?.duration === 8);
    expect(breaths.length).toBeGreaterThan(0);
    const air = breaths[0]?.source.buffer?.renderedBy?.all<FakeBufferSource>('buffer')[0];
    expect(air?.loop).toBe(true); // the shared noise's 2 s, round and round
    expect(air?.stoppedAt).toBe(8);
    const thumps = notesOf(ctx).filter(({ tone }) => tone?.frequency.events[0]?.[1] === 62);
    expect(thumps.length).toBeGreaterThan(1); // lub and dub
  });

  it('lets every note go once played, and plays none the budget has no room for', async () => {
    const m = await music();
    m.setTension(tension({ left: 200 }));
    await flush();
    const ctx = lastContext();
    ctx.currentTime = 12.5;
    m.setTension(tension({ left: 200 }));
    const notes = notesOf(ctx).map(({ source }) => source);
    expect(notes.length).toBeGreaterThan(0);
    expect(m.inUse().voice).toBe(notes.length);
    endAll(ctx);
    expect(m.inUse().voice).toBe(0);
    for (const note of notes) expect(note.disconnected).toBe(true);
    expect(m.claim({ voice: CAPS.voice })).toBe(true);
    ctx.currentTime = 14;
    m.setTension(tension({ left: 200 }));
    expect(notesOf(ctx)).toHaveLength(notes.length); // none new
  });

  it('fades out for a run won, and drains for a run lost', async () => {
    const won = await music();
    won.setTension(tension());
    won.setTension(tension({ ending: 'won' }));
    const ctx = lastContext();
    const out = ctx.all<FakeGain>('gain').find((g) => g.gain.value === MUSIC_LEVEL) as FakeGain;
    expect(lastFade(out.gain)).toEqual({ start: 10, end: 11.5, to: 0 });
    fakeGraph();
    const lost = await music();
    lost.setTension(tension());
    await flush();
    lost.setTension(tension());
    lost.setTension(tension({ ending: 'lost' }));
    const drained = lastContext();
    const drain = drained.all<FakeFilter>('biquad').find((f) => f.frequency.value === 20000);
    expect(drain?.frequency.ramps()).toEqual([[120, 11.5]]);
    const pad = padOf(drained);
    expect(pad?.playbackRate.ramps()).toEqual([[0.5, 11.5]]);
    expect(pad?.stoppedAt).toBeCloseTo(11.55, 9);
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
    }).not.toThrow();
  });
});

/** Runs `make` and returns the context it made. */
function lastContextAfter(make: () => void): FakeContext {
  make();
  return lastContext();
}
