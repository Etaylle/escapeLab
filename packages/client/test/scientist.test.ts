import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawScientist, HELD_SCALE, type ScientistOpts } from '../src/world/art.js';
import { figurePose, restingPose, type FigurePose } from '../src/world/figure.js';
import { BLACK, rgba } from '../src/world/palette.js';
import { callsOf, fakeCanvas, FakePath2D, recording, setsOf, type Entry } from './fakeCanvas.js';

/** Anna standing in the lab, facing right. */
const ANNA: ScientistOpts = {
  color: '#2dd4bf',
  name: 'Anna',
  facing: 0,
  moving: false,
  walkPhase: 0,
  isYou: false,
  connected: true,
};

/** What drawScientist asks of a fresh context for Anna standing as `pose` says. */
function drawn(pose: Partial<FigurePose> | null, parts: Partial<ScientistOpts> = {}): Entry[] {
  const { ctx, log } = fakeCanvas();
  const look = { ...ANNA, ...parts };
  const posed = pose === null ? look : { ...look, pose: { ...restingPose(look.facing), ...pose } };
  drawScientist(ctx, posed);
  return log;
}

/** The index of the first call of `name` in `log` that `match` takes, or -1. */
function indexOf(log: readonly Entry[], name: string, match: (args: unknown[]) => boolean): number {
  return log.findIndex(
    (entry) => entry.kind === 'call' && entry.name === name && match(entry.args),
  );
}

/** The paths stroked or filled, in order, as what they were built of. */
function paths(log: readonly Entry[], name: 'stroke' | 'fill'): FakePath2D[] {
  return callsOf(log, name).flatMap(([path]) => (path instanceof FakePath2D ? [path] : []));
}

/** A path built as an arm: a capsule with a hand, the only path with two arcs and arcTo's. */
const isArm = (path: FakePath2D): boolean =>
  path.ops.some(([op]) => op === 'arcTo') && path.ops.some(([op]) => op === 'arc');

const same = (x: number, y: number) => (args: unknown[]) => args[0] === x && args[1] === y;

describe('drawScientist — a crew member standing as the pose says', () => {
  // The scientist's outlines are paths, built on first use.
  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('stands at rest facing its way where no pose is given', () => {
    expect(recording((c) => drawScientist(c, ANNA))).toEqual(
      recording((c) => drawScientist(c, { ...ANNA, pose: restingPose(0) })),
    );
    const log = drawn(null);
    expect(paths(log, 'stroke').filter(isArm)).toEqual([]);
    expect(callsOf(log, 'clip')).toEqual([]);
  });

  it('lifts the whole figure off its feet and squashes or stretches it about them', () => {
    const log = drawn({ rise: 0.1, stretch: 1.25 });
    const lift = indexOf(log, 'translate', same(0, -0.1));
    const squash = indexOf(log, 'scale', same(1 / 1.25, 1.25));
    const firstStroke = indexOf(log, 'stroke', (args) => args[0] instanceof FakePath2D);
    expect(lift).toBeGreaterThan(-1);
    expect(squash).toBe(lift + 1);
    expect(firstStroke).toBeGreaterThan(squash);
  });

  it('shrinks the shadow under a figure in the air', () => {
    const [ground] = callsOf(drawn(null), 'scale');
    const [air] = callsOf(drawn({ rise: 0.15, shadow: 0.6 }), 'scale');
    expect(ground).toEqual([0.3, 0.1]);
    expect(air?.[0]).toBeCloseTo(0.3 * 0.6, 9);
    expect(air?.[1]).toBeCloseTo(0.1 * 0.6, 9);
  });

  it('raises the body over its legs by its bob, and lets it sag', () => {
    expect(indexOf(drawn({ bob: 0.02 }), 'translate', same(0, -0.02))).toBeGreaterThan(-1);
    expect(indexOf(drawn({ bob: -0.03 }), 'translate', same(0, 0.03))).toBeGreaterThan(-1);
  });

  it('turns to the side it looks to — a glance over the shoulder mirrors it — and bows', () => {
    expect(callsOf(drawn({ look: 0.4 }), 'scale')).toContainEqual([1, 1]);
    expect(callsOf(drawn({ look: Math.PI - 0.3 }), 'scale')).toContainEqual([-1, 1]);
    expect(callsOf(drawn({ bow: 0.09 }), 'rotate')).toContainEqual([0.09]);
    expect(callsOf(drawn({ bow: 0.09 }, { moving: true }), 'rotate')).toContainEqual([0.09 + 0.06]);
  });

  it('draws both arms where the pose raises them, joined to the body’s outline', () => {
    const log = drawn({ arms: { front: 2.3, back: -2.1 } });
    expect(paths(log, 'stroke').filter(isArm)).toHaveLength(2);
    expect(paths(log, 'fill').filter(isArm)).toHaveLength(2);
    const rotations = callsOf(log, 'rotate').map(([angle]) => angle);
    expect(rotations.filter((angle) => angle === -2.3)).toHaveLength(2);
    expect(rotations.filter((angle) => angle === 2.1)).toHaveLength(2);
    // The outline pass strokes the arms before the body, the fill pass fills them before it.
    const strokes = paths(log, 'stroke');
    expect(strokes.findIndex(isArm)).toBe(0);
    const fills = paths(log, 'fill');
    expect(fills.findIndex(isArm)).toBeLessThan(fills.length - 2);
  });

  it('holds the item before its chest at HELD_SCALE, one hand behind it, one over it', () => {
    const { ctx, log } = fakeCanvas();
    const held = (c: CanvasRenderingContext2D): void => c.fillText('ITEM', 0, 0);
    const pose = figurePose({
      moving: false,
      facing: 0,
      carrying: 'fuse',
      speaking: false,
      alarmAgoMs: null,
      readyAgoMs: null,
      mood: 'play',
      t: 0,
      idleMs: 0,
      phase: 0,
      reduced: true,
    });
    drawScientist(ctx, { ...ANNA, name: '', pose, held });
    const item = indexOf(log, 'fillText', (args) => args[0] === 'ITEM');
    const scaled = log[item - 1];
    const placed = log[item - 2];
    expect(scaled).toMatchObject({ name: 'scale', args: [HELD_SCALE, HELD_SCALE] });
    expect(placed?.kind === 'call' && placed.name).toBe('translate');
    const [x = 0, y = 0] = placed?.kind === 'call' ? (placed.args as number[]) : [];
    // In front of the body (0.22 tiles to its edge), between its top and its feet.
    expect(x).toBeGreaterThan(0.22);
    expect(y).toBeLessThan(-0.3);
    expect(y).toBeGreaterThan(-0.6);
    // The arms and the body first, then the item, then the front hand over it.
    const isBody = (path: unknown): boolean =>
      path instanceof FakePath2D && path.ops.some(([op]) => op === 'quadraticCurveTo');
    const bodyFill = indexOf(log, 'fill', (args) => isBody(args[0]));
    expect(bodyFill).toBeGreaterThan(-1);
    expect(bodyFill).toBeLessThan(item);
    expect(paths(log.slice(0, item), 'fill').filter(isArm)).toHaveLength(2);
    const over = paths(log.slice(item), 'fill');
    expect(over).toHaveLength(1);
    expect(over[0]?.ops.map(([op]) => op)).toEqual(['moveTo', 'arc']);
  });

  it('draws nothing in its hands while it holds nothing', () => {
    const held = vi.fn();
    const { ctx } = fakeCanvas();
    drawScientist(ctx, { ...ANNA, pose: restingPose(0), held });
    expect(held).not.toHaveBeenCalled();
  });

  it('sweeps a light across the visor while speaking, clipped to the glass', () => {
    const log = drawn({ shimmer: 0.5 });
    expect(callsOf(log, 'clip')).toHaveLength(1);
    const sweep = (at: number): unknown[] =>
      recording((c) => drawScientist(c, { ...ANNA, pose: { ...restingPose(0), shimmer: at } }));
    expect(sweep(0.2)).not.toEqual(sweep(0.7));
  });

  it('dims the visor of a slumped figure and its glints with it', () => {
    const log = drawn({ dim: 0.6 });
    expect(setsOf(log, 'fillStyle')).toContain(rgba(BLACK, 0.7));
    const fills = log.filter((entry) => entry.kind === 'call' && entry.name === 'fill');
    const dimmed = (entry: Entry): boolean =>
      entry.kind === 'call' && Math.abs(entry.alpha - 0.6) < 1e-9;
    expect(fills.some(dimmed)).toBe(true);
    expect(setsOf(drawn(null), 'fillStyle')).not.toContain(rgba(BLACK, 0.7));
  });

  it('slides the visor back across the dome as the figure glances away', () => {
    const visorAt = (log: readonly Entry[]): number => {
      const strokes = callsOf(log, 'translate').filter(([, y]) => Number(y) < -0.5);
      return Number(strokes[0]?.[0]);
    };
    expect(visorAt(drawn(null))).toBeCloseTo(0.285, 9);
    expect(visorAt(drawn({ look: 0.9 }))).toBeLessThan(0.285);
  });
});
