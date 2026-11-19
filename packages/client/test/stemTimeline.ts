import {
  ALARM_HOLD_MS,
  moodAt,
  moodFrom,
  nextBar,
  PREPARE_S,
  pressureOf,
  SCORE_BPM,
  stemFor,
  type Stem,
} from '../src/world/music.js';
import traces from './tensionTraces.json';

/**
 * The stems a run's music plays, from a seat's recorded trace (tensionTraces.json, written by
 * the server's tensionTrace.test.ts from the demo crew's runs): the trace replayed ten times a
 * second through the music's own pressure and mood (music.ts `pressureOf`, `moodAt`), each change
 * of stem on the score's next bar line as `retarget` lays it.
 */

/** One row of a trace: [ms, alarms, escaping, emergency, station clock (-1 none), drone, progress]. */
type Row = readonly number[];

export interface SeatTrace {
  deadline: number;
  end: number;
  ending: string;
  rows: Row[];
}

export interface RunTrace {
  name: string;
  budget: number;
  seats: SeatTrace[];
}

export const RUNS: readonly RunTrace[] = traces.runs;

/** A stem on air, from and to, ms after the music's start. */
export interface Stretch {
  stem: Stem;
  from: number;
  to: number;
}

/** How often the music looks at the run, ms (GameWorld.tsx HEAR_MS). */
const LOOK_MS = 100;
const GRID = { origin: 0, bpm: SCORE_BPM };

/** The pressure the run asks for at `t` from `row`, with `alarms` come in the last while. */
function askedAt(run: RunTrace, seat: SeatTrace, row: Row, alarms: number, t: number): number {
  const [, , escaping, emergency, stationClock = -1, droneTiles = Infinity, progress = 0] = row;
  return pressureOf({
    left: (seat.deadline - t) / 1000,
    budget: run.budget,
    alarms,
    escaping: escaping === 1,
    emergency: emergency === 1,
    stationClock: stationClock < 0 ? null : stationClock,
    droneTiles,
    progress,
  });
}

/** The stems `seat` of `run` hears, in order, from the music's start to the run's end. */
export function stemTimeline(run: RunTrace, seat: SeatTrace): Stretch[] {
  const stretches: Stretch[] = [{ stem: 'calm', from: 0, to: seat.end }];
  let mood = moodFrom(0);
  let index = 0;
  let pending: { at: number; stem: Stem } | null = null;
  const alarmsAt: number[] = [];
  for (let t = 0; t <= seat.end; t += LOOK_MS) {
    while ((seat.rows[index + 1]?.[0] ?? Infinity) <= t) index++;
    const row = seat.rows[index] ?? [];
    while (alarmsAt.length < (row[1] ?? 0)) alarmsAt.push(t);
    const recent = alarmsAt.filter((at) => at > t - ALARM_HOLD_MS).length;
    const was = stemFor(mood.layers);
    mood = moodAt(mood, askedAt(run, seat, row, recent, t), row[2] === 1, t);
    const stem = stemFor(mood.layers);
    if (stem !== was) pending = { at: nextBar(t / 1000 + PREPARE_S, GRID) * 1000, stem };
    if (pending !== null && t >= pending.at) {
      const on = stretches.at(-1);
      if (on !== undefined && on.stem !== pending.stem) {
        on.to = pending.at;
        stretches.push({ stem: pending.stem, from: pending.at, to: seat.end });
      }
      pending = null;
    }
  }
  return stretches;
}

/** The share of the run each stem is on air, 0 to 1. */
export function sharesOf(stretches: readonly Stretch[]): Record<Stem, number> {
  const end = stretches.at(-1)?.to ?? 0;
  const share = { calm: 0, tense: 0, critical: 0 };
  for (const { stem, from, to } of stretches) share[stem] += (to - from) / Math.max(1, end);
  return share;
}
