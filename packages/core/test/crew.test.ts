import { describe, expect, it } from 'vitest';
import { applyAction, initialState, NO_CREDITS, parseMission, viewFor } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { T0 } from './lab.js';

/**
 * Two rooms, west (x 1–3) and east (x 5–7), joined by a door at (4,2) that
 * opens once the wiring is cut; the wiring box and its book stand in the
 * west room. Every test picks the spawns and the player count it needs.
 *
 *   012345678
 * 0 #########
 * 1 #...#...#
 * 2 #.......#   door at (4,2)
 * 3 #...#...#
 * 4 #########
 */
function lab(players: { min: number; max: number }, spawns: { x: number; y: number }[]): object {
  return {
    id: 'crew',
    title: 'Crew',
    players,
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [{ type: 'wiring', id: 'kabel', title: 'Kabel' }],
    map: {
      tiles: ['#########', '#...#...#', '#.......#', '#...#...#', '#########'],
      spawns,
      doors: [{ id: 'tuer', x: 4, y: 2, opensBy: { kind: 'puzzle', puzzleId: 'kabel' } }],
      stations: [{ puzzleId: 'kabel', x: 2, y: 3 }],
      manuals: [
        {
          id: 'buch',
          kind: 'book',
          label: 'HANDBUCH',
          puzzleIds: ['kabel'],
          spots: [{ x: 1, y: 3 }],
        },
      ],
      edgeworkSign: { x: 3, y: 1 },
    },
  };
}

const WEST = [
  { x: 1, y: 1 },
  { x: 2, y: 1 },
  { x: 3, y: 2 },
];
/** Two to three players, every spawn in the west room. */
const mission: Mission = parseMission(lab({ min: 2, max: 3 }, WEST));

const join = (playerId: string): Action => ({ type: 'player-join', playerId, name: playerId });
const ready = (playerId: string): Action => ({ type: 'set-ready', playerId, ready: true });
const start = (seed = 1): Action => ({ type: 'start-mission', playerId: 'p1', at: T0, seed });

function run(actions: Action[], from: GameState = initialState(mission)): GameState {
  return actions.reduce(applyAction, from);
}

describe('a crew without roles', () => {
  it('starts with as many connected players as the mission takes, and with no other count', () => {
    expect(() => run([join('p1'), start()])).toThrow('Für diese Mission braucht es mindestens 2');
    expect(run([join('p1'), join('p2'), ready('p2'), start()]).phase).toBe('playing');
    const three = run([join('p1'), join('p2'), join('p3'), ready('p2'), ready('p3'), start()]);
    expect(three.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(() => run([join('p1'), join('p2'), join('p3'), join('p4')])).toThrow(/voll \(max\. 3/);
  });

  it('draws every player a spawn of their own: the same for a seed, another for another', () => {
    const lobby = run([join('p1'), join('p2'), join('p3'), ready('p2'), ready('p3')]);
    const draws = Array.from({ length: 40 }, (_, seed) =>
      run([start(seed)], lobby).players.map((p) => p.spawn),
    );
    for (const drawn of draws) {
      expect(drawn).toHaveLength(3);
      expect(drawn).toEqual(expect.arrayContaining(WEST));
    }
    expect(run([start(7)], lobby).players).toEqual(run([start(7)], lobby).players);
    expect(new Set(draws.map((drawn) => JSON.stringify(drawn))).size).toBeGreaterThan(1);
    expect(viewFor(run([start(7)], lobby), 'p2').map?.yourSpawn).toEqual(
      run([start(7)], lobby).players[1]?.spawn,
    );
  });

  it('leaves out whoever is gone from the room, and does not wait for them', () => {
    const lobby = run([join('p1'), join('p2'), join('p3'), ready('p2')]);
    const gone = applyAction(lobby, { type: 'player-disconnected', playerId: 'p3' });
    const state = run([start()], gone);
    expect(state.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(state.credits).toEqual({ p1: NO_CREDITS, p2: NO_CREDITS });
    expect(state.paused).toBeNull();
    const short = applyAction(
      run([join('p1'), join('p2'), ready('p2')]),
      { type: 'player-disconnected', playerId: 'p2' },
    );
    expect(() => run([start()], short)).toThrow(/mindestens 2/);
  });

  it('tells the lobby how many the mission takes', () => {
    const view = viewFor(run([join('p1')]), 'p1');
    expect(view.crewSize).toEqual({ min: 2, max: 3 });
    expect(view.you).not.toHaveProperty('roleId');
    expect(view).not.toHaveProperty('roles');
  });
});

describe('the player count in the mission format', () => {
  it('takes two to four players at least and up to six, the least no more than the most', () => {
    const spawns = [...WEST, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    expect(() => parseMission(lab({ min: 2, max: 6 }, spawns))).not.toThrow();
    expect(() => parseMission(lab({ min: 1, max: 2 }, spawns))).toThrow(/players\.min/);
    expect(() => parseMission(lab({ min: 5, max: 6 }, spawns))).toThrow(/players\.min/);
    expect(() => parseMission(lab({ min: 2, max: 7 }, spawns))).toThrow(/players\.max/);
    expect(() => parseMission(lab({ min: 3, max: 2 }, spawns))).toThrow(
      /min must not be above max/,
    );
  });

  it('needs a spawn on the floor for every player of the largest crew', () => {
    expect(() => parseMission(lab({ min: 2, max: 3 }, WEST.slice(0, 2)))).toThrow(
      /2 spawns for up to 3 players/,
    );
    expect(() => parseMission(lab({ min: 2, max: 2 }, [{ x: 4, y: 1 }, ...WEST]))).toThrow(
      /spawn at 4,1 is not on a floor tile/,
    );
  });

  it('is walked for every crew it takes: every count, every choice of spawns', () => {
    // Both east spawns drawn for a crew of two: nobody gets to the box behind the door.
    const east = [...WEST, { x: 6, y: 1 }, { x: 7, y: 1 }];
    expect(() => parseMission(lab({ min: 2, max: 2 }, east))).toThrow(
      /nobody can reach station "kabel" .*\(crew of 2 starting at 6,1 · 7,1\)/,
    );
    // With three, somebody is always in the west.
    expect(() => parseMission(lab({ min: 3, max: 3 }, east.slice(1)))).not.toThrow();
    // But a crew of two from the same spawns still could be both east.
    expect(() => parseMission(lab({ min: 2, max: 3 }, east.slice(1)))).toThrow(/crew of 2/);
  });
});
