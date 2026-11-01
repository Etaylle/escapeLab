import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type PlayerView, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';
import { serveSockets, type PlayerSocket } from '../src/sockets.js';
import { walkTo, type Walker } from './walk.js';

/**
 * Blackout: the Notlicht's lever at (11,7) in the Flur, armed once the lights have gone out,
 * `intro.lightsSec` in. Its Flur runs along rows 7 to 9.
 */
const blackout: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);
const LEVER = { x: 11.5, y: 7.5 };

function join(room: Room, name: string): Walker {
  const messages: ServerMessage[] = [];
  const player = { ...room.join(name), messages };
  room.attach(player.playerId, (m) => messages.push(m));
  return player;
}

function lastView(walker: Walker): PlayerView {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected a view');
  }
  return last.view;
}

/** Blackout for Anna and Ben, the lights out and the lever armed; Ben 1.9 tiles west of it. */
function atTheLever() {
  const room = new Room('TEST', blackout);
  const anna = join(room, 'Anna');
  const ben = join(room, 'Ben');
  room.setReady(ben.playerId, true);
  room.act(anna.playerId, { kind: 'start-mission' });
  vi.advanceTimersByTime((blackout.intro?.lightsSec ?? 0) * 1000 + 100);
  expect(lastView(ben).lights.out).toBe(true);
  walkTo(room, ben, LEVER.x - 1.9, LEVER.y);
  return { room, anna, ben };
}

describe('E judged where it was pressed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches the lever on from the spot pressed on, not from an update 80 ms old', () => {
    const { room, ben } = atTheLever();
    // the last update had him 1.9 tiles off; as the prompt showed he pressed at 1.45
    room.interact(ben.playerId, { x: LEVER.x - 1.45, y: LEVER.y }, 1_000);
    expect(lastView(ben).puzzle?.kind).toBe('button-sync');
    room.dispose();
  });

  it('judges where it had the player when the spot pressed on lies over half a tile off', () => {
    const { room, ben } = atTheLever();
    expect(() => room.interact(ben.playerId, { x: LEVER.x - 0.9, y: LEVER.y }, 1_000)).toThrow(
      /Zu weit weg/,
    );
    expect(lastView(ben).puzzle).toBeNull();
    room.dispose();
  });

  it('carries the spot pressed on to the crew as a sample, with its moment', () => {
    const { room, anna, ben } = atTheLever();
    room.interact(ben.playerId, { x: LEVER.x - 1.45, y: LEVER.y }, 4_321);
    vi.advanceTimersByTime(100);
    const positions = anna.messages.filter((m) => m.kind === 'positions').at(-1);
    expect(positions?.kind === 'positions' ? positions.players[ben.playerId] : null).toMatchObject(
      { x: LEVER.x - 1.45, y: LEVER.y, t: 4_321 },
    );
    room.dispose();
  });
});

/** A socket as the server sees one: what it was sent, and a way to say something. */
class Line {
  readonly heard: ServerMessage[] = [];
  private listener: ((data: unknown) => void) | null = null;
  readonly socket: PlayerSocket = {
    send: (data) => this.heard.push(JSON.parse(data) as ServerMessage),
    on: (event: 'message' | 'close', listener: ((data: unknown) => void) | (() => void)) => {
      if (event === 'message') {
        this.listener = listener as (data: unknown) => void;
      }
      return this.socket;
    },
  };

  say(msg: object): void {
    this.listener?.(Buffer.from(JSON.stringify(msg)));
  }
}

describe('E on the line', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers a press it took after the views it changed, and names what a refusal refuses', () => {
    const manager = new RoomManager();
    const connect: ((socket: PlayerSocket) => void)[] = [];
    serveSockets({ on: (_event, listener) => connect.push(listener) }, {
      catalog: { get: () => blackout, default: blackout },
      manager,
    });
    const [anna, ben] = [new Line(), new Line()];
    for (const line of [anna, ben]) {
      connect[0]?.(line.socket);
    }
    anna.say({ kind: 'create-room', name: 'Anna', missionId: blackout.id });
    const joined = anna.heard.find((m) => m.kind === 'joined');
    const code = joined?.kind === 'joined' ? joined.code : '';
    ben.say({ kind: 'join-room', code, name: 'Ben' });
    ben.say({ kind: 'set-ready', ready: true });
    anna.say({ kind: 'start-mission' });
    vi.advanceTimersByTime((blackout.intro?.lightsSec ?? 0) * 1000 + 100);
    // far from the lever: refused, and the refusal says it refuses the press
    ben.say({ kind: 'interact', x: 1.5, y: 8.5, t: 1 });
    expect(ben.heard.at(-1)).toMatchObject({ kind: 'error', of: 'interact' });
    const room = manager.get(code);
    const benJoined = ben.heard.find((m) => m.kind === 'joined');
    const benId = benJoined?.kind === 'joined' ? benJoined.playerId : '';
    walkTo(room, { playerId: benId, messages: ben.heard }, LEVER.x - 1, LEVER.y);
    ben.say({ kind: 'interact', x: LEVER.x - 1, y: LEVER.y, t: 2 });
    const tail = ben.heard.slice(-2);
    expect(tail[0]?.kind).toBe('view');
    expect(tail[1]).toEqual({ kind: 'interacted' });
    room.dispose();
  });
});
