import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHAT_PHRASE_COUNT,
  DEFAULT_CHAT_PHRASES,
  parseClientMessage,
  parseMission,
  phraseShown,
  phrasesOf,
  sayPhrase,
  SERVICES,
  slotValues,
  viewFor,
} from '../src/index.js';
import { labMission, started } from './lab.js';

/**
 * The quick chat (chat.ts): eight phrases a mission names — or the default list — each with one
 * slot at most, `{n}` for a number from 1 to 9 or `{name}` for one of its names, filled as it is
 * said; a client names a phrase by its place, the server passes it on as said.
 */

/** A lab whose quick chat holds `phrases`, as a mission file writes them. */
function labWith(phrases: object[]) {
  const lab = labMission([{ type: 'wiring', id: 'kabel', title: 'Kabel' }]);
  return parseMission({ ...JSON.parse(JSON.stringify(lab)), chat: { phrases } });
}

/** Seven everyday phrases and `last`: a list as long as the wheel. */
const withLast = (last: object): object[] => [
  ...DEFAULT_CHAT_PHRASES.slice(0, CHAT_PHRASE_COUNT - 1),
  last,
];

const blackout = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

describe('a mission’s quick chat', () => {
  it('keeps today’s eight phrases for a mission that names none', () => {
    expect(phrasesOf(undefined).map((phrase) => phrase.text)).toEqual([
      'Hier rüber!',
      'Warte kurz …',
      'Bereit!',
      'Brauche eine Ansage!',
      'Ich halte die Platte',
      'Achtung, Drohne!',
      'Alle an die Ventile!',
      'Bei mir ist fertig',
    ]);
  });

  it('takes exactly eight phrases', () => {
    expect(() => labWith(DEFAULT_CHAT_PHRASES.slice(0, 7))).toThrow(/holds 8 phrases/);
    expect(() => labWith([...DEFAULT_CHAT_PHRASES, { text: 'Noch eins' }])).toThrow(
      /holds 8 phrases/,
    );
    expect(labWith(withLast({ text: 'Kabel {n}' })).chat?.phrases).toHaveLength(8);
  });

  it('takes one slot a phrase, {n} or {name} with its names, and nothing else in braces', () => {
    const refused: [object, RegExp][] = [
      [{ text: 'Raum {raum}' }, /a slot is \{n\} or \{name\}/],
      [{ text: 'Kabel {n} an {n}' }, /one slot a phrase at most/],
      [{ text: 'Dienst {name}' }, /come together or not at all/],
      [{ text: 'Dienst', names: ['DNS', 'WEB'] }, /come together or not at all/],
      [{ text: 'Dienst {name}', names: ['DNS'] }, /too_small|>=2|at least/i],
      [{ text: 'Dienst {name}', names: ['DNS', 'DNS'] }, /the names have to differ/],
      [{ text: 'Eine viel zu lange Zeile {n}' }, /24 characters at most/],
      [{ text: 'Dienst {name}', names: ['DNS', 'VERWALTUNG'] }, /too_big|<=8|at most/i],
    ];
    for (const [last, why] of refused) {
      expect(() => labWith(withLast(last)), JSON.stringify(last)).toThrow(why);
    }
    const named = { text: 'Dienst {name}', names: ['DNS', 'WEB'] };
    expect(labWith(withLast(named)).chat?.phrases.at(-1)).toEqual(named);
  });
});

describe('a phrase with a slot', () => {
  const wire = { text: 'Kabel {n}' };
  const service = { text: 'Dienst {name}', names: ['NETZ', 'DNS', 'DB'] };

  it('takes a number from 1 to 9 for {n}, and one of its names for {name}', () => {
    expect(slotValues(wire)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(slotValues(service)).toEqual(['NETZ', 'DNS', 'DB']);
    expect(slotValues({ text: 'Bereit!' })).toEqual([]);
  });

  it('is said filled in, and refused with a value its slot does not take', () => {
    expect(sayPhrase(wire, '3')).toBe('Kabel 3');
    expect(sayPhrase(service, 'DNS')).toBe('Dienst DNS');
    expect(sayPhrase({ text: 'Bereit!' }, undefined)).toBe('Bereit!');
    expect(() => sayPhrase(wire, '0')).toThrow('„Kabel …" nimmt nur 1, 2, 3, 4, 5, 6, 7, 8, 9.');
    expect(() => sayPhrase(wire, '10')).toThrow(/nimmt nur/);
    expect(() => sayPhrase(wire, undefined)).toThrow(/nimmt nur/);
    expect(() => sayPhrase(service, 'WEB')).toThrow('„Dienst …" nimmt nur NETZ, DNS, DB.');
    expect(() => sayPhrase({ text: 'Bereit!' }, '3')).toThrow(/keine Lücke/);
  });

  it('shows its slot as „…" until it is filled', () => {
    expect(phraseShown(wire)).toBe('Kabel …');
    expect(phraseShown(service)).toBe('Dienst …');
    expect(phraseShown({ text: 'Bereit!' })).toBe('Bereit!');
  });
});

describe('Blackout’s quick chat', () => {
  const phrases = blackout.chat?.phrases ?? [];

  it('names no valves, which the lab has none of', () => {
    expect(phrases).toHaveLength(CHAT_PHRASE_COUNT);
    expect(phrases.filter((phrase) => /Ventil/.test(phrase.text))).toEqual([]);
  });

  it('carries a wire by its number and a service by its name', () => {
    expect(phrases.map(phraseShown).slice(-2)).toEqual(['Kabel …', 'Dienst …']);
    const service = phrases.find((phrase) => phrase.text === 'Dienst {name}');
    expect(service?.names).toEqual(SERVICES.map((name) => name.toUpperCase()));
  });

  it('keeps every plain phrase in the first places, where the wheel says them at once', () => {
    const slotted = phrases.map((phrase) => slotValues(phrase).length > 0);
    expect(slotted).toEqual([false, false, false, false, false, false, true, true]);
  });
});

describe('the quick chat in a view and on the wire', () => {
  it('reaches every view as the mission names it, or as the default list', () => {
    const own = withLast({ text: 'Kabel {n}' });
    expect(viewFor(started(labWith(own)), 'p1').chat).toEqual(own);
    const plain = labMission([{ type: 'wiring', id: 'kabel', title: 'Kabel' }]);
    expect(viewFor(started(plain), 'p1').chat).toEqual(DEFAULT_CHAT_PHRASES);
  });

  it('names a phrase by its place in the list, a slot’s value beside it', () => {
    const said = (msg: object) => () => parseClientMessage(JSON.stringify(msg));
    expect(said({ kind: 'chat', phrase: 6, value: '3' })()).toEqual({
      kind: 'chat',
      phrase: 6,
      value: '3',
    });
    expect(said({ kind: 'chat', phrase: 0 })()).toEqual({ kind: 'chat', phrase: 0 });
    for (const wrong of [{ phrase: 8 }, { phrase: -1 }, { phrase: 1.5 }, { phrase: 'hier' }]) {
      expect(said({ kind: 'chat', ...wrong }), JSON.stringify(wrong)).toThrow();
    }
    expect(said({ kind: 'chat', phrase: 7, value: '' })).toThrow();
    expect(said({ kind: 'chat', phrase: 7, value: 'X'.repeat(17) })).toThrow();
  });
});
