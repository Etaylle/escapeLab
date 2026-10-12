import { generateEdgework, moduleFor } from '../src/index.js';
import type {
  ConsoleId,
  Move,
  Perspectives,
  PuzzleContext,
  PuzzleDef,
  PuzzleInput,
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
/** Far longer than any module waits for the clock; past that the solver is stuck. */
export const MAX_IDLE_SEC = 60;
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

/**
 * Plays one instance of a puzzle the way a perfect crew would: one player
 * works the station, the other reads its rules at a manual object, and at a
 * station with two consoles a third player works console b. The module's
 * solver only ever sees their views — never the state — plus the crew's
 * transcript and the clock, and the edgework only where the module reads
 * it. Every move it picks goes through the input schema and `apply`, as a
 * client's would: an operator move from the player at console a, a partner
 * move from the player at console b, an `everyone` move from every player
 * at the station (at a station with one console, both players). The clock
 * stands still while the crew moves; when the solver waits, it runs on a
 * second and the solver is asked again. Throws on an alarm, on a partner
 * move at a station with one console, on MAX_IDLE_SEC seconds without a
 * move and on running out of moves. Returns the number of moves taken.
 */
export function playInstance(def: PuzzleDef, seed: number): number {
  const puzzleModule = moduleFor(def.type);
  type View = ReturnType<typeof puzzleModule.view>;
  const twoConsoles = puzzleModule.consoles === 2;
  const crew = twoConsoles ? [OPERATOR, PARTNER, READER] : [OPERATOR, READER];
  const edgework = generateEdgework(mulberry32(seed + 1));
  let remainingSec = START_SEC;
  const ctx = (at: number, from: ConsoleId | null): PuzzleContext => ({
    edgework,
    alarms: 0,
    remainingSec,
    at,
    crew,
    console: from,
  });
  const viewCtx: ViewContext = { edgework, alarms: 0, crew };
  let state = puzzleModule.init(def, mulberry32(seed), ctx(T0, null));
  const transcript: SolveAid<PuzzleInput, View>['transcript'] = [];
  /** Who sends a move, each from the console they stand at. */
  const senders = (by: Move<PuzzleInput>['by']): [string, ConsoleId][] => {
    if (by === 'operator') {
      return [[OPERATOR, 'a']];
    }
    if (by === 'partner') {
      if (!twoConsoles) {
        throw new Error(`${def.id} (seed ${seed}): a partner move at a station with one console`);
      }
      return [[PARTNER, 'b']];
    }
    return twoConsoles
      ? [
          [OPERATOR, 'a'],
          [PARTNER, 'b'],
        ]
      : crew.map((id): [string, ConsoleId] => [id, 'a']);
  };
  /** One move through the input schema and `apply`, from each of its senders. */
  const play = (move: Move<PuzzleInput>, at: number): boolean => {
    for (const [playerId, from] of senders(move.by)) {
      const input = puzzleModule.inputSchema.parse(move.input);
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
    const seen = (viewer: Viewer): View => puzzleModule.view(def, state, viewer, viewCtx);
    const views: Perspectives<View> = {
      operator: seen(AT_A),
      ...(twoConsoles ? { partner: seen(AT_B) } : {}),
      reader: seen(AT_BOOK),
    };
    const next = puzzleModule.solve(def, views, signRead, { transcript, remainingSec });
    if (next.length === 0) {
      if (idle === MAX_IDLE_SEC) {
        throw new Error(`${def.id} (seed ${seed}): the solver found no move in ${MAX_IDLE_SEC} s`);
      }
      idle += 1;
      remainingSec -= 1;
      continue;
    }
    idle = 0;
    for (const move of next) {
      moves += 1;
      transcript.push({ ...move, before: views });
      if (play(move, T0 + round * 1000)) {
        return moves;
      }
    }
  }
  throw new Error(`${def.id} (seed ${seed}): not solved within ${MAX_MOVES} moves`);
}
