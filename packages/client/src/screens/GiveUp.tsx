import { useEffect, useState } from 'react';

/**
 * „Einsatz aufgeben": the seat given up for good (core `abandon`). It takes a second press
 * within CONFIRM_MS; the first only asks.
 */

/** How long a first press waits for the second that confirms it, ms. */
export const CONFIRM_MS = 4000;

/** What a press does at `now`, a first press made at `armedAt`: ask, or confirm. */
export function giveUpPress(armedAt: number | null, now: number): 'ask' | 'confirm' {
  return armedAt !== null && now - armedAt < CONFIRM_MS ? 'confirm' : 'ask';
}

/** The button that gives the seat up, at a second press. */
export function GiveUpButton({ onGiveUp }: { onGiveUp: () => void }) {
  const [armedAt, setArmedAt] = useState<number | null>(null);
  useEffect(() => {
    if (armedAt === null) {
      return undefined;
    }
    const timer = setTimeout(() => setArmedAt(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armedAt]);
  const press = (): void => {
    const now = Date.now();
    if (giveUpPress(armedAt, now) === 'confirm') {
      setArmedAt(null);
      onGiveUp();
    } else {
      setArmedAt(now);
    }
  };
  return (
    <button
      className={`danger give-up${armedAt === null ? '' : ' give-up--asked'}`}
      onClick={press}
    >
      {armedAt === null ? 'Einsatz aufgeben' : 'Wirklich? Nochmal drücken'}
    </button>
  );
}
