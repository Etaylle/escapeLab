import { useEffect, useState } from 'react';
import type { PuzzleInputOf, RelayView } from '@escapelab/core';
import { usePressFeel, useRefusalBlame } from './feel.js';
import type { PanelProps } from './index.js';
import './relay.css';

type RelayInput = PuzzleInputOf<'relay'>;
type Instruction = NonNullable<RelayView['instruction']>;
type Control = RelayView['controls'][number];

/** A dial's levels — exactly what the core accepts. */
const LEVELS = [1, 2, 3, 4, 5] as const;
/** From this many seconds left, an instruction's countdown pulses red. */
export const FINAL_SECONDS = 5;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The way it is shouted: „Kryo-Puffer auf 3", „Faradaykäfig AUS", „Zirkulator drücken". */
function spoken(control: string, value: RelayInput['value']): string {
  if (value === 'press') {
    return `${control} drücken`;
  }
  if (typeof value === 'number') {
    return `${control} auf ${value}`;
  }
  return `${control} ${value ? 'AN' : 'AUS'}`;
}

/** The whole seconds an instruction still counts at `now`, never below 0. */
export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/**
 * The highlighted box: what to read out, for whose console, and how long it still counts —
 * a bar running down and its seconds in digits, pulsing red over the last FINAL_SECONDS.
 */
function Order({ instruction, windowSec }: { instruction: Instruction; windowSec: number }) {
  const now = useNow(200);
  const share = Math.min(1, Math.max(0, instruction.expiresAt - now) / (windowSec * 1000));
  const left = secondsLeft(instruction.expiresAt, now);
  return (
    <section
      className={`relay-order ${share < 0.34 ? 'relay-order--late' : ''}`}
      aria-label="Anweisung"
    >
      <span className="kicker">LAUT VORLESEN · PULT {instruction.playerName.toUpperCase()}</span>
      <strong className="relay-order-text">
        „{spoken(instruction.control, instruction.value)}"
      </strong>
      <div className="relay-clock">
        <div className="relay-bar" aria-hidden="true">
          <span style={{ width: `${share * 100}%` }} />
        </div>
        <span
          className={left <= FINAL_SECONDS ? 'relay-count relay-count--final' : 'relay-count'}
          role="timer"
          aria-label={`noch ${left} Sekunden`}
        >
          {String(left).padStart(2, '0')}
        </span>
      </div>
    </section>
  );
}

/** One control of the console: a switch that clacks over, a dial that catches, a button. */
function ControlCard({ control, send }: { control: Control; send: (input: RelayInput) => void }) {
  const set = (value: RelayInput['value']): void => {
    send({ kind: 'set', control: control.id, value });
  };
  return (
    <div className={`relay-control relay-control--${control.kind}`}>
      <span className="relay-name">{control.name}</span>
      {control.kind === 'switch' && (
        <button
          className={`relay-switch ${control.value ? 'relay-on' : ''}`}
          data-feel="clack"
          aria-pressed={control.value}
          onClick={() => set(!control.value)}
        >
          {control.value ? 'AN' : 'AUS'}
        </button>
      )}
      {control.kind === 'dial' && (
        <div className="relay-dial" role="group" aria-label={`${control.name}, Stufe`}>
          {LEVELS.map((level) => (
            <button
              key={level}
              className={level === control.value ? 'relay-on' : ''}
              data-feel="detent"
              aria-pressed={level === control.value}
              onClick={() => set(level)}
            >
              {level}
            </button>
          ))}
        </div>
      )}
      {control.kind === 'button' && (
        <button className="relay-press" onClick={() => set('press')}>
          DRÜCKEN
        </button>
      )}
    </div>
  );
}

/**
 * One player's side of the relay emergency: the instruction to read out on
 * top, the crew's progress, and the four controls of their console, each
 * with the kit's feel — switches clack, dials catch, the button clicks, and
 * a control whose press the server refuses (`refusals`, ws.ts) shakes.
 */
export function RelayConsole({
  relay,
  send,
  refusals,
}: {
  relay: RelayView;
  send: (input: RelayInput) => void;
  /** what the server has refused of this player's inputs so far; 0 for the audience */
  refusals: number;
}) {
  const { handlers, blame } = usePressFeel(true);
  useRefusalBlame(refusals, blame);
  return (
    <div className="relay" {...handlers}>
      {relay.instruction !== null && (
        <Order instruction={relay.instruction} windowSec={relay.windowSec} />
      )}
      <div className="relay-progress">
        Erledigt: <strong>{relay.completed}/{relay.required}</strong>
      </div>
      <div className="relay-console">
        {relay.controls.map((control) => (
          <ControlCard key={control.id} control={control} send={send} />
        ))}
      </div>
    </div>
  );
}

/**
 * The registry's entry; the emergency overlay renders RelayConsole itself,
 * with the refusals it hears of — a relay never stands at a station's device.
 */
export function RelayPanel({ puzzle, send }: PanelProps<'relay'>) {
  return <RelayConsole relay={puzzle} send={send} refusals={0} />;
}
