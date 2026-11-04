import { useEffect, useRef } from 'react';
import { phraseShown, sayPhrase, slotValues, type ChatPhrase } from '@escapelab/core';
import { inputDevice } from '../input/device.js';

/**
 * The quick chat's wheel over the world: the mission's eight phrases (core chat.ts), and for a
 * phrase with a slot a second step that fills it — „Kabel 1" to „Kabel 9", „Dienst NETZ" and so
 * on. The digits 1–8 say a phrase, or open the second step of one with a slot, where 1–9 pick
 * the value; a click, a touch, or the D-pad and A do the same, the first choice of each step
 * in the focus where a controller opened it. Esc and B shut it from either step.
 */

/** Where the wheel stands: shut (null), open on its phrases, or on the slot of `slotOf`. */
export type Wheel = { slotOf: number | null } | null;

/** The wheel open on its phrases. */
export const PHRASES: Wheel = { slotOf: null };

/** A phrase said: its place in the mission's list, and its slot's value where it has one. */
export interface Said {
  phrase: number;
  value?: string;
}

/** What a press in the wheel comes to: the phrase it says, if any, and where the wheel stands. */
export interface WheelMove {
  said: Said | null;
  wheel: Wheel;
}

/** The phrase at `index` picked: said, the wheel shut — or, with a slot, its second step. */
export function pickPhrase(phrases: readonly ChatPhrase[], index: number): WheelMove | null {
  const phrase = phrases[index];
  if (phrase === undefined) {
    return null;
  }
  return slotValues(phrase).length > 0
    ? { said: null, wheel: { slotOf: index } }
    : { said: { phrase: index }, wheel: null };
}

/** The slot of the phrase at `index` filled with `value`: said, and the wheel shut. */
export function pickValue(index: number, value: string): WheelMove {
  return { said: { phrase: index, value }, wheel: null };
}

/**
 * What the digit `digit` (1–9) does where the wheel stands: on a slot's second step it picks
 * the value in that place — every digit is the step's while it is up, one past its values
 * picking nothing —, elsewhere it picks the phrase in that place. A digit held down (`repeat`)
 * picks nothing more: its auto-repeat would fill the slot it had just opened. Null where the
 * digit is no phrase's: the wheel leaves the key alone.
 */
export function pressDigit(
  phrases: readonly ChatPhrase[],
  wheel: Wheel,
  digit: number,
  repeat = false,
): WheelMove | null {
  const slotOf = wheel?.slotOf ?? null;
  const move =
    slotOf === null ? pickPhrase(phrases, digit - 1) : pickSlotValue(phrases, slotOf, digit);
  return move === null || !repeat ? move : { said: null, wheel };
}

/** The value in place `digit` of the slot of the phrase at `slotOf`, said; past them, nothing. */
function pickSlotValue(phrases: readonly ChatPhrase[], slotOf: number, digit: number): WheelMove {
  const phrase = phrases[slotOf];
  const value = phrase === undefined ? undefined : slotValues(phrase)[digit - 1];
  return value === undefined ? { said: null, wheel: { slotOf } } : pickValue(slotOf, value);
}

interface WheelProps {
  phrases: readonly ChatPhrase[];
  /** where the open wheel stands */
  wheel: NonNullable<Wheel>;
  /** carries a press out: says the phrase, moves the wheel on */
  onMove: (move: WheelMove) => void;
}

/**
 * The open wheel: its phrases with the digit that says each — a slot shown as „…" until it is
 * filled — or the second step, every value of the slot as the phrase will say it.
 */
export function ChatWheel({ phrases, wheel, onMove }: WheelProps) {
  const first = useRef<HTMLButtonElement>(null);
  const step = wheel.slotOf;
  useEffect(() => {
    if (inputDevice().device === 'pad') {
      first.current?.focus();
    }
  }, [step]);
  const slotted = step === null ? undefined : phrases[step];
  if (step === null || slotted === undefined) {
    return (
      <div className="chat-wheel" role="menu">
        {phrases.map((phrase, i) => {
          const move = pickPhrase(phrases, i);
          return (
            <button
              key={`${i}:${phrase.text}`}
              ref={i === 0 ? first : undefined}
              role="menuitem"
              aria-haspopup={move?.said === null ? 'menu' : undefined}
              onClick={() => move !== null && onMove(move)}
            >
              <span className="chat-key">{i + 1}</span>
              {phraseShown(phrase)}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="chat-wheel chat-wheel--slot" role="menu" aria-label={phraseShown(slotted)}>
      {slotValues(slotted).map((value, i) => (
        <button
          key={value}
          ref={i === 0 ? first : undefined}
          role="menuitem"
          onClick={() => onMove(pickValue(step, value))}
        >
          <span className="chat-key">{i + 1}</span>
          {sayPhrase(slotted, value)}
        </button>
      ))}
    </div>
  );
}
