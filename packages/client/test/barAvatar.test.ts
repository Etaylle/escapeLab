import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawAvatar } from '../src/screens/BarAccount.js';
import { fakeCanvas, FakePath2D, type Entry } from './fakeCanvas.js';

/**
 * The top bar's avatar (screens/BarAccount.tsx): the player's own figure's head in the account's
 * colour, framed in its square — the dome with its visor and the shoulders under it, the figure's
 * upper layer alone, none of its legs.
 */

/** A 2D transform as a context keeps it: a, b, c, d, e, f. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** A transform as a context's call gives it, its six numbers. */
const matrixOf = (args: readonly number[]): Matrix => [
  args[0] ?? 1,
  args[1] ?? 0,
  args[2] ?? 0,
  args[3] ?? 1,
  args[4] ?? 0,
  args[5] ?? 0,
];

/** The transform `m` with `n` applied within it, as a context applies a transform. */
function within(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

/** A drawing replayed: its transform, those it saved, and the points it laid on the canvas. */
interface Replay {
  m: Matrix;
  kept: Matrix[];
  points: number[][];
}

/** Lays the point `x`, `y` of a path, where it falls on the canvas under the replay's transform. */
function lay(r: Replay, x = 0, y = 0): void {
  const [a, b, c, d, e, f] = r.m;
  r.points.push([a * x + c * y + e, b * x + d * y + f]);
}

/** A circle's middle and its four ends, as points of a path. */
function round(r: Replay, [x = 0, y = 0, rx = 0, ry = rx]: number[]): void {
  for (const [dx, dy] of [[0, 0], [rx, 0], [-rx, 0], [0, ry], [0, -ry]] as const) {
    lay(r, x + dx, y + dy);
  }
}

/** A rectangle's corners, as points of a path. */
function corners(r: Replay, [x = 0, y = 0, w = 0, h = 0]: number[]): void {
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const) {
    lay(r, cx, cy);
  }
}

/** The ops of a path built apart (`Path2D`), laid where they fall under the replay's transform. */
function layPath(r: Replay, path: unknown): void {
  const ops = path instanceof FakePath2D ? path.ops : [];
  for (const [name, ...args] of ops) PATH[String(name)]?.(r, args as number[]);
}

/** What each step of a path lays down. */
const PATH: Record<string, (r: Replay, args: number[]) => void> = {
  moveTo: (r, [x, y]) => lay(r, x, y),
  lineTo: (r, [x, y]) => lay(r, x, y),
  arcTo: (r, [x1, y1, x2, y2]) => {
    lay(r, x1, y1);
    lay(r, x2, y2);
  },
  quadraticCurveTo: (r, [, , x, y]) => lay(r, x, y),
  bezierCurveTo: (r, [, , , , x, y]) => lay(r, x, y),
  arc: (r, [x = 0, y = 0, radius = 0]) => round(r, [x, y, radius, radius]),
  ellipse: (r, [x = 0, y = 0, rx = 0, ry = 0]) => round(r, [x, y, rx, ry]),
  rect: corners,
};

/** What each call of a context does to a replay; a call not here changes nothing of it. */
const REPLAY: Record<string, (r: Replay, args: number[]) => void> = {
  ...PATH,
  save: (r) => {
    r.kept.push(r.m);
  },
  restore: (r) => {
    r.m = r.kept.pop() ?? IDENTITY;
  },
  setTransform: (r, args) => {
    r.m = matrixOf(args);
  },
  transform: (r, args) => {
    r.m = within(r.m, matrixOf(args));
  },
  translate: (r, [x = 0, y = 0]) => {
    r.m = within(r.m, [1, 0, 0, 1, x, y]);
  },
  scale: (r, [x = 1, y = 1]) => {
    r.m = within(r.m, [x, 0, 0, y, 0, 0]);
  },
  rotate: (r, [turn = 0]) => {
    r.m = within(r.m, [Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn), 0, 0]);
  },
  fillRect: corners,
  strokeRect: corners,
  fill: (r, [path]) => layPath(r, path),
  stroke: (r, [path]) => layPath(r, path),
};

/** The points `log`'s drawing laid on its canvas, device px, replayed from its transforms. */
function pointsOf(log: readonly Entry[]): number[][] {
  const replay: Replay = { m: IDENTITY, kept: [], points: [] };
  for (const entry of log) {
    if (entry.kind === 'call') REPLAY[entry.name]?.(replay, entry.args as number[]);
  }
  return replay.points;
}

beforeEach(() => {
  vi.stubGlobal('Path2D', FakePath2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the bar’s avatar', () => {
  it('frames the figure’s head in its square, none of its legs: the dome at its top', () => {
    const px = 60;
    const { ctx, log } = fakeCanvas(px, px, 'avatar');
    drawAvatar(ctx, '#2dd4bf', px);
    const points = pointsOf(log);
    expect(points.length).toBeGreaterThan(20);
    const inside = points.filter(([x = -1, y = -1]) => x >= 0 && x <= px && y >= 0 && y <= px);
    expect(inside.length / points.length).toBeGreaterThan(0.5);
    // The dome's top stands in the square's top quarter, not out above it.
    const top = Math.min(...points.map(([, y = 0]) => y));
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(px / 4);
  });
});
