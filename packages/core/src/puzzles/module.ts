import { z } from 'zod';
import type { Edgework } from '../edgework.js';
import type { Rng } from '../rng.js';

/**
 * The contract every puzzle type implements. A module owns its type end to
 * end — mission-file shape, runtime state, the inputs a client may send, the
 * role-filtered view, the printed manual and a solver — so adding a type is
 * one file in this folder plus one entry in ./index.ts.
 */

export interface ManualSection {
  heading: string;
  blocks: ManualBlock[];
}

export type ManualBlock =
  | { kind: 'p'; text: string }
  // ordered "if … then …" lines
  | { kind: 'rules'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  // keypad's symbol columns
  | { kind: 'columns'; columns: string[][] };

/** What a module gets to know when it sets up or takes a move. */
export interface PuzzleContext {
  edgework: Edgework;
  /** alarms so far (penaltySeq) — some rules change with them */
  alarms: number;
  /** seconds left on the mission clock at `at` */
  remainingSec: number;
  at: number;
}

/** Views are rebuilt on every change, not on every tick, so they get no clock. */
export type ViewContext = Pick<PuzzleContext, 'edgework' | 'alarms'>;

export interface ApplyResult<State> {
  state: State;
  solved: boolean;
  /**
   * Set on a wrong move: names the alarm in the run report, the def's
   * penaltySec is charged and the alarm fires. Null when the move was fine.
   */
  penalty: string | null;
}

/**
 * What a crew knows besides the views on its screens right now: what it did
 * at the station so far and what the mission clock shows. Only modules whose
 * views do not tell the whole story read it.
 */
export interface SolveAid<Input, View> {
  /**
   * every input the crew made at this station so far, oldest first, with the
   * views it saw just before; inputs made together share them
   */
  transcript: { roleId: string; input: Input; before: Record<string, View> }[];
  /** seconds left on the mission clock right now; null when the caller has no clock */
  remainingSec: number | null;
}

/** Fields every puzzle def carries; the reducer and the views rely on them. */
export interface PuzzleDefCommon {
  type: string;
  id: string;
  title: string;
  prompt: string;
  /** what a wrong move costs; already scaled to the difficulty at runtime */
  penaltySec: number;
  /** private text per role, shown to that role only; may stay empty */
  infos: { roleId: string; text: string }[];
  /** up to three progressive hints (nudge → specific → near-answer) from mission control */
  hints: string[];
  /** mission control's radio line once the puzzle is solved */
  onSolved?: string | undefined;
}

/**
 * Zod shapes of the common fields, to spread into a def schema. `type` and
 * `penaltySec` are left out: the literal and the default differ per module.
 */
export const commonDefShape = {
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string(),
  infos: z.array(z.object({ roleId: z.string(), text: z.string() })).default([]),
  hints: z.array(z.string().min(1)).max(3).default([]),
  onSolved: z.string().min(1).optional(),
};

/** An object schema whose output is the def — zod can only discriminate on `type` in those. */
export type DefSchema<Def> = z.ZodType<Def> & z.core.$ZodTypeDiscriminable;

/** What the views attach to every module's own part of the open puzzle. */
export interface PuzzleViewCommon {
  index: number;
  total: number;
  title: string;
  prompt: string;
  /** private text for this player's role, if the puzzle defines one */
  info: string | null;
  /** the printed rules — only for the puzzle's manual role */
  manual: ManualSection[] | null;
  /** mission-control hints — the same for every role and the audience */
  hints: {
    /** revealed so far for this puzzle */
    shown: string[];
    /** how many more this puzzle has */
    left: number;
    /** epoch ms when the next may be requested; null once none are left */
    readyAt: number | null;
    /** seconds the next one costs, already scaled to the difficulty */
    costSec: number;
  };
}

export interface PuzzleModule<
  Def extends PuzzleDefCommon,
  State,
  Input,
  View extends { kind: Def['type'] },
> {
  readonly type: Def['type'];
  /** a mission using this module needs a role with `seesEdgework` */
  readonly usesEdgework: boolean;
  /** mission-file shape; an object schema with a literal `type` and the common fields */
  readonly defSchema: DefSchema<Def>;
  /** what the client may send in a `puzzle-input` message for this module */
  readonly inputSchema: z.ZodType<Input>;
  init(def: Def, rng: Rng, ctx: PuzzleContext): State;
  /** throws a GameError (see `fail`) when `roleId` may not make this move at all */
  apply(
    def: Def,
    state: State,
    input: Input,
    roleId: string,
    ctx: PuzzleContext,
  ): ApplyResult<State>;
  /** role-filtered projection — THE place where asymmetry is enforced for this module */
  view(def: Def, state: State, roleId: string | null, ctx: ViewContext): View;
  /** the printed rules; must not depend on state, seed or edgework */
  manual(def: Def): ManualSection[];
  /**
   * The crew's next correct input(s), computed only from the role views
   * (every role's, by role id — what the crew can actually know), the
   * edgework, which is null when no role sees it (mission validation only
   * allows that for modules that ignore it), and the aid, for the modules
   * that need more than the views show. Inputs returned together are
   * applied in order at the same moment; none means the crew waits, and
   * the caller asks again once the clock has moved on. Used by the smoke
   * run and by the property tests that prove every instance is solvable
   * from what the crew can see.
   */
  solve(
    def: Def,
    views: Record<string, View>,
    edgework: Edgework | null,
    aid?: SolveAid<Input, View>,
  ): { roleId: string; input: Input }[];
}
