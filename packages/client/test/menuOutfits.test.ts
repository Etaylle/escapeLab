import { describe, expect, it } from 'vitest';
import { CREW } from '../src/world/palette.js';
import {
  companionColor,
  nextOutfits,
  OUTFITS,
  OUTFITS_KEY,
  PAIRS,
  visitOutfits,
  wearOf,
  type Outfit,
} from '../src/world/menu/outfits.js';
import { fakeCanvas, type Entry } from './fakeCanvas.js';

/**
 * The workwear of the menu's hero and its companion (world/menu/outfits.ts): which pair a visit
 * shows — the two never alike, another pair than the visit before — and that an outfit leaves
 * the body's colour, the player's crew colour, on the front of the body.
 */

type Point = readonly [number, number];

/** The points of a path a fake context was asked to lay: each curve by its ends, arcs sampled. */
function pointsOf(entry: Entry): Point[] {
  if (entry.kind !== 'call') return [];
  const a = entry.args as number[];
  const [x = 0, y = 0, w = 0, h = 0] = a;
  switch (entry.name) {
    case 'moveTo':
    case 'lineTo':
      return [[x, y]];
    case 'arcTo':
    case 'quadraticCurveTo':
      return [
        [x, y],
        [w, h],
      ];
    case 'rect':
    case 'fillRect':
      return [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
    case 'arc': {
      const [, , r = 0, from = 0, to = 0] = a;
      return Array.from({ length: 17 }, (_, k): Point => {
        const t = from + ((to - from) * k) / 16;
        return [x + r * Math.cos(t), y + r * Math.sin(t)];
      });
    }
    default:
      return [];
  }
}

/** Every shape `log` fills, as a polygon of the points its path was laid through. */
function filledShapes(log: readonly Entry[]): Point[][] {
  const shapes: Point[][] = [];
  let path: Point[] = [];
  for (const entry of log) {
    if (entry.kind !== 'call') continue;
    if (entry.name === 'beginPath') path = [];
    else if (entry.name === 'fill') shapes.push(path);
    else if (entry.name === 'fillRect') shapes.push(pointsOf(entry));
    else path.push(...pointsOf(entry));
  }
  return shapes;
}

/** Whether `p` lies inside the polygon `shape` (even-odd). */
function inside([px, py]: Point, shape: readonly Point[]): boolean {
  let within = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const [xi = 0, yi = 0] = shape[i] ?? [];
    const [xj = 0, yj = 0] = shape[j] ?? [];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

/**
 * Points of the figure's front, body space (art.ts: the body 0.22 either side of its middle, from
 * -0.82 at the dome's top to -0.15): the chest under the visor and the belly over the belt, which
 * every outfit leaves in the body's colour.
 */
const FRONT: readonly Point[] = [
  [0.16, -0.4],
  [0.12, -0.33],
  [0.17, -0.3],
];

describe('the outfits', () => {
  it('leave the front of the body in the player’s colour, whatever they lay', () => {
    for (const outfit of OUTFITS) {
      const { ctx, log } = fakeCanvas(10, 10, outfit);
      const wear = wearOf(outfit, 0.35);
      wear.body(ctx);
      wear.over(ctx);
      const shapes = filledShapes(log);
      expect(shapes.length, outfit).toBeGreaterThan(2);
      for (const point of FRONT) {
        const covering = shapes.filter((shape) => inside(point, shape));
        expect(covering, `${outfit} over ${point.join(', ')}`).toEqual([]);
      }
    }
  });

  it('are made once for each night', () => {
    expect(wearOf('coat', 0.35)).toBe(wearOf('coat', 0.35));
    expect(wearOf('coat', 0.5)).not.toBe(wearOf('coat', 0.35));
  });
});

describe('which pair a visit shows', () => {
  it('never dresses the hero and its companion alike, and holds every pair once', () => {
    expect(PAIRS).toHaveLength(OUTFITS.length * (OUTFITS.length - 1));
    const kept = new Set(PAIRS.map(({ hero, companion }) => `${hero}/${companion}`));
    expect(kept.size).toBe(PAIRS.length);
    for (const { hero, companion } of PAIRS) expect(companion).not.toBe(hero);
  });

  it('changes both figures from one visit to the next', () => {
    let last: string | null = null;
    const seen: { hero: Outfit; companion: Outfit }[] = [];
    for (let visit = 0; visit < 2 * PAIRS.length; visit++) {
      const pair = nextOutfits(last, 0.5);
      const before = seen.at(-1);
      if (before !== undefined) {
        expect(pair.hero).not.toBe(before.hero);
        expect(pair.companion).not.toBe(before.companion);
      }
      seen.push(pair);
      last = `${pair.hero}/${pair.companion}`;
    }
  });

  it('picks by chance where nothing, or no pair, was kept', () => {
    expect(nextOutfits(null, 0)).toEqual(PAIRS[0]);
    expect(nextOutfits('cape/boots', 0.99)).toEqual(PAIRS.at(-1));
  });

  it('keeps the pair shown, so that the next visit — a page loaded anew — shows another', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    } as Storage;
    const first = visitOutfits(storage);
    expect(store.get(OUTFITS_KEY)).toBe(`${first.hero}/${first.companion}`);
    const second = visitOutfits(storage);
    expect(second).not.toEqual(first);
    expect(second.hero).not.toBe(first.hero);
  });

  it('still shows a pair where the browser’s storage refuses it', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    const pair = visitOutfits(refusing);
    expect(pair.companion).not.toBe(pair.hero);
    const unkept = visitOutfits(null);
    expect(unkept.companion).not.toBe(unkept.hero);
  });
});

describe('the companion’s colour', () => {
  it('is another crew colour than the player’s, for every colour of the crew', () => {
    for (const color of CREW) {
      const other = companionColor(color, CREW);
      expect(other).not.toBe(color);
      expect(CREW).toContain(other);
    }
  });
});
