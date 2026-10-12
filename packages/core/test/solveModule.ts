import { generateEdgework, moduleFor } from '../src/index.js';
import type {
  Move,
  Perspectives,
  PuzzleContext,
  PuzzleDef,
  PuzzleInput,
  SolveAid,
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
/** One player at the station, one at a manual object that covers it. */
const OPERATOR = 'op';
const READER = 'rd';
const CREW = [OPERATOR, READER];

/**
 * Plays one instance of a puzzle the way a perfect crew of two would: one
 * player works the station, the other reads its rules at a manual object.
 * The module's solver only ever sees their two views — never the state —
 * plus the crew's transcript and the clock, and every move it picks goes
 * through the input schema and `apply`, as a client's would: an operator
 * move from the player at the station, an `everyone` move from both. The
 * clock stands still while the crew moves; when the solver waits, it runs
 * on a second and the solver is asked again. Throws on an alarm, on
 * MAX_IDLE_SEC seconds without a move and on running out of moves. Returns
 * the number of moves taken.
 */
export function playInstance(def: PuzzleDef, seed: number): number {
  const puzzleModule = moduleFor(def.type);
  type View = ReturnType<typeof puzzleModule.view>;
  const edgework = generateEdgework(mulberry32(seed + 1));
  let remainingSec = START_SEC;
  const ctx = (at: number): PuzzleContext => ({
    edgework,
    alarms: 0,
    remainingSec,
    at,
    crew: CREW,
  });
  const viewCtx: ViewContext = { edgework, alarms: 0, crew: CREW };
  const viewer = (playerId: string, operating: boolean) => ({
    playerId,
    operating,
    reading: !operating,
  });
  let state = puzzleModule.init(def, mulberry32(seed), ctx(T0));
  const transcript: SolveAid<PuzzleInput, View>['transcript'] = [];
  /** One move through the input schema and `apply`, from the operator or from both. */
  const play = (move: Move<PuzzleInput>, at: number): boolean => {
    for (const playerId of move.by === 'everyone' ? CREW : [OPERATOR]) {
      const input = puzzleModule.inputSchema.parse(move.input);
      const result = puzzleModule.apply(def, state, input, playerId, ctx(at));
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
  let moves = 0;
  let idle = 0;
  for (let round = 1; moves < MAX_MOVES; round++) {
    const views: Perspectives<View> = {
      operator: puzzleModule.view(def, state, viewer(OPERATOR, true), viewCtx),
      reader: puzzleModule.view(def, state, viewer(READER, false), viewCtx),
    };
    const next = puzzleModule.solve(def, views, edgework, { transcript, remainingSec });
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
