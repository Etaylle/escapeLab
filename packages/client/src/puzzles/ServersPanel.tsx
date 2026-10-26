import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
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
import { notedHead, notedText, type NotableBlock } from '../noting.js';
import { NoteButton } from '../screens/NoteButton.js';
import { consoleName } from '../world/consoles.js';
import { DeviceLamp } from './Device.js';
import { cssVars, reject, type Change } from './feel.js';
import type { PanelProps } from './index.js';
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

/** A lamp on the bezel, lit while somebody stands at the console it names. */
function Link({ name, manned }: { name: string; manned: boolean }) {
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

/** The terminal's status table as the notepad takes it down: a row a service, as printed. */
export function terminalTable(rows: readonly ServerRow[]): NotableBlock {
  return {
    kind: 'table',
    head: ['Dienst', 'Status', 'Strom', 'Braucht'],
    rows: rows.map((row) => [
      serviceName(row.service),
      statusOf(row),
      row.power ? 'AN' : 'AUS',
      needsOf(row.service),
    ]),
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

/** The log's last lines, the newest at the foot; the lines a change brought type in. */
function Log({ log, fresh }: { log: ServerLogLine[]; fresh: Set<number> }) {
  return (
    <ol className="servers-log" aria-label="Protokoll" aria-live="polite">
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

/** A key typed into the prompt: a blip for every character and every one taken back. */
function blipOn(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') {
    typeBlip();
  }
}

/**
 * Console a: the terminal. The green screen shows the table and the log;
 * under it the prompt takes a command typed or put together on the keys,
 * and sends it with ⏎. A line it cannot read it answers itself — the prompt
 * shakes — and sends nothing; `status` prints the table anew. The prompt never takes the
 * keyboard by itself and lets go of it once a line is sent, so that V
 * talks. The RACK lamp on its bezel burns while somebody stands at the rack, and beside it
 * „Notieren" takes the table down into the notepad as it stands.
 */
function Terminal(props: {
  puzzle: ServersPuzzle;
  rows: ServerRow[];
  log: ServerLogLine[];
  change: ServersChange | null;
  send: Send;
}) {
  const { puzzle, rows, log, change, send } = props;
  const [line, setLine] = useState('');
  const [unread, setUnread] = useState(false);
  const [printed, setPrinted] = useState(0);
  const prompt = useRef<HTMLLabelElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (wordsIn(line).length === 0) {
      return;
    }
    const input = commandOf(line);
    if (input === null) {
      setUnread(true);
      if (prompt.current !== null) {
        reject(prompt.current, true);
      }
      return;
    }
    setUnread(false);
    setLine('');
    if (input.cmd === 'status') {
      setPrinted((n) => n + 1);
    }
    send(input);
    // Sent, the prompt lets go of the keyboard: V talks again, until the prompt is clicked.
    field.current?.blur();
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
              ref={field}
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
              onKeyDown={blipOn}
            />
            {/* What was typed, in phosphor, the block cursor after it: the field's is hidden. */}
            <span className="servers-echo" aria-hidden="true">
              {line}
              <span className="servers-cursor" />
            </span>
          </span>
        </label>
        {unread && (
          <p className="servers-reply" role="status">
            ? Befehl unbekannt
          </p>
        )}
      </Screen>
      <div className="servers-bezel">
        <Keys put={(word) => setLine((now) => withWord(now, word))} />
        <Link name="RACK" manned={otherManned(puzzle)} />
        <NoteButton text={notedText(notedHead(puzzle, 'Terminal'), terminalTable(rows))} />
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
 * and its power switch, and no code anywhere. The TERMINAL lamp on its
 * bezel burns while somebody stands at the terminal.
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
        </section>
      </div>
    </div>
  );
}

/**
 * Serverraum at one console. Console a, the terminal, shows every service
 * with its code and takes `start`, `restart` and `status`; console b, the
 * rack, switches the services' power and shows their LEDs. The audience sees
 * both side by side, and switches nothing.
 */
export function ServersPanel({ puzzle, change, send }: PanelProps<'servers'>) {
  const { role, rows, log, rack } = puzzle;
  if (role === 'terminal' && rows !== null && log !== null) {
    return <Terminal puzzle={puzzle} rows={rows} log={log} change={change} send={send} />;
  }
  if (role === 'rack' && rack !== null) {
    return <Rack puzzle={puzzle} rack={rack} change={change} send={send} />;
  }
  if (rows !== null && log !== null && rack !== null) {
    return <Watched rows={rows} log={log} rack={rack} change={change} />;
  }
  return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
}
