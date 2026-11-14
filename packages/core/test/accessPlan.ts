import { readFileSync } from 'node:fs';
import { applyAction, moduleFor, parseMission, puzzleDueAt, stationKey, viewFor } from '../src/index.js';
import type {
  AccessAccount,
  AccessDoor,
  GameState,
  Mission,
  Move,
  PuzzleDef,
  PuzzleInput,
  PuzzleView,
} from '../src/index.js';
import { lightsOut, standing, started, T0 } from './lab.js';

/**
 * The Zugangskontrolle's scratch mission (tools/fixtures/access-probe.json, „Zugangsprobe") on
 * the seed the harness pins its room to, played through the reducer as tools/shots.mjs plays it
 * in two browsers: Ben (p2) switches the station on at the token device and stays there, Anna
 * (p1) reads the list at the clipboard, then works the terminal. Node cannot load core's
 * TypeScript, so tools/fixtures/access-plan.json carries what this run deals and whom the
 * solver logs in for each door; access.test.ts keeps it the solver's own and proves it solves
 * the station through the reducer without an alarm. The tokens are in no plan: they hang on
 * the server's clock, and the harness reads each off the device as the player there would.
 */

export const ACCESS_SEED = 4;

/** What the probe deals on its pinned seed, and the solver's logins for it. */
export interface AccessPlan {
  mission: string;
  seed: number;
  /** the doors the terminal asks for, in its order */
  doors: AccessDoor[];
  /** the list as the clipboard shows it */
  roster: AccessAccount[];
  /** the doors in the order the solver releases them, each with the account it logs in */
  logins: { door: AccessDoor; account: string }[];
}

const fixtures = new URL('../../../tools/fixtures/', import.meta.url);

/** The probe mission as the harness imports it. */
export function accessProbe(): Mission {
  return parseMission(JSON.parse(readFileSync(new URL('access-probe.json', fixtures), 'utf8')));
}

type AccessView = Extract<PuzzleView, { kind: 'access' }>;

/** The open Zugangskontrolle as `playerId` sees it in `state`. */
function accessOf(state: GameState, playerId: string): AccessView {
  const view = viewFor(state, playerId).puzzle;
  if (view?.kind !== 'access') {
    throw new Error(`access probe: ${playerId} sees no open Zugangskontrolle`);
  }
  return view;
}

/** The probe's one station, and where its console b and its list are. */
function probeParts(mission: Mission): { def: PuzzleDef; consoleB: string; list: string } {
  const [def] = mission.puzzles;
  const [list] = mission.map.manuals;
  if (def === undefined || def.type !== 'access' || list === undefined) {
    throw new Error('access probe: the mission has no Zugangskontrolle, or no list');
  }
  return { def, consoleB: stationKey({ puzzleId: def.id, console: 'b' }), list: list.id };
}

/**
 * The probe up to the solver's first move: started on `seed`, p2 switching the station on at
 * console b, p1 at the list — the view it reads there — then at console a.
 */
function manned(seed: number): { state: GameState; read: AccessView } {
  const mission = accessProbe();
  const { def, consoleB, list } = probeParts(mission);
  const begun = standing(lightsOut(started(mission, seed)), { stations: { [consoleB]: ['p2'] } });
  const on = applyAction(begun, { type: 'interact', playerId: 'p2', at: T0 + 500 });
  const reading = standing(on, { stations: { [consoleB]: ['p2'] }, manuals: { [list]: ['p1'] } });
  const read = accessOf(reading, 'p1');
  const state = standing(reading, { stations: { [def.id]: ['p1'], [consoleB]: ['p2'] } });
  return { state, read };
}

/** `state` at `at`, its open station ticked as the room ticks it where its clock is due. */
function ticked(state: GameState, at: number): GameState {
  const due = puzzleDueAt(state);
  return due !== null && due <= at ? applyAction(state, { type: 'puzzle-tick', at }) : state;
}

/** A login among `moves`, for the first door the terminal has not released; null for none. */
function loginIn(moves: readonly Move<PuzzleInput>[], terminal: AccessView['terminal']) {
  const door = terminal?.doors.find((row) => !row.released)?.door;
  const login = moves.find((move) => 'cmd' in move.input && move.input.cmd === 'login');
  const account = login !== undefined && 'account' in login.input ? login.input.account : null;
  return door === undefined || account === null ? null : { door, account };
}

/**
 * One second of the crew at the probe at `at`: the solver's moves on the terminal's view, the
 * token device's and the list `read`, each through the reducer; and the login among them.
 */
function round(def: PuzzleDef, state: GameState, read: AccessView, at: number) {
  const views = { operator: accessOf(state, 'p1'), partner: accessOf(state, 'p2'), reader: read };
  const moves = moduleFor(def.type).solve(def, views, null);
  const next = moves.reduce(
    (now, move) =>
      applyAction(now, {
        type: 'puzzle-input',
        playerId: move.by === 'partner' ? 'p2' : 'p1',
        at,
        input: move.input,
      }),
    state,
  );
  return { state: next, login: loginIn(moves, views.operator.terminal) };
}

/**
 * The probe on `seed` played to the solve: each round a second on the clock, the station
 * ticked as the room ticks it once it is due, the solver given the terminal's view, the token
 * device's and the list p1 read. Returns the run and the plan it makes.
 */
export function playAccessProbe(seed = ACCESS_SEED): { state: GameState; plan: AccessPlan } {
  const mission = accessProbe();
  const { def } = probeParts(mission);
  const start = manned(seed);
  const plan: AccessPlan = {
    mission: mission.id,
    seed,
    doors: accessOf(start.state, 'p1').terminal?.doors.map((row) => row.door) ?? [],
    roster: start.read.roster ?? [],
    logins: [],
  };
  let state = start.state;
  for (let second = 1; state.currentPuzzleIndex === 0 && second < 600; second++) {
    const at = T0 + 1000 + second * 1000;
    const played = round(def, ticked(state, at), start.read, at);
    state = played.state;
    plan.logins.push(...(played.login === null ? [] : [played.login]));
  }
  return { state, plan };
}

/** The plan the harness carries: what the probe deals on its pinned seed, whom the solver logs in. */
export function accessPlan(): AccessPlan {
  return playAccessProbe().plan;
}
