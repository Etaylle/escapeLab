import { useEffect, useRef, useState } from 'react';

/**
 * „Einsatz aufgeben": the seat given up for good (core `abandon`). On the card of a line lost and
 * on the menu's card of the run it takes a second press within CONFIRM_MS, the first only asking;
 * from the pause menu it asks once, on a card of its own that says what it means (`GiveUpAsk`).
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

/**
 * What giving a run's seat up means, as the ask says it: the seat goes for good, and the run —
 * of `taken` seats, `least` the fewest it takes (`Mission['players'].min`) — runs on with the
 * rest, or below its least ends for everybody (core `abandon`).
 */
export function giveUpLines(taken: number, least: number): [string, string] {
  const left = taken - 1;
  const seats = `${left} ${left === 1 ? 'Platz' : 'Plätzen'}`;
  return [
    'Der Platz wird aufgegeben und lässt sich nicht zurückholen.',
    left < least
      ? `Mit ${seats} liegt der Einsatz unter seiner Mindestbesetzung von ${least} und endet ` +
        'damit für alle.'
      : `Der Einsatz läuft mit ${seats} weiter.`,
  ];
}

/**
 * The ask before a run's seat is given up from the pause menu, once: a card over the menu that
 * says what it means (`giveUpLines`), with „Einsatz aufgeben" and „Zurück" — the way back in the
 * focus. Esc, B and a click beside the card step back.
 */
export function GiveUpAsk({
  taken,
  least,
  onGiveUp,
  onBack,
}: {
  taken: number;
  least: number;
  onGiveUp: () => void;
  onBack: () => void;
}) {
  const back = useRef<HTMLButtonElement>(null);
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        latest.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div
      className="overlay give-up-ask"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="give-up-title"
      onClick={onBack}
    >
      <div className="give-up-card" onClick={(e) => e.stopPropagation()}>
        <h2 id="give-up-title" className="give-up-title">
          Einsatz aufgeben?
        </h2>
        {giveUpLines(taken, least).map((line) => (
          <p key={line}>{line}</p>
        ))}
        <div className="give-up-ways">
          <button className="danger give-up-confirm" onClick={onGiveUp}>
            Einsatz aufgeben
          </button>
          <button ref={back} className="give-up-back" onClick={onBack}>
            Zurück
          </button>
        </div>
      </div>
    </div>
  );
}
