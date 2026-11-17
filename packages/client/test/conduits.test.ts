import { describe, expect, it } from 'vitest';
import type { ConduitView, MapView } from '@escapelab/core';
import { dressedFor } from '../src/world/artKit.js';
import {
  DUCT_E,
  DUCT_N,
  DUCT_S,
  DUCT_W,
  ductPieces,
  PULSE_STEP,
  pulseSpot,
} from '../src/world/conduits.js';
import { drawDuct } from '../src/world/ductArt.js';
import { AMBER } from '../src/world/palette.js';
import { glowSources, pulseSources } from '../src/world/sources.js';
import { callsOf, fakeCanvas } from './fakeCanvas.js';
import { mapWith } from './fixtures.js';
import { frameWith, lightWith, TILES } from './frames.js';

/**
 * The cable ducts as the world draws them: their tiles' channels, baked with the floor, and the
 * start pulse's light — where it stands at a moment, and where it shows.
 */

const T = 1_700_000_000_000;

/** A duct along row 2 of the frames' lab, from (1,2) to (8,2), under the doorway at (5,2). */
const TILES_ALONG = Array.from({ length: 8 }, (_, i) => ({ x: 1 + i, y: 2 }));

/** The duct with a pulse sent at T, at the far end after 7 s, dead there 3 s later. */
function duct(pulse: Partial<NonNullable<ConduitView['pulse']>> | null = {}): ConduitView {
  return {
    puzzleId: 'anlauf',
    tiles: TILES_ALONG,
    pulse:
      pulse === null
        ? null
        : { sentAt: T, arrivesAt: T + 7000, diesAt: T + 10_000, reversed: false, ...pulse },
  };
}

const lab = (conduits: ConduitView[]): MapView =>
  mapWith({ width: 10, height: 6, tiles: TILES, conduits });

describe('the duct’s tiles', () => {
  it('give each tile the sides its channel leaves by, a bend at a corner', () => {
    const bent = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ];
    const pieces = ductPieces([{ tiles: bent }], 10);
    expect([...pieces.values()]).toEqual([
      { x: 1, y: 1, links: DUCT_E },
      { x: 2, y: 1, links: DUCT_W | DUCT_S },
      { x: 2, y: 2, links: DUCT_N | DUCT_E },
      { x: 3, y: 2, links: DUCT_W },
    ]);
    expect(pieces.get(2 * 10 + 2)).toMatchObject({ x: 2, y: 2 });
  });

  it('are dressed with the map, and keep the floor’s marks off them', () => {
    const frame = frameWith({ map: lab([duct(null)]) });
    const { ducts, decals } = dressedFor(frame.kit.art, frame.map, 'probe');
    expect(ducts.size).toBe(8);
    expect([...decals.keys()].filter((i) => ducts.has(i))).toEqual([]);
  });

  it('bake as a channel with its grating inside the tile, in the tile’s light', () => {
    const { ctx, log } = fakeCanvas(64, 64, 'floor');
    drawDuct(ctx, { x: 3, y: 2, links: DUCT_E | DUCT_W }, false);
    const rects = callsOf(log, 'fillRect') as number[][];
    expect(rects.length).toBeGreaterThan(10);
    expect(callsOf(log, 'translate')).toEqual([[3, 2]]);
    // Every bar and box within the tile, its rim a hair over the channel at the most.
    for (const [x = 0, y = 0, w = 0, h = 0] of rects) {
      expect(x).toBeGreaterThanOrEqual(-0.04);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(1.04);
      expect(y + h).toBeLessThanOrEqual(1);
    }
  });
});

describe('the pulse’s spot', () => {
  it('runs from the first tile’s middle to the last’s in its travel, a step at a time', () => {
    expect(pulseSpot(duct(), T)).toEqual({ x: 1.5, y: 2.5, arrived: false });
    // Halfway: 3.5 tiles along a path of 7 from tile to tile.
    expect(pulseSpot(duct(), T + 3500)).toEqual({ x: 5, y: 2.5, arrived: false });
    const just = pulseSpot(duct(), T + 3500 + 100);
    expect((just?.x ?? 0) - 5).toBeLessThan(PULSE_STEP + 1e-9);
    expect(pulseSpot(duct(), T + 7000)).toEqual({ x: 8.5, y: 2.5, arrived: true });
    expect(pulseSpot(duct(), T + 9999)).toEqual({ x: 8.5, y: 2.5, arrived: true });
  });

  it('runs the other way round where the view says so', () => {
    expect(pulseSpot(duct({ reversed: true }), T)).toEqual({ x: 8.5, y: 2.5, arrived: false });
    expect(pulseSpot(duct({ reversed: true }), T + 7000)).toMatchObject({ x: 1.5 });
  });

  it('is nowhere without a pulse, before its sending and once it died', () => {
    expect(pulseSpot(duct(null), T)).toBeNull();
    expect(pulseSpot(duct(), T - 1)).toBeNull();
    expect(pulseSpot(duct(), T + 10_000)).toBeNull();
  });
});

describe('the pulse’s light', () => {
  it('burns amber where a figure has sight of its tile, swelling on the window', () => {
    const frame = frameWith({ map: lab([duct()]), now: T + 1000 });
    const [source] = pulseSources(frame);
    expect(source).toMatchObject({ x: 2.5, y: 2.5, colour: [...AMBER], pulse: { periodMs: 240 } });
    expect(glowSources(frame)).toContainEqual(source);
    const waiting = pulseSources({ ...frame, now: T + 8000 });
    expect(waiting[0]?.pulse?.periodMs).toBe(700);
  });

  it('shows nowhere out of sight — but in a lit room —, and never without a pulse', () => {
    const light = lightWith({ inSight: () => false });
    const blind = frameWith({ map: lab([duct()]), now: T + 1000, light });
    expect(pulseSources(blind)).toEqual([]);
    expect(pulseSources({ ...blind, litTiles: new Set(['2,2']) })).toHaveLength(1);
    expect(pulseSources(frameWith({ map: lab([duct(null)]), now: T + 1000 }))).toEqual([]);
  });

  it('swells slowly and shallowly where the player asked for less motion', () => {
    const frame = frameWith({ map: lab([duct()]), now: T + 1000, reduced: true });
    expect(pulseSources(frame)[0]?.pulse).toEqual({ periodMs: 2000, depth: 0.1 });
  });
});
