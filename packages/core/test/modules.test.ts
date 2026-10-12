import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
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
  Move,
  Perspectives,
  PlayerView,
  PuzzleDef,
  PuzzleInput,
  PuzzleView,
  SolveAid,
} from '../src/index.js';
import { started, standing, T0 } from './lab.js';
import { MAX_IDLE_SEC, playInstance } from './solveModule.js';

const SEEDS = 200;
/** Instance runs of the modules checked on their own, beyond the missions. */
const OWN_SEEDS = 100;

const missionsDir = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(missionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMission(JSON.parse(readFileSync(new URL(f, missionsDir), 'utf8'))));

const cases = missions.flatMap((mission) =>
  mission.puzzles.map((def) => [`${mission.id}/${def.id} (${def.type})`, def] as const),
);

describe.each(cases)('%s', (_label, def) => {
  it(`is solved from the station's and the book's view, alarm-free, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      expect(playInstance(def, seed)).toBeGreaterThan(0);
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

/** Two modules on their own, and the move counts their runs take. */
const own = [
  { type: 'memory', id: 'speicherbank', moves: [5] },
  { type: 'button', id: 'knopf', moves: [1, 2] },
].map(({ type, id, moves }) => {
  const def = puzzleDefSchema.parse({ type, id, title: id });
  return [type, def, moves] as const;
});

describe.each(own)('%s on its own', (_type, def, moves) => {
  it(`is solved through the harness without an alarm, for ${OWN_SEEDS} seeds`, () => {
    const taken = new Set<number>();
    for (let seed = 0; seed < OWN_SEEDS; seed++) {
      taken.add(playInstance(def, seed));
    }
    expect([...taken].sort()).toEqual(moves);
  });
});

describe('the registry', () => {
  it('knows every module once, and every shipped puzzle type has a station module', () => {
    const types = MODULES.map((m) => m.type);
    expect(new Set(types).size).toBe(types.length);
    for (const [, def] of cases) {
      expect(moduleFor(def.type).type).toBe(def.type);
    }
  });

  it('never hands out the relay as a station module', () => {
    expect(() => moduleFor('relay')).toThrow(/not a station module/);
  });
});

type Transcript = SolveAid<PuzzleInput, PuzzleView>['transcript'];

/** What a client holds: its view as it arrives over the wire. */
function wireView(state: GameState, playerId: string): PlayerView {
  return JSON.parse(JSON.stringify(viewFor(state, playerId))) as PlayerView;
}

/** The operator works every station, the reader reads every book; nobody else does anything. */
const OPERATOR = 'p1';
const READER = 'p2';

/**
 * Switch on the current station, the way the crew walks up to it: whatever
 * it waits for is carried in, then the operator stands at it and the reader
 * at a manual object covering it — or the whole crew at it, where everyone
 * presses.
 */
function openStation(state: GameState, def: PuzzleDef, at: number): GameState {
  const map = state.mission.map;
  const crew = state.players.map((p) => p.id);
  const errands = map.items
    .filter((item) => item.requiredFor === def.id)
    .flatMap((item): Action[] => [
      { type: 'pick-item', playerId: OPERATOR, itemId: item.id, at },
      { type: 'deliver-item', playerId: OPERATOR, itemId: item.id, at },
    ]);
  const delivered = errands.reduce(applyAction, state);
  const book = map.manuals.find((m) => m.puzzleIds.includes(def.id));
  const here = moduleFor(def.type).wholeCrew
    ? standing(delivered, { stations: { [def.id]: crew } })
    : standing(delivered, {
        stations: { [def.id]: [OPERATOR] },
        manuals: book === undefined ? {} : { [book.id]: [READER] },
      });
  return applyAction(here, { type: 'interact', playerId: OPERATOR, at });
}

/**
 * What the two clients hold of the open puzzle at `at`: the operator's and
 * the reader's view of it, the edgework if one of them has read the sign,
 * and the seconds left on their clock.
 */
function crewSees(
  state: GameState,
  at: number,
): { views: Perspectives<PuzzleView>; edgework: Edgework | null; remainingSec: number | null } {
  const operator = wireView(state, OPERATOR);
  const reader = wireView(state, READER);
  if (operator.puzzle === null || reader.puzzle === null) {
    throw new Error(`${state.mission.id}: the clients have no open puzzle`);
  }
  const deadlineAt = operator.deadlineAt;
  return {
    views: { operator: operator.puzzle, reader: reader.puzzle },
    edgework: operator.edgework ?? reader.edgework,
    remainingSec: deadlineAt === null ? null : Math.ceil((deadlineAt - at) / 1000),
  };
}

/** Every move as the puzzle-inputs it takes: from the operator, or from every player. */
function inputsFor(moves: Move<PuzzleInput>[], crew: string[], at: number): Action[] {
  return moves.flatMap((move) =>
    (move.by === 'everyone' ? crew : [OPERATOR]).map(
      (playerId): Action => ({ type: 'puzzle-input', playerId, at, input: move.input }),
    ),
  );
}

/**
 * A whole mission through the reducer: the crew walks past the sign, then
 * at every station the operator's and the reader's views go to the solver,
 * with the crew's transcript of the puzzle and the clock, and every move
 * goes back as puzzle-inputs. Each round is a second on the clock; a solver
 * that waits only lets it run, up to MAX_IDLE_SEC rounds in a row. Stops
 * once the last station is solved; getting out is the server's call.
 */
function playMission(mission: Mission, seed: number): GameState {
  const transcripts = mission.puzzles.map((): Transcript => []);
  let state = started(mission, seed);
  const crew = state.players.map((p) => p.id);
  state = standing(state, { signSeen: crew });
  let idle = 0;
  for (let round = 1; state.phase === 'playing' && round < 1000; round++) {
    const def = state.mission.puzzles[state.currentPuzzleIndex];
    const transcript = transcripts[state.currentPuzzleIndex];
    if (def === undefined || transcript === undefined) {
      break;
    }
    const at = T0 + round * 1000;
    if (state.puzzleState === null) {
      state = openStation(state, def, at);
    }
    const { views, edgework, remainingSec } = crewSees(state, at);
    const moves = moduleFor(def.type).solve(def, views, edgework, { transcript, remainingSec });
    idle = moves.length === 0 ? idle + 1 : 0;
    if (idle > MAX_IDLE_SEC) {
      throw new Error(`${mission.id}/${def.id} (seed ${seed}): no move in ${MAX_IDLE_SEC} s`);
    }
    transcript.push(...moves.map((move) => ({ ...move, before: views })));
    state = inputsFor(moves, crew, at).reduce(applyAction, state);
  }
  return state;
}

describe.each(missions.map((m) => [m.id, m] as const))('mission %s', (_id, mission) => {
  it(`is won through the reducer without an alarm for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = playMission(mission, seed);
      // The last station unlocks the hatch; getting out is the server's call.
      expect(state.currentPuzzleIndex, `seed ${seed}`).toBe(mission.puzzles.length);
      expect(state.penaltySeq, `seed ${seed}`).toBe(0);
    }
  });

  it('shows the first station\'s rules to its reader and to nobody else', () => {
    const def = mission.puzzles[0];
    if (def === undefined) {
      throw new Error(`${mission.id} has no puzzles`);
    }
    const state = openStation(started(mission, 1), def, T0 + 1000);
    for (const { id } of state.players) {
      const manual = viewFor(state, id).puzzle?.manual ?? null;
      const reads = id === READER && !moduleFor(def.type).wholeCrew;
      expect(manual, id).toEqual(reads ? moduleFor(def.type).manual(def) : null);
    }
  });
});
