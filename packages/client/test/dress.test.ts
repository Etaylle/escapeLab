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
    expect(at(3, 3)).toEqual(['ARCHIV', 'archive']);
    expect(at(4, 7)).toEqual(['ARCHIV', 'archive']);
    expect(at(4, 8)).toEqual(['FLUR', 'corridor']);
    expect(at(13, 3)).toEqual(['SERVERRAUM', 'server']);
    expect(at(3, 16)).toEqual(['MASCHINENRAUM', 'machine']);
    expect(at(28, 17)).toEqual(['REAKTOR', 'reactor']);
    // The Ost-Flur opens on the Serverraum through an archway two tiles wide, and keeps its own
    // floor too: the archway the Serverraum's, the corridor's from the tile past it.
    expect(at(22, 6)).toEqual(['SERVERRAUM', 'server']);
    expect(at(23, 6)).toEqual(['OST-FLUR', 'corridor']);
  });

  it('shows a wall with a face in the kind of the room it looks into, plain without one', () => {
    const { kinds, walls, width } = dressMap(blackout, seedOf('blackout'));
    // (16,3) is a pillar in the server room: floor on all four sides of it.
    expect(walls[3 * width + 16]).toBe(FLOOR_E | FLOOR_S | FLOOR_W | 1);
    expect(kinds[3 * width + 16]).toBe('server');
    // (0,10) is the outer wall west of the corridor: no face.
    expect(kinds[10 * width + 0]).toBe('plain');
  });

  it('dusts the corners, wears a band along a room’s length, stripes the core’s floor', () => {
    const { floor, width } = dressMap(blackout, seedOf('blackout'));
    const variants = [...floor];
    expect(variants).toContain(CORNER_NW);
    // The corridor runs east–west: its wear runs across.
    expect(variants.filter((v) => v === WORN_ACROSS).length).toBeGreaterThan(4);
    // The floor round the reactor's core at (30,15).
    expect(floor[15 * width + 29]).toBe(3);
    expect(floor[14 * width + 31]).toBe(3);
  });

  it('puts rack fronts on the server room’s pillars, warning stripes beside its doors', () => {
    const { props } = dressMap(blackout, seedOf('blackout'));
    const prop = (x: number, y: number): string | undefined =>
      props.find((p) => p.x === x && p.y === y)?.kind;
    for (const y of [3, 5]) {
      expect(prop(16, y)).toBe('rack');
    }
    // Beside the Serverschott at (19,8) and the Maschinenraum's door at (5,13) the walls look
    // down on the floor below them; on their other sides hang emergency lamps.
    expect(prop(18, 8)).toBe('stripes');
    expect(prop(4, 13)).toBe('stripes');
  });

  it('hangs a prop at least every 4 tiles along each of Blackout’s corridors, both ways', () => {
    const { props, rooms, width } = dressMap(blackout, seedOf('blackout'));
    const corridors = new Set(blackout.labels.filter((l) => l.kind === 'corridor').map((l) => l.text));
    expect([...corridors]).toEqual(['FLUR', 'OST-FLUR', 'SÜD-FLUR']);
    for (const corridor of corridors) {
      const floor = rooms.flatMap((room, i) =>
        room === corridor ? [{ x: i % width, y: Math.floor(i / width) }] : [],
      );
      const hung = props.filter((p) => p.room === corridor);
      // A stretch running east–west has 5 tiles of floor or fewer in each of its columns, one
      // running north–south in each of its rows; a prop counts where the floor below it lies.
      const stretches = [
        { line: (t: { x: number; y: number }) => t.x, at: (p: { x: number }) => p.x },
        { line: (t: { x: number; y: number }) => t.y, at: (p: { y: number }) => p.y + 1 },
      ];
      for (const { line, at } of stretches) {
        const count = new Map<number, number>();
        floor.forEach((tile) => count.set(line(tile), (count.get(line(tile)) ?? 0) + 1));
        const lines = [...count].filter(([, n]) => n <= 5).map(([v]) => v);
        for (const first of lines) {
          const window = [first, first + 1, first + 2, first + 3];
          if (window.every((v) => lines.includes(v))) {
            expect(
              hung.some((p) => window.includes(at(p))),
              `${corridor}: a prop along ${window[0]}–${window[3]}`,
            ).toBe(true);
          }
        }
      }
    }
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
