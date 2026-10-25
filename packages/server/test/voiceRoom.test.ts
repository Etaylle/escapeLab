import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseClientMessage,
  parseMission,
  RTC_SIGNAL_MAX,
  type RtcSignal,
  type ServerMessage,
} from '@escapelab/core';
import { Room } from '../src/room.js';

/** A crew of four: room enough for one player who only listens to the others. */
const MISSION_FILE = new URL('../../../missions/doppelschicht.json', import.meta.url);
const mission = parseMission(JSON.parse(readFileSync(MISSION_FILE, 'utf8')));

/** One connection to the room: its id and everything pushed to it. */
interface Member {
  id: string;
  messages: ServerMessage[];
}

function player(room: Room, name: string): Member & { detach: () => void } {
  const { playerId } = room.join(name);
  const messages: ServerMessage[] = [];
  const detach = room.attach(playerId, (m) => messages.push(m));
  return { id: playerId, messages, detach };
}

function spectator(room: Room): Member & { detach: () => void } {
  const messages: ServerMessage[] = [];
  const { spectatorId, detach } = room.attachSpectator((m) => messages.push(m));
  return { id: spectatorId, messages, detach };
}

/** The voice signals a member received. */
const signals = (member: Member): ServerMessage[] =>
  member.messages.filter((m) => m.kind === 'rtc');

const offer: RtcSignal = { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' };
const ice: RtcSignal = {
  type: 'ice',
  candidate: { candidate: 'candidate:1 1 udp 1 192.168.1.20 5000 typ host', sdpMid: '0' },
};

describe('voice signals in a room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reach the player they name, stamped with their sender, and nobody else', () => {
    const room = new Room('TEST', mission);
    const [anna, ben, carla] = [player(room, 'Anna'), player(room, 'Ben'), player(room, 'Carla')];
    const zoe = spectator(room);
    expect(room.relaySignal(anna.id, ben.id, offer)).toBe(true);
    expect(room.relaySignal(ben.id, anna.id, ice)).toBe(true);
    expect(signals(ben)).toEqual([{ kind: 'rtc', from: anna.id, signal: offer }]);
    expect(signals(anna)).toEqual([{ kind: 'rtc', from: ben.id, signal: ice }]);
    expect(signals(carla)).toEqual([]);
    expect(signals(zoe)).toEqual([]);
  });

  it('go nowhere for nobody in the room: an unknown id, the sender, another room', () => {
    const room = new Room('TEST', mission);
    const other = new Room('ELSE', mission);
    const [anna, ben] = [player(room, 'Anna'), player(room, 'Ben')];
    const dora = player(other, 'Dora');
    expect(room.relaySignal(anna.id, 'nobody', offer)).toBe(false);
    expect(room.relaySignal(anna.id, anna.id, offer)).toBe(false);
    expect(room.relaySignal(anna.id, dora.id, offer)).toBe(false);
    expect(other.relaySignal(dora.id, anna.id, offer)).toBe(false);
    expect([anna, ben, dora].flatMap(signals)).toEqual([]);
  });

  it('go nowhere from or to a player whose connection is gone', () => {
    const room = new Room('TEST', mission);
    const [anna, ben] = [player(room, 'Anna'), player(room, 'Ben')];
    ben.detach();
    expect(room.relaySignal(anna.id, ben.id, offer)).toBe(false);
    expect(room.relaySignal(ben.id, anna.id, offer)).toBe(false);
    expect([anna, ben].flatMap(signals)).toEqual([]);
  });

  it('let a spectator reach the players of its room to listen in, and them answer it', () => {
    const room = new Room('TEST', mission);
    const anna = player(room, 'Anna');
    const zoe = spectator(room);
    expect(room.relaySignal(zoe.id, anna.id, offer)).toBe(true);
    expect(room.relaySignal(anna.id, zoe.id, ice)).toBe(true);
    expect(signals(anna)).toEqual([{ kind: 'rtc', from: zoe.id, signal: offer }]);
    expect(signals(zoe)).toEqual([{ kind: 'rtc', from: anna.id, signal: ice }]);
    zoe.detach();
    expect(room.relaySignal(zoe.id, anna.id, offer)).toBe(false);
    expect(room.relaySignal(anna.id, zoe.id, ice)).toBe(false);
  });

  it('refuse a spectator’s signal for another spectator, or for a player of another room', () => {
    const room = new Room('TEST', mission);
    const other = new Room('ELSE', mission);
    const [zoe, yann] = [spectator(room), spectator(room)];
    const dora = player(other, 'Dora');
    expect(zoe.id).not.toBe(yann.id);
    expect(room.relaySignal(zoe.id, yann.id, offer)).toBe(false);
    expect(room.relaySignal(zoe.id, dora.id, offer)).toBe(false);
    expect(other.relaySignal(zoe.id, dora.id, offer)).toBe(false);
    expect([zoe, yann, dora].flatMap(signals)).toEqual([]);
  });

  it('never let a spectator pass for a talk source: it goes by an id the server stamps', () => {
    const room = new Room('TEST', mission);
    const [anna, ben] = [player(room, 'Anna'), player(room, 'Ben')];
    const zoe = spectator(room);
    // No player has its id: a player's page plays the links of the crew, an audience's never.
    expect(zoe.id).toMatch(/^audience-/);
    expect([anna.id, ben.id]).not.toContain(zoe.id);
    // A sender a spectator names itself does not survive the wire; the server stamps its own.
    const forged = parseClientMessage(
      JSON.stringify({ kind: 'rtc', to: anna.id, from: ben.id, signal: offer }),
    );
    expect(forged).toEqual({ kind: 'rtc', to: anna.id, signal: offer });
    if (forged.kind !== 'rtc') {
      throw new Error('expected a voice signal');
    }
    room.relaySignal(zoe.id, forged.to, forged.signal);
    expect(signals(anna)).toEqual([{ kind: 'rtc', from: zoe.id, signal: offer }]);
  });

  it('hold a spectator to the same allowance as a player', () => {
    const room = new Room('TEST', mission);
    const anna = player(room, 'Anna');
    const zoe = spectator(room);
    const burst = Array.from({ length: 61 }, () => room.relaySignal(zoe.id, anna.id, ice));
    expect(burst.filter(Boolean)).toHaveLength(60);
    expect(burst.at(-1)).toBe(false);
  });

  it('come 60 at once from one member, then 10 a second, like chat dropping what is over', () => {
    const room = new Room('TEST', mission);
    const [anna, ben] = [player(room, 'Anna'), player(room, 'Ben')];
    const burst = Array.from({ length: 61 }, () => room.relaySignal(anna.id, ben.id, ice));
    expect(burst.filter(Boolean)).toHaveLength(60);
    expect(burst.at(-1)).toBe(false);
    // Every member has an allowance of their own.
    expect(room.relaySignal(ben.id, anna.id, ice)).toBe(true);
    vi.advanceTimersByTime(1000);
    const next = Array.from({ length: 11 }, () => room.relaySignal(anna.id, ben.id, ice));
    expect(next.filter(Boolean)).toHaveLength(10);
    expect(signals(ben)).toHaveLength(70);
  });

  it('weigh 16 kB at most: the server takes a heavier one off the wire unread', () => {
    const signal = { type: 'offer', sdp: 'x'.repeat(RTC_SIGNAL_MAX) };
    const heavy = JSON.stringify({ kind: 'rtc', to: 'ben', signal });
    expect(() => parseClientMessage(heavy)).toThrow(/Unbekanntes Nachrichtenformat/);
  });
});
