import { generateEdgework, moduleFor } from '../src/index.js';
import type {
  ConsoleId,
  Move,
  Perspectives,
  PuzzleContext,
  PuzzleDef,
  PuzzleInput,
  PuzzleState,
  SolveAid,
  Viewer,
  ViewContext,
} from '../src/index.js';
import { mulberry32 } from '../src/rng.js';

const T0 = 1_000_000;
/** Far more moves than any instance needs; past that the solver is going in circles. */
const MAX_MOVES = 500;
/** The mission clock as an instance starts. */
const START_SEC = 600;
/**
 * Far longer than any module waits for the clock; past that the solver is stuck. The longest
 * wait is the Zugangskontrolle's: its token device comes round to an account two of its longest
 * periods (60 s) after it left it, one second more where the period turned as the login went in.
 */
export const MAX_IDLE_SEC = 150;
/**
 * One player at the station — at console a where it has two, with a second
 * player at console b — and one at a manual object that covers it.
 */
const OPERATOR = 'op';
const PARTNER = 'pt';
const READER = 'rd';
const AT_A: Viewer = { playerId: OPERATOR, operating: true, reading: false, console: 'a' };
const AT_B: Viewer = { playerId: PARTNER, operating: true, reading: false, console: 'b' };
const AT_BOOK: Viewer = { playerId: READER, operating: false, reading: true, console: null };

/** `state` at `at`, ticked as the room ticks the open puzzle once its clock is due (`dueAt`). */
function tickedAt(def: PuzzleDef, state: PuzzleState, at: number): PuzzleState {
  const puzzleModule = moduleFor(def.type);
  const due = puzzleModule.dueAt?.(def, state) ?? null;
  return due !== null && due <= at ? (puzzleModule.expire?.(def, state, at) ?? state) : state;
}

/**
 * Who sends a move by `by`, each from the console they stand at: at a station with two consoles
 * the operator at a and the partner at b, at one with one `crew` at it; throws for a partner move
 * there.
 */
function sendersOf(
  by: Move<PuzzleInput>['by'],
  twoConsoles: boolean,
  crew: readonly string[],
  label: string,
): [string, ConsoleId][] {
  if (by === 'operator') {
    return [[OPERATOR, 'a']];
  }
  if (by === 'partner') {
    if (!twoConsoles) {
      throw new Error(`${label}: a partner move at a station with one console`);
    }
    return [[PARTNER, 'b']];
  }
  return twoConsoles
    ? [
        [OPERATOR, 'a'],
        [PARTNER, 'b'],
      ]
    : crew.map((id): [string, ConsoleId] => [id, 'a']);
}

/** What the crew sees: console a's view (the station's), console b's where there is one, the book's. */
function perspectivesOf<View>(seen: (viewer: Viewer) => View, twoConsoles: boolean) {
  const views: Perspectives<View> = {
    operator: seen(AT_A),
    ...(twoConsoles ? { partner: seen(AT_B) } : {}),
    reader: seen(AT_BOOK),
  };
  return views;
}

/** The seconds waited in a row after one more without a move; throws past MAX_IDLE_SEC. */
function waitedOn(idle: number, label: string): number {
  if (idle === MAX_IDLE_SEC) {
    throw new Error(`${label}: the solver found no move in ${MAX_IDLE_SEC} s`);
  }
  return idle + 1;
}

/** The solver the harness asks: the module's own, unless a test hands it another crew's. */
export type Solver = ReturnType<typeof moduleFor>['solve'];

/**
 * Plays one instance of a puzzle the way a perfect crew would: one player
 * works the station, the other reads its rules at a manual object, and at a
 * station with two consoles a third player works console b. The module's
 * solver only ever sees their views — never the state — plus the crew's
 * transcript and the clock, and the edgework only where the module reads
 * it. Every move it picks goes through the input schema and `apply`, as a
 * client's would: an operator move from the player at console a, a partner
 * move from the player at console b, an `everyone` move from every player
 * at the station (at a station with one console, both players). Every round
 * is a second of the module's clock, and the puzzle is ticked as the room
 * ticks it once its `dueAt` has come; the mission clock stands still while
 * the crew moves, and when the solver waits it runs on a second and the
 * solver is asked again; a station that runs on its consoles' presence is brought to every
 * moment as the reducer brings it (`elapse`), both consoles manned. A test may hand in another
 * crew's `solver` in place of the module's. Throws on an alarm, on a partner
 * move at a station with one console, on MAX_IDLE_SEC seconds without a
 * move and on running out of moves. Returns the number of moves taken.
 */
export function playInstance(def: PuzzleDef, seed: number, solver?: Solver): number {
  const puzzleModule = moduleFor(def.type);
  const solve = solver ?? puzzleModule.solve;
  type View = ReturnType<typeof puzzleModule.view>;
  const twoConsoles = puzzleModule.consoles === 2;
  const crew = twoConsoles ? [OPERATOR, PARTNER, READER] : [OPERATOR, READER];
  const edgework = generateEdgework(mulberry32(seed + 1));
  let remainingSec = START_SEC;
  // Where the station has two consoles, the operator stands at a and the partner at b.
  const atConsoles = twoConsoles ? { a: [OPERATOR], b: [PARTNER] } : { a: [], b: [] };
  const ctx = (at: number, from: ConsoleId | null): PuzzleContext => ({
    edgework,
    alarms: 0,
    remainingSec,
    at,
    crew,
    console: from,
    atConsoles: from === null ? { a: [], b: [] } : atConsoles,
    readers: from === null ? [] : [READER],
  });
  const operators = twoConsoles ? [OPERATOR, PARTNER] : [OPERATOR];
  const viewCtx: ViewContext = { edgework, alarms: 0, crew, operators };
  let state = puzzleModule.init(def, mulberry32(seed), ctx(T0, null));
  const transcript: SolveAid<PuzzleInput, View>['transcript'] = [];
  const senders = (by: Move<PuzzleInput>['by']) =>
    sendersOf(by, twoConsoles, crew, `${def.id} (seed ${seed})`);
  /**
   * Where the station runs on its consoles' presence (`elapse`), the station brought to `at` as
   * the reducer brings it, both consoles manned: true once that solved it; throws on its alarm.
   */
  const elapsed = (at: number): boolean => {
    const result = puzzleModule.elapse?.(def, state, { ...ctx(at, null), atConsoles });
    if (result === undefined) {
      return false;
    }
    if (result.penalty !== null) {
      throw new Error(`${def.id} (seed ${seed}): alarm "${result.penalty}" on the clock`);
    }
    state = result.state;
    return result.solved;
  };
  /** One move through the input schema and `apply`, from each of its senders. */
  const play = (move: Move<PuzzleInput>, at: number): boolean => {
    for (const [playerId, from] of senders(move.by)) {
      const input = puzzleModule.inputSchema.parse(move.input);
      if (elapsed(at)) {
        return true;
      }
      const result = puzzleModule.apply(def, state, input, playerId, ctx(at, from));
      if (result.penalty !== null) {
        const made = `${JSON.stringify(move.input)} from ${playerId}`;
        throw new Error(`${def.id} (seed ${seed}): alarm "${result.penalty}" on ${made}`);
      }
      state = result.state;
      if (result.solved) {
        return true;
      }
    }
    return false;
  };
  const signRead = puzzleModule.usesEdgework ? edgework : null;
  let moves = 0;
  let idle = 0;
  for (let round = 1; moves < MAX_MOVES; round++) {
    const at = T0 + round * 1000;
    state = tickedAt(def, state, at);
    if (elapsed(at)) {
      return moves;
    }
    const seen = (viewer: Viewer): View => puzzleModule.view(def, state, viewer, viewCtx);
    const views = perspectivesOf(seen, twoConsoles);
    const next = solve(def, views, signRead, { transcript, remainingSec, at });
    if (next.length === 0) {
      idle = waitedOn(idle, `${def.id} (seed ${seed})`);
      remainingSec -= 1;
      continue;
    }
    idle = 0;
    for (const move of next) {
      moves += 1;
      transcript.push({ ...move, before: views });
      if (play(move, at)) {
        return moves;
      }
    }
  }
  throw new Error(`${def.id} (seed ${seed}): not solved within ${MAX_MOVES} moves`);
}
