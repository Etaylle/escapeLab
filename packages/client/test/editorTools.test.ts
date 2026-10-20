import { describe, expect, it } from 'vitest';
import { newDraft, type Draft, type Tile } from '../src/editor/draft.js';
import {
  addPuzzle,
  lineBetween,
  move,
  ON_FLOOR_ONLY,
  paint,
  place,
  placePending,
  remove,
  rename,
  resize,
  retype,
  shiftPuzzle,
  TAKEN,
  tilesOf,
  type PlacingTool,
  type Ref,
} from '../src/editor/tools.js';

const AUTO = { puzzleId: null, console: null };

/** A new draft with a 7 × 5 room carved out at 2,2 – 8,6. */
function room(): Draft {
  const floor: Tile[] = [];
  for (let y = 2; y <= 6; y++) {
    floor.push(...lineBetween({ x: 2, y }, { x: 8, y }));
  }
  return paint(newDraft(), floor, '.');
}

/** Places with a tool and insists that it worked. */
function put(draft: Draft, tool: PlacingTool, at: Tile, selection: Ref | null = null): Draft {
  const result = place(draft, tool, at, selection, AUTO);
  expect(result.note).toBeNull();
  return result.draft;
}

describe('painting', () => {
  it('carves a 7 × 5 room out of the wall, stroke by stroke', () => {
    const draft = room();
    expect(draft.map.tiles.slice(1, 8)).toEqual([
      '####################',
      '##.......###########',
      '##.......###########',
      '##.......###########',
      '##.......###########',
      '##.......###########',
      '####################',
    ]);
    expect(paint(draft, [{ x: 4, y: 4 }], '#').map.tiles[4]).toBe('##..#....###########');
  });

  it('draws a stroke through every tile between two pointer positions', () => {
    expect(lineBetween({ x: 0, y: 0 }, { x: 3, y: 0 })).toHaveLength(4);
    expect(lineBetween({ x: 0, y: 0 }, { x: 3, y: 3 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    expect(lineBetween({ x: 5, y: 2 }, { x: 5, y: 2 })).toEqual([{ x: 5, y: 2 }]);
  });

  it('leaves the draft as it was where nothing changes, and tiles off the map alone', () => {
    const draft = room();
    expect(paint(draft, [{ x: 3, y: 3 }], '.')).toBe(draft);
    expect(paint(draft, [{ x: -1, y: 3 }, { x: 40, y: 3 }, { x: 3, y: 99 }], '.')).toBe(draft);
  });

  it('resizes by cutting or growing wall at the right and bottom, within bounds', () => {
    const draft = resize(room(), 10, 8);
    expect(draft.map.tiles).toHaveLength(8);
    expect(draft.map.tiles[2]).toBe('##.......#');
    expect(resize(draft, 12, 9).map.tiles[8]).toBe('############');
    expect(resize(draft, 1, 1000).map.tiles).toHaveLength(40);
    expect(resize(draft, 1, 1000).map.tiles[0]).toHaveLength(5);
  });
});

describe('placing', () => {
  it('puts things on floor only, and says why not on a wall', () => {
    const result = place(room(), 'spawn', { x: 0, y: 0 }, null, AUTO);
    expect(result.note).toBe(ON_FLOOR_ONLY);
    expect(result.draft.map.spawns).toEqual([]);
  });

  it('keeps one solid thing a tile: a press on a taken tile selects what is there', () => {
    const draft = put(room(), 'spawn', { x: 3, y: 4 });
    const again = place(draft, 'plate', { x: 3, y: 4 }, null, AUTO);
    expect(again.draft).toBe(draft);
    expect(again.selection).toEqual({ kind: 'spawn', index: 0 });
  });

  it('lets marks lie on solid things: a room name on a start, a waypoint on a plate', () => {
    let draft = put(room(), 'plate', { x: 4, y: 4 });
    draft = put(draft, 'label', { x: 4, y: 4 });
    draft = put(draft, 'drone', { x: 4, y: 4 });
    expect(draft.map.labels).toEqual([{ text: 'RAUM', x: 4, y: 4 }]);
    expect(draft.map.drones[0]?.waypoints).toEqual([{ x: 4, y: 4 }]);
  });

  it('gives new things free ids and sensible defaults', () => {
    let draft = put(room(), 'door', { x: 3, y: 3 });
    draft = put(draft, 'door', { x: 4, y: 3 });
    draft = put(draft, 'plate', { x: 5, y: 3 });
    draft = put(draft, 'item', { x: 6, y: 3 });
    expect(draft.map.doors.map((d) => [d.id, d.opensBy])).toEqual([
      ['tuer', { kind: 'puzzle', puzzleId: 'tastenfeld' }],
      ['tuer-2', { kind: 'puzzle', puzzleId: 'tastenfeld' }],
    ]);
    expect(draft.map.plates).toEqual([{ id: 'platte', x: 5, y: 3, label: 'HALTEN' }]);
    expect(draft.map.items).toEqual([{ id: 'teil', label: 'KISTE', x: 6, y: 3, requiredFor: '' }]);
  });

  it('places the first station missing, and moves a station rather than add a second', () => {
    let draft = put(room(), 'station', { x: 7, y: 3 });
    expect(draft.map.stations).toEqual([{ puzzleId: 'tastenfeld', x: 7, y: 3 }]);
    draft = put(draft, 'station', { x: 6, y: 5 });
    expect(draft.map.stations).toEqual([{ puzzleId: 'tastenfeld', x: 6, y: 5 }]);
  });

  it('places console a, then console b, of a puzzle worked at two consoles', () => {
    let draft = put(room(), 'station', { x: 3, y: 3 });
    draft = addPuzzle(draft, 'circuit');
    draft = put(draft, 'station', { x: 3, y: 6 });
    draft = put(draft, 'station', { x: 8, y: 6 });
    expect(draft.map.stations.slice(1)).toEqual([
      { puzzleId: 'sicherungskasten', x: 3, y: 6, console: 'a' },
      { puzzleId: 'sicherungskasten', x: 8, y: 6, console: 'b' },
    ]);
    const choice = { puzzleId: 'sicherungskasten', console: 'a' as const };
    const chosen = place(draft, 'station', { x: 8, y: 2 }, null, choice);
    expect(chosen.draft.map.stations[1]).toEqual({
      puzzleId: 'sicherungskasten',
      x: 8,
      y: 2,
      console: 'a',
    });
  });

  it('asks for a puzzle before a station can stand', () => {
    const draft = remove(room(), { kind: 'puzzle', index: 0 });
    const result = place(draft, 'station', { x: 3, y: 3 }, null, AUTO);
    expect(result.note).toContain('Rätsel');
    expect(result.draft.map.stations).toEqual([]);
  });

  it('keeps one sign and one exit: placing again moves them', () => {
    let draft = put(room(), 'sign', { x: 3, y: 2 });
    draft = put(draft, 'sign', { x: 5, y: 2 });
    draft = put(draft, 'exit', { x: 8, y: 6 });
    draft = put(draft, 'exit', { x: 8, y: 5 });
    expect(draft.map.edgeworkSign).toEqual({ x: 5, y: 2 });
    expect(draft.map.exit).toEqual({ x: 8, y: 5 });
  });

});

describe('placing things of several parts', () => {
  it('covers the first puzzle nobody covers yet with a new source', () => {
    const draft = put(room(), 'source', { x: 7, y: 5 });
    expect(draft.map.manuals).toEqual([
      {
        id: 'quelle',
        kind: 'book',
        label: 'HANDBUCH',
        puzzleIds: ['tastenfeld'],
        spots: [{ x: 7, y: 5 }],
        needsKey: '',
      },
    ]);
    expect(put(draft, 'source', { x: 7, y: 4 }).map.manuals[1]?.puzzleIds).toEqual([]);
  });

  it('adds waypoints to the selected drone, and starts a new one with none selected', () => {
    const first = place(room(), 'drone', { x: 2, y: 2 }, null, AUTO);
    const second = place(first.draft, 'drone', { x: 8, y: 2 }, first.selection, AUTO);
    expect(second.selection).toEqual({ kind: 'drone', index: 0, waypoint: 1 });
    const other = place(second.draft, 'drone', { x: 2, y: 6 }, null, AUTO);
    expect(other.draft.map.drones.map((d) => [d.id, d.waypoints.length])).toEqual([
      ['drohne', 2],
      ['drohne-2', 1],
    ]);
  });

  it('takes a source’s next spot and an item’s drop-off from a pending press', () => {
    let draft = put(room(), 'source', { x: 7, y: 5 });
    draft = put(draft, 'item', { x: 3, y: 3 });
    const spot = placePending(draft, { kind: 'spot', source: 0 }, { x: 2, y: 6 });
    expect(spot.draft.map.manuals[0]?.spots).toEqual([
      { x: 7, y: 5 },
      { x: 2, y: 6 },
    ]);
    expect(spot.selection).toEqual({ kind: 'source', index: 0, spot: 1 });
    expect(placePending(draft, { kind: 'spot', source: 0 }, { x: 3, y: 3 }).note).toBe(TAKEN);
    const dropoff = placePending(draft, { kind: 'dropoff', item: 0 }, { x: 8, y: 6 });
    expect(dropoff.draft.map.items[0]?.deliverTo).toEqual({ x: 8, y: 6 });
    const onWall = placePending(draft, { kind: 'dropoff', item: 0 }, { x: 0, y: 0 });
    expect(onWall.note).toBe(ON_FLOOR_ONLY);
  });
});

describe('moving and deleting', () => {
  it('drags a thing by the same rules as placing', () => {
    let draft = put(room(), 'spawn', { x: 3, y: 4 });
    draft = put(draft, 'spawn', { x: 4, y: 4 });
    const ref: Ref = { kind: 'spawn', index: 0 };
    expect(move(draft, ref, { x: 5, y: 5 }).draft.map.spawns[0]).toEqual({ x: 5, y: 5 });
    expect(move(draft, ref, { x: 4, y: 4 }).note).toBe(TAKEN);
    expect(move(draft, ref, { x: 0, y: 4 }).note).toBe(ON_FLOOR_ONLY);
    expect(move(draft, ref, { x: 3, y: 4 }).note).toBeNull();
  });

  it('takes a source with its last spot and a drone with its last waypoint', () => {
    let draft = put(room(), 'source', { x: 7, y: 5 });
    draft = placePending(draft, { kind: 'spot', source: 0 }, { x: 2, y: 6 }).draft;
    draft = remove(draft, { kind: 'source', index: 0, spot: 0 });
    expect(draft.map.manuals[0]?.spots).toEqual([{ x: 2, y: 6 }]);
    expect(remove(draft, { kind: 'source', index: 0, spot: 0 }).map.manuals).toEqual([]);
    const drone = put(room(), 'drone', { x: 2, y: 2 });
    expect(remove(drone, { kind: 'drone', index: 0, waypoint: 0 }).map.drones).toEqual([]);
  });

  it('removes the sign, the exit and a drop-off without leaving a hole in the file', () => {
    let draft = put(put(room(), 'sign', { x: 3, y: 2 }), 'exit', { x: 8, y: 6 });
    draft = put(draft, 'item', { x: 3, y: 3 });
    draft = placePending(draft, { kind: 'dropoff', item: 0 }, { x: 8, y: 5 }).draft;
    const refs = [{ kind: 'sign' }, { kind: 'exit' }, { kind: 'dropoff', index: 0 }] as const;
    for (const ref of refs) {
      draft = remove(draft, ref);
    }
    expect(draft.map).not.toHaveProperty('edgeworkSign');
    expect(draft.map).not.toHaveProperty('exit');
    expect(draft.map.items[0]).not.toHaveProperty('deliverTo');
  });

  it('removes a puzzle with its stations and from every source covering it', () => {
    let draft = put(room(), 'station', { x: 7, y: 3 });
    draft = put(draft, 'source', { x: 7, y: 5 });
    draft = remove(draft, { kind: 'puzzle', index: 0 });
    expect(draft.puzzles).toEqual([]);
    expect(draft.map.stations).toEqual([]);
    expect(draft.map.manuals[0]?.puzzleIds).toEqual([]);
  });

  it('outlines all of a thing: every spot of a source, an item and its drop-off', () => {
    let draft = put(room(), 'item', { x: 3, y: 3 });
    draft = placePending(draft, { kind: 'dropoff', item: 0 }, { x: 8, y: 5 }).draft;
    expect(tilesOf(draft, { kind: 'item', index: 0 })).toEqual([
      expect.objectContaining({ x: 3, y: 3 }),
      { x: 8, y: 5 },
    ]);
  });
});

describe('puzzles', () => {
  it('renames a puzzle everywhere it is named', () => {
    let draft = put(room(), 'station', { x: 7, y: 3 });
    draft = put(draft, 'source', { x: 7, y: 5 });
    draft = put(draft, 'door', { x: 3, y: 3 });
    draft = put(draft, 'item', { x: 4, y: 3 });
    const items = draft.map.items.map((item) => ({ ...item, requiredFor: 'tastenfeld' }));
    draft = { ...draft, map: { ...draft.map, items } };
    draft = rename(draft, 'puzzle', 'tastenfeld', 'code');
    expect(draft.puzzles[0]?.id).toBe('code');
    expect(draft.map.stations[0]?.puzzleId).toBe('code');
    expect(draft.map.manuals[0]?.puzzleIds).toEqual(['code']);
    expect(draft.map.doors[0]?.opensBy).toEqual({ kind: 'puzzle', puzzleId: 'code' });
    expect(draft.map.items[0]?.requiredFor).toBe('code');
  });

  it('renames a plate in its doors and an item in its cabinet', () => {
    let draft = put(put(room(), 'plate', { x: 3, y: 3 }), 'door', { x: 4, y: 3 });
    draft = {
      ...draft,
      map: {
        ...draft.map,
        doors: draft.map.doors.map((door) => ({
          ...door,
          opensBy: { kind: 'plate', plateId: 'platte', untilSolved: '' },
        })),
      },
    };
    expect(rename(draft, 'plate', 'platte', 'halt').map.doors[0]?.opensBy).toEqual({
      kind: 'plate',
      plateId: 'halt',
      untilSolved: '',
    });
    let keyed = put(put(room(), 'item', { x: 3, y: 3 }), 'source', { x: 5, y: 3 });
    const cabinet = { kind: 'cabinet' as const, needsKey: 'teil' };
    const manuals = keyed.map.manuals.map((m) => ({ ...m, ...cabinet }));
    keyed = { ...keyed, map: { ...keyed.map, manuals } };
    expect(rename(keyed, 'item', 'teil', 'schluessel').map.manuals[0]?.needsKey).toBe('schluessel');
  });

  it('moves a puzzle up and down in mission order', () => {
    const draft = addPuzzle(room(), 'maze');
    const order = shiftPuzzle(draft, 1, -1).puzzles.map((p) => p.id);
    expect(order).toEqual(['leitungsnetz', 'tastenfeld']);
    expect(shiftPuzzle(draft, 0, -1)).toBe(draft);
  });

  it('retypes a puzzle: the new module’s fields at their defaults, its stations follow', () => {
    let draft = addPuzzle(room(), 'circuit');
    draft = put(put(draft, 'station', { x: 3, y: 3 }), 'station', { x: 3, y: 6 });
    draft = put(draft, 'station', { x: 8, y: 6 });
    expect(draft.puzzles[1]?.fields).toEqual({
      wires: { min: 4, max: 6 },
      shorts: 3,
      burnoutSec: 60,
    });
    draft = {
      ...draft,
      puzzles: draft.puzzles.map((p, i) =>
        i === 1 ? { ...p, fields: { ...p.fields, shorts: 5 }, penaltySec: 45 } : p,
      ),
    };
    const single = retype(draft, 1, 'keypad');
    // The penalty is every puzzle's; what was the circuit's own goes with the circuit.
    expect(single.puzzles[1]).toMatchObject({ type: 'keypad', penaltySec: 45, fields: {} });
    expect(Object.keys(single.puzzles[1]?.fields ?? { shorts: 5 })).toEqual([]);
    expect(retype(draft, 1, 'maze').puzzles[1]?.fields).toEqual({ size: 6 });
    expect(single.map.stations.filter((s) => s.puzzleId === 'sicherungskasten')).toEqual([
      { puzzleId: 'sicherungskasten', x: 3, y: 6 },
    ]);
    const double = retype(draft, 0, 'signal');
    expect(double.map.stations.filter((s) => s.puzzleId === 'tastenfeld')).toEqual([
      { puzzleId: 'tastenfeld', x: 3, y: 3, console: 'a' },
    ]);
  });
});
