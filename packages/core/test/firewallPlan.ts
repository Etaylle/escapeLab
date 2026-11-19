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
  FirewallHeader,
  GameState,
  Mission,
  Move,
  PuzzleDef,
  PuzzleInput,
  PuzzleView,
} from '../src/index.js';
import { dealWave } from '../src/puzzles/firewall.js';
import { lightsOut, standing, started, T0 } from './lab.js';

/**
 * The Paketfilter's scratch mission (tools/fixtures/firewall-probe.json, „Filterprobe") on the
 * seed the harness pins its room to, played through the reducer as tools/shots.mjs plays it in
 * two browsers: both walk past the Laborkennung, Anna (p1) switches the station on at the
 * Sperrpult, Ben (p2) reads the Sicherheitsrichtlinie in its binder and takes the Analysepult,
 * and the waves run. Node cannot load core's TypeScript, so tools/fixtures/firewall-plan.json
 * carries what this run may deal — every wave's packets as the Analysepult shows them and which
 * of them the policy drops, the probe's own waves and those a fault would call in — and the
 * solver's moves in their order; firewall.test.ts keeps it the solver's own and proves it
 * solves the station through the reducer without an alarm. The harness plays the moves against
 * its pages, not against the plan's seconds: a mark once its packet is on the Analysepult, a
 * trip once the lowest packet on the line wears a ring.
 */

export const FIREWALL_SEED = 4;

/** A packet of the plan as the Analysepult shows it, and whether the policy drops it. */
export interface FirewallPlanPacket {
  id: string;
  line: number;
  header: FirewallHeader;
  hostile: boolean;
}

/** Waves the plan deals beyond the probe's own: as many faults as a drill may survive. */
export const SPARE_WAVES = 3;

/** What the probe deals on its pinned seed, and the solver's moves on it. */
export interface FirewallPlan {
  mission: string;
  seed: number;
  /** the Laborkennung the crew reads at the sign */
  serial: string;
  /**
   * every wave the run may deal — the probe's own and SPARE_WAVES more, which a fault calls in —
   * with its packets in the order they come onto the lines
   */
  waves: FirewallPlanPacket[][];
  /** the solver's moves, oldest first */
  moves: Move<PuzzleInput>[];
}

const fixtures = new URL('../../../tools/fixtures/', import.meta.url);

/** The probe mission as the harness imports it. */
export function firewallProbe(): Mission {
  return parseMission(JSON.parse(readFileSync(new URL('firewall-probe.json', fixtures), 'utf8')));
}

type FirewallView = Extract<PuzzleView, { kind: 'firewall' }>;

/** The open Paketfilter as `playerId` sees it in `state`. */
function firewallOf(state: GameState, playerId: string): FirewallView {
  const view = viewFor(state, playerId).puzzle;
  if (view?.kind !== 'firewall') {
    throw new Error(`firewall probe: ${playerId} sees no open Paketfilter`);
  }
  return view;
}

/** The probe's one station, where its console b and its binder are. */
function probeParts(mission: Mission): { def: PuzzleDef; consoleB: string; binder: string } {
  const [def] = mission.puzzles;
  const [binder] = mission.map.manuals;
  if (def === undefined || def.type !== 'firewall' || binder === undefined) {
    throw new Error('firewall probe: the mission has no Paketfilter, or no binder');
  }
  return { def, consoleB: stationKey({ puzzleId: def.id, console: 'b' }), binder: binder.id };
}

/**
 * The probe up to the first wave: started on `seed`, both past the sign, p1 switching the
 * station on at console a, p2 at the binder — then at console b, which starts the wave.
 */
function manned(seed: number): GameState {
  const mission = firewallProbe();
  const { def, consoleB, binder } = probeParts(mission);
  const signed = standing(lightsOut(started(mission, seed)), { signSeen: ['p1', 'p2'] });
  const atA = standing(signed, { stations: { [def.id]: ['p1'] }, signSeen: ['p1', 'p2'] });
  const on = applyAction(atA, { type: 'interact', playerId: 'p1', at: T0 + 500 });
  const reading = standing(on, {
    stations: { [def.id]: ['p1'] },
    manuals: { [binder]: ['p2'] },
    signSeen: ['p1', 'p2'],
    at: T0 + 600,
  });
  return standing(reading, {
    stations: { [def.id]: ['p1'], [consoleB]: ['p2'] },
    signSeen: ['p1', 'p2'],
    at: T0 + 1000,
  });
}

/** `state` at `at`, its open station ticked as the room ticks it where its clock is due. */
function ticked(state: GameState, at: number): GameState {
  const due = puzzleDueAt(state);
  return due !== null && due <= at ? applyAction(state, { type: 'puzzle-tick', at }) : state;
}

/**
 * Every wave the run on `state` may deal, as the module deals it: the def's own and SPARE_WAVES
 * more, a fault calling the next one in.
 */
export function wavesOf(def: PuzzleDef, state: GameState): FirewallPlanPacket[][] {
  const station = state.puzzleState;
  if (def.type !== 'firewall' || station?.type !== 'firewall') {
    throw new Error(`firewall plan: no Paketfilter armed at "${def.id}" to deal its waves`);
  }
  return Array.from({ length: def.waves + SPARE_WAVES }, (_, wave) =>
    dealWave(def, station, wave).map(({ id, line, header, hostile }) => ({
      id,
      line,
      header: { ...header },
      hostile,
    })),
  );
}

/**
 * The probe on `seed` played to the solve: each round a second on the clock, ticked as the room
 * ticks the station once due, the solver given both consoles' views and the moment. Returns the
 * run and the plan it makes.
 */
export function playFirewallProbe(seed = FIREWALL_SEED): { state: GameState; plan: FirewallPlan } {
  const mission = firewallProbe();
  const { def } = probeParts(mission);
  let state = manned(seed);
  const plan: FirewallPlan = {
    mission: mission.id,
    seed,
    serial: state.edgework?.serial ?? '',
    waves: wavesOf(def, state),
    moves: [],
  };
  for (let second = 1; state.currentPuzzleIndex === 0 && second < 600; second++) {
    const at = T0 + 1000 + second * 1000;
    state = ticked(state, at);
    if (state.currentPuzzleIndex !== 0) {
      break;
    }
    const views = { operator: firewallOf(state, 'p1'), partner: firewallOf(state, 'p2') };
    const moves = moduleFor(def.type).solve(
      def,
      { ...views, reader: views.partner },
      state.edgework,
      { transcript: [], remainingSec: null, at },
    );
    plan.moves.push(...moves);
    state = moves.reduce(
      (now, move) =>
        applyAction(now, {
          type: 'puzzle-input',
          playerId: move.by === 'partner' ? 'p2' : 'p1',
          at,
          input: move.input,
        }),
      state,
    );
  }
  return { state, plan };
}

/** The plan the harness carries: what the probe deals on its pinned seed, the solver's moves. */
export function firewallPlan(): FirewallPlan {
  return playFirewallProbe().plan;
}
