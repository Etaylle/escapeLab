import type { MapDef } from './mission.js';
import type { PuzzleDef } from './puzzles/index.js';
import type { ConsoleId } from './puzzles/module.js';
import {
  pulseTimes,
  typingConsole,
  type StartupDef,
  type StartupState,
} from './puzzles/startup.js';
import type { GameState } from './state.js';

/**
 * The cable ducts in the floor (`map.conduits`): each runs from one console of an
 * Anlaufsteuerung to the other, tile by orthogonally adjacent tile, under floor, walls and
 * doors alike, and carries its start pulse — the world sees the pulse's light travel along it
 * (client world/conduits.ts, sources.ts), where a figure has sight of the tiles. Every station of
 * the module needs its duct: the light running in it is the typing side's word that the pulse
 * is off and the other side's that it comes.
 */

/** A duct as the map file has it: its station's puzzle, and its tiles from one end to the other. */
export type ConduitDef = MapDef['conduits'][number];

/** A pulse in a duct as every view carries it: the times it keeps, and its direction. */
export interface ConduitPulse {
  /** epoch ms on the server's clock: sent, at the far end and on the ladder, dead there */
  sentAt: number;
  arrivesAt: number;
  diesAt: number;
  /** it runs from the duct's last tile to its first, not from its first to its last */
  reversed: boolean;
}

/** A duct as the map view carries it: its puzzle, its tiles, and the pulse in it now. */
export interface ConduitView {
  puzzleId: string;
  tiles: { x: number; y: number }[];
  pulse: ConduitPulse | null;
}

/** An issue with a duct: where in the mission file, and what is wrong, for whoever wrote it. */
export interface ConduitIssue {
  path: (string | number)[];
  message: string;
}

type Tile = readonly [number, number];

/** Whether two tiles share a side. */
const adjacent = ([ax, ay]: Tile, [bx, by]: Tile): boolean =>
  Math.abs(ax - bx) + Math.abs(ay - by) === 1;

/** A console's spot on the map. */
type Spot = { x: number; y: number };

/** Whether a tile lies on a console's tile or one of the eight round it. */
const beside = ([x, y]: Tile, spot: Spot): boolean =>
  Math.max(Math.abs(x - spot.x), Math.abs(y - spot.y)) <= 1;

/** The spot of console `side` of the station of `puzzleId`; null where it has none. */
function consoleSpot(map: MapDef, puzzleId: string, side: ConsoleId) {
  return map.stations.find((s) => s.puzzleId === puzzleId && s.console === side) ?? null;
}

/** What is wrong with the duct's way: a tile off the map or over the void, a gap, a tile twice. */
function wayIssue(map: MapDef, tiles: readonly Tile[]): string | null {
  const off = tiles.find(([x, y]) => [' ', ''].includes(map.tiles[y]?.charAt(x) ?? ''));
  if (off !== undefined) {
    return (
      `the tile ${off[0]},${off[1]} lies off the map or over the void — a duct runs under ` +
      'floor, walls and doors'
    );
  }
  const gap = tiles.findIndex((tile, i) => i > 0 && !adjacent(tiles[i - 1] ?? tile, tile));
  if (gap > 0) {
    return (
      `the tiles ${tiles[gap - 1]?.join(',')} and ${tiles[gap]?.join(',')} share no side — ` +
      'every tile follows the last one up, down, left or right'
    );
  }
  const keys = tiles.map(([x, y]) => `${x},${y}`);
  const twice = new Set(keys).size !== keys.length;
  return twice ? 'a tile comes twice — a duct never crosses itself' : null;
}

/** What is wrong with where the duct ends: each end beside another console of its station. */
function endsIssue(map: MapDef, duct: ConduitDef): string | null {
  const a = consoleSpot(map, duct.puzzleId, 'a');
  const b = consoleSpot(map, duct.puzzleId, 'b');
  const first = duct.tiles[0];
  const last = duct.tiles.at(-1);
  if (a === null || b === null || first === undefined || last === undefined) {
    return `station "${duct.puzzleId}" needs console a and console b for its duct to join`;
  }
  return joins([first, last], a, b)
    ? null
    : `the duct ends at ${first.join(',')} and ${last.join(',')} — put one end beside ` +
        `console a (${a.x},${a.y}) and the other beside console b (${b.x},${b.y}): lay its ` +
        'tiles anew in the mission file, or move the consoles back beside its ends';
}

/** Whether the ends `[first, last]` lie one beside console `a`, the other beside `b`. */
function joins([first, last]: readonly [Tile, Tile], a: Spot, b: Spot): boolean {
  return (beside(first, a) && beside(last, b)) || (beside(first, b) && beside(last, a));
}

/** What is wrong with one duct of the map; null where nothing is. */
function ductIssue(
  map: MapDef,
  puzzles: readonly PuzzleDef[],
  duct: ConduitDef,
): ConduitIssue | null {
  const puzzle = puzzles.find((p) => p.id === duct.puzzleId);
  if (puzzle?.type !== 'startup') {
    const what = puzzle === undefined ? 'no puzzle of the mission' : `a ${puzzle.type}`;
    return {
      path: ['puzzleId'],
      message:
        `"${duct.puzzleId}" is ${what} — a duct joins the consoles of an Anlaufsteuerung ` +
        '(startup)',
    };
  }
  const message = wayIssue(map, duct.tiles) ?? endsIssue(map, duct);
  return message === null ? null : { path: ['tiles'], message };
}

/**
 * Every issue with the map's ducts, each at its entry of the mission file: a duct's puzzle has to
 * be an Anlaufsteuerung of the mission, with a duct of its own, and its tiles a way of orthogonal
 * steps, each tile once, from beside one console to beside the other.
 */
export function conduitIssues(map: MapDef, puzzles: readonly PuzzleDef[]): ConduitIssue[] {
  return [...ductIssues(map, puzzles), ...missingDucts(map, puzzles)];
}

/**
 * Every Anlaufsteuerung of the mission with its stations on the map but no duct: one issue
 * each, saying where to lay one — the editor has no tool for it, the mission file has.
 */
function missingDucts(map: MapDef, puzzles: readonly PuzzleDef[]): ConduitIssue[] {
  const ducted = new Set(map.conduits.map((duct) => duct.puzzleId));
  const placed = (id: string): boolean => map.stations.some((s) => s.puzzleId === id);
  return puzzles
    .filter((p) => p.type === 'startup' && placed(p.id) && !ducted.has(p.id))
    .map((p) => ({
      path: ['map', 'conduits'],
      message:
        `map: station "${p.id}" (startup) has no cable duct — add one to map.conduits, its ` +
        'tiles from beside console a to beside console b; the editor has no tool for it, the ' +
        'mission file takes it',
    }));
}

/** Every issue with the ducts the map lists. */
function ductIssues(map: MapDef, puzzles: readonly PuzzleDef[]): ConduitIssue[] {
  return map.conduits.flatMap((duct, i): ConduitIssue[] => {
    const at = (issue: ConduitIssue): ConduitIssue => ({
      path: ['map', 'conduits', i, ...issue.path],
      message: `map: conduit ${i}: ${issue.message}`,
    });
    const twice = map.conduits.findIndex((other) => other.puzzleId === duct.puzzleId) !== i;
    if (twice) {
      return [at({ path: ['puzzleId'], message: `station "${duct.puzzleId}" has a duct already` })];
    }
    const issue = ductIssue(map, puzzles, duct);
    return issue === null ? [] : [at(issue)];
  });
}

/** Whether the pulse of (0-based) `stage` runs from the duct's last tile to its first. */
function runsBack(map: MapDef, duct: ConduitDef, stage: number): boolean {
  const from = consoleSpot(map, duct.puzzleId, typingConsole(stage));
  const first = duct.tiles[0];
  return from === null || first === undefined ? false : !beside(first, from);
}

/** The pulse in `duct` now: where its station is open with a pulse on the way; null otherwise. */
function pulseIn(state: GameState, duct: ConduitDef): ConduitPulse | null {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  const open = state.puzzleState;
  if (def?.id !== duct.puzzleId || def.type !== 'startup' || open?.type !== 'startup') {
    return null;
  }
  const { pulse, stage } = open satisfies StartupState;
  if (pulse === null) {
    return null;
  }
  const times = pulseTimes(def satisfies StartupDef, pulse);
  return { sentAt: pulse.sentAt, ...times, reversed: runsBack(state.mission.map, duct, stage) };
}

/**
 * The map's ducts as every view carries them: their tiles, and the pulse in each now. The
 * pulse's times reach every player, as the doors' state does: the light is the world's, and the
 * typing side, which started the pulse, could count the seconds anyway; nothing of the instance
 * is in them.
 */
export function conduitsOnMap(state: GameState): ConduitView[] {
  const { map } = state.mission;
  return map.conduits.map((duct) => ({
    puzzleId: duct.puzzleId,
    tiles: duct.tiles.map(([x, y]) => ({ x, y })),
    pulse: pulseIn(state, duct),
  }));
}
