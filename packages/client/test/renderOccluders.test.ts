import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MapView } from '@escapelab/core';
import { RISE } from '../src/world/depth.js';
import { draw as drawActors } from '../src/world/render/actors.js';
import { occlude, tallsOf } from '../src/world/render/occluders.js';
import { callEntries, callsOf, fakeCanvas, FakePath2D, type Entry } from './fakeCanvas.js';
import { mapWith } from './fixtures.js';
import { frameWith, lightWith, TILES } from './frames.js';

/**
 * The 10×6 lab of frames.ts with a shelf at (2, 3), a rack at (7, 3), a locker at (7, 1) and a
 * pillar standing free at (6, 2) — floor all round it.
 */
function lab(): MapView {
  const tiles = [...TILES];
  tiles[2] = '#.....#..#';
  return mapWith({
    width: 10,
    height: 6,
    tiles,
    decor: [
      { kind: 'shelf', x: 2, y: 3, variant: 1 },
      { kind: 'rack', x: 7, y: 3, variant: 0 },
      { kind: 'bench', x: 4, y: 1, variant: 0 },
    ],
    manuals: [
      {
        id: 'spind',
        kind: 'locker',
        x: 7,
        y: 1,
        known: true,
        opened: false,
        label: 'SPIND',
        covers: [],
        needsKey: null,
      },
    ] as unknown as MapView['manuals'],
  });
}

/** The shelf's sprite drawn again: a drawImage onto (2, 3 - RISE), its full height. */
function shelfAgain(log: readonly Entry[]): Extract<Entry, { kind: 'call' }>[] {
  return callEntries(log, 'drawImage').filter(
    (e) => e.args[1] === 2 && e.args[2] === 3 - RISE && e.args[4] === 1 + RISE,
  );
}

describe('tallsOf — the tall things of a map', () => {
  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('finds the shelves and racks, a locker, and the pillars standing free — no bench', () => {
    const talls = tallsOf(frameWith({ map: lab() }));
    expect(talls).toContainEqual({ x: 2, y: 3, rise: RISE, of: 'decor' });
    expect(talls).toContainEqual({ x: 7, y: 3, rise: RISE, of: 'decor' });
    expect(talls).toContainEqual({ x: 7, y: 1, rise: RISE, of: 'source' });
    expect(talls).toContainEqual({ x: 6, y: 2, rise: RISE, of: 'pillar' });
    expect(talls.some((t) => t.x === 4 && t.y === 1)).toBe(false);
    // The walls round the lab are no pillars.
    expect(talls.filter((t) => t.of === 'pillar')).toHaveLength(1);
  });
});

describe('the painter’s y-sort — a figure behind a tall thing and one in front of it', () => {
  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('draws the shelf again over a figure behind it, cut to where it hides it', () => {
    // You stand in the aisle north of the shelf, your feet at 2.85.
    const frame = frameWith({ map: lab(), self: { x: 2.5, y: 2.55, facing: 0, moving: false } });
    const { ctx, log } = fakeCanvas(800, 600);
    drawActors(ctx, frame);
    const figureAt = log.findIndex(
      (e) => e.kind === 'call' && e.name === 'translate' && e.args[0] === 2.5,
    );
    const [again] = shelfAgain(log);
    expect(again).toBeDefined();
    expect(log.indexOf(again as Entry)).toBeGreaterThan(figureAt);
    // Cut to the overlap of the shelf's part over its tile and the figure, on whole pixels:
    // the shelf's top at 2.5 tiles, 50 px a half-tile under the camera's middle at 3.
    const [rect] = callsOf(log, 'rect');
    expect(rect?.[1]).toBe(250);
    expect(callsOf(log, 'clip')).toEqual([['evenodd']]);
  });

  it('draws nothing again over a figure standing in front of the shelf', () => {
    const frame = frameWith({ map: lab(), self: { x: 2.5, y: 4.4, facing: 0, moving: false } });
    const { ctx, log } = fakeCanvas(800, 600);
    drawActors(ctx, frame);
    expect(shelfAgain(log)).toEqual([]);
    expect(callsOf(log, 'clip')).toEqual([]);
  });

  it('draws nothing again for a shelf the world does not show', () => {
    const light = lightWith({ shown: (x) => x !== 2 });
    const frame = frameWith({
      map: lab(),
      light,
      self: { x: 2.5, y: 2.55, facing: 0, moving: false },
    });
    const { ctx, log } = fakeCanvas(800, 600);
    drawActors(ctx, frame);
    expect(shelfAgain(log)).toEqual([]);
  });

  it('leaves a label clear of what it draws again', () => {
    const frame = frameWith({ map: lab() });
    const { ctx, log } = fakeCanvas(800, 600);
    const box = { left: 2, top: 1.5, right: 3, bottom: 3.2 };
    const label = { left: 1.5, top: 2.9, right: 3.5, bottom: 3.1 };
    occlude(ctx, frame, box, 2.5, [label]);
    // The overlap, and the label's part of it cut out of it again (even-odd).
    expect(callsOf(log, 'rect')).toHaveLength(2);
    expect(callsOf(log, 'clip')).toEqual([['evenodd']]);
    expect(shelfAgain(log)).toHaveLength(1);
  });
});
