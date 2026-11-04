import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';

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
  const anna = { ...room.join('Anna'), messages: [] as ServerMessage[] };
  const ben = { ...room.join('Ben'), messages: [] as ServerMessage[] };
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

  it('says a phrase to everybody with its slot filled in: „Kabel 3", „Dienst DNS"', () => {
    const { room, anna, ben } = joined(blackout);
    const names = { [anna.playerId]: 'Anna', [ben.playerId]: 'Ben' };
    room.chat(anna.playerId, placeOf(blackout, 'Kabel {n}'), '3');
    vi.advanceTimersByTime(1500);
    room.chat(ben.playerId, placeOf(blackout, 'Dienst {name}'), 'DNS');
    room.chat(anna.playerId, 0, undefined);
    expect(heard(ben.messages, names)).toEqual([
      'Anna: Kabel 3',
      'Ben: Dienst DNS',
      'Anna: Hier rüber!',
    ]);
    expect(heard(anna.messages, names)).toEqual(heard(ben.messages, names));
    room.dispose();
  });

  it('refuses a value the slot does not take, says nothing and keeps the cooldown free', () => {
    const { room, anna, ben } = joined(blackout);
    const wire = placeOf(blackout, 'Kabel {n}');
    expect(() => room.chat(anna.playerId, wire, '0')).toThrow('„Kabel …" nimmt nur');
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
