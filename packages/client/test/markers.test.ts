import { describe, expect, it } from 'vitest';
import type { MapView } from '@escapelab/core';
import { markerTargets, placeMarker } from '../src/world/markers.js';

const YOU = 'p1';

function mapWith(parts: Partial<MapView>): MapView {
  return {
    width: 20,
    height: 13,
    tiles: [],
    yourSpawn: { x: 1, y: 1 },
    doors: [],
    plates: [],
    stations: [],
    labels: [],
    exit: null,
    items: [],
    sabotage: null,
    ...parts,
  };
}

function station(x: number, y: number, status: MapView['stations'][number]['status']) {
  return { x, y, title: 'Notstrom', status };
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
    expect(markerTargets(map, YOU)).toEqual([
      { x: 5.5, y: 9.5, color: '#2dd4bf', label: 'STATION' },
    ]);
  });

  it('shows nothing once every station is done', () => {
    const map = mapWith({ stations: [station(1, 1, 'done')] });
    expect(markerTargets(map, YOU)).toEqual([]);
  });

  it('shows a loose part and the station together — two legs of one trip', () => {
    const map = mapWith({ stations: [station(5, 9, 'armed')], items: [item({ x: 3, y: 4 })] });
    expect(markerTargets(map, YOU).map((t) => t.label)).toEqual(['TEIL', 'STATION']);
  });

  it('switches to the drop-off once you pick the part up, and drops the station', () => {
    const map = mapWith({
      stations: [station(5, 9, 'armed')],
      items: [item({ carriedBy: YOU, deliverTo: { x: 9, y: 2 } })],
    });
    expect(markerTargets(map, YOU)).toEqual([
      { x: 9.5, y: 2.5, color: '#60a5fa', label: 'ABGABE' },
    ]);
  });

  it('keeps pointing at the part while someone else carries it', () => {
    const map = mapWith({ items: [item({ carriedBy: 'p2' })] });
    expect(markerTargets(map, YOU)).toEqual([]);
  });

  it('ignores a part that has already been delivered', () => {
    const map = mapWith({ items: [item({ delivered: true })] });
    expect(markerTargets(map, YOU)).toEqual([]);
  });

  it('points at the exit once it opens', () => {
    const map = mapWith({ exit: { x: 18, y: 6, open: true }, items: [item({})] });
    expect(markerTargets(map, YOU)).toEqual([
      { x: 18.5, y: 6.5, color: '#4ade80', label: 'AUSGANG' },
    ]);
  });

  it('ignores a closed exit', () => {
    const map = mapWith({ exit: { x: 18, y: 6, open: false } });
    expect(markerTargets(map, YOU)).toEqual([]);
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
    expect(markerTargets(map, YOU)).toEqual([
      { x: 2.5, y: 2.5, color: '#f87171', label: 'VENTIL' },
      { x: 7.5, y: 8.5, color: '#2dd4bf', label: 'VENTIL' },
    ]);
  });

  it('turns a valve teal once someone stands on it', () => {
    const panels = [{ id: 'a', x: 2, y: 2, occupied: true }];
    const map = mapWith({
      sabotage: { label: '', hint: '', endsAt: 0, panels },
    });
    expect(markerTargets(map, YOU)[0]?.color).toBe('#2dd4bf');
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
