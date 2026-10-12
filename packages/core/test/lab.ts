import { applyAction, initialState, parseMission } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';

export const T0 = 1_000_000;

/**
 * A corridor lab around the given puzzles: a station for each along the top
 * row, one book covering them all and the sign along the bottom row, and the
 * roles — `pult` and `handbuch` unless named — spawning at the west end.
 */
export function labMission(
  puzzles: object[],
  id = 'labor',
  roleIds: readonly string[] = ['pult', 'handbuch'],
): Mission {
  const width = 3 * puzzles.length + 8;
  const wall = '#'.repeat(width);
  const corridor = `#${'.'.repeat(width - 2)}#`;
  const ids = puzzles.map((p) => ('id' in p ? String(p.id) : ''));
  return parseMission({
    id,
    title: 'Labor',
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    roles: roleIds.map((roleId) => ({ id: roleId, name: roleId, description: '' })),
    puzzles,
    map: {
      tiles: [wall, corridor, corridor, wall],
      spawns: Object.fromEntries(
        roleIds.map((roleId, i) => [roleId, { x: 1 + Math.floor(i / 2), y: 1 + (i % 2) }]),
      ),
      stations: ids.map((puzzleId, i) => ({ puzzleId, x: 4 + 3 * i, y: 1 })),
      manuals: [
        { id: 'buch', kind: 'book', x: width - 3, y: 2, label: 'HANDBUCH', puzzleIds: ids },
      ],
      edgeworkSign: { x: width - 2, y: 2 },
    },
  });
}

/** Players join in role order — p1, p2, … — everyone but the host confirms, the host starts. */
export function started(mission: Mission, seed = 7, at = T0): GameState {
  const crew = mission.roles.map((role, i) => ({ playerId: `p${i + 1}`, roleId: role.id }));
  const actions: Action[] = [
    ...crew.map(({ playerId }): Action => ({ type: 'player-join', playerId, name: playerId })),
    ...crew.map(({ playerId, roleId }): Action => ({ type: 'select-role', playerId, roleId })),
    ...crew
      .slice(1)
      .map(({ playerId }): Action => ({ type: 'set-ready', playerId, ready: true })),
    { type: 'start-mission', playerId: 'p1', at, seed },
  ];
  return actions.reduce(applyAction, initialState(mission));
}

/** Who stands where, the way the server reports it from positions. */
export function standing(
  state: GameState,
  where: {
    stations?: Record<string, string[]>;
    manuals?: Record<string, string[]>;
    signSeen?: string[];
  },
): GameState {
  return applyAction(state, {
    type: 'set-presence',
    stations: where.stations ?? {},
    manuals: where.manuals ?? {},
    signSeen: where.signSeen ?? [],
  });
}

/**
 * The armed station of a lab switched on: the operator stands at it, the
 * reader at the book, and — unless told otherwise — both have walked past
 * the sign.
 */
export function openLab(
  state: GameState,
  options: { operator?: string; reader?: string; signSeen?: string[]; at?: number } = {},
): GameState {
  const { operator = 'p1', reader = 'p2', at = T0 + 100 } = options;
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (def === undefined) {
    throw new Error('openLab: no puzzle left to open');
  }
  const here = standing(state, {
    stations: { [def.id]: [operator] },
    manuals: { buch: [reader] },
    signSeen: options.signSeen ?? [operator, reader],
  });
  return applyAction(here, { type: 'interact', playerId: operator, at });
}

/** Where a module's view is asked from: the station, the book, somewhere else, the audience. */
export const AT_STATION = { playerId: 'op', operating: true, reading: false } as const;
export const AT_BOOK = { playerId: 'rd', operating: false, reading: true } as const;
export const ELSEWHERE = { playerId: 'x', operating: false, reading: false } as const;
export const AUDIENCE = { playerId: null, operating: true, reading: true } as const;
