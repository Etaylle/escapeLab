import { generateEdgework, moduleFor } from '../src/index.js';
import type { PuzzleContext, PuzzleDef } from '../src/index.js';
import { mulberry32 } from '../src/rng.js';

const T0 = 1_000_000;
/** Far more moves than any instance needs; past that the solver is going in circles. */
const MAX_MOVES = 500;

/**
 * Plays one instance of a puzzle the way a perfect crew would: the module's
 * solver only ever sees the role views — never the state — and every move it
 * picks goes through the input schema and `apply`, as a client's would.
 * Throws on an alarm, a solver without a move, a move from a role outside
 * the crew and on running out of moves. Returns the number of moves taken.
 */
export function playInstance(def: PuzzleDef, roleIds: string[], seed: number): number {
  const puzzleModule = moduleFor(def.type);
  const edgework = generateEdgework(mulberry32(seed + 1));
  const ctx = (at: number): PuzzleContext => ({ edgework, alarms: 0, remainingSec: 600, at });
  let state = puzzleModule.init(def, mulberry32(seed), ctx(T0));
  let moves = 0;
  for (let round = 1; moves < MAX_MOVES; round++) {
    const views = Object.fromEntries(
      roleIds.map((roleId) => [
        roleId,
        puzzleModule.view(def, state, roleId, { edgework, alarms: 0 }),
      ]),
    );
    const next = puzzleModule.solve(def, views, edgework);
    if (next.length === 0) {
      throw new Error(`${def.id} (seed ${seed}): the solver found no move`);
    }
    for (const { roleId, input } of next) {
      if (!roleIds.includes(roleId)) {
        throw new Error(`${def.id} (seed ${seed}): move for "${roleId}", who is not in the crew`);
      }
      moves += 1;
      const result = puzzleModule.apply(
        def,
        state,
        puzzleModule.inputSchema.parse(input),
        roleId,
        ctx(T0 + round * 1000),
      );
      if (result.penalty !== null) {
        const move = `${JSON.stringify(input)} from ${roleId}`;
        throw new Error(`${def.id} (seed ${seed}): alarm "${result.penalty}" on ${move}`);
      }
      state = result.state;
      if (result.solved) {
        return moves;
      }
    }
  }
  throw new Error(`${def.id} (seed ${seed}): not solved within ${MAX_MOVES} moves`);
}
