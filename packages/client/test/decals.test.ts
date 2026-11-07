import { describe, expect, it } from 'vitest';
import {
  ARROW_EVERY,
  DECAL_EVERY,
  DECALS_BY_KIND,
  decalsOf,
  stepsToExit,
  type Decal,
  type DecalGround,
} from '../src/world/decals.js';
import type { FloorKind } from '../src/world/surfaces.js';

/**
 * A 20 × 7 floor: a lab of 9 × 5 at the west, a corridor of 10 × 1 along row 3 east of it, the
 * exit at the corridor's east end (19, 3); a plate at (4, 2) and a shelf at (6, 4) taken.
 */
function ground(parts: Partial<DecalGround> = {}): DecalGround {
  const width = 20;
  const height = 7;
  const lab = (x: number, y: number) => x >= 1 && x <= 9 && y >= 1 && y <= 5;
  const corridor = (x: number, y: number) => x >= 10 && x <= 19 && y === 3;
  const kinds: FloorKind[] = [];
  const rooms: (string | null)[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      kinds.push(corridor(x, y) ? 'corridor' : 'lab');
      rooms.push(lab(x, y) ? 'LABOR' : corridor(x, y) ? 'FLUR' : null);
    }
  }
  return {
    width,
    height,
    seed: 7,
    floor: (x, y) => lab(x, y) || corridor(x, y),
    kinds,
    rooms,
    taken: new Set([2 * width + 4, 4 * width + 6]),
    fuseBoxes: [],
    exit: { x: 19, y: 3 },
    bands: new Map([
      ['LABOR', { across: true, middle: 3.5 }],
      ['FLUR', { across: true, middle: 3.5 }],
    ]),
    ...parts,
  };
}

/** The tile a decal lies on. */
const tileOf = (d: Decal) => [Math.floor(d.x), Math.floor(d.y)] as const;

describe('decalsOf — the marks on the floor', () => {
  it('lies on floor only, never on a taken tile, and never two on one tile', () => {
    const g = ground();
    const decals = decalsOf(g);
    const keys = decals.map((d) => tileOf(d).join(','));
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of decals) {
      const [x, y] = tileOf(d);
      expect(g.floor(x, y)).toBe(true);
      expect(g.taken.has(y * g.width + x)).toBe(false);
    }
  });

  it('scatters each room’s own marks on a free tile in DECAL_EVERY, the same every time', () => {
    const decals = decalsOf(ground());
    const clutter = decals.filter((d) => d.kind !== 'lane' && d.kind !== 'arrow');
    for (const d of clutter.filter((d) => tileOf(d)[0] <= 9)) {
      expect(DECALS_BY_KIND.lab).toContain(d.kind);
    }
    // Lived-in, not busy: about one in nine of the lab's 44 free tiles.
    expect(clutter.length).toBeGreaterThanOrEqual(1);
    expect(clutter.length).toBeLessThanOrEqual(Math.ceil((44 / DECAL_EVERY) * 3));
    expect(decalsOf(ground())).toEqual(decals);
    expect(decalsOf(ground({ seed: 8 }))).not.toEqual(decals);
  });

  it('paints a lane down the corridor, every ARROW_EVERY tiles an arrow to the exit', () => {
    const decals = decalsOf(ground()).filter((d) => tileOf(d)[0] >= 10);
    const lanes = decals.filter((d) => d.kind === 'lane');
    const arrows = decals.filter((d) => d.kind === 'arrow');
    expect(lanes.length + arrows.length).toBe(10);
    expect(arrows.map((d) => tileOf(d)[0])).toEqual([12, 18].filter((x) => x % ARROW_EVERY === 0));
    for (const arrow of arrows) {
      // East along the corridor, to the exit at its end.
      expect(arrow.angle).toBe(0);
    }
    expect(lanes.every((d) => d.angle === 0)).toBe(true);
  });

  it('lays scorch round a fuse box, on its free floor', () => {
    const decals = decalsOf(ground({ fuseBoxes: [{ x: 3, y: 0 }] }));
    const scorch = decals.filter((d) => d.kind === 'scorch');
    expect(scorch.map(tileOf)).toEqual([[3, 1]]);
  });

  it('paints no arrows on a map without an exit, only the lane', () => {
    const decals = decalsOf(ground({ exit: null }));
    expect(decals.some((d) => d.kind === 'arrow')).toBe(false);
    expect(decals.filter((d) => d.kind === 'lane')).toHaveLength(10);
  });
});

describe('stepsToExit — the way to the exit over the floor', () => {
  it('counts the steps from the exit, Infinity where no floor leads', () => {
    const g = ground();
    const steps = stepsToExit(g);
    expect(steps[3 * g.width + 19]).toBe(0);
    expect(steps[3 * g.width + 10]).toBe(9);
    expect(steps[0]).toBe(Infinity);
  });
});
