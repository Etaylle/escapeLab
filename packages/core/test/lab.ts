import {
  applyAction,
  consoleFind,
  findKey,
  initialState,
  moduleFor,
  parseMission,
  placesOf,
} from '../src/index.js';
import type { Action, GameState, Mission, PuzzleDef } from '../src/index.js';

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

/** Where the chamber's box's rules may lie: inside its door, beside the box, or outside it. */
export const INSIDE = { x: 7, y: 3 };
export const OUTSIDE = { x: 2, y: 3 };

/**
 * Two rooms: the west one with the spawns, the sign and a plate, the east one with the wiring
 * box behind a door that only the plate holds open — until the box is solved, then it stays
 * open — and the hatch. Each source of the box's rules lies on the spots given. Unparsed, so
 * that a test may hold the validation to it.
 *
 *   0123456789
 * 0 ##########
 * 1 #....#...#   sign (2,1); box (7,1)
 * 2 #........#   spawns (1,1) (1,2) (1,3); plate (3,2); door (5,2); exit (8,2)
 * 3 #....#...#   inside (7,3), outside (2,3)
 * 4 ##########
 */
export function chamber(
  crew: number,
  sources: { x: number; y: number }[][],
  opensBy: object = { kind: 'plate', plateId: 'platte', untilSolved: 'kabel' },
): object {
  const labels = ['HANDBUCH', 'TAFEL'];
  return {
    id: 'kammer',
    title: 'Kammer',
    players: { min: crew, max: crew },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [{ type: 'wiring', id: 'kabel', title: 'Kabel' }],
    map: {
      tiles: ['##########', '#....#...#', '#........#', '#....#...#', '##########'],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 1, y: 3 },
      ],
      doors: [{ id: 'tuer', x: 5, y: 2, opensBy }],
      plates: [{ id: 'platte', x: 3, y: 2, label: 'HALTEN' }],
      stations: [{ puzzleId: 'kabel', x: 7, y: 1 }],
      manuals: sources.map((spots, i) => ({
        id: `quelle-${i}`,
        kind: 'book',
        label: labels[i] ?? 'HANDBUCH',
        puzzleIds: ['kabel'],
        spots,
      })),
      edgeworkSign: { x: 2, y: 1 },
      exit: { x: 8, y: 2 },
    },
  };
}

/** The chamber for a crew of three, its box's rules inside the door: one of them holds the plate. */
export function chamberLab(): Mission {
  return parseMission({ ...chamber(3, [[INSIDE]]), id: 'kammer-drei' });
}

/**
 * The labs the module tests play beside the shipped missions: the station of two consoles for
 * a crew of two (nobody left to read there) and of three, and the chamber for three.
 */
export function labs(): Mission[] {
  return [consoleLab(2, 'doppelpult-zwei'), consoleLab(3, 'doppelpult-drei'), chamberLab()];
}

/**
 * How many of a crew of `crew` the station of `def` puts to work at once: a hand for each of
 * its places (core hands.ts `placesOf`) — where the whole crew works the panel, every one of
 * them at it, besides its other places.
 */
export function handsTaken(mission: Mission, def: PuzzleDef, crew: number): number {
  const places = placesOf(mission, def.id).length;
  return moduleFor(def.type).wholeCrew ? places - 1 + crew : places;
}

/** `playerId`'s line drops at `at`, as the room hears it go. */
export function lineDrops(playerId: string, at: number): Action {
  return { type: 'player-disconnected', playerId, at };
}

/** `playerId`'s line is back at `at`, as the room hears them resume. */
export function lineBack(playerId: string, at: number): Action {
  return { type: 'player-connected', playerId, at };
}

/**
 * The server goes down for maintenance at `at`, as a deploy takes it: a run stands still for
 * the whole crew, every seat off the line, until it is back (`lineBack`).
 */
export function serverDown(at: number): Action {
  return { type: 'maintenance', at, waitFrom: at };
}

/**
 * A crew of `size` joins — p1, p2, …, the smallest the mission takes unless told otherwise —
 * everyone but the host confirms, the host starts.
 */
export function started(
  mission: Mission,
  seed = 7,
  at = T0,
  size = mission.players.min,
): GameState {
  const crew = Array.from({ length: size }, (_, i) => `p${i + 1}`);
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

/** The server's report of who stands where, as the reducer takes it. */
type PresenceReport = Omit<Extract<Action, { type: 'set-presence' }>, 'type'>;

/** Nobody anywhere at T0: what `standing` reports where it is told nothing else. */
const NOBODY_HERE: PresenceReport = {
  stations: {},
  manuals: {},
  notes: {},
  plates: {},
  signSeen: [],
  found: {},
  sight: {},
  exit: [],
  at: T0,
};

/**
 * Who stands where, the way the server reports it from positions: at the station spots, the
 * manual objects, the notes and on the plates, past the sign, on the hatch, what each player
 * has just found at `at` and what each has in sight (discovery.ts keys, by player id).
 */
export function standing(state: GameState, where: Partial<PresenceReport>): GameState {
  return applyAction(state, { type: 'set-presence', ...NOBODY_HERE, ...where });
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

/** The keys of every console of the run's map: what a player with all of them in sight has. */
export function everyConsole(state: GameState): string[] {
  return state.mission.map.stations.map((spot) => findKey(consoleFind(spot)));
}
