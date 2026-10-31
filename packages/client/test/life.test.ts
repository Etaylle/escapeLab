import { describe, expect, it } from 'vitest';
import {
  ANIM_HZ,
  animTime,
  cableSwing,
  CRT_DIP,
  CRT_LOW,
  crtFlicker,
  FAN_COAST,
  FAN_SPEED,
  FAN_SPIN_UP,
  LED_PATTERNS,
  ledLit,
  ledPattern,
  paperFlutter,
  propSeed,
  rollAt,
  ROLL_S,
  scopeTrace,
  spinFan,
  SWING,
  SWING_MS,
  WALK_SPEED,
} from '../src/world/anim.js';

/** `value(t)` at every step of the animation clock over `seconds`. */
function stepped<T>(seconds: number, value: (t: number) => T): T[] {
  return Array.from({ length: seconds * ANIM_HZ }, (_, i) => value(i / ANIM_HZ));
}

/** How many times a run of values changes from one to the next. */
const changes = (values: readonly unknown[]): number =>
  values.filter((v, i) => i > 0 && v !== values[i - 1]).length;

describe('crtFlicker and rollAt — a screen’s tube', () => {
  it('burns between CRT_LOW and full, dipping to CRT_DIP now and then, the same each time', () => {
    const tube = stepped(60, (t) => crtFlicker(t, 42));
    expect(Math.min(...tube)).toBeGreaterThanOrEqual(CRT_DIP);
    expect(Math.max(...tube)).toBeLessThanOrEqual(1);
    expect(tube.filter((v) => v > CRT_DIP && v < CRT_LOW)).toEqual([]);
    const dips = tube.filter((v) => v === CRT_DIP).length;
    expect(dips).toBeGreaterThan(0);
    expect(dips).toBeLessThan(tube.length / 8);
    expect(stepped(60, (t) => crtFlicker(t, 42))).toEqual(tube);
  });

  it('holds still between two steps of the clock, and flickers out of step with another', () => {
    expect(crtFlicker(animTime(3.01), 7)).toBe(crtFlicker(animTime(3.05), 7));
    expect(stepped(20, (t) => crtFlicker(t, 7))).not.toEqual(stepped(20, (t) => crtFlicker(t, 8)));
  });

  it('drifts its roll bar down once every ROLL_S, and has none under reduced motion', () => {
    const at = rollAt(1, 3, false) ?? Number.NaN;
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(1);
    expect(rollAt(1 + ROLL_S, 3, false)).toBeCloseTo(at, 9);
    const later = rollAt(1 + ROLL_S / 4, 3, false) ?? Number.NaN;
    expect((later - at + 1) % 1).toBeCloseTo(0.25, 9);
    expect(rollAt(1, 3, true)).toBeNull();
  });
});

describe('ledLit — a rack’s LEDs in their patterns', () => {
  it('blinks each LED in a pattern of its own, every pattern somewhere on a rack', () => {
    const patterns = new Set(Array.from({ length: 60 }, (_, id) => ledPattern(id)));
    expect([...patterns].sort()).toEqual([...LED_PATTERNS].sort());
  });

  it('reads the clock alone: the same LED at the same moment is lit the same, every run', () => {
    for (let id = 0; id < 40; id++) {
      expect(stepped(10, (t) => ledLit(id, id % 3, t))).toEqual(
        stepped(10, (t) => ledLit(id, id % 3, t)),
      );
    }
  });

  it('keeps a steady LED lit, and changes none faster than the clock steps', () => {
    const steady = Array.from({ length: 200 }, (_, id) => id).find(
      (id) => ledPattern(id) === 'steady',
    );
    expect(steady).toBeDefined();
    expect(stepped(10, (t) => ledLit(steady ?? 0, 0, t)).every(Boolean)).toBe(true);
    for (let id = 0; id < 40; id++) {
      const lit = stepped(10, (t) => ledLit(id, id % 3, t));
      expect(changes(lit)).toBeLessThanOrEqual(lit.length);
    }
  });

  it('chases one light along a row: in each step one of the three is lit', () => {
    const chaser = Array.from({ length: 200 }, (_, id) => id).find(
      (id) => ledPattern(id) === 'chase',
    );
    for (const t of [0, 0.4, 0.7, 1.2]) {
      const row = [0, 1, 2].map((k) => ledLit(chaser ?? 0, k, t));
      expect(row.filter(Boolean)).toHaveLength(1);
    }
  });
});

describe('scopeTrace — an oscilloscope', () => {
  it('stays on its screen, from -1 to 1, the same for the same moment', () => {
    for (let i = 0; i <= 40; i++) {
      const v = scopeTrace(i / 40, 2.3, 11);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      expect(scopeTrace(i / 40, 2.3, 11)).toBe(v);
    }
  });

  it('travels across the screen as the clock runs, each scope a wave of its own', () => {
    const at = (t: number, seed: number): number[] =>
      Array.from({ length: 24 }, (_, i) => scopeTrace(i / 24, t, seed));
    expect(at(1, 5)).not.toEqual(at(1.5, 5));
    expect(at(1, 5)).not.toEqual(at(1, 6));
  });
});

describe('cableSwing — a loose cable after the blackout’s thunk', () => {
  it('hangs plumb before the thunk, after SWING_MS and without one', () => {
    expect(cableSwing(-1, false)).toBe(0);
    expect(cableSwing(SWING_MS, false)).toBe(0);
    expect(cableSwing(SWING_MS + 500, false)).toBe(0);
    expect(cableSwing(null, false)).toBe(0);
  });

  it('swings there and back within SWING, dying away', () => {
    const swing = Array.from({ length: 300 }, (_, i) => cableSwing(i * 10, false));
    expect(Math.max(...swing.map(Math.abs))).toBeLessThanOrEqual(SWING);
    expect(swing.some((a) => a > 0.1)).toBe(true);
    expect(swing.some((a) => a < -0.1)).toBe(true);
    const early = Math.max(...swing.slice(0, 100).map(Math.abs));
    const late = Math.max(...swing.slice(200).map(Math.abs));
    expect(late).toBeLessThan(early / 3);
  });

  it('hangs plumb under reduced motion', () => {
    const plumb = Array.from({ length: 30 }, (_, i) => cableSwing(i * 100, true));
    expect(plumb.every((a) => a === 0)).toBe(true);
  });
});

describe('spinFan and paperFlutter — a ceiling fan and the sheet under it', () => {
  /** A fan stepped `seconds` at the clock's steps with its room's power `power`. */
  function spun(seconds: number, power: number, from = { angle: 0, speed: 0 }, reduced = false) {
    let spin = from;
    for (let i = 0; i < seconds * ANIM_HZ; i++) {
      spin = spinFan(spin, power, 1 / ANIM_HZ, reduced);
    }
    return spin;
  }

  it('spins up toward FAN_SPEED with the power on, and turns its blades as it goes', () => {
    const soon = spun(FAN_SPIN_UP, 1);
    expect(soon.speed).toBeGreaterThan(FAN_SPEED * 0.6);
    expect(soon.speed).toBeLessThan(FAN_SPEED);
    expect(spun(FAN_SPIN_UP * 8, 1).speed).toBeCloseTo(FAN_SPEED, 2);
    expect(soon.angle).not.toBe(0);
  });

  it('coasts to a stop without power, slower than it spun up', () => {
    const running = { angle: 1, speed: FAN_SPEED };
    expect(spun(FAN_COAST, 0, running).speed).toBeGreaterThan(FAN_SPEED * 0.3);
    expect(spun(FAN_COAST * 8, 0, running).speed).toBeLessThan(0.01);
  });

  it('turns its blades’ tips slower than anybody walks', () => {
    expect(FAN_SPEED * 0.4).toBeLessThan(WALK_SPEED);
  });

  it('stands still under reduced motion, and the sheet lies flat under a fan at rest', () => {
    const still = spun(3, 1, { angle: 0.5, speed: 0 }, true);
    expect(still).toEqual({ angle: 0.5, speed: 0 });
    expect(paperFlutter(0, 3.3, 7)).toBe(0);
  });

  it('flutters the sheet more the faster the fan turns, within its reach', () => {
    const lifts = (speed: number): number[] =>
      Array.from({ length: 60 }, (_, i) => paperFlutter(speed, i / 15, 7));
    const full = lifts(FAN_SPEED);
    expect(Math.max(...full)).toBeLessThanOrEqual(1);
    expect(Math.min(...full)).toBeGreaterThanOrEqual(0);
    const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean(lifts(FAN_SPEED / 2))).toBeLessThan(mean(full));
  });
});

describe('propSeed — a thing’s own number', () => {
  it('tells things on different tiles apart', () => {
    const seeds = new Set<number>();
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 20; y++) {
        seeds.add(propSeed(x, y));
      }
    }
    expect(seeds.size).toBe(600);
  });
});
