import { useEffect, useState } from 'react';
import type { PuzzleInputOf, RelayView } from '@escapelab/core';
import { play } from '../sounds.js';
import type { PanelProps } from './index.js';
import './relay.css';

type RelayInput = PuzzleInputOf<'relay'>;
type Instruction = NonNullable<RelayView['instruction']>;
type Control = RelayView['controls'][number];

/** A dial's levels — exactly what the core accepts. */
const LEVELS = [1, 2, 3, 4, 5] as const;

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

/** The highlighted box: what to read out, for whose console, and how long it still counts. */
function Order({ instruction, windowSec }: { instruction: Instruction; windowSec: number }) {
  const now = useNow(200);
  const share = Math.min(1, Math.max(0, instruction.expiresAt - now) / (windowSec * 1000));
  return (
    <section
      className={`relay-order ${share < 0.34 ? 'relay-order--late' : ''}`}
      aria-label="Deine Anweisung"
    >
      <span className="kicker">LAUT VORLESEN · PULT {instruction.roleName.toUpperCase()}</span>
      <strong className="relay-order-text">
        „{spoken(instruction.control, instruction.value)}"
      </strong>
      <div className="relay-bar" aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} />
      </div>
    </section>
  );
}

function ControlCard({ control, send }: { control: Control; send: (input: RelayInput) => void }) {
  const set = (value: RelayInput['value']): void => {
    play('click');
    send({ kind: 'set', control: control.id, value });
  };
  return (
    <div className={`relay-control relay-control--${control.kind}`}>
      <span className="relay-name">{control.name}</span>
      {control.kind === 'switch' && (
        <button
          className={`relay-switch ${control.value ? 'relay-on' : ''}`}
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
 * One role's side of the relay emergency: the instruction to read out on
 * top, the crew's progress, and the four controls of this role's console.
 */
export function RelayConsole({
  relay,
  send,
}: {
  relay: RelayView;
  send: (input: RelayInput) => void;
}) {
  return (
    <div className="relay">
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

/** The registry's entry; the emergency overlay renders RelayConsole itself. */
export function RelayPanel({ puzzle, send }: PanelProps<'relay'>) {
  return <RelayConsole relay={puzzle} send={send} />;
}
