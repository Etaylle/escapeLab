import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission, viewFor } from '../src/index.js';
import { started } from './lab.js';

/**
 * Two rooms, west (x 1–3) and east (x 5–7), joined by a door at (4,2);
 * both players spawn in the west room. Every test changes what it needs.
 *
 *   012345678
 * 0 #########
 * 1 #...#...#
 * 2 #.......#   door at (4,2)
 * 3 #...#...#
 * 4 #########
 */
function lab(overrides: { puzzles?: object[]; map?: object } = {}) {
  return {
    id: 'orte',
    title: 'Orte',
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    roles: [
      { id: 'a', name: 'A', description: '' },
      { id: 'b', name: 'B', description: '' },
    ],
    puzzles: overrides.puzzles ?? [{ type: 'wiring', id: 'kabel', title: 'Kabel' }],
    map: {
      tiles: ['#########', '#...#...#', '#.......#', '#...#...#', '#########'],
      spawns: { a: { x: 1, y: 1 }, b: { x: 2, y: 1 } },
      doors: [],
      stations: [{ puzzleId: 'kabel', x: 2, y: 3 }],
      manuals: [{ id: 'buch', kind: 'book', x: 1, y: 3, label: 'HANDBUCH', puzzleIds: ['kabel'] }],
      edgeworkSign: { x: 3, y: 1 },
      ...overrides.map,
    },
  };
}

const door = (opensBy: object) => [{ id: 'tuer', x: 4, y: 2, opensBy }];
/** The book moved into the east room. */
const eastBook = [
  { id: 'buch', kind: 'book', x: 6, y: 1, label: 'HANDBUCH', puzzleIds: ['kabel'] },
];

describe('the mission format after roles', () => {
  it('parses a lab of places', () => {
    expect(() => parseMission(lab())).not.toThrow();
  });

  it('refuses the old role fields, prompts and private texts loudly', () => {
    const old = lab({
      puzzles: [
        {
          type: 'wiring',
          id: 'kabel',
          title: 'Kabel',
          prompt: 'Schneide!',
          operatorRoleId: 'a',
          manualRoleId: 'b',
          infos: [],
        },
      ],
    });
    expect(() => parseMission(old)).toThrow(/Unrecognized keys?: .*prompt/);
    const seeing = {
      ...lab(),
      roles: [
        { id: 'a', name: 'A', description: '', seesEdgework: true },
        { id: 'b', name: 'B', description: '' },
      ],
    };
    expect(() => parseMission(seeing)).toThrow(/seesEdgework/);
    const buttons = lab({
      puzzles: [{ type: 'button-sync', id: 'kabel', title: 'Sync', buttons: [] }],
    });
    expect(() => parseMission(buttons)).toThrow(/buttons/);
  });

  it('needs a manual object for every puzzle somebody reads, none for a whole-crew press', () => {
    expect(() => parseMission(lab({ map: { manuals: [] } }))).toThrow(
      /no manual object covers puzzle "kabel"/,
    );
    const press = lab({
      puzzles: [{ type: 'button-sync', id: 'kabel', title: 'Alle' }],
      map: { manuals: [] },
    });
    expect(() => parseMission(press)).not.toThrow();
  });

  it('rejects a manual object off the floor, twice the same, or for a puzzle nobody has', () => {
    const book = { id: 'buch', kind: 'book', x: 1, y: 3, label: 'HANDBUCH', puzzleIds: ['kabel'] };
    expect(() => parseMission(lab({ map: { manuals: [{ ...book, x: 0 }] } }))).toThrow(
      /manual object "buch" at 0,3 is not on a floor tile/,
    );
    expect(() => parseMission(lab({ map: { manuals: [book, { ...book, x: 3 }] } }))).toThrow(
      /manual object ids must be unique/,
    );
    expect(() =>
      parseMission(lab({ map: { manuals: [{ ...book, puzzleIds: ['kabel', 'nix'] }] } })),
    ).toThrow(/manual object "buch" covers unknown puzzle "nix"/);
    expect(() => parseMission(lab({ map: { manuals: [{ ...book, kind: 'zettel' }] } }))).toThrow(
      /kind/,
    );
  });

  it('freezes a drone only with a plate that exists', () => {
    const drone = {
      id: 'wache',
      waypoints: [
        { x: 5, y: 1 },
        { x: 7, y: 1 },
      ],
      frozenByPlate: 'kamera',
    };
    expect(() => parseMission(lab({ map: { drones: [drone] } }))).toThrow(
      /drone "wache" is frozen by unknown plate "kamera"/,
    );
    const plates = [{ id: 'kamera', x: 3, y: 3, label: 'KAMERA HALTEN' }];
    const frozen = parseMission(lab({ map: { drones: [drone], plates } }));
    expect(frozen.map.drones[0]?.frozenByPlate).toBe('kamera');
  });

  it('tells the client which plate holds a camera, so it can be drawn as one', () => {
    const drone = {
      id: 'wache',
      waypoints: [
        { x: 5, y: 1 },
        { x: 7, y: 1 },
      ],
      frozenByPlate: 'kamera',
    };
    const plates = [
      { id: 'kamera', x: 3, y: 3, label: 'KAMERA HALTEN' },
      { id: 'tuer', x: 2, y: 2, label: 'HALTEN' },
    ];
    const view = viewFor(started(parseMission(lab({ map: { drones: [drone], plates } }))), 'p1');
    expect(view.map?.plates.map((p) => [p.id, p.freezesDrone])).toEqual([
      ['kamera', true],
      ['tuer', false],
    ]);
  });
});

describe('the map walk', () => {
  it('rejects a station nobody can reach before its puzzle is solved', () => {
    const behind = lab({
      map: {
        doors: door({ kind: 'puzzle', puzzleId: 'kabel' }),
        stations: [{ puzzleId: 'kabel', x: 6, y: 2 }],
      },
    });
    expect(() => parseMission(behind)).toThrow(/nobody can reach station "kabel"/);
  });

  it('rejects a manual object locked away while its puzzle is open', () => {
    const locked = lab({
      map: {
        doors: door({ kind: 'puzzle', puzzleId: 'kabel' }),
        manuals: eastBook,
      },
    });
    expect(() => parseMission(locked)).toThrow(
      /nobody can reach a manual object for puzzle "kabel" while it is open/,
    );
  });

  it('lets a plate held by the other player open the way to a manual object', () => {
    const held = lab({
      map: {
        doors: door({ kind: 'plate', plateId: 'p' }),
        plates: [{ id: 'p', x: 2, y: 2, label: 'HALTEN' }],
        manuals: eastBook,
      },
    });
    expect(() => parseMission(held)).not.toThrow();
  });

  it('rejects the sign out of reach before the first rule reads it', () => {
    const far = lab({
      map: { doors: door({ kind: 'puzzle', puzzleId: 'kabel' }), edgeworkSign: { x: 6, y: 1 } },
    });
    expect(() => parseMission(far)).toThrow(
      /nobody can reach the edgework sign before puzzle "kabel" reads it/,
    );
  });

});

describe('the map walk for a whole-crew station', () => {
  /** A press for everyone in the east room, behind a plate door; the plate and spawns vary. */
  const eastPress = (plate: { x: number; y: number }, spawns?: object) =>
    lab({
      puzzles: [{ type: 'button-sync', id: 'kabel', title: 'Alle' }],
      map: {
        ...(spawns === undefined ? {} : { spawns }),
        doors: door({ kind: 'plate', plateId: 'p' }),
        plates: [{ id: 'p', ...plate, label: 'HALTEN' }],
        stations: [{ puzzleId: 'kabel', x: 6, y: 2 }],
        manuals: [],
      },
    });
  const apart = /the whole crew cannot stand at station "kabel" together/;

  it('turns it down where the last one in needs somebody outside on a plate', () => {
    expect(() => parseMission(eastPress({ x: 2, y: 2 }))).toThrow(apart);
    // Somebody inside cannot reach a plate that lies outside for the other one.
    const oneInside = { a: { x: 1, y: 1 }, b: { x: 6, y: 1 } };
    expect(() => parseMission(eastPress({ x: 2, y: 2 }, oneInside))).toThrow(apart);
  });

  it('turns it down where a plate lies inside but nobody is in there to stand on it', () => {
    expect(() => parseMission(eastPress({ x: 6, y: 3 }))).toThrow(apart);
  });

  it('lets somebody inside hold a plate that lies inside for the last one coming in', () => {
    const oneInside = { a: { x: 1, y: 1 }, b: { x: 6, y: 1 } };
    expect(() => parseMission(eastPress({ x: 6, y: 3 }, oneInside))).not.toThrow();
  });

  it('opens the way to a whole-crew station with an earlier puzzle', () => {
    const chained = lab({
      puzzles: [
        { type: 'button-sync', id: 'erst', title: 'Erst' },
        { type: 'button-sync', id: 'kabel', title: 'Dann' },
      ],
      map: {
        doors: door({ kind: 'puzzle', puzzleId: 'erst' }),
        stations: [
          { puzzleId: 'erst', x: 2, y: 3 },
          { puzzleId: 'kabel', x: 6, y: 2 },
        ],
        manuals: [],
        edgeworkSign: undefined,
      },
    });
    expect(() => parseMission(chained)).not.toThrow();
  });

  it('accepts every shipped mission', () => {
    for (const id of ['blackout', 'systemcheck', 'kettenreaktion', 'doppelschicht']) {
      const url = new URL(`../../../missions/${id}.json`, import.meta.url);
      expect(() => parseMission(JSON.parse(readFileSync(url, 'utf8'))), id).not.toThrow();
    }
  });
});
