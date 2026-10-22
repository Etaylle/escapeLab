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
 * A corridor lab for a crew of two or three with a station of two consoles:
 * the Signalkette with console a at (6,1) and console b at (13,1), then a
 * wiring box at (3,1); one book between the consoles covers both, and the
 * hatch waits at the east end.
 *
 *   0123456789012345
 * 0 ################
 * 1 #..............#   box (3,1); console a (6,1); console b (13,1)
 * 2 #..............#   spawns (1,1) (1,2) (2,1); sign (2,2); book (9,2); exit (14,2)
 * 3 ################
 */
export function consoleLab(crew = 2, id = 'doppelpult'): Mission {
  return parseMission({
    id,
    title: 'Doppelpult',
    players: { min: crew, max: crew },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [
      { type: 'signal', id: 'kette', title: 'Signalkette' },
      { type: 'wiring', id: 'kabel', title: 'Kabel' },
    ],
    map: {
      tiles: ['################', '#..............#', '#..............#', '################'],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
      ],
      stations: [
        { puzzleId: 'kette', x: 6, y: 1, console: 'a' },
        { puzzleId: 'kette', x: 13, y: 1, console: 'b' },
        { puzzleId: 'kabel', x: 3, y: 1 },
      ],
      manuals: [
        {
          id: 'buch',
          kind: 'book',
          label: 'HANDBUCH',
          puzzleIds: ['kette', 'kabel'],
          spots: [{ x: 9, y: 2 }],
        },
      ],
      edgeworkSign: { x: 2, y: 2 },
      exit: { x: 14, y: 2 },
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

/**
 * The end of the mission's intro, as the room dispatches it once the
 * lights are due: they go out at `at` and the clock starts. Nothing changes
 * for a mission without an intro, whose lights are out from the start.
 */
export function lightsOut(state: GameState, at = T0): GameState {
  return applyAction(state, { type: 'lights-out', at });
}

/** Who stands where, the way the server reports it from positions. */
export function standing(
  state: GameState,
  where: {
    stations?: Record<string, string[]>;
    manuals?: Record<string, string[]>;
    notes?: Record<string, string[]>;
    signSeen?: string[];
    seen?: string[];
    notesSeen?: number[];
    exit?: string[];
  },
): GameState {
  return applyAction(state, {
    type: 'set-presence',
    stations: where.stations ?? {},
    manuals: where.manuals ?? {},
    notes: where.notes ?? {},
    signSeen: where.signSeen ?? [],
    seen: where.seen ?? [],
    notesSeen: where.notesSeen ?? [],
    exit: where.exit ?? [],
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

/**
 * Where a module's view is asked from: the station (console a where there
 * are two), console b, the book, somewhere else, the audience.
 */
export const AT_STATION = { playerId: 'op', operating: true, reading: false, console: 'a' } as const;
export const AT_CONSOLE_B = {
  playerId: 'pt',
  operating: true,
  reading: false,
  console: 'b',
} as const;
export const AT_BOOK = { playerId: 'rd', operating: false, reading: true, console: null } as const;
export const ELSEWHERE = {
  playerId: 'x',
  operating: false,
  reading: false,
  console: null,
} as const;
export const AUDIENCE = { playerId: null, operating: true, reading: true, console: null } as const;
