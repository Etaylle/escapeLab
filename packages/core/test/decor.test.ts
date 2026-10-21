import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkMission,
  initialState,
  parseMission,
  stepAllowed,
  viewFor,
} from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { canGather, reachability, tileKey } from '../src/reach.js';

/**
 * The lab's furniture (map.decor): solid like walls for every step — the
 * server's check of a step, the reach proofs — and validated like the
 * walls, never where anything else of the map stands or a drone flies, each
 * message naming the piece, its tile and what it is in the way of.
 *
 *   0123456789
 * 0 ##########
 * 1 #........#   spawns (1,1) and (8,1); the station at (5,3)
 * 2 #........#   a book at (1,3); a drone flying (2,4) ↔ (7,4)
 * 3 #........#
 * 4 #........#
 * 5 ##########
 */
function lab(decor: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'moebel',
    title: 'Möbel-Test',
    story: { intro: 'i', win: 'w', lose: 'l' },
    players: { min: 2, max: 2 },
    timeLimitSec: 300,
    puzzles: [{ type: 'keypad', id: 'tasten', title: 'Tastenfeld' }],
    map: {
      tiles: ['##########', '#........#', '#........#', '#........#', '#........#', '##########'],
      spawns: [
        { x: 1, y: 1 },
        { x: 8, y: 1 },
      ],
      stations: [{ puzzleId: 'tasten', x: 5, y: 3 }],
      manuals: [
        {
          id: 'buch',
          kind: 'book',
          label: 'HANDBUCH',
          puzzleIds: ['tasten'],
          spots: [{ x: 1, y: 3 }],
        },
      ],
      drones: [{ id: 'wache', waypoints: [{ x: 2, y: 4 }, { x: 7, y: 4 }] }],
      decor,
      ...extra,
    },
  };
}

/** The issues the validation finds, or none. */
function issues(data: unknown): string[] {
  const checked = checkMission(data);
  return checked.ok ? [] : checked.issues;
}

describe('decor — validated like the walls', () => {
  it('takes furniture on free floor, every proof still holding', () => {
    const pieces = [
      { kind: 'shelf', x: 8, y: 3 },
      { kind: 'barrel', x: 3, y: 1 },
    ];
    const mission = parseMission(lab(pieces));
    expect(mission.map.decor).toEqual([
      { kind: 'shelf', x: 8, y: 3 },
      { kind: 'barrel', x: 3, y: 1 },
    ]);
  });

  it('names a piece standing on a spawn, a station, a source or the drone’s way', () => {
    const found = issues(
      lab([
        { kind: 'shelf', x: 1, y: 1 },
        { kind: 'rack', x: 5, y: 3 },
        { kind: 'cart', x: 1, y: 3 },
        { kind: 'barrel', x: 4, y: 4 },
        { kind: 'desk', x: 7, y: 4 },
      ]),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        '(root): map: decor "shelf" at 1,1 stands on a spawn — furniture goes on free floor',
        '(root): map: decor "rack" at 5,3 stands on station "tasten" — furniture goes on ' +
          'free floor',
        '(root): map: decor "cart" at 1,3 stands on a spot of manual object "buch" — furniture ' +
          'goes on free floor',
        '(root): map: decor "barrel" at 4,4 stands on the flight path of drone "wache" — ' +
          'furniture goes on free floor',
        '(root): map: decor "desk" at 7,4 stands on waypoint 1 of drone "wache" — furniture ' +
          'goes on free floor',
      ]),
    );
  });

  it('names a piece on a wall, and two pieces sharing a tile', () => {
    const found = issues(
      lab([
        { kind: 'shelf', x: 0, y: 2 },
        { kind: 'cart', x: 8, y: 3 },
        { kind: 'barrel', x: 8, y: 3 },
      ]),
    );
    expect(found).toContain('(root): map: decor "shelf" at 0,2 is not on a floor tile');
    expect(found).toContain(
      '(root): map: two pieces of decor stand at 8,3 ("cart" and "barrel") — one a tile',
    );
  });

  it('names a piece on a plate, a door, the sign, the exit, an item and its drop-off', () => {
    const found = issues(
      lab(
        [
          { kind: 'shelf', x: 6, y: 1 },
          { kind: 'cart', x: 3, y: 2 },
          { kind: 'barrel', x: 8, y: 4 },
          { kind: 'bench', x: 6, y: 2 },
          { kind: 'hood', x: 2, y: 2 },
        ],
        {
          plates: [{ id: 'platte', x: 6, y: 1, label: 'HALTEN' }],
          edgeworkSign: { x: 3, y: 2 },
          exit: { x: 8, y: 4 },
          items: [{ id: 'kiste', label: 'KISTE', x: 6, y: 2, deliverTo: { x: 2, y: 2 } }],
        },
      ),
    );
    for (const what of [
      'decor "shelf" at 6,1 stands on plate "platte"',
      'decor "cart" at 3,2 stands on the edgework sign',
      'decor "barrel" at 8,4 stands on the exit',
      'decor "bench" at 6,2 stands on item "kiste"',
      'decor "hood" at 2,2 stands on the drop-off of item "kiste"',
    ]) {
      expect(found.some((issue) => issue.includes(what))).toBe(true);
    }
  });

  it('takes no kind it does not know, nor a look past the fourth', () => {
    expect(issues(lab([{ kind: 'sofa', x: 8, y: 3 }])).join()).toContain('map.decor.0.kind');
    expect(issues(lab([{ kind: 'shelf', x: 8, y: 3, variant: 4 }])).join()).toContain(
      'map.decor.0.variant',
    );
  });

  it('fails the proofs where furniture walls the rules off', () => {
    // Shelves on the three floor tiles round the book: nobody can stand at it any more.
    const shelves = [
      { kind: 'shelf', x: 1, y: 2 },
      { kind: 'shelf', x: 1, y: 4 },
      { kind: 'shelf', x: 2, y: 3 },
    ];
    const found = issues(lab(shelves, { drones: [] }));
    expect(found.some((issue) => issue.includes('nobody can reach manual object "buch"'))).toBe(
      true,
    );
  });
});

describe('decor — solid for every step', () => {
  const mission: Mission = parseMission(
    lab([{ kind: 'shelf', x: 3, y: 2 }], { drones: [] }),
  );
  const state: GameState = (
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: 1_000_000, seed: 1 },
    ] satisfies Action[]
  ).reduce(applyAction, initialState(mission));
  const step = (from: [number, number], to: [number, number]): boolean =>
    stepAllowed(mission.map, state, { x: from[0], y: from[1] }, { x: to[0], y: to[1] });

  it('refuses a step into a piece of furniture, and takes one past it', () => {
    expect(step([2.5, 2.5], [3.5, 2.5])).toBe(false);
    expect(step([2.5, 1.5], [3.5, 1.5])).toBe(true);
  });

  it('lets nobody reach a tile furniture stands on, though every tile round it', () => {
    const [reach] = reachability(mission.map, [{ x: 1, y: 1 }], new Set());
    expect(reach?.has(tileKey(3, 2))).toBe(false);
    expect(reach?.has(tileKey(3, 1))).toBe(true);
    expect(reach?.has(tileKey(4, 2))).toBe(true);
  });

  it('keeps a crew from gathering where furniture boxes a spot in', () => {
    const station = { x: 5, y: 3 };
    expect(canGather(mission.map, mission.map.spawns, new Set(), station)).toBe(true);
    const around = [
      [4, 3],
      [6, 3],
      [5, 2],
      [5, 4],
    ].map(([x = 0, y = 0]) => ({ kind: 'shelf' as const, x, y }));
    const boxedIn = { ...mission.map, decor: around };
    expect(canGather(boxedIn, boxedIn.spawns, new Set(), station)).toBe(false);
  });

  it('shows the furniture and each room’s kind in every player’s map', () => {
    const shipped = parseMission(
      JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
    );
    const view = viewFor(
      ([
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'set-ready', playerId: 'p2', ready: true },
        { type: 'start-mission', playerId: 'p1', at: 1_000_000, seed: 1 },
      ] satisfies Action[]).reduce(applyAction, initialState(shipped)),
      'p1',
    );
    expect(view.map?.decor).toHaveLength(shipped.map.decor.length);
    expect(view.map?.labels.find((l) => l.text === 'ARCHIV')?.kind).toBe('archive');
    const box = view.map?.stations.find((s) => s.puzzleId === 'notstrom' && s.console === 'a');
    expect(box?.look).toBe('fusebox');
  });
});
