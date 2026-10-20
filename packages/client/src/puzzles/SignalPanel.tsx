import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { SIGNAL_PATTERNS, tokenLabel, type SignalPattern, type SignalToken } from '@escapelab/core';
import { Icon } from '../screens/Icon.js';
import { consoleName } from '../world/consoles.js';
import { DeviceLamp, type LampTone } from './Device.js';
import type { Change } from './feel.js';
import type { PanelProps } from './index.js';
import { lampPop, stageChime } from './sounds.js';

type SignalPuzzle = PanelProps<'signal'>['puzzle'];
type SignalChange = Change<SignalPuzzle>;
type SignalSend = PanelProps<'signal'>['send'];
/** A key of shapes, at a console with the legend: its row and its form. */
type RowKey = NonNullable<SignalPuzzle['keys']>[number];
type Colour = SignalToken extends `${infer C}-${string}` ? C : never;
type Form = SignalToken extends `${string}-${infer F}` ? F : never;
type Point = readonly [number, number];

/** The four colours as the Simon keys show them; form and texture tell a sign without them. */
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

/** The forms' names, for a screen reader: the keys of shapes show none. */
const FORM_NAMES: Record<Form, string> = {
  kreis: 'Kreis',
  dreieck: 'Dreieck',
  quadrat: 'Quadrat',
};

/**
 * The texture a sign carries over its form, darker: the pattern of its
 * colour, the one the printed legend names beside the colour.
 */
export function textureOf(token: SignalToken): SignalPattern {
  return SIGNAL_PATTERNS[partsOf(token)[0]];
}

/** The polygons' corners, clockwise on screen; the circle has none. */
const CORNERS: Record<Exclude<Form, 'kreis'>, readonly Point[]> = {
  dreieck: [
    [12, 2.5],
    [22, 20],
    [2, 20],
  ],
  quadrat: [
    [3.5, 3.5],
    [20.5, 3.5],
    [20.5, 20.5],
    [3.5, 20.5],
  ],
};

/** How far `p` lies inside a form, in units: negative outside. */
function depthIn(form: Form, [x, y]: Point): number {
  if (form === 'kreis') {
    return 9 - Math.hypot(x - 12, y - 12);
  }
  const corners = CORNERS[form];
  return Math.min(
    ...corners.map(([ax, ay], i) => {
      const [bx, by] = corners[(i + 1) % corners.length] ?? [ax, ay];
      return ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay);
    }),
  );
}

const tenth = (n: number): number => Math.round(n * 10) / 10;

/** Fine dots in rows, each row shifted half a step, that keep clear of the form's edge. */
function dotsIn(form: Form): Point[] {
  const step = 2.9;
  const dots: Point[] = [];
  for (let row = 0; row < 9; row++) {
    for (let col = -1; col < 9; col++) {
      const at: Point = [tenth(col * step + (row % 2) * (step / 2)), tenth(1.4 + row * step)];
      if (depthIn(form, at) >= 1.7) {
        dots.push(at);
      }
    }
  }
  return dots;
}

/** Stripes rising to the right, 3.4 units apart, cut off where they come near the form's edge. */
function stripesIn(form: Form): [Point, Point][] {
  const stripes: [Point, Point][] = [];
  // Stripe k lies on the line x + y = 4.8 k, walked across the square in tenths.
  for (let k = 1; k <= 9; k++) {
    const inside = Array.from({ length: 241 }, (_, i): Point => [i / 10, tenth(4.8 * k - i / 10)])
      .filter((at) => depthIn(form, at) >= 1);
    const first = inside[0];
    const last = inside.at(-1);
    if (first !== undefined && last !== undefined && last[0] - first[0] >= 1) {
      stripes.push([first, last]);
    }
  }
  return stripes;
}

/** Where a ring sits in each form: the middle of the circle and square, the triangle's incentre. */
const RING_AT: Record<Form, Point> = {
  kreis: [12, 12],
  dreieck: [12, 14.2],
  quadrat: [12, 12],
};

const DOTS: Record<Form, Point[]> = {
  kreis: dotsIn('kreis'),
  dreieck: dotsIn('dreieck'),
  quadrat: dotsIn('quadrat'),
};

const STRIPES: Record<Form, [Point, Point][]> = {
  kreis: stripesIn('kreis'),
  dreieck: stripesIn('dreieck'),
  quadrat: stripesIn('quadrat'),
};

/** The texture's ink: the sign's own colour, darkened. */
const INK = 'rgba(6, 9, 12, 0.42)';

/** A sign's texture over its form, by the texture its colour carries. */
function TextureOver({ texture, form }: { texture: SignalPattern; form: Form }) {
  const className = `signal-texture signal-texture--${texture}`;
  switch (texture) {
    case 'plain':
      return null;
    case 'dots':
      return (
        <g className={className} fill={INK}>
          {DOTS[form].map(([x, y]) => (
            <circle key={`${x} ${y}`} cx={x} cy={y} r={0.9} />
          ))}
        </g>
      );
    case 'stripes':
      return (
        <g className={className} stroke={INK} strokeWidth={1.3} strokeLinecap="round">
          {STRIPES[form].map(([[x1, y1], [x2, y2]]) => (
            <line key={`${x1} ${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </g>
      );
    case 'ring': {
      const [cx, cy] = RING_AT[form];
      return (
        <circle
          className={className}
          cx={cx}
          cy={cy}
          r={3.4}
          fill="none"
          stroke={INK}
          strokeWidth={1.7}
        />
      );
    }
  }
}

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

/** Where a fleeting strip stands: the sign it shows, and the one it showed before, fading. */
interface Fleeting {
  shown: number | null;
  gone: number | null;
}

/**
 * The sign a fleeting strip of `count` signs shows now — the first as it
 * appears, then on by itself, a timer to every change; null in the pause —
 * and the one it showed just before, fading out.
 */
function useFleeting(count: number): Fleeting {
  const [now, setNow] = useState<Fleeting>({ shown: 0, gone: null });
  useEffect(() => {
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = (): void => {
      const at = fleetingAt(performance.now() - start, count);
      setNow((was) => (was.shown === at.shown ? was : { shown: at.shown, gone: was.shown }));
      timer = setTimeout(step, at.untilNext);
    };
    timer = setTimeout(step, fleetingAt(0, count).untilNext);
    return () => clearTimeout(timer);
  }, [count]);
  return now;
}

/** A sign's colour and form, read off its id: „rot-dreieck" is a red triangle. */
function partsOf(token: SignalToken): [Colour, Form] {
  // The id is `${colour}-${form}`, and neither part has a dash of its own.
  return token.split('-') as [Colour, Form];
}

/**
 * A sign as both consoles show it: its form in its colour, glowing in it
 * like a lamp as it comes on (CSS), its colour's texture printed over it —
 * and no word: what it is, the players say. A screen reader gets the words,
 * „rotes Dreieck" — none for a sign `fading` out of a fleeting strip.
 */
function Sign({ token, fading = false }: { token: SignalToken; fading?: boolean }) {
  const [colour, form] = partsOf(token);
  return (
    <svg
      className={fading ? 'signal-glyph signal-glyph--fading' : 'signal-glyph'}
      viewBox="0 0 24 24"
      style={{ color: COLOURS[colour] }}
      role={fading ? undefined : 'img'}
      aria-label={fading ? undefined : tokenLabel(token)}
      aria-hidden={fading ? true : undefined}
    >
      {FORMS[form](COLOURS[colour])}
      <TextureOver texture={SIGNAL_PATTERNS[colour]} form={form} />
    </svg>
  );
}

/** A key of shapes: its form in the key's own grey, no colour and no word. */
function Shape({ form }: { form: Form }) {
  return (
    <svg className="signal-glyph" viewBox="0 0 24 24" aria-hidden="true">
      {FORMS[form]('currentColor')}
    </svg>
  );
}

/** One sign's lamp: lit once the sign is pressed — `fresh`, popping on as it was just now. */
function Lamp({ lit, fresh = false }: { lit: boolean; fresh?: boolean }) {
  const lamp = lit ? 'signal-lamp signal-lamp--lit' : 'signal-lamp';
  return <span className={fresh ? `${lamp} signal-lamp--fresh` : lamp} />;
}

/** The lamp a change lit, by its place: one more sign of the stage in; none where none was. */
export function signLitWith(change: SignalChange | null): number | null {
  if (change === null || change.after.stage !== change.before.stage) {
    return null;
  }
  return change.after.done > change.before.done ? change.after.done - 1 : null;
}

/** Whether a change finished a stage: the next one is under way. */
export function stageDoneWith(change: SignalChange | null): boolean {
  return change !== null && change.after.stage > change.before.stage;
}

/** What a change sounds like at either console: a lamp popping on, a chime for a stage done. */
export function signalSounds(change: SignalChange): void {
  if (stageDoneWith(change)) {
    stageChime();
  } else if (signLitWith(change) !== null) {
    lampPop();
  }
}

/** A strip's signs and lamps: the stage's sequence, the signs in, the lamp just lit. */
interface StripProps {
  sequence: SignalToken[];
  done: number;
  fresh: number | null;
}

/**
 * The stage's sequence from the left, each sign over its lamp, glowing on one after the
 * other as the stage starts (CSS); lit as far as it is pressed.
 */
function Strip({ sequence, done, fresh }: StripProps) {
  return (
    <ol className="signal-strip" aria-label={`Folge, ${done} von ${sequence.length} gedrückt`}>
      {sequence.map((token, i) => (
        <li key={i} className="signal-sign">
          <Sign token={token} />
          <Lamp lit={i < done} fresh={i === fresh} />
        </li>
      ))}
    </ol>
  );
}

/** A place of a fleeting strip: its sign shown, fading out over the dark glass, or dark. */
function FleetingPlace({ token, at }: { token: SignalToken; at: 'shown' | 'gone' | 'dark' }) {
  const dark = <span className="signal-glyph signal-glyph--dark" aria-hidden="true" />;
  if (at === 'shown') {
    return <Sign token={token} />;
  }
  return at === 'dark' ? (
    dark
  ) : (
    <span className="signal-glyph-stack">
      {dark}
      <Sign token={token} fading />
    </span>
  );
}

/**
 * The stage's sequence one sign at a time, each in its own place over its
 * lamp: the signs glow on in turn from the left, each fading as the next
 * comes, then the strip goes dark and starts over. The lamps stay, lit as
 * far as the signs are pressed.
 */
function FleetingStrip({ sequence, done, fresh }: StripProps) {
  const { shown, gone } = useFleeting(sequence.length);
  const at = (i: number) => (i === shown ? 'shown' : i === gone ? 'gone' : 'dark');
  return (
    <ol
      className="signal-strip signal-strip--fleeting"
      aria-label={`Folge, ${done} von ${sequence.length} gedrückt`}
    >
      {sequence.map((token, i) => (
        <li key={i} className={i === shown ? 'signal-sign signal-sign--shown' : 'signal-sign'}>
          <FleetingPlace token={token} at={at(i)} />
          <Lamp lit={i < done} fresh={i === fresh} />
        </li>
      ))}
    </ol>
  );
}

/** A lamp for each sign of the stage, lit as far as the signs are pressed, the last one popping. */
function Lamps({ puzzle, fresh }: { puzzle: SignalPuzzle; fresh: number | null }) {
  return (
    <div
      className="signal-lamps"
      role="img"
      aria-label={`${puzzle.done} von ${puzzle.length} gedrückt`}
    >
      {Array.from({ length: puzzle.length }, (_, i) => (
        <Lamp key={i} lit={i < puzzle.done} fresh={i === fresh} />
      ))}
    </div>
  );
}

/** This console's twelve keys, three rows of four. */
function Keys({ grid, send }: { grid: SignalToken[]; send: SignalSend }) {
  return (
    <div className="signal-grid">
      {grid.map((token) => (
        <button
          key={token}
          className="signal-key"
          data-token={token}
          onClick={() => send({ press: token })}
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
  const name = `Zeile ${row}, ${FORM_NAMES[form]}`;
  if (send === null) {
    return (
      <span
        className="signal-key signal-key--shape"
        data-row={row}
        data-shape={form}
        role="img"
        aria-label={name}
      >
        <Shape form={form} />
      </span>
    );
  }
  return (
    <button
      className="signal-key signal-key--shape"
      data-row={row}
      data-shape={form}
      aria-label={name}
      onClick={() => send({ key: { row, shape: form } })}
    >
      <Shape form={form} />
    </button>
  );
}

/** A console's keys of shapes; `send` null for the audience, which presses none. */
interface RowKeysProps {
  keys: RowKey[];
  send: SignalSend | null;
}

/**
 * A console's keys with the legend: four numbered rows of the three forms,
 * grey — which colour a row stands for, only the printed legend says.
 */
function RowKeys({ keys, send }: RowKeysProps) {
  return (
    <div className="signal-grid signal-grid--rows">
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
      <Icon name="warning" /> Falsches Zeichen — Stufe von vorn.
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

/**
 * The stage LEDs, one per stage, with „STUFE" engraved under them; the one
 * of a stage just `done` pops on green.
 */
function StageLeds({ puzzle, done }: { puzzle: SignalPuzzle; done: boolean }) {
  return (
    <div
      className="signal-stages"
      role="img"
      aria-label={`Stufe ${puzzle.stage} von ${puzzle.stages}`}
    >
      <span className="signal-stage-lamps">
        {Array.from({ length: puzzle.stages }, (_, i) => (
          <DeviceLamp
            key={i}
            tone={stageTone(i + 1, puzzle.stage)}
            fresh={done && i + 2 === puzzle.stage}
          />
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

/** What a console shows of the latest change: the lamp it lit, and whether it ended a stage. */
interface Lit {
  fresh: number | null;
  stageDone: boolean;
}

/** A console's top row: the stage LEDs on the left, the mode legends on the right. */
function Status({ puzzle, lit, mode }: { puzzle: SignalPuzzle; lit: Lit; mode: ReactNode }) {
  return (
    <div className="signal-status">
      <StageLeds puzzle={puzzle} done={lit.stageDone} />
      {mode}
    </div>
  );
}

/** A console's part of the stage: its view, what the change lit, its sequence where it has it. */
interface SideProps {
  puzzle: SignalPuzzle;
  lit: Lit;
  sequence: SignalToken[];
}

/**
 * What the audience sees: the sequence, and under it the keys — each
 * console's own without the legend, the rows both share with it.
 */
function Audience({ puzzle, lit, sequence }: SideProps) {
  const { grids, keys } = puzzle;
  const both = `${consoleName('a')} und ${consoleName('b')}`;
  const sides = (['a', 'b'] as const).map((side) => consoleName(side).toUpperCase());
  const sender = consoleName(puzzle.sends).toUpperCase();
  const mode = <Mode label="SENDET" legends={sides} lit={sender} />;
  return (
    <div className="signal">
      <Status puzzle={puzzle} lit={lit} mode={mode} />
      <Strip sequence={sequence} done={puzzle.done} fresh={lit.fresh} />
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
          <RowKeys keys={keys} send={null} />
        </section>
      )}
    </div>
  );
}

/**
 * The receiving console: a lamp per sign behind its glass, then its keys —
 * the signs, or rows of shapes.
 */
function Receiver({ puzzle, lit, keys }: { puzzle: SignalPuzzle; lit: Lit; keys: ReactNode }) {
  return (
    <div className="signal">
      <Status puzzle={puzzle} lit={lit} mode={<ConsoleMode sending={false} />} />
      <Lamps puzzle={puzzle} fresh={lit.fresh} />
      <Warning puzzle={puzzle} />
      {keys}
    </div>
  );
}

/** The receiving console's keys: the signs themselves, or with the legend rows of shapes. */
function receivingKeys(puzzle: SignalPuzzle, send: SignalSend): ReactNode {
  if (puzzle.grid !== null) {
    return <Keys grid={puzzle.grid} send={send} />;
  }
  if (puzzle.keys !== null) {
    return <RowKeys keys={puzzle.keys} send={send} />;
  }
  return null;
}

/**
 * The sending console: the stage's sequence as lamps behind glass, a done
 * lamp under each — side by side, or one sign at a time from the stage on
 * that the rules call fleeting.
 */
function Sender({ puzzle, lit, sequence }: SideProps) {
  const strip = { sequence, done: puzzle.done, fresh: lit.fresh };
  return (
    <div className="signal">
      <Status puzzle={puzzle} lit={lit} mode={<ConsoleMode sending />} />
      {puzzle.fleeting ? <FleetingStrip key={puzzle.stage} {...strip} /> : <Strip {...strip} />}
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
export function SignalPanel({ puzzle, change, send }: PanelProps<'signal'>) {
  const { role, sequence } = puzzle;
  const lit = { fresh: signLitWith(change), stageDone: stageDoneWith(change) };
  if (role === null && sequence !== null) {
    return <Audience puzzle={puzzle} lit={lit} sequence={sequence} />;
  }
  if (role === 'sender' && sequence !== null) {
    return <Sender puzzle={puzzle} lit={lit} sequence={sequence} />;
  }
  const keys = role === 'receiver' ? receivingKeys(puzzle, send) : null;
  if (keys !== null) {
    return <Receiver puzzle={puzzle} lit={lit} keys={keys} />;
  }
  return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
}
