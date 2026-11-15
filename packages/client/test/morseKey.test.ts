import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUE_LEAD,
  eventsIn,
  lampAt,
  LETTER_GAP,
  morseLoop,
  SIGNAL_GAP,
  WORD_GAP,
} from '../src/puzzles/morseKey.js';
import {
  downstream,
  endAll,
  fakeGraph,
  type FakeBufferSource,
  type FakeContext,
  type FakeGain,
  type FakeOscillator,
  lastContext,
} from './fakeGraph.js';

describe('the Funkfeuer loop', () => {
  it('keys short 1, long 3; dark 1 in a letter, 5 between letters, 10 before the repeat', () => {
    const loop = morseLoop('-.. .-');
    expect(loop.marks).toEqual([
      { at: 0, units: 3 },
      { at: 4, units: 1 },
      { at: 6, units: 1 },
      { at: 12, units: 1 },
      { at: 14, units: 3 },
    ]);
    expect(loop.period).toBe(17 + WORD_GAP);
    expect(loop.cue).toBe(loop.period - CUE_LEAD);
  });

  it('keeps the gap between letters clearly longer than the one inside a letter', () => {
    expect(LETTER_GAP).toBeGreaterThanOrEqual(5 * SIGNAL_GAP);
    expect(WORD_GAP).toBeGreaterThan(LETTER_GAP);
    const { marks } = morseLoop('... ---');
    const gaps = marks.slice(1).map((mark, i) => mark.at - (marks[i]!.at + marks[i]!.units));
    expect(gaps).toEqual([1, 1, LETTER_GAP, 1, 1]);
  });

  it('tells the lamp lit or dark and how long until it turns, dark before the first signal', () => {
    const loop = morseLoop('-.');
    expect(lampAt(loop, -2)).toEqual({ lit: false, next: 2 });
    expect(lampAt(loop, 1)).toEqual({ lit: true, next: 2 });
    expect(lampAt(loop, 3.5)).toEqual({ lit: false, next: 0.5 });
    expect(lampAt(loop, 4.25)).toEqual({ lit: true, next: 0.75 });
    expect(lampAt(loop, loop.period + 1)).toEqual({ lit: true, next: 2 });
    expect(lampAt(loop, 5)).toEqual({ lit: false, next: loop.period - 5 });
  });

  it('sounds the cue once a loop, only in the pause before the word, never inside it', () => {
    const loop = morseLoop('-.. .-');
    const events = eventsIn(loop, -6, 3 * loop.period);
    const cues = events.filter((event) => event.kind === 'cue').map((event) => event.at);
    // Each word's own, and the next repeat's at the end of the third.
    expect(cues).toEqual([0, 1, 2, 3].map((k) => k * loop.period - CUE_LEAD));
    const tones = events.filter((event) => event.kind === 'tone');
    expect(tones).toHaveLength(3 * loop.marks.length);
    const last = loop.marks.at(-1)!;
    expect(loop.cue).toBeGreaterThan(last.at + last.units + LETTER_GAP);
  });

  it('lays every event once, however the run is cut into windows', () => {
    const loop = morseLoop('.-. ..');
    const whole = eventsIn(loop, -6, 50);
    const cut = [-6, -1.3, 0, 7.7, 21, 33.2, 50];
    const pieces = cut.slice(1).flatMap((to, i) => eventsIn(loop, cut[i]!, to));
    expect(pieces).toEqual(whole);
  });
});

describe('the Morse key', () => {
  beforeEach(() => {
    fakeGraph();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function freshKey() {
    vi.resetModules();
    const audio = await import('../src/world/audio.js');
    const key = await import('../src/puzzles/morseKey.js');
    const engine = audio.audioEngine();
    const ctx = lastContext();
    return { audio, key, engine, ctx };
  }

  /** Runs page and audio clock on together by `ms`, a millisecond at a time. */
  function run(ctx: FakeContext, ms: number): void {
    for (let i = 0; i < ms; i++) {
      ctx.currentTime += 0.001;
      vi.advanceTimersByTime(1);
    }
  }

  /** The lamp's turns, by the audio clock as it turned. */
  function watchLamp(ctx: FakeContext) {
    const turns: { lit: boolean; at: number }[] = [];
    return { turns, onLamp: (lit: boolean) => turns.push({ lit, at: ctx.currentTime }) };
  }

  const tones = (ctx: FakeContext) => ctx.all<FakeOscillator>('oscillator');
  const cues = (ctx: FakeContext) =>
    ctx.all<FakeBufferSource>('buffer').filter((source) => source.startedAt !== null);

  it('sounds each blink as a tone of its length, on the lamp schedule, over three loops', async () => {
    const { key, engine, ctx } = await freshKey();
    const lamp = watchLamp(ctx);
    const pattern = '-.. .-';
    const loop = key.morseLoop(pattern);
    const keying = key.startKeying(pattern, lamp.onLamp);
    run(ctx, Math.round((6 + 3 * loop.period) * key.UNIT_S * 1000));
    const ons = lamp.turns.filter((turn) => turn.lit).map((turn) => turn.at);
    const offs = lamp.turns.filter((turn) => !turn.lit).map((turn) => turn.at);
    const heard = tones(ctx).filter((osc) => (osc.startedAt ?? 0) < ctx.currentTime - 0.01);
    expect(heard).toHaveLength(3 * loop.marks.length);
    heard.forEach((osc, i) => {
      // The lamp turns within the millisecond it waits past each edge, plus the run's step.
      expect(Math.abs(ons[i]! - osc.startedAt!)).toBeLessThan(0.003);
      expect(Math.abs(offs[i]! - osc.stoppedAt!)).toBeLessThan(0.003);
      const mark = loop.marks[i % loop.marks.length]!;
      expect(osc.stoppedAt! - osc.startedAt!).toBeCloseTo(mark.units * key.UNIT_S, 9);
      expect(osc.type).toBe('sine');
      expect(osc.frequency.value).toBe(key.TONE_HZ);
      expect(downstream(osc).has(engine!.sfx as unknown as FakeGain)).toBe(true);
    });
    keying.stop();
  });

  it('ramps each tone in and out within its length, so that it never clicks', async () => {
    const { key, ctx } = await freshKey();
    key.startKeying('.', () => undefined);
    run(ctx, 2000);
    const osc = tones(ctx)[0]!;
    const env = osc.outputs[0] as FakeGain;
    const at = osc.startedAt!;
    const end = osc.stoppedAt!;
    expect(env.gain.events).toEqual([
      ['set', 0, at],
      ['linear', 1, at + key.RAMP_S],
      ['set', 1, end - key.RAMP_S],
      ['linear', 0, end],
    ]);
  });

  it('hisses once before every repeat of the word, CUE_LEAD units before its first tone', async () => {
    const { key, ctx } = await freshKey();
    const pattern = '.- -';
    const loop = key.morseLoop(pattern);
    const keying = key.startKeying(pattern, () => undefined);
    run(ctx, Math.round((6 + 2 * loop.period) * key.UNIT_S * 1000));
    keying.stop();
    const firsts = tones(ctx)
      .filter((_, i) => i % loop.marks.length === 0)
      .map((osc) => osc.startedAt!);
    const hisses = cues(ctx).map((cue) => cue.startedAt!);
    expect(hisses.length).toBeGreaterThanOrEqual(2);
    hisses.slice(0, firsts.length).forEach((at, i) => {
      expect(firsts[i]! - at).toBeCloseTo(CUE_LEAD * key.UNIT_S, 9);
    });
  });

  it('lays nothing while the sound is off, and the lamp blinks on', async () => {
    const { audio, key, ctx } = await freshKey();
    audio.setMuted(true);
    const made = ctx.nodes.length;
    const lamp = watchLamp(ctx);
    const keying = key.startKeying('...', lamp.onLamp);
    run(ctx, 4000);
    keying.stop();
    expect(ctx.nodes.length).toBe(made);
    expect(lamp.turns.filter((turn) => turn.lit)).toHaveLength(3);
  });

  it('lays nothing more once the sound is switched off at the panel', async () => {
    const { audio, key, ctx } = await freshKey();
    const keying = key.startKeying('.-', () => undefined);
    run(ctx, 1500);
    const laid = ctx.nodes.length;
    expect(tones(ctx).length).toBeGreaterThan(0);
    audio.setMuted(true);
    run(ctx, 8000);
    keying.stop();
    expect(ctx.nodes.length).toBe(laid);
  });

  it('lays no tone before the context may run, the lamp keyed by the page', async () => {
    const { key, ctx } = await freshKey();
    ctx.state = 'suspended';
    const lamp = watchLamp(ctx);
    const keying = key.startKeying('-', lamp.onLamp);
    run(ctx, 3000);
    keying.stop();
    expect(tones(ctx)).toHaveLength(0);
    expect(lamp.turns.map((turn) => turn.lit)).toEqual([true, false]);
  });

  it('keys the lamp on by the page should the context stop running, its clock frozen', async () => {
    const { key, ctx } = await freshKey();
    const lamp = watchLamp(ctx);
    const keying = key.startKeying('.', lamp.onLamp);
    run(ctx, 1000);
    ctx.state = 'suspended';
    const laid = tones(ctx).length;
    vi.advanceTimersByTime(8000);
    keying.stop();
    expect(lamp.turns.filter((turn) => turn.lit).length).toBeGreaterThanOrEqual(2);
    expect(tones(ctx)).toHaveLength(laid);
  });

  it('stops at once as the panel closes: what is laid silenced, nothing laid after', async () => {
    const { key, ctx } = await freshKey();
    const keying = key.startKeying('-- --', () => undefined);
    run(ctx, 1600);
    const laid = tones(ctx).length;
    expect(laid).toBeGreaterThan(0);
    keying.stop();
    const now = ctx.currentTime;
    for (const osc of tones(ctx)) {
      expect(osc.stoppedAt!).toBeLessThanOrEqual(now + key.RAMP_S + 1e-9);
    }
    const outlet = tones(ctx)[0]!.outputs[0]!;
    const line = (outlet as FakeGain).outputs[0] as FakeGain;
    expect(line.gain.events.at(-1)).toEqual(['linear', 0, now + key.RAMP_S]);
    run(ctx, 5000);
    expect(tones(ctx)).toHaveLength(laid);
    endAll(ctx);
    expect(line.disconnected).toBe(true);
  });

  it('falls silent once hushed — the station solved — while the lamp goes on', async () => {
    const { key, ctx } = await freshKey();
    const lamp = watchLamp(ctx);
    const keying = key.startKeying('.', lamp.onLamp);
    run(ctx, 1000);
    keying.hush();
    const laid = tones(ctx).length + cues(ctx).length;
    const turned = lamp.turns.length;
    run(ctx, 8000);
    keying.stop();
    expect(tones(ctx).length + cues(ctx).length).toBe(laid);
    expect(lamp.turns.length).toBeGreaterThan(turned);
  });
});
