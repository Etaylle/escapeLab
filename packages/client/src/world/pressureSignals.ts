import type { DronePosition, PlayerView, PuzzleView } from '@escapelab/core';

/**
 * What of the run, besides its clock, the music's pressure follows (music.ts `pressureOf`): read
 * from this player's own view and from where the drones fly, ten times a second with the rest of
 * the lab's sound (GameWorld.tsx `tensionOf`). Each player's own: whoever reads at a source while
 * the wave falls at the console hears the calmer music. Pure.
 */
export interface PressureSignals {
  /** an emergency runs (`MapView.sabotage`) */
  readonly emergency: boolean;
  /**
   * a station's own clock runs for this player, and how far it has run, 0 to 1 — 0 where the
   * view gives no time for it; null while none runs (`stationClockOf`)
   */
  readonly stationClock: number | null;
  /** how far the nearest drone awake flies from this player, tiles; Infinity for none */
  readonly droneTiles: number;
  /** how far through the run's stations the crew is, 0 to 1 */
  readonly progress: number;
}

/** A spot on the map, tiles. */
interface At {
  readonly x: number;
  readonly y: number;
}

/** How far `now` (epoch ms) has run from `from` to `to`, 0 to 1. */
function runOf(from: number, to: number, now: number): number {
  return to <= from ? 1 : Math.min(1, Math.max(0, (now - from) / (to - from)));
}

/** The open station's view of the kind `K`. */
type ViewOf<K extends PuzzleView['kind']> = Extract<PuzzleView, { kind: K }>;

/** A station's own clock as its view shows it at `now`: how far it has run, null while none runs. */
type ClockOf<K extends PuzzleView['kind']> = (puzzle: ViewOf<K>, now: number) => number | null;

/** The Paketfilter's wave falling at a console, not held, not waiting: no wave's end shown, 0. */
const firewallClock: ClockOf<'firewall'> = ({ clock, waiting }) =>
  clock !== null && clock.heldAt === null && !waiting ? 0 : null;

/** The Anlaufsteuerung's pulse on its way up the ladder, a step a second, where it is taken. */
const startupClock: ClockOf<'startup'> = ({ board, ladder }, now) => {
  const pulse = board?.pulse ?? null;
  return pulse === null ? null : runOf(pulse.sentAt, pulse.sentAt + ladder.steps * 1000, now);
};

/** This player's press of the Synchrontaster waiting in its window for the others' presses. */
const buttonSyncClock: ClockOf<'button-sync'> = ({ press }, now) => {
  const expiresAt = press?.expiresAt ?? null;
  return press === null || expiresAt === null || expiresAt <= now
    ? null
    : runOf(press.at, expiresAt, now);
};

/** The token's period running out at the Zugangskontrolle's device. */
const accessClock: ClockOf<'access'> = ({ device }, now) =>
  device === null ? null : runOf(device.endsAt - device.periodSec * 1000, device.endsAt, now);

const CLOCKS: { readonly [K in PuzzleView['kind']]?: ClockOf<K> } = {
  firewall: firewallClock,
  startup: startupClock,
  'button-sync': buttonSyncClock,
  access: accessClock,
};

/**
 * The clock of the open station as `puzzle` shows it to this player at `now` (server's clock,
 * epoch ms), and how far it has run (`PressureSignals.stationClock`): the Paketfilter's wave
 * falling (its view gives no wave's end: 0), the Anlaufsteuerung's pulse on its way to the
 * ladder at the console that takes it, a press of the Synchrontaster waiting for the others in
 * its window, the token's period at the Zugangskontrolle's device. Null at any other station,
 * away from its consoles, and while its clock stands.
 */
export function stationClockOf(puzzle: PuzzleView | null, now: number): number | null {
  if (puzzle === null) return null;
  const clock = CLOCKS[puzzle.kind] as ClockOf<PuzzleView['kind']> | undefined;
  return clock === undefined ? null : clock(puzzle as never, now);
}

/** How far the nearest of `drones` that is awake flies from `self`, tiles; Infinity for none. */
export function droneTilesOf(self: At, drones: Readonly<Record<string, DronePosition>>): number {
  let nearest = Infinity;
  for (const drone of Object.values(drones)) {
    if (!drone.frozen) nearest = Math.min(nearest, Math.hypot(drone.x - self.x, drone.y - self.y));
  }
  return nearest;
}

/** The signals of `view` for the player standing at `self` at `now` (server's clock, epoch ms). */
export function signalsOf(
  view: Pick<PlayerView, 'map' | 'puzzle' | 'currentPuzzleIndex' | 'puzzleCount'>,
  self: At,
  drones: Readonly<Record<string, DronePosition>>,
  now: number,
): PressureSignals {
  return {
    emergency: view.map?.sabotage != null,
    stationClock: stationClockOf(view.puzzle, now),
    droneTiles: droneTilesOf(self, drones),
    progress: view.puzzleCount > 0 ? Math.min(1, view.currentPuzzleIndex / view.puzzleCount) : 0,
  };
}
