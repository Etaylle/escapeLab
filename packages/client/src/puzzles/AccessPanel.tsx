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
  doorName,
  ROLE_NAMES,
  type AccessAccount,
  type AccessDevice,
  type AccessDoor,
  type AccessDoorRow,
  type AccessLock,
  type AccessLogLine,
  type AccessOpening,
  type AccessSession,
  type AccessTerminal,
  type ConsoleId,
  type ManualBlock,
} from '@escapelab/core';
import { serverNow, timeLeft, type MissionTime } from '../clock.js';
import { alignedLines, type Taken } from '../noting.js';
import { Block } from '../screens/Manual.js';
import { TalkButton } from '../screens/Voice.js';
import { consoleName } from '../world/consoles.js';
import type { Refusal } from '../ws.js';
import {
  ACCESS_COMMANDS,
  completed,
  grouped,
  inputOf,
  withKey,
  type AccessKey,
} from './accessPrompt.js';
import { cssVars, reject, type Change } from './feel.js';
import type { PanelProps, ReaderProps } from './index.js';
import { holdKeys, keepFocus } from './prompt.js';
import { Link, promptKeyDown, Reply } from './ServersPanel.js';
import { countTick, okChime, rejectBuzz, stageChime, typeBlip } from './sounds.js';
import { useNowUntil } from './syncPress.js';
import './access.css';

/**
 * AccessPanel.tsx: the Zugangskontrolle at its two consoles. Console a is a terminal of the
 * Serverraum's make — the same green screen, prompt and keys (styles/servers.css) — that names
 * the doors it asks for, its session and its log; console b a token device: a grey-green LCD
 * with the account it is bound to, that account's token in large digits and a bar that drains
 * to the next period, on the server's clock. The audience sees both side by side and the list;
 * a reader at a source sees the list alone (`AccessList`).
 */

type AccessPuzzle = PanelProps<'access'>['puzzle'];
type AccessChange = Change<AccessPuzzle>;
type Send = PanelProps<'access'>['send'];

/** The last seconds of a period: the bar turns amber, the lamp too, and the device ticks. */
export const ENDING_SEC = 5;

/** The digits of the terminal's pad, as a numeric pad lays them out. */
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;

/** A log line's tag as the terminal prints it. */
const TAGS: Readonly<Record<AccessLogLine['tag'], string>> = {
  ok: '[ OK ]',
  fail: '[FEHL]',
  info: '[INFO]',
};

// --- the clock -----------------------------------------------------------------------------

/**
 * The next moment after `now` (server time) at which a count down to `end` shows another whole
 * second; null once it has run out, and without an end.
 */
export function nextSecond(end: number | null, now: number): number | null {
  if (end === null || end <= now) {
    return null;
  }
  return end - (Math.ceil((end - now) / 1000) - 1) * 1000;
}

/** The earlier of two moments, either of which may be none. */
function earliest(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b;
  }
  return b === null ? a : Math.min(a, b);
}

/** Whole seconds until `end` at `now`, rounded up as a count shows them; 0 once it is past. */
export const secondsTo = (end: number, now: number): number =>
  Math.max(0, Math.ceil((end - now) / 1000));

/** The seconds a lock still holds at `now`, on the mission's clock; 0 once it has lifted. */
export function lockLeft(lock: AccessLock, mission: MissionTime, now: number): number {
  const left = timeLeft(mission, now);
  return left === null ? 0 : Math.max(0, Math.ceil(left / 1000) - lock.liftsAtSec);
}

/**
 * The server's time now, rendered anew as each whole second of what the terminal counts down
 * begins: the door standing open, and a lock — on the mission's clock, which stands still
 * while the run is paused.
 */
function useTerminalNow(terminal: AccessTerminal, mission: MissionTime): number {
  const read = serverNow();
  const open = terminal.open === null ? null : nextSecond(terminal.open.until, read);
  const counting = terminal.locks.length > 0 && mission.pausedAt === null;
  const lock = counting ? nextSecond(mission.deadlineAt, read) : null;
  return useNowUntil(earliest(open, lock));
}

// --- what a change sounds like ---------------------------------------------------------------

/** The log lines a change brought: those numbered past the last one before it. */
function linesWith(change: AccessChange | null): AccessLogLine[] {
  const after = change?.after.terminal?.log ?? null;
  if (change === null || after === null) {
    return [];
  }
  const last = Math.max(0, ...(change.before.terminal?.log ?? []).map((line) => line.n));
  return after.filter((line) => line.n > last);
}

/** The doors the terminal of `view` shows released; none where the view has no terminal. */
const releasedIn = (view: AccessPuzzle): AccessDoor[] =>
  view.terminal?.doors.filter((row) => row.released).map((row) => row.door) ?? [];

/** Whether a change released a door: the terminal's list counts more of them released. */
const releasedWith = (change: AccessChange): boolean =>
  releasedIn(change.after).length > releasedIn(change.before).length;

/** Whether a change turned the token device to its next period. */
const turnedWith = (change: AccessChange): boolean =>
  change.after.device !== null && change.after.device.endsAt !== change.before.device?.endsAt;

/**
 * What a change sounds like: at the terminal a door released with the stage's chime, a failed
 * line's buzz — the alarm's klaxon after it — or a session opening chiming; at the token device
 * the display taking the next period's token.
 */
export function accessSounds(change: AccessChange): void {
  const lines = linesWith(change);
  if (releasedWith(change)) {
    stageChime();
  } else if (lines.some((line) => line.tag === 'fail')) {
    rejectBuzz();
  } else if (lines.some((line) => line.tag === 'ok')) {
    okChime();
  }
  if (turnedWith(change)) {
    typeBlip();
  }
}

// --- the terminal ----------------------------------------------------------------------------

/** Whether somebody stands at the other console: the backup the view names stands there. */
function otherManned(puzzle: AccessPuzzle): boolean {
  if (puzzle.console === null) {
    return false;
  }
  const other: ConsoleId = puzzle.console === 'a' ? 'b' : 'a';
  return puzzle.backup?.where === consoleName(other);
}

/** A door's state on the terminal: asked for, standing open with its seconds, or released. */
export function doorStatus(
  row: AccessDoorRow,
  open: AccessOpening | null,
  now: number,
): { text: string; tone: 'asked' | 'open' | 'done' } {
  if (open !== null && open.door === row.door && open.until > now) {
    return { text: `OFFEN ${secondsTo(open.until, now)} s`, tone: 'open' };
  }
  return row.released
    ? { text: 'FREIGEGEBEN', tone: 'done' }
    : { text: 'ANGEFORDERT', tone: 'asked' };
}

/** The session as the terminal's line names it: its account, at Stufe 2 its role; „—" for none. */
export function sessionWord(session: AccessSession | null): string {
  if (session === null) {
    return '—';
  }
  return 'account' in session ? session.account : ROLE_NAMES[session.role].toUpperCase();
}

/** The doors the terminal asks for, each with its state, a door just released glowing up. */
function Doors(props: { terminal: AccessTerminal; now: number; fresh: AccessDoor | null }) {
  const { terminal, now, fresh } = props;
  return (
    <table className="access-doors">
      <thead>
        <tr>
          <th scope="col">TÜR</th>
          <th scope="col">STATUS</th>
        </tr>
      </thead>
      <tbody>
        {terminal.doors.map((row, i) => {
          const status = doorStatus(row, terminal.open, now);
          const turned = fresh === row.door ? ' access-door--turned' : '';
          return (
            <tr
              key={row.door}
              className={`access-door access-door--${status.tone}${turned}`}
              data-door={row.door}
              style={cssVars({ '--i': i + 1 })}
            >
              <th scope="row">{doorName(row.door)}</th>
              <td>
                <span className="access-door-status">{status.text}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The session line, and a line for every account a lock still holds, its seconds counting down. */
function Session(props: { terminal: AccessTerminal; mission: MissionTime; now: number }) {
  const { terminal, mission, now } = props;
  const held = terminal.locks.flatMap((lock) => {
    const left = lockLeft(lock, mission, now);
    return left > 0 ? [{ account: lock.account, left }] : [];
  });
  return (
    <div className="access-session">
      <p className="access-session-line" data-session={sessionWord(terminal.session)}>
        <span className="access-session-label">SITZUNG</span> {sessionWord(terminal.session)}
      </p>
      {held.map(({ account, left }) => (
        <p key={account} className="access-lock" data-account={account}>
          <span className="access-session-label">GESPERRT</span> {`${account} · ${left} s`}
        </p>
      ))}
    </div>
  );
}

/** The log's last lines, the newest at the foot; the lines a change brought type in. */
function Log({ log, fresh }: { log: AccessLogLine[]; fresh: ReadonlySet<number> }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const box = list.current;
    if (box !== null) {
      box.scrollTop = box.scrollHeight;
    }
  }, [log]);
  return (
    <ol ref={list} className="servers-log access-log" aria-label="Protokoll" aria-live="polite">
      {log.map((line, i) => (
        <li
          key={line.n}
          className={`servers-line servers-line--${line.tag}${fresh.has(line.n) ? ' servers-line--new' : ''}`}
          data-n={line.n}
          style={cssVars({ '--i': 4 + i })}
        >
          <span className="servers-tag">{TAGS[line.tag]}</span> {line.text}
        </li>
      ))}
    </ol>
  );
}

/** The door a change released, for its row to glow up; null for none. */
function freshDoor(change: AccessChange | null): AccessDoor | null {
  if (change === null) {
    return null;
  }
  const before = releasedIn(change.before);
  return releasedIn(change.after).find((door) => !before.includes(door)) ?? null;
}

/**
 * The terminal's glass: its head — the machine and its Sicherheitsstufe —, the doors, the
 * session, the log and, under it, whatever is given to stand at its foot: the prompt.
 */
function Screen(props: {
  terminal: AccessTerminal;
  mission: MissionTime;
  change: AccessChange | null;
  children?: ReactNode;
}) {
  const { terminal, mission, change, children } = props;
  const now = useTerminalNow(terminal, mission);
  const fresh = new Set(linesWith(change).map((line) => line.n));
  return (
    <div className={`servers-crt access-crt${change === null ? ' servers-crt--boot' : ''}`}>
      <p className="access-head">
        <span>ZUGANGSKONTROLLE</span>
        <span className={terminal.strict ? 'access-level access-level--2' : 'access-level'}>
          {terminal.strict ? 'STUFE 2' : 'STUFE 1'}
        </span>
      </p>
      <Doors terminal={terminal} now={now} fresh={freshDoor(change)} />
      <Session terminal={terminal} mission={mission} now={now} />
      <Log log={terminal.log} fresh={fresh} />
      {children}
    </div>
  );
}

/**
 * The terminal's keys: a key for every command and the one that sends; under them a key for
 * every door it asks for — or, while the prompt asks for a token, a numeric pad with the key
 * that takes a digit back.
 */
export function Keys(props: {
  doors: readonly AccessDoor[];
  prompting: boolean;
  put: (key: AccessKey) => void;
}) {
  const { doors, prompting, put } = props;
  return (
    <div className="servers-keyboard access-keyboard">
      <div className="servers-keys" role="group" aria-label="Befehle">
        {ACCESS_COMMANDS.map((cmd) => (
          <button
            key={cmd}
            type="button"
            className="servers-key servers-key--cmd"
            data-cmd={cmd}
            data-feel="blip"
            onClick={() => put({ cmd })}
          >
            {cmd}
          </button>
        ))}
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
      {prompting ? (
        <div className="servers-keys access-pad" role="group" aria-label="Ziffern">
          {DIGITS.map((digit) => (
            <button
              key={digit}
              type="button"
              className="servers-key access-key"
              data-digit={digit}
              data-feel="blip"
              onClick={() => put({ digit })}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            className="servers-key access-key"
            data-erase=""
            data-feel="blip"
            aria-label="Zeichen zurück"
            onClick={() => put({ erase: true })}
          >
            ⌫
          </button>
        </div>
      ) : (
        <div className="servers-keys" role="group" aria-label="Türen">
          {doors.map((door) => (
            <button
              key={door}
              type="button"
              className="servers-key"
              data-door={door}
              data-feel="blip"
              onClick={() => put({ door })}
            >
              {door}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The prompt at the foot of the screen: „>" for a command, „TOKEN <konto> ›" while it asks for
 * the account's token — a numeric keyboard under a finger then. It holds the keyboard while the
 * terminal is up (prompt.ts), Tab completing a command or a door the terminal asks for.
 */
function Prompt(props: {
  asking: string | null;
  line: string;
  doors: readonly AccessDoor[];
  setLine: (update: (line: string) => string) => void;
  onEdit: (line: string) => void;
  label: RefObject<HTMLLabelElement | null>;
  hold: (input: HTMLInputElement | null) => (() => void) | undefined;
}) {
  const { asking, line, doors, setLine, onEdit, label, hold } = props;
  return (
    <label className="servers-prompt access-prompt" ref={label}>
      <span className="servers-ps" aria-hidden="true">
        {asking === null ? '>' : `TOKEN ${asking} ›`}
      </span>
      <span className="servers-field">
        <input
          ref={hold}
          className="servers-input"
          value={line}
          aria-label={asking === null ? 'Befehl' : `Token für ${asking}`}
          inputMode={asking === null ? 'text' : 'numeric'}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => onEdit(event.target.value)}
          onKeyDown={(event) => promptKeyDown(event, setLine, (now) => completed(now, doors))}
        />
        <span className="servers-echo" aria-hidden="true">
          {line}
          <span className="servers-cursor" />
        </span>
      </span>
    </label>
  );
}

/**
 * The prompt's line and what holds the keyboard for it: the field taking every key typed
 * elsewhere while it is up (prompt.ts `holdKeys`), each with its blip.
 */
function usePromptLine() {
  const [line, setLine] = useState('');
  const [unread, setUnread] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);
  const hold = useCallback((input: HTMLInputElement | null) => {
    if (input === null) {
      return undefined;
    }
    field.current = input;
    const release = holdKeys(input, (text) => {
      setLine((now) => now + text);
      setUnread(false);
      typeBlip();
    });
    return () => {
      release();
      field.current = null;
    };
  }, []);
  return { line, setLine, unread, setUnread, field, hold };
}

/**
 * Console a: the terminal. The screen names the doors it asks for, its session and its log;
 * the prompt takes a command or a token typed or put together on the keys and sends it with
 * Enter or ⏎. A line it cannot read it answers at the prompt — which shakes — and sends
 * nothing, as it answers a command the server refuses. The TOKEN lamp on its bezel burns while
 * somebody stands at the token device; the FUNK key talks.
 */
function Terminal(props: {
  puzzle: AccessPuzzle;
  terminal: AccessTerminal;
  mission: MissionTime;
  change: AccessChange | null;
  send: Send;
  refused: Refusal | null;
}) {
  const { puzzle, terminal, mission, change, send, refused } = props;
  const { line, setLine, unread, setUnread, field, hold } = usePromptLine();
  const label = useRef<HTMLLabelElement>(null);
  const doors = terminal.doors.map((row) => row.door);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    keepFocus(field.current);
    if (line.trim() === '') {
      return;
    }
    const input = inputOf(line);
    setUnread(input === null);
    if (input === null) {
      if (label.current !== null) {
        reject(label.current, true);
      }
      return;
    }
    send(input);
    setLine('');
  };
  const put = (key: AccessKey): void => {
    setLine((now) => withKey(now, key));
    setUnread(false);
    keepFocus(field.current);
  };
  const edit = (next: string): void => {
    setLine(() => next);
    setUnread(false);
  };
  return (
    <form className="servers servers--terminal access access--terminal" onSubmit={submit}>
      <Screen terminal={terminal} mission={mission} change={change}>
        <Prompt
          asking={terminal.prompt}
          line={line}
          doors={doors}
          setLine={setLine}
          onEdit={edit}
          label={label}
          hold={hold}
        />
        <Reply unread={unread} refused={refused} />
      </Screen>
      <div className="servers-bezel">
        <Keys doors={doors} prompting={terminal.prompt !== null} put={put} />
        <Link name="TOKEN" manned={otherManned(puzzle)} />
        <TalkButton className="servers-talk">FUNK</TalkButton>
      </div>
    </form>
  );
}

// --- the token device ------------------------------------------------------------------------

/**
 * The bar of a period: full as it begins, draining to nothing at its end, from where the
 * period stands as it mounts — its timing set once, so that the seconds rendered after it move
 * nothing; under reduced motion it steps with them (`--bar-left`). One per period (`key`).
 */
function Bar({ device, leftMs }: { device: AccessDevice; leftMs: number }) {
  const total = device.periodSec * 1000;
  const [timing] = useState(() => ({ ms: total, delay: -(total - leftMs) }));
  const style = cssVars({
    '--bar-ms': `${timing.ms}ms`,
    '--bar-delay': `${timing.delay}ms`,
    '--bar-left': Math.min(1, leftMs / total).toFixed(3),
  });
  return <span className="access-bar-fill" style={style} />;
}

/** The device's tick, once each of a period's last ENDING_SEC whole seconds. */
function useEndingTicks(endsAt: number, left: number, audible: boolean): void {
  const heard = useRef<string | null>(null);
  useEffect(() => {
    const second = `${endsAt}/${left}`;
    if (audible && left > 0 && left <= ENDING_SEC && heard.current !== second) {
      heard.current = second;
      countTick();
    }
  }, [endsAt, left, audible]);
}

/**
 * The token device's display: KONTO and the account it is bound to, the token in two groups of
 * three, the bar draining to the period's end and the seconds left beside it — amber in the
 * last ENDING_SEC. A new token types in as its period begins.
 */
function TokenScreen({ device, audible }: { device: AccessDevice; audible: boolean }) {
  const now = useNowUntil(nextSecond(device.endsAt, serverNow()));
  const leftMs = Math.max(0, device.endsAt - now);
  const left = secondsTo(device.endsAt, now);
  useEndingTicks(device.endsAt, left, audible);
  const ending = left <= ENDING_SEC;
  return (
    <div className={`access-lcd${ending ? ' access-lcd--ending' : ''}`}>
      <p className="access-account">
        <span className="access-account-label">KONTO</span>{' '}
        <span className="access-account-name">{device.account}</span>
      </p>
      <p key={device.token} className="access-digits" data-token={device.token}>
        {grouped(device.token)}
      </p>
      <div className="access-bar" role="timer" aria-label={`Wechsel in ${left} s`}>
        <Bar key={device.endsAt} device={device} leftMs={leftMs} />
      </div>
      <p className="access-left">{`${left} s`}</p>
    </div>
  );
}

/**
 * Console b: the token device, a fob of dark plastic round its LCD, its make moulded over it;
 * the TERMINAL lamp on its bezel burns while somebody stands at the terminal. It takes no
 * input: its words are read out.
 */
function TokenDevice({ puzzle, device }: { puzzle: AccessPuzzle; device: AccessDevice }) {
  return (
    <div className="access access--token">
      <div className="access-fob">
        <p className="access-fob-head">
          <span className="device-engraving">ZK-2 TOKEN</span>
        </p>
        <TokenScreen device={device} audible />
      </div>
      <div className="servers-bezel access-bezel">
        <Link name="TERMINAL" manned={otherManned(puzzle)} />
      </div>
    </div>
  );
}

// --- the list at a source --------------------------------------------------------------------

/** The run's list as its page prints it: each account and its role. */
export function rosterBlock(roster: readonly AccessAccount[]): Extract<ManualBlock, { kind: 'table' }> {
  return {
    kind: 'table',
    head: ['Konto', 'Rolle'],
    rows: roster.map((entry) => [entry.name, ROLE_NAMES[entry.role]]),
  };
}

/** The list as the notepad takes it down: its columns aligned under their names. */
export function rosterTaken(station: { index: number }, roster: readonly AccessAccount[]): Taken {
  const { head, rows } = rosterBlock(roster);
  return {
    part: 'Benutzerliste',
    key: `${station.index}/benutzerliste`,
    lines: alignedLines([head, ...rows]),
    form: 'table',
  };
}

/** The list of this shift's accounts and their roles, the notepad's „Notieren" beside it. */
function Roster({ roster, index }: { roster: readonly AccessAccount[]; index: number }) {
  return (
    <section className="access-roster" aria-label="Benutzerliste">
      <h4 className="access-roster-head">Benutzerliste dieser Schicht</h4>
      <Block block={rosterBlock(roster)} noted={rosterTaken({ index }, roster)} />
    </section>
  );
}

/** The list at a source covering the station: the run's accounts with their roles. */
export function AccessList({ puzzle }: ReaderProps<'access'>) {
  return puzzle.roster === null ? null : <Roster roster={puzzle.roster} index={puzzle.index} />;
}

// --- the audience ----------------------------------------------------------------------------

/** Both consoles as the audience sees them, side by side, and the list under them. */
function Watched(props: {
  terminal: AccessTerminal;
  device: AccessDevice;
  roster: AccessAccount[] | null;
  mission: MissionTime;
  index: number;
}) {
  const { terminal, device, roster, mission, index } = props;
  return (
    <div className="servers-watch">
      <div className="servers servers--watched access access--watched">
        <section className="servers-console" aria-label={consoleName('a')}>
          <h4 className="servers-console-name">{consoleName('a')}</h4>
          <Screen terminal={terminal} mission={mission} change={null} />
        </section>
        <section className="servers-console" aria-label={consoleName('b')}>
          <h4 className="servers-console-name">{consoleName('b')}</h4>
          <div className="access-fob">
            <TokenScreen device={device} audible={false} />
          </div>
        </section>
      </div>
      {roster !== null && <Roster roster={roster} index={index} />}
    </div>
  );
}

/**
 * Zugangskontrolle at one console. Console a, the terminal, takes `login`, the token, `status`
 * and `freigeben` — a command refused answered at its prompt; console b, the token device,
 * shows the account it is bound to and that account's token while its bar drains. The audience
 * sees both side by side, and the list.
 */
export function AccessPanel({ puzzle, change, send, mission, refused = null }: PanelProps<'access'>) {
  const { role, terminal, device, roster } = puzzle;
  if (role === 'terminal' && terminal !== null) {
    return (
      <Terminal
        puzzle={puzzle}
        terminal={terminal}
        mission={mission}
        change={change}
        send={send}
        refused={refused}
      />
    );
  }
  if (role === 'token' && device !== null) {
    return <TokenDevice puzzle={puzzle} device={device} />;
  }
  if (terminal !== null && device !== null) {
    return (
      <Watched
        terminal={terminal}
        device={device}
        roster={roster}
        mission={mission}
        index={puzzle.index}
      />
    );
  }
  return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
}
