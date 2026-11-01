import type { PuzzleInputOf, RelayView } from '@escapelab/core';
import { clockTime } from '../clock.js';
import { useServerNow } from '../hooks.js';
import type { Refusal } from '../ws.js';
import { useFreshRefusal } from './Device.js';
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
 * a bar running down and its seconds in digits, pulsing red over the last FINAL_SECONDS — on
 * the server's clock, standing still while the run is paused (`pausedAt`).
 */
function Order({
  instruction,
  windowSec,
  pausedAt,
}: {
  instruction: Instruction;
  windowSec: number;
  pausedAt: number | null;
}) {
  const now = clockTime(pausedAt, useServerNow(200));
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
 * a control whose press the server refuses (`refusal`, ws.ts) shakes, the
 * server's words under the instruction.
 */
export function RelayConsole({
  relay,
  pausedAt,
  send,
  refusal,
}: {
  relay: RelayView;
  /** since when the run stands paused, epoch ms; null while it runs */
  pausedAt: number | null;
  send: (input: RelayInput) => void;
  /** the server's latest refusal of this player's messages; null for the audience */
  refusal: Refusal | null;
}) {
  const { handlers, blame } = usePressFeel(true);
  useRefusalBlame(refusal?.seq ?? 0, blame);
  const refused = useFreshRefusal(refusal);
  return (
    <div className="relay" {...handlers}>
      {relay.instruction !== null && (
        <Order instruction={relay.instruction} windowSec={relay.windowSec} pausedAt={pausedAt} />
      )}
      {refused !== null && (
        <p key={refused.seq} className="relay-refusal" role="alert">
          {refused.message}
        </p>
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
export function RelayPanel({ puzzle, send, mission }: PanelProps<'relay'>) {
  return <RelayConsole relay={puzzle} pausedAt={mission.pausedAt} send={send} refusal={null} />;
}
