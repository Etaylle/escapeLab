import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerView } from '@escapelab/core';
import { signalsOf } from '../../client/src/world/pressureSignals.js';
import { DemoHost } from '../src/demo/host.js';
import type { CrewSeat } from '../src/demo/seat.js';
import { PACE } from '../src/demo/station.js';
import { blackoutMission, watch } from './demo.js';

/**
 * The tension the demo crew's runs give each of its seats, as the client reads it from the
 * seat's view and the drones (client pressureSignals.ts): recorded on the fake clock, a tick at
 * a time, into the trace the client's music test turns into a stem timeline
 * (client/test/tensionTraces.json). This test proves the trace is what the crew plays
 * today; `UPDATE_TRACES=1` writes it anew.
 */

const FIXTURE = new URL('../../client/test/tensionTraces.json', import.meta.url);
/** The client's music starts this long after the lights go out, ms (coldOpen + music.ts). */
const MUSIC_AFTER_OUT_MS = 1300 + 2000;
/** How long a tick of the fake clock is, ms: the crew's own. */
const TICK_MS = 80;
/** Drones further than this are written as this far, tiles: the music hears none so far. */
const FAR_TILES = 12;

/** One row of a seat's trace, written where anything in it changed. */
type Row = [
  /** ms since the music started */
  t: number,
  alarms: number,
  escaping: 0 | 1,
  emergency: 0 | 1,
  /** the station clock's run, to a tenth; -1 for none */
  stationClock: number,
  /** the nearest drone awake, to half a tile, FAR_TILES for none nearer */
  droneTiles: number,
  progress: number,
];

interface SeatTrace {
  /** when the clock runs out, ms after the music's start */
  deadline: number;
  /** when the run ended, ms after the music's start */
  end: number;
  ending: 'won' | 'lost';
  rows: Row[];
}

export interface RunTrace {
  name: string;
  budget: number;
  seats: SeatTrace[];
}

/** A slow crew: reads, looks and moves at about twice the pace of the demo's own. */
const SLOW: Partial<Record<keyof typeof PACE, readonly [number, number]>> = {
  read: [30_000, 42_000],
  input: [6000, 10_000],
  look: [2000, 3500],
  relay: [5000, 8000],
};

const RUNS: { name: string; seed: number; slow?: true }[] = [
  { name: 'seed 12', seed: 12 },
  { name: 'seed 56', seed: 56 },
  { name: 'seed 93', seed: 93 },
  { name: 'seed 56, a slow crew', seed: 56, slow: true },
];

const half = (n: number): number => Math.round(n * 2) / 2;

/** The row of `view` as `seat` has it at `now`, `t` ms into the music. */
function rowOf(seat: CrewSeat, view: PlayerView, now: number, t: number): Row {
  const signals = signalsOf(view, seat.at, seat.drones, now);
  return [
    t,
    view.penaltySeq,
    view.map?.exit?.open === true ? 1 : 0,
    signals.emergency ? 1 : 0,
    signals.stationClock === null ? -1 : Math.round(signals.stationClock * 10) / 10,
    Math.min(FAR_TILES, half(signals.droneTiles)),
    Math.round(signals.progress * 100) / 100,
  ];
}

const sameRow = (a: Row | undefined, b: Row): boolean =>
  a !== undefined && a.slice(1).every((value, i) => value === b[i + 1]);

/** The trace of one run of `seed`, each seat's from the music's start to the run's end. */
function record(seed: number): RunTrace['seats'] {
  const host = new DemoHost(blackoutMission(), [seed]);
  const watcher = watch(host);
  const seats = (host as unknown as { seats: readonly [CrewSeat, CrewSeat] }).seats;
  const traces = seats.map((seat) => ({ seat, rows: [] as Row[], deadline: 0, end: 0, start: 0 }));
  try {
    for (let tick = 0; tick * TICK_MS < 1200_000; tick++) {
      vi.advanceTimersByTime(TICK_MS);
      watcher.heard.length = 0;
      const now = Date.now();
      traces.forEach((trace) => sample(trace.seat, trace, now));
      if (seats.every((seat) => seat.view?.phase === 'won' || seat.view?.phase === 'lost')) break;
    }
  } finally {
    host.stop();
  }
  const ending = seats[0].view?.phase === 'won' ? 'won' : 'lost';
  return traces.map(({ rows, deadline, end }) => ({ deadline, end, ending, rows }));
}

/** `seat`'s look at `now` into `trace`, once its music has started. */
function sample(
  seat: CrewSeat,
  trace: { rows: Row[]; deadline: number; end: number; start: number },
  now: number,
): void {
  const view = seat.view;
  const outAt = view?.lights.outAt ?? null;
  if (view === null || outAt === null || view.deadlineAt === null) return;
  trace.start = outAt + MUSIC_AFTER_OUT_MS;
  if (now < trace.start) return;
  const t = now - trace.start;
  trace.deadline = view.deadlineAt - trace.start;
  trace.end = t;
  if (view.phase !== 'playing') return;
  const row = rowOf(seat, view, now, t);
  if (!sameRow(trace.rows.at(-1), row)) trace.rows.push(row);
}

describe('the tension trace of the demo crew', () => {
  const pace = { ...PACE };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 19, 22, 0, 0));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    Object.assign(PACE, pace);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is what the crew plays today, seat by seat, for each run the music test measures', () => {
    const runs: RunTrace[] = RUNS.map(({ name, seed, slow }) => {
      if (slow === true) Object.assign(PACE, SLOW);
      const seats = record(seed);
      Object.assign(PACE, pace);
      return { name, budget: blackoutMission().timeLimitSec, seats };
    });
    const text = `${JSON.stringify({ runs })}\n`;
    if (process.env.UPDATE_TRACES === '1') writeFileSync(FIXTURE, text);
    expect(runs.every((run) => run.seats.every((seat) => seat.ending === 'won'))).toBe(true);
    expect(text).toBe(readFileSync(FIXTURE, 'utf8'));
  }, 600_000);
});
