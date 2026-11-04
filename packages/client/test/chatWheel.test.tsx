import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_PHRASES, parseMission } from '@escapelab/core';
import {
  ChatWheel,
  PHRASES,
  pickPhrase,
  pressDigit,
  type Wheel,
  type WheelMove,
} from '../src/world/ChatWheel.js';
import { elementsOf, press, type Rendered } from './probe.js';

/**
 * The quick chat's wheel (world/ChatWheel.tsx): the mission's phrases, the digits saying them,
 * and for a phrase with a slot a second step whose digits — or the D-pad and A, which press the
 * focused choice — fill it.
 */

const blackout = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);
const phrases = blackout.chat?.phrases ?? [];
/** Where Blackout's wheel holds „Kabel {n}" and „Dienst {name}", from 0. */
const WIRE = 6;
const SERVICE = 7;

/** The words of a wheel's markup, its digits' chips kept apart: „1 Hier rüber!". */
function wordsOf(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) =>
    (match[1] ?? '').replace(/<span class="chat-key">(\d)<\/span>/, '$1 '),
  );
}

/** The wheel standing at `wheel`, every press it would carry out kept in `moves`. */
function wheelAt(wheel: NonNullable<Wheel>, moves: WheelMove[] = []) {
  const render = () => (
    <ChatWheel phrases={phrases} wheel={wheel} onMove={(move) => moves.push(move)} />
  );
  return { html: renderToStaticMarkup(render()), elements: elementsOf(render), moves };
}

/** The wheel's choices, in order: what the D-pad moves between and A presses. */
const choices = (elements: readonly Rendered[]): Rendered[] =>
  elements.filter((element) => element.type === 'button' && element.props['role'] === 'menuitem');

describe('the digits in the chat wheel', () => {
  it('say a phrase without a slot at once, and shut the wheel', () => {
    expect(pressDigit(phrases, null, 1)).toEqual({ said: { phrase: 0 }, wheel: null });
    expect(pressDigit(phrases, PHRASES, 6)).toEqual({ said: { phrase: 5 }, wheel: null });
  });

  it('open the second step of a phrase with a slot, open or shut as the wheel was', () => {
    for (const wheel of [null, PHRASES]) {
      const opened = { said: null, wheel: { slotOf: WIRE } };
      expect(pressDigit(phrases, wheel, WIRE + 1)).toEqual(opened);
    }
  });

  it('fill the slot on the second step: 1–9 a wire’s number, a service by its place', () => {
    const wire = { slotOf: WIRE };
    const wireSaid = (value: string) => ({ said: { phrase: WIRE, value }, wheel: null });
    expect(pressDigit(phrases, wire, 3)).toEqual(wireSaid('3'));
    expect(pressDigit(phrases, wire, 9)).toEqual(wireSaid('9'));
    const service = { slotOf: SERVICE };
    expect(pressDigit(phrases, service, 2)).toEqual({
      said: { phrase: SERVICE, value: 'DNS' },
      wheel: null,
    });
  });

  it('keep every digit for the second step, one past its names picking nothing', () => {
    const service = { slotOf: SERVICE };
    expect(pressDigit(phrases, service, 9)).toEqual({ said: null, wheel: service });
  });

  it('say nothing more for a digit held down: its repeat does not fill the slot it opened', () => {
    const opened = pressDigit(phrases, null, WIRE + 1);
    expect(opened).toEqual({ said: null, wheel: { slotOf: WIRE } });
    const wire = { slotOf: WIRE };
    expect(pressDigit(phrases, wire, WIRE + 1, true)).toEqual({ said: null, wheel: wire });
    expect(pressDigit(phrases, null, 1, true)).toEqual({ said: null, wheel: null });
  });

  it('leave a digit past the phrases alone, the wheel shut or open', () => {
    expect(pressDigit(phrases, null, 9)).toBeNull();
    expect(pressDigit(phrases, PHRASES, 9)).toBeNull();
  });

  it('say the default list’s phrases at once: none of them has a slot', () => {
    for (let place = 0; place < DEFAULT_CHAT_PHRASES.length; place++) {
      expect(pickPhrase(DEFAULT_CHAT_PHRASES, place)?.said).toEqual({ phrase: place });
    }
  });
});

describe('the chat wheel as it shows', () => {
  it('lists the phrases with their digits, a slot as „…" opening a second step', () => {
    const { html } = wheelAt(PHRASES as NonNullable<Wheel>);
    expect(html.startsWith('<div class="chat-wheel" role="menu">')).toBe(true);
    expect(wordsOf(html)).toEqual([
      '1 Hier rüber!',
      '2 Warte kurz …',
      '3 Bereit!',
      '4 Brauche eine Ansage!',
      '5 Ich halte die Platte',
      '6 Achtung, Drohne!',
      '7 Kabel …',
      '8 Dienst …',
    ]);
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(2);
  });

  it('shows the second step as the phrase will say it, every value with its digit', () => {
    const wire = wheelAt({ slotOf: WIRE }).html;
    const step = '<div class="chat-wheel chat-wheel--slot" role="menu" aria-label="Kabel …">';
    expect(wire.startsWith(step)).toBe(true);
    expect(wordsOf(wire)).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => `${n} Kabel ${n}`),
    );
    expect(wordsOf(wheelAt({ slotOf: SERVICE }).html)).toEqual([
      '1 Dienst NETZ',
      '2 Dienst DNS',
      '3 Dienst DB',
      '4 Dienst AUTH',
      '5 Dienst WEB',
      '6 Dienst MAIL',
    ]);
  });
});

describe('the chat wheel under a controller’s A', () => {
  it('opens the second step from a phrase with a slot, and says nothing yet', () => {
    const { elements, moves } = wheelAt(PHRASES as NonNullable<Wheel>);
    press(choices(elements)[WIRE]);
    expect(moves).toEqual([{ said: null, wheel: { slotOf: WIRE } }]);
  });

  it('says the value pressed on the second step, and shuts the wheel', () => {
    const { elements, moves } = wheelAt({ slotOf: WIRE });
    press(choices(elements)[2]);
    expect(moves).toEqual([{ said: { phrase: WIRE, value: '3' }, wheel: null }]);
  });

  it('says a plain phrase at once', () => {
    const { elements, moves } = wheelAt(PHRASES as NonNullable<Wheel>);
    press(choices(elements)[1]);
    expect(moves).toEqual([{ said: { phrase: 1 }, wheel: null }]);
  });
});
