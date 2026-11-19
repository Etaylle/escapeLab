import { describe, expect, it } from 'vitest';
import type { DronePosition, PlayerView, PuzzleView } from '@escapelab/core';
import { droneTilesOf, signalsOf, stationClockOf } from '../src/world/pressureSignals.js';

/** A station's view with only what the clock is read from; the rest stays out of the test. */
const puzzle = (view: Record<string, unknown>): PuzzleView => view as unknown as PuzzleView;

const drone = (x: number, y: number, frozen = false): DronePosition => ({
  x,
  y,
  facing: 0,
  range: 4,
  halfAngleDeg: 30,
  alerted: false,
  frozen,
});

describe('a station’s own clock, as this player’s view shows it', () => {
  const NOW = 100_000;

  it('runs for the Paketfilter’s wave at a console: falling, not held, not waiting', () => {
    const wave = { kind: 'firewall', waiting: false, clock: { startedAt: NOW - 5000, heldAt: null } };
    expect(stationClockOf(puzzle(wave), NOW)).toBe(0);
    expect(stationClockOf(puzzle({ ...wave, waiting: true }), NOW)).toBeNull();
    const held = { ...wave, clock: { startedAt: NOW - 5000, heldAt: NOW - 1000 } };
    expect(stationClockOf(puzzle(held), NOW)).toBeNull();
    expect(stationClockOf(puzzle({ ...wave, clock: null }), NOW)).toBeNull(); // a reader
  });

  it('runs up the Anlaufsteuerung’s ladder with its pulse, at the console that takes it', () => {
    const board = (sentAt: number | null) => ({
      kind: 'startup',
      ladder: { steps: 10, marked: 3 },
      board: { feeders: [], pulse: sentAt === null ? null : { sentAt, arrived: false } },
    });
    expect(stationClockOf(puzzle(board(NOW)), NOW)).toBe(0);
    expect(stationClockOf(puzzle(board(NOW - 4000)), NOW)).toBeCloseTo(0.4, 9);
    expect(stationClockOf(puzzle(board(NOW - 30_000)), NOW)).toBe(1);
    expect(stationClockOf(puzzle(board(null)), NOW)).toBeNull();
    expect(stationClockOf(puzzle({ ...board(NOW), board: null }), NOW)).toBeNull(); // the terminal
  });

  it('runs a press of the Synchrontaster through its window, and none without one', () => {
    const press = (expiresAt: number | null) => ({
      kind: 'button-sync',
      press: { at: NOW - 1000, expiresAt },
    });
    expect(stationClockOf(puzzle(press(NOW + 3000)), NOW)).toBeCloseTo(0.25, 9);
    expect(stationClockOf(puzzle(press(NOW)), NOW)).toBeNull(); // run out
    expect(stationClockOf(puzzle(press(null)), NOW)).toBeNull();
    expect(stationClockOf(puzzle({ kind: 'button-sync', press: null }), NOW)).toBeNull();
  });

  it('runs the token’s period at the Zugangskontrolle’s device', () => {
    const device = { account: 'x', token: '000000', endsAt: NOW + 15_000, periodSec: 20 };
    expect(stationClockOf(puzzle({ kind: 'access', device }), NOW)).toBeCloseTo(0.25, 9);
    expect(stationClockOf(puzzle({ kind: 'access', device: null }), NOW)).toBeNull();
  });

  it('is none at a station without a clock, and with no station open', () => {
    expect(stationClockOf(puzzle({ kind: 'morse' }), NOW)).toBeNull();
    expect(stationClockOf(null, NOW)).toBeNull();
  });
});

describe('the signals of a view', () => {
  const view = (over: Partial<PlayerView> = {}) => ({
    map: null,
    puzzle: null,
    currentPuzzleIndex: 0,
    puzzleCount: 6,
    ...over,
  });

  it('finds the nearest drone awake, a frozen one none', () => {
    const self = { x: 1, y: 1 };
    expect(droneTilesOf(self, {})).toBe(Infinity);
    expect(droneTilesOf(self, { a: drone(4, 5), b: drone(1, 2, true) })).toBe(5);
    expect(droneTilesOf(self, { a: drone(4, 5), b: drone(1, 3) })).toBe(2);
  });

  it('reads an emergency off the map, and the way through the stations off the run', () => {
    const quiet = signalsOf(view(), { x: 0, y: 0 }, {}, 0);
    expect(quiet).toEqual({ emergency: false, stationClock: null, droneTiles: Infinity, progress: 0 });
    const map = { sabotage: { label: '', hint: '', endsAt: 1, panels: [] } } as never;
    expect(signalsOf(view({ map }), { x: 0, y: 0 }, {}, 0).emergency).toBe(true);
    const later = signalsOf(view({ currentPuzzleIndex: 3 }), { x: 0, y: 0 }, {}, 0);
    expect(later.progress).toBe(0.5);
    expect(signalsOf(view({ puzzleCount: 0 }), { x: 0, y: 0 }, {}, 0).progress).toBe(0);
  });
});
