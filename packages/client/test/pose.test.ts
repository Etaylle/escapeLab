import { describe, expect, it } from 'vitest';
import { WALK_SPEED } from '../src/world/anim.js';
import {
  BREATH,
  BREATH_MS,
  FLINCH_MS,
  figurePhase,
  figurePose,
  flinchAt,
  GLANCE,
  GLANCE_MS,
  HOP,
  HOP_MS,
  IDLE_LOOK_MS,
  JUMP,
  JUMP_MS,
  jumpAt,
  restingPose,
  SAG,
  SHIMMER_MS,
  TALK_BOB,
  WAVE_MS,
  type FigurePose,
  type FigureState,
} from '../src/world/figure.js';

/** A crew member standing in the lab, facing right, nothing going on. */
const BASE: FigureState = {
  moving: false,
  facing: 0,
  carrying: null,
  speaking: false,
  alarmAgoMs: null,
  readyAgoMs: null,
  mood: 'play',
  t: 0,
  idleMs: 0,
  phase: 0,
  reduced: false,
};

const pose = (parts: Partial<FigureState>): FigurePose => figurePose({ ...BASE, ...parts });

/** `value(t)` every `step` ms from `from` up to `to`. */
function sampled(from: number, to: number, step: number, value: (t: number) => number): number[] {
  const out: number[] = [];
  for (let t = from; t < to; t += step) {
    out.push(value(t));
  }
  return out;
}

/** The glances of a figure standing still from `stillFrom` on, as [start, end) in ms. */
function glances(stillFrom: number, until: number, phase = 0.37): [number, number][] {
  const found: [number, number][] = [];
  let open: number | null = null;
  for (let t = 0; t < until; t += 10) {
    const look = pose({ t, phase, idleMs: Math.max(0, t - stillFrom), moving: t < stillFrom });
    const turned = Math.abs(look.look) > 1e-6;
    if (turned && open === null) {
      open = t;
    } else if (!turned && open !== null) {
      found.push([open, t]);
      open = null;
    }
  }
  return found;
}

/** The fastest a sampled curve changes, per second, over `step` ms samples. */
function fastest(values: number[], step: number): number {
  let top = 0;
  for (let i = 1; i < values.length; i++) {
    top = Math.max(top, (Math.abs((values[i] ?? 0) - (values[i - 1] ?? 0)) * 1000) / step);
  }
  return top;
}

describe('figurePose — standing, breathing, looking round', () => {
  it('breathes a pixel up and down every 3 s, and not while walking', () => {
    const bobs = sampled(0, 2 * BREATH_MS, 10, (t) => pose({ t }).bob);
    expect(Math.max(...bobs)).toBeCloseTo(BREATH, 4);
    expect(Math.min(...bobs)).toBeCloseTo(-BREATH, 4);
    for (const t of [0, 400, 1234, 2900]) {
      expect(pose({ t: t + BREATH_MS }).bob).toBeCloseTo(pose({ t }).bob, 9);
    }
    expect(pose({ t: 750 }).bob).not.toBeCloseTo(pose({ t: 0 }).bob, 4);
    expect(pose({ t: 750, moving: true })).toEqual(restingPose(0));
  });

  it('offsets every crew member into the loops by their id, the same on every screen', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'Xk9d-12', 'Xk9d-13'];
    const phases = ids.map(figurePhase);
    expect(new Set(phases).size).toBe(ids.length);
    for (const phase of phases) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
    expect(figurePhase('p1')).toBe(figurePhase('p1'));
    const bobs = phases.map((phase) => pose({ t: 1000, phase }).bob.toFixed(6));
    expect(new Set(bobs).size).toBe(ids.length);
  });

  it('looks round after 2 s still: a glance of 1.6 s to one side and back, every 4 to 7 s', () => {
    const found = glances(0, 120_000);
    expect(found.length).toBeGreaterThan(15);
    expect(found[0]?.[0]).toBeGreaterThanOrEqual(IDLE_LOOK_MS);
    for (const [start, end] of found) {
      expect(end - start).toBeGreaterThan(GLANCE_MS - 40);
      expect(end - start).toBeLessThanOrEqual(GLANCE_MS + 10);
    }
    for (let i = 1; i < found.length; i++) {
      const gap = (found[i]?.[0] ?? 0) - (found[i - 1]?.[0] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(4000 - 10);
      expect(gap).toBeLessThanOrEqual(7000 + 10);
    }
    const looks = sampled(0, 120_000, 10, (t) => pose({ t, phase: 0.37, idleMs: t }).look);
    expect(Math.max(...looks)).toBeCloseTo(GLANCE, 3);
    expect(Math.min(...looks)).toBeCloseTo(-GLANCE, 3);
  });

  it('looks round neither while walking nor before standing still for 2 s', () => {
    expect(glances(Number.POSITIVE_INFINITY, 60_000)).toEqual([]);
    const later = glances(30_000, 60_000);
    expect(later.length).toBeGreaterThan(0);
    expect(later[0]?.[0]).toBeGreaterThanOrEqual(30_000 + IDLE_LOOK_MS);
  });

  it('starts the glances of two of the crew at moments of their own', () => {
    const one = glances(0, 60_000, figurePhase('p1')).map(([start]) => start);
    const two = glances(0, 60_000, figurePhase('p2')).map(([start]) => start);
    expect(one).not.toEqual(two);
  });
});

describe('figurePose — speaking, carrying, a flinch', () => {
  it('sweeps a light across the visor every 0.6 s while speaking, the body bobbing 2 px', () => {
    const shimmer = (t: number): number => pose({ t, speaking: true }).shimmer ?? -1;
    for (const t of [0, 100, 299, 450]) {
      expect(shimmer(t)).toBeGreaterThanOrEqual(0);
      expect(shimmer(t)).toBeLessThan(1);
      expect(shimmer(t + SHIMMER_MS)).toBeCloseTo(shimmer(t), 9);
    }
    expect(shimmer(150)).toBeGreaterThan(shimmer(50));
    const bobs = sampled(0, SHIMMER_MS, 5, (t) => pose({ t, speaking: true }).bob);
    expect(Math.max(...bobs)).toBeCloseTo(TALK_BOB, 4);
    expect(Math.min(...bobs)).toBeCloseTo(0, 4);
    expect(pose({ t: 100 }).shimmer).toBeNull();
  });

  it('holds what it carries before the chest, both arms forward — walking too', () => {
    for (const parts of [{ carrying: 'fuse' }, { carrying: 'key', moving: true }] as const) {
      const holding = pose(parts);
      expect(holding.holding).toBe(true);
      for (const angle of [holding.arms?.front, holding.arms?.back]) {
        expect(angle).toBeGreaterThan(Math.PI / 4);
        expect(angle).toBeLessThan((3 * Math.PI) / 4);
      }
    }
    expect(pose({}).holding).toBe(false);
    expect(pose({}).arms).toBeNull();
  });

  it('flinches at an alarm: squashed, a 4 px hop stretched within 200 ms, back on its feet', () => {
    expect(flinchAt(0)).toEqual({ rise: 0, stretch: 1 });
    expect(flinchAt(40).rise).toBe(0);
    expect(flinchAt(40).stretch).toBeLessThan(0.9);
    expect(flinchAt(60).stretch).toBeGreaterThan(1.05);
    const rises = sampled(0, FLINCH_MS, 1, (ms) => flinchAt(ms).rise);
    expect(Math.max(...rises)).toBeCloseTo(HOP, 4);
    expect(rises.slice(HOP_MS).every((rise) => rise === 0)).toBe(true);
    expect(pose({ alarmAgoMs: 125 }).rise).toBeCloseTo(flinchAt(125).rise, 9);
    expect(pose({ alarmAgoMs: 125 }).shadow).toBeLessThan(1);
  });

  it('flings the arms up at an alarm and lowers them within 400 ms; none before or after', () => {
    expect(pose({ alarmAgoMs: 120 }).arms?.front).toBeGreaterThan(Math.PI / 2);
    expect(pose({ alarmAgoMs: 120 }).arms?.back).toBeLessThan(-Math.PI / 2);
    for (const ago of [null, -50, FLINCH_MS + 1, 5000]) {
      const calm = pose({ alarmAgoMs: ago, t: 0 });
      expect(calm.arms).toBeNull();
      expect(calm.rise).toBe(0);
      expect(calm.stretch).toBe(1);
    }
  });
});

describe('figurePose — the end of a run, the lobby', () => {
  it('jumps every 1.6 s for a run won, the shadow shrinking as it rises, the arms up', () => {
    const rises = sampled(0, 2 * JUMP_MS, 5, (t) => pose({ t, mood: 'celebrate' }).rise);
    expect(Math.max(...rises)).toBeCloseTo(JUMP, 4);
    expect(Math.min(...rises)).toBe(0);
    for (const t of [0, 200, 600, 1000, 1500]) {
      const now = pose({ t, mood: 'celebrate' });
      expect(pose({ t: t + JUMP_MS, mood: 'celebrate' }).rise).toBeCloseTo(now.rise, 9);
      expect(now.shadow).toBeCloseTo(1 - (0.45 * now.rise) / JUMP, 9);
      expect(now.arms?.front).toBeGreaterThan(Math.PI / 2);
      expect(now.arms?.back).toBeLessThan(-Math.PI / 2);
    }
    const fronts = sampled(0, JUMP_MS, 50, (t) => pose({ t, mood: 'celebrate' }).arms?.front ?? 0);
    expect(Math.max(...fronts) - Math.min(...fronts)).toBeGreaterThan(0.25);
  });

  it('crouches, flies, lands and stands within each jump', () => {
    expect(jumpAt(0.06).rise).toBe(0);
    expect(jumpAt(0.06).stretch).toBeLessThan(1);
    expect(jumpAt(0.37).rise).toBeCloseTo(JUMP, 9);
    expect(jumpAt(0.15).stretch).toBeGreaterThan(1);
    expect(jumpAt(0.64).rise).toBe(0);
    expect(jumpAt(0.64).stretch).toBeLessThan(1);
    expect(jumpAt(0.9)).toEqual({ rise: 0, stretch: 1 });
    expect(jumpAt(0.2).rise).toBeLessThan(jumpAt(0.3).rise);
    expect(jumpAt(0.5).rise).toBeGreaterThan(jumpAt(0.6).rise);
  });

  it('slumps over a run lost: sagged 2 px, bowed, the visor dimmed, the arms down', () => {
    for (const t of [0, 900, 4000]) {
      const slumped = pose({ t, idleMs: t + 10_000, mood: 'slump' });
      expect(slumped.bob).toBeCloseTo(-SAG, 9);
      expect(slumped.bow).toBeGreaterThan(0);
      expect(slumped.dim).toBeGreaterThan(0);
      expect(slumped.arms).toBeNull();
      expect(slumped.rise).toBe(0);
      expect(slumped.look).toBe(0);
    }
  });

  it('waves for 1.8 s once its player says ready, then lets the arm down', () => {
    const front = (ms: number): number => pose({ readyAgoMs: ms }).arms?.front ?? 0;
    const fronts = sampled(350, WAVE_MS - 450, 25, front);
    expect(Math.min(...fronts)).toBeGreaterThan(Math.PI / 2);
    expect(Math.max(...fronts) - Math.min(...fronts)).toBeGreaterThan(0.25);
    expect(pose({ readyAgoMs: WAVE_MS }).arms).toBeNull();
    expect(pose({ readyAgoMs: null }).arms).toBeNull();
  });

  it('moves nothing faster than a walking crew member, but the flinch', () => {
    const step = 5;
    const curves = [
      sampled(0, 6000, step, (t) => pose({ t }).bob),
      sampled(0, 2000, step, (t) => pose({ t, speaking: true }).bob),
      sampled(0, 4000, step, (t) => pose({ t, mood: 'celebrate' }).rise),
      // A hand at the end of an arm a third of a tile long.
      sampled(0, 4000, step, (t) => (pose({ t, mood: 'celebrate' }).arms?.front ?? 0) / 3),
      sampled(0, WAVE_MS, step, (ms) => (pose({ readyAgoMs: ms }).arms?.front ?? 0) / 3),
      // The visor sliding across a dome a fifth of a tile round.
      sampled(0, 60_000, step, (t) => pose({ t, idleMs: t, phase: 0.37 }).look / 5),
    ];
    for (const curve of curves) {
      expect(fastest(curve, step)).toBeLessThan(WALK_SPEED);
    }
  });
});

describe('figurePose — under reduced motion', () => {
  const still = (parts: Partial<FigureState>): FigurePose[] =>
    [0, 120, 777, 2500, 9000].map((t) =>
      pose({ ...parts, t, idleMs: t + 60_000, reduced: true }),
    );

  it('holds every pose still at its resting frame', () => {
    for (const parts of [
      {},
      { speaking: true },
      { alarmAgoMs: 120 },
      { readyAgoMs: 500 },
      { phase: 0.37 },
    ]) {
      for (const frame of still(parts)) {
        expect(frame).toEqual(restingPose(0));
      }
    }
  });

  it('still holds what it carries, raises the arms of a run won once, slumps over one lost', () => {
    for (const frame of still({ carrying: 'crate' })) {
      const { arms } = pose({ carrying: 'crate' });
      expect(frame).toEqual({ ...restingPose(0), holding: true, arms });
    }
    const [cheer, ...rest] = still({ mood: 'celebrate' });
    expect(cheer?.rise).toBe(0);
    expect(cheer?.stretch).toBe(1);
    expect(cheer?.arms?.front).toBeGreaterThan(Math.PI / 2);
    expect(cheer?.arms?.back).toBeLessThan(-Math.PI / 2);
    for (const frame of rest) {
      expect(frame).toEqual(cheer);
    }
    for (const frame of still({ mood: 'slump' })) {
      expect(frame).toEqual(pose({ mood: 'slump' }));
    }
  });
});
