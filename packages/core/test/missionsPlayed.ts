import { describe, expect, it } from 'vitest';
import {
  applyAction,
  moduleFor,
  operatorsOf,
  placesOf,
  poolsOf,
  puzzleDueAt,
  readersOf,
  stationKey,
  stationsOfRun,
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
import { handsTaken, lightsOut, started, standing, T0 } from './lab.js';
import { MAX_IDLE_SEC } from './solveModule.js';

/**
 * A mission played through the reducer as a crew plays it — every station by its module's
 * solver on the views of whoever stands at its places — and the proofs each mission owes by it
 * (`describeMissionsPlayed`). Blackout's run in a file of their own (blackoutPlayed.test.ts):
 * its stations on the clock make 200 seeds the longest run of the suite.
 */

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

/** What a solver reads off the crew's clock. */
type Clock = Pick<SolveAid<PuzzleInput, PuzzleView>, 'remainingSec' | 'elapsedSec'>;

/**
 * The clock as `client` shows it at `at`: the seconds left on it, or where the mission has none,
 * the seconds it has counted up (`elapsedSec`).
 */
function clockOf(client: PlayerView, at: number): Clock {
  const { deadlineAt, clockFrom } = client;
  return {
    remainingSec: deadlineAt === null ? null : Math.ceil((deadlineAt - at) / 1000),
    ...(clockFrom === undefined ? {} : { elapsedSec: Math.floor((at - clockFrom) / 1000) }),
  };
}

/**
 * What `operator` reads at the book of the open station, standing there alone: its rules — and a
 * Zugangskontrolle's list —; null where no open book covers the station.
 */
function glanceAtBook(state: GameState, operator: string): PlayerView | null {
  const open = state.mission.puzzles[state.currentPuzzleIndex]?.id ?? '';
  const book = state.mission.map.manuals.find((manual) => manual.puzzleIds.includes(open));
  if (book === undefined) {
    return null;
  }
  const glance = wireView(standing(state, { manuals: { [book.id]: [operator] } }), operator);
  return glance.puzzle === null ? null : glance;
}

/**
 * The view the reader holds: the reader's own; with nobody left to read, what the operator read
 * at the station's book before taking console a (`glanceAtBook`) — a crew of two reads a
 * Zugangskontrolle's list so —, and with no book open to read there, the partner's.
 */
function readerSees(state: GameState, roles: Roles, atB: PlayerView | null): PlayerView | null {
  if (roles.reader !== null) {
    return wireView(state, roles.reader);
  }
  return glanceAtBook(state, roles.operator) ?? atB;
}

/**
 * What the clients hold of the open puzzle at `at`: the operator's, the
 * partner's and the reader's view of it (`readerSees`), the edgework if one
 * of them has read the sign, and their clock (`clockOf`).
 */
function crewSees(
  state: GameState,
  roles: Roles,
  at: number,
): { views: Perspectives<PuzzleView>; edgework: Edgework | null; clock: Clock } {
  const openAt = (client: PlayerView): PuzzleView => {
    if (client.puzzle === null) {
      throw new Error(`${state.mission.id}: the clients have no open puzzle`);
    }
    return client.puzzle;
  };
  const { operator, partner } = roles;
  const atA = wireView(state, operator);
  const atB = partner === null ? null : wireView(state, partner);
  const atBook = readerSees(state, roles, atB);
  if (atBook === null) {
    throw new Error(`${state.mission.id}: nobody reads, and nobody works console b`);
  }
  return {
    views: {
      operator: openAt(atA),
      ...(atB === null ? {} : { partner: openAt(atB) }),
      reader: openAt(atBook),
    },
    edgework: atA.edgework ?? atB?.edgework ?? atBook.edgework,
    clock: clockOf(atA, at),
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

/** `state` with `manuals` naming who stands at the manual objects; the rest stands as it stood. */
function atManuals(state: GameState, manuals: GameState['presence']['manuals']): GameState {
  const { stations, notes, plates, signSeen, exit, sight } = state.presence;
  return standing(state, { stations, manuals, notes, plates, signSeen, exit, sight });
}

/**
 * The moves into `state`: at a station of one console, which its operator works by its own,
 * with the reader stepped off the rules while they go in — nobody but the operator anywhere
 * near it —, and back at the rules after.
 */
function movesIn(state: GameState, def: PuzzleDef, moves: Action[]): GameState {
  const { consoles, wholeCrew } = moduleFor(def.type);
  if (wholeCrew || consoles === 2 || moves.length === 0) {
    return moves.reduce(applyAction, state);
  }
  const { manuals } = state.presence;
  const done = moves.reduce(applyAction, atManuals(state, {}));
  return done.phase === 'playing' && done.puzzleState !== null ? atManuals(done, manuals) : done;
}

/** `state` at `at`, its open puzzle ticked as the room ticks it once its clock is due. */
function ticked(state: GameState, at: number): GameState {
  const due = puzzleDueAt(state);
  return due !== null && due <= at ? applyAction(state, { type: 'puzzle-tick', at }) : state;
}

/**
 * Whether the tick that brought the run to this round solved its station, or ended the run: the
 * Paketfilter's last wave is clean on the clock, as its last packet is through.
 */
const solvedOnTheClock = (state: GameState): boolean =>
  state.puzzleState === null || state.phase !== 'playing';

/** The rounds in a row without a move after one that made `moves`; throws past MAX_IDLE_SEC. */
function idleAfter(idle: number, moves: readonly Move<PuzzleInput>[], label: string): number {
  const now = moves.length === 0 ? idle + 1 : 0;
  if (now > MAX_IDLE_SEC) {
    throw new Error(`${label}: no move in ${MAX_IDLE_SEC} s`);
  }
  return now;
}

/**
 * A whole mission through the reducer for a crew of `size`: the crew walks
 * past the sign, then at every station the operator's, the partner's and the
 * reader's views go to the solver, with the crew's transcript of the puzzle
 * and the clock, and every move goes back as puzzle-inputs — at a station of
 * one console with the operator alone at it (`movesIn`). Each round is a
 * second on the clock, the open puzzle ticked as the room ticks it once it is
 * due; a solver that waits only lets it run, up to MAX_IDLE_SEC rounds in a
 * row. Stops once the last station is solved; getting out is the server's
 * call. Returns the state, and how many of the crew each station put to work
 * as it was switched on (`atWork`). A run plays its own stations: one out of service (a pool's
 * member not drawn) stands after them in the run's order and is never come to.
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
    const ofRun = state.currentPuzzleIndex < stationsOfRun(state);
    if (def === undefined || transcript === undefined || !ofRun) {
      break;
    }
    const at = T0 + round * 1000;
    if (state.puzzleState === null) {
      const before = state;
      state = openStation(state, def, at);
      working.push(atWork(before, state, def));
    }
    state = ticked(state, at);
    if (solvedOnTheClock(state)) {
      continue;
    }
    const roles = rolesAt(def, crew);
    const { views, edgework, clock } = crewSees(state, roles, at);
    const moves = moduleFor(def.type).solve(def, views, edgework, { transcript, ...clock, at });
    idle = idleAfter(idle, moves, `${mission.id}/${def.id} (seed ${seed})`);
    transcript.push(...moves.map((move) => ({ ...move, before: views })));
    state = movesIn(state, def, inputsFor(moves, roles, crew, at));
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

/** How many seeds each mission is played on. */
export const SEEDS = 200;
/**
 * After how many seeds a run lets its worker's other work through: the longest runs take some
 * 15 s on a CI runner, and a worker silent that long, test after test, misses vitest's calls
 * („Timeout calling onTaskUpdate", cloud run 44403445183).
 */
const BREATH_EVERY = 10;
const breath = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * The proofs every mission of `missions` owes, for every size of crew it takes, from the
 * smallest to the largest: won through the reducer on SEEDS seeds in every draw, its rules shown
 * to the reader alone, a hand at every place.
 */
export function describeMissionsPlayed(missions: readonly Mission[]): void {
  const played = missions.flatMap((mission) => {
    const { min, max } = mission.players;
    return Array.from({ length: max - min + 1 }, (_, i) => [mission.id, min + i, mission] as const);
  });

  describe.each(played)('mission %s for %i', (_id, size, mission) => {
    const won = `is won through the reducer without an alarm for ${SEEDS} seeds, in every draw`;
    it(won, async () => {
      const drawn = new Set<string>();
      for (let seed = 0; seed < SEEDS; seed++) {
        if (seed % BREATH_EVERY === 0) {
          await breath();
        }
        const { state } = playMission(mission, seed, size);
        // The last station unlocks the hatch; getting out is the server's call.
        expect(state.currentPuzzleIndex, `seed ${seed}`).toBe(stationsOfRun(state));
        expect(state.penaltySeq, `seed ${seed}`).toBe(0);
        Object.values(state.drawn).forEach((id) => drawn.add(id));
      }
      // Every station that takes turns had its runs among the seeds: none is proved by its absence.
      const members = [...poolsOf(mission.puzzles).values()].flat();
      expect([...drawn].sort()).toEqual([...members].sort());
    });

    it('shows the rules of the first station read at a source to its reader, nobody else', () => {
      // The first seed whose run has such a station: with stations that take turns, a crew of
      // two may read at the one drawn only (Blackout's Funkpult), and a run's order is its own —
      // a station out of service stands after the run's and is never read.
      const runs = Array.from({ length: 50 }, (_, i) =>
        lightsOut(started(mission, i + 1, T0, size)),
      );
      const readIn = (run: GameState): number =>
        run.mission.puzzles
          .slice(0, stationsOfRun(run))
          .findIndex((station) => readAt(mission, station, run.players.map((p) => p.id)));
      const start = runs.find((run) => readIn(run) >= 0);
      if (start === undefined) {
        throw new Error(`${mission.id}: nobody of a crew of ${size} reads at any station`);
      }
      const crew = start.players.map((p) => p.id);
      const index = readIn(start);
      const def = start.mission.puzzles[index];
      if (def === undefined) {
        throw new Error(`${mission.id}: no station ${index}`);
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
      const { state, atWork } = playMission(mission, 1, size);
      const ofRun = state.mission.puzzles.slice(0, stationsOfRun(state));
      expect(atWork).toEqual(ofRun.map((def) => Math.min(size, handsTaken(mission, def, size))));
    });
  });
}
