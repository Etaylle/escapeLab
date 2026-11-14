import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  DEPENDS_ON,
  SERVICES,
  serviceName,
  type ConsoleId,
  type PuzzleInputOf,
  type RackUnit,
  type ServerLed,
  type ServerLogLine,
  type ServerRow,
  type Service,
} from '@escapelab/core';
import { alignedLines, type NotedStation, type Place, type Taken } from '../noting.js';
import { NoteButton } from '../screens/NoteButton.js';
import { TalkButton } from '../screens/Voice.js';
import { consoleName } from '../world/consoles.js';
import type { Refusal } from '../ws.js';
import { DeviceLamp } from './Device.js';
import { cssVars, reject, type Change } from './feel.js';
import type { PanelProps } from './index.js';
import { holdKeys, keepFocus } from './prompt.js';
import { RackDiagram } from './RackDiagram.js';
import { lampPop, okChime, rejectBuzz, spinUp, typeBlip } from './sounds.js';

type ServersPuzzle = PanelProps<'servers'>['puzzle'];
type ServersChange = Change<ServersPuzzle>;
/** What the terminal sends: a command, as the prompt reads it. */
type CommandInput = Extract<PuzzleInputOf<'servers'>, { cmd: string }>;
type Send = PanelProps<'servers'>['send'];

/** The terminal's commands, as its keys and its prompt take them. */
export const COMMANDS = ['start', 'restart', 'status'] as const;
type Command = (typeof COMMANDS)[number];

/** A log line's tag as the terminal prints it. */
const TAGS: Readonly<Record<ServerLogLine['tag'], string>> = {
  ok: '[ OK ]',
  fail: '[FEHL]',
  warn: '[WARN]',
  info: '[INFO]',
};

/** What an LED says, for a screen reader: the rack has no word on it. */
const LED_WORDS: Readonly<Record<ServerLed, string>> = {
  green: 'läuft',
  red: 'Fehler',
  off: 'kein Strom',
};

const isCommand = (word: string): word is Command => COMMANDS.some((cmd) => cmd === word);
const isService = (word: string): word is Service => SERVICES.some((service) => service === word);

/** The words of a command line, lower-cased, the blanks between them dropped. */
const wordsIn = (line: string): string[] =>
  line
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');

/** The input a typed line sends: `status`, or `start`/`restart` and one service; null otherwise. */
export function commandOf(line: string): CommandInput | null {
  const [cmd, service, ...more] = wordsIn(line);
  if (more.length > 0 || cmd === undefined) {
    return null;
  }
  if (cmd === 'status') {
    return service === undefined ? { cmd } : null;
  }
  if ((cmd === 'start' || cmd === 'restart') && service !== undefined && isService(service)) {
    return { cmd, service };
  }
  return null;
}

/**
 * A command line with one word put in by a key: the command it names, or
 * the service — whichever of them the line already names stays, wherever it
 * stood, and the rest of it goes. `status` takes no service.
 */
export function withWord(line: string, word: { cmd: Command } | { service: Service }): string {
  const words = wordsIn(line);
  const cmd = 'cmd' in word ? word.cmd : (words.find(isCommand) ?? null);
  const service = 'service' in word ? word.service : (words.find(isService) ?? null);
  return cmd === 'status' ? cmd : [cmd, service].filter((part) => part !== null).join(' ');
}

/** Whether a command takes a service after it: `start` and `restart` do, `status` does not. */
const takesService = (word: string | undefined): boolean => word === 'start' || word === 'restart';

/** The longest start every one of `words` shares. */
export function sharedStart(words: readonly string[]): string {
  const [first = '', ...rest] = words;
  let length = first.length;
  for (const word of rest) {
    while (!word.startsWith(first.slice(0, length))) {
      length -= 1;
    }
  }
  return first.slice(0, length);
}

/**
 * `line` with its last word completed, as Tab completes it: the first word to a command, the
 * word after `start` or `restart` to a service — as far as every word it could still become
 * agrees, whole where one alone fits, a command that takes a service with the blank after it.
 * A line it cannot complete stays as it was.
 */
export function completed(line: string): string {
  const [, before = '', word = ''] = /^(.*?)(\S*)$/s.exec(line) ?? [];
  const said = wordsIn(before);
  const words: readonly string[] =
    said.length === 0 ? COMMANDS : said.length === 1 && takesService(said[0]) ? SERVICES : [];
  const fits = words.filter((candidate) => candidate.startsWith(word.toLowerCase()));
  const [only] = fits;
  if (only === undefined) {
    return line;
  }
  if (fits.length > 1) {
    return `${before}${sharedStart(fits)}`;
  }
  return `${before}${only}${said.length === 0 && takesService(only) ? ' ' : ''}`;
}

/** What Enter made of the prompt's line. */
export type Entered =
  | { kind: 'empty' }
  | { kind: 'unread' }
  | { kind: 'sent'; input: CommandInput };

/**
 * Enter at the prompt: a line the terminal reads goes out as its command by `send`, one it
 * cannot read is answered at the prompt and sends nothing, an empty one does nothing — and the
 * prompt keeps the keyboard for the next line (`field`, prompt.ts `keepFocus`) whichever it was,
 * even where ⏎ was the bezel's key. What it came to.
 */
export function enter(
  line: string,
  send: (input: CommandInput) => void,
  field: Pick<HTMLElement, 'focus'> | null,
): Entered {
  keepFocus(field);
  if (wordsIn(line).length === 0) {
    return { kind: 'empty' };
  }
  const input = commandOf(line);
  if (input === null) {
    return { kind: 'unread' };
  }
  send(input);
  return { kind: 'sent', input };
}

/**
 * A key going down at the prompt: Tab completes the line's last word — as `complete` does, by
 * default the Serverraum's `completed` — and keeps the focus where it is — Shift+Tab still goes
 * back through the controls —; every other key does what it does, Enter sending and Esc stepping
 * back from the device. Every key that types, takes a character back or completes blips.
 */
export function promptKeyDown(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'preventDefault'>,
  setLine: (update: (line: string) => string) => void,
  complete: (line: string) => string = completed,
): void {
  const tab = e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
  if (tab) {
    e.preventDefault();
    setLine(complete);
  }
  if (tab || e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
    typeBlip();
  }
}

/** The log lines a change brought: those numbered past the last one before it. */
function linesWith(change: ServersChange | null): ServerLogLine[] {
  const after = change?.after.log ?? null;
  if (change === null || after === null) {
    return [];
  }
  const last = Math.max(0, ...(change.before.log ?? []).map((line) => line.n));
  return after.filter((line) => line.n > last);
}

/** The units whose LED a change turned: lit, put out, or from one colour to the other. */
function ledsWith(change: ServersChange | null): RackUnit[] {
  const after = change?.after.rack ?? null;
  if (change === null || after === null) {
    return [];
  }
  const before = new Map((change.before.rack ?? []).map((unit) => [unit.service, unit.led]));
  return after.filter((unit) => before.has(unit.service) && before.get(unit.service) !== unit.led);
}

/** The services whose row a change turned: up, down, or its power switched. */
function rowsWith(change: ServersChange | null): Set<Service> {
  const before = new Map((change?.before.rows ?? []).map((row) => [row.service, row]));
  const turned = (change?.after.rows ?? []).filter((row) => {
    const was = before.get(row.service);
    return was !== undefined && (was.running !== row.running || was.power !== row.power);
  });
  return new Set(turned.map((row) => row.service));
}

/**
 * What a change sounds like: at the terminal a failed line's buzz — the
 * alarm's klaxon after it — or a line come up OK chiming; at the rack a
 * server spinning up as its LED goes green, an LED popping on red.
 */
export function serversSounds(change: ServersChange): void {
  const lines = linesWith(change);
  if (lines.some((line) => line.tag === 'fail')) {
    rejectBuzz();
  } else if (lines.some((line) => line.tag === 'ok')) {
    okChime();
  }
  const leds = ledsWith(change);
  if (leds.some((unit) => unit.led === 'green')) {
    spinUp();
  } else if (leds.some((unit) => unit.led === 'red')) {
    lampPop();
  }
}

/** Whether somebody stands at the other console: the backup the view names stands there. */
function otherManned(puzzle: ServersPuzzle): boolean {
  if (puzzle.console === null) {
    return false;
  }
  const other: ConsoleId = puzzle.console === 'a' ? 'b' : 'a';
  return puzzle.backup?.where === consoleName(other);
}

/**
 * A lamp on the bezel, lit while somebody stands at the console it names — on the Serverraum's
 * terminal and rack, and on the Zugangskontrolle's terminal and token device.
 */
export function Link({ name, manned }: { name: string; manned: boolean }) {
  return (
    <div
      className="servers-link"
      role="img"
      aria-label={`${name}: ${manned ? 'besetzt' : 'leer'}`}
    >
      <DeviceLamp tone={manned ? 'green' : 'off'} />
      <span className="device-engraving">{name}</span>
    </div>
  );
}

/** A row's status as the table prints it: RUNNING, or FEHLER and its code. */
const statusOf = (row: ServerRow): string => (row.running ? 'RUNNING' : `FEHLER ${row.code ?? ''}`);

/**
 * What a service needs running before it starts, as the table prints it: the fixed graph of
 * the printed Netzplan (core's DEPENDS_ON) — „AUTH, DB", or „—" for nothing.
 */
export const needsOf = (service: Service): string =>
  DEPENDS_ON[service].length === 0 ? '—' : DEPENDS_ON[service].map(serviceName).join(', ');

/** Where the notepad takes the status table down: the terminal. */
export const TERMINAL: Place = { id: 'terminal', name: 'Terminal' };

/**
 * The terminal's status table as the notepad takes it down: a row a service as printed — its
 * status, its power, what it needs running first — under the columns' names, aligned.
 */
export function terminalTaken(station: NotedStation, rows: readonly ServerRow[]): Taken {
  const table = rows.map((row) => [
    serviceName(row.service),
    statusOf(row),
    row.power ? 'AN' : 'AUS',
    needsOf(row.service),
  ]);
  return {
    part: 'Dienste',
    key: `${station.index}/dienste`,
    lines: alignedLines([['Dienst', 'Status', 'Strom', 'Braucht'], ...table]),
    form: 'table',
  };
}

/**
 * The status table: every service with its status, its power, as the rack
 * reports it, and what it needs running first. A row just turned flashes;
 * printed anew, the rows type in one after the other (`printed`, the times
 * `status` asked).
 */
function Table(props: { rows: ServerRow[]; turned: Set<Service>; printed: number }) {
  const { rows, turned, printed } = props;
  return (
    <table
      key={printed}
      className={printed > 0 ? 'servers-table servers-table--printed' : 'servers-table'}
    >
      <thead>
        <tr>
          <th scope="col">DIENST</th>
          <th scope="col">STATUS</th>
          <th scope="col">STROM</th>
          <th scope="col">BRAUCHT</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={row.service}
            className={[
              'servers-row',
              row.running ? 'servers-row--running' : 'servers-row--down',
              turned.has(row.service) ? 'servers-row--turned' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-service={row.service}
            style={cssVars({ '--i': i })}
          >
            <th scope="row">{serviceName(row.service)}</th>
            <td className="servers-status">
              <span>{statusOf(row)}</span>
            </td>
            <td className={row.power ? 'servers-power' : 'servers-power servers-power--off'}>
              {row.power ? 'AN' : 'AUS'}
            </td>
            <td className="servers-needs">{needsOf(row.service)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The class a line the last change brought carries: it types in. */
const NEW_LINE = ' servers-line--new';

/**
 * The log's last lines, the newest at the foot; the lines a change brought type in. Where the
 * log scrolls in a box of its own (a phone held sideways), the newest line is the one in sight.
 */
function Log({ log, fresh }: { log: ServerLogLine[]; fresh: Set<number> }) {
  const list = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const box = list.current;
    if (box !== null) {
      box.scrollTop = box.scrollHeight;
    }
  }, [log]);
  return (
    <ol ref={list} className="servers-log" aria-label="Protokoll" aria-live="polite">
      {log.map((line, i) => (
        <li
          key={line.n}
          className={`servers-line servers-line--${line.tag}${fresh.has(line.n) ? NEW_LINE : ''}`}
          data-n={line.n}
          style={cssVars({ '--i': SERVICES.length + i })}
        >
          <span className="servers-tag">{TAGS[line.tag]}</span> {line.text}
        </li>
      ))}
    </ol>
  );
}

/** The screen's glass: the table over the log, scrolling in line by line as the terminal boots. */
function Screen(props: {
  rows: ServerRow[];
  log: ServerLogLine[];
  change: ServersChange | null;
  printed: number;
  children?: ReactNode;
}) {
  const { rows, log, change, printed, children } = props;
  const fresh = new Set(linesWith(change).map((line) => line.n));
  return (
    <div className={change === null ? 'servers-crt servers-crt--boot' : 'servers-crt'}>
      <Table rows={rows} turned={rowsWith(change)} printed={printed} />
      <Log log={log} fresh={fresh} />
      {children}
    </div>
  );
}

/** The terminal's keys: a key for every command and every service, and the one that sends. */
export function Keys({ put }: { put: (word: { cmd: Command } | { service: Service }) => void }) {
  return (
    <div className="servers-keyboard">
      <div className="servers-keys" role="group" aria-label="Befehle">
        {COMMANDS.map((cmd) => (
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
      <div className="servers-keys" role="group" aria-label="Dienste">
        {SERVICES.map((service) => (
          <button
            key={service}
            type="button"
            className="servers-key"
            data-service={service}
            data-feel="blip"
            onClick={() => put({ service })}
          >
            {service}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The answer under the prompt: „? Befehl unbekannt" for a line the terminal cannot read, and a
 * command the server refused, as the device's head says it too — there for the eye at the line
 * that was typed, its words read out once, by the head.
 */
export function Reply({ unread, refused }: { unread: boolean; refused: Refusal | null }) {
  if (unread) {
    return (
      <p className="servers-reply" role="status">
        ? Befehl unbekannt
      </p>
    );
  }
  return refused === null ? null : (
    <p className="servers-reply servers-reply--refused" aria-hidden="true">
      {`! ${refused.message}`}
    </p>
  );
}

/**
 * Console a: the terminal. The green screen shows the table and the log; under it the prompt
 * takes a command typed or put together on the keys, Tab completing a command or a service, and
 * sends it with Enter or ⏎. A line it cannot read it answers at the prompt — which shakes — and
 * sends nothing, as it answers a command the server refuses; `status` prints the table anew.
 * The prompt holds the keyboard while the terminal is up (prompt.ts): it takes the focus as it
 * opens and after every command and key, every key typed elsewhere goes to it, and V types
 * there like any letter — the bezel's FUNK key and L1 talk. The RACK lamp on its bezel burns
 * while somebody stands at the rack, and beside it „Notieren" takes the table down into the
 * notepad as it stands.
 */
function Terminal(props: {
  puzzle: ServersPuzzle;
  rows: ServerRow[];
  log: ServerLogLine[];
  change: ServersChange | null;
  send: Send;
  refused: Refusal | null;
}) {
  const { puzzle, rows, log, change, send, refused } = props;
  const [line, setLine] = useState('');
  const [unread, setUnread] = useState(false);
  const [printed, setPrinted] = useState(0);
  const prompt = useRef<HTMLLabelElement>(null);
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
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const entered = enter(line, send, field.current);
    if (entered.kind === 'unread') {
      setUnread(true);
      if (prompt.current !== null) {
        reject(prompt.current, true);
      }
    } else if (entered.kind === 'sent') {
      setUnread(false);
      setLine('');
      if (entered.input.cmd === 'status') {
        setPrinted((n) => n + 1);
      }
    }
  };
  const put = (word: { cmd: Command } | { service: Service }): void => {
    setLine((now) => withWord(now, word));
    keepFocus(field.current);
  };
  return (
    <form className="servers servers--terminal" onSubmit={submit}>
      <Screen rows={rows} log={log} change={change} printed={printed}>
        <label className="servers-prompt" ref={prompt}>
          <span className="servers-ps" aria-hidden="true">
            &gt;
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
              onChange={(event) => {
                setLine(event.target.value);
                setUnread(false);
              }}
              onKeyDown={(event) => promptKeyDown(event, setLine)}
            />
            {/* What was typed, in phosphor, the block cursor after it: the field's is hidden. */}
            <span className="servers-echo" aria-hidden="true">
              {line}
              <span className="servers-cursor" />
            </span>
          </span>
        </label>
        <Reply unread={unread} refused={refused} />
      </Screen>
      <div className="servers-bezel">
        <Keys put={put} />
        <Link name="RACK" manned={otherManned(puzzle)} />
        <TalkButton className="servers-talk">FUNK</TalkButton>
        <NoteButton taken={terminalTaken(puzzle, rows)} place={TERMINAL} />
      </div>
    </form>
  );
}

/** One unit of the rack: its plate, its vents, its LED, and its switch where it is worked. */
function Unit({ unit, fresh, send }: { unit: RackUnit; fresh: boolean; send: Send | null }) {
  const name = serviceName(unit.service);
  const toggle = unit.power ? 'servers-switch servers-switch--on' : 'servers-switch';
  const marks = (
    <span className="servers-marks" aria-hidden="true">
      <span>I</span>
      <span>O</span>
    </span>
  );
  return (
    <li className="servers-unit" data-service={unit.service}>
      <span className="servers-plate">{name}</span>
      <span className="servers-vents" aria-hidden="true" />
      <span className="servers-led">
        <DeviceLamp tone={unit.led} fresh={fresh} />
        <span className="device-sr">{LED_WORDS[unit.led]}</span>
      </span>
      {send === null ? (
        <span
          className={toggle}
          data-service={unit.service}
          role="img"
          aria-label={`${name}: Strom ${unit.power ? 'an' : 'aus'}`}
        >
          <span className="servers-bat" aria-hidden="true" />
          {marks}
        </span>
      ) : (
        <button
          className={toggle}
          data-service={unit.service}
          data-feel="clack"
          aria-pressed={unit.power}
          aria-label={`${name}: Strom`}
          onClick={() => send({ power: unit.service, on: !unit.power })}
        >
          <span className="servers-bat" aria-hidden="true" />
          {marks}
        </button>
      )}
    </li>
  );
}

/** The rack's six units, top to bottom; `send` null for the audience, which switches nothing. */
function Units(props: { rack: RackUnit[]; change: ServersChange | null; send: Send | null }) {
  const { rack, change, send } = props;
  const lit = new Set(ledsWith(change).map((unit) => unit.service));
  return (
    <ol className="servers-rack" aria-label="Rack">
      {rack.map((unit) => (
        <Unit key={unit.service} unit={unit} fresh={lit.has(unit.service)} send={send} />
      ))}
    </ol>
  );
}

/**
 * Console b: the rack — a unit for every service with its plate, its LED
 * and its power switch, and no code anywhere; beside them the cabling
 * diagram of the Netzplan, each service's LED as its unit shows it
 * (RackDiagram.tsx). The TERMINAL lamp on its bezel burns while somebody
 * stands at the terminal.
 */
function Rack(props: {
  puzzle: ServersPuzzle;
  rack: RackUnit[];
  change: ServersChange | null;
  send: Send;
}) {
  const { puzzle, rack, change, send } = props;
  return (
    <div className="servers servers--rack">
      <div className="servers-cabinet">
        <Units rack={rack} change={change} send={send} />
      </div>
      <RackDiagram rack={rack} />
      <div className="servers-bezel">
        <Link name="TERMINAL" manned={otherManned(puzzle)} />
      </div>
    </div>
  );
}

/** Both consoles as the audience sees them, side by side: the terminal's screen and the rack. */
function Watched(props: {
  rows: ServerRow[];
  log: ServerLogLine[];
  rack: RackUnit[];
  change: ServersChange | null;
}) {
  const { rows, log, rack, change } = props;
  // Side by side where the column has the room, one under the other where it has not.
  return (
    <div className="servers-watch">
      <div className="servers servers--watched">
        <section className="servers-console" aria-label={consoleName('a')}>
          <h4 className="servers-console-name">{consoleName('a')}</h4>
          <Screen rows={rows} log={log} change={change} printed={0} />
        </section>
        <section className="servers-console" aria-label={consoleName('b')}>
          <h4 className="servers-console-name">{consoleName('b')}</h4>
          <div className="servers-cabinet">
            <Units rack={rack} change={change} send={null} />
          </div>
          <RackDiagram rack={rack} />
        </section>
      </div>
    </div>
  );
}

/**
 * Serverraum at one console. Console a, the terminal, shows every service
 * with its code and takes `start`, `restart` and `status` — a command refused
 * answered at its prompt; console b, the rack, switches the services' power
 * and shows their LEDs. The audience sees both side by side, and switches
 * nothing.
 */
export function ServersPanel({ puzzle, change, send, refused = null }: PanelProps<'servers'>) {
  const { role, rows, log, rack } = puzzle;
  if (role === 'terminal' && rows !== null && log !== null) {
    return (
      <Terminal
        puzzle={puzzle}
        rows={rows}
        log={log}
        change={change}
        send={send}
        refused={refused}
      />
    );
  }
  if (role === 'rack' && rack !== null) {
    return <Rack puzzle={puzzle} rack={rack} change={change} send={send} />;
  }
  if (rows !== null && log !== null && rack !== null) {
    return <Watched rows={rows} log={log} rack={rack} change={change} />;
  }
  return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
}
