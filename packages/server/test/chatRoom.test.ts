import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { passFor } from './passes.js';

/**
 * The quick chat in a room: a phrase named by its place in the mission's list, its slot
 * filled in, goes to everybody as said; a place or a value the mission does not have goes
 * nowhere and leaves the sender's cooldown as it was.
 */

const blackout = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);
const tutorial = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);

/** The place of the phrase written `text` in the mission's own list. */
function placeOf(mission: Mission, text: string): number {
  const place = mission.chat?.phrases.findIndex((phrase) => phrase.text === text) ?? -1;
  if (place < 0) {
    throw new Error(`${mission.id} has no phrase "${text}"`);
  }
  return place;
}

function joined(mission: Mission) {
  const room = new Room('TEST', mission);
  const listen = (messages: ServerMessage[]) => (m: ServerMessage) => messages.push(m);
  const anna = { ...room.join('Anna', passFor('Anna')), messages: [] as ServerMessage[] };
  const ben = { ...room.join('Ben', passFor('Ben')), messages: [] as ServerMessage[] };
  room.attach(anna.playerId, listen(anna.messages));
  room.attach(ben.playerId, listen(ben.messages));
  return { room, anna, ben };
}

/** The chat lines `messages` holds, as `who: text`. */
const heard = (messages: ServerMessage[], names: Record<string, string>): string[] =>
  messages.flatMap((m) => (m.kind === 'chat' ? [`${names[m.playerId]}: ${m.text}`] : []));

describe('Room quick chat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('says a phrase to everybody with its slot filled in: „Nummer 3", „Dienst DNS"', () => {
    const { room, anna, ben } = joined(blackout);
    const names = { [anna.playerId]: 'Anna', [ben.playerId]: 'Ben' };
    room.chat(anna.playerId, placeOf(blackout, 'Nummer {n}'), '3');
    vi.advanceTimersByTime(1500);
    room.chat(ben.playerId, placeOf(blackout, 'Dienst {name}'), 'DNS');
    room.chat(anna.playerId, 0, undefined);
    expect(heard(ben.messages, names)).toEqual([
      'Anna: Nummer 3',
      'Ben: Dienst DNS',
      'Anna: Hier rüber!',
    ]);
    expect(heard(anna.messages, names)).toEqual(heard(ben.messages, names));
    room.dispose();
  });

  it('refuses a value the slot does not take, says nothing and keeps the cooldown free', () => {
    const { room, anna, ben } = joined(blackout);
    const wire = placeOf(blackout, 'Nummer {n}');
    expect(() => room.chat(anna.playerId, wire, '0')).toThrow('„Nummer …" nimmt nur');
    expect(() => room.chat(anna.playerId, wire, undefined)).toThrow('nimmt nur');
    expect(() => room.chat(anna.playerId, 0, '3')).toThrow('keine Lücke');
    expect(() => room.chat(anna.playerId, 8, undefined)).toThrow(
      'Diesen Schnellchat gibt es nicht.',
    );
    expect(heard(ben.messages, {})).toEqual([]);
    room.chat(anna.playerId, wire, '9');
    expect(ben.messages.filter((m) => m.kind === 'chat')).toHaveLength(1);
    room.dispose();
  });

  it('keeps the default list for a mission that names none, valves and all', () => {
    expect(tutorial.chat).toBeUndefined();
    const { room, anna, ben } = joined(tutorial);
    room.chat(anna.playerId, 6, undefined);
    const said = heard(ben.messages, { [anna.playerId]: 'Anna' });
    expect(said).toEqual(['Anna: Alle an die Ventile!']);
    room.dispose();
  });
});

describe('Room typed lines', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes a line on tidied, with its sender, to the crew and the audience alike', () => {
    const { room, anna, ben } = joined(blackout);
    const audience: ServerMessage[] = [];
    room.attachSpectator((m) => audience.push(m));
    room.say(anna.playerId, '  Bin   am Pult B ');
    const line = { kind: 'chat', playerId: anna.playerId, text: 'Bin am Pult B' };
    for (const messages of [anna.messages, ben.messages, audience]) {
      expect(messages.filter((m) => m.kind === 'chat')).toEqual([line]);
    }
    room.dispose();
  });

  it('refuses an empty line, one over 120 characters, and one from outside the crew', () => {
    const { room, anna, ben } = joined(blackout);
    expect(() => room.say(anna.playerId, ' \n ')).toThrow('leere Nachricht');
    expect(() => room.say(anna.playerId, 'x'.repeat(121))).toThrow('Höchstens 120 Zeichen');
    expect(() => room.say('audience-1', 'Hallo')).toThrow('nur die Crew');
    expect(ben.messages.filter((m) => m.kind === 'chat')).toEqual([]);
    room.say(anna.playerId, 'x'.repeat(120));
    expect(ben.messages.filter((m) => m.kind === 'chat')).toHaveLength(1);
    room.dispose();
  });

  it('holds each sender to three lines at once and one every 2 s after, and says so', () => {
    const { room, anna, ben } = joined(blackout);
    for (const text of ['eins', 'zwei', 'drei']) {
      room.say(anna.playerId, text);
    }
    expect(() => room.say(anna.playerId, 'vier')).toThrow('Nicht so schnell');
    // Ben's allowance is his own.
    room.say(ben.playerId, 'ich auch');
    vi.advanceTimersByTime(1900);
    expect(() => room.say(anna.playerId, 'vier')).toThrow('Nicht so schnell');
    vi.advanceTimersByTime(200);
    room.say(anna.playerId, 'vier');
    const names = { [anna.playerId]: 'Anna', [ben.playerId]: 'Ben' };
    expect(heard(ben.messages, names)).toEqual([
      'Anna: eins',
      'Anna: zwei',
      'Anna: drei',
      'Ben: ich auch',
      'Anna: vier',
    ]);
    room.dispose();
  });
});
