import { z } from 'zod';
import { fail } from '../errors.js';
import { mulberry32, shuffle, type Rng } from '../rng.js';
import {
  commonDefShape,
  type ManualBlock,
  type Move,
  type Perspectives,
  type PuzzleContext,
  type PuzzleModule,
  type Viewer,
} from './module.js';
import { costOf, labDocument, spelled, type TypePlate } from './printed.js';

/**
 * Zugangskontrolle: a station with two consoles in different places, worked as a login with two
 * factors. Console a is a terminal that names the doors it has to release, keeps a log and takes
 * `login <konto>`, the token that login asks for, `status` and `freigeben <tür>`; console b is a
 * token device that shows the account it is bound to this period, that account's six-digit
 * token and a bar draining to the next period — every `tokenSec` seconds on the server's clock
 * it moves on to the next account of the run's list. Which role may release which door is
 * printed and the same in every run; which account holds which role is the run's own list, read
 * at a source. A login opens a session only with the token the device shows for that account in
 * the period it arrives in: the account comes from the list, the token from the device, and the
 * terminal has neither. A wrong token is an alarm, and the third in a row for an account locks
 * it for `lockSec` seconds of the mission clock; a token of the period just gone is turned back
 * without one. A session releases each door of its role once, any other with an alarm; from
 * release `strictFrom` on the terminal names the session by its role alone, so only the printed
 * table tells what it may release. Solved once every door the terminal asked for is released.
 */

/** The roles of the lab's service accounts, as the printed Berechtigungen list them. */
export const ACCESS_ROLES = ['haustechnik', 'laborleitung', 'sicherheit', 'it'] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];

/** A role as the list, the terminal and the printed table name it. */
export const ROLE_NAMES: Readonly<Record<AccessRole, string>> = {
  haustechnik: 'Haustechnik',
  laborleitung: 'Laborleitung',
  sicherheit: 'Sicherheitsdienst',
  it: 'IT-Betrieb',
};

/** The secured doors, two for every role, in the printed table's order. */
export const ACCESS_DOORS = [
  'werkstatt',
  'lager',
  'labor',
  'archiv',
  'schleuse',
  'reaktor',
  'serverraum',
  'funkraum',
] as const;
export type AccessDoor = (typeof ACCESS_DOORS)[number];

/** The printed Berechtigungen: the one role that may release each door, the same in every run. */
export const DOOR_ROLE: Readonly<Record<AccessDoor, AccessRole>> = {
  werkstatt: 'haustechnik',
  lager: 'haustechnik',
  labor: 'laborleitung',
  archiv: 'laborleitung',
  schleuse: 'sicherheit',
  reaktor: 'sicherheit',
  serverraum: 'it',
  funkraum: 'it',
};

/** A door as the terminal and the printed table name it: WERKSTATT. */
export const doorName = (door: AccessDoor): string => door.toUpperCase();

/** The doors a role may release, in the printed order. */
export const doorsOf = (role: AccessRole): AccessDoor[] =>
  ACCESS_DOORS.filter((door) => DOOR_ROLE[door] === role);

/** The service accounts a run's list draws its names from; the printed log uses none of them. */
export const ACCOUNT_NAMES = [
  'berger',
  'franke',
  'huber',
  'krause',
  'lorenz',
  'pohl',
  'seidel',
  'winkler',
] as const;

/** How many accounts a run's list holds: one role of the four stays unheld. */
export const ACCOUNTS = 3;

/** How many digits a token has. */
export const TOKEN_DIGITS = 6;

/** Wrong tokens in a row for one account that lock it. */
export const MISSES_TO_LOCK = 3;

/** How many of the log's last lines the terminal shows, and the state keeps. */
export const ACCESS_LOG_LINES = 6;

const defSchema = z.strictObject({
  type: z.literal('access'),
  ...commonDefShape,
  /** doors the terminal asks to release, each by an account of its own */
  doors: z.number().int().min(1).max(ACCOUNTS).default(2),
  /** seconds a token stands on the device before it moves on to the next account */
  tokenSec: z.number().int().min(15).max(60).default(30),
  /** seconds a released door stands open */
  openSec: z.number().int().min(3).max(15).default(5),
  /** seconds of the mission clock an account stays locked after three wrong tokens in a row */
  lockSec: z.number().int().min(15).max(120).default(45),
  /**
   * the release (1-based) from which on the terminal names a session by its role alone; one past
   * the doors means never
   */
  strictFrom: z.number().int().min(1).max(ACCOUNTS).default(2),
  penaltySec: z.number().int().positive().default(20),
});
export type AccessDef = z.infer<typeof defSchema>;

/** An account of the run's list. */
export interface AccessAccount {
  name: string;
  role: AccessRole;
}

/** One line of the terminal's log: `[ OK ] Sitzung huber offen`, `[FEHL] Token falsch (1/3)`. */
export interface AccessLogLine {
  /** counted from 1 over the whole run, so that a new line is told from an old one */
  n: number;
  /** ok a session or a release, fail an alarm, info everything else */
  tag: 'ok' | 'fail' | 'info';
  text: string;
}

/** A door released, standing open until `until` (epoch ms). */
export interface AccessOpening {
  door: AccessDoor;
  until: number;
}

export interface AccessState {
  type: 'access';
  /** what the tokens are drawn from */
  seed: number;
  /** when period 0 began, epoch ms: the moment the station came on */
  epoch: number;
  /** the period the views show; the clock's ticks and every move bring it up to date */
  period: number;
  /** the run's list: each account with its role, in the list's order */
  accounts: AccessAccount[];
  /** the accounts' names in the order the token device turns through them, a period each */
  rotation: string[];
  /** the doors the terminal asks to release, in its order */
  needed: AccessDoor[];
  /** the doors released so far, in order */
  released: AccessDoor[];
  /** the door released last while it stands open, and after; null before the first release */
  open: AccessOpening | null;
  /** the account whose session is open; null for none */
  session: string | null;
  /** the account whose token the prompt asks for; null while it takes commands */
  prompt: string | null;
  /** wrong tokens in a row, by account */
  misses: Record<string, number>;
  /** locked accounts: the seconds left on the mission clock at which each lock lifts */
  locks: Record<string, number>;
  /** the log's last ACCESS_LOG_LINES lines */
  log: AccessLogLine[];
  /** lines logged so far */
  logged: number;
}

/** What an account's name may be, as the terminal reads it after `login`. */
export const ACCOUNT_PATTERN = /^[a-z0-9-]{1,24}$/;
const TOKEN_PATTERN = new RegExp(`^\\d{${TOKEN_DIGITS}}$`);

const inputSchema = z.union([
  z.strictObject({ cmd: z.literal('login'), account: z.string().regex(ACCOUNT_PATTERN) }),
  z.strictObject({ cmd: z.literal('status') }),
  z.strictObject({ cmd: z.literal('freigeben'), door: z.enum(ACCESS_DOORS) }),
  z.strictObject({ token: z.string().regex(TOKEN_PATTERN) }),
]);
export type AccessInput = z.infer<typeof inputSchema>;

/** A door on the terminal's list, and whether it is released. */
export interface AccessDoorRow {
  door: AccessDoor;
  released: boolean;
}

/** The open session as the terminal names it: by its account, at Sicherheitsstufe 2 by its role. */
export type AccessSession = { account: string } | { role: AccessRole };

/** A locked account on the terminal, and the seconds left on the mission clock as it lifts. */
export interface AccessLock {
  account: string;
  liftsAtSec: number;
}

/** What the terminal shows: its doors, its session, its prompt, its locks and its log. */
export interface AccessTerminal {
  doors: AccessDoorRow[];
  open: AccessOpening | null;
  session: AccessSession | null;
  prompt: string | null;
  locks: AccessLock[];
  log: AccessLogLine[];
  /** Sicherheitsstufe 2: the session is named by its role alone */
  strict: boolean;
}

/** What the token device shows: its account this period, the token, and when both move on. */
export interface AccessDevice {
  account: string;
  token: string;
  /** the period's end, epoch ms on the server's clock: the bar runs out then */
  endsAt: number;
  /** how long a period is, for the bar */
  periodSec: number;
}

/**
 * The open Zugangskontrolle as one player sees it. The terminal shows no token and no list, the
 * device no door and no list, the list no token and no door; everybody away from them gets
 * nothing of the instance, the audience all of it.
 */
export interface AccessView {
  kind: 'access';
  /** the viewer's console: the terminal at a, the token device at b; null elsewhere */
  role: 'terminal' | 'token' | null;
  /** at the terminal, and for the audience */
  terminal: AccessTerminal | null;
  /** at the token device, and for the audience */
  device: AccessDevice | null;
  /** the run's list — at a source covering the station, and for the audience */
  roster: AccessAccount[] | null;
}

/** What a move did: the state after it, and the alarm it raised, if any. */
interface Outcome {
  state: AccessState;
  penalty: string | null;
}

// --- the token -----------------------------------------------------------------------------

/** A text's 32-bit FNV-1a hash. */
function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The token `account` has in `period` of a run whose tokens are drawn from `seed`: six digits,
 * the same for the same three, drawn anew for every period. The run's own stand-in for a TOTP
 * generator; no clock is read in it.
 */
export function tokenOf(seed: number, account: string, period: number): string {
  const mixed = seed ^ hashOf(account) ^ Math.imul(period + 1, 0x9e3779b1);
  const draw = mulberry32(mixed >>> 0);
  return String(Math.floor(draw() * 10 ** TOKEN_DIGITS)).padStart(TOKEN_DIGITS, '0');
}

/** The period `at` (epoch ms) falls in: whole token periods since the station came on. */
export function periodAt(def: AccessDef, state: Pick<AccessState, 'epoch'>, at: number): number {
  return Math.max(0, Math.floor((at - state.epoch) / (def.tokenSec * 1000)));
}

/** The account the token device is bound to in `period`: the rotation, a period each. */
export function boundIn(state: Pick<AccessState, 'rotation'>, period: number): string {
  const account = state.rotation[period % state.rotation.length];
  if (account === undefined) {
    throw new Error('access: the token device turns through no account');
  }
  return account;
}

// --- the rules -----------------------------------------------------------------------------

/** Sicherheitsstufe 2: the release under way is `strictFrom` or later. */
const strictNow = (def: AccessDef, state: AccessState): boolean =>
  state.released.length + 1 >= def.strictFrom;

/** The role of `account` on the run's list. */
function roleOf(state: AccessState, account: string): AccessRole {
  const found = state.accounts.find((entry) => entry.name === account);
  if (found === undefined) {
    throw new Error(`access: "${account}" is not on the run's list`);
  }
  return found.role;
}

/** `state` with `lines` logged at its end, the log cut to its last ACCESS_LOG_LINES. */
function logged(state: AccessState, lines: readonly Omit<AccessLogLine, 'n'>[]): AccessState {
  const added = lines.map((line, i) => ({ n: state.logged + i + 1, ...line }));
  return {
    ...state,
    log: [...state.log, ...added].slice(-ACCESS_LOG_LINES),
    logged: state.logged + lines.length,
  };
}

/**
 * `state` brought up to `at` (epoch ms): its period, and its locks less those the mission clock
 * has lifted by now, `left` seconds before its end.
 */
function caughtUp(def: AccessDef, state: AccessState, at: number, left: number): AccessState {
  const period = Math.max(state.period, periodAt(def, state, at));
  const held = Object.entries(state.locks).filter(([, liftsAt]) => left > liftsAt);
  return { ...state, period, locks: Object.fromEntries(held) };
}

/** A session as the terminal names it now: by its account, or at Sicherheitsstufe 2 by role. */
function sessionAs(def: AccessDef, state: AccessState, account: string): string {
  return strictNow(def, state) ? ROLE_NAMES[roleOf(state, account)].toUpperCase() : account;
}

/** `login <konto>`: the prompt asks for the account's token; an open session closes. */
function loggingIn(state: AccessState, account: string): Outcome {
  if (!state.accounts.some((entry) => entry.name === account)) {
    fail(`Kein Konto ${account}.`);
  }
  if (state.locks[account] !== undefined) {
    fail(`Konto ${account} gesperrt.`);
  }
  const asked = { ...state, session: null, prompt: account };
  const text = `login ${account}: Token angefordert`;
  return { state: logged(asked, [{ tag: 'info', text }]), penalty: null };
}

/**
 * A wrong token for `account`: an alarm, and the third in a row locks the account until the
 * mission clock has run `lockSec` seconds on (`left` its seconds now), the prompt closing.
 */
function missed(def: AccessDef, state: AccessState, account: string, left: number): Outcome {
  const misses = (state.misses[account] ?? 0) + 1;
  if (misses < MISSES_TO_LOCK) {
    const counted = { ...state, misses: { ...state.misses, [account]: misses } };
    const text = `Token falsch (${misses}/${MISSES_TO_LOCK})`;
    return {
      state: logged(counted, [{ tag: 'fail', text }]),
      penalty: 'Zugangskontrolle: falscher Token',
    };
  }
  const locked: AccessState = {
    ...state,
    prompt: null,
    misses: { ...state.misses, [account]: 0 },
    locks: { ...state.locks, [account]: left - def.lockSec },
  };
  const text = `Token falsch: ${account} für ${def.lockSec} s gesperrt`;
  return {
    state: logged(locked, [{ tag: 'fail', text }]),
    penalty: 'Zugangskontrolle: Konto gesperrt',
  };
}

/**
 * A token typed at the prompt: the account's token of the period it arrives in opens the
 * session; the token of the period just gone is turned back without an alarm, the prompt asking
 * on; any other is a miss.
 */
function tokenTyped(def: AccessDef, state: AccessState, token: string, left: number): Outcome {
  const account = state.prompt;
  if (account === null) {
    fail('Keine Anmeldung offen.');
  }
  if (token === tokenOf(state.seed, account, state.period)) {
    const open = { ...state, session: account, prompt: null };
    const reset = { ...open, misses: { ...state.misses, [account]: 0 } };
    const text = `Sitzung ${sessionAs(def, state, account)} offen`;
    return { state: logged(reset, [{ tag: 'ok', text }]), penalty: null };
  }
  const late = state.period > 0 && token === tokenOf(state.seed, account, state.period - 1);
  if (late) {
    const text = 'Periode gewechselt: Token abgelaufen';
    return { state: logged(state, [{ tag: 'info', text }]), penalty: null };
  }
  return missed(def, state, account, left);
}

/** `status`: the session as the terminal names it — before Sicherheitsstufe 2 with its doors. */
function statusShown(def: AccessDef, state: AccessState): Outcome {
  const { session, prompt } = state;
  if (session === null) {
    const text = prompt === null ? 'Keine Sitzung offen' : `Anmeldung ${prompt}: Token erwartet`;
    return { state: logged(state, [{ tag: 'info', text }]), penalty: null };
  }
  const named = sessionAs(def, state, session);
  const doors = doorsOf(roleOf(state, session)).map(doorName).join(', ');
  const text = strictNow(def, state) ? `Sitzung ${named}` : `Sitzung ${named}: gibt ${doors} frei`;
  return { state: logged(state, [{ tag: 'info', text }]), penalty: null };
}

/**
 * `freigeben <tür>`: a door the terminal asked for and has not released, by the open session —
 * released and standing open for `openSec` seconds where the session's role may release it, an
 * alarm where it may not.
 */
function releasing(def: AccessDef, state: AccessState, door: AccessDoor, at: number): Outcome {
  const name = doorName(door);
  if (!state.needed.includes(door)) {
    fail(`${name} fordert das Terminal nicht an.`);
  }
  if (state.released.includes(door)) {
    fail(`${name} ist schon freigegeben.`);
  }
  if (state.session === null) {
    fail('Keine Sitzung offen.');
  }
  if (DOOR_ROLE[door] !== roleOf(state, state.session)) {
    const text = `${name}: Freigabe verweigert`;
    return {
      state: logged(state, [{ tag: 'fail', text }]),
      penalty: 'Zugangskontrolle: Freigabe verweigert',
    };
  }
  const opened: AccessState = {
    ...state,
    released: [...state.released, door],
    open: { door, until: at + def.openSec * 1000 },
  };
  const text = `${name} offen für ${def.openSec} s`;
  return { state: logged(opened, [{ tag: 'ok', text }]), penalty: null };
}

/** A command or a token at the terminal, the state brought up to the move's moment first. */
function worked(
  def: AccessDef,
  state: AccessState,
  input: AccessInput,
  ctx: PuzzleContext,
): Outcome {
  const now = caughtUp(def, state, ctx.at, ctx.remainingSec);
  if ('token' in input) {
    return tokenTyped(def, now, input.token, ctx.remainingSec);
  }
  switch (input.cmd) {
    case 'login':
      return loggingIn(now, input.account);
    case 'status':
      return statusShown(def, now);
    case 'freigeben':
      return releasing(def, now, input.door, ctx.at);
  }
}

// --- the views -----------------------------------------------------------------------------

/** The terminal as it stands: its doors, the session as it names it, its prompt, locks and log. */
function terminalOf(def: AccessDef, state: AccessState): AccessTerminal {
  const strict = strictNow(def, state);
  const { session } = state;
  const named: AccessSession | null =
    session === null ? null : strict ? { role: roleOf(state, session) } : { account: session };
  return {
    doors: state.needed.map((door) => ({ door, released: state.released.includes(door) })),
    open: state.open === null ? null : { ...state.open },
    session: named,
    prompt: state.prompt,
    locks: Object.entries(state.locks).map(([account, liftsAtSec]) => ({ account, liftsAtSec })),
    log: state.log.map((line) => ({ ...line })),
    strict,
  };
}

/** The token device in the state's period: its account, that account's token, the period's end. */
function deviceOf(def: AccessDef, state: AccessState): AccessDevice {
  const account = boundIn(state, state.period);
  const periodMs = def.tokenSec * 1000;
  return {
    account,
    token: tokenOf(state.seed, account, state.period),
    endsAt: state.epoch + (state.period + 1) * periodMs,
    periodSec: def.tokenSec,
  };
}

// --- the instance --------------------------------------------------------------------------

const pick = <T>(items: readonly T[], rng: Rng): T => {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) {
    throw new Error('access: nothing to draw from');
  }
  return item;
};

/** The run's list: ACCOUNTS of the roles, each held by a name of its own, sorted by name. */
function dealAccounts(rng: Rng): AccessAccount[] {
  const roles = shuffle(ACCESS_ROLES, rng).slice(0, ACCOUNTS);
  const names = shuffle(ACCOUNT_NAMES, rng);
  const accounts = roles.map((role, i) => {
    const name = names[i];
    if (name === undefined) {
      throw new Error(`access: ${ACCOUNTS} accounts, but only ${names.length} names`);
    }
    return { name, role };
  });
  return accounts.sort((a, b) => (a.name < b.name ? -1 : 1));
}

// --- the printed document ------------------------------------------------------------------

const PLATE: TypePlate = { name: 'Zugangskontrolle', type: 'ZK-2', year: 2004 };

const PURPOSE =
  'Die Zugangskontrolle gibt die gesicherten Türen des Labors frei, seit 2004 nur mit zwei ' +
  'Faktoren: Dienstkonto und Token.';

const BUILD =
  'Pult A ist das Terminal: Es nennt die Türen, die es freigeben soll, und nimmt Befehle an. ' +
  'Pult B ist das Tokengerät: Es zeigt das Konto, an das es gebunden ist, dessen Token aus ' +
  'sechs Ziffern und einen Balken bis zum nächsten Wechsel. Die Benutzerliste nennt die Rolle ' +
  'jedes Kontos.';

/** Betrieb: the device's periods, the login and the session, the faults and their cost. */
function operationText(def: AccessDef): string {
  return (
    `Alle ${def.tokenSec} Sekunden bindet sich das Gerät an das nächste Konto und zeigt dessen ` +
    'neuen Token. Eine Anmeldung verlangt Konto und Token; die Sitzung bleibt offen bis zur ' +
    `nächsten und gibt jede Tür ihrer Rolle für ${def.openSec} Sekunden frei. Ein falscher ` +
    'Token und eine Freigabe ohne Berechtigung sind Fehlquittierungen: Die Überwachung meldet ' +
    `Alarm und zieht ${costOf(def.penaltySec)} ab.`
  );
}

/** The printed Berechtigungen: each role and the doors it may release. */
function permissionsTable(): ManualBlock {
  return {
    kind: 'table',
    head: ['Rolle', 'gibt frei'],
    rows: ACCESS_ROLES.map((role) => [ROLE_NAMES[role], doorsOf(role).map(doorName).join(', ')]),
  };
}

/** The drawing of the token device with its bar; the client draws it under this name. */
export const TOKEN_FIGURE = 'access-token';

const COMMANDS: ManualBlock = {
  kind: 'table',
  head: ['Befehl am Terminal', 'Wirkung'],
  rows: [
    ['login <konto>', 'meldet ein Konto an; das Terminal fragt nach dem Token'],
    ['status', 'nennt die offene Sitzung, vor Sicherheitsstufe 2 mit ihren Türen'],
    ['freigeben <tür>', 'gibt eine angeforderte Tür für die offene Sitzung frei'],
  ],
};

/** The release from which on Sicherheitsstufe 2 holds, as the rules count it: „zweite". */
const ORDINALS: Readonly<Record<number, string>> = { 1: 'erste', 2: 'zweite', 3: 'dritte' };

/** The terminal's law: the token, the period, the lock, Sicherheitsstufe 2 where it comes. */
function rulesOf(def: AccessDef): ManualBlock {
  const strict =
    def.strictFrom > def.doors
      ? []
      : [
          `Wenn die ${ORDINALS[def.strictFrom] ?? `${def.strictFrom}.`} Freigabe ansteht, gilt ` +
            'Sicherheitsstufe 2: Das Terminal nennt die Sitzung nur noch mit ihrer Rolle.',
        ];
  return {
    kind: 'rules',
    items: [
      'Wenn der Token zum angemeldeten Konto und zur laufenden Periode passt, ist die Sitzung offen.',
      'Wenn ein Token der abgelaufenen Periode ankommt, meldet das Terminal den Wechsel; das ist ' +
        'keine Fehlquittierung.',
      `Wenn für ein Konto ${spelled(MISSES_TO_LOCK)} Token in Folge falsch sind, sperrt das ` +
        `Terminal das Konto für ${def.lockSec} Sekunden Einsatzzeit.`,
      ...strict,
      'Wenn jede angeforderte Tür einmal freigegeben ist, ist der Auftrag des Terminals erledigt.',
    ],
  };
}

/** The printed log: the door, its role, the account on the list, the wait, the release. */
function logLines(def: AccessDef): string[] {
  return [
    '03:10 Terminal fordert WERKSTATT an; laut Berechtigungen gibt sie die Haustechnik frei.',
    '03:10 Benutzerliste: Haustechnik hat das Konto meier.',
    '03:11 login meier; das Tokengerät zeigt noch ein anderes Konto.',
    '03:11 Gerät wechselt auf meier: Token 405 217 angenommen, Sitzung offen.',
    `03:12 freigeben werkstatt: WERKSTATT ${def.openSec} s offen.`,
  ];
}

const WORKSHOP: readonly string[] = [
  'Die Uhr im Gerät geht eine Spur nach: Der neue Token erscheint einen Augenblick nach dem ' +
    'Wechsel, und ein Token aus der letzten Sekunde des Balkens kommt oft zu spät.',
];

// --- the solver ----------------------------------------------------------------------------

/** Whether the terminal's session is `account`'s, named by the account or by its `role`. */
function sessionIs(session: AccessSession | null, account: string, role: AccessRole): boolean {
  if (session === null) {
    return false;
  }
  return 'account' in session ? session.account === account : session.role === role;
}

const atTerminal = (input: AccessInput): Move<AccessInput> => ({ by: 'operator', input });

/** What solving reads: the terminal at console a, the token device at b, the list at a source. */
interface Seen {
  terminal: AccessTerminal;
  device: AccessDevice;
  roster: AccessAccount[];
}

/**
 * The terminal's view at console a, the token device's at console b and the list as read at a
 * source — or by whoever stands at a console within reach of one; throws where one is missing.
 */
function seenBy(def: AccessDef, { operator, partner, reader }: Perspectives<AccessView>): Seen {
  const device = partner?.device ?? null;
  const read = [reader, operator, partner].find((view) => (view?.roster ?? null) !== null);
  const roster = read?.roster ?? null;
  if (operator.terminal === null || device === null || roster === null) {
    throw new Error(
      `access "${def.id}": solving needs the terminal's view at console a, the token ` +
        "device's at console b and the list's at a source",
    );
  }
  return { terminal: operator.terminal, device, roster };
}

/** The account the list gives the role the printed table names for `door`. */
function accountOn(def: AccessDef, roster: readonly AccessAccount[], door: AccessDoor): string {
  const account = roster.find((entry) => entry.role === DOOR_ROLE[door])?.name;
  if (account === undefined) {
    throw new Error(`access "${def.id}": ${door} asks for a role nobody on the list has`);
  }
  return account;
}

/**
 * The crew's next move for `door`, which `account` releases: the release where its session is
 * open, else its login, else its token once the device shows that account — or a wait.
 */
function movesFor({ terminal, device }: Seen, door: AccessDoor, account: string) {
  if (sessionIs(terminal.session, account, DOOR_ROLE[door])) {
    return [atTerminal({ cmd: 'freigeben', door })];
  }
  if (terminal.prompt !== account) {
    return [atTerminal({ cmd: 'login', account })];
  }
  return device.account === account ? [atTerminal({ token: device.token })] : [];
}

/** The viewer's console: the terminal at a, the token device at b; none away from them. */
function consoleRole(viewer: Viewer): AccessView['role'] {
  if (!viewer.operating || viewer.console === null) {
    return null;
  }
  return viewer.console === 'a' ? 'terminal' : 'token';
}

export const accessModule: PuzzleModule<AccessDef, AccessState, AccessInput, AccessView> = {
  type: 'access',
  usesEdgework: false,
  wholeCrew: false,
  consoles: 2,
  fields: [
    {
      key: 'doors',
      label: 'Türen',
      help: 'So viele Türen fordert das Terminal an; jede braucht ein Konto einer anderen Rolle.',
      kind: 'int',
      min: 1,
      max: ACCOUNTS,
      default: 2,
    },
    {
      key: 'tokenSec',
      label: 'Token-Periode in Sekunden',
      help: 'So lange steht ein Token auf dem Gerät, bevor es zum nächsten Konto wechselt.',
      kind: 'int',
      min: 15,
      max: 60,
      default: 30,
    },
    {
      key: 'openSec',
      label: 'Tür offen in Sekunden',
      help: 'So lange steht eine freigegebene Tür offen.',
      kind: 'int',
      min: 3,
      max: 15,
      default: 5,
    },
    {
      key: 'lockSec',
      label: 'Sperre in Sekunden',
      help: 'So lange sperrt das Terminal ein Konto nach drei falschen Token in Folge.',
      kind: 'int',
      min: 15,
      max: 120,
      default: 45,
    },
    {
      key: 'strictFrom',
      label: 'Sicherheitsstufe 2 ab Freigabe',
      help:
        'Ab dieser Freigabe nennt das Terminal die Sitzung nur mit ihrer Rolle; liegt sie über ' +
        'der Zahl der Türen, nie.',
      kind: 'int',
      min: 1,
      max: ACCOUNTS,
      default: 2,
    },
  ],
  defSchema,
  inputSchema,

  /**
   * The run's list of ACCOUNTS accounts, each holding another of the roles; the token device
   * turning through them in an order of its own; the doors the terminal asks for, each of another
   * account's role. The tokens' periods count from the moment the station comes on.
   */
  init(def, rng, ctx) {
    const accounts = dealAccounts(rng);
    const rotation = shuffle(
      accounts.map((entry) => entry.name),
      rng,
    );
    const roles = shuffle(
      accounts.map((entry) => entry.role),
      rng,
    ).slice(0, def.doors);
    const needed = roles.map((role) => pick(doorsOf(role), rng));
    const fresh: AccessState = {
      type: 'access',
      seed: Math.floor(rng() * 2 ** 32),
      epoch: ctx.at,
      period: 0,
      accounts,
      rotation,
      needed,
      released: [],
      open: null,
      session: null,
      prompt: null,
      misses: {},
      locks: {},
      log: [],
      logged: 0,
    };
    const asked = `Angefordert: ${needed.map(doorName).join(', ')}`;
    return logged(fresh, [{ tag: 'info', text: asked }]);
  },

  apply(def, state, input, _playerId, ctx) {
    if (ctx.console !== 'a') {
      fail('Befehle nimmt nur das Terminal an.');
    }
    const outcome = worked(def, state, input, ctx);
    const done = outcome.state.needed.every((door) => outcome.state.released.includes(door));
    return { ...outcome, solved: done };
  },

  /** The next period's start: the device moves on to its next account and token then. */
  dueAt(def, state) {
    return state.epoch + (state.period + 1) * def.tokenSec * 1000;
  },

  expire(def, state, at) {
    const period = Math.max(state.period, periodAt(def, state, at));
    return period === state.period ? state : { ...state, period };
  },

  view(def, state, viewer) {
    const audience = viewer.playerId === null;
    const role = consoleRole(viewer);
    return {
      kind: 'access',
      role,
      terminal: role === 'terminal' || audience ? terminalOf(def, state) : null,
      device: role === 'token' || audience ? deviceOf(def, state) : null,
      roster: viewer.reading ? state.accounts.map((entry) => ({ ...entry })) : null,
    };
  },

  /** Console a is the terminal, console b the token device. */
  plate(_def, console) {
    return console === 'b'
      ? 'Das Tokengerät zeigt den Token des gebundenen Kontos'
      : 'Das Terminal gibt die gesicherten Türen frei';
  },

  manual(def) {
    return labDocument({
      plate: PLATE,
      purpose: PURPOSE,
      figure: { of: 'access', device: 'Terminal und Tokengerät' },
      build: BUILD,
      operation: operationText(def),
      law: [
        { heading: 'Berechtigungen', blocks: [permissionsTable()] },
        {
          heading: 'Anmeldung und Sperre',
          blocks: [
            { kind: 'figure', of: TOKEN_FIGURE, caption: 'Abb. 2 — Tokengerät mit Balken' },
            COMMANDS,
            rulesOf(def),
          ],
        },
      ],
      log: logLines(def),
      workshop: WORKSHOP,
    });
  },

  /**
   * The terminal names the doors, the list the account of each door's role, the device its
   * token while it is bound to it. The first door not yet released goes to the account whose
   * role the printed table names: released where that account's session is open, else logged
   * in, and its token typed once the device shows that account — until then the crew waits.
   */
  solve(def, views) {
    const seen = seenBy(def, views);
    const door = seen.terminal.doors.find((row) => !row.released)?.door;
    return door === undefined ? [] : movesFor(seen, door, accountOn(def, seen.roster, door));
  },
};
