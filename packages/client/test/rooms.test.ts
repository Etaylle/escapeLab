import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  litGroups,
  powerRoom,
  roomArea,
  roomFloor,
  bringsLight,
  roomLights,
  roomOn,
  roomsComingOn,
  startRoom,
  type RoomLights,
  type RoomOn,
} from '../src/world/rooms.js';

/**
 * Two rooms, west (x 1–3) and east (x 5–7), joined by a door at (4,2).
 *
 *   012345678
 * 0 #########
 * 1 #...#...#
 * 2 #.......#   door at (4,2)
 * 3 #...#...#
 * 4 #########
 */
const tiles = ['#########', '#...#...#', '#.......#', '#...#...#', '#########'];
const doors = [{ id: 'tuer', x: 4, y: 2, open: true }];
const labels = [
  { text: 'WEST', x: 2, y: 1 },
  { text: 'OST', x: 6, y: 1 },
];

describe('startRoom — where the briefing says you start', () => {
  it('names the room around the spawn; a door bounds it, open or not', () => {
    expect(startRoom({ tiles, doors, labels, yourSpawn: { x: 5, y: 3 } })).toBe('OST');
    expect(startRoom({ tiles, doors, labels, yourSpawn: { x: 1, y: 3 } })).toBe('WEST');
  });

  it('falls back to the nearest label when none lies in the room', () => {
    const elsewhere = [
      { text: 'FERN', x: 8, y: 4 },
      { text: 'OST', x: 6, y: 1 },
    ];
    expect(startRoom({ tiles, doors, labels: elsewhere, yourSpawn: { x: 1, y: 3 } })).toBe('OST');
  });

  it('says nothing on a map without labels', () => {
    expect(startRoom({ tiles, doors, labels: [], yourSpawn: { x: 1, y: 3 } })).toBeNull();
  });
});

const keys = (spots: { x: number; y: number }[]): string[] =>
  spots.map((s) => `${s.x},${s.y}`).sort();

describe('roomFloor — the floor a room label stands on', () => {
  it('floods the floor up to the door, open or not', () => {
    const west = ['1,1', '1,2', '1,3', '2,1', '2,2', '2,3', '3,1', '3,2', '3,3'];
    expect(keys(roomFloor({ tiles, doors }, { x: 2, y: 1 }))).toEqual(west);
    const shut = [{ id: 'tuer', x: 4, y: 2, open: false }];
    expect(keys(roomFloor({ tiles, doors: shut }, { x: 2, y: 1 }))).toEqual(west);
  });

  it('runs on into the next room where no door stands between', () => {
    expect(roomFloor({ tiles, doors: [] }, { x: 2, y: 1 })).toHaveLength(19);
  });

  it('is empty off the floor and on a door', () => {
    expect(roomFloor({ tiles, doors }, { x: 0, y: 0 })).toEqual([]);
    expect(roomFloor({ tiles, doors }, { x: 4, y: 2 })).toEqual([]);
    expect(roomFloor({ tiles, doors }, { x: 40, y: 2 })).toEqual([]);
  });
});

describe("roomArea — what a room's lights reach", () => {
  it('lights the floor, the walls around it and the door in them', () => {
    const area = keys(roomArea({ tiles, doors }, { x: 2, y: 1 }));
    expect(area).toHaveLength(25);
    expect(area).toContain('0,0');
    expect(area).toContain('4,4');
    expect(area).toContain('4,2');
  });

  it('stops at the door: the floor of the room next door stays dark', () => {
    const area = keys(roomArea({ tiles, doors }, { x: 2, y: 1 }));
    expect(area.filter((tile) => Number(tile.split(',')[0]) > 4)).toEqual([]);
    const east = keys(roomArea({ tiles, doors }, { x: 6, y: 1 }));
    expect(east.filter((tile) => Number(tile.split(',')[0]) < 4)).toEqual([]);
    expect(east).toContain('4,2');
  });

  it('takes no floor across a corner, only the walls there — not even a door', () => {
    // Two rooms touching corner to corner: (1,1)–(2,2) and (3,3)–(4,4).
    const corner = ['######', '#..###', '#..###', '###..#', '###..#', '######'];
    const area = keys(roomArea({ tiles: corner, doors: [] }, { x: 1, y: 1 }));
    expect(area).not.toContain('3,3');
    expect(area).toContain('3,2');
    expect(area).toHaveLength(15);
    const door = [{ id: 'eck', x: 3, y: 3, open: false }];
    expect(keys(roomArea({ tiles: corner, doors: door }, { x: 1, y: 1 }))).toEqual(area);
  });

  it('lights nothing for a label off the floor', () => {
    expect(roomArea({ tiles, doors }, { x: 4, y: 0 })).toEqual([]);
  });
});

describe('litGroups — the lit rooms’ tiles by the rooms that light them', () => {
  const west = roomArea({ tiles, doors }, { x: 2, y: 1 });
  const east = roomArea({ tiles, doors }, { x: 6, y: 1 });
  /** The tiles of a group's runs, by key. */
  const tilesOf = (runs: { x: number; y: number; length: number }[]): string[] =>
    runs.flatMap((run) => Array.from({ length: run.length }, (_, i) => `${run.x + i},${run.y}`));

  it('gives a wall and a door two rooms share to both, and every other tile to its room', () => {
    const groups = litGroups(
      new Map([
        ['WEST', west],
        ['OST', east],
      ]),
    );
    const shared = groups.find((group) => group.rooms.length === 2);
    expect(shared?.rooms.sort()).toEqual(['OST', 'WEST']);
    expect(tilesOf(shared?.runs ?? []).sort()).toEqual(['4,0', '4,1', '4,2', '4,3', '4,4']);
    const own = groups.find((group) => group.rooms.join() === 'WEST');
    expect(tilesOf(own?.runs ?? [])).toHaveLength(west.length - 5);
    expect(own?.runs[0]).toEqual({ x: 0, y: 0, length: 4 });
    const all = groups.flatMap((group) => tilesOf(group.runs));
    expect(new Set(all).size).toBe(all.length);
  });

  it('counts a tile listed twice for one room once, and gives nothing for no room lit', () => {
    const groups = litGroups(new Map([['WEST', [...west, ...west]]]));
    expect(groups).toHaveLength(1);
    expect(tilesOf(groups[0]?.runs ?? [])).toHaveLength(west.length);
    expect(litGroups(new Map())).toEqual([]);
  });
});

type LabelledMap = {
  tiles: string[];
  doors: { id: string; x: number; y: number; open: boolean }[];
  labels: { text: string; x: number; y: number; brightness?: number }[];
};

/** A map as its file has it: doors without a state, and none where it has none. */
type FileMap = Omit<LabelledMap, 'doors'> & {
  doors?: Omit<LabelledMap['doors'][number], 'open'>[];
};

/** The map of `missions/<id>.json`, its doors shut (a map without doors leaves them out). */
function missionMap(id: string): LabelledMap {
  const { map } = JSON.parse(
    readFileSync(new URL(`../../../missions/${id}.json`, import.meta.url), 'utf8'),
  ) as { map: FileMap };
  return { ...map, doors: (map.doors ?? []).map((door) => ({ ...door, open: false })) };
}

/** The rooms `names` lit one after another as the client lights them, by name. */
function lightAll(map: LabelledMap, names: readonly string[]): Map<string, RoomLights> {
  const lit = new Map<string, RoomLights>();
  for (const name of names) {
    lit.set(name, roomLights(map, name, lit));
  }
  return lit;
}

describe('roomLights — a floor several names label is lit once', () => {
  it('lights a room’s area where nothing is lit yet, as roomArea does', () => {
    const map = { tiles, doors, labels };
    expect(roomLights(map, 'WEST', new Map())).toEqual({
      tiles: roomArea(map, { x: 2, y: 1 }),
      same: null,
      brightness: 1,
    });
  });

  it('gives a second name on the same floor no tiles, and names the room lit first', () => {
    const map = { tiles, doors: [], labels };
    const lit = lightAll(map, ['WEST', 'OST']);
    expect(lit.get('WEST')?.tiles).toEqual(roomArea(map, { x: 2, y: 1 }));
    expect(lit.get('OST')).toEqual({ tiles: [], same: 'WEST', brightness: 1 });
  });

  it('keeps two rooms behind a door apart, the wall and door between them lit by both', () => {
    const map = { tiles, doors, labels };
    const lit = lightAll(map, ['WEST', 'OST']);
    const east = roomArea(map, { x: 6, y: 1 });
    expect(lit.get('OST')).toEqual({ tiles: east, same: null, brightness: 1 });
  });

  it('lights the Übungshalle’s one hall once under all fourteen of its names', () => {
    const hall = missionMap('uebungshalle');
    const names = [...new Set(hall.labels.map((label) => label.text))];
    expect(names).toHaveLength(14);
    const all = [...lightAll(hall, names).values()].flatMap((room) => keys(room.tiles));
    // Every tile of the 40 × 33 hall, floor and walls, once — not fourteen times over.
    expect(all).toHaveLength(40 * 33);
    expect(new Set(all).size).toBe(all.length);
    // As bright as a room lit in Blackout, not brighter.
    expect([...lightAll(hall, names).values()].map((room) => room.brightness)).toEqual(
      names.map(() => 1),
    );
  });

  it('lights Blackout’s Flur once, twice as bright, as Notlicht lights FLUR and ARCHIV', () => {
    const lab = missionMap('blackout');
    const lit = lightAll(lab, ['FLUR', 'ARCHIV']);
    expect(lit.get('ARCHIV')).toEqual({ tiles: [], same: 'FLUR', brightness: 1 });
    // Two names lit it at once before a floor was lit once: its labels keep that brightness.
    expect(lit.get('FLUR')?.brightness).toBe(2);
    const flur = lab.labels.filter((label) => label.text === 'FLUR');
    expect(keys(lit.get('FLUR')?.tiles ?? [])).toEqual(
      keys(flur.flatMap((label) => roomArea(lab, label))),
    );
  });
});

describe('roomLights — how brightly a floor burns', () => {
  it('burns as brightly as the brightest label standing on the floor it lights', () => {
    const bright = labels.map((label) =>
      label.text === 'OST' ? { ...label, brightness: 2 } : label,
    );
    const map = { tiles, doors, labels: bright };
    expect(roomLights(map, 'OST', new Map()).brightness).toBe(2);
    // Behind the door the west room keeps a room's own; with no door between, one floor burns 2.
    expect(roomLights(map, 'WEST', new Map()).brightness).toBe(1);
    expect(roomLights({ ...map, doors: [] }, 'WEST', new Map()).brightness).toBe(2);
  });

  it('lights Blackout’s other rooms at a room’s own, as one name each lit them', () => {
    const lab = missionMap('blackout');
    for (const room of ['MASCHINENRAUM', 'SERVERRAUM', 'LABOR', 'REAKTOR']) {
      expect(roomLights(lab, room, new Map()).brightness).toBe(1);
    }
  });
});

describe('roomOn — since when a room’s lights are on', () => {
  /** `room` coming on at `since` over the rooms lit in `lit`, which takes it in. */
  function on(map: LabelledMap, lit: Map<string, RoomOn>, room: string, since: number): RoomOn {
    const coming = roomOn(map, room, lit, since);
    lit.set(room, coming);
    return coming;
  }

  it('keeps the first name’s time for a name coming on later on a floor lit already', () => {
    const lab = missionMap('blackout');
    const lit = new Map<string, RoomOn>();
    expect(on(lab, lit, 'FLUR', 3).since).toBe(3);
    expect(on(lab, lit, 'ARCHIV', 9)).toEqual({ tiles: [], since: 3, brightness: 1 });
    // A floor lit before the screen looked stays lit since then for its later names too.
    const long = new Map<string, RoomOn>();
    on(lab, long, 'FLUR', -Infinity);
    expect(on(lab, long, 'ARCHIV', 9).since).toBe(-Infinity);
  });

  it('starts a name on two floors, one lit already, now: its other floor warms up', () => {
    const both = [...labels, { text: 'OST', x: 2, y: 3 }];
    const map = { tiles, doors, labels: both };
    const lit = new Map<string, RoomOn>();
    on(map, lit, 'WEST', 1);
    const east = on(map, lit, 'OST', 5);
    expect(east).toEqual({ tiles: roomArea(map, { x: 6, y: 1 }), since: 5, brightness: 1 });
  });

  it('brings light — the relay’s click — only where a tile comes on', () => {
    const lab = missionMap('blackout');
    const lit = new Map<string, RoomOn>();
    expect(bringsLight([on(lab, lit, 'FLUR', 3)])).toBe(true);
    expect(bringsLight([on(lab, lit, 'ARCHIV', 9)])).toBe(false);
    expect(bringsLight([on(lab, lit, 'ARCHIV', 9), on(lab, lit, 'LABOR', 9)])).toBe(true);
    expect(bringsLight([])).toBe(false);
  });
});

describe('powerRoom — the room the power lights round you before the blackout', () => {
  it('lights your room whole, to its walls and its door, from anywhere on its floor', () => {
    const lit = powerRoom({ tiles, doors }, { x: 1.4, y: 3.7 });
    expect([...(lit?.keys ?? [])].sort()).toEqual(keys(roomArea({ tiles, doors }, { x: 2, y: 1 })));
    expect(lit?.runs[0]).toEqual({ x: 0, y: 0, length: 5 });
  });

  it('stops at a door, open or not, and lights nothing from a door or off the floor', () => {
    const lit = powerRoom({ tiles, doors }, { x: 6.5, y: 2.5 });
    expect([...(lit?.keys ?? [])].filter((key) => Number(key.split(',')[0]) < 4)).toEqual([]);
    expect(powerRoom({ tiles, doors }, { x: 4.5, y: 2.5 })).toBeNull();
    expect(powerRoom({ tiles, doors }, { x: 0.5, y: 0.5 })).toBeNull();
  });

  it('shows Blackout’s Archiv and the Flur it opens on, the lever in it — the rest of the lab dark', () => {
    const { map: lab } = JSON.parse(
      readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8'),
    ) as { map: { tiles: string[]; doors: { id: string; x: number; y: number }[] } };
    const doorsShut = lab.doors.map((door) => ({ ...door, open: false }));
    const lit = powerRoom({ tiles: lab.tiles, doors: doorsShut }, { x: 3.5, y: 3.5 });
    const shown = lit?.keys ?? new Set<string>();
    // The book at 8,1 or 9,3, the fuse at 9,7, the sign at 2,3; through the archway at 4,8 and
    // 5,8 the Flur with the lever at 15,9, the plate at 7,12 and its east end at 29,12 — the
    // crew sees the lever once in light.
    for (const tile of ['8,1', '9,3', '9,7', '2,3', '4,8', '5,8', '15,9', '7,12', '29,12']) {
      expect(shown.has(tile)).toBe(true);
    }
    // The key in the Serverraum at 21,1 and the Serverraum itself behind its bulkhead, the
    // Ost-Flur beyond it, the Maschinenraum behind its door, the Labor, the Reaktor: dark.
    for (const tile of ['21,1', '13,3', '27,5', '3,16', '14,16', '28,17']) {
      expect(shown.has(tile)).toBe(false);
    }
  });
});

describe('roomsComingOn — a room just lit warms up in plain sight', () => {
  it('lights a room lit before the screen looked at once, with no warm-up', () => {
    expect(roomsComingOn(['FLUR'], new Set(), [], [], false)).toEqual({
      long: ['FLUR'],
      now: [],
      waiting: [],
    });
  });

  it('warms a room just lit up now, where nothing lies over the world', () => {
    expect(roomsComingOn(['FLUR'], new Set(), ['FLUR'], [], false)).toEqual({
      long: [],
      now: ['FLUR'],
      waiting: [],
    });
  });

  it('holds it while a panel lies over the world, and warms it up once that is gone', () => {
    const held = roomsComingOn(['FLUR', 'ARCHIV'], new Set(), ['FLUR', 'ARCHIV'], [], true);
    expect(held).toEqual({ long: [], now: [], waiting: ['FLUR', 'ARCHIV'] });
    // The next view while the panel is still up adds nothing twice.
    const still = roomsComingOn(['FLUR', 'ARCHIV'], new Set(), [], held.waiting, true);
    expect(still.waiting).toEqual(['FLUR', 'ARCHIV']);
    expect(roomsComingOn([], new Set(), [], still.waiting, false)).toEqual({
      long: [],
      now: ['FLUR', 'ARCHIV'],
      waiting: [],
    });
  });

  it('leaves a room already lit as it is', () => {
    expect(roomsComingOn(['FLUR'], new Set(['FLUR']), ['FLUR'], [], false)).toEqual({
      long: [],
      now: [],
      waiting: [],
    });
  });
});
