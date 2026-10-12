import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  initialState,
  moduleFor,
  MODULES,
  parseMission,
  puzzleDefSchema,
  viewFor,
} from '../src/index.js';
import type {
  Action,
  Edgework,
  GameState,
  Mission,
  PlayerView,
  PuzzleInput,
  PuzzleView,
  SolveAid,
} from '../src/index.js';
import { MAX_IDLE_SEC, playInstance } from './solveModule.js';

const SEEDS = 200;
/** Instance runs of each module no mission file uses yet. */
const UNSHIPPED_SEEDS = 100;
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

/** Modules no mission file uses yet, on a crew of two, and the move counts their runs take. */
const unshipped = [
  { type: 'memory', id: 'speicherbank', moves: [5] },
  { type: 'button', id: 'knopf', moves: [1, 2] },
].map(({ type, id, moves }) => {
  const def = puzzleDefSchema.parse({
    type,
    id,
    title: id,
    prompt: '',
    operatorRoleId: 'pult',
    manualRoleId: 'handbuch',
  });
  return [type, def, moves] as const;
});

describe.each(unshipped)('%s, which no mission uses yet', (_type, def, moves) => {
  it(`is solved through the harness without an alarm, for ${UNSHIPPED_SEEDS} seeds`, () => {
    const taken = new Set<number>();
    for (let seed = 0; seed < UNSHIPPED_SEEDS; seed++) {
      taken.add(playInstance(def, ['pult', 'handbuch'], seed));
    }
    expect([...taken].sort()).toEqual(moves);
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

type Transcript = SolveAid<PuzzleInput, PuzzleView>['transcript'];

/** What each client would hold: its view as it arrives over the wire. */
function wireView(state: GameState, playerId: string): PlayerView {
  return JSON.parse(JSON.stringify(viewFor(state, playerId))) as PlayerView;
}

/**
 * What the clients hold of the open puzzle at `at`: every role's view of it,
 * the edgework if a role sees it and the seconds left on their clock.
 */
function crewSees(
  state: GameState,
  crew: { playerId: string; roleId: string }[],
  at: number,
): { views: Record<string, PuzzleView>; edgework: Edgework | null; remainingSec: number | null } {
  const seen = crew.map(({ playerId, roleId }) => ({ roleId, view: wireView(state, playerId) }));
  const views: Record<string, PuzzleView> = {};
  for (const { roleId, view } of seen) {
    if (view.puzzle !== null) {
      views[roleId] = view.puzzle;
    }
  }
  const edgework = seen.map(({ view }) => view.edgework).find((e) => e !== null) ?? null;
  const deadlineAt = seen[0]?.view.deadlineAt ?? null;
  const remainingSec = deadlineAt === null ? null : Math.ceil((deadlineAt - at) / 1000);
  return { views, edgework, remainingSec };
}

/**
 * A whole mission through the reducer: every client's view goes to the
 * solver, with the crew's transcript of the puzzle and the clock, and every
 * move goes back as a puzzle-input from the player in that role. Each round
 * is a second on the clock; a solver that waits only lets it run, up to
 * MAX_IDLE_SEC rounds in a row.
 */
function playMission(mission: Mission, seed: number): GameState {
  const crew = crewOf(mission);
  const transcripts = mission.puzzles.map((): Transcript => []);
  let state = started(mission, seed);
  let idle = 0;
  for (let round = 1; state.phase === 'playing' && round < 1000; round++) {
    const def = state.mission.puzzles[state.currentPuzzleIndex];
    const transcript = transcripts[state.currentPuzzleIndex];
    if (def === undefined || transcript === undefined) {
      throw new Error(`${mission.id}: playing without an open puzzle`);
    }
    const at = T0 + round * 1000;
    const { views, edgework, remainingSec } = crewSees(state, crew, at);
    const moves = moduleFor(def.type).solve(def, views, edgework, { transcript, remainingSec });
    idle = moves.length === 0 ? idle + 1 : 0;
    if (idle > MAX_IDLE_SEC) {
      const where = `${mission.id}/${def.id} (seed ${seed})`;
      throw new Error(`${where}: the solver found no move in ${MAX_IDLE_SEC} s`);
    }
    for (const { roleId, input } of moves) {
      transcript.push({ roleId, input, before: views });
      const playerId = crew.find((member) => member.roleId === roleId)?.playerId ?? '';
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
