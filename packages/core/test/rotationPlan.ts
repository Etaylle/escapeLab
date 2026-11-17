import { readFileSync } from 'node:fs';
import { drawPools, parseMission, stationsOfRun } from '../src/index.js';
import type { GameState, Mission } from '../src/index.js';
import { playStation, type HallStation } from './hallPlan.js';
import { standing, started } from './lab.js';

/**
 * The Wechselplatz's scratch mission (tools/fixtures/rotation-probe.json, „Wechselprobe") on the
 * seeds the walkthrough pins its rooms to, played through the reducer the way tools/shots.mjs
 * plays it in two browsers. Node cannot load core's TypeScript, so
 * tools/fixtures/rotation-plan.json holds what the seeds draw and the moves that win the played
 * one; rotation.test.ts keeps it the draw's and the solvers' own, and writeRotation.ts writes it
 * anew.
 */

const fixtures = new URL('../../../tools/fixtures/', import.meta.url);

/** The probe as the game takes it. */
export function rotationProbe(): Mission {
  const file = readFileSync(new URL('rotation-probe.json', fixtures), 'utf8');
  return parseMission(JSON.parse(file));
}

/** The pool of the probe's middle place. */
export const PROBE_POOL = 'wechselplatz';

/** The first seed from `from` on whose run of `mission` has `puzzleId` at its Wechselplatz. */
export function seedDrawing(mission: Mission, puzzleId: string, from = 1): number {
  for (let seed = from; seed < from + 1000; seed++) {
    if (Object.values(drawPools(mission.puzzles, seed)).includes(puzzleId)) {
      return seed;
    }
  }
  throw new Error(`no seed from ${from} on draws "${puzzleId}"`);
}

/**
 * The seeds the walkthrough plays: `played` to the won card — the first that puts the Funkfeuer
 * in service, a station of one console the host works alone — and `other`, the first that puts
 * a station of two consoles there, the Signalkette, so that the two rooms show different
 * stations dark.
 */
export function probeSeeds(): { played: number; other: number } {
  const mission = rotationProbe();
  return {
    played: seedDrawing(mission, 'funkfeuer'),
    other: seedDrawing(mission, 'signalkette'),
  };
}

/** A room of the walkthrough: its seed, the station it draws and the ones out of service. */
export interface ProbeRun {
  seed: number;
  drawn: string;
  outOfService: string[];
}

export interface RotationPlan {
  mission: string;
  pool: string;
  /** the room played to the won card: its draw, and every station of the run with its moves */
  played: ProbeRun & { stations: HallStation[] };
  /** the room that draws another station: started, looked at and left */
  other: ProbeRun;
}

const CREW = ['p1', 'p2'];

/** The probe on `seed` through the reducer, both past the sign, every station by its solver. */
export function playProbe(seed: number): { state: GameState; stations: HallStation[] } {
  let state = standing(started(rotationProbe(), seed), { signSeen: CREW });
  const stations: HallStation[] = [];
  let round = 1;
  while (state.phase === 'playing' && state.currentPuzzleIndex < stationsOfRun(state)) {
    const def = state.mission.puzzles[state.currentPuzzleIndex];
    if (def === undefined) {
      throw new Error(`rotation plan: no station ${state.currentPuzzleIndex} on seed ${seed}`);
    }
    const played = playStation(state, def, round);
    ({ state, round } = played);
    stations.push(played.station);
  }
  return { state, stations };
}

/** What a run of the probe on `seed` draws. */
function runOf(seed: number): ProbeRun {
  const mission = rotationProbe();
  const drawn = drawPools(mission.puzzles, seed)[PROBE_POOL] ?? '';
  const members = mission.puzzles.filter((p) => p.pool === PROBE_POOL).map((p) => p.id);
  return { seed, drawn, outOfService: members.filter((id) => id !== drawn) };
}

/** The plan the walkthrough plays, from the probe, the draw and the solvers. */
export function rotationPlan(): RotationPlan {
  const seeds = probeSeeds();
  return {
    mission: rotationProbe().id,
    pool: PROBE_POOL,
    played: { ...runOf(seeds.played), stations: playProbe(seeds.played).stations },
    other: runOf(seeds.other),
  };
}
