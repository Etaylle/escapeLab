import { z } from 'zod';
import type { Edgework } from '../edgework.js';
import type { Rng } from '../rng.js';

/**
 * The contract every puzzle type implements. A module owns its type end to
 * end — mission-file shape, runtime state, the inputs a client may send, the
 * place-filtered view, the printed manual and a solver — so adding a type is
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
  /** ids of the connected players */
  crew: string[];
}

/** Views are rebuilt on every change, not on every tick, so they get no clock. */
export type ViewContext = Pick<PuzzleContext, 'edgework' | 'alarms' | 'crew'>;

/** Who looks at the open puzzle, and from where. */
export interface Viewer {
  /** null for the spectator */
  playerId: string | null;
  /** standing at the open station */
  operating: boolean;
  /** standing at a manual object that covers this station */
  reading: boolean;
}

/** The open puzzle as the crew sees it: at the station, and at a manual object covering it. */
export interface Perspectives<View> {
  operator: View;
  reader: View;
}

/** One input for the crew: sent by a player at the station, or by every player there. */
export interface Move<Input> {
  by: 'operator' | 'everyone';
  input: Input;
}

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
  transcript: (Move<Input> & { before: Perspectives<View> })[];
  /** seconds left on the mission clock right now; null when the caller has no clock */
  remainingSec: number | null;
}

/** Fields every puzzle def carries; the reducer and the views rely on them. */
export interface PuzzleDefCommon {
  type: string;
  id: string;
  title: string;
  /** what a wrong move costs; already scaled to the difficulty at runtime */
  penaltySec: number;
  /**
   * up to three notes of the last crew (nudge → specific → near-answer),
   * asked for one at a time at a manual object that covers the station
   */
  hints: string[];
  /** labels of the rooms whose lights come on once the puzzle is solved */
  lights: string[];
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
  hints: z.array(z.string().min(1)).max(3).default([]),
  lights: z.array(z.string().min(1)).default([]),
  onSolved: z.string().min(1).optional(),
};

/** An object schema whose output is the def — zod can only discriminate on `type` in those. */
export type DefSchema<Def> = z.ZodType<Def> & z.core.$ZodTypeDiscriminable;

/** What the views attach to every module's own part of the open puzzle. */
export interface PuzzleViewCommon {
  index: number;
  total: number;
  title: string;
  /** the printed rules — only for readers and the audience */
  manual: ManualSection[] | null;
}

/** What every module owns, whether it stands at a station or runs as an emergency. */
export interface ModuleCore<Def extends PuzzleDefCommon, State, Input> {
  readonly type: Def['type'];
  /** a mission using this module needs the edgework sign on its map */
  readonly usesEdgework: boolean;
  /** mission-file shape; an object schema with a literal `type` and the common fields */
  readonly defSchema: DefSchema<Def>;
  /** what the client may send in a `puzzle-input` message for this module */
  readonly inputSchema: z.ZodType<Input>;
  init(def: Def, rng: Rng, ctx: PuzzleContext): State;
  /** the printed rules; must not depend on state, seed or edgework */
  manual(def: Def): ManualSection[];
}

/**
 * A puzzle at a station: worked by the players standing at the station while
 * it is open, its rules read at manual objects elsewhere on the map.
 */
export interface PuzzleModule<
  Def extends PuzzleDefCommon,
  State,
  Input,
  View extends { kind: Def['type'] },
> extends ModuleCore<Def, State, Input> {
  /**
   * Every connected player works the panel at once and nobody has to read:
   * the station needs no manual object, but the whole crew has to be able
   * to stand at it together.
   */
  readonly wholeCrew: boolean;
  /**
   * A move by `playerId`, who stands at the station (the reducer checks
   * that); throws a GameError (see `fail`) when the move is not allowed at all.
   */
  apply(
    def: Def,
    state: State,
    input: Input,
    playerId: string,
    ctx: PuzzleContext,
  ): ApplyResult<State>;
  /** place-filtered projection — THE place where asymmetry is enforced for this module */
  view(def: Def, state: State, viewer: Viewer, ctx: ViewContext): View;
  /**
   * The crew's next correct input(s), computed only from what the crew can
   * actually know: the view at the station, the view at a manual object, the
   * edgework (null while nobody has read the sign) and the aid, for the
   * modules that need more than the views show. Inputs returned together
   * are applied in order at the same moment; none means the crew waits, and
   * the caller asks again once the clock has moved on. Used by the smoke run
   * and by the property tests that prove every instance is solvable from
   * what the crew can see.
   */
  solve(
    def: Def,
    views: Perspectives<View>,
    edgework: Edgework | null,
    aid?: SolveAid<Input, View>,
  ): Move<Input>[];
}

/** The relay emergency's contract: a console for every player of the run. */
export interface EmergencyModule<
  Def extends PuzzleDefCommon,
  State,
  Input,
  View extends { kind: Def['type'] },
> extends ModuleCore<Def, State, Input> {
  /** throws a GameError (see `fail`) when `playerId` may not make this move at all */
  apply(
    def: Def,
    state: State,
    input: Input,
    playerId: string,
    ctx: PuzzleContext,
  ): ApplyResult<State>;
  /** player-filtered projection: that player's console and instruction; none for the audience */
  view(def: Def, state: State, playerId: string | null, ctx: ViewContext): View;
  /** the crew's next correct inputs, from every player's view, by player id */
  solve(
    def: Def,
    views: Record<string, View>,
    edgework: Edgework | null,
  ): { playerId: string; input: Input }[];
}
