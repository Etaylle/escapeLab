import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { walkTo, type Walker } from './walk.js';

/**
 * A corridor that opens with the power on for three seconds: three stations
 * where the whole crew presses, a short-sighted drone on the south row that
 * patrols from the start of the dark — it catches nobody on the stations'
 * row — and an emergency at two valves a minute into it, after `afterSolved`
 * stations.
 *
 *   0123456789
 * 0 ##########
 * 1 #..1.2.3.#   stations at (3,1), (5,1), (7,1); spawns (1,1) and (8,1)
 * 2 #.v.....v#   valves (2,2) and (8,2); the drone flies (1,2) to (8,2)
 * 3 ##########
 */
function mission(afterSolved = 2): Mission {
  return parseMission({
    id: 'kaltstart',
    title: 'Kaltstart',
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    intro: { lightsSec: 3 },
    radio: { start: 'Strom weg.' },
    players: { min: 2, max: 2 },
    puzzles: ['eins', 'zwei', 'drei'].map((id) => ({ type: 'button-sync', id, title: id })),
    map: {
      tiles: ['##########', '#........#', '#........#', '##########'],
      spawns: [
        { x: 1, y: 1 },
        { x: 8, y: 1 },
      ],
      stations: [
        { puzzleId: 'eins', x: 3, y: 1 },
        { puzzleId: 'zwei', x: 5, y: 1 },
        { puzzleId: 'drei', x: 7, y: 1 },
      ],
      drones: [
        {
          id: 'wache',
          waypoints: [
            { x: 1, y: 2 },
            { x: 8, y: 2 },
          ],
          range: 0.5,
        },
      ],
      sabotage: {
        label: 'KÜHLUNG',
        firstAfterSec: 60,
        afterSolved,
        panels: [
          { id: 'links', x: 2, y: 2 },
          { id: 'rechts', x: 8, y: 2 },
        ],
      },
    },
  });
}

const INTRO_MS = 3000;
const LIMIT_MS = 600_000;

/** A player of the room, with how to let go of their connection, as its socket closing does. */
type Player = Walker & { token: string; detach: () => void };

function join(room: Room, name: string): Player {
  const messages: ServerMessage[] = [];
  const player = { ...room.join(name), messages };
  return { ...player, detach: room.attach(player.playerId, (m) => messages.push(m)) };
}

function lastView(walker: Walker) {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected a view message');
  }
  return last.view;
}

/** The drones the latest positions message streams, by id. */
function streamedDrones(walker: Walker): string[] {
  const last = walker.messages.filter((m) => m.kind === 'positions').at(-1);
  return last?.kind === 'positions' ? Object.keys(last.drones) : [];
}

describe('a room whose mission opens with the power on', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Anna and Ben in a started run; `startedAt` is the fake clock's now. */
  function started(afterSolved?: number) {
    const room = new Room('TEST', mission(afterSolved));
    const anna = join(room, 'Anna');
    const ben = join(room, 'Ben');
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben, startedAt: Date.now() };
  }

  /** Both at the armed station, switched on, both press. */
  function solveNext(room: Room, anna: Walker, ben: Walker): void {
    const armed = lastView(anna).map?.stations.find((s) => s.status === 'armed');
    if (armed === undefined) {
      throw new Error('no station is armed');
    }
    walkTo(room, anna, armed.x + 0.5, armed.y + 0.5);
    walkTo(room, ben, armed.x + 1.5, armed.y + 0.5);
    room.act(anna.playerId, { kind: 'interact' });
    for (const player of [anna, ben]) {
      room.act(player.playerId, { kind: 'puzzle-input', input: { press: true } });
    }
  }

  it('puts the lights out `lightsSec` after the start, and the clock starts then', () => {
    const { room, anna, startedAt } = started();
    expect(lastView(anna).lights).toEqual({ out: false, outAt: null });
    expect(lastView(anna).deadlineAt).toBeNull();
    vi.advanceTimersByTime(INTRO_MS - 1);
    expect(lastView(anna).lights.out).toBe(false);
    vi.advanceTimersByTime(1);
    const out = lastView(anna);
    expect(out.lights).toEqual({ out: true, outAt: startedAt + INTRO_MS });
    expect(out.deadlineAt).toBe(startedAt + INTRO_MS + LIMIT_MS);
    expect(out.events.map((e) => e.label)).toEqual(['Stromausfall', 'Strom weg.']);
    expect(out.map?.stations.map((s) => s.status)).toEqual(['armed', 'locked', 'locked']);
    room.dispose();
  });

  it('puts the lights out early once the whole crew has seen enough of the intro', () => {
    const { room, anna, ben, startedAt } = started();
    vi.advanceTimersByTime(1000);
    room.act(anna.playerId, { kind: 'intro-done' });
    room.act(anna.playerId, { kind: 'intro-done' });
    expect(lastView(ben).lights.out).toBe(false);
    expect(lastView(ben).intro?.done).toEqual([anna.playerId]);
    vi.advanceTimersByTime(500);
    room.act(ben.playerId, { kind: 'intro-done' });
    const out = lastView(anna);
    expect(out.lights).toEqual({ out: true, outAt: startedAt + 1500 });
    expect(out.deadlineAt).toBe(startedAt + 1500 + LIMIT_MS);
    expect(out.events.map((e) => e.label)).toEqual(['Stromausfall', 'Strom weg.']);
    // The intro's own end is called off: when it was due, nothing happens any more.
    vi.advanceTimersByTime(INTRO_MS);
    expect(lastView(anna).lights.outAt).toBe(startedAt + 1500);
    expect(lastView(anna).events).toHaveLength(2);
    room.dispose();
  });

  it('keeps the lights on for the intro’s length where one of the crew still watches', () => {
    const { room, anna, ben, startedAt } = started();
    room.act(anna.playerId, { kind: 'intro-done' });
    vi.advanceTimersByTime(INTRO_MS - 1);
    expect(lastView(ben).lights.out).toBe(false);
    vi.advanceTimersByTime(1);
    expect(lastView(ben).lights).toEqual({ out: true, outAt: startedAt + INTRO_MS });
    room.dispose();
  });

  it('lets the crew walk while the lights are on, but switch nothing on', () => {
    const { room, anna } = started();
    walkTo(room, anna, 3.5, 1.5);
    expect(lastView(anna).presence.stationId).toBe('eins');
    expect(() => room.act(anna.playerId, { kind: 'interact' })).toThrow(/nichts zu aktivieren/);
    room.dispose();
  });

  it('waits out a pause during the intro: the lights go out that much later', () => {
    const { room, anna, ben } = started();
    vi.advanceTimersByTime(1000);
    ben.detach();
    expect(lastView(anna).pausedFor).toEqual(['Ben']);
    vi.advanceTimersByTime(10_000);
    expect(lastView(anna).lights.out).toBe(false);
    room.resume(ben.playerId, ben.token);
    room.attach(ben.playerId, (m) => ben.messages.push(m));
    const resumedAt = Date.now();
    vi.advanceTimersByTime(INTRO_MS - 1000 - 1);
    expect(lastView(anna).lights.out).toBe(false);
    vi.advanceTimersByTime(1);
    expect(lastView(anna).lights).toEqual({ out: true, outAt: resumedAt + INTRO_MS - 1000 });
    room.dispose();
  });

  it('keeps the drone asleep until the lights are out, then sends it on patrol', () => {
    const { room, anna } = started();
    vi.advanceTimersByTime(INTRO_MS - 100);
    expect(streamedDrones(anna)).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(streamedDrones(anna)).toEqual(['wache']);
    room.dispose();
  });

  it('sends no emergency before `afterSolved` stations are solved, timed from the dark', () => {
    const { room, anna, ben, startedAt } = started(2);
    vi.advanceTimersByTime(INTRO_MS);
    solveNext(room, anna, ben);
    vi.advanceTimersByTime(120_000);
    expect(lastView(anna).map?.sabotage).toBeNull();
    solveNext(room, anna, ben);
    // The slots run on from the dark: a minute in, then every two and a half — 3:30 is next.
    const next = startedAt + INTRO_MS + 210_000;
    vi.advanceTimersByTime(next - Date.now() - 1);
    expect(lastView(anna).map?.sabotage).toBeNull();
    vi.advanceTimersByTime(1);
    expect(lastView(anna).map?.sabotage?.label).toBe('KÜHLUNG');
    room.dispose();
  });

  it('sends the first emergency a minute into the dark where it may come at once', () => {
    const { room, anna, startedAt } = started(0);
    vi.advanceTimersByTime(INTRO_MS + 60_000 - 1);
    expect(lastView(anna).map?.sabotage).toBeNull();
    vi.advanceTimersByTime(1);
    expect(lastView(anna).map?.sabotage?.label).toBe('KÜHLUNG');
    expect(Date.now()).toBe(startedAt + INTRO_MS + 60_000);
    room.dispose();
  });

  it('loses the run to the clock only a full limit after the lights went out', () => {
    const { room, anna } = started();
    vi.advanceTimersByTime(LIMIT_MS);
    expect(lastView(anna).phase).toBe('playing');
    vi.advanceTimersByTime(INTRO_MS);
    expect(lastView(anna).phase).toBe('lost');
    room.dispose();
  });
});
