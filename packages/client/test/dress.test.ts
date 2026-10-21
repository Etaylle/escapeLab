import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission, type MapView } from '@escapelab/core';
import { dressMap, seedOf, type DressMap } from '../src/world/dress.js';
import {
  CORNER_NW,
  FLOOR_E,
  FLOOR_S,
  FLOOR_W,
  WORN_ACROSS,
} from '../src/world/surfaces.js';

/** A shipped mission's map as the dressing reads it. */
function shippedMap(name: string): DressMap {
  const mission = parseMission(
    JSON.parse(readFileSync(new URL(`../../../missions/${name}.json`, import.meta.url), 'utf8')),
  );
  const { map } = mission;
  return {
    width: map.tiles[0]?.length ?? 0,
    height: map.tiles.length,
    tiles: map.tiles,
    labels: map.labels.map((l) => ({
      text: l.text,
      x: l.x,
      y: l.y,
      ...(l.kind ? { kind: l.kind } : {}),
    })),
    doors: map.doors.map((d): MapView['doors'][number] => ({ ...d, open: false })),
    lamps: map.lamps,
    decor: map.decor.map((d) => ({ kind: d.kind, x: d.x, y: d.y })),
  };
}

const blackout = shippedMap('blackout');

describe('dressMap — every room dressed after its kind, the same every run', () => {
  it('dresses a map the same for the same mission, and otherwise for another', () => {
    const once = dressMap(blackout, seedOf('blackout'));
    const twice = dressMap(blackout, seedOf('blackout'));
    expect(twice).toEqual(once);
    const other = dressMap(blackout, seedOf('kunstprobe'));
    expect(other.props.map((p) => [p.x, p.y, p.kind, p.variant])).not.toEqual(
      once.props.map((p) => [p.x, p.y, p.kind, p.variant]),
    );
  });

  it('hangs every wall prop on a wall whose face looks down on floor, none on a floor tile', () => {
    for (const map of [blackout, shippedMap('systemcheck')]) {
      const { props } = dressMap(map, seedOf('blackout'));
      expect(props.length).toBeGreaterThan(10);
      for (const prop of props) {
        expect(map.tiles[prop.y]?.charAt(prop.x)).toBe('#');
        expect(map.tiles[prop.y + 1]?.charAt(prop.x)).toBe('.');
      }
    }
  });

  it('gives each floor tile the room of its nearest label: an open archive keeps its own', () => {
    const { kinds, rooms, width } = dressMap(blackout, seedOf('blackout'));
    const at = (x: number, y: number): [string | null | undefined, string | undefined] => [
      rooms[y * width + x],
      kinds[y * width + x],
    ];
    expect(at(3, 2)).toEqual(['ARCHIV', 'archive']);
    expect(at(3, 5)).toEqual(['FLUR', 'corridor']);
    expect(at(13, 2)).toEqual(['SERVERRAUM', 'server']);
    expect(at(2, 9)).toEqual(['MASCHINENRAUM', 'machine']);
    expect(at(15, 9)).toEqual(['REAKTOR', 'reactor']);
  });

  it('shows a wall with a face in the kind of the room it looks into, plain without one', () => {
    const { kinds, walls, width } = dressMap(blackout, seedOf('blackout'));
    // (8,2) is a pillar in the server room: floor east, west and south of it.
    expect(walls[2 * width + 8]).toBe(FLOOR_E | FLOOR_S | FLOOR_W | 1);
    expect(kinds[2 * width + 8]).toBe('server');
    // (0,5) is the outer wall west of the corridor: no face.
    expect(kinds[5 * width + 0]).toBe('plain');
  });

  it('dusts the corners, wears a band along a room’s length, stripes the core’s floor', () => {
    const { floor, width } = dressMap(blackout, seedOf('blackout'));
    const variants = [...floor];
    expect(variants).toContain(CORNER_NW);
    // The corridor runs east–west: its wear runs across.
    expect(variants.filter((v) => v === WORN_ACROSS).length).toBeGreaterThan(4);
    // The floor round the reactor's core at (15,8).
    expect(floor[9 * width + 14]).toBe(3);
    expect(floor[9 * width + 16]).toBe(3);
  });

  it('puts rack fronts on the server room’s pillars, warning stripes beside its doors', () => {
    const { props } = dressMap(blackout, seedOf('blackout'));
    const prop = (x: number, y: number): string | undefined =>
      props.find((p) => p.x === x && p.y === y)?.kind;
    for (const x of [8, 10, 12, 14]) {
      expect(prop(x, 2)).toBe('rack');
    }
    // The walls beside the Labor's door at (10,7) look into the Labor below.
    expect(prop(9, 7)).toBe('stripes');
    expect(prop(11, 7)).toBe('stripes');
  });

  it('hangs nothing on a wall an emergency lamp hangs on, and a clock once a room at most', () => {
    const { props } = dressMap(blackout, seedOf('blackout'));
    for (const lamp of blackout.lamps) {
      expect(props.some((p) => p.x === lamp.x && p.y === lamp.y)).toBe(false);
    }
    const clocks = props.filter((p) => p.kind === 'clock').map((p) => p.room);
    expect(new Set(clocks).size).toBe(clocks.length);
  });

  it('dresses a map without labels as one plain lab', () => {
    const plain = dressMap({ ...blackout, labels: [] }, 1);
    expect(new Set(plain.kinds)).toEqual(new Set(['plain']));
    expect(plain.rooms.every((room) => room === null)).toBe(true);
  });
});
