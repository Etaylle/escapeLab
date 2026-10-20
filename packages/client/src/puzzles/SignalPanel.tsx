import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { tokenLabel, type SignalToken } from '@escapelab/core';
import { play } from '../sounds.js';
import { consoleName } from '../world/consoles.js';
import { DeviceLamp, type LampTone } from './Device.js';
import type { PanelProps } from './index.js';

type SignalPuzzle = PanelProps<'signal'>['puzzle'];
type SignalSend = PanelProps<'signal'>['send'];
/** A key of shapes, at a console with the legend: its row and its form. */
type RowKey = NonNullable<SignalPuzzle['keys']>[number];
type Colour = SignalToken extends `${infer C}-${string}` ? C : never;
type Form = SignalToken extends `${string}-${infer F}` ? F : never;

/** The four colours as the Simon keys show them; form and words tell a sign without them. */
const COLOURS: Record<Colour, string> = {
  rot: '#ef4444',
  blau: '#3b82f6',
  gruen: '#22c55e',
  gelb: '#eab308',
};

/** The three forms on a 24-unit square, as the printed figure draws them. */
const FORMS: Record<Form, (fill: string) => ReactNode> = {
  kreis: (fill) => <circle cx={12} cy={12} r={9} fill={fill} />,
  dreieck: (fill) => <path d="M12 2.5 22 20H2Z" fill={fill} />,
  quadrat: (fill) => <rect x={3.5} y={3.5} width={17} height={17} rx={1.5} fill={fill} />,
};

/** The forms' names, as a key of shapes prints them under its form. */
const FORM_NAMES: Record<Form, string> = {
  kreis: 'Kreis',
  dreieck: 'Dreieck',
  quadrat: 'Quadrat',
};

/** How long each sign of a fleeting strip shows, one after the other. */
export const FLEETING_SIGN_MS = 1200;
/** How long a fleeting strip stays dark after its last sign, before it starts over. */
export const FLEETING_PAUSE_MS = 2000;

/**
 * Where a fleeting strip of `count` signs stands `ms` after it started: the
 * sign it shows — null in the dark pause after the last one — and how many
 * ms until that changes. Each sign shows for FLEETING_SIGN_MS in turn, then
 * the strip stays dark for FLEETING_PAUSE_MS and starts over; a time before
 * the start counts as the start.
 */
export function fleetingAt(ms: number, count: number): { shown: number | null; untilNext: number } {
  const signs = count * FLEETING_SIGN_MS;
  const cycle = signs + FLEETING_PAUSE_MS;
  const into = Math.max(0, ms) % cycle;
  if (into < signs) {
    const shown = Math.floor(into / FLEETING_SIGN_MS);
    return { shown, untilNext: (shown + 1) * FLEETING_SIGN_MS - into };
  }
  return { shown: null, untilNext: cycle - into };
}

/**
 * The sign a fleeting strip of `count` signs shows now: the first as it
 * appears, then on by itself, a timer to every change; null in the pause.
 */
function useFleeting(count: number): number | null {
  const [shown, setShown] = useState<number | null>(0);
  useEffect(() => {
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = (): void => {
      const now = fleetingAt(performance.now() - start, count);
      setShown(now.shown);
      timer = setTimeout(step, now.untilNext);
    };
    timer = setTimeout(step, fleetingAt(0, count).untilNext);
    return () => clearTimeout(timer);
  }, [count]);
  return shown;
}

/** A sign's colour and form, read off its id: „rot-dreieck" is a red triangle. */
function partsOf(token: SignalToken): [Colour, Form] {
  // The id is `${colour}-${form}`, and neither part has a dash of its own.
  return token.split('-') as [Colour, Form];
}

/**
 * A sign as both consoles show it: its form in its colour, glowing in it
 * like a lamp, and under it the words both players say for it, „rotes
 * Dreieck".
 */
function Sign({ token }: { token: SignalToken }) {
  const [colour, form] = partsOf(token);
  return (
    <>
      <svg
        className="signal-glyph"
        viewBox="0 0 24 24"
        style={{ color: COLOURS[colour] }}
        aria-hidden="true"
      >
        {FORMS[form](COLOURS[colour])}
      </svg>
      <span className="signal-word">{tokenLabel(token)}</span>
    </>
  );
}

/** A key of shapes: its form in the key's own grey, its name under it, no colour at all. */
function Shape({ form }: { form: Form }) {
  return (
    <>
      <svg className="signal-glyph" viewBox="0 0 24 24" aria-hidden="true">
        {FORMS[form]('currentColor')}
      </svg>
      <span className="signal-word">{FORM_NAMES[form]}</span>
    </>
  );
}

/** One sign's lamp: lit once the sign is pressed. */
function Lamp({ lit }: { lit: boolean }) {
  return <span className={lit ? 'signal-lamp signal-lamp--lit' : 'signal-lamp'} />;
}

/** The stage's sequence from the left, each sign over its lamp; lit as far as it is pressed. */
function Strip({ sequence, done }: { sequence: SignalToken[]; done: number }) {
  return (
    <ol className="signal-strip" aria-label={`Folge, ${done} von ${sequence.length} gedrückt`}>
      {sequence.map((token, i) => (
        <li key={i} className="signal-sign">
          <Sign token={token} />
          <Lamp lit={i < done} />
        </li>
      ))}
    </ol>
  );
}

/**
 * The stage's sequence one sign at a time, each in its own place over its
 * lamp: the signs show in turn from the left, then the strip goes dark and
 * starts over. The lamps stay, lit as far as the signs are pressed.
 */
function FleetingStrip({ sequence, done }: { sequence: SignalToken[]; done: number }) {
  const shown = useFleeting(sequence.length);
  return (
    <ol
      className="signal-strip signal-strip--fleeting"
      aria-label={`Folge, ${done} von ${sequence.length} gedrückt`}
    >
      {sequence.map((token, i) => (
        <li key={i} className={i === shown ? 'signal-sign signal-sign--shown' : 'signal-sign'}>
          {i === shown ? (
            <Sign token={token} />
          ) : (
            <>
              <span className="signal-glyph signal-glyph--dark" aria-hidden="true" />
              <span className="signal-word" aria-hidden="true" />
            </>
          )}
          <Lamp lit={i < done} />
        </li>
      ))}
    </ol>
  );
}

/** A lamp for each sign of the stage, lit as far as the signs are pressed. */
function Lamps({ puzzle }: { puzzle: SignalPuzzle }) {
  return (
    <div
      className="signal-lamps"
      role="img"
      aria-label={`${puzzle.done} von ${puzzle.length} gedrückt`}
    >
      {Array.from({ length: puzzle.length }, (_, i) => (
        <Lamp key={i} lit={i < puzzle.done} />
      ))}
    </div>
  );
}

/** This console's twelve keys, three rows of four; a wrong sign shakes them. */
function Keys({ grid, wrong, send }: { grid: SignalToken[]; wrong: boolean; send: SignalSend }) {
  return (
    <div className={wrong ? 'signal-grid signal-grid--wrong' : 'signal-grid'}>
      {grid.map((token) => (
        <button
          key={token}
          className="signal-key"
          data-token={token}
          onClick={() => {
            play('click');
            send({ press: token });
          }}
        >
          <Sign token={token} />
        </button>
      ))}
    </div>
  );
}

/** A console's twelve keys for the audience, three rows of four: shown, never pressed. */
function Layout({ grid }: { grid: SignalToken[] }) {
  return (
    <div className="signal-grid">
      {grid.map((token) => (
        <span key={token} className="signal-key" data-token={token}>
          <Sign token={token} />
        </span>
      ))}
    </div>
  );
}

/** The keys of shapes row by row, in the order the view lists them. */
function byRow(keys: RowKey[]): [RowKey['row'], Form[]][] {
  const rows = new Map<RowKey['row'], Form[]>();
  for (const { row, shape } of keys) {
    rows.set(row, [...(rows.get(row) ?? []), shape]);
  }
  return [...rows];
}

/** A key of shapes by its row and form; `send` null for the audience, which presses none. */
interface RowKeyProps {
  row: RowKey['row'];
  form: Form;
  send: SignalSend | null;
}

/** One key of shapes: pressed at the receiving console, only shown to the audience. */
function RowKeyCap({ row, form, send }: RowKeyProps) {
  if (send === null) {
    return (
      <span className="signal-key signal-key--shape" data-row={row} data-shape={form}>
        <Shape form={form} />
      </span>
    );
  }
  return (
    <button
      className="signal-key signal-key--shape"
      data-row={row}
      data-shape={form}
      aria-label={`Zeile ${row}, ${FORM_NAMES[form]}`}
      onClick={() => {
        play('click');
        send({ key: { row, shape: form } });
      }}
    >
      <Shape form={form} />
    </button>
  );
}

/** A console's keys of shapes; `send` null for the audience, which presses none. */
interface RowKeysProps {
  keys: RowKey[];
  wrong: boolean;
  send: SignalSend | null;
}

/**
 * A console's keys with the legend: four numbered rows of the three forms,
 * grey — which colour a row stands for, only the printed legend says. A
 * wrong sign shakes them.
 */
function RowKeys({ keys, wrong, send }: RowKeysProps) {
  const layout = 'signal-grid signal-grid--rows';
  return (
    <div className={wrong ? `${layout} signal-grid--wrong` : layout}>
      {byRow(keys).map(([row, forms]) => (
        <Fragment key={row}>
          <span className="signal-row-number">{row}</span>
          {forms.map((form) => (
            <RowKeyCap key={form} row={row} form={form} send={send} />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/** The warning after a wrong sign, at both consoles and for the audience. */
function Warning({ puzzle }: { puzzle: SignalPuzzle }) {
  if (puzzle.lastResult !== 'wrong') {
    return null;
  }
  return (
    <p className="warn" role="status">
      ⚠ Falsches Zeichen — Stufe von vorn.
    </p>
  );
}

/** A stage's LED: green once done, amber while under way, dark ahead. */
function stageTone(lamp: number, stage: number): LampTone {
  if (lamp < stage) {
    return 'green';
  }
  return lamp === stage ? 'amber' : 'off';
}

/** The stage LEDs, one per stage, with „STUFE" engraved under them. */
function StageLeds({ puzzle }: { puzzle: SignalPuzzle }) {
  return (
    <div
      className="signal-stages"
      role="img"
      aria-label={`Stufe ${puzzle.stage} von ${puzzle.stages}`}
    >
      <span className="signal-stage-lamps">
        {Array.from({ length: puzzle.stages }, (_, i) => (
          <DeviceLamp key={i} tone={stageTone(i + 1, puzzle.stage)} />
        ))}
      </span>
      <span className="device-engraving">STUFE</span>
    </div>
  );
}

/** Backlit legends, as over a console's mode keys: the one that burns says what is on. */
function Mode({ label, legends, lit }: { label: string; legends: string[]; lit: string }) {
  return (
    <div className="signal-mode">
      <span className="device-engraving">{label}</span>
      {legends.map((legend) => (
        <span
          key={legend}
          className={legend === lit ? 'signal-legend signal-legend--lit' : 'signal-legend'}
        >
          {legend}
        </span>
      ))}
    </div>
  );
}

/** What this console does this stage: sends the sequence, or takes it in. */
function ConsoleMode({ sending }: { sending: boolean }) {
  const lit = sending ? 'SENDEN' : 'EINGABE';
  return <Mode label="BETRIEB" legends={['SENDEN', 'EINGABE']} lit={lit} />;
}

/** A console's top row: the stage LEDs on the left, the mode legends on the right. */
function Status({ puzzle, mode }: { puzzle: SignalPuzzle; mode: ReactNode }) {
  return (
    <div className="signal-status">
      <StageLeds puzzle={puzzle} />
      {mode}
    </div>
  );
}

/**
 * What the audience sees: the sequence, and under it the keys — each
 * console's own without the legend, the rows both share with it.
 */
function Audience({ puzzle, sequence }: { puzzle: SignalPuzzle; sequence: SignalToken[] }) {
  const { grids, keys } = puzzle;
  const both = `${consoleName('a')} und ${consoleName('b')}`;
  const sides = (['a', 'b'] as const).map((side) => consoleName(side).toUpperCase());
  const sender = consoleName(puzzle.sends).toUpperCase();
  return (
    <div className="signal">
      <Status puzzle={puzzle} mode={<Mode label="SENDET" legends={sides} lit={sender} />} />
      <Strip sequence={sequence} done={puzzle.done} />
      <Warning puzzle={puzzle} />
      {grids !== null &&
        (['a', 'b'] as const).map((side) => (
          <section key={side} className="signal-console" aria-label={consoleName(side)}>
            <h4 className="signal-console-name">{consoleName(side)}</h4>
            <Layout grid={grids[side]} />
          </section>
        ))}
      {keys !== null && (
        <section className="signal-console" aria-label={both}>
          <h4 className="signal-console-name">{both}</h4>
          <RowKeys keys={keys} wrong={false} send={null} />
        </section>
      )}
    </div>
  );
}

/**
 * The receiving console: a lamp per sign behind its glass, then its keys —
 * the signs, or rows of shapes.
 */
function Receiver({ puzzle, keys }: { puzzle: SignalPuzzle; keys: ReactNode }) {
  return (
    <div className="signal">
      <Status puzzle={puzzle} mode={<ConsoleMode sending={false} />} />
      <Lamps puzzle={puzzle} />
      <Warning puzzle={puzzle} />
      {keys}
    </div>
  );
}

/** The receiving console's keys: the signs themselves, or with the legend rows of shapes. */
function receivingKeys(puzzle: SignalPuzzle, send: SignalSend): ReactNode {
  const wrong = puzzle.lastResult === 'wrong';
  if (puzzle.grid !== null) {
    return <Keys grid={puzzle.grid} wrong={wrong} send={send} />;
  }
  if (puzzle.keys !== null) {
    return <RowKeys keys={puzzle.keys} wrong={wrong} send={send} />;
  }
  return null;
}

/**
 * The sending console: the stage's sequence as lamps behind glass, a done
 * lamp under each — side by side, or one sign at a time from the stage on
 * that the rules call fleeting.
 */
function Sender({ puzzle, sequence }: { puzzle: SignalPuzzle; sequence: SignalToken[] }) {
  return (
    <div className="signal">
      <Status puzzle={puzzle} mode={<ConsoleMode sending />} />
      {puzzle.fleeting ? (
        <FleetingStrip key={puzzle.stage} sequence={sequence} done={puzzle.done} />
      ) : (
        <Strip sequence={sequence} done={puzzle.done} />
      )}
      <Warning puzzle={puzzle} />
    </div>
  );
}

/**
 * The Signalkette at one console. The sending console shows the stage's
 * sequence, sign by sign — side by side, or one at a time where the stage
 * is fleeting; the receiving one has twelve keys and presses the sequence
 * in its order: the signs themselves, or with the legend rows of grey
 * shapes. Both light a lamp per sign pressed, and the direction swaps with
 * every stage. The audience sees what is sent and the keys.
 */
export function SignalPanel({ puzzle, send }: PanelProps<'signal'>) {
  const { role, sequence } = puzzle;
  if (role === null && sequence !== null) {
    return <Audience puzzle={puzzle} sequence={sequence} />;
  }
  if (role === 'sender' && sequence !== null) {
    return <Sender puzzle={puzzle} sequence={sequence} />;
  }
  const keys = role === 'receiver' ? receivingKeys(puzzle, send) : null;
  if (keys !== null) {
    return <Receiver puzzle={puzzle} keys={keys} />;
  }
  return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
}
