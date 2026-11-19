import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room } from '../src/room.js';
import { open, roomKey, seal } from '../src/seal.js';
import type { FinishedRun } from '../src/store/store.js';
import {
  blackoutMidway,
  blackoutMission,
  DRAW_SEEDS,
  lastView,
  playToTheHatch,
  rejoin,
  type BlackoutCrew,
  type Member,
} from './blackout.js';
import { pressE, standAsIn, walkTo } from './walk.js';

/**
 * Blackout's fifth place is a Wechselplatz: the Signalkette, the Funkpult and the
 * Notstromkasten take turns there, one a run by its seed. Each draw is played in a real room
 * from the lever to the hatch — walking, E, every station by its solver on the views at its
 * consoles, the Paketfilter's waves and the Anlaufsteuerung's pulses on the room's own timers —
 * and one of them is sealed mid-way, taken up again by another room and won there.
 */

const draws = Object.entries(DRAW_SEEDS) as [keyof typeof DRAW_SEEDS, number][];
const members = draws.map(([id]) => id);

/** The status of every console `member`'s last view tells whole, by puzzle id. */
const statuses = (member: Member): Record<string, string> =>
  Object.fromEntries(
    (lastView(member).map?.stations ?? []).flatMap((s) =>
      s.known ? [[s.puzzleId, s.status]] : [],
    ),
  );

/** Beside a console out of service in each draw: the tile to stand on, and whose it is. */
const RESTING_CONSOLE: Readonly<Record<keyof typeof DRAW_SEEDS, [number, number, string]>> = {
  signalkette: [6, 15, 'notstrom'],
  frequenz: [7, 6, 'signalkette'],
  notstrom: [7, 6, 'signalkette'],
};

/** The key the snapshot below is sealed under. */
const KEY = roomKey({ ROOM_SECRET: 'cafe'.repeat(16) }).key;

describe('Blackout in a room, whichever station has its Wechselplatz', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(draws)('%s (seed %i): played from the lever to the hatch and won', (id, seed) => {
    const reports: FinishedRun[] = [];
    const crew = blackoutMidway((run) => reports.push(run), seed);
    expect(lastView(crew.anna).currentPuzzleIndex).toBe(3);
    // The reactor's doors wait for the Wechselplatz, whichever station has it.
    const reactorDoors = (): (boolean | undefined)[] =>
      ['reaktortuer', 'reaktorschott'].map(
        (door) => lastView(crew.anna).map?.doors.find((d) => d.id === door)?.open,
      );
    expect(reactorDoors()).toEqual([false, false]);
    playToTheHatch(crew);
    const view = lastView(crew.anna);
    expect(view.phase).toBe('won');
    expect(view.puzzleCount).toBe(6);
    expect(reports).toHaveLength(1);
    const report = reports[0]?.report;
    expect(report?.outcome).toBe('won');
    expect(report?.drawn).toEqual({ wechsel: id });
    expect(report?.stations.map((s) => s.puzzleId)).toEqual([
      'notlicht',
      'anlauf',
      'paketfilter',
      'subsysteme',
      id,
      'reaktorstart',
    ]);
    crew.room.dispose();
  });

  it.each(draws)('%s: the other two stand out of service, E answers the tag', (id, seed) => {
    const { room, ben } = blackoutMidway(undefined, seed);
    const { state } = room.snapshot();
    expect(state.drawn).toEqual({ wechsel: id });
    const resting = members.filter((member) => member !== id);
    expect(state.mission.puzzles.slice(6).map((p) => p.id).sort()).toEqual([...resting].sort());
    // Ben, his hands free, walks up to a console at rest: the Notstromkasten's box inside the
    // Maschinentür, or console A of the Signalkette in the Archiv.
    const [x, y, puzzleId] = RESTING_CONSOLE[id];
    walkTo(room, ben, x + 0.5, y + 0.5);
    expect(() => pressE(room, ben)).toThrow('Außer Betrieb.');
    expect(lastView(ben).puzzle).toBeNull();
    // The Serverraum is the armed station, known to every view; nothing else is armed.
    expect(statuses(ben)).toMatchObject({ [puzzleId]: 'out', subsysteme: 'armed' });
    const armed = Object.entries(statuses(ben)).filter(([, status]) => status === 'armed');
    expect(armed.map(([station]) => station)).toEqual(['subsysteme']);
    room.dispose();
  });

  it('is sealed mid-way with two stations out of service, taken up again and won there', () => {
    const reports: FinishedRun[] = [];
    const seed = DRAW_SEEDS.notstrom;
    const first = blackoutMidway(() => undefined, seed);
    vi.advanceTimersByTime(2000);
    const at = Date.now();
    const sealed = { ...first.room.snapshot(at), instance: 'blackout', final: true };
    const blob = seal(sealed, 'SNAP', KEY);
    first.room.goDown(at);
    first.anna.detach();
    first.ben.detach();
    vi.advanceTimersByTime(30_000);
    const kept = open(blob, 'SNAP', KEY);
    expect(kept.state.drawn).toEqual({ wechsel: 'notstrom' });
    expect(kept.state.mission.puzzles.map((p) => p.id)).toEqual([
      'notlicht',
      'anlauf',
      'paketfilter',
      'subsysteme',
      'notstrom',
      'reaktorstart',
      'signalkette',
      'frequenz',
    ]);
    const again = Room.restore(kept, Date.now(), { onRunFinished: (run) => reports.push(run) });
    const crew: BlackoutCrew = {
      room: again,
      anna: rejoin(again, first.anna),
      ben: rejoin(again, first.ben),
    };
    for (const member of [first.anna, first.ben]) {
      standAsIn(again, first.room, member);
    }
    expect(lastView(crew.anna).pausedAt).toBeNull();
    expect(lastView(crew.anna).currentPuzzleIndex).toBe(3);
    playToTheHatch(crew);
    expect(lastView(crew.anna).phase).toBe('won');
    expect(reports.map((run) => run.report.drawn)).toEqual([{ wechsel: 'notstrom' }]);
    // The mission file itself never changed: the run's order is the run's own.
    expect(blackoutMission().puzzles.map((p) => p.id).slice(4, 7)).toEqual([
      'signalkette',
      'frequenz',
      'notstrom',
    ]);
    first.room.dispose();
    again.dispose();
  });
});
