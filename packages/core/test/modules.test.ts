import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  moduleFor,
  MODULES,
  operatorsOf,
  parseMission,
  placesOf,
  puzzleDefSchema,
  puzzleDueAt,
  readersOf,
  stationKey,
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
import { startsClosed, type ManualDef } from '../src/mission.js';
import { handsTaken, labs, lightsOut, started, standing, T0 } from './lab.js';
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

/** Modules on their own, and the move counts their runs take. */
const own = [
  { type: 'memory', id: 'speicherbank', moves: [5] },
  { type: 'button', id: 'knopf', moves: [1, 2] },
  // four stages of four signs
  { type: 'signal', id: 'signalkette', moves: [16] },
  // the same with the legend and the display grey from the first stage: read by the patterns
  { type: 'signal', id: 'signalkette-farblos', fields: { legend: true, greyFrom: 1 }, moves: [16] },
  // two doors, each a login, its token and the release
  { type: 'access', id: 'zugangskontrolle', moves: [6] },
].map(({ type, id, fields = {}, moves }) => {
  const def = puzzleDefSchema.parse({ type, id, title: id, ...fields });
  return [id, def, moves] as const;
});

describe.each(own)('%s on its own', (_id, def, moves) => {
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

/** Who does what at one station; nobody else does anything. */
interface Roles {
  /** works the station, at console a where it has two */
  operator: string;
  /** works console b; null at a station with one console */
  partner: string | null;
  /** reads the rules at a manual object; null when the crew has nobody left for it */
  reader: string | null;
  /**
   * the third of the crew, so that the first two never leave their places: carries the
   * station's parts in, fetches a cabinet's key and opens a shut source, and at a station of
   * one console holds the plates of the doors it keeps open until solved; null for a crew of
   * two, whose operator carries the parts and whose reader opens the source
   */
  runner: string | null;
}

/**
 * p1 works every station, p2 reads every book — except at a station with
 * two consoles, where p2 works console b and p3, if the crew has one, reads.
 * p3 runs the errands wherever the crew has one.
 */
function rolesAt(def: PuzzleDef, crew: string[]): Roles {
  const twoConsoles = moduleFor(def.type).consoles === 2;
  return {
    operator: 'p1',
    partner: twoConsoles ? 'p2' : null,
    reader: (twoConsoles ? crew[2] : crew[1]) ?? null,
    runner: crew[2] ?? null,
  };
}

/** The station's parts carried in: by the runner, or by the operator where the crew has none. */
function partsIn(state: GameState, def: PuzzleDef, roles: Roles, at: number): GameState {
  const carrier = roles.runner ?? roles.operator;
  return state.mission.map.items
    .filter((item) => item.requiredFor === def.id)
    .flatMap((item): Action[] => [
      { type: 'pick-item', playerId: carrier, itemId: item.id, at },
      { type: 'deliver-item', playerId: carrier, itemId: item.id, at },
    ])
    .reduce(applyAction, state);
}

/**
 * The plates of the doors `def`'s station keeps open until solved, by plate id, held by the
 * runner at a station of one console; none anywhere else.
 */
function platesHeld(state: GameState, def: PuzzleDef, roles: Roles): Record<string, string[]> {
  const { runner, partner } = roles;
  if (runner === null || partner !== null || moduleFor(def.type).wholeCrew) {
    return {};
  }
  const plates = placesOf(state.mission, def.id).filter((place) => place.kind === 'plate');
  return Object.fromEntries(plates.map((plate) => [plate.id, [runner]]));
}

/**
 * Switch on the current station, the way the crew walks up to it: whatever
 * it waits for is carried in, the manual object covering it is opened where
 * that is shut — by the runner, else by the reader — then the operator
 * stands at it (and the partner at console b), the reader at that manual
 * object and the runner on the plates it holds — or the whole crew at it,
 * where everyone presses.
 */
function openStation(state: GameState, def: PuzzleDef, at: number): GameState {
  const map = state.mission.map;
  const crew = state.players.map((p) => p.id);
  const roles = rolesAt(def, crew);
  const { operator, partner, reader, runner } = roles;
  const delivered = partsIn(state, def, roles, at);
  const book = map.manuals.find((m) => m.puzzleIds.includes(def.id));
  const readable =
    book === undefined || reader === null
      ? delivered
      : openedBy(delivered, book, runner ?? reader, at);
  const consoleB = stationKey({ puzzleId: def.id, console: 'b' });
  const atB = partner === null ? {} : { [consoleB]: [partner] };
  const here = moduleFor(def.type).wholeCrew
    ? standing(readable, { stations: { [def.id]: crew } })
    : standing(readable, {
        stations: { [def.id]: [operator], ...atB },
        manuals: book === undefined || reader === null ? {} : { [book.id]: [reader] },
        plates: platesHeld(readable, def, roles),
      });
  return applyAction(here, { type: 'interact', playerId: operator, at });
}

/**
 * How many of the crew are at work at the station of `def` once it is switched on (`now`, from
 * `before` it was): at one of its consoles, reading at a manual object covering it, holding a
 * plate, or back from carrying a part in — a cabinet's key included, which counts as delivered.
 */
function atWork(before: GameState, now: GameState, def: PuzzleDef): number {
  const plates = Object.values(now.presence.plates).flat();
  const delivered = (state: GameState, id: string): number => state.credits[id]?.delivered ?? 0;
  const busy = (id: string): boolean =>
    operatorsOf(now, def.id).includes(id) ||
    readersOf(now, def.id).includes(id) ||
    plates.includes(id) ||
    delivered(now, id) > delivered(before, id);
  return now.players.filter((player) => busy(player.id)).length;
}

/** A shut manual object opened by `reader`: a locker searched, a cabinet unlocked with its key. */
function openedBy(state: GameState, source: ManualDef, reader: string, at: number): GameState {
  if (!startsClosed(source.kind) || state.opened.includes(source.id)) {
    return state;
  }
  const key: Action[] =
    source.needsKey === undefined
      ? []
      : [{ type: 'pick-item', playerId: reader, itemId: source.needsKey, at }];
  const open: Action = { type: 'open-source', playerId: reader, manualId: source.id, at };
  const there = standing(state, { manuals: { [source.id]: [reader] } });
  return [...key, open].reduce(applyAction, there);
}

/**
 * What the clients hold of the open puzzle at `at`: the operator's, the
 * partner's and the reader's view of it — with nobody left to read, the
 * partner's stands in — the edgework if one of them has read the sign, and
 * the seconds left on their clock.
 */
function crewSees(
  state: GameState,
  { operator, partner, reader }: Roles,
  at: number,
): { views: Perspectives<PuzzleView>; edgework: Edgework | null; remainingSec: number | null } {
  const openAt = (client: PlayerView): PuzzleView => {
    if (client.puzzle === null) {
      throw new Error(`${state.mission.id}: the clients have no open puzzle`);
    }
    return client.puzzle;
  };
  const atA = wireView(state, operator);
  const atB = partner === null ? null : wireView(state, partner);
  const atBook = reader === null ? atB : wireView(state, reader);
  if (atBook === null) {
    throw new Error(`${state.mission.id}: nobody reads, and nobody works console b`);
  }
  const deadlineAt = atA.deadlineAt;
  return {
    views: {
      operator: openAt(atA),
      ...(atB === null ? {} : { partner: openAt(atB) }),
      reader: openAt(atBook),
    },
    edgework: atA.edgework ?? atB?.edgework ?? atBook.edgework,
    remainingSec: deadlineAt === null ? null : Math.ceil((deadlineAt - at) / 1000),
  };
}

/**
 * Every move as the puzzle-inputs it takes: from the operator, from the
 * partner, or from every player at the station.
 */
function inputsFor(moves: Move<PuzzleInput>[], roles: Roles, crew: string[], at: number): Action[] {
  const { operator, partner } = roles;
  const senders = (by: Move<PuzzleInput>['by']): string[] => {
    if (by === 'everyone') {
      return partner === null ? crew : [operator, partner];
    }
    if (by === 'partner') {
      if (partner === null) {
        throw new Error('a partner move at a station with one console');
      }
      return [partner];
    }
    return [operator];
  };
  return moves.flatMap((move) =>
    senders(move.by).map(
      (playerId): Action => ({ type: 'puzzle-input', playerId, at, input: move.input }),
    ),
  );
}

/** `state` at `at`, its open puzzle ticked as the room ticks it once its clock is due. */
function ticked(state: GameState, at: number): GameState {
  const due = puzzleDueAt(state);
  return due !== null && due <= at ? applyAction(state, { type: 'puzzle-tick', at }) : state;
}

/**
 * A whole mission through the reducer for a crew of `size`: the crew walks
 * past the sign, then at every station the operator's, the partner's and the
 * reader's views go to the solver, with the crew's transcript of the puzzle
 * and the clock, and every move goes back as puzzle-inputs. Each round is a
 * second on the clock, the open puzzle ticked as the room ticks it once it is
 * due; a solver that waits only lets it run, up to MAX_IDLE_SEC rounds in a
 * row. Stops once the last station is solved; getting out is the server's
 * call. Returns the state, and how many of the crew each station put to work
 * as it was switched on (`atWork`).
 */
function playMission(
  mission: Mission,
  seed: number,
  size: number,
): { state: GameState; atWork: number[] } {
  const transcripts = mission.puzzles.map((): Transcript => []);
  const working: number[] = [];
  let state = lightsOut(started(mission, seed, T0, size));
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
      const before = state;
      state = openStation(state, def, at);
      working.push(atWork(before, state, def));
    }
    state = ticked(state, at);
    const roles = rolesAt(def, crew);
    const { views, edgework, remainingSec } = crewSees(state, roles, at);
    const moves = moduleFor(def.type).solve(def, views, edgework, { transcript, remainingSec });
    idle = moves.length === 0 ? idle + 1 : 0;
    if (idle > MAX_IDLE_SEC) {
      throw new Error(`${mission.id}/${def.id} (seed ${seed}): no move in ${MAX_IDLE_SEC} s`);
    }
    transcript.push(...moves.map((move) => ({ ...move, before: views })));
    state = inputsFor(moves, roles, crew, at).reduce(applyAction, state);
  }
  return { state, atWork: working };
}

/**
 * Whether somebody of `crew` reads the rules of `def`'s station at a manual object covering it
 * (`rolesAt`): never where the whole crew presses, nor where the crew has nobody left to read —
 * a crew of two at a station of two consoles.
 */
function readAt(mission: Mission, def: PuzzleDef, crew: string[]): boolean {
  const covered = mission.map.manuals.some((manual) => manual.puzzleIds.includes(def.id));
  return covered && !moduleFor(def.type).wholeCrew && rolesAt(def, crew).reader !== null;
}

/**
 * Every shipped mission and lab (lab.ts `labs`), for every size of crew it takes, from the
 * smallest to the largest.
 */
const played = [...missions, ...labs()].flatMap((mission) => {
  const { min, max } = mission.players;
  return Array.from({ length: max - min + 1 }, (_, i) => [mission.id, min + i, mission] as const);
});

describe.each(played)('mission %s for %i', (_id, size, mission) => {
  it(`is won through the reducer without an alarm for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { state } = playMission(mission, seed, size);
      // The last station unlocks the hatch; getting out is the server's call.
      expect(state.currentPuzzleIndex, `seed ${seed}`).toBe(mission.puzzles.length);
      expect(state.penaltySeq, `seed ${seed}`).toBe(0);
    }
  });

  it('shows the rules of the first station read at a source to its reader and nobody else', () => {
    const start = lightsOut(started(mission, 1, T0, size));
    const crew = start.players.map((p) => p.id);
    const index = mission.puzzles.findIndex((def) => readAt(mission, def, crew));
    const def = mission.puzzles[index];
    if (def === undefined) {
      throw new Error(`${mission.id}: nobody of a crew of ${size} reads at any station`);
    }
    const state = openStation({ ...start, currentPuzzleIndex: index }, def, T0 + 1000);
    const { reader } = rolesAt(def, crew);
    for (const { id } of state.players) {
      const manual = viewFor(state, id).puzzle?.manual ?? null;
      const rules = id === reader ? moduleFor(def.type).manual(def) : null;
      expect(manual, `${def.id} ${id}`).toEqual(rules);
    }
  });

  it('puts a hand at every place of each station, as far as the crew goes', () => {
    const wanted = mission.puzzles.map((def) => Math.min(size, handsTaken(mission, def, size)));
    expect(playMission(mission, 1, size).atWork).toEqual(wanted);
  });
});
