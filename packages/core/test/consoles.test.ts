import { describe, expect, it, vi } from 'vitest';
import {
  applyAction,
  armedStations,
  consoleOf,
  operatorsOf,
  parseMission,
  stationKey,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { signalModule } from '../src/puzzles/signal.js';
import { consoleLab, standing, started, T0 } from './lab.js';

/** Where presence keeps console b of the Signalkette. */
const CONSOLE_B = stationKey({ puzzleId: 'kette', console: 'b' });

/** The console lab for three with its stations replaced, as mission JSON. */
function withStations(stations: object[]): unknown {
  const mission = JSON.parse(JSON.stringify(consoleLab(3)));
  return { ...mission, map: { ...mission.map, stations } };
}

const KABEL = { puzzleId: 'kabel', x: 3, y: 1 };
const AT_A = { puzzleId: 'kette', x: 6, y: 1, console: 'a' };
const AT_B = { puzzleId: 'kette', x: 13, y: 1, console: 'b' };

/** The console lab for three: p1 at console a, p2 at console b, p3 at the book. */
function atTheConsoles(): GameState {
  return standing(started(consoleLab(3)), {
    stations: { kette: ['p1'], [CONSOLE_B]: ['p2'] },
    manuals: { buch: ['p3'] },
  });
}

describe('stations with two consoles in the mission format', () => {
  it('take console a and console b on two different tiles', () => {
    const mission = consoleLab(3);
    expect(mission.map.stations.filter((s) => s.puzzleId === 'kette')).toEqual([AT_A, AT_B]);
    expect(() => parseMission(withStations([AT_A, AT_B, KABEL]))).not.toThrow();
  });

  it('need both consoles, once each', () => {
    const twice =
      'map: puzzle "kette" is worked at two consoles — give it one station with ' +
      'console "a" and one with console "b"';
    const plain = { puzzleId: 'kette', x: 6, y: 1 };
    for (const stations of [
      [plain, KABEL],
      [AT_A, KABEL],
      [AT_A, { ...AT_B, console: 'a' }, KABEL],
      [AT_A, AT_B, { ...AT_B, x: 12 }, KABEL],
    ]) {
      expect(() => parseMission(withStations(stations)), JSON.stringify(stations)).toThrow(twice);
    }
  });

  it('keep the consoles more than 4 tiles apart, so nobody is counted at both', () => {
    const tooClose = (x: number, y: number, apart: string): RegExp =>
      new RegExp(
        `consoles a and b of station "kette" at 6,1 and ${x},${y} stand ${apart} tiles apart ` +
          '— put them more than 4 apart, so nobody is counted at both',
      );
    expect(() => parseMission(withStations([AT_A, { ...AT_B, x: 6 }, KABEL]))).toThrow(
      tooClose(6, 1, '0'),
    );
    expect(() => parseMission(withStations([AT_A, { ...AT_B, x: 10 }, KABEL]))).toThrow(
      tooClose(10, 1, '4'),
    );
    expect(() => parseMission(withStations([AT_A, { ...AT_B, x: 8, y: 2 }, KABEL]))).toThrow(
      tooClose(8, 2, '2.2'),
    );
    for (const b of [{ x: 11, y: 1 }, { x: 10, y: 2 }]) {
      expect(() => parseMission(withStations([AT_A, { ...AT_B, ...b }, KABEL]))).not.toThrow();
    }
  });

  it('leave a station of one console without a console, and alone', () => {
    expect(() => parseMission(withStations([AT_A, AT_B, { ...KABEL, console: 'a' }]))).toThrow(
      /station "kabel" is worked at one console — leave out console/,
    );
    expect(() => parseMission(withStations([AT_A, AT_B, KABEL, { ...KABEL, x: 4 }]))).toThrow(
      /2 stations for puzzle "kabel" — it is worked at one console/,
    );
  });

  it('put every console on the floor, and know no third one', () => {
    expect(() => parseMission(withStations([AT_A, { ...AT_B, x: 15 }, KABEL]))).toThrow(
      /console b of station "kette" at 15,1 is not on a floor tile/,
    );
    expect(() => parseMission(withStations([AT_A, { ...AT_B, console: 'c' }, KABEL]))).toThrow(
      /map\.stations\.1\.console/,
    );
  });
});

/**
 * Two corridors, one above the other, joined by a door at (4,2) that only
 * the solved Signalkette opens; the book lies in the upper one.
 *
 *   0123456789
 * 0 ##########
 * 1 #........#   book (8,1)
 * 2 ####.#####   door (4,2)
 * 3 #........#
 * 4 ##########
 */
function corridors(
  spawns: { x: number; y: number }[],
  a: { x: number; y: number },
  b: { x: number; y: number },
): unknown {
  return {
    id: 'zwei-gaenge',
    title: 'Zwei Gänge',
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [{ type: 'signal', id: 'kette', title: 'Signalkette' }],
    map: {
      tiles: ['##########', '#........#', '####.#####', '#........#', '##########'],
      spawns,
      doors: [{ id: 'tuer', x: 4, y: 2, opensBy: { kind: 'puzzle', puzzleId: 'kette' } }],
      stations: [
        { puzzleId: 'kette', ...a, console: 'a' },
        { puzzleId: 'kette', ...b, console: 'b' },
      ],
      manuals: [
        {
          id: 'buch',
          kind: 'book',
          label: 'HANDBUCH',
          puzzleIds: ['kette'],
          spots: [{ x: 8, y: 1 }],
        },
      ],
    },
  };
}

const UP = { x: 1, y: 1 };
const DOWN = { x: 1, y: 3 };

describe('the map walk at a station with two consoles', () => {
  it('lets two players work it from two rooms, one each', () => {
    const apart = corridors([UP, DOWN], { x: 2, y: 1 }, { x: 7, y: 3 });
    expect(() => parseMission(apart)).not.toThrow();
  });

  it('needs somebody besides the player at console a for console b', () => {
    expect(() => parseMission(corridors([UP, DOWN], { x: 2, y: 1 }, { x: 7, y: 1 }))).toThrow(
      'map: nobody but the player at console a can reach console b of station "kette" once ' +
        'the puzzles before it are solved (crew of 2 starting at 1,1 · 1,3)',
    );
  });

  it('names the console nobody reaches', () => {
    const above = [UP, { x: 2, y: 1 }];
    expect(() => parseMission(corridors(above, { x: 2, y: 3 }, { x: 7, y: 1 }))).toThrow(
      /nobody can reach console a of station "kette" once the puzzles before it are solved/,
    );
    expect(() => parseMission(corridors(above, { x: 3, y: 1 }, { x: 7, y: 3 }))).toThrow(
      /nobody can reach console b of station "kette" once the puzzles before it are solved/,
    );
  });
});

describe('who stands at which console', () => {
  it('keys console b apart from the station, and console a like a station of one', () => {
    expect(stationKey({ puzzleId: 'kette' })).toBe('kette');
    expect(stationKey({ puzzleId: 'kette', console: 'a' })).toBe('kette');
    expect(stationKey({ puzzleId: 'kette', console: 'b' })).toBe('kette/b');
  });

  it('counts the players at either console as the operators', () => {
    const state = atTheConsoles();
    expect(operatorsOf(state, 'kette')).toEqual(['p1', 'p2']);
    expect(consoleOf(state, 'kette', 'p1')).toBe('a');
    expect(consoleOf(state, 'kette', 'p2')).toBe('b');
    expect(consoleOf(state, 'kette', 'p3')).toBeNull();
    const both = standing(state, { stations: { kette: ['p1'], [CONSOLE_B]: ['p1', 'p2'] } });
    expect(operatorsOf(both, 'kette')).toEqual(['p1', 'p2']);
    expect(consoleOf(both, 'kette', 'p1')).toBe('a');
    const box = standing(state, { stations: { kabel: ['p3'] } });
    expect(consoleOf(box, 'kabel', 'p3')).toBe('a');
  });

  it('arms both consoles of the current station, and nothing outside a run', () => {
    const state = atTheConsoles();
    const map = state.mission.map;
    expect(armedStations(map, state)).toEqual([
      { x: 6, y: 1, console: 'a' },
      { x: 13, y: 1, console: 'b' },
    ]);
    expect(armedStations(map, { ...state, currentPuzzleIndex: 1 })).toEqual([
      { x: 3, y: 1, console: null },
    ]);
    expect(armedStations(map, { ...state, phase: 'lobby' })).toEqual([]);
  });

  it('tells every player and the audience who stands at which console', () => {
    const state = atTheConsoles();
    expect(viewFor(state, 'p1').presence).toMatchObject({ stationId: 'kette', console: 'a' });
    expect(viewFor(state, 'p2').presence).toMatchObject({ stationId: 'kette', console: 'b' });
    expect(viewFor(state, 'p3').presence).toMatchObject({
      stationId: null,
      console: null,
      manualId: 'buch',
    });
    expect(viewForSpectator(state).players.map((p) => p.presence.console)).toEqual([
      'a',
      'b',
      null,
    ]);
  });

  it('marks both consoles on the map, and only those', () => {
    const stations = viewFor(atTheConsoles(), 'p3').map?.stations ?? [];
    expect(stations).toEqual([
      { puzzleId: 'kette', x: 6, y: 1, title: 'Signalkette', status: 'armed', console: 'a' },
      { puzzleId: 'kette', x: 13, y: 1, title: 'Signalkette', status: 'armed', console: 'b' },
      { puzzleId: 'kabel', x: 3, y: 1, title: 'Kabel', status: 'locked' },
    ]);
    expect(stations[2]).not.toHaveProperty('console');
  });
});

describe('the open station at two consoles', () => {
  /** The Signalkette switched on by Ben, who stands at console b. */
  function open(): GameState {
    return applyAction(atTheConsoles(), { type: 'interact', playerId: 'p2', at: T0 + 500 });
  }

  const input = (playerId: string, press: string): Action => ({
    type: 'puzzle-input',
    playerId,
    at: T0 + 1000,
    input: { press },
  });

  it('shows each viewer the console they stand at', () => {
    const state = open();
    expect(viewFor(state, 'p1').puzzle?.console).toBe('a');
    expect(viewFor(state, 'p2').puzzle?.console).toBe('b');
    expect(viewFor(state, 'p3').puzzle?.console).toBeNull();
    expect(viewForSpectator(state).puzzle?.console).toBeNull();
  });

  it('hands the module the console a move comes from', () => {
    const state = open();
    const puzzle = viewFor(state, 'p1').puzzle;
    const first = puzzle?.kind === 'signal' ? puzzle.sequence?.[0] : undefined;
    const apply = vi.spyOn(signalModule, 'apply');
    applyAction(state, input('p2', first ?? 'rot-kreis'));
    expect(apply.mock.calls[0]?.[3]).toBe('p2');
    expect(apply.mock.calls[0]?.[4]).toMatchObject({ console: 'b' });
    apply.mockRestore();
  });

  it('refuses a move from somebody at neither console', () => {
    expect(() => applyAction(open(), input('p3', 'rot-kreis'))).toThrow(
      'Eingabe nur am Pult.',
    );
  });
});
