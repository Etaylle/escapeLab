import { z } from 'zod';
import { serialLastDigit, type Edgework } from '../edgework.js';
import { fail } from '../errors.js';
import { mulberry32, shuffle, type Rng } from '../rng.js';
import {
  commonDefShape,
  type ApplyResult,
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
 * Paketfilter: a station with two consoles in different places, played in waves. Packets drift
 * down five lines into the Kern, each `fallSec` seconds from top to bottom. Console a, the
 * Sperrpult, shows them as plain blips and trips a gate on a line, dropping the lowest packet on
 * it; console b, the Analysepult, shows the same packets with their headers (Quelle, Port,
 * Protokoll) and marks them, a mark wearing a ring at console a. Which packets are hostile only
 * the Sicherheitsrichtlinie says — the printed page, an ordered list whose first fitting rule
 * decides, one rule reading the Laborkennung. A wave is cleared once every hostile packet was
 * dropped and every other reached the Kern. A packet dropped that the policy lets through, and a
 * hostile one reaching the Kern, are a fault: the wave is called off and a fresh one starts after
 * a breath, so a wave costs one alarm at most. Positions are a pure function of the wave's start
 * and the server's clock; the wave runs only while both consoles are manned and holds while one
 * stands empty (`elapse`).
 */

/** The lines the packets come down, numbered from the left. */
export const FIREWALL_LINES = 5;

/** The breath between a wave called off or cleared and the first packet of the next, ms. */
export const FIREWALL_PAUSE_MS = 4000;

/** How far apart two packets come onto the lines, as shares of a packet's fall. */
const GAP_MIN = 0.22;
const GAP_SPREAD = 0.1;
/**
 * How far apart two packets of one line come onto it at least, as a share of a fall: a packet
 * behind another has at least this much of its fall left once the one ahead is through.
 */
const SAME_LINE_GAP = 0.5;

/** How many tries a packet of a given deciding rule gets to be drawn. */
const DRAW_TRIES = 400;

const defSchema = z.strictObject({
  type: z.literal('firewall'),
  ...commonDefShape,
  /** clean waves the Kern needs */
  waves: z.number().int().min(1).max(4).default(3),
  /** packets in a wave, two or three of them hostile */
  packets: z.number().int().min(5).max(9).default(7),
  /** seconds a packet takes from the top of its line into the Kern */
  fallSec: z.number().int().min(8).max(20).default(14),
  /** how many of the policy's numbered rules decide the instance's packets */
  rules: z.number().int().min(3).max(6).default(4),
  penaltySec: z.number().int().positive().default(20),
});
export type FirewallDef = z.infer<typeof defSchema>;

// --- the policy ----------------------------------------------------------------------------

export const FIREWALL_PROTOCOLS = ['TCP', 'UDP'] as const;
export type FirewallProtocol = (typeof FIREWALL_PROTOCOLS)[number];

/** A packet's header as the Analysepult shows it. */
export interface FirewallHeader {
  /** the sender's address: 10.4.2.17 */
  source: string;
  port: number;
  protocol: FirewallProtocol;
}

/** The networks the policy names, by the head of their addresses. */
const LAB_NET = '10.4.';
const SERVICE_NET = '10.9.';

/** What the policy does with a packet. */
export type FirewallVerdict = 'sperren' | 'durchlassen';

/**
 * What a packet a rule decides looks like, so that one is drawn quickly: the heads of its
 * address, its protocols and its ports — anything where left out.
 */
interface PacketShape {
  heads?: readonly string[];
  protocols?: readonly FirewallProtocol[];
  ports?: (digit: number) => readonly number[];
}

/** A numbered rule of the policy: what it does with a packet it fits, and its printed words. */
interface PolicyRule {
  verdict: FirewallVerdict;
  text: string;
  /** whether it fits `header`, rule 4 reading the Laborkennung's last digit */
  fits: (header: FirewallHeader, digit: number) => boolean;
  shape: PacketShape;
}

const fromServiceNet = (h: FirewallHeader): boolean => h.source.startsWith(SERVICE_NET);
const fromLabNet = (h: FirewallHeader): boolean => h.source.startsWith(LAB_NET);

/** Ports the policy names: remote logins (rule 2), name service and addressing over UDP (5). */
const REMOTE_PORTS: readonly number[] = [23, 3389];
const SERVICE_PORTS: readonly number[] = [53, 67];

/** Ports a header may carry, one or more for every last digit, so that rule 4 fits any serial. */
const PORTS: readonly number[] = [
  80, 110, 8080, 21, 161, 22, 5432, 23, 143, 443, 993, 53, 514, 1194, 25, 135, 445, 636, 8086,
  67, 587, 6667, 3128, 8008, 69, 3389,
];

/** The Sicherheitsrichtlinie's numbered rules, in their order: the first that fits decides. */
export const FIREWALL_POLICY: readonly PolicyRule[] = [
  {
    verdict: 'durchlassen',
    text: 'Wenn die Quelle im Wartungsnetz liegt, darf das Paket passieren.',
    fits: fromServiceNet,
    shape: { heads: [SERVICE_NET] },
  },
  {
    verdict: 'sperren',
    text: 'Wenn der Port 23 oder 3389 ist, ist das Paket zu sperren.',
    fits: (h) => REMOTE_PORTS.includes(h.port),
    shape: { ports: () => REMOTE_PORTS },
  },
  {
    verdict: 'durchlassen',
    text: 'Wenn die Quelle im Labornetz liegt und das Protokoll TCP ist, darf das Paket passieren.',
    fits: (h) => fromLabNet(h) && h.protocol === 'TCP',
    shape: { heads: [LAB_NET], protocols: ['TCP'] },
  },
  {
    verdict: 'sperren',
    text:
      'Wenn der Port auf die letzte Ziffer der Laborkennung endet, ist das Paket zu sperren.',
    fits: (h, digit) => h.port % 10 === digit,
    shape: { ports: (digit) => PORTS.filter((port) => port % 10 === digit) },
  },
  {
    verdict: 'durchlassen',
    text: 'Wenn das Protokoll UDP ist und der Port 53 oder 67, darf das Paket passieren.',
    fits: (h) => h.protocol === 'UDP' && SERVICE_PORTS.includes(h.port),
    shape: { protocols: ['UDP'], ports: () => SERVICE_PORTS },
  },
  {
    verdict: 'sperren',
    text: 'Wenn das Protokoll UDP ist, ist das Paket zu sperren.',
    fits: (h) => h.protocol === 'UDP',
    shape: { protocols: ['UDP'] },
  },
];

/** What happens to a packet no numbered rule fits: the Grundregel, printed last. */
const BASE_VERDICT: FirewallVerdict = 'durchlassen';
const BASE_TEXT = 'Andernfalls darf das Paket passieren.';

/** The Grundregel's place: after the numbered rules. */
export const BASE_RULE = FIREWALL_POLICY.length;

/** The rule that decides `header` (0-based), the first that fits; BASE_RULE where none does. */
export function decidingRule(header: FirewallHeader, digit: number): number {
  const found = FIREWALL_POLICY.findIndex((rule) => rule.fits(header, digit));
  return found === -1 ? BASE_RULE : found;
}

/** Rule `index`'s verdict, the Grundregel's at BASE_RULE. */
const verdictOfRule = (index: number): FirewallVerdict =>
  FIREWALL_POLICY[index]?.verdict ?? BASE_VERDICT;

/** Whether the policy has `header` dropped, with the Laborkennung read: its first fitting rule. */
export function hostileByPolicy(header: FirewallHeader, edgework: Edgework): boolean {
  return verdictOfRule(decidingRule(header, serialLastDigit(edgework))) === 'sperren';
}

/** Whether any rule that drops fits `header`, whatever comes before it: no order kept. */
export function fitsADropRule(header: FirewallHeader, digit: number): boolean {
  return FIREWALL_POLICY.some((rule) => rule.verdict === 'sperren' && rule.fits(header, digit));
}

// --- the state -----------------------------------------------------------------------------

/** A packet of the wave under way. */
export interface FirewallPacket {
  /** `<wave>-<n>`, n counted in the order the packets come onto the lines */
  id: string;
  /** 0 to FIREWALL_LINES - 1, from the left */
  line: number;
  /** when it comes onto its line, ms of the wave's time */
  enterMs: number;
  header: FirewallHeader;
  /** the policy has it dropped: never shown anywhere */
  hostile: boolean;
}

/** What the device last reported, counted so that a new report is told from an old one. */
export interface FirewallEvent {
  n: number;
  /**
   * drop: a hostile packet dropped; void: a trip that hit nothing; fault: a wave called off on a
   * fault; cleared: a clean wave, the next one coming; done: the last clean wave
   */
  kind: 'drop' | 'void' | 'fault' | 'cleared' | 'done';
  /** epoch ms on the server's clock */
  at: number;
  /** the line a trip went to; null for what the clock did */
  line: number | null;
}

export interface FirewallState {
  type: 'firewall';
  /** what the waves are drawn from, a stream each */
  seed: number;
  /** the Laborkennung's last digit, which rule 4 reads */
  digit: number;
  /** the numbered rules (0-based) the instance's packets are decided by, in the policy's order */
  exercised: number[];
  /** waves dealt so far, the one under way included */
  dealt: number;
  /** clean waves so far */
  cleared: number;
  /** the wave under way, in the order the packets come onto the lines */
  packets: FirewallPacket[];
  /** how many of them are on the lines or through by now */
  entered: number;
  /** ids of the packets console b marked */
  marks: string[];
  /** ids of the packets dropped */
  dropped: string[];
  /** epoch ms of the wave's time 0, moved on by every hold */
  startedAt: number;
  /** epoch ms the wave stands still since; null while it runs */
  heldAt: number | null;
  /** the consoles nobody stood at when the clock last looked */
  vacant: ConsoleId[];
  event: FirewallEvent | null;
}

const inputSchema = z.union([
  /** a trip of the gate on a line, at console a */
  z.strictObject({ trip: z.number().int().min(0).max(FIREWALL_LINES - 1) }),
  /** a mark set or taken back, at console b */
  z.strictObject({ mark: z.string().min(1).max(16) }),
]);
export type FirewallInput = z.infer<typeof inputSchema>;

/** A packet as a console shows it: the header only at console b and for the audience. */
export interface FirewallBlip {
  id: string;
  line: number;
  enterMs: number;
  marked: boolean;
  dropped: boolean;
  header: FirewallHeader | null;
}

/**
 * The open Paketfilter as one player sees it. The Sperrpult shows no header, the Analysepult no
 * gate, the policy no packet; nobody sees which packet is hostile, the audience neither.
 */
export interface FirewallView {
  kind: 'firewall';
  /** the viewer's console: the gate at a, the analysis at b; null elsewhere */
  role: 'gate' | 'analysis' | null;
  /** the wave under way, from 1 */
  wave: number;
  waves: number;
  cleared: number;
  fallMs: number;
  /** the wave's clock — at a console and for the audience */
  clock: { startedAt: number; heldAt: number | null } | null;
  /** the consoles standing empty, which hold the wave */
  vacant: ConsoleId[];
  /** the packets come onto the lines so far — at a console and for the audience */
  packets: FirewallBlip[] | null;
  event: FirewallEvent | null;
}

// --- the clock -----------------------------------------------------------------------------

const fallMsOf = (def: FirewallDef): number => def.fallSec * 1000;

/** The wave's time at `at`, ms: standing still while held. */
const waveMs = (state: FirewallState, at: number): number =>
  (state.heldAt ?? at) - state.startedAt;

/** When `packet` reaches the Kern, ms of the wave's time. */
const arrivalMs = (def: FirewallDef, packet: FirewallPacket): number =>
  packet.enterMs + fallMsOf(def);

/** Whether `packet` is on its line at wave time `t`: come on, not dropped, not through. */
function falling(def: FirewallDef, state: FirewallState, packet: FirewallPacket, t: number) {
  return packet.enterMs <= t && t < arrivalMs(def, packet) && !state.dropped.includes(packet.id);
}

/** The first hostile packet still to be dropped, by its arrival; undefined for none. */
function nextHostile(def: FirewallDef, state: FirewallState): FirewallPacket | undefined {
  const left = state.packets.filter((p) => p.hostile && !state.dropped.includes(p.id));
  return left.sort((p, q) => arrivalMs(def, p) - arrivalMs(def, q))[0];
}

/** When the last packet the policy lets through reaches the Kern, ms of the wave's time. */
function lastThrough(def: FirewallDef, state: FirewallState): number {
  return Math.max(0, ...state.packets.filter((p) => !p.hostile).map((p) => arrivalMs(def, p)));
}

/** The lowest packet on `line` at wave time `t`: the one longest on it; undefined for none. */
function lowestOn(def: FirewallDef, state: FirewallState, line: number, t: number) {
  return state.packets.find((p) => p.line === line && falling(def, state, p, t));
}

/** `state` with the device's next report. */
function reported(
  state: FirewallState,
  kind: FirewallEvent['kind'],
  at: number,
  line: number | null = null,
): FirewallState {
  return { ...state, event: { n: (state.event?.n ?? 0) + 1, kind, at, line } };
}

// --- the waves -----------------------------------------------------------------------------

const pick = <T>(items: readonly T[], rng: Rng): T => {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) {
    throw new Error('firewall: nothing to draw from');
  }
  return item;
};

/** The heads of the addresses outside the lab's networks; 10.6. is the guests' network. */
const FOREIGN_HEADS: readonly string[] = ['10.6.', '31.14.', '62.80.', '85.12.', '141.7.', '193.4.'];

/** A sender's address in `head`'s network: 10.4.2.17. */
function addressIn(head: string, rng: Rng): string {
  const tail = head.split('.').length === 3 ? `${Math.floor(rng() * 10)}.` : '';
  return `${head}${tail}${1 + Math.floor(rng() * 98)}`;
}

/** The heads of every address a header may carry. */
const HEADS: readonly string[] = [LAB_NET, SERVICE_NET, ...FOREIGN_HEADS];

/** A header drawn at random in the shape of the packets `rule` decides (BASE_RULE: any). */
function drawnHeader(rule: number, digit: number, rng: Rng): FirewallHeader {
  const shape = FIREWALL_POLICY[rule]?.shape ?? {};
  const head = pick(shape.heads ?? HEADS, rng);
  const protocol = pick(shape.protocols ?? FIREWALL_PROTOCOLS, rng);
  const port = pick(shape.ports?.(digit) ?? PORTS, rng);
  return { source: addressIn(head, rng), port, protocol };
}

/**
 * A header that `rule` decides (BASE_RULE: the Grundregel) — and for a decoy, one that one of
 * the rules `caught` drops fits too, further down the list: only the policy's order lets it
 * through. Throws where none comes in DRAW_TRIES draws: the rules leave no such packet.
 */
function headerFor(rule: number, caught: readonly number[] | null, digit: number, rng: Rng) {
  for (let i = 0; i < DRAW_TRIES; i++) {
    const header = drawnHeader(rule, digit, rng);
    const decided = decidingRule(header, digit) === rule;
    const decoy = caught?.some((drop) => FIREWALL_POLICY[drop]?.fits(header, digit)) ?? true;
    if (decided && decoy) {
      return header;
    }
  }
  throw new Error(`firewall: no packet that rule ${rule + 1} decides (digit ${digit})`);
}

/** The numbered rules that rule `verdict`, of those the instance exercises. */
const exercisedBy = (state: Pick<FirewallState, 'exercised'>, verdict: FirewallVerdict) =>
  state.exercised.filter((rule) => verdictOfRule(rule) === verdict);

/**
 * The deciding rules of a wave's packets, `hostile` of them dropping: the instance's rules
 * that drop in turn, then a decoy decided by one that lets through where a rule in play that
 * drops stands further down (DECOY_DROPS) — the Wartungsnetz's always can —, then the rest and
 * the Grundregel in turn — each list taken on from where the wave before left it, so that the
 * waves together exercise every rule of the instance.
 */
function rulesOfWave(state: FirewallState, count: number, hostile: number, wave: number) {
  const drops = exercisedBy(state, 'sperren');
  const passes = exercisedBy(state, 'durchlassen');
  const kinds = [...passes, BASE_RULE];
  const at = <T>(list: readonly T[], i: number): T => list[i % list.length] as T;
  const hostiles = Array.from({ length: hostile }, (_, i) => at(drops, wave * hostile + i));
  const decoys = passes.filter((rule) => DECOY_DROPS[rule]?.some((drop) => drops.includes(drop)));
  const decoy = at(decoys, wave);
  const others = Array.from({ length: count - hostile - 1 }, (_, i) => at(kinds, wave + i + 1));
  return { hostiles, decoy, others };
}

/** The line a packet coming on at `enterMs` takes: one nothing came onto for a while. */
function lineFor(placed: readonly FirewallPacket[], enterMs: number, fallMs: number, rng: Rng) {
  const free = Array.from({ length: FIREWALL_LINES }, (_, line) => line).filter((line) =>
    placed.every((p) => p.line !== line || enterMs - p.enterMs >= fallMs * SAME_LINE_GAP),
  );
  return pick(free, rng);
}

/**
 * Wave `wave` (0-based) of an instance: `packets` of them, two or three hostile, their deciding
 * rules as `rulesOfWave` deals them in an order of their own, coming on one after the other from
 * FIREWALL_PAUSE_MS on, each on a line nothing came onto for half a fall.
 */
export function dealWave(def: FirewallDef, state: FirewallState, wave: number): FirewallPacket[] {
  const rng = mulberry32((state.seed + wave * 7919) >>> 0);
  const hostile = 2 + (rng() < 0.5 ? 1 : 0);
  const { hostiles, decoy, others } = rulesOfWave(state, def.packets, hostile, wave);
  const drops = exercisedBy(state, 'sperren');
  const slots = shuffle(
    [
      ...hostiles.map((rule) => ({ rule, decoy: false })),
      { rule: decoy, decoy: true },
      ...others.map((rule) => ({ rule, decoy: false })),
    ],
    rng,
  );
  const fallMs = fallMsOf(def);
  const placed: FirewallPacket[] = [];
  let enterMs = FIREWALL_PAUSE_MS;
  for (const [n, slot] of slots.entries()) {
    const header = headerFor(slot.rule, slot.decoy ? drops : null, state.digit, rng);
    const line = lineFor(placed, enterMs, fallMs, rng);
    const hostileHere = verdictOfRule(slot.rule) === 'sperren';
    placed.push({ id: `${wave + 1}-${n + 1}`, line, enterMs, header, hostile: hostileHere });
    enterMs += Math.round(fallMs * (GAP_MIN + rng() * GAP_SPREAD));
  }
  return placed;
}

/**
 * The order the numbered rules come into play as `rules` grows (0-based): the four simplest
 * first — the Wartungsnetz, the remote ports, the Labornetz over TCP, UDP at large —, then the
 * name service's exception, and the Laborkennung's digit last. A first run at the default
 * reads the whole page but meets no packet that turns on the sign or on a port pair.
 */
const RULES_IN_PLAY: readonly number[] = [0, 1, 2, 5, 4, 3];

/** The rules an instance's packets are decided by: the first `rules` of RULES_IN_PLAY. */
const exercisedRules = (def: FirewallDef): number[] =>
  RULES_IN_PLAY.slice(0, def.rules).sort((a, b) => a - b);

/**
 * The rules that drop further down the list than a rule that lets through, by that rule: what
 * makes a packet of it a decoy — only the order lets it through.
 */
const DECOY_DROPS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 3, 5],
  2: [3],
  4: [5],
};

/** The station going on as `state`: no alarm, no solve. */
const going = (state: FirewallState): ApplyResult<FirewallState> => ({
  state,
  solved: false,
  penalty: null,
});

/** A fresh wave from `from` (epoch ms), running or held as the one before was. */
function nextWave(def: FirewallDef, state: FirewallState, from: number): FirewallState {
  const fresh = { ...state, dealt: state.dealt + 1, entered: 0, marks: [], dropped: [] };
  const startedAt = from;
  const heldAt = state.heldAt === null ? null : from;
  return { ...fresh, packets: dealWave(def, fresh, state.dealt), startedAt, heldAt };
}

/** A fault at `at`: the alarm, and the wave called off for a fresh one. */
function faulted(def: FirewallDef, state: FirewallState, at: number, penalty: string) {
  const called = reported(nextWave(def, state, at), 'fault', at);
  return { state: called, solved: false, penalty };
}

/** A clean wave at `at`: the next one, or the station's solve after the last. */
function clean(def: FirewallDef, state: FirewallState, at: number): ApplyResult<FirewallState> {
  const counted = { ...state, cleared: state.cleared + 1 };
  if (counted.cleared >= def.waves) {
    return { state: reported(counted, 'done', at), solved: true, penalty: null };
  }
  return going(reported(nextWave(def, counted, at), 'cleared', at));
}

const KERN_HIT = 'Paketfilter: Angriff im Kern';
const WRONG_DROP = 'Paketfilter: zulässiges Paket gesperrt';

/**
 * The running wave up to `at`: a hostile packet in the Kern by then is a fault at its arrival; a
 * wave whose hostile packets are all dropped is clean once the last other one is through; the
 * packets come on by then counted. Only one of a fault and a clean wave at a time: the next comes
 * with the next look.
 */
function ranTo(def: FirewallDef, state: FirewallState, at: number): ApplyResult<FirewallState> {
  const t = waveMs(state, at);
  const hostile = nextHostile(def, state);
  if (hostile !== undefined && arrivalMs(def, hostile) <= t) {
    return faulted(def, state, state.startedAt + arrivalMs(def, hostile), KERN_HIT);
  }
  const through = lastThrough(def, state);
  if (hostile === undefined && through <= t) {
    return clean(def, state, state.startedAt + through);
  }
  const entered = Math.max(state.entered, state.packets.filter((p) => p.enterMs <= t).length);
  const counted = entered === state.entered ? state : { ...state, entered };
  return going(counted);
}

/** The consoles nobody stands at, by presence. */
const vacantOf = (atConsoles: PuzzleContext['atConsoles']): ConsoleId[] =>
  (['a', 'b'] as const).filter((side) => atConsoles[side].length === 0);

/**
 * The wave held at `at` where a console stands empty, going on where both are manned again —
 * its time moved on by the hold —, and the empty consoles noted; `state` itself where nothing
 * changed.
 */
function staffed(state: FirewallState, vacant: ConsoleId[], at: number): FirewallState {
  const held = state.heldAt !== null;
  const same = vacant.join() === state.vacant.join();
  if (held === vacant.length > 0 && same) {
    return state;
  }
  if (vacant.length > 0) {
    return { ...state, vacant, heldAt: state.heldAt ?? at };
  }
  const heldAt = state.heldAt ?? at;
  return { ...state, vacant, heldAt: null, startedAt: state.startedAt + (at - heldAt) };
}

// --- the moves -----------------------------------------------------------------------------

/** What a trip refused while the wave stands still says: whose console stands empty. */
function holdText(state: FirewallState): string {
  if (state.vacant.includes('b')) {
    return 'Am Analysepult steht niemand.';
  }
  return state.vacant.includes('a') ? 'Am Sperrpult steht niemand.' : 'Die Welle steht still.';
}

/**
 * A trip of the gate on `line` at `at`: the lowest packet there is dropped — a hostile one
 * counted, the wave clean where it was the last and the others are through; one the policy lets
 * through a fault. A trip that hits nothing is reported and costs nothing.
 */
function tripped(def: FirewallDef, state: FirewallState, line: number, at: number) {
  if (state.heldAt !== null) {
    fail(holdText(state));
  }
  const t = waveMs(state, at);
  const packet = lowestOn(def, state, line, t);
  if (packet === undefined) {
    return going(reported(state, 'void', at, line));
  }
  if (!packet.hostile) {
    return faulted(def, state, at, WRONG_DROP);
  }
  const dropped = reported({ ...state, dropped: [...state.dropped, packet.id] }, 'drop', at, line);
  const done = nextHostile(def, dropped) === undefined && lastThrough(def, dropped) <= t;
  return done ? clean(def, dropped, at) : going(dropped);
}

/** A mark on packet `id` set or taken back at `at`: only on a packet that is on its line. */
function marked(def: FirewallDef, state: FirewallState, id: string, at: number) {
  const packet = state.packets.slice(0, state.entered).find((p) => p.id === id);
  if (packet === undefined || !falling(def, state, packet, waveMs(state, at))) {
    fail('Dieses Paket ist nicht in der Leitung.');
  }
  const marks = state.marks.includes(id)
    ? state.marks.filter((mark) => mark !== id)
    : [...state.marks, id];
  return going({ ...state, marks });
}

// --- the views -----------------------------------------------------------------------------

/** The viewer's console: the gate at a, the analysis at b; none away from them. */
function consoleRole(viewer: Viewer): FirewallView['role'] {
  if (!viewer.operating || viewer.console === null) {
    return null;
  }
  return viewer.console === 'a' ? 'gate' : 'analysis';
}

/** The packets come on so far as a console shows them, headers only where `headers`. */
function blipsOf(state: FirewallState, headers: boolean): FirewallBlip[] {
  return state.packets.slice(0, state.entered).map((p) => ({
    id: p.id,
    line: p.line,
    enterMs: p.enterMs,
    marked: state.marks.includes(p.id),
    dropped: state.dropped.includes(p.id),
    header: headers ? { ...p.header } : null,
  }));
}

// --- the printed document ------------------------------------------------------------------

const PLATE: TypePlate = { name: 'Paketfilter', type: 'PF-5', year: 2009 };

/** The drawing of the five lines, a ringed packet and the gate; the client draws it so. */
export const LINES_FIGURE = 'firewall-lines';

const PURPOSE =
  'Der Paketfilter steht zwischen dem Außennetz und dem Kern des Rechnernetzes; seit dem ' +
  'Vorfall von 2019 prüft ihn jede Schicht von Hand.';

const BUILD =
  'Pult A, das Sperrpult, zeigt fünf Leitungen, auf denen Pakete als Punkte zum Kern laufen, ' +
  'und eine Sperre, die das unterste Paket einer Leitung herausnimmt. Pult B, das ' +
  'Analysepult, zeigt dieselben Pakete mit Quelle, Port und Protokoll und markiert sie; eine ' +
  'Markierung trägt am Sperrpult einen Ring. Was zu sperren ist, sagt allein die ' +
  'Sicherheitsrichtlinie: Die erste Regel, die passt, entscheidet.';

/** Betrieb: the waves, a packet's fall, the faults and their cost, the end. */
function operationText(def: FirewallDef): string {
  const waves = spelled(def.waves);
  return (
    `Die Pakete kommen in Wellen zu ${spelled(def.packets)}, jedes ${def.fallSec} Sekunden ` +
    'unterwegs. Sauber ist eine Welle, wenn jedes zu sperrende Paket draußen ist und jedes ' +
    'andere im Kern. Ein gesperrtes Paket, das passieren durfte, und ein ' +
    'zu sperrendes im Kern sind Fehlquittierungen: Die Überwachung meldet Alarm und zieht ' +
    `${costOf(def.penaltySec)} ab, und eine neue Welle beginnt. Nach ` +
    `${def.waves === 1 ? 'einer sauberen Welle' : `${waves} sauberen Wellen`} ist der Kern frei.`
  );
}

const NETWORKS: ManualBlock = {
  kind: 'table',
  head: ['Netz', 'Quelle'],
  rows: [
    ['Labornetz', '10.4.x.x'],
    ['Wartungsnetz', '10.9.x.x'],
    ['Fremdnetz', 'jede andere Adresse'],
  ],
};

const POLICY_RULES: ManualBlock = {
  kind: 'rules',
  items: [...FIREWALL_POLICY.map((rule) => rule.text), BASE_TEXT],
};

/** The printed log: one wave of a past shift, rule by rule, a mark taken back by the order. */
const LOG: readonly string[] = [
  '02:40 Welle 1: sieben Pakete auf fünf Leitungen.',
  '02:40 85.12.4.9, Port 3389, TCP: Regel 2, markiert und gesperrt.',
  '02:41 10.9.1.4, Port 23, TCP: Regel 1 vor Regel 2, Markierung zurückgenommen.',
  '02:41 10.4.2.17, Port 23, TCP: Regel 2 vor Regel 3, markiert und gesperrt.',
  '02:42 Welle 1 sauber, fünf Pakete im Kern.',
];

const WORKSHOP: readonly string[] = [
  'Ist eines der beiden Pulte unbesetzt, hält die Anlage die Welle an.',
  'Regel 4 liest die Laborkennung vom Kennungsschild.',
];

// --- the solver ----------------------------------------------------------------------------

/** How a crew tells a hostile packet: by the policy, or by a guess of its own. */
export type FirewallJudge = (header: FirewallHeader, edgework: Edgework) => boolean;

/** The two consoles' views, or a throw where one is missing. */
function consolesSeen(def: FirewallDef, { operator, partner }: Perspectives<FirewallView>) {
  const gate = operator.packets;
  const analysis = partner?.packets ?? null;
  if (operator.clock === null || gate === null || analysis === null) {
    throw new Error(
      `firewall "${def.id}": solving needs the Sperrpult's view at console a and the ` +
        "Analysepult's at console b",
    );
  }
  return { clock: operator.clock, gate, analysis };
}

/**
 * The crew's moves at `at` judging by `judge`: console b marks every packet on its line that it
 * judges hostile and has not marked, and takes back a mark it judges wrong; console a trips
 * every line whose lowest packet wears a ring. Nothing while the wave stands still.
 */
export function firewallMoves(
  def: FirewallDef,
  views: Perspectives<FirewallView>,
  edgework: Edgework,
  at: number,
  judge: FirewallJudge,
): Move<FirewallInput>[] {
  const { clock, gate, analysis } = consolesSeen(def, views);
  if (clock.heldAt !== null) {
    return [];
  }
  const t = at - clock.startedAt;
  const fallMs = fallMsOf(def);
  const live = (p: FirewallBlip): boolean =>
    !p.dropped && p.enterMs <= t && t < p.enterMs + fallMs;
  const marks = analysis
    .filter((p) => live(p) && p.header !== null && judge(p.header, edgework) !== p.marked)
    .map((p): Move<FirewallInput> => ({ by: 'partner', input: { mark: p.id } }));
  const trips = Array.from({ length: FIREWALL_LINES }, (_, line) => line)
    .filter((line) => gate.find((p) => p.line === line && live(p))?.marked === true)
    .map((line): Move<FirewallInput> => ({ by: 'operator', input: { trip: line } }));
  return [...marks, ...trips];
}

export const firewallModule: PuzzleModule<FirewallDef, FirewallState, FirewallInput, FirewallView> =
  {
    type: 'firewall',
    usesEdgework: true,
    wholeCrew: false,
    consoles: 2,
    fields: [
      {
        key: 'waves',
        label: 'Wellen',
        help: 'So viele saubere Wellen braucht der Kern, bis die Station gelöst ist.',
        kind: 'int',
        min: 1,
        max: 4,
        default: 3,
      },
      {
        key: 'packets',
        label: 'Pakete je Welle',
        help: 'So viele Pakete laufen in einer Welle; zwei oder drei davon sind zu sperren.',
        kind: 'int',
        min: 5,
        max: 9,
        default: 7,
      },
      {
        key: 'fallSec',
        label: 'Laufzeit in Sekunden',
        help: 'So lange braucht ein Paket von oben bis in den Kern.',
        kind: 'int',
        min: 8,
        max: 20,
        default: 14,
      },
      {
        key: 'rules',
        label: 'Regeln im Spiel',
        help:
          'So viele der sechs Regeln entscheiden über die Pakete: erst 1, 2, 3 und 6, dann 5, ' +
          'zuletzt 4, die die Laborkennung liest.',
        kind: 'int',
        min: 3,
        max: 6,
        default: 4,
      },
    ],
    defSchema,
    inputSchema,

    /**
     * The rules the instance exercises, the Laborkennung's digit and the first wave, held at its
     * time 0 until both consoles are manned.
     */
    init(def, rng, ctx) {
      const exercised = exercisedRules(def);
      const blank: FirewallState = {
        type: 'firewall',
        seed: Math.floor(rng() * 2 ** 32),
        digit: serialLastDigit(ctx.edgework),
        exercised,
        dealt: 0,
        cleared: 0,
        packets: [],
        entered: 0,
        marks: [],
        dropped: [],
        startedAt: ctx.at,
        heldAt: ctx.at,
        vacant: ['a', 'b'],
        event: null,
      };
      return nextWave(def, blank, ctx.at);
    },

    apply(def, state, input, _playerId, ctx) {
      if ('trip' in input) {
        if (ctx.console !== 'a') {
          fail('Sperren kann nur das Sperrpult.');
        }
        return tripped(def, state, input.trip, ctx.at);
      }
      if (ctx.console !== 'b') {
        fail('Markierungen setzt nur das Analysepult.');
      }
      return marked(def, state, input.mark, ctx.at);
    },

    /**
     * While the wave runs: the next packet coming on, the next hostile packet reaching the Kern,
     * or once every hostile packet is dropped the wave's clean end.
     */
    dueAt(def, state) {
      if (state.heldAt !== null) {
        return null;
      }
      const next = state.packets[state.entered];
      const hostile = nextHostile(def, state);
      const due = [
        ...(next === undefined ? [] : [next.enterMs]),
        hostile === undefined ? lastThrough(def, state) : arrivalMs(def, hostile),
      ];
      return state.startedAt + Math.min(...due);
    },

    /**
     * The running wave up to the moment (`ranTo`), then held or going on as the consoles are
     * manned; a held wave only goes on. Never back in time: a moment before the hold or the
     * device's last report counts as that one's.
     */
    elapse(def, state, ctx) {
      const at = Math.max(ctx.at, state.heldAt ?? ctx.at, state.event?.at ?? ctx.at);
      const ran = state.heldAt === null ? ranTo(def, state, at) : going(state);
      if (ran.solved) {
        return ran;
      }
      return { ...ran, state: staffed(ran.state, vacantOf(ctx.atConsoles), at) };
    },

    view(def, state, viewer) {
      const audience = viewer.playerId === null;
      const role = consoleRole(viewer);
      const seen = role !== null || audience;
      return {
        kind: 'firewall',
        role,
        wave: Math.min(state.cleared + 1, def.waves),
        waves: def.waves,
        cleared: state.cleared,
        fallMs: fallMsOf(def),
        clock: seen ? { startedAt: state.startedAt, heldAt: state.heldAt } : null,
        vacant: seen ? [...state.vacant] : [],
        packets: seen ? blipsOf(state, role === 'analysis' || audience) : null,
        event: seen && state.event !== null ? { ...state.event } : null,
      };
    },

    /** Console a is the Sperrpult, console b the Analysepult. */
    plate(_def, console) {
      return console === 'b'
        ? 'Das Analysepult zeigt die Kopfdaten der Pakete'
        : 'Das Sperrpult nimmt Pakete vor dem Kern aus der Leitung';
    },

    manual(def) {
      return labDocument({
        plate: PLATE,
        purpose: PURPOSE,
        figure: { of: 'firewall', device: 'Sperrpult und Analysepult' },
        build: BUILD,
        operation: operationText(def),
        law: [
          {
            heading: 'Sicherheitsrichtlinie',
            blocks: [
              { kind: 'figure', of: LINES_FIGURE, caption: 'Abb. 2 — Leitungen, Ring und Sperre' },
              NETWORKS,
              POLICY_RULES,
            ],
          },
        ],
        log: LOG,
        workshop: WORKSHOP,
      });
    },

    /**
     * Console b's headers judged by the Sicherheitsrichtlinie with the Laborkennung read: every
     * hostile packet on its line marked, and console a tripping every line whose lowest packet
     * wears a ring, at the moment the crew looks (`aid.at`).
     */
    solve(def, views, edgework, aid) {
      if (edgework === null || aid?.at === undefined) {
        throw new Error(
          `firewall "${def.id}": solving needs the Laborkennung read and the moment the crew looks`,
        );
      }
      return firewallMoves(def, views, edgework, aid.at, hostileByPolicy);
    },
  };
