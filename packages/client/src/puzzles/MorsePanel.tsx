import { useEffect, useState } from 'react';
import { play } from '../sounds.js';
import type { PanelProps } from './index.js';
import './morse.css';

/** One Morse unit: a short blink lasts one, a long blink three. */
const UNIT_MS = 250;
/** Dark units before the word repeats. */
const WORD_GAP = 7;

/** A stretch of the lamp's loop: lit or dark, for so many units. */
export interface LampRun {
  on: boolean;
  units: number;
}

/**
 * The lamp's loop for a pattern like "-.. .-": short 1 unit, long 3, dark 1
 * between the signals of a letter, 3 between letters and 7 before the repeat.
 */
export function lampRuns(pattern: string): LampRun[] {
  const runs: LampRun[] = [];
  pattern.split(' ').forEach((letter, i) => {
    if (i > 0) {
      runs.push({ on: false, units: 3 });
    }
    [...letter].forEach((signal, j) => {
      if (j > 0) {
        runs.push({ on: false, units: 1 });
      }
      runs.push({ on: true, units: signal === '-' ? 3 : 1 });
    });
  });
  runs.push({ on: false, units: WORD_GAP });
  return runs;
}

/** Plays the loop. It starts dark, so the first blink anyone sees opens the word. */
function Lamp({ pattern }: { pattern: string }) {
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const runs = lampRuns(pattern);
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = (): void => {
      const run = runs[step % runs.length] ?? { on: false, units: WORD_GAP };
      step += 1;
      setLit(run.on);
      timer = setTimeout(next, run.units * UNIT_MS);
    };
    timer = setTimeout(next, WORD_GAP * UNIT_MS);
    return () => clearTimeout(timer);
  }, [pattern]);
  return (
    <div
      className={`morse-lamp ${lit ? 'morse-lamp-on' : ''}`}
      role="img"
      aria-label="Signallampe"
    />
  );
}

export function MorsePanel({ puzzle, send }: PanelProps<'morse'>) {
  if (puzzle.pattern === null) {
    return (
      <div className="big-hint">
        <p className="muted">Die Signallampe blinkt am Funkpult — lass dir die Zeichen ansagen.</p>
        <div className="progress-line">Regler: {puzzle.frequency}</div>
      </div>
    );
  }
  const tune = (step: -1 | 1): void => {
    play('click');
    send({ tune: step });
  };
  return (
    <div>
      {/* A new word restarts the loop from its long pause. */}
      <Lamp key={puzzle.pattern} pattern={puzzle.pattern} />
      <p className="muted morse-help">
        Sag die Zeichen an: „kurz", „lang", Pause. Nach der langen Pause beginnt das Wort von vorn.
      </p>
      <div className="morse-dial">
        <button aria-label="Frequenz runter" disabled={puzzle.dial <= 0} onClick={() => tune(-1)}>
          ◀
        </button>
        <output className="morse-freq" aria-live="polite">
          {puzzle.frequency}
        </output>
        <button
          aria-label="Frequenz hoch"
          disabled={puzzle.dial >= puzzle.steps - 1}
          onClick={() => tune(1)}
        >
          ▶
        </button>
      </div>
      <div className="morse-scale" aria-hidden="true">
        {Array.from({ length: puzzle.steps }, (_, i) => (
          <span key={i} className={`morse-tick ${i === puzzle.dial ? 'morse-tick-on' : ''}`} />
        ))}
      </div>
      <button
        className="big-button"
        onClick={() => {
          play('click');
          send({ transmit: true });
        }}
      >
        SENDEN
      </button>
    </div>
  );
}
