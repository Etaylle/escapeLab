import {
  applyAction,
  moduleFor,
  parseMission,
  puzzleDueAt,
  stationKey,
  viewFor,
} from '../src/index.js';
import type {
  Action,
  GameState,
  Mission,
  Move,
  PlayerView,
  PuzzleDef,
  PuzzleInput,
  PuzzleView,
  SolveAid,
} from '../src/index.js';
import { releaseDigit } from '../src/puzzles/button.js';
import { hallMission } from './hall.js';
import { standing, started, T0 } from './lab.js';

/**
 * The Übungshalle on the seed the walkthrough pins its room to, played through the reducer the
 * way tools/shots.mjs plays it in two browsers — and what that run deals, station by station,
 * as the walkthrough carries it: Node cannot load core's TypeScript, so
 * tools/fixtures/hall-plan.json holds this plan, hall.test.ts keeps it the solvers' own, and
 * the walkthrough checks each instance in the browser against it before it plays the moves.
 * Player p1 is the host, who joins first, and works every station — console a where it has
 * two, having read its rules at the book as it came on; p2, the guest, reads its rules or works
 * console b. Each round is a second on the clock, the open station ticked as the room ticks it.
 * The Zugangskontrolle's tokens hang on that clock: a token of the plan is the one the device
 * showed the solver, and the walkthrough types the one its device shows instead.
 */

export const HALL_SEED = 26;

interface Spot {
  x: number;
  y: number;
}

/** One station as the walkthrough takes it: what it opens on, and the moves that solve it. */
export interface HallStation {
  id: string;
  type: PuzzleDef['type'];
  title: string;
  /**
   * what the host's console shows as the station comes on, by field of its view: the
   * walkthrough holds the browser's view to these before it plays a move
   */
  opens: Record<string, unknown>;
  /** every move to the solve, oldest first, as the solver makes it on the crew's views */
  moves: Move<PuzzleInput>[];
  /** for the button held: the digit the clock shows as it is let go; null for any other */
  releaseAt: number | null;
}

export interface HallPlan {
  mission: string;
  seed: number;
  /** where the draw puts the host and the guest */
  spawns: { host: Spot; guest: Spot };
  /** the Laborkennung's serial */
  serial: string;
  /** every station, in the order the walkthrough takes them */
  stations: HallStation[];
}

/** The hall as the game takes it. */
export function hall(): Mission {
  return parseMission(hallMission());
}

/**
 * The order the walkthrough takes the stations in: the row of bays at the entrance first, west
 * to east, then each row further in, turning at its end — the shortest way through the hall.
 */
export function walkOrder(mission: Mission): string[] {
  const rows = new Map<number, { id: string; x: number }[]>();
  for (const def of mission.puzzles) {
    const spot = mission.map.stations.find((s) => s.puzzleId === def.id && s.console !== 'b');
    if (spot === undefined) {
      throw new Error(`hall plan: "${def.id}" has no station`);
    }
    rows.set(spot.y, [...(rows.get(spot.y) ?? []), { id: def.id, x: spot.x }]);
  }
  const ordered = [...rows.entries()].sort(([a], [b]) => b - a);
  return ordered.flatMap(([, row], i) => {
    const westToEast = [...row].sort((a, b) => a.x - b.x).map((station) => station.id);
    return i % 2 === 0 ? westToEast : westToEast.reverse();
  });
}

/** The fields of each module's view the walkthrough checks as a station comes on. */
const OPENS: Readonly<Partial<Record<PuzzleDef['type'], readonly string[]>>> = {
  wiring: ['wires'],
  keypad: ['keys'],
  switches: ['switches'],
  simon: ['buttons', 'flashes'],
  maze: ['pos', 'goal'],
  memory: ['display', 'labels'],
  morse: ['pattern', 'dial'],
  button: ['colour', 'label'],
  signal: ['sends', 'sequence'],
  circuit: ['wires'],
  servers: ['rows'],
  access: ['terminal'],
};

const CREW = ['p1', 'p2'] as const;

/** Who stands where — as `standing` reports it — while the crew works a station. */
type CrewPlaces = { stations: Record<string, string[]>; manuals?: Record<string, string[]> };

/**
 * Where the crew stands to work the station `def` of `mission`: both at it where the whole crew
 * presses; p1 at console a and p2 at console b where it has two; else p1 at it, p2 at its book.
 */
export function crewAt(mission: Mission, def: PuzzleDef): CrewPlaces {
  const book = mission.map.manuals.find((m) => m.puzzleIds.includes(def.id));
  const { wholeCrew, consoles } = moduleFor(def.type);
  if (wholeCrew) {
    return { stations: { [def.id]: [...CREW] } };
  }
  if (consoles === 2) {
    const consoleB = stationKey({ puzzleId: def.id, console: 'b' });
    return { stations: { [def.id]: ['p1'], [consoleB]: ['p2'] } };
  }
  const manuals = book === undefined ? {} : { [book.id]: ['p2'] };
  return { stations: { [def.id]: ['p1'] }, manuals };
}

/** The station `def` switched on: the crew at its places and p1's E. */
function switchOn(state: GameState, def: PuzzleDef, at: number): GameState {
  const here = standing(state, crewAt(state.mission, def));
  return applyAction(here, { type: 'interact', playerId: 'p1', at });
}

/** The open puzzle as `view` shows it; throws where none is open. */
function puzzleOf(view: PlayerView): PuzzleView {
  if (view.puzzle === null) {
    throw new Error(`hall plan: ${view.you.id} sees no open puzzle`);
  }
  return view.puzzle;
}

/** Every move as the puzzle-inputs it takes: p1's, p2's, or both. */
function inputs(moves: Move<PuzzleInput>[], at: number): Action[] {
  return moves.flatMap((move) => {
    const by = move.by === 'everyone' ? CREW : move.by === 'partner' ? ['p2'] : ['p1'];
    return by.map(
      (playerId): Action => ({ type: 'puzzle-input', playerId, at, input: move.input }),
    );
  });
}

/** What the solver reads of the clock. */
type ClockAid = Pick<SolveAid<PuzzleInput, PuzzleView>, 'remainingSec' | 'elapsedSec'>;

/** The clock of a hall that has none, as the solver's aid reads it at `at`: the time run. */
function clockAid(state: GameState, at: number): ClockAid {
  const from = state.clockFrom ?? at;
  return { remainingSec: null, elapsedSec: Math.floor((at - from) / 1000) };
}

/** What the host's console shows of the fields the walkthrough checks. */
function opensOf(def: PuzzleDef, view: PuzzleView): Record<string, unknown> {
  const shown = view as unknown as Record<string, unknown>;
  const fields = OPENS[def.type] ?? [];
  return Object.fromEntries(fields.map((key) => [key, structuredClone(shown[key])]));
}

/** `state` at `at`, its open station ticked as the room ticks it once its clock is due. */
export function ticked(state: GameState, at: number): GameState {
  const due = puzzleDueAt(state);
  return due !== null && due <= at ? applyAction(state, { type: 'puzzle-tick', at }) : state;
}

/**
 * The rules of a station with two consoles as the host reads them at its book as it comes on,
 * before taking console a, the guest at console b meanwhile: the Zugangskontrolle's list is read
 * so. Null for a station with one console, whose rules the guest reads at the book throughout.
 */
function glanceAtBook(state: GameState, def: PuzzleDef): PuzzleView | null {
  const book = state.mission.map.manuals.find((m) => m.puzzleIds.includes(def.id));
  if (moduleFor(def.type).consoles !== 2 || book === undefined) {
    return null;
  }
  const consoleB = stationKey({ puzzleId: def.id, console: 'b' });
  const places = { stations: { [consoleB]: ['p2'] }, manuals: { [book.id]: ['p1'] } };
  return puzzleOf(viewFor(standing(state, places), 'p1'));
}

/** A station's play so far: the moves, the crew's transcript, the digit the button goes on. */
interface Played {
  moves: Move<PuzzleInput>[];
  transcript: SolveAid<PuzzleInput, PuzzleView>['transcript'];
  releaseAt: number | null;
}

/**
 * One round of the crew at the station `def` at `time`: the solver's moves on the views the crew
 * holds — the host's console, the guest's at console b where there are two, the rules as `read`
 * at the book or as the guest reads them there — noted in `played`; the state after them.
 */
function roundAt(
  state: GameState,
  def: PuzzleDef,
  time: number,
  { read, played }: { read: PuzzleView | null; played: Played },
): GameState {
  const operator = puzzleOf(viewFor(state, 'p1'));
  const other = puzzleOf(viewFor(state, 'p2'));
  const two = moduleFor(def.type).consoles === 2;
  const views = { operator, ...(two ? { partner: other } : {}), reader: read ?? other };
  const aid = { transcript: played.transcript, ...clockAid(state, time) };
  const made = moduleFor(def.type).solve(def, views, viewFor(state, 'p1').edgework, aid);
  if (operator.kind === 'button' && operator.strip !== null) {
    played.releaseAt = releaseDigit(operator.strip);
  }
  played.transcript.push(...made.map((move) => ({ ...move, before: views })));
  played.moves.push(...made);
  return inputs(made, time).reduce(applyAction, state);
}

/**
 * One station from its switch-on to its solve at the round `round`, the station ticked as the
 * room ticks it: the round after it, and what it took.
 */
function playStation(
  state: GameState,
  def: PuzzleDef,
  round: number,
): { state: GameState; round: number; station: HallStation } {
  const index = state.currentPuzzleIndex;
  let next = switchOn(state, def, T0 + round * 1000);
  const opens = opensOf(def, puzzleOf(viewFor(next, 'p1')));
  const played: Played = { moves: [], transcript: [], releaseAt: null };
  const crew = { read: glanceAtBook(next, def), played };
  let at = round;
  for (; next.currentPuzzleIndex === index && at < round + 600; at++) {
    const time = T0 + at * 1000;
    next = roundAt(ticked(next, time), def, time, crew);
    if (next.penaltySeq > 0) {
      throw new Error(`hall plan: an alarm at "${def.id}" on seed ${next.seed}`);
    }
  }
  if (next.currentPuzzleIndex === index) {
    throw new Error(`hall plan: "${def.id}" stays unsolved after 600 rounds`);
  }
  const { moves, releaseAt } = played;
  const station = { id: def.id, type: def.type, title: def.title, opens, moves, releaseAt };
  return { state: next, round: at + 1, station };
}

/**
 * The whole hall through the reducer on `seed`, in the walkthrough's order: both walk past the
 * sign, then every station is switched on and worked by its module's solver on the views p1
 * and p2 hold. Returns the state once the last station has won the run, and every station as
 * played.
 */
export function playHall(seed = HALL_SEED): { state: GameState; stations: HallStation[] } {
  const mission = hall();
  let state = standing(started(mission, seed), { signSeen: [...CREW] });
  const stations: HallStation[] = [];
  let round = 1;
  for (const id of walkOrder(mission)) {
    const def = mission.puzzles.find((p) => p.id === id);
    if (def === undefined) {
      throw new Error(`hall plan: no puzzle "${id}"`);
    }
    const played = playStation(state, def, round);
    ({ state, round } = played);
    stations.push(played.station);
  }
  return { state, stations };
}

/** The hall on `seed`, as the walkthrough plays it: who starts where, every station's moves. */
export function hallPlan(seed = HALL_SEED): HallPlan {
  const { state, stations } = playHall(seed);
  const spawn = (id: string): Spot => {
    const at = state.players.find((p) => p.id === id)?.spawn;
    if (at == null) {
      throw new Error(`hall plan: ${id} drew no spawn`);
    }
    return { x: at.x, y: at.y };
  };
  return {
    mission: state.mission.id,
    seed,
    spawns: { host: spawn('p1'), guest: spawn('p2') },
    serial: state.edgework?.serial ?? '',
    stations,
  };
}
