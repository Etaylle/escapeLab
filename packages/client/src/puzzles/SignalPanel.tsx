import type { ReactNode } from 'react';
import { tokenLabel, type SignalToken } from '@escapelab/core';
import { play } from '../sounds.js';
import { consoleName } from '../world/consoles.js';
import type { PanelProps } from './index.js';

type SignalPuzzle = PanelProps<'signal'>['puzzle'];
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

/** A sign's colour and form, read off its id: „rot-dreieck" is a red triangle. */
function partsOf(token: SignalToken): [Colour, Form] {
  // The id is `${colour}-${form}`, and neither part has a dash of its own.
  return token.split('-') as [Colour, Form];
}

/**
 * A sign as both consoles show it: its form in its colour, and under it the
 * words both players say for it, „rotes Dreieck".
 */
function Sign({ token }: { token: SignalToken }) {
  const [colour, form] = partsOf(token);
  return (
    <>
      <svg className="signal-glyph" viewBox="0 0 24 24" aria-hidden="true">
        {FORMS[form](COLOURS[colour])}
      </svg>
      <span className="signal-word">{tokenLabel(token)}</span>
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
function Keys({
  grid,
  wrong,
  send,
}: {
  grid: SignalToken[];
  wrong: boolean;
  send: PanelProps<'signal'>['send'];
}) {
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

/**
 * The Signalkette at one console. The sending console shows the stage's
 * sequence, sign by sign; the receiving one has the twelve signs as keys and
 * presses the sequence in its order. Both light a lamp per sign pressed, and
 * the direction swaps with every stage. The audience sees what is sent and
 * the keys of both consoles.
 */
export function SignalPanel({ puzzle, send }: PanelProps<'signal'>) {
  const stage = `Stufe ${puzzle.stage} von ${puzzle.stages}`;
  const wrong = puzzle.lastResult === 'wrong';
  const warning = wrong && (
    <p className="warn" role="status">
      ⚠ Falsches Zeichen — Stufe von vorn.
    </p>
  );
  if (puzzle.role === null && puzzle.grids !== null) {
    const grids = puzzle.grids;
    return (
      <div className="signal">
        <p className="signal-stage">{`${stage} — ${consoleName(puzzle.sends)} sendet`}</p>
        {puzzle.sequence !== null && <Strip sequence={puzzle.sequence} done={puzzle.done} />}
        {warning}
        {(['a', 'b'] as const).map((side) => (
          <section key={side} className="signal-console" aria-label={consoleName(side)}>
            <h4 className="signal-console-name">{consoleName(side)}</h4>
            <Layout grid={grids[side]} />
          </section>
        ))}
      </div>
    );
  }
  if (puzzle.role === 'receiver' && puzzle.grid !== null) {
    return (
      <div className="signal">
        <p className="signal-stage">{`${stage} — dieses Pult gibt ein`}</p>
        <Lamps puzzle={puzzle} />
        <p className="muted">Erst bei Ansage drücken.</p>
        {warning}
        <Keys grid={puzzle.grid} wrong={wrong} send={send} />
      </div>
    );
  }
  if (puzzle.role === 'sender' && puzzle.sequence !== null) {
    return (
      <div className="signal">
        <p className="signal-stage">{`${stage} — dieses Pult sendet`}</p>
        <Strip sequence={puzzle.sequence} done={puzzle.done} />
        <p className="muted">Ansage von links, bis alle Lampen brennen.</p>
        {warning}
      </div>
    );
  }
  return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
}
