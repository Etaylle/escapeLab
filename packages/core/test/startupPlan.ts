import { readFileSync } from 'node:fs';
import {
  applyAction,
  moduleFor,
  parseMission,
  puzzleDueAt,
  stationKey,
  viewFor,
} from '../src/index.js';
import type {
  ConsoleId,
  GameState,
  LampPicture,
  Mission,
  Move,
  PuzzleDef,
  PuzzleInput,
  PuzzleView,
  StartupGap,
  StartupLoad,
} from '../src/index.js';
import { lightsOut, standing, started, T0 } from './lab.js';

/**
 * The Anlaufsteuerung's scratch mission (tools/fixtures/startup-probe.json, „Anlaufprobe") on
 * the seed the harness pins its room to, played through the reducer as tools/shots.mjs plays it
 * in two browsers: Ben (p2) switches the station on at console b and stays there, Anna (p1)
 * glances at the book in the west room, then works console a. Node cannot load core's
 * TypeScript, so tools/fixtures/startup-plan.json carries what this run deals stage by stage and
 * the values the solver sets; startup.test.ts keeps it the solver's own and proves it solves the
 * station through the reducer without an alarm. The breakers' moments are in no plan: they hang
 * on the server's clock, and the harness closes each once the ladder shows the pulse on its
 * marked steps, as the player there would.
 */

export const STARTUP_SEED = 5;

/** One stage of the probe as its pinned seed deals it, and the values the solver sets into it. */
export interface StartupPlanStage {
  /** 1-based */
  stage: number;
  /** the console whose terminal runs the script */
  types: ConsoleId;
  load: StartupLoad;
  /** the lamps of the Schaltfeld taking the pulse, from feeder 1 */
  feeders: LampPicture[];
  /** what the solver sets into each gap of the script */
  values: Partial<Record<StartupGap, number>>;
  /** the breaker it closes on the marked steps */
  breaker: number;
}

/** What the probe deals on its pinned seed, stage by stage. */
export interface StartupPlan {
  mission: string;
  seed: number;
  stages: StartupPlanStage[];
}

const fixtures = new URL('../../../tools/fixtures/', import.meta.url);

/** The probe mission as the harness imports it. */
export function startupProbe(): Mission {
  return parseMission(JSON.parse(readFileSync(new URL('startup-probe.json', fixtures), 'utf8')));
}

type StartupView = Extract<PuzzleView, { kind: 'startup' }>;

/** The open Anlaufsteuerung as `playerId` sees it in `state`. */
function startupOf(state: GameState, playerId: string): StartupView {
  const view = viewFor(state, playerId).puzzle;
  if (view?.kind !== 'startup') {
    throw new Error(`startup probe: ${playerId} sees no open Anlaufsteuerung`);
  }
  return view;
}

/** The probe's one station, and the key of its console b and the id of its book. */
function probeParts(mission: Mission): { def: PuzzleDef; consoleB: string; book: string } {
  const [def] = mission.puzzles;
  const [book] = mission.map.manuals;
  if (def === undefined || def.type !== 'startup' || book === undefined) {
    throw new Error('startup probe: the mission has no Anlaufsteuerung, or no book');
  }
  return { def, consoleB: stationKey({ puzzleId: def.id, console: 'b' }), book: book.id };
}

/** The probe up to the solver's first move: p2 switching it on at console b, p1 at console a. */
function manned(seed: number): GameState {
  const mission = startupProbe();
  const { def, consoleB, book } = probeParts(mission);
  const begun = standing(lightsOut(started(mission, seed)), { stations: { [consoleB]: ['p2'] } });
  const on = applyAction(begun, { type: 'interact', playerId: 'p2', at: T0 + 500 });
  const glance = standing(on, { stations: { [consoleB]: ['p2'] }, manuals: { [book]: ['p1'] } });
  return standing(glance, { stations: { [def.id]: ['p1'], [consoleB]: ['p2'] } });
}

/** `state` at `at`, its open station ticked as the room ticks it where its clock is due. */
function ticked(state: GameState, at: number): GameState {
  const due = puzzleDueAt(state);
  return due !== null && due <= at ? applyAction(state, { type: 'puzzle-tick', at }) : state;
}

/** The plan's entry for the stage the views show, as it opens. */
function stageOf(view: StartupView, board: StartupView): StartupPlanStage {
  const terminal = view.terminal;
  const feeders = board.board?.feeders.map((entry) => entry.lamps) ?? [];
  if (terminal === null) {
    throw new Error('startup probe: the typing console shows no terminal');
  }
  const { stage, types } = view;
  return { stage, types, load: terminal.load, feeders, values: {}, breaker: 0 };
}

/** What `move` adds to the plan's stage: a value set into a gap, or the breaker closed. */
function noted(stage: StartupPlanStage, move: Move<PuzzleInput>): void {
  const { input } = move;
  if ('breaker' in input) {
    stage.breaker = input.breaker;
  } else if ('cmd' in input && input.cmd === 'setze' && 'gap' in input) {
    stage.values[input.gap] = input.value;
  }
}

/**
 * The probe on `seed` played to the solve: each round a second on the clock, the station ticked
 * as the room ticks it once it is due, the solver given both consoles' views. Returns the run
 * and the plan it makes.
 */
export function playStartupProbe(seed = STARTUP_SEED): { state: GameState; plan: StartupPlan } {
  const mission = startupProbe();
  const { def } = probeParts(mission);
  const plan: StartupPlan = { mission: mission.id, seed, stages: [] };
  let state = manned(seed);
  for (let second = 1; state.currentPuzzleIndex === 0 && second < 600; second++) {
    const at = T0 + 1000 + second * 1000;
    state = round(def, ticked(state, at), plan, at);
  }
  return { state, plan };
}

/**
 * One second of the crew at the probe at `at`: a new stage noted in `plan` as it opens, the
 * solver's moves on both consoles' views, each noted and played through the reducer.
 */
function round(def: PuzzleDef, state: GameState, plan: StartupPlan, at: number): GameState {
  const views = { operator: startupOf(state, 'p1'), partner: startupOf(state, 'p2') };
  const typing = views.operator.role === 'terminal' ? views.operator : views.partner;
  const board = views.operator.role === 'board' ? views.operator : views.partner;
  if (plan.stages.at(-1)?.stage !== typing.stage) {
    plan.stages.push(stageOf(typing, board));
  }
  const moves = moduleFor(def.type).solve(def, { ...views, reader: views.operator }, null);
  const current = plan.stages.at(-1);
  return moves.reduce((now, move) => {
    if (current !== undefined) {
      noted(current, move);
    }
    const playerId = move.by === 'partner' ? 'p2' : 'p1';
    return applyAction(now, { type: 'puzzle-input', playerId, at, input: move.input });
  }, state);
}

/** The plan the harness carries: what the probe deals on its pinned seed, stage by stage. */
export function startupPlan(): StartupPlan {
  return playStartupProbe().plan;
}
