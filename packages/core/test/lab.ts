import { applyAction, initialState, parseMission } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';

export const T0 = 1_000_000;

/**
 * A corridor lab around the given puzzles: a station for each along the top
 * row, one book covering them all and the sign along the bottom row, and a
 * spawn at the west end for each of the `crew` players it takes.
 */
export function labMission(puzzles: object[], id = 'labor', crew = 2): Mission {
  const width = 3 * puzzles.length + 8;
  const wall = '#'.repeat(width);
  const corridor = `#${'.'.repeat(width - 2)}#`;
  const ids = puzzles.map((p) => ('id' in p ? String(p.id) : ''));
  return parseMission({
    id,
    title: 'Labor',
    players: { min: crew, max: crew },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles,
    map: {
      tiles: [wall, corridor, corridor, wall],
      spawns: Array.from({ length: crew }, (_, i) => ({
        x: 1 + Math.floor(i / 2),
        y: 1 + (i % 2),
      })),
      stations: ids.map((puzzleId, i) => ({ puzzleId, x: 4 + 3 * i, y: 1 })),
      manuals: [
        {
          id: 'buch',
          kind: 'book',
          label: 'HANDBUCH',
          puzzleIds: ids,
          spots: [{ x: width - 3, y: 2 }],
        },
      ],
      edgeworkSign: { x: width - 2, y: 2 },
    },
  });
}

/**
 * The smallest crew the mission takes joins — p1, p2, … — everyone but the
 * host confirms, the host starts.
 */
export function started(mission: Mission, seed = 7, at = T0): GameState {
  const crew = Array.from({ length: mission.players.min }, (_, i) => `p${i + 1}`);
  const actions: Action[] = [
    ...crew.map((playerId): Action => ({ type: 'player-join', playerId, name: playerId })),
    ...crew.slice(1).map((playerId): Action => ({ type: 'set-ready', playerId, ready: true })),
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
    seen?: string[];
  },
): GameState {
  return applyAction(state, {
    type: 'set-presence',
    stations: where.stations ?? {},
    manuals: where.manuals ?? {},
    signSeen: where.signSeen ?? [],
    seen: where.seen ?? [],
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
