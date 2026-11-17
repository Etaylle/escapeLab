import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  FEEDERS,
  LAMP_WORDS,
  SHOWN_PREFIX,
  type ConsoleId,
  type LampColour,
  type StartupBoard,
  type StartupClosed,
  type StartupGap,
  type StartupLogLine,
  type StartupOutcome,
  type StartupPulse,
  type StartupScriptLine,
  type StartupTerminal,
} from '@escapelab/core';
import { serverNow } from '../clock.js';
import { TalkButton } from '../screens/Voice.js';
import { consoleName } from '../world/consoles.js';
import type { Refusal } from '../ws.js';
import { cssVars, reject, type Change } from './feel.js';
import type { PanelProps } from './index.js';
import { holdKeys, keepFocus } from './prompt.js';
import { Link, promptKeyDown } from './ServersPanel.js';
import {
  okChime,
  rejectBuzz,
  relayClick,
  stageChime,
  typeBlip,
  voltageHum,
} from './sounds.js';
import { completed, lineOf, STARTUP_COMMANDS, withKey, type StartupKey } from './startupPrompt.js';
import { useNowUntil } from './syncPress.js';
import './startup.css';

/**
 * StartupPanel.tsx: the Anlaufsteuerung at its two consoles, the same device at both — a
 * terminal of the Serverraum's make (styles/servers.css) beside a Schaltfeld of four feeders,
 * each two control lamps over a breaker, and an LED ladder that fills as a pulse comes in. In
 * each stage one console's terminal runs the script and the other's Schaltfeld takes the pulse:
 * the live part works, the other stands idle and shows nothing of the instance. A status strip
 * over both says in the device's words what the stage and the last pulse came to. The audience
 * sees both live parts side by side.
 */

type StartupPuzzle = PanelProps<'startup'>['puzzle'];
type StartupChange = Change<StartupPuzzle>;
type Send = PanelProps<'startup'>['send'];

/** A log line's tag as the terminal prints it. */
const TAGS: Readonly<Record<StartupLogLine['tag'], string>> = {
  ok: '[ OK ]',
  fail: '[FEHL]',
  info: '[INFO]',
};

/** What became of the last pulse, as the status strip says it. */
const OUTCOME_WORDS: Readonly<Record<StartupOutcome, string>> = {
  angelaufen: 'Stufe angelaufen',
  verfallen: 'Impuls verfallen',
  verworfen: 'Impuls verworfen: Schalter vor dem Fenster',
  falsch: 'Impuls erloschen: falscher Leistungsschalter',
};

/** What the terminal answers a line that asks for npm: a 1986 machine knows no such thing. */
export const NPM_REPLY = '? npm: unbekannter Befehl — AS-86, Baujahr 1986';

const other = (side: ConsoleId): ConsoleId => (side === 'a' ? 'b' : 'a');

// --- the ladder ----------------------------------------------------------------------------

/**
 * One step of the ladder a second: how many are lit at `now`, from the pulse's sending on — none
 * once its last step's second is over, the window's end, whatever grace the server still allows.
 */
export function ladderLit(pulse: Pick<StartupPulse, 'sentAt'> | null, now: number, steps: number) {
  const elapsed = pulse === null ? -1 : Math.max(0, now - pulse.sentAt);
  return elapsed < 0 || elapsed >= steps * 1000 ? 0 : Math.floor(elapsed / 1000) + 1;
}

/** The moment the ladder changes next — a step lighting, or all going dark —; null once dark. */
export function nextStepAt(
  pulse: Pick<StartupPulse, 'sentAt'> | null,
  now: number,
  steps: number,
): number | null {
  const lit = ladderLit(pulse, now, steps);
  return pulse === null || lit === 0 ? null : pulse.sentAt + lit * 1000;
}

/** The pitch, as a meter's volts, the pulse's hum takes on the ladder's `lit`-th step. */
export const humVolts = (lit: number): number => 40 + lit * 14;

/**
 * The hint line under the prompt once `zeige` has answered last: the typed steps the stage
 * still takes, as the device prints them — `setze <lücke> <nr>` for every gap still open, then
 * `start`; null while the log's newest line is another.
 */
export function promptHint(terminal: StartupTerminal): string | null {
  const newest = terminal.log.at(-1);
  if (newest === undefined || !newest.text.startsWith(SHOWN_PREFIX)) {
    return null;
  }
  const open = terminal.gaps.filter((gap) => (terminal.values[gap] ?? null) === null);
  return `Eingabe: ${[...open.map((gap) => `setze ${gap} <nr>`), 'start'].join(' · ')}`;
}

/** The console whose Schaltfeld takes this stage's pulse. */
const armedConsole = (puzzle: StartupPuzzle): ConsoleId => other(puzzle.types);

/**
 * The status strip's words for `puzzle`: the stage, what is live at this console, and what the
 * pulse is doing or came to last.
 */
export function statusOf(puzzle: StartupPuzzle): string {
  const { stage, stages, types, terminal, board, last } = puzzle;
  const head = `Stufe ${stage}/${stages}`;
  const lastWords = last === null ? 'Bereit' : OUTCOME_WORDS[last];
  if (puzzle.role === 'board' && board !== null) {
    const pulse = board.pulse;
    if (pulse === null) {
      const armed = armedConsole(puzzle).toUpperCase();
      return `${head} · Schaltfeld ${armed} aufgeschaltet · ${lastWords}`;
    }
    return `${head} · ${pulse.arrived ? 'Impuls auf den markierten Stufen' : 'Impuls kommt'}`;
  }
  if (terminal?.sent === true) {
    return `${head} · Impuls unterwegs zu Schaltfeld ${other(types).toUpperCase()}`;
  }
  return `${head} · Skript an ${consoleName(types)} · ${lastWords}`;
}

// --- what a change sounds like -------------------------------------------------------------

/** The log lines a change brought: those numbered past the last one before it. */
function linesWith(change: StartupChange): StartupLogLine[] {
  const after = change.after.terminal?.log ?? [];
  const last = Math.max(0, ...(change.before.terminal?.log ?? []).map((line) => line.n));
  return after.filter((line) => line.n > last);
}

/**
 * What a change sounds like: a stage run up with the breaker's relay clacking home and the
 * stage's chime; a failed line or a wrong breaker with the buzz — the alarm's klaxon after
 * it —; a pulse sent with the terminal's two beeps.
 */
export function startupSounds(change: StartupChange): void {
  if (ranUpWith(change)) {
    relayClick();
    stageChime();
  } else if (failedWith(change)) {
    rejectBuzz();
  } else if (sentWith(change)) {
    okChime();
  }
}

/** Whether a change ran a stage up: a breaker more stands closed. */
const ranUpWith = ({ before, after }: StartupChange): boolean =>
  (after.closed?.length ?? 0) > (before.closed?.length ?? 0);

/** Whether a change failed: a line of the log in FEHL, or the pulse killed by a wrong breaker. */
function failedWith(change: StartupChange): boolean {
  const { before, after } = change;
  const wrong = after.last === 'falsch' && before.last !== 'falsch';
  return wrong || linesWith(change).some((line) => line.tag === 'fail');
}

/** Whether a change sent a pulse: the terminal says one is off where it did not. */
const sentWith = ({ before, after }: StartupChange): boolean =>
  after.terminal?.sent === true && before.terminal?.sent !== true;

// --- the terminal --------------------------------------------------------------------------

/** A gap's value as the script shows it: the number set, in brackets, or „?" while open. */
const valueWord = (value: number | null): string => (value === null ? '?' : `[${value}]`);

/**
 * The script's lines as the terminal lists them: every comment on a line of its own, over the
 * command or the gap it explains, so that no line runs much past sixty characters.
 */
export function listed(script: readonly StartupScriptLine[]): ListedLine[] {
  return script.flatMap((line): ListedLine[] => {
    if (line.kind === 'comment') {
      return [{ ...line, clue: false }];
    }
    const own: ListedLine =
      line.kind === 'gap'
        ? { kind: 'gap', gap: line.gap }
        : { kind: 'code', text: line.text, clue: line.comment !== null };
    const comment: ListedLine | null =
      line.comment === null ? null : { kind: 'comment', text: line.comment, clue: true };
    return comment === null ? [own] : [comment, own];
  });
}

/** A line of the script as listed: a comment, a command or a gap, each on a line of its own. */
export type ListedLine =
  /** `clue`: it explains the line under it; the script's heading does not */
  | { kind: 'comment'; text: string; clue: boolean }
  /** `clue`: it carries a comment; `lade anlauf.cfg` does not */
  | { kind: 'code'; text: string; clue: boolean }
  | { kind: 'gap'; gap: StartupGap };

/**
 * A line's classes: a comment's, and — for the heading and a command without a comment, which
 * tell nothing to look up — the plain one a phone held sideways leaves out for room.
 */
function lineClass(line: Exclude<ListedLine, { kind: 'gap' }>): string {
  const comment = line.kind === 'comment' ? ' startup-line--comment' : '';
  return `startup-line${comment}${line.clue ? '' : ' startup-line--plain'}`;
}

/** One line of the script: a comment, a command, or a gap with what it holds. */
function ScriptLine({ line, terminal }: { line: ListedLine; terminal: StartupTerminal }) {
  if (line.kind === 'comment') {
    return <li className={lineClass(line)}>{`# ${line.text}`}</li>;
  }
  if (line.kind === 'code') {
    return <li className={lineClass(line)}>{line.text}</li>;
  }
  const value = terminal.values[line.gap] ?? null;
  return (
    <li className="startup-line" data-gap={line.gap}>
      {`${line.gap} = `}
      <span className={`startup-value startup-value--${value === null ? 'open' : 'set'}`}>
        {valueWord(value)}
      </span>
    </li>
  );
}

/** The script of the stage, line by line, the gaps with what they hold. */
function Script({ terminal }: { terminal: StartupTerminal }) {
  return (
    <ol className="startup-script" aria-label="Anlaufskript">
      {listed(terminal.script).map((line, i) => (
        <ScriptLine key={i} line={line} terminal={terminal} />
      ))}
    </ol>
  );
}

/** How many of the log's last lines the glass shows: the newest always whole at the foot. */
const LOG_SHOWN = 3;

/** The log's last lines, the newest at the foot. */
function Log({ log }: { log: StartupLogLine[] }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const box = list.current;
    if (box !== null) {
      box.scrollTop = box.scrollHeight;
    }
  }, [log]);
  return (
    <ol ref={list} className="servers-log startup-log" aria-label="Protokoll" aria-live="polite">
      {log.slice(-LOG_SHOWN).map((line, i) => (
        <li
          key={line.n}
          className={`servers-line servers-line--${line.tag}`}
          data-n={line.n}
          style={cssVars({ '--i': 4 + i })}
        >
          <span className="servers-tag">{TAGS[line.tag]}</span> {line.text}
        </li>
      ))}
    </ol>
  );
}

/** The terminal's keys: its commands and ⏎, the script's gaps, the feeders' numbers and erase. */
function Keys({ gaps, put }: { gaps: readonly StartupGap[]; put: (key: StartupKey) => void }) {
  const key = (label: string, data: Record<string, string>, pressed: StartupKey) => (
    <button
      key={label}
      type="button"
      className="servers-key startup-key"
      data-feel="blip"
      {...data}
      onClick={() => put(pressed)}
    >
      {label}
    </button>
  );
  const feeders = Array.from({ length: FEEDERS }, (_, i) => i + 1);
  return (
    <div className="servers-keyboard">
      <div className="servers-keys" role="group" aria-label="Befehle">
        {STARTUP_COMMANDS.map((cmd) => key(cmd, { 'data-cmd': cmd }, { cmd }))}
        <button
          type="submit"
          className="servers-key servers-key--enter"
          data-enter=""
          data-feel="blip"
          aria-label="Senden"
        >
          ⏎
        </button>
      </div>
      <div className="servers-keys" role="group" aria-label="Lücken und Abgänge">
        {gaps.map((gap) => key(gap, { 'data-gap': gap }, { gap }))}
        {feeders.map((feeder) =>
          key(String(feeder), { 'data-feeder': String(feeder) }, { feeder }),
        )}
        <button
          type="button"
          className="servers-key startup-key"
          data-erase=""
          data-feel="blip"
          aria-label="Zeichen zurück"
          onClick={() => put({ erase: true })}
        >
          ⌫
        </button>
      </div>
    </div>
  );
}

/** The prompt's line and what holds the keyboard for it, each key typed elsewhere blipping. */
function usePromptLine() {
  const [line, setLine] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const hold = useCallback((input: HTMLInputElement | null) => {
    if (input === null) {
      return undefined;
    }
    field.current = input;
    const release = holdKeys(input, (text) => {
      setLine((now) => now + text);
      setReply(null);
      typeBlip();
    });
    return () => {
      release();
      field.current = null;
    };
  }, []);
  return { line, setLine, reply, setReply, field, hold };
}

/** The prompt at the foot of the glass, holding the keyboard while the terminal is live. */
function Prompt(props: {
  line: string;
  gaps: readonly StartupGap[];
  setLine: (update: (line: string) => string) => void;
  onEdit: (line: string) => void;
  label: RefObject<HTMLLabelElement | null>;
  hold: (input: HTMLInputElement | null) => (() => void) | undefined;
}) {
  const { line, gaps, setLine, onEdit, label, hold } = props;
  return (
    <label className="servers-prompt startup-prompt" ref={label}>
      <span className="servers-ps" aria-hidden="true">
        {'>'}
      </span>
      <span className="servers-field">
        <input
          ref={hold}
          className="servers-input"
          value={line}
          aria-label="Befehl"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => onEdit(event.target.value)}
          onKeyDown={(event) => promptKeyDown(event, setLine, (now) => completed(now, gaps))}
        />
        <span className="servers-echo" aria-hidden="true">
          {line}
          <span className="servers-cursor" />
        </span>
      </span>
    </label>
  );
}

/** Under the prompt: the terminal's own answer to npm or to a line it cannot read, a refusal. */
function Reply(props: { reply: string | null; refused: Refusal | null; hint: string | null }) {
  const { reply, refused, hint } = props;
  if (reply === null && refused === null && hint !== null) {
    return <p className="servers-reply startup-hint">{hint}</p>;
  }
  if (reply !== null) {
    return (
      <p className="servers-reply" role="status">
        {reply}
      </p>
    );
  }
  return refused === null ? null : (
    <p className="servers-reply servers-reply--refused" aria-hidden="true">
      {`! ${refused.message}`}
    </p>
  );
}

/** The terminal's glass: its head, the script, the pulse's word, the log; then the prompt. */
function Glass(props: { terminal: StartupTerminal; children?: ReactNode }) {
  const { terminal, children } = props;
  return (
    <div className="servers-crt startup-crt">
      <Script terminal={terminal} />
      {terminal.sent && <p className="startup-sent">IMPULS UNTERWEGS</p>}
      <Log log={terminal.log} />
      {children}
    </div>
  );
}

/**
 * The live terminal: the glass with the stage's script, and the prompt taking `zeige`, `setze`
 * and `start`, typed or put together on its keys, Enter or ⏎ sending. A line it cannot read, or
 * one asking for npm, it answers at the prompt — which shakes — and sends nothing.
 */
function Terminal(props: {
  puzzle: StartupPuzzle;
  terminal: StartupTerminal;
  send: Send;
  refused: Refusal | null;
}) {
  const { puzzle, terminal, send, refused } = props;
  const { line, setLine, reply, setReply, field, hold } = usePromptLine();
  const label = useRef<HTMLLabelElement>(null);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    keepFocus(field.current);
    if (line.trim() === '') {
      return;
    }
    const read = lineOf(line);
    if (read === null || 'npm' in read) {
      setReply(read === null ? '? Befehl unbekannt' : NPM_REPLY);
      if (label.current !== null) {
        reject(label.current, true);
      }
      return;
    }
    setReply(null);
    send(read.input);
    setLine(() => '');
  };
  const put = (key: StartupKey): void => {
    setLine((now) => withKey(now, key));
    setReply(null);
    keepFocus(field.current);
  };
  const edit = (next: string): void => {
    setLine(() => next);
    setReply(null);
  };
  return (
    <form className="servers servers--terminal startup-terminal" onSubmit={submit}>
      <Glass terminal={terminal}>
        <Prompt
          line={line}
          gaps={terminal.gaps}
          setLine={setLine}
          onEdit={edit}
          label={label}
          hold={hold}
        />
        <Reply reply={reply} refused={refused} hint={promptHint(terminal)} />
      </Glass>
      <div className="servers-bezel">
        <Keys gaps={terminal.gaps} put={put} />
        <Link
          name={`SCHALTFELD ${other(puzzle.types).toUpperCase()}`}
          manned={puzzle.atOtherConsole !== null}
        />
        <TalkButton className="servers-talk">FUNK</TalkButton>
      </div>
    </form>
  );
}

/** The terminal of a console whose Schaltfeld is live: its glass dark but for one line. */
function IdleTerminal({ puzzle }: { puzzle: StartupPuzzle }) {
  const here = (puzzle.console ?? armedConsole(puzzle)).toUpperCase();
  return (
    <p className="startup-armed startup-idle">
      {`TERMINAL ${here} · IN RUHE · SKRIPT AN ${consoleName(puzzle.types).toUpperCase()}`}
    </p>
  );
}

// --- the Schaltfeld ------------------------------------------------------------------------

/** A control lamp: its lens in its colour, or dark, and the colour's word under it. */
function Lamp({ colour, place }: { colour: LampColour; place: 'oben' | 'unten' }) {
  return (
    <span className="startup-lamp-cell">
      <span
        className={`startup-lamp startup-lamp--${colour}`}
        role="img"
        aria-label={`${place} ${LAMP_WORDS[colour]}`}
      />
      <span className="startup-lamp-word" aria-hidden="true">
        {LAMP_WORDS[colour]}
      </span>
    </span>
  );
}

/** The LED ladder: a step a second from its foot, the window's steps marked at its top. */
function Ladder(props: {
  steps: number;
  marked: number;
  pulse: StartupPulse | null;
  audible: boolean;
}) {
  const { steps, marked, pulse, audible } = props;
  const now = useNowUntil(nextStepAt(pulse, serverNow(), steps));
  const lit = ladderLit(pulse, now, steps);
  const heard = useRef(0);
  useEffect(() => {
    if (audible && lit > heard.current) {
      voltageHum(humVolts(lit));
    }
    heard.current = lit;
  }, [lit, audible]);
  const from = steps - marked;
  return (
    <div className="startup-ladder-box" style={cssVars({ '--marked': marked })}>
      <span className="startup-window-word" aria-hidden="true">
        FENSTER
      </span>
      <div className="startup-ladder-row">
        <ol className="startup-ladder" aria-label={`LED-Leiter: ${lit} von ${steps} Stufen`}>
          {Array.from({ length: steps }, (_, i) => steps - 1 - i).map((step) => (
            <li key={step} className={stepClass(step, from, lit)} />
          ))}
        </ol>
        <span className="startup-window" aria-hidden="true" />
      </div>
    </div>
  );
}

/** A step's classes: marked where it lies in the window, lit where the pulse has reached it. */
function stepClass(step: number, from: number, lit: number): string {
  const marked = step >= from ? ' startup-step--marked' : '';
  return `startup-step${marked}${step < lit ? ' startup-step--lit' : ''}`;
}

/** A breaker: a lever thrown up to close, its feeder's number under it. */
function Breaker(props: { feeder: number; closed: boolean; onClose: (() => void) | null }) {
  const { feeder, closed, onClose } = props;
  return (
    <button
      type="button"
      className={`startup-breaker${closed ? ' startup-breaker--closed' : ''}`}
      data-breaker={feeder}
      data-feel="pull"
      aria-label={`Leistungsschalter ${feeder}${closed ? ', geschlossen' : ''}`}
      disabled={onClose === null}
      onClick={onClose ?? undefined}
    >
      <span className="startup-bat" aria-hidden="true" />
      <span className="startup-feeder-no">{feeder}</span>
    </button>
  );
}

/**
 * The live Schaltfeld: each feeder's two lamps over its breaker, the ladder beside them filling
 * as the pulse comes in; a breaker closes with a press.
 */
function Board(props: {
  puzzle: StartupPuzzle;
  board: StartupBoard;
  send: Send | null;
  audible: boolean;
}) {
  const { puzzle, board, send, audible } = props;
  const armed = armedConsole(puzzle).toUpperCase();
  const closed = closedAt(puzzle.closed, armedConsole(puzzle));
  return (
    <div className="startup-board">
      <p className="startup-armed startup-armed--live">{`SCHALTFELD ${armed} · AUFGESCHALTET`}</p>
      <div className="startup-feeders" role="group" aria-label="Abgänge">
        {board.feeders.map(({ feeder, lamps }) => (
          <div key={feeder} className="startup-feeder" data-feeder={feeder}>
            <Lamp colour={lamps[0]} place="oben" />
            <Lamp colour={lamps[1]} place="unten" />
            <Breaker
              feeder={feeder}
              closed={closed.includes(feeder)}
              onClose={send === null ? null : () => send({ breaker: feeder })}
            />
          </div>
        ))}
      </div>
      <Ladder {...puzzle.ladder} pulse={board.pulse} audible={audible} />
    </div>
  );
}

/** The feeders a console's Schaltfeld closed in earlier stages. */
const closedAt = (closed: readonly StartupClosed[] | null, side: ConsoleId | null): number[] =>
  (closed ?? []).filter((entry) => entry.console === side).map((entry) => entry.feeder);

/**
 * The plate over an idle Schaltfeld: this one rests, and which one the stage's pulse goes to
 * instead — „SCHALTFELD A · IN RUHE · AUFGESCHALTET: B".
 */
export function idlePlate(puzzle: StartupPuzzle): string {
  const here = puzzle.types.toUpperCase();
  return `SCHALTFELD ${here} · IN RUHE · AUFGESCHALTET: ${armedConsole(puzzle).toUpperCase()}`;
}

/** The Schaltfeld of a console whose terminal is live: its lamps dark, its breakers at rest. */
function IdleBoard({ puzzle }: { puzzle: StartupPuzzle }) {
  return <p className="startup-armed startup-idle">{idlePlate(puzzle)}</p>;
}

/** The device's status strip: the stage, what is live here and what the pulse came to. */
function Status({ puzzle }: { puzzle: StartupPuzzle }) {
  return (
    <p className="startup-status" role="status">
      <span className="startup-make">ANLAUFSTEUERUNG AS-86</span> {statusOf(puzzle)}
    </p>
  );
}

/** The live Schaltfeld's console: its idle terminal over the Schaltfeld, the bezel's lamp. */
function BoardConsole(props: { puzzle: StartupPuzzle; board: StartupBoard; send: Send }) {
  const { puzzle, board, send } = props;
  return (
    <div className="startup startup--board servers">
      <Status puzzle={puzzle} />
      <div className="startup-device">
        <IdleTerminal puzzle={puzzle} />
        <Board puzzle={puzzle} board={board} send={send} audible />
      </div>
      <div className="servers-bezel startup-bezel">
        <Link
          name={`TERMINAL ${puzzle.types.toUpperCase()}`}
          manned={puzzle.atOtherConsole !== null}
        />
      </div>
    </div>
  );
}

/** Both live parts as the audience sees them, side by side. */
function Watched(props: { puzzle: StartupPuzzle; terminal: StartupTerminal; board: StartupBoard }) {
  const { puzzle, terminal, board } = props;
  return (
    <div className="startup startup--watched servers">
      <Status puzzle={puzzle} />
      <div className="startup-device startup-device--watched">
        <section className="servers-console" aria-label={consoleName(puzzle.types)}>
          <h4 className="servers-console-name">{consoleName(puzzle.types)}</h4>
          <Glass terminal={terminal} />
        </section>
        <section className="servers-console" aria-label={consoleName(other(puzzle.types))}>
          <h4 className="servers-console-name">{consoleName(other(puzzle.types))}</h4>
          <Board puzzle={puzzle} board={board} send={null} audible={false} />
        </section>
      </div>
    </div>
  );
}

/**
 * Anlaufsteuerung at one console. Where its terminal is live, the terminal takes the script's
 * commands beside the idle Schaltfeld; where its Schaltfeld is live, the lamps burn and the
 * breakers close beside the idle terminal. The audience sees both live parts.
 */
export function StartupPanel({ puzzle, send, refused = null }: PanelProps<'startup'>) {
  const { role, terminal, board } = puzzle;
  if (role === 'terminal' && terminal !== null) {
    return (
      <div className="startup startup--terminal servers">
        <Status puzzle={puzzle} />
        <div className="startup-device">
          <Terminal puzzle={puzzle} terminal={terminal} send={send} refused={refused} />
          <IdleBoard puzzle={puzzle} />
        </div>
      </div>
    );
  }
  if (role === 'board' && board !== null) {
    return <BoardConsole puzzle={puzzle} board={board} send={send} />;
  }
  if (terminal !== null && board !== null) {
    return <Watched puzzle={puzzle} terminal={terminal} board={board} />;
  }
  return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
}
