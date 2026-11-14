import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, initialState, parseMission } from '@escapelab/core';
import type { Action, GameState, MapDef, Mission, ServerMessage } from '@escapelab/core';
import { DronePatrol } from '../src/drones.js';
import { Room } from '../src/room.js';
import { open, roomKey, seal } from '../src/seal.js';
import { pressE, walkTo, type Walker } from './walk.js';
import { passFor } from './passes.js';

const KEY = roomKey({ ROOM_SECRET: 'feed'.repeat(16) }).key;

/**
 * Corridor with three stations along its top row; its emergencies run in
 * relay mode — no valves anywhere. The bottom row is out of every station's
 * reach.
 */
const mission: Mission = parseMission({
  id: 'relayroom',
  title: 'Relais-Raum',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 900,
  players: { min: 2, max: 2 },
  puzzles: ['first', 'second', 'third'].map((id) => ({ type: 'button-sync', id, title: id })),
  map: {
    tiles: ['#########', '#.......#', '#.......#', '#.......#', '#########'],
    spawns: [
      { x: 3, y: 1 },
      { x: 5, y: 1 },
    ],
    stations: [
      { puzzleId: 'first', x: 2, y: 1 },
      { puzzleId: 'second', x: 4, y: 1 },
      { puzzleId: 'third', x: 6, y: 1 },
    ],
    exit: { x: 4, y: 2 },
    sabotage: {
      mode: 'relay',
      label: 'STEUERUNG SPINNT',
      hint: 'Anweisungen laut vorlesen!',
      firstAfterSec: 60,
      everySec: 120,
      durationSec: 40,
      penaltySec: 60,
      windowSec: 12,
      required: 4,
    },
  },
});

interface Member {
  playerId: string;
  messages: ServerMessage[];
}

function collector(): { messages: ServerMessage[]; listen: (m: ServerMessage) => void } {
  const messages: ServerMessage[] = [];
  return { messages, listen: (m) => messages.push(m) };
}

function lastView(messages: ServerMessage[]) {
  const last = messages.filter((m) => m.kind === 'view').at(-1);
  if (last === undefined || last.kind !== 'view') {
    throw new Error('expected a view message');
  }
  return last.view;
}

function running(member: Member): boolean {
  return (lastView(member.messages).map?.sabotage ?? null) !== null;
}

/**
 * What the crew does, read off the players' screens: whoever is named and
 * has the named control on their console performs the instruction.
 */
function callOuts(crew: Member[]): { playerId: string; input: unknown }[] {
  const consoles = crew.map(({ playerId, messages }) => {
    const view = lastView(messages);
    return { playerId, name: view.you.name, relay: view.map?.sabotage?.relay ?? null };
  });
  return consoles.flatMap(({ relay }) => {
    const wanted = relay?.instruction ?? null;
    for (const doer of consoles) {
      const control = doer.relay?.controls.find((c) => c.name === wanted?.control);
      if (wanted !== null && doer.name === wanted.playerName && control !== undefined) {
        const input = { kind: 'set', control: control.id, value: wanted.value };
        return [{ playerId: doer.playerId, input }];
      }
    }
    return [];
  });
}

function moveTo(room: Room, player: Walker, x: number, y: number): void {
  walkTo(room, player, x + 0.5, y + 0.5);
}

/** Lobby, mission start, and the two station solves that arm emergencies. */
function midMission() {
  const room = new Room('TEST', mission);
  const anna = { ...room.join('Anna', passFor('Anna')), ...collector() };
  const ben = { ...room.join('Ben', passFor('Ben')), ...collector() };
  room.attach(anna.playerId, anna.listen);
  room.attach(ben.playerId, ben.listen);
  room.setReady(ben.playerId, true);
  room.act(anna.playerId, { kind: 'start-mission' });
  for (const x of [2, 4]) {
    moveTo(room, ben, x, 1);
    moveTo(room, anna, x, 2);
    pressE(room, ben);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
  }
  return { room, anna, ben };
}

describe('Room relay emergencies', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires with a console and an instruction for everyone, and no valves', () => {
    const { room, anna, ben } = midMission();
    vi.advanceTimersByTime(61_000);
    for (const member of [anna, ben]) {
      const sabotage = lastView(member.messages).map?.sabotage;
      expect(sabotage?.panels).toEqual([]);
      expect(sabotage?.relay?.controls).toHaveLength(4);
      expect(sabotage?.relay?.instruction).not.toBeNull();
    }
    room.dispose();
  });

  it('is not cleared by anyone standing anywhere, nor does walking send views', () => {
    const { room, anna, ben } = midMission();
    vi.advanceTimersByTime(61_000);
    const walkTheRow = (): void => {
      for (const x of [1, 4, 7]) {
        moveTo(room, anna, x, 3);
        moveTo(room, ben, 8 - x, 3);
      }
    };
    // Once along the bottom row first: the armed station's console found on the way is news.
    walkTheRow();
    const views = (): number => anna.messages.filter((m) => m.kind === 'view').length;
    const before = views();
    walkTheRow();
    expect(running(anna)).toBe(true);
    expect(views()).toBe(before);
    room.dispose();
  });

  it('ages its instructions once a second, and charges the expiry when time is up', () => {
    const { room, anna } = midMission();
    vi.advanceTimersByTime(61_000);
    const first = lastView(anna.messages).map?.sabotage?.relay?.instruction?.expiresAt ?? 0;
    const before = lastView(anna.messages).deadlineAt ?? 0;
    vi.advanceTimersByTime(13_000);
    expect(lastView(anna.messages).map?.sabotage?.relay?.instruction?.expiresAt).toBeGreaterThan(
      first,
    );
    expect(lastView(anna.messages).penaltySeq).toBe(0);
    const during = anna.messages.length;
    vi.advanceTimersByTime(3000);
    expect(anna.messages.length).toBeGreaterThanOrEqual(during + 3);

    vi.advanceTimersByTime(25_000);
    const after = lastView(anna.messages);
    expect(after.map?.sabotage).toBeNull();
    expect(after.deadlineAt).toBe(before - 60_000);
    expect(after.penaltySeq).toBe(1);
    room.dispose();
  });

  it('ends the run once Ben gives it up mid-emergency: his seat free, nobody left on it', () => {
    const { room, anna, ben } = midMission();
    vi.advanceTimersByTime(61_000);
    expect(running(anna)).toBe(true);
    expect(room.abandon(passFor('Ben'))).toBe(ben.playerId);
    const view = lastView(anna.messages);
    expect(view.phase).toBe('lost');
    expect(view.calledOff).toBe('Ben hat den Einsatz verlassen.');
    expect(view.players.map((p) => p.name)).toEqual(['Anna']);
    expect(ben.messages.at(-1)).toEqual({ kind: 'left', code: 'TEST', message: null });
    expect(room.seatOf(passFor('Ben'))).toBeNull();
    // No ghost of Ben's left on the line: Anna alone, and her call-off finds the run over.
    expect(room.playersOnTheLine).toBe(1);
    const callOff = (): void => room.act(anna.playerId, { kind: 'call-off' });
    expect(callOff).toThrow('Nur während des Einsatzes.');
    room.dispose();
  });

  it('is cleared by the crew calling out instructions, and then stops ticking', () => {
    const { room, anna, ben } = midMission();
    vi.advanceTimersByTime(61_000);
    let inputs = 0;
    for (let round = 0; round < 10 && running(anna); round++) {
      for (const { playerId, input } of callOuts([anna, ben])) {
        if (running(anna)) {
          inputs += 1;
          room.act(playerId, { kind: 'puzzle-input', input });
        }
      }
      vi.advanceTimersByTime(1000);
    }
    expect(running(anna)).toBe(false);
    expect(inputs).toBe(4);
    expect(lastView(anna.messages).penaltySeq).toBe(0);
    // Nothing but the positions' keepalive goes out any more: no tick changes a view.
    const views = (): number => anna.messages.filter((m) => m.kind !== 'positions').length;
    const quiet = views();
    vi.advanceTimersByTime(5000);
    expect(views()).toBe(quiet);
    room.dispose();
  });
});

/** How long the server is down between the snapshot and the room taken up again, ms. */
const DOWNTIME_MS = 30_000;

/** `name`'s seat of `room` back on the line on a connection of its own, as its page resumes. */
function rejoin(room: Room, name: string): Member {
  const { messages, listen } = collector();
  const playerId = room.resume(passFor(name));
  room.attach(playerId, listen);
  return { playerId, messages };
}

/**
 * A relay emergency 5 s on, its room's snapshot sealed as the crew's lines drop with the server;
 * DOWNTIME_MS later the room taken up again from the blob opened and the crew back on the line in
 * it: the run goes on. Returns the room, its crew, and how long the emergency had left at the
 * snapshot.
 */
function restoredMidEmergency() {
  const { room, anna } = midMission();
  vi.advanceTimersByTime(66_000);
  expect(running(anna)).toBe(true);
  const at = Date.now();
  const blob = seal({ ...room.snapshot(at), instance: 'old', final: true }, room.code, KEY);
  room.dispose();
  const kept = open(blob, room.code, KEY);
  expect(kept.state.sabotage?.emergency).toMatchObject({ type: 'relay' });
  vi.advanceTimersByTime(DOWNTIME_MS);
  const again = Room.restore(kept, Date.now());
  const crew = [rejoin(again, 'Anna'), rejoin(again, 'Ben')] as const;
  expect(lastView(crew[0].messages).pausedAt).toBeNull();
  return { room: again, crew, left: (kept.state.sabotage?.endsAt ?? 0) - at };
}

/** When the instruction on `member`'s relay display runs out, epoch ms; 0 for none shown. */
const instructionEnds = (member: Member): number =>
  lastView(member.messages).map?.sabotage?.relay?.instruction?.expiresAt ?? 0;

describe('a relay emergency taken up again from a snapshot', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs on once the crew is back: its instructions age, it runs out and is charged', () => {
    const { room, crew, left } = restoredMidEmergency();
    const [anna] = crew;
    expect(running(anna)).toBe(true);
    const first = instructionEnds(anna);
    const deadline = lastView(anna.messages).deadlineAt ?? 0;
    vi.advanceTimersByTime(13_000);
    expect(instructionEnds(anna)).toBeGreaterThan(first);
    // What the emergency had left at the snapshot, from the moment the crew was back: on a
    // second before, over a second after, its expiry charged once.
    vi.advanceTimersByTime(left - 13_000 - 1000);
    expect(running(anna)).toBe(true);
    expect(lastView(anna.messages).penaltySeq).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(running(anna)).toBe(false);
    expect(lastView(anna.messages)).toMatchObject({ penaltySeq: 1, deadlineAt: deadline - 60_000 });
    room.dispose();
  });

  it('is cleared once the crew back calls its instructions out, uncharged', () => {
    const { room, crew } = restoredMidEmergency();
    const [anna] = crew;
    let inputs = 0;
    for (let round = 0; round < 10 && running(anna); round++) {
      for (const { playerId, input } of callOuts([...crew])) {
        if (running(anna)) {
          inputs += 1;
          room.act(playerId, { kind: 'puzzle-input', input });
        }
      }
      vi.advanceTimersByTime(1000);
    }
    expect(running(anna)).toBe(false);
    expect(inputs).toBe(4);
    expect(lastView(anna.messages).penaltySeq).toBe(0);
    room.dispose();
  });
});

describe('drones during a relay emergency', () => {
  /** A drone sweeps the left chamber's middle row, facing right (as in drones.test.ts). */
  const watched: Mission = parseMission({
    id: 'relaydrone',
    title: 'Relais-Drohne',
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 300,
    players: { min: 2, max: 2 },
    puzzles: [{ type: 'button-sync', id: 'only', title: 'Einziges' }],
    map: {
      tiles: ['#########', '#...#...#', '#...#...#', '#...#...#', '#########'],
      spawns: [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
      ],
      stations: [{ puzzleId: 'only', x: 2, y: 1 }],
      drones: [
        {
          id: 'wache',
          waypoints: [
            { x: 1, y: 2 },
            { x: 3, y: 2 },
          ],
          speed: 1,
          range: 6,
          halfAngleDeg: 30,
          penaltySec: 15,
        },
      ],
      sabotage: { mode: 'relay', label: 'STEUERUNG SPINNT' },
    },
  });
  const T0 = 1_000_000;

  it('cannot spot anyone while the crew works the consoles', () => {
    const actions: Action[] = [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
    ];
    const state: GameState = actions.reduce(applyAction, initialState(watched));
    const map: MapDef | undefined = watched.map;
    if (map === undefined) {
      throw new Error('fixture needs a map');
    }
    const inSight = new Map([['p1', { x: 3.5, y: 2.5 }]]);
    expect(new DronePatrol(map).detect(state, inSight, T0)).toHaveLength(1);
    const busy = applyAction(state, { type: 'sabotage-start', at: T0 + 1000 });
    expect(new DronePatrol(map).detect(busy, inSight, T0 + 1000)).toEqual([]);
  });
});
