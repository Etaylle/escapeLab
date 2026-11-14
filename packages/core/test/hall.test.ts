import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, checkMission, moduleFor, viewFor } from '../src/index.js';
import type { Action, GameState, Move, PuzzleInput } from '../src/index.js';
import { hallMission, machineOf, stationTypes } from './hall.js';
import { crewAt, hall, HALL_SEED, hallPlan, walkOrder } from './hallPlan.js';
import type { HallPlan, HallStation } from './hallPlan.js';
import { standing, started, T0 } from './lab.js';

type Spot = { x: number; y: number };

/**
 * The Übungshalle is made from the module registry (hall.ts) and committed as
 * missions/uebungshalle.json, its walkthrough's plan as tools/fixtures/hall-plan.json: both
 * stay what the registry and the solvers make — writeHall.ts writes them anew — so a module
 * added to the registry fails here until the hall has its bay.
 */

const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const committed = read('../../../missions/uebungshalle.json');
const fixture = read('../../../tools/fixtures/hall-plan.json') as HallPlan;

describe('the Übungshalle', () => {
  it('is the file the module registry makes (writeHall.ts writes it anew)', () => {
    expect(committed).toEqual(hallMission());
  });

  it('validates as a mission', () => {
    const checked = checkMission(committed);
    expect(checked.ok ? [] : checked.issues).toEqual([]);
  });

  it('has a station of every type that stands at one, each worked as its module is', () => {
    const mission = hall();
    expect(mission.puzzles.map((p) => p.type)).toEqual(stationTypes());
    expect(stationTypes()).not.toContain('relay');
    for (const def of mission.puzzles) {
      const consoles = mission.map.stations.filter((s) => s.puzzleId === def.id);
      expect(consoles, def.id).toHaveLength(moduleFor(def.type).consoles ?? 1);
    }
  });

  it('keeps every station’s rules in a book of its own beside it, under a sign naming it', () => {
    const mission = hall();
    for (const def of mission.puzzles) {
      const books = mission.map.manuals.filter((m) => m.puzzleIds.includes(def.id));
      expect(books.map((m) => m.puzzleIds), def.id).toEqual([[def.id]]);
      const [first] = mission.map.stations.filter((s) => s.puzzleId === def.id);
      const [book] = books.flatMap((m) => m.spots);
      expect(apart(book, first), def.id).toBeLessThan(6);
      const { name, type } = machineOf(def.type);
      expect(mission.map.labels.map((l) => l.text)).toContain(`${name.toUpperCase()} · ${type}`);
    }
  });

  it('runs in any order, without a clock, a drone, an emergency or a hatch, its lights on', () => {
    const mission = hall();
    expect(mission).toMatchObject({ order: 'free', timeLimitSec: 0, lit: true, maxAlarms: null });
    expect(mission.intro).toBeUndefined();
    expect(mission.map.drones).toEqual([]);
    expect(mission.map.sabotage).toBeUndefined();
    expect(mission.map.exit).toBeUndefined();
    expect(mission.players).toEqual({ min: 2, max: 3 });
    const running = started(mission);
    expect(viewFor(running, 'p1').map?.litRooms).toEqual(mission.map.labels.map((l) => l.text));
  });

  it('starts the crew at the entrance: the notice board and the sign beside it', () => {
    const { map } = hall();
    const [board] = map.notes;
    expect(board?.text).toBe('Übungshalle · Jede Station steht offen; die Regeln liegen daneben');
    for (const spot of [board, map.edgeworkSign]) {
      expect(map.spawns.some((s) => apart(s, spot) < 4), JSON.stringify(spot)).toBe(true);
    }
  });
});

/** How far apart two places stand, tiles; out of reach where either is missing. */
function apart(a: Spot | undefined, b: Spot | undefined): number {
  return a === undefined || b === undefined ? Infinity : Math.hypot(a.x - b.x, a.y - b.y);
}

/** Every move as the puzzle-inputs it takes: the host's, the guest's, or both. */
function inputs(moves: Move<PuzzleInput>[], at: number): Action[] {
  return moves.flatMap((move) => {
    const by = move.by === 'everyone' ? ['p1', 'p2'] : move.by === 'partner' ? ['p2'] : ['p1'];
    return by.map(
      (playerId): Action => ({ type: 'puzzle-input', playerId, at, input: move.input }),
    );
  });
}

/** The clock of a hall as the screens print the seconds it has run: „01:05". */
const clockText = (sec: number): string =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/**
 * The first whole second from `at` on at which the hall's clock, run from `from`, shows
 * `digit`: when a crew holding the button lets it go, as the walkthrough does.
 */
function whenShowing(digit: number, at: number, from: number): number {
  let next = at;
  while (!clockText(Math.floor((next - from) / 1000)).includes(String(digit))) {
    next += 1000;
  }
  return next;
}

/** When the plan's `move` at `station` is made, due at `at`: a release once the clock allows. */
function momentOf(move: Move<PuzzleInput>, station: HallStation, at: number, from: number): number {
  const release = 'kind' in move.input && move.input.kind === 'release';
  return release && station.releaseAt !== null ? whenShowing(station.releaseAt, at, from) : at;
}

/**
 * The plan's `station` worked through the reducer from `at` on, as the walkthrough works it:
 * the crew at its places, p1's E, then every move a second after the one before. Returns the
 * state after it and the time of its last move.
 */
function worked(
  state: GameState,
  station: HallStation,
  at: number,
): { state: GameState; at: number } {
  const def = state.mission.puzzles.find((p) => p.id === station.id);
  if (def === undefined) {
    throw new Error(`the plan names no station of the hall: "${station.id}"`);
  }
  const here = standing(state, crewAt(state.mission, def));
  let next = applyAction(here, { type: 'interact', playerId: 'p1', at });
  let now = at;
  for (const move of station.moves) {
    now = momentOf(move, station, now + 1000, next.clockFrom ?? T0);
    next = inputs([move], now).reduce(applyAction, next);
  }
  return { state: next, at: now };
}

describe('the Übungshalle on the walkthrough’s pinned seed', () => {
  it('carries the solvers’ own walkthrough in tools/fixtures/hall-plan.json', () => {
    // Regenerate the file with writeHall.ts when the hall or one of its modules changes.
    expect(fixture).toEqual(hallPlan());
    expect(fixture).toMatchObject({ mission: 'uebungshalle', seed: HALL_SEED });
    expect(fixture.stations.map((s) => s.id)).toEqual(walkOrder(hall()));
  });

  it('is won through the reducer by the plan’s moves at its last station, without an alarm', () => {
    const mission = hall();
    let state: GameState = standing(started(mission, HALL_SEED), { signSeen: ['p1', 'p2'] });
    let at = T0;
    for (const station of fixture.stations) {
      ({ state, at } = worked(state, station, at + 1000));
    }
    expect(state.penaltySeq).toBe(0);
    expect(state.currentPuzzleIndex).toBe(mission.puzzles.length);
    expect(state.phase).toBe('won');
  });
});
