import { z } from 'zod';
import { buttonSyncModule } from './buttonSync.js';
import { keypadModule } from './keypad.js';
import { mazeModule } from './maze.js';
import type { DefSchema, PuzzleModule, PuzzleViewCommon } from './module.js';
import { simonModule } from './simon.js';
import { switchesModule } from './switches.js';
import { wiringModule } from './wiring.js';
import { buttonModule } from './button.js';

/**
 * Every puzzle type the game knows. Adding one is a file in this folder, an
 * import line and an entry here — the unions, the mission schema and the
 * reducer all follow from this list.
 */
export const MODULES = [
  buttonSyncModule,
  wiringModule,
  keypadModule,
  switchesModule,
  simonModule,
  mazeModule,
  buttonModule,
] as const;

type Module = (typeof MODULES)[number];
type Parts<M> =
  M extends PuzzleModule<infer D, infer S, infer I, infer V>
    ? { def: D; state: S; input: I; view: V }
    : never;

export type PuzzleDef = Parts<Module>['def'];
export type PuzzleState = Parts<Module>['state'];
export type PuzzleInput = Parts<Module>['input'];
/** The open puzzle as one role sees it: the module's own part plus the common part. */
export type PuzzleView = PuzzleViewCommon & Parts<Module>['view'];
/** What a client may send for one puzzle type. */
export type PuzzleInputOf<T extends PuzzleDef['type']> = Parts<
  Extract<Module, { type: T }>
>['input'];

/** MODULES is a non-empty literal, so its schema list is too. */
const defSchemas = MODULES.map((m) => m.defSchema) as [
  DefSchema<PuzzleDef>,
  ...DefSchema<PuzzleDef>[],
];
export const puzzleDefSchema: z.ZodType<PuzzleDef> = z.discriminatedUnion('type', defSchemas);

/**
 * The module behind a def, typed loosely enough to be called with the def
 * union. Sound as long as def, state and input all belong to that one
 * module, which holds for the open puzzle: its state was made by the same
 * module and its input was parsed by that module's schema.
 */
export function moduleFor(
  type: PuzzleDef['type'],
): PuzzleModule<PuzzleDef, PuzzleState, PuzzleInput, Parts<Module>['view']> {
  const found = MODULES.find((m) => m.type === type);
  if (found === undefined) {
    throw new Error(`no puzzle module for type "${type}"`);
  }
  return found;
}
