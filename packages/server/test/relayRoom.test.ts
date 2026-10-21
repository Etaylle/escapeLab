import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, initialState, parseMission } from '@escapelab/core';
import type { Action, GameState, MapDef, Mission, ServerMessage } from '@escapelab/core';
import { DronePatrol } from '../src/drones.js';
import { Room } from '../src/room.js';
import { walkTo, type Walker } from './walk.js';

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

describe('Room relay emergencies', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function moveTo(room: Room, player: Walker, x: number, y: number): void {
    walkTo(room, player, x + 0.5, y + 0.5);
  }

  /** Lobby, mission start, and the two station solves that arm emergencies. */
  function midMission() {
    const room = new Room('TEST', mission);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    for (const x of [2, 4]) {
      moveTo(room, ben, x, 1);
      moveTo(room, anna, x, 2);
      room.act(ben.playerId, { kind: 'interact' });
      room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
      room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
    }
    return { room, anna, ben };
  }

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
    moveTo(room, anna, 1, 3);
    moveTo(room, ben, 7, 3);
    const views = (): number => anna.messages.filter((m) => m.kind === 'view').length;
    const before = views();
    for (const x of [1, 4, 7]) {
      moveTo(room, anna, x, 3);
      moveTo(room, ben, 8 - x, 3);
    }
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
    const quiet = anna.messages.length;
    vi.advanceTimersByTime(5000);
    expect(anna.messages.length).toBe(quiet);
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
