import { useEffect, useState } from 'react';
import { SIMON_COLORS, type SimonColor } from '@escapelab/core';
import { Icon } from '../screens/Icon.js';
import { play, simonTone } from '../sounds.js';
import { Dots } from './Dots.js';
import type { PanelProps } from './index.js';
import './simon.css';

type SimonPuzzle = PanelProps<'simon'>['puzzle'];

const LABELS: Record<SimonColor, string> = {
  rot: 'ROT',
  blau: 'BLAU',
  gruen: 'GRÜN',
  gelb: 'GELB',
};

const START_MS = 500;
/** Lamp lit per flash, then dark until the next one starts. */
const FLASH_MS = 520;
const STEP_MS = 800;
/** Dark pause before the stage's sequence plays again. */
const LOOP_PAUSE_MS = 1800;

/**
 * The signal lamp: plays its colors on a loop from the moment it mounts.
 * Remount it (new `key`) to start over. Only the first pass beeps, so the
 * loop does not drone on.
 */
function SignalLamp({ flashes }: { flashes: SimonColor[] }) {
  const [colors] = useState(flashes);
  const [lit, setLit] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstPass = true;
    const show = (i: number): void => {
      const color = colors[i];
      if (color === undefined) {
        firstPass = false;
        timer = setTimeout(() => show(0), LOOP_PAUSE_MS);
        return;
      }
      setLit(i);
      if (firstPass) {
        simonTone(SIMON_COLORS.indexOf(color));
      }
      timer = setTimeout(() => {
        setLit(null);
        timer = setTimeout(() => show(i + 1), STEP_MS - FLASH_MS);
      }, FLASH_MS);
    };
    timer = setTimeout(() => show(0), START_MS);
    return () => clearTimeout(timer);
  }, [colors]);

  const color = lit === null ? undefined : colors[lit];
  return (
    <div className={`simon-signal ${color === undefined ? '' : `simon-${color}`}`} role="status">
      {lit !== null && color !== undefined && `${LABELS[color]} · ${lit + 1}/${colors.length}`}
    </div>
  );
}

/** Stage, progress within it and the alarm count that picks the table row. */
function StageStatus({ puzzle }: { puzzle: SimonPuzzle }) {
  return (
    <div className="simon-status">
      <span>
        Stufe <strong>{puzzle.stage}/{puzzle.stages}</strong>
      </span>
      <Dots total={puzzle.stage} done={puzzle.progress} />
      <span>
        Alarme <strong>{puzzle.alarms}</strong>
      </span>
    </div>
  );
}

/** What a wrong key did, under the lamp and at a console without one alike. */
function WrongKey() {
  return (
    <p className="warn">
      <Icon name="warning" /> Falsche Taste — die Stufe beginnt von vorn.
    </p>
  );
}

export function SimonPanel({ puzzle, send }: PanelProps<'simon'>) {
  const [replays, setReplays] = useState(0);
  if (puzzle.flashes === null || puzzle.buttons === null) {
    return (
      <div className="simon">
        <StageStatus puzzle={puzzle} />
        {puzzle.lastWrong && <WrongKey />}
      </div>
    );
  }
  return (
    <div className="simon">
      <StageStatus puzzle={puzzle} />
      <SignalLamp key={`${puzzle.stage}:${puzzle.alarms}:${replays}`} flashes={puzzle.flashes} />
      <button className="simon-replay" onClick={() => setReplays((n) => n + 1)}>
        ↻ NOCHMAL ABSPIELEN
      </button>
      {puzzle.lastWrong && <WrongKey />}
      <div className="simon-pad">
        {puzzle.buttons.map((color) => (
          <button
            key={color}
            className={`simon-key simon-${color}`}
            onClick={() => {
              play('click');
              send({ kind: 'press', color });
            }}
          >
            {LABELS[color]}
          </button>
        ))}
      </div>
    </div>
  );
}
