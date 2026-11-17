import { z } from 'zod';
import { fail } from '../errors.js';
import { shuffle, type Rng } from '../rng.js';
import {
  commonDefShape,
  type ConsoleId,
  type ManualBlock,
  type Move,
  type Perspectives,
  type PuzzleContext,
  type PuzzleModule,
  type Viewer,
} from './module.js';
import { costOf, labDocument, spelled, type TypePlate } from './printed.js';

/**
 * Anlaufsteuerung: a station with two consoles in different places, the same device at both — a
 * small terminal and a Schaltfeld of FEEDERS feeders, each with two control lamps and a breaker,
 * and an LED ladder for a pulse coming in. The stages alternate the sides: in the odd ones
 * console a's terminal runs the start script and console b's Schaltfeld takes the pulse, in the
 * even ones the other way round. The script names the load the stage starts and has a gap or
 * two: `abgang`, the feeder carrying that load — the feeder whose lamps show the load's picture
 * in the printed table —, and from stage 2 on `sperre`, the feeder whose red lamp marks it
 * faulty. The lamps burn at the other console only, the table stands in the book only. `start`
 * with the right values sends a pulse through the duct in the floor: it takes `travelSec`
 * seconds to reach the other side, then stands `windowSec` seconds on the ladder's marked steps,
 * and the named feeder's breaker has to close then, on the server's clock. Too early the pulse
 * is dropped, too late it dies, neither with an alarm; a wrong breaker and a start with a wrong
 * value are alarms. `start` is turned away while nobody else stands at the other console. Solved
 * once the last stage has run up.
 */

/** The feeders of each Schaltfeld, numbered from 1 at the left. */
export const FEEDERS = 4;

/** What a feeder of a Schaltfeld can carry, in the order the printed table lists them. */
export const STARTUP_LOADS = ['netz', 'notstrom', 'kuehlung', 'lueftung', 'licht'] as const;
export type StartupLoad = (typeof STARTUP_LOADS)[number];

/** A load as the script and the table name it. */
export const LOAD_NAMES: Readonly<Record<StartupLoad, string>> = {
  netz: 'Netzeinspeisung',
  notstrom: 'Notstromschiene',
  kuehlung: 'Kühlkreis',
  lueftung: 'Lüftung',
  licht: 'Beleuchtung',
};

/** How a control lamp burns: in a colour, or dark. */
export const LAMP_COLOURS = ['gruen', 'gelb', 'rot', 'aus'] as const;
export type LampColour = (typeof LAMP_COLOURS)[number];

/** A colour as the table and the device's lens name it. */
export const LAMP_WORDS: Readonly<Record<LampColour, string>> = {
  gruen: 'grün',
  gelb: 'gelb',
  rot: 'rot',
  aus: 'dunkel',
};

/** A feeder's two control lamps, the upper first. */
export type LampPicture = readonly [upper: LampColour, lower: LampColour];

/**
 * The printed table's pictures: the lamps of a feeder carrying each load. Four of the five
 * show yellow, so that a picture is told by both lamps, never by one colour.
 */
export const LOAD_PICTURES: Readonly<Record<StartupLoad, LampPicture>> = {
  netz: ['gruen', 'aus'],
  notstrom: ['gelb', 'aus'],
  kuehlung: ['gelb', 'gelb'],
  lueftung: ['gruen', 'gelb'],
  licht: ['aus', 'gelb'],
};

/** A faulty feeder's lamps: red over dark. Every Schaltfeld that takes a pulse has one. */
export const FAULT_PICTURE: LampPicture = ['rot', 'aus'];

/** The gaps a script can have: the faulty feeder to lock out, the feeder the pulse goes to. */
export const STARTUP_GAPS = ['sperre', 'abgang'] as const;
export type StartupGap = (typeof STARTUP_GAPS)[number];

/** How many of the log's last lines the terminal shows, and the state keeps. */
const STARTUP_LOG_LINES = 6;

/** Milliseconds in a second: the def counts in seconds, the clock in milliseconds. */
const MS_PER_SEC = 1000;

const defSchema = z.strictObject({
  type: z.literal('startup'),
  ...commonDefShape,
  /** stages to run up; the sides swap after each */
  stages: z.number().int().min(2).max(3).default(2),
  /** seconds the pulse takes through the duct to the other console's ladder */
  travelSec: z.number().int().min(4).max(10).default(6),
  /** seconds the pulse stands on the ladder's marked steps */
  windowSec: z.number().int().min(2).max(5).default(3),
  penaltySec: z.number().int().positive().default(20),
});
export type StartupDef = z.infer<typeof defSchema>;

/** One stage as `init` deals it: the load its script starts, and the lamps of its Schaltfeld. */
export interface StartupStage {
  load: StartupLoad;
  /** the feeders of the Schaltfeld taking the pulse, from feeder 1 */
  feeders: LampPicture[];
}

/** A pulse on its way: when it was sent, and whether it stands on the marked steps yet. */
export interface StartupPulse {
  sentAt: number;
  arrived: boolean;
}

/** A breaker closed in time: where, and which feeder. */
export interface StartupClosed {
  console: ConsoleId;
  feeder: number;
}

/** What became of the last pulse, as both consoles' status strips say it. */
export type StartupOutcome = 'angelaufen' | 'verfallen' | 'verworfen' | 'falsch';

/** One line of the terminal's log: `[ OK ] Stufe 1 angelaufen`, `[FEHL] Anlauf verweigert`. */
export interface StartupLogLine {
  /** counted from 1 over the whole run, so that a new line is told from an old one */
  n: number;
  tag: 'ok' | 'fail' | 'info';
  text: string;
}

export interface StartupState {
  type: 'startup';
  /** 0-based: in stage 0 console a types and console b takes the pulse */
  stage: number;
  stages: StartupStage[];
  /** the values set into this stage's gaps so far */
  values: Partial<Record<StartupGap, number>>;
  pulse: StartupPulse | null;
  /** the breakers closed in time, a stage each */
  closed: StartupClosed[];
  last: StartupOutcome | null;
  log: StartupLogLine[];
  logged: number;
}

const feederSchema = z.number().int().min(1).max(FEEDERS);

const inputSchema = z.union([
  z.strictObject({ cmd: z.literal('zeige') }),
  z.strictObject({ cmd: z.literal('setze'), gap: z.enum(STARTUP_GAPS), value: feederSchema }),
  z.strictObject({ cmd: z.literal('start') }),
  z.strictObject({ breaker: feederSchema }),
]);
export type StartupInput = z.infer<typeof inputSchema>;
type Command = Extract<StartupInput, { cmd: string }>;

/** A line of the script as the terminal lists it: a comment, a command, or a gap to set. */
export type StartupScriptLine =
  | { kind: 'comment'; text: string }
  | { kind: 'code'; text: string; comment: string | null }
  | { kind: 'gap'; gap: StartupGap; comment: string };

/** What the live terminal shows: the stage's script, the values set, whether a pulse is off. */
export interface StartupTerminal {
  load: StartupLoad;
  script: StartupScriptLine[];
  /** the stage's gaps, in the script's order */
  gaps: StartupGap[];
  /** what each gap of the script holds; null while open */
  values: Partial<Record<StartupGap, number | null>>;
  /** a pulse is off: the terminal says so and counts nothing down */
  sent: boolean;
  log: StartupLogLine[];
}

/** A feeder of the live Schaltfeld: its number and its lamps. */
export interface StartupFeeder {
  feeder: number;
  lamps: LampPicture;
}

/** What the live Schaltfeld shows: its feeders' lamps, and the pulse on its ladder. */
export interface StartupBoard {
  feeders: StartupFeeder[];
  /** the pulse coming in, epoch ms on the server's clock; null while none is on the way */
  pulse: StartupPulse | null;
}

/**
 * The open Anlaufsteuerung as one player sees it. The live terminal shows no lamp, the live
 * Schaltfeld no script; the book and everybody away from the consoles get nothing of the
 * instance, the audience all of it.
 */
export interface StartupView {
  kind: 'startup';
  /** 1-based, as the printed page counts: stage 1 is typed at console a */
  stage: number;
  stages: number;
  /** what is live at the viewer's console this stage; null away from the consoles */
  role: 'terminal' | 'board' | null;
  /** the console whose terminal runs this stage's script */
  types: ConsoleId;
  /** at the typing console, and for the audience */
  terminal: StartupTerminal | null;
  /** at the console taking the pulse, and for the audience */
  board: StartupBoard | null;
  /** the ladder: its steps, a second each, and how many at its top are marked */
  ladder: { steps: number; marked: number };
  /** the breakers closed in earlier stages, at either console — at a console, for the audience */
  closed: StartupClosed[] | null;
  last: StartupOutcome | null;
}

/** What a move did: the state after it, and the alarm it raised, if any. */
interface Outcome {
  state: StartupState;
  penalty: string | null;
}

// --- the stages ----------------------------------------------------------------------------

/** The console whose terminal runs the script in (0-based) `stage`: a first, then turn about. */
export const typingConsole = (stage: number): ConsoleId => (stage % 2 === 0 ? 'a' : 'b');

const across = (side: ConsoleId): ConsoleId => (side === 'a' ? 'b' : 'a');

/** The gaps of (0-based) `stage`'s script: `abgang` always, `sperre` before it from stage 2 on. */
export const gapsOf = (stage: number): StartupGap[] =>
  stage === 0 ? ['abgang'] : ['sperre', 'abgang'];

const samePicture = (a: LampPicture, b: LampPicture): boolean => a[0] === b[0] && a[1] === b[1];

/** The feeder (from 1) of `feeders` whose lamps show `picture`; throws where none does. */
export function feederShowing(feeders: readonly LampPicture[], picture: LampPicture): number {
  const at = feeders.findIndex((lamps) => samePicture(lamps, picture));
  if (at < 0) {
    throw new Error(`startup: no feeder shows ${picture.join('/')}`);
  }
  return at + 1;
}

/** What each gap of a stage's script has to hold: the faulty feeder, and the load's. */
export function rightValues(deal: StartupStage): Record<StartupGap, number> {
  return {
    sperre: feederShowing(deal.feeders, FAULT_PICTURE),
    abgang: feederShowing(deal.feeders, LOAD_PICTURES[deal.load]),
  };
}

/** The stage under way, as `init` dealt it. */
function dealNow(state: StartupState): StartupStage {
  const deal = state.stages[state.stage];
  if (deal === undefined) {
    throw new Error(`startup: no deal for stage ${state.stage + 1} of ${state.stages.length}`);
  }
  return deal;
}

/** When the pulse reaches the ladder's marked steps, and when it dies there, epoch ms. */
export function pulseTimes(
  def: Pick<StartupDef, 'travelSec' | 'windowSec'>,
  pulse: Pick<StartupPulse, 'sentAt'>,
): { arrivesAt: number; diesAt: number } {
  const arrivesAt = pulse.sentAt + def.travelSec * MS_PER_SEC;
  return { arrivesAt, diesAt: arrivesAt + def.windowSec * MS_PER_SEC };
}

/**
 * One stage's Schaltfeld: the stage's load, two more of the others and the faulty feeder, in an
 * order of its own.
 */
function boardFor(load: StartupLoad, rng: Rng): LampPicture[] {
  const others = shuffle(
    STARTUP_LOADS.filter((other) => other !== load),
    rng,
  ).slice(0, FEEDERS - 2);
  const pictures = [load, ...others].map((each) => LOAD_PICTURES[each]);
  return shuffle([...pictures, FAULT_PICTURE], rng);
}

// --- the log -------------------------------------------------------------------------------

/** `state` with `lines` logged at its end, the log cut to its last STARTUP_LOG_LINES. */
function logged(state: StartupState, lines: readonly Omit<StartupLogLine, 'n'>[]): StartupState {
  const added = lines.map((line, i) => ({ n: state.logged + i + 1, ...line }));
  return {
    ...state,
    log: [...state.log, ...added].slice(-STARTUP_LOG_LINES),
    logged: state.logged + lines.length,
  };
}

/** A console's Schaltfeld as the log names it: „Schaltfeld B". */
const boardName = (side: ConsoleId): string => `Schaltfeld ${side.toUpperCase()}`;

/** The log line a stage's script opens on as it is loaded. */
function loadedLine(def: StartupDef, stage: number, deal: StartupStage): Omit<StartupLogLine, 'n'> {
  const pult = typingConsole(stage).toUpperCase();
  const load = LOAD_NAMES[deal.load];
  const text = `Pult ${pult}: Skript Stufe ${stage + 1}/${def.stages} geladen, ${load}`;
  return { tag: 'info', text };
}

// --- the moves -----------------------------------------------------------------------------

/** `state` at `at`: a pulse on the ladder's marked steps by then, or dead after them. */
function caughtUp(def: StartupDef, state: StartupState, at: number): StartupState {
  const { pulse } = state;
  if (pulse === null) {
    return state;
  }
  const { arrivesAt, diesAt } = pulseTimes(def, pulse);
  if (at >= diesAt) {
    const dead = { ...state, pulse: null, last: 'verfallen' as const };
    return logged(dead, [{ tag: 'info', text: 'Impuls verfallen' }]);
  }
  const arrived = at >= arrivesAt && !pulse.arrived;
  return arrived ? { ...state, pulse: { ...pulse, arrived: true } } : state;
}

/** Whether somebody besides `playerId` stands at console `side`. */
const manned = (ctx: PuzzleContext, side: ConsoleId, playerId: string): boolean =>
  ctx.atConsoles[side].some((id) => id !== playerId);

/** `zeige`: the log names the stage, its load and the gaps still open. */
function shown(state: StartupState): Outcome {
  const open = gapsOf(state.stage).filter((gap) => state.values[gap] === undefined);
  const gaps = open.length === 0 ? 'alle Lücken gesetzt' : `offen: ${open.join(', ')}`;
  const text = `Stufe ${state.stage + 1}, ${LOAD_NAMES[dealNow(state).load]}: ${gaps}`;
  return { state: logged(state, [{ tag: 'info', text }]), penalty: null };
}

/** `setze <lücke> <wert>`: a gap of this stage's script takes a feeder's number. */
function set(state: StartupState, gap: StartupGap, value: number): Outcome {
  if (!gapsOf(state.stage).includes(gap)) {
    fail(`Das Skript dieser Stufe hat keine Lücke ${gap}.`);
  }
  const next = { ...state, values: { ...state.values, [gap]: value } };
  return { state: logged(next, [{ tag: 'info', text: `${gap} = ${value}` }]), penalty: null };
}

/**
 * `start`: every gap set, somebody at the other console's Schaltfeld — the pulse goes off where
 * every value fits the Schaltfeld, an alarm where one does not, the values left as they were.
 */
function started(state: StartupState, playerId: string, ctx: PuzzleContext): Outcome {
  const open = gapsOf(state.stage).find((gap) => state.values[gap] === undefined);
  if (open !== undefined) {
    fail(`Lücke ${open} ist offen.`);
  }
  const board = across(typingConsole(state.stage));
  if (!manned(ctx, board, playerId)) {
    fail('Am Schaltfeld der Gegenseite steht niemand.');
  }
  const right = rightValues(dealNow(state));
  if (gapsOf(state.stage).some((gap) => state.values[gap] !== right[gap])) {
    const text = `Anlauf verweigert: Werte passen nicht zu ${boardName(board)}`;
    return {
      state: logged(state, [{ tag: 'fail', text }]),
      penalty: 'Anlaufsteuerung: Skript passt nicht',
    };
  }
  const sent = { ...state, pulse: { sentAt: ctx.at, arrived: false }, last: null };
  const text = `Impuls an ${boardName(board)} unterwegs`;
  return { state: logged(sent, [{ tag: 'ok', text }]), penalty: null };
}

/** A command at the terminal: only the typing console's runs a script, and not under a pulse. */
function commanded(state: StartupState, input: Command, playerId: string, ctx: PuzzleContext) {
  if (ctx.console !== typingConsole(state.stage)) {
    fail('Dieses Terminal hat in dieser Stufe kein Skript.');
  }
  if (input.cmd === 'zeige') {
    return shown(state);
  }
  if (state.pulse !== null) {
    fail('Ein Impuls ist unterwegs; das Skript ist gesperrt.');
  }
  return input.cmd === 'setze' ? set(state, input.gap, input.value) : started(state, playerId, ctx);
}

/** The stage run up: its breaker latched, the next stage's script loaded, or the last done. */
function ranUp(def: StartupDef, state: StartupState, feeder: number): StartupState {
  const board = across(typingConsole(state.stage));
  const text = `Stufe ${state.stage + 1} angelaufen: ${LOAD_NAMES[dealNow(state).load]} nimmt Last`;
  const done: StartupState = {
    ...state,
    stage: Math.min(state.stage + 1, state.stages.length - 1),
    values: {},
    pulse: null,
    closed: [...state.closed, { console: board, feeder }],
    last: 'angelaufen',
  };
  const next = state.stages[state.stage + 1];
  const lines = [{ tag: 'ok' as const, text }];
  const loaded = next === undefined ? [] : [loadedLine(def, state.stage + 1, next)];
  return logged(done, [...lines, ...loaded]);
}

/**
 * A breaker closed at the Schaltfeld taking the pulse: the named feeder's on the marked steps
 * runs the stage up; before them the pulse is dropped; any other feeder's kills it with an alarm.
 */
function breaker(def: StartupDef, state: StartupState, feeder: number, ctx: PuzzleContext) {
  const board = across(typingConsole(state.stage));
  if (ctx.console !== board) {
    fail('Dieses Schaltfeld ist in dieser Stufe nicht aufgeschaltet.');
  }
  if (state.pulse === null) {
    fail('Kein Impuls auf der Leitung.');
  }
  if (feeder !== state.values.abgang) {
    const dead = { ...state, pulse: null, last: 'falsch' as const };
    const text = `${boardName(board)}: Leistungsschalter ${feeder} falsch, Impuls erloschen`;
    return {
      state: logged(dead, [{ tag: 'fail', text }]),
      penalty: 'Anlaufsteuerung: falscher Leistungsschalter',
    };
  }
  if (ctx.at < pulseTimes(def, state.pulse).arrivesAt) {
    const dropped = { ...state, pulse: null, last: 'verworfen' as const };
    const text = `${boardName(board)}: Schalter vor dem Fenster, Impuls verworfen`;
    return { state: logged(dropped, [{ tag: 'info', text }]), penalty: null };
  }
  return { state: ranUp(def, state, feeder), penalty: null };
}

// --- the views -----------------------------------------------------------------------------

/** The stage's script as the terminal lists it, its gaps where the stage has them. */
export function scriptOf(def: StartupDef, stage: number, load: StartupLoad): StartupScriptLine[] {
  const board = across(typingConsole(stage)).toUpperCase();
  const comments: Record<StartupGap, string> = {
    sperre: `gestörter Abgang: rote Kontrollleuchte an Schaltfeld ${board}`,
    abgang: `Last ${LOAD_NAMES[load]}: Leuchtbild nach Tabelle 2 des Betriebsbuchs`,
  };
  const gaps = gapsOf(stage).map(
    (gap): StartupScriptLine => ({ kind: 'gap', gap, comment: comments[gap] }),
  );
  return [
    { kind: 'comment', text: `AS-86 Anlaufskript, Stufe ${stage + 1} von ${def.stages}` },
    { kind: 'code', text: 'lade anlauf.cfg', comment: null },
    ...gaps,
    {
      kind: 'code',
      text: `impuls abgang -> ${board}`,
      comment: 'Leistungsschalter schließt auf den markierten Stufen der Leiter',
    },
  ];
}

/** The live terminal: the stage's script, its values, whether a pulse is off, the log. */
function terminalOf(def: StartupDef, state: StartupState): StartupTerminal {
  const gaps = gapsOf(state.stage);
  const { load } = dealNow(state);
  return {
    load,
    script: scriptOf(def, state.stage, load),
    gaps,
    values: Object.fromEntries(gaps.map((gap) => [gap, state.values[gap] ?? null])),
    sent: state.pulse !== null,
    log: state.log.map((line) => ({ ...line })),
  };
}

/** The live Schaltfeld: its feeders' lamps, the pulse coming in. */
function boardOf(state: StartupState): StartupBoard {
  return {
    feeders: dealNow(state).feeders.map((lamps, i) => ({
      feeder: i + 1,
      lamps: [lamps[0], lamps[1]],
    })),
    pulse: state.pulse === null ? null : { ...state.pulse },
  };
}

/** What is live at the viewer's console this stage; null away from the consoles. */
function roleOf(viewer: Viewer, types: ConsoleId): StartupView['role'] {
  if (!viewer.operating || viewer.console === null) {
    return null;
  }
  return viewer.console === types ? 'terminal' : 'board';
}

// --- the printed document ------------------------------------------------------------------

const PLATE: TypePlate = { name: 'Anlaufsteuerung', type: 'AS-86', year: 1986 };

const PURPOSE =
  'Die Anlaufsteuerung fährt die Hilfsbetriebe des Notstromaggregats an: Ein Skript schickt ' +
  'einen Startimpuls durch den Kabelkanal im Boden zum Schaltfeld der Gegenseite.';

const BUILD =
  'Zwei baugleiche Pulte, A und B, in getrennten Räumen, jedes mit Terminal und Schaltfeld. ' +
  'Jeder der vier Abgänge eines Schaltfelds trägt zwei Kontrollleuchten und einen ' +
  'Leistungsschalter; die LED-Leiter daneben zeigt den ankommenden Impuls, ihre obersten Stufen ' +
  'sind markiert.';

/** Betrieb: the alternating sides, the pulse's travel and window, the faults and their cost. */
function operationText(def: StartupDef): string {
  return (
    'In den ungeraden Stufen läuft das Skript an Pult A und schaltet Schaltfeld B, in den ' +
    `geraden umgekehrt. Der Impuls braucht ${def.travelSec} Sekunden durch den Kanal und steht ` +
    `dann ${def.windowSec} Sekunden auf den markierten Stufen. Ein Skript, das nicht zum ` +
    'Schaltfeld passt, und ein falscher Leistungsschalter sind Fehlquittierungen: Die ' +
    `Überwachung meldet Alarm und zieht ${costOf(def.penaltySec)} ab.`
  );
}

/** The drawing of the LED ladder with its marked steps; the client draws it under this name. */
export const LADDER_FIGURE = 'startup-ladder';

const COMMANDS: ManualBlock = {
  kind: 'table',
  head: ['Befehl am Terminal', 'Wirkung'],
  rows: [
    ['zeige', 'nennt Stufe, Last und die offenen Lücken des Skripts'],
    ['setze <lücke> <wert>', 'setzt die Nummer eines Abgangs in eine Lücke'],
    ['start', 'schickt den Impuls, sobald jede Lücke gesetzt ist'],
  ],
};

/** Tabelle 2: each load's picture, and the faulty feeder's. */
function pictureTable(): ManualBlock {
  const words = ([upper, lower]: LampPicture): string[] => [LAMP_WORDS[upper], LAMP_WORDS[lower]];
  return {
    kind: 'table',
    head: ['Leuchte oben', 'Leuchte unten', 'Abgang'],
    rows: [
      ...STARTUP_LOADS.map((load) => [...words(LOAD_PICTURES[load]), LOAD_NAMES[load]]),
      [...words(FAULT_PICTURE), 'gestört (sperre)'],
    ],
  };
}

/** The ladder's law: its window, early and late, the wrong breaker, the other console. */
function rulesOf(def: StartupDef): ManualBlock {
  return {
    kind: 'rules',
    items: [
      'Wenn eine Lücke des Skripts offen ist oder das Schaltfeld der Gegenseite unbesetzt, ' +
        'nimmt das Terminal start nicht an.',
      'Wenn der Leistungsschalter des Abgangs, den das Skript nennt, in den ' +
        `${spelled(def.windowSec)} Sekunden auf den markierten Stufen schließt, läuft die ` +
        'Stufe an.',
      'Wenn er vorher schließt, verwirft die Leiter den Impuls; danach verfällt er.',
      'Wenn ein anderer Leistungsschalter schließt, erlischt der Impuls.',
    ],
  };
}

/** The printed log: a stage of a past shift, its lamps, its table row, its window. */
const LOG: readonly string[] = [
  '04:12 Pult A, Stufe 1, Last Notstromschiene: Schaltfeld B meldet Abgang 2 gelb über dunkel.',
  '04:12 Tabelle 2: gelb über dunkel ist die Notstromschiene; setze abgang 2; start.',
  '04:13 Leistungsschalter 2 auf der ersten markierten Stufe: Stufe 1 angelaufen.',
];

const WORKSHOP: readonly string[] = [
  'Die Leiter zählt nicht vor: Nur das Licht im Bodenkanal verrät, wie weit der Impuls ist.',
  'Das Terminal stammt von 1986 und kennt nur seine drei Befehle.',
];

// --- the solver ----------------------------------------------------------------------------

/** Who sends a move from console `side`: the operator at a, the partner at b. */
const senderAt = (side: ConsoleId): Move<StartupInput>['by'] =>
  side === 'a' ? 'operator' : 'partner';

/** The live terminal's view and the live Schaltfeld's; throws where either is missing. */
function seenBy(def: StartupDef, { operator, partner }: Perspectives<StartupView>) {
  const terminal = [operator, partner].find((view) => view?.role === 'terminal')?.terminal ?? null;
  const board = [operator, partner].find((view) => view?.role === 'board')?.board ?? null;
  if (terminal === null || board === null) {
    throw new Error(
      `startup "${def.id}": solving needs the live terminal's view at one console and the ` +
        "live Schaltfeld's at the other",
    );
  }
  return { terminal, board, types: operator.types };
}

export const startupModule: PuzzleModule<StartupDef, StartupState, StartupInput, StartupView> = {
  type: 'startup',
  usesEdgework: false,
  wholeCrew: false,
  consoles: 2,
  fields: [
    {
      key: 'stages',
      label: 'Stufen',
      help:
        'So viele Skripte laufen an; nach jeder Stufe tauschen Terminal und Schaltfeld die ' +
        'Seiten.',
      kind: 'int',
      min: 2,
      max: 3,
      default: 2,
    },
    {
      key: 'travelSec',
      label: 'Laufzeit in Sekunden',
      help: 'So lange braucht der Impuls durch den Bodenkanal bis zur Leiter der Gegenseite.',
      kind: 'int',
      min: 4,
      max: 10,
      default: 6,
    },
    {
      key: 'windowSec',
      label: 'Fenster in Sekunden',
      help: 'So lange steht der Impuls auf den markierten Stufen der Leiter.',
      kind: 'int',
      min: 2,
      max: 5,
      default: 3,
    },
  ],
  defSchema,
  inputSchema,

  /**
   * A load for every stage, no two the same, each with a Schaltfeld of its load, two more and
   * the faulty feeder in an order of its own; the log opens on the first script.
   */
  init(def, rng) {
    const loads = shuffle(STARTUP_LOADS, rng).slice(0, def.stages);
    const stages = loads.map((load) => ({ load, feeders: boardFor(load, rng) }));
    const fresh: StartupState = {
      type: 'startup',
      stage: 0,
      stages,
      values: {},
      pulse: null,
      closed: [],
      last: null,
      log: [],
      logged: 0,
    };
    const [first] = stages;
    return first === undefined ? fresh : logged(fresh, [loadedLine(def, 0, first)]);
  },

  apply(def, state, input, playerId, ctx) {
    if (ctx.console === null) {
      fail('Eingabe nur am Pult.');
    }
    const now = caughtUp(def, state, ctx.at);
    const outcome =
      'breaker' in input
        ? breaker(def, now, input.breaker, ctx)
        : commanded(now, input, playerId, ctx);
    const solved = outcome.state.closed.length === outcome.state.stages.length;
    return { ...outcome, solved };
  },

  /** The pulse reaching the marked steps, then dying on them. */
  dueAt(def, state) {
    if (state.pulse === null) {
      return null;
    }
    const { arrivesAt, diesAt } = pulseTimes(def, state.pulse);
    return state.pulse.arrived ? diesAt : arrivesAt;
  },

  expire(def, state, at) {
    return caughtUp(def, state, at);
  },

  view(def, state, viewer) {
    const audience = viewer.playerId === null;
    const types = typingConsole(state.stage);
    const role = roleOf(viewer, types);
    return {
      kind: 'startup',
      stage: state.stage + 1,
      stages: state.stages.length,
      role,
      types,
      terminal: role === 'terminal' || audience ? terminalOf(def, state) : null,
      board: role === 'board' || audience ? boardOf(state) : null,
      ladder: { steps: def.travelSec + def.windowSec, marked: def.windowSec },
      closed: role !== null || audience ? state.closed.map((entry) => ({ ...entry })) : null,
      last: state.last,
    };
  },

  /** Both consoles are the same device: a terminal over a Schaltfeld. */
  plate(_def, console) {
    return `Pult ${console.toUpperCase()} fährt mit der Gegenseite die Hilfsbetriebe an`;
  },

  manual(def) {
    return labDocument({
      plate: PLATE,
      purpose: PURPOSE,
      figure: { of: 'startup', device: 'Terminal und Schaltfeld' },
      build: BUILD,
      operation: operationText(def),
      law: [
        { heading: 'Befehle (Tabelle 1)', blocks: [COMMANDS] },
        { heading: 'Leuchtbilder (Tabelle 2)', blocks: [pictureTable()] },
        {
          heading: 'Impuls und Leiter',
          blocks: [
            { kind: 'figure', of: LADDER_FIGURE, caption: 'Abb. 2 — LED-Leiter mit Fenster' },
            rulesOf(def),
          ],
        },
      ],
      log: LOG,
      workshop: WORKSHOP,
    });
  },

  /**
   * The terminal names the load, the Schaltfeld shows the lamps, the printed table gives the
   * load's picture. While a pulse is on its way the crew waits; once it stands on the marked
   * steps the named feeder's breaker closes. Otherwise every gap that does not hold its right
   * value is set — the faulty feeder, the load's — and the script started, all at once.
   */
  solve(def, views) {
    const { terminal, board, types } = seenBy(def, views);
    if (board.pulse !== null) {
      const feeder = terminal.values.abgang ?? null;
      return board.pulse.arrived && feeder !== null
        ? [{ by: senderAt(across(types)), input: { breaker: feeder } }]
        : [];
    }
    const feeders = board.feeders.map((entry) => entry.lamps);
    const right = rightValues({ load: terminal.load, feeders });
    const by = senderAt(types);
    const sets = terminal.gaps
      .filter((gap) => terminal.values[gap] !== right[gap])
      .map((gap): Move<StartupInput> => ({ by, input: { cmd: 'setze', gap, value: right[gap] } }));
    return [...sets, { by, input: { cmd: 'start' } }];
  },
};
