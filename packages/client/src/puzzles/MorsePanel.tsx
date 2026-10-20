import { useEffect, useState } from 'react';
import type { Change } from './feel.js';
import type { PanelProps } from './index.js';
import { dialDetent } from './sounds.js';
import './morse.css';

type MorsePuzzle = PanelProps<'morse'>['puzzle'];

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

/** Whether a change turned the dial, a step or more. */
export function turnedWith(change: Change<MorsePuzzle> | null): boolean {
  return change !== null && change.after.dial !== change.before.dial;
}

/** What a change sounds like: the dial's detent catching as it turns. */
export function morseSounds(change: Change<MorsePuzzle>): void {
  if (turnedWith(change)) {
    dialDetent();
  }
}

/**
 * Plays the loop, the lamp blooming as each blink comes on (CSS). It starts dark, so the
 * first blink anyone sees opens the word.
 */
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

/** How far the knob turns either side of upright over the band, in degrees. */
const KNOB_SWEEP = 135;

/** The knob's angle at step `dial` of `steps`: −135° at the band's bottom, +135° at its top. */
export function knobAngle(dial: number, steps: number): number {
  if (steps <= 1) {
    return 0;
  }
  return Math.round((-KNOB_SWEEP + (2 * KNOB_SWEEP * dial) / (steps - 1)) * 10) / 10;
}

/** A point `r` out from the knob's middle at the angle of step `i`, to a tenth. */
function aroundKnob(i: number, steps: number, r: number): [number, number] {
  const turn = (knobAngle(i, steps) * Math.PI) / 180;
  const tenth = (n: number): number => Math.round(n * 10) / 10;
  return [tenth(50 + r * Math.sin(turn)), tenth(50 - r * Math.cos(turn))];
}

/**
 * The tuning knob: a tick for every step of the band round it, the one it points at lit,
 * and the knob turning smoothly to it a step at a time (CSS), a detent catching each.
 */
function Knob({ dial, steps }: { dial: number; steps: number }) {
  return (
    <svg className="morse-knob" viewBox="0 0 100 100" aria-hidden="true">
      {Array.from({ length: steps }, (_, i) => {
        const [x1, y1] = aroundKnob(i, steps, 39);
        const [x2, y2] = aroundKnob(i, steps, 47);
        return (
          <line
            key={i}
            className={i === dial ? 'morse-tick morse-tick-on' : 'morse-tick'}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
          />
        );
      })}
      <g className="morse-knob-cap" style={{ transform: `rotate(${knobAngle(dial, steps)}deg)` }}>
        <circle className="morse-knob-grip" cx={50} cy={50} r={32} />
        <circle className="morse-knob-face" cx={50} cy={50} r={24} />
        <line className="morse-knob-mark" x1={50} y1={22} x2={50} y2={36} />
      </g>
    </svg>
  );
}

export function MorsePanel({ puzzle, send }: PanelProps<'morse'>) {
  if (puzzle.pattern === null) {
    return <div className="progress-line">Regler: {puzzle.frequency}</div>;
  }
  const tune = (step: -1 | 1): void => send({ tune: step });
  return (
    <div>
      {/* A new word restarts the loop from its long pause. */}
      <Lamp key={puzzle.pattern} pattern={puzzle.pattern} />
      <div className="morse-dial">
        <button aria-label="Frequenz runter" disabled={puzzle.dial <= 0} onClick={() => tune(-1)}>
          ◀
        </button>
        <div className="morse-tuner">
          <Knob dial={puzzle.dial} steps={puzzle.steps} />
          <output className="morse-freq" aria-live="polite">
            {puzzle.frequency}
          </output>
        </div>
        <button
          aria-label="Frequenz hoch"
          disabled={puzzle.dial >= puzzle.steps - 1}
          onClick={() => tune(1)}
        >
          ▶
        </button>
      </div>
      <button
        className="big-button morse-send"
        data-feel="thunk"
        onClick={() => send({ transmit: true })}
      >
        SENDEN
      </button>
    </div>
  );
}
