import {
  FIREWALL_LINES,
  FIREWALL_PAUSE_MS,
  type FirewallBlip,
  type PuzzleView,
} from '@escapelab/core';

/**
 * firewallView.ts: what the Paketfilter's view says at a moment of the server's clock — which
 * packets are on their lines, how far down each has come, the lowest on a line, when the next
 * of them reaches the Kern, and the device's status line — for its two consoles
 * (FirewallPanel.tsx). Pure: every moment comes in as an argument.
 */

export type FirewallPuzzle = Extract<PuzzleView, { kind: 'firewall' }>;
type Clock = NonNullable<FirewallPuzzle['clock']>;

/** The lines, from the left. */
export const LINES: readonly number[] = Array.from({ length: FIREWALL_LINES }, (_, i) => i);

/** How long a dropped packet's burst shows where it was taken out, ms. */
export const BURST_MS = 600;

/** The wave's time at `now` (server epoch ms), ms: standing still while the wave is held. */
export const waveMsAt = (clock: Clock, now: number): number =>
  (clock.heldAt ?? now) - clock.startedAt;

/** Whether `blip` is on its line at wave time `t`: come on, not dropped, not in the Kern yet. */
const falling = (blip: FirewallBlip, t: number, fallMs: number): boolean =>
  !blip.dropped && blip.enterMs <= t && t < blip.enterMs + fallMs;

/** The packets on their lines at `now`, in the order they came on; none without a clock. */
export function onTheLines(puzzle: FirewallPuzzle, now: number): FirewallBlip[] {
  const { clock, packets } = puzzle;
  if (clock === null || packets === null) {
    return [];
  }
  const t = waveMsAt(clock, now);
  return packets.filter((blip) => falling(blip, t, puzzle.fallMs));
}

/** The lowest packet on `line` among `live`: the one longest on it; null for none. */
export function lowestOn(live: readonly FirewallBlip[], line: number): FirewallBlip | null {
  return live.find((blip) => blip.line === line) ?? null;
}

/** How far down its line `blip` has come at wave time `t`: 0 at the top, 1 at the Kern. */
export function progressOf(blip: FirewallBlip, t: number, fallMs: number): number {
  return Math.min(1, Math.max(0, (t - blip.enterMs) / fallMs));
}

/**
 * The next moment (server epoch ms) after `now` at which the device shows something else of its
 * own accord: a packet reaching the Kern, a burst gone, the next whole second of the breath
 * before a wave's first packet. Null while the wave stands still and nothing is due.
 */
export function nextChange(puzzle: FirewallPuzzle, now: number): number | null {
  const { clock, packets, event } = puzzle;
  if (clock === null || packets === null || clock.heldAt !== null) {
    return null;
  }
  const arrivals = onTheLines(puzzle, now).map((b) => clock.startedAt + b.enterMs + puzzle.fallMs);
  const burst = event?.kind === 'drop' ? [event.at + BURST_MS] : [];
  const breath = packets.length === 0 ? [now + 1000 - (waveMsAt(clock, now) % 1000)] : [];
  const due = [...arrivals, ...burst, ...breath].filter((at) => at > now);
  return due.length === 0 ? null : Math.min(...due);
}

/** A console as the status line names it. */
const PULT_NAMES = { a: 'Sperrpult', b: 'Analysepult' } as const;

/** Whole seconds until a wave's first packet comes on, at wave time `t`: 0 once it has. */
const breathLeft = (t: number): number => Math.max(0, Math.ceil((FIREWALL_PAUSE_MS - t) / 1000));

/** What the breath before a wave's first packet says, after the event that began it. */
function breathText(puzzle: FirewallPuzzle, seconds: number): string {
  const kind = puzzle.event?.kind ?? null;
  if (kind === 'fault') {
    return `Fehlquittierung: Welle abgebrochen. Neue Welle in ${seconds} s.`;
  }
  if (kind === 'cleared') {
    return `Welle ${puzzle.cleared} sauber. Welle ${puzzle.wave} in ${seconds} s.`;
  }
  return `Welle ${puzzle.wave} von ${puzzle.waves} in ${seconds} s.`;
}

/**
 * The device's status line at `now`, in the lab's words: the Kern free once every wave is clean;
 * the hold and whose console stands empty; the breath before a wave and what began it; else the
 * wave under way and the packets taken out of it.
 */
export function statusOf(puzzle: FirewallPuzzle, now: number): string {
  if (puzzle.event?.kind === 'done') {
    return 'Kern frei: alle Wellen sauber.';
  }
  const [vacant] = puzzle.vacant;
  if (vacant !== undefined) {
    return `Halt: Am ${PULT_NAMES[vacant]} steht niemand.`;
  }
  const t = puzzle.clock === null ? 0 : waveMsAt(puzzle.clock, now);
  const packets = puzzle.packets ?? [];
  if (packets.length === 0) {
    return breathText(puzzle, breathLeft(t));
  }
  const dropped = packets.filter((blip) => blip.dropped).length;
  return `Welle ${puzzle.wave} von ${puzzle.waves} · ${dropped} gesperrt`;
}

/**
 * The packet a cursor at `id` moves on to, `step` places along `live` ordered by line and then
 * from the bottom up; the first where `id` is on none of them.
 */
export function cursorStep(live: readonly FirewallBlip[], id: string | null, step: number) {
  const order = [...live].sort((p, q) => p.line - q.line || p.enterMs - q.enterMs);
  const at = order.findIndex((blip) => blip.id === id);
  if (order.length === 0) {
    return null;
  }
  const from = at === -1 ? 0 : at + step;
  return order[(from + order.length) % order.length]?.id ?? null;
}
