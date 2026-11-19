import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mission } from '@escapelab/core';
import { DemoCrew } from '../src/demo/crew.js';
import {
  DEMO_CODE,
  DEMO_COMPLAINTS,
  DEMO_FULL,
  DEMO_IDLE_MS,
  DEMO_MAX_WATCHING,
  DEMO_STALL_MS,
  DemoHost,
  type Wire,
} from '../src/demo/host.js';
import { handsOf, Seat, type CrewSeat } from '../src/demo/seat.js';
import { MissionCatalog } from '../src/missions.js';
import { RoomManager } from '../src/roomManager.js';
import {
  LOGGED_PER_SOCKET,
  serveSockets,
  TOO_MANY_WATCHES,
  WATCHES_PER_MINUTE,
} from '../src/sockets.js';
import { blackoutMission, over, playUntil, seenBy, watch } from './demo.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

/**
 * What keeps the demo room going whatever happens to it: a run that is lost counts as lost and
 * the next follows; a crew that is stuck is given up; an audience that asks without end costs
 * nobody anything; and the crew has in hand of its seats what a page has, and nothing else.
 */

const mission = blackoutMission();
const shipped = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 19, 22, 0, 0));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a run of the demo that is lost', () => {
  it('counts as lost, not as won, and the next run follows by itself', () => {
    // Two minutes on the clock: no crew gets through Blackout in that.
    const short: Mission = { ...mission, timeLimitSec: 120 };
    const host = new DemoHost(short, [12, 56]);
    const watcher = watch(host);
    const lost = playUntil(watcher, over);
    expect(lost.phase).toBe('lost');
    expect(host.counts()).toEqual({ running: false, spectators: 1, won: 0, lost: 1 });
    const next = playUntil(watcher, (view) => view.phase === 'playing', 40);
    expect(next.startedAt).toBeGreaterThan(lost.finishedAt ?? Infinity);
    host.stop();
  });

  it('is given up where its crew gets no further, long before the clock; the next is won', () => {
    const warned: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((line: string) => void warned.push(line));
    // The first run's moves at the consoles never reach the room: its crew stands at the switch.
    let deaf = true;
    const wire: Wire = {
      up: (msg) => (deaf && msg.kind === 'puzzle-input' ? { kind: 'drop-item' } : msg),
      down: (msg) => msg,
    };
    const host = new DemoHost(mission, [12, 56], wire);
    const watcher = watch(host);
    const lost = playUntil(watcher, over);
    expect(lost.phase).toBe('lost');
    // Five minutes after it last got on — its start — not sixteen after the lights went out.
    const ran = ((lost.finishedAt ?? 0) - (lost.startedAt ?? 0)) / 1000;
    expect(ran).toBeGreaterThan(DEMO_STALL_MS / 1000);
    expect(ran).toBeLessThan(DEMO_STALL_MS / 1000 + 60);
    expect(warned.filter((line) => line.includes('given up'))).toHaveLength(1);
    expect(host.counts()).toMatchObject({ won: 0, lost: 1 });
    deaf = false;
    playUntil(watcher, (view) => view.phase === 'playing', 40);
    const won = playUntil(watcher, over);
    expect(won.phase).toBe('won');
    expect(host.counts()).toMatchObject({ won: 1, lost: 1 });
    host.stop();
  });

  it('counts its crew’s starts over anew from each station on: a run that gets on is kept', () => {
    const warned: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((line: string) => void warned.push(line));
    // Twenty moves at the consoles are lost before the first station, twenty after it.
    const part = Math.ceil((DEMO_COMPLAINTS * 2) / 3);
    const lost = [0, 0];
    let station = 0;
    const wire: Wire = {
      up: (msg) => {
        const stage = Math.min(station, 1);
        if (msg.kind !== 'puzzle-input' || (lost[stage] ?? 0) >= part) {
          return msg;
        }
        lost[stage] = (lost[stage] ?? 0) + 1;
        return { kind: 'puzzle-input', input: 'unsinn' };
      },
      down: (msg) => {
        station = msg.kind === 'view' ? msg.view.currentPuzzleIndex : station;
        return msg;
      },
    };
    const host = new DemoHost(mission, [12], wire);
    const won = playUntil(watch(host), over);
    expect(lost).toEqual([part, part]);
    expect(warned.filter((line) => line.includes('refused')).length).toBeGreaterThan(
      DEMO_COMPLAINTS,
    );
    expect(warned.filter((line) => line.includes('given up'))).toEqual([]);
    expect(won.phase).toBe('won');
    host.stop();
  });

  it('is given up as well where its crew starts over again and again', () => {
    const warned: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((line: string) => void warned.push(line));
    // E never reaches the room: no station is ever switched on, and every start over ends there.
    const wire: Wire = {
      up: (msg) => (msg.kind === 'puzzle-input' ? { kind: 'puzzle-input', input: 'unsinn' } : msg),
      down: (msg) => msg,
    };
    const host = new DemoHost(mission, [12], wire);
    const lost = playUntil(watch(host), over);
    expect(lost.phase).toBe('lost');
    const refusals = warned.filter((line) => line.includes('refused')).length;
    expect(refusals).toBeGreaterThanOrEqual(DEMO_COMPLAINTS);
    expect(refusals).toBeLessThan(DEMO_COMPLAINTS + 5);
    host.stop();
  });
});

describe('the demo room’s rest and whoever comes back', () => {
  it('counts its minute from the last of the audience to go, not from the first', () => {
    const host = new DemoHost(mission, [12]);
    const first = watch(host);
    const run = playUntil(first, (view) => view.phase === 'playing', 10).startedAt;
    first.leave();
    vi.advanceTimersByTime(DEMO_IDLE_MS / 2);
    const back = watch(host);
    vi.advanceTimersByTime(DEMO_IDLE_MS / 3);
    back.leave();
    // A minute after the first left, a third of one after the second: the run goes on.
    vi.advanceTimersByTime(DEMO_IDLE_MS / 3);
    expect(host.counts().running).toBe(true);
    expect(seenBy(watch(host)).startedAt).toBe(run);
    host.stop();
  });
});

/** A server's sockets with a demo and one crew's room; the first watcher of the room. */
function served(host: DemoHost) {
  const line = new FakeServer();
  const manager = new RoomManager();
  serveSockets(line, { catalog: shipped, manager, demo: host });
  const anna = line.connect();
  anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna'), missionId: 'blackout' });
  return { line, manager, anna, code: joinedOf(anna).code };
}

const errors = (socket: FakeSocket): string[] =>
  socket.heard.flatMap((msg) => (msg.kind === 'error' ? [msg.message] : []));

describe('an audience that asks again and again', () => {
  it('goes on watching on its one connection: nothing attached anew, nobody told anything', () => {
    const host = new DemoHost(mission, [12]);
    const { line } = served(host);
    const other = line.connect();
    other.say({ kind: 'spectate', code: DEMO_CODE });
    const flood = line.connect();
    flood.say({ kind: 'spectate', code: DEMO_CODE });
    const told = other.heard.length;
    const heard = flood.heard.length;
    for (let i = 0; i < 3000; i++) {
      flood.say({ kind: 'spectate', code: 'demo' });
    }
    expect(host.counts().spectators).toBe(2);
    expect(other.heard).toHaveLength(told);
    expect(flood.heard).toHaveLength(heard);
    expect(errors(flood)).toEqual([]);
    host.stop();
  });

  it('is told to wait once it has joined audiences twelve times in a minute', () => {
    const host = new DemoHost(mission, [12]);
    const { line, manager, anna, code } = served(host);
    const hopper = line.connect();
    const told = anna.heard.length;
    for (let i = 0; i < 40; i++) {
      hopper.say({ kind: 'spectate', code: i % 2 === 0 ? DEMO_CODE : code });
    }
    // Twelve joins go through; after them it stays where the twelfth left it, Anna's room:
    // asking for that again is nothing, asking for the demo is refused, fourteen times.
    const refused = (40 - WATCHES_PER_MINUTE) / 2;
    expect(errors(hopper)).toEqual(Array.from({ length: refused }, () => TOO_MANY_WATCHES));
    expect(host.counts().spectators).toBe(0);
    expect(manager.get(code).watching).toBe(1);
    // Anna heard of the six that came to her room and the six that left it, and no more.
    const counts = anna.heard.slice(told).filter((msg) => msg.kind === 'audience');
    expect(counts.length).toBeLessThanOrEqual(WATCHES_PER_MINUTE);
    vi.advanceTimersByTime(61_000);
    hopper.say({ kind: 'spectate', code: DEMO_CODE });
    expect(errors(hopper)).toHaveLength(refused);
    expect(host.counts().spectators).toBe(1);
    manager.get(code).dispose();
    host.stop();
  });

  it('stays in the audience it had where the demo is full, and the log says so once', () => {
    const logged = vi.mocked(console.log);
    const host = new DemoHost(mission, [12]);
    const { line, manager, anna, code } = served(host);
    for (let i = 0; i < DEMO_MAX_WATCHING; i++) {
      watch(host);
    }
    const zoe = line.connect();
    zoe.say({ kind: 'spectate', code });
    for (let i = 0; i < 5; i++) {
      zoe.say({ kind: 'spectate', code: DEMO_CODE });
    }
    expect(errors(zoe)).toEqual(Array.from({ length: 5 }, () => DEMO_FULL));
    // Refused, it watches Anna's room still: it hears what her room's audience hears.
    const before = zoe.heard.length;
    anna.say({ kind: 'select-color', color: '#f472b6' });
    expect(zoe.heard.length).toBeGreaterThan(before);
    expect(manager.get(code).watching).toBe(1);
    const said = logged.mock.calls.map(([text]) => String(text));
    const refusals = said.filter((text) => text.includes('spectate') && text.includes('refused'));
    expect(refusals).toHaveLength(1);
    manager.get(code).dispose();
    host.stop();
  });

  it('fills no log under ever new names: its refusals are logged twenty times in all', () => {
    const logged = vi.mocked(console.log);
    const host = new DemoHost(mission, [12]);
    const { line, manager, code } = served(host);
    const stranger = line.connect();
    for (let i = 0; i < 500; i++) {
      stranger.say({ kind: 'join-room', code: 'NONE', name: `Gast ${i}`, pass: passFor('Zoe') });
    }
    expect(errors(stranger)).toHaveLength(500);
    const said = logged.mock.calls.map(([text]) => String(text));
    const refused = said.filter((text) => text.includes(' refused, '));
    expect(refused).toHaveLength(LOGGED_PER_SOCKET);
    expect(refused.at(-1)).toContain('the socket’s last refusal logged');
    expect(refused.at(0)).not.toContain('last refusal');
    manager.get(code).dispose();
    host.stop();
  });
});

describe('what the demo crew has in hand of a seat', () => {
  const NAMES = [
    'at',
    'drones',
    'dronesAt',
    'facing',
    'id',
    'lookAt',
    'map',
    'name',
    'press',
    'say',
    'stepTo',
    'view',
  ];

  it('is a frozen object of twelve names — what a page knows and does — and no other', () => {
    const hands = handsOf(new Seat({ send: () => undefined }));
    expect(Object.getOwnPropertyNames(hands).sort()).toEqual(NAMES);
    expect(Object.getOwnPropertySymbols(hands)).toEqual([]);
    expect(Object.isFrozen(hands)).toBe(true);
    expect(Object.getPrototypeOf(hands)).toBe(Object.prototype);
    expect(() => Object.assign(hands, { peek: () => null })).toThrow(TypeError);
    // Four of them do something, the other eight only read what the seat's line heard.
    const own = Object.values(Object.getOwnPropertyDescriptors(hands));
    expect(own.filter((name) => typeof name.value === 'function')).toHaveLength(4);
    expect(own.filter((name) => name.get !== undefined && name.set === undefined)).toHaveLength(8);
    expect(hands.view).toBeNull();
  });

  it('is what the host hands its crew, for both seats', () => {
    const host = new DemoHost(mission, [12]);
    const { seats } = host as unknown as { seats: CrewSeat[] };
    expect(seats).toHaveLength(2);
    for (const seat of seats) {
      expect(Object.getOwnPropertyNames(seat).sort()).toEqual(NAMES);
      expect(Object.isFrozen(seat)).toBe(true);
    }
    const { crew } = host as unknown as { crew: { seats: CrewSeat[] } };
    expect(crew.seats[0]).toBe(seats[0]);
    expect(crew.seats[1]).toBe(seats[1]);
    host.stop();
  });
});

describe('a crew that starts over', () => {
  it('waits a moment before each new start: it says what went wrong no oftener', () => {
    // A view that names a station up whose console it does not show: nothing to walk to.
    const view = {
      phase: 'playing',
      startedAt: 1,
      lights: { out: true, outAt: 1 },
      you: { id: 'a', name: 'HCW Bachelor', isHost: true, ready: false },
      map: {
        tiles: ['###', '#.#', '###'],
        yourSpawn: { x: 1, y: 1 },
        doors: [],
        plates: [],
        decor: [],
        manuals: [],
        items: [],
        exit: null,
        sabotage: null,
        stations: [
          { puzzleId: 'notlicht', x: 1, y: 1, console: 'a', known: true, status: 'armed' },
        ],
      },
    };
    const complaints: string[] = [];
    const seats = [0, 1].map(() => {
      const seat = new Seat({ send: () => undefined });
      seat.hear({ kind: 'view', view: view as never, at: 0 });
      return handsOf(seat);
    }) as [CrewSeat, CrewSeat];
    const crew = new DemoCrew(mission, seats, (why) => void complaints.push(why));
    for (let now = 0; now < 15_000; now += 80) {
      crew.tick(now);
    }
    expect(complaints.length).toBeGreaterThan(5);
    expect(complaints.length).toBeLessThanOrEqual(11);
    expect(new Set(complaints)).toEqual(new Set(['the view shows no console of "notlicht"']));
  });
});
