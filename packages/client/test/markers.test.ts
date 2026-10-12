import { describe, expect, it } from 'vitest';
import type { MapView } from '@escapelab/core';
import {
  markerTargets,
  placeMarker,
  placeMarkers,
  type MarkerPlacement,
  type MarkerPoint,
} from '../src/world/markers.js';
import { mapWith, type Manual } from './fixtures.js';

const YOU = 'p1';
/** Where the player stands, mid-lab; it only matters between the two consoles of a station. */
const HERE = { x: 10.5, y: 6.5 };

function station(x: number, y: number, status: MapView['stations'][number]['status']) {
  return { puzzleId: 'notstrom', x, y, title: 'Notstrom', status };
}

function item(parts: Partial<MapView['items'][number]>): MapView['items'][number] {
  return {
    id: 'fuse',
    label: 'Sicherung',
    x: 3,
    y: 4,
    carriedBy: null,
    delivered: false,
    deliverTo: { x: 9, y: 2 },
    requiredForTitle: null,
    ...parts,
  };
}

describe('markerTargets — what the player is pointed at', () => {
  it('points at the armed station, not the solved or locked ones', () => {
    const map = mapWith({
      stations: [station(1, 1, 'done'), station(5, 9, 'armed'), station(8, 2, 'locked')],
    });
    expect(markerTargets(map, YOU, HERE)).toEqual([
      { x: 5.5, y: 9.5, color: '#2dd4bf', label: 'STATION' },
    ]);
  });

  it('points at the nearer console of a station with two, named by its console', () => {
    const locker: Manual = {
      id: 'spind',
      kind: 'locker',
      x: 8,
      y: 1,
      label: 'SPIND',
      puzzleIds: ['notstrom'],
      opened: true,
      needsKey: null,
    };
    const map = mapWith({
      stations: [
        { ...station(2, 9, 'armed'), console: 'a' },
        { ...station(15, 9, 'armed'), console: 'b' },
      ],
      manuals: [locker],
    });
    const lesen = { x: 8.5, y: 1.5, color: '#60a5fa', label: 'LESEN' };
    expect(markerTargets(map, YOU, { x: 4.5, y: 2.5 })).toEqual([
      { x: 2.5, y: 9.5, color: '#2dd4bf', label: 'PULT A' },
      lesen,
    ]);
    expect(markerTargets(map, YOU, { x: 13.5, y: 2.5 })).toEqual([
      { x: 15.5, y: 9.5, color: '#2dd4bf', label: 'PULT B' },
      lesen,
    ]);
  });

  it('shows nothing once every station is done', () => {
    const map = mapWith({ stations: [station(1, 1, 'done')] });
    expect(markerTargets(map, YOU, HERE)).toEqual([]);
  });

  it('shows a loose part and the station together — two legs of one trip', () => {
    const map = mapWith({ stations: [station(5, 9, 'armed')], items: [item({ x: 3, y: 4 })] });
    expect(markerTargets(map, YOU, HERE).map((t) => t.label)).toEqual(['TEIL', 'STATION']);
  });

  it('points at every manual object printing the armed station, blue like a part', () => {
    const book: Manual = {
      id: 'buch',
      kind: 'book',
      x: 2,
      y: 3,
      label: 'HANDBUCH',
      puzzleIds: ['frequenz', 'notstrom'],
      opened: true,
      needsKey: null,
    };
    const elsewhere: Manual = {
      ...book,
      id: 'plan',
      kind: 'terminal',
      x: 8,
      puzzleIds: ['frequenz'],
    };
    const map = mapWith({ stations: [station(5, 9, 'armed')], manuals: [book, elsewhere] });
    expect(markerTargets(map, YOU, HERE)).toEqual([
      { x: 5.5, y: 9.5, color: '#2dd4bf', label: 'STATION' },
      { x: 2.5, y: 3.5, color: '#60a5fa', label: 'LESEN' },
    ]);
  });

  it('points at no manual object once every station is done, or while hands are full', () => {
    const book: Manual = {
      id: 'buch',
      kind: 'book',
      x: 2,
      y: 3,
      label: 'HANDBUCH',
      puzzleIds: ['notstrom'],
      opened: true,
      needsKey: null,
    };
    const done = mapWith({ stations: [station(5, 9, 'done')], manuals: [book] });
    expect(markerTargets(done, YOU, HERE)).toEqual([]);
    const carrying = mapWith({
      stations: [station(5, 9, 'armed')],
      manuals: [book],
      items: [item({ carriedBy: YOU })],
    });
    expect(markerTargets(carrying, YOU, HERE).map((t) => t.label)).toEqual(['ABGABE']);
  });

  it('switches to the drop-off once you pick the part up, and drops the station', () => {
    const map = mapWith({
      stations: [station(5, 9, 'armed')],
      items: [item({ carriedBy: YOU, deliverTo: { x: 9, y: 2 } })],
    });
    expect(markerTargets(map, YOU, HERE)).toEqual([
      { x: 9.5, y: 2.5, color: '#60a5fa', label: 'ABGABE' },
    ]);
  });

  it('keeps pointing at the part while someone else carries it', () => {
    const map = mapWith({ items: [item({ carriedBy: 'p2' })] });
    expect(markerTargets(map, YOU, HERE)).toEqual([]);
  });

  it('points at no key before its cabinet is found', () => {
    const key = item({ id: 'key', label: 'SCHLÜSSEL', deliverTo: null });
    const hidden = mapWith({ stations: [station(5, 9, 'armed')], items: [key] });
    expect(markerTargets(hidden, YOU, HERE).map((t) => t.label)).toEqual(['STATION']);
    const found = mapWith({
      stations: [station(5, 9, 'armed')],
      items: [{ ...key, deliverTo: { x: 8, y: 5 } }],
    });
    expect(markerTargets(found, YOU, HERE).map((t) => t.label)).toEqual(['TEIL', 'STATION']);
  });

  it('ignores a part that has already been delivered', () => {
    const map = mapWith({ items: [item({ delivered: true })] });
    expect(markerTargets(map, YOU, HERE)).toEqual([]);
  });

  it('points at the exit once it opens', () => {
    const map = mapWith({ exit: { x: 18, y: 6, open: true }, items: [item({})] });
    expect(markerTargets(map, YOU, HERE)).toEqual([
      { x: 18.5, y: 6.5, color: '#4ade80', label: 'AUSGANG' },
    ]);
  });

  it('ignores a closed exit', () => {
    const map = mapWith({ exit: { x: 18, y: 6, open: false } });
    expect(markerTargets(map, YOU, HERE)).toEqual([]);
  });

  it('an emergency overrides everything and shows every valve at once', () => {
    const map = mapWith({
      exit: { x: 18, y: 6, open: true },
      items: [item({ carriedBy: YOU })],
      stations: [station(5, 9, 'armed')],
      sabotage: {
        label: 'Druckabfall',
        hint: 'Ventile halten',
        endsAt: 0,
        panels: [
          { id: 'a', x: 2, y: 2, occupied: false },
          { id: 'b', x: 7, y: 8, occupied: true },
        ],
      },
    });
    expect(markerTargets(map, YOU, HERE)).toEqual([
      { x: 2.5, y: 2.5, color: '#f87171', label: 'VENTIL' },
      { x: 7.5, y: 8.5, color: '#2dd4bf', label: 'VENTIL' },
    ]);
  });

  it('turns a valve teal once someone stands on it', () => {
    const panels = [{ id: 'a', x: 2, y: 2, occupied: true }];
    const map = mapWith({
      sabotage: { label: '', hint: '', endsAt: 0, panels },
    });
    expect(markerTargets(map, YOU, HERE)[0]?.color).toBe('#2dd4bf');
  });
});

describe('placeMarker — where the arrow lands', () => {
  // A 1000x600 canvas with a 80px objective bar lying across its top.
  const W = 1000;
  const H = 600;
  const BAR = 80;

  it('draws nothing while the target is on screen', () => {
    expect(placeMarker(500, 300, W, H, BAR, 1)).toBeNull();
    expect(placeMarker(0, 0, W, H, BAR, 1)).toBeNull();
    expect(placeMarker(W, H, W, H, BAR, 1)).toBeNull();
  });

  it('clears the objective bar when the target is above the frame', () => {
    const at = placeMarker(500, -400, W, H, BAR, 1);
    expect(at?.y).toBe(BAR + 16);
    // and the caption below it stays clear too
    expect(at?.captionY).toBeGreaterThan(BAR);
  });

  it('scales the bar clearance with the device pixel ratio', () => {
    const at = placeMarker(500, -400, W * 2, H * 2, BAR, 2);
    expect(at?.y).toBe((BAR + 16) * 2);
  });

  it('keeps the plain 34px margin on the other three sides', () => {
    expect(placeMarker(-50, 300, W, H, BAR, 1)?.x).toBe(34);
    expect(placeMarker(9999, 300, W, H, BAR, 1)?.x).toBe(W - 34);
    expect(placeMarker(500, 9999, W, H, BAR, 1)?.y).toBe(H - 34);
  });

  it('falls back to the margin when there is no bar', () => {
    expect(placeMarker(500, -400, W, H, 0, 1)?.y).toBe(34);
  });

  it('flips the caption above the arrow near the bottom edge', () => {
    const below = placeMarker(500, 9999, W, H, BAR, 1);
    expect(below?.captionY).toBeLessThan(below?.y ?? 0);
    const above = placeMarker(500, -400, W, H, BAR, 1);
    expect(above?.captionY).toBeGreaterThan(above?.y ?? 0);
  });

  it('points away from the centre, towards the target', () => {
    // atan2 is measured from the +x axis, clockwise on a canvas.
    expect(placeMarker(9999, 300, W, H, BAR, 1)?.angle).toBeCloseTo(0);
    expect(placeMarker(500, 9999, W, H, BAR, 1)?.angle).toBeCloseTo(Math.PI / 2);
    expect(placeMarker(-50, 300, W, H, BAR, 1)?.angle).toBeCloseTo(Math.PI);
    expect(placeMarker(500, -400, W, H, BAR, 1)?.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('never leaves the frame, wherever the target is', () => {
    for (const px of [-5000, -1, 0, 500, W, W + 1, 5000]) {
      for (const py of [-5000, -1, 0, 300, H, H + 1, 5000]) {
        const at = placeMarker(px, py, W, H, BAR, 1);
        if (at === null) {
          continue;
        }
        expect(at.x).toBeGreaterThanOrEqual(34);
        expect(at.x).toBeLessThanOrEqual(W - 34);
        expect(at.y).toBeGreaterThanOrEqual(34);
        expect(at.y).toBeLessThanOrEqual(H - 34);
      }
    }
  });
});

describe('placeMarkers — targets in the same direction', () => {
  // A phone's world: 400x560, the objective bar 80px over its top.
  const W = 400;
  const H = 560;
  const BAR = 80;
  /** „LESEN 12m" in 11px mono */
  const CAPTION = 60;

  type Box = { left: number; right: number; top: number; bottom: number };

  /** What an arrow and its caption cover, as GameWorld draws them. */
  function boxes(at: MarkerPlacement, captionWidth: number): Box[] {
    return [
      { left: at.x - 13, right: at.x + 13, top: at.y - 13, bottom: at.y + 13 },
      {
        left: at.x - captionWidth / 2,
        right: at.x + captionWidth / 2,
        top: at.captionY - 8,
        bottom: at.captionY + 3,
      },
    ];
  }

  function covers(a: Box, b: Box): boolean {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }

  /** Placed markers whose arrow or caption covers another one's. */
  function clashes(points: MarkerPoint[]): number {
    const placed = placeMarkers(points, W, H, BAR, 1).map((at, i) =>
      at === null ? [] : boxes(at, points[i]?.captionWidth ?? 0),
    );
    let count = 0;
    placed.forEach((mine, i) =>
      placed.slice(i + 1).forEach((theirs) => {
        count += Number(mine.some((a) => theirs.some((b) => covers(a, b))));
      }),
    );
    return count;
  }

  const at = (px: number, py: number): MarkerPoint => ({ px, py, captionWidth: CAPTION });

  it('pins them as placeMarker does, one by one', () => {
    const points = [at(-300, 200), at(200, -100), at(200, 300)];
    expect(placeMarkers(points, W, H, BAR, 1)).toEqual(
      points.map((p) => placeMarker(p.px, p.py, W, H, BAR, 1)),
    );
  });

  it('stacks two on a side: the second arrow clear of the first one’s caption', () => {
    const [teil, lesen] = placeMarkers([at(-300, 200), at(-100, 205)], W, H, BAR, 1);
    expect(teil?.y).toBe(200);
    expect((lesen?.y ?? 0) - 13).toBeGreaterThan(teil?.captionY ?? Infinity);
    expect(lesen?.captionY).toBe((lesen?.y ?? 0) + 26);
    expect(lesen?.x).toBe(34);
  });

  it('lets none cover another, however they bunch on one edge', () => {
    const left = [210, 200, 205, 215].map((py) => at(-200, py));
    const middle = [at(-200, 275), at(-200, 285)];
    const bottom = [at(-200, 520), at(-200, 530), at(-200, 900)];
    const top = [190, 200, 215].map((px) => at(px, -300));
    const below = [10, 20].map((px) => at(px, 900));
    for (const points of [left, middle, bottom, top, below]) {
      expect(clashes(points)).toBe(0);
    }
  });

  it('keeps every arrow on its edge inside the frame, backing a stack up from the end', () => {
    const placed = placeMarkers([at(-200, 520), at(-200, 530)], W, H, BAR, 1);
    expect(placed.every((p) => p !== null && p.y <= H - 34 && p.x === 34)).toBe(true);
    const wide = placeMarkers([at(380, -300), at(390, -300)], W, H, BAR, 1);
    expect(wide.every((p) => p !== null && p.x <= W - 34 && p.y === BAR + 16)).toBe(true);
  });

  it('moves nothing that keeps clear already, or lies on another edge', () => {
    const apart = [at(-300, 120), at(-300, 400), at(200, -300), at(W + 50, 125)];
    expect(placeMarkers(apart, W, H, BAR, 1)).toEqual(
      apart.map((p) => placeMarker(p.px, p.py, W, H, BAR, 1)),
    );
  });

  it('scales the room it keeps with the device pixel ratio', () => {
    const points = [at(-600, 400), at(-200, 410)].map((p) => ({ ...p, captionWidth: 120 }));
    const [first, second] = placeMarkers(points, W * 2, H * 2, BAR, 2);
    expect((second?.y ?? 0) - (first?.y ?? 0)).toBe((13 + 26 + 3 + 4) * 2);
  });
});
