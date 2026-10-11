import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  initialState,
  moduleFor,
  MODULES,
  parseMission,
  viewFor,
} from '../src/index.js';
import type { Action, GameState, Mission, PlayerView, PuzzleView } from '../src/index.js';
import { playInstance } from './solveModule.js';

const SEEDS = 200;
const T0 = 1_000_000;

const missionsDir = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(missionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMission(JSON.parse(readFileSync(new URL(f, missionsDir), 'utf8'))));

const cases = missions.flatMap((mission) => {
  const roleIds = mission.roles.map((r) => r.id);
  return mission.puzzles.map(
    (def) => [`${mission.id}/${def.id} (${def.type})`, def, roleIds] as const,
  );
});

describe.each(cases)('%s', (_label, def, roleIds) => {
  it(`is solved from the role views alone, without an alarm, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      expect(playInstance(def, roleIds, seed)).toBeGreaterThan(0);
    }
  });

  it('prints the same manual for every run', () => {
    const puzzleModule = moduleFor(def.type);
    const manual = puzzleModule.manual(def);
    expect(manual.length).toBeGreaterThan(0);
    expect(manual.every((section) => section.blocks.length > 0)).toBe(true);
    expect(puzzleModule.manual(structuredClone(def))).toEqual(manual);
  });
});

describe('the registry', () => {
  it('knows every module once, and every shipped puzzle type has a module', () => {
    const types = MODULES.map((m) => m.type);
    expect(new Set(types).size).toBe(types.length);
    for (const [, def] of cases) {
      expect(moduleFor(def.type).type).toBe(def.type);
    }
  });
});

/** The full crew of a mission, each player in the role of the same index. */
function crewOf(mission: Mission): { playerId: string; roleId: string }[] {
  return mission.roles.map((role, i) => ({ playerId: `p${i}`, roleId: role.id }));
}

function started(mission: Mission, seed: number): GameState {
  const crew = crewOf(mission);
  const actions: Action[] = [
    ...crew.map(({ playerId }): Action => ({ type: 'player-join', playerId, name: playerId })),
    ...crew.map(({ playerId, roleId }): Action => ({ type: 'select-role', playerId, roleId })),
    ...crew
      .slice(1)
      .map(({ playerId }): Action => ({ type: 'set-ready', playerId, ready: true })),
    { type: 'start-mission', playerId: 'p0', at: T0, seed },
  ];
  return actions.reduce(applyAction, initialState(mission));
}

/** What each client would hold: its view as it arrives over the wire. */
function wireView(state: GameState, playerId: string): PlayerView {
  return JSON.parse(JSON.stringify(viewFor(state, playerId))) as PlayerView;
}

/**
 * A whole mission through the reducer: every client's view goes to the
 * solver, every move goes back as a puzzle-input from the player in that role.
 */
function playMission(mission: Mission, seed: number): GameState {
  const crew = crewOf(mission);
  let state = started(mission, seed);
  for (let round = 1; state.phase === 'playing' && round < 1000; round++) {
    const def = state.mission.puzzles[state.currentPuzzleIndex];
    if (def === undefined) {
      throw new Error(`${mission.id}: playing without an open puzzle`);
    }
    const seen = crew.map(({ playerId, roleId }) => ({ roleId, view: wireView(state, playerId) }));
    const views: Record<string, PuzzleView> = {};
    for (const { roleId, view } of seen) {
      if (view.puzzle !== null) {
        views[roleId] = view.puzzle;
      }
    }
    const edgework = seen.map(({ view }) => view.edgework).find((e) => e !== null) ?? null;
    for (const { roleId, input } of moduleFor(def.type).solve(def, views, edgework)) {
      const playerId = crew.find((member) => member.roleId === roleId)?.playerId ?? '';
      const at = T0 + round * 1000;
      state = applyAction(state, { type: 'puzzle-input', playerId, at, input });
    }
  }
  return state;
}

describe.each(missions.map((m) => [m.id, m] as const))('mission %s', (_id, withMap) => {
  // Without the map the puzzles chain directly, which is all this is about.
  const mission = parseMission({ ...JSON.parse(JSON.stringify(withMap)), map: undefined });

  it(`is won through the reducer without an alarm for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = playMission(mission, seed);
      expect(state.phase, `seed ${seed}`).toBe('won');
      expect(state.penaltySeq, `seed ${seed}`).toBe(0);
    }
  });

  it('shows each puzzle\'s manual to its manual role and to nobody else', () => {
    const state = started(mission, 1);
    const def = state.mission.puzzles[0];
    const manualRole = def !== undefined && 'manualRoleId' in def ? def.manualRoleId : null;
    for (const { playerId, roleId } of crewOf(mission)) {
      const manual = viewFor(state, playerId).puzzle?.manual ?? null;
      if (roleId === manualRole && def !== undefined) {
        expect(manual).toEqual(moduleFor(def.type).manual(def));
      } else {
        expect(manual).toBeNull();
      }
    }
  });
});
