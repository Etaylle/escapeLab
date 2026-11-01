import {
  generateEdgework,
  moduleFor,
  puzzleDefSchema,
  type ConsoleId,
  type MapView,
  type PuzzleView,
} from '@escapelab/core';
import type { DeviceRun } from '../src/puzzles/Device.js';

/** The run around an open device before anything happened: no alarm, nothing solved, no crew. */
export function deviceRun(parts: Partial<DeviceRun> = {}): DeviceRun {
  return {
    alarms: 0,
    solved: 0,
    refusal: null,
    crew: { you: 'p1', mates: [] },
    alarm: null,
    ...parts,
  };
}

/** An empty 20×13 lab; every test adds what it needs. */
export function mapWith(parts: Partial<MapView>): MapView {
  return {
    width: 20,
    height: 13,
    tiles: [],
    yourSpawn: { x: 1, y: 1 },
    doors: [],
    plates: [],
    stations: [],
    manuals: [],
    notes: [],
    edgeworkSign: null,
    chimes: [],
    lamps: [],
    labels: [],
    decor: [],
    litRooms: [],
    exit: null,
    items: [],
    sabotage: null,
    ...parts,
  };
}

/** A mission's clock that is not running: no deadline, no pause (clock.ts `MissionTime`). */
export const NO_CLOCK = { deadlineAt: null, pausedAt: null } as const;

export type Manual = MapView['manuals'][number];
export type Plate = MapView['plates'][number];
export type Item = MapView['items'][number];

/**
 * Markup with every icon (screens/Icon.tsx) written as its name in brackets,
 * „[check]", so that what a screen says reads in one line.
 */
export function iconsAsWords(html: string): string {
  return html.replace(/<svg class="icon icon-([a-z-]+)"[^>]*>.*?<\/svg>/g, '[$1]');
}

/** A pictograph the platform draws in its own style: an emoji, or a symbol used as one. */
export const PICTOGRAPH = /[\p{Extended_Pictographic}✓✗⧉⬢⏻]/u;

/** A small deterministic generator, enough to set an instance up. */
export function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

/** Who looks at a station: whether they operate it, at which console, who they are. */
export interface Onlooker {
  operating?: boolean;
  seat?: ConsoleId | null;
  /** the player; null for the audience */
  who?: string | null;
}

/**
 * The open puzzle `def` sets up (its type, id, title and fields, as a mission writes them) as
 * `who` sees it, operating it at console `seat` — or away from it, or as the audience — with
 * nobody backing them up, in a crew of p1 and p2.
 */
export function stationView(def: Record<string, unknown>, onlooker: Onlooker = {}): PuzzleView {
  const { operating = true, who = 'p1' } = onlooker;
  const seat = onlooker.seat === undefined ? (operating ? 'a' : null) : onlooker.seat;
  const parsed = puzzleDefSchema.parse(def);
  const station = moduleFor(parsed.type);
  const rng = lcg(7);
  const edgework = generateEdgework(rng);
  const crew = ['p1', 'p2'];
  const setup = {
    edgework,
    alarms: 0,
    remainingSec: 600,
    at: 0,
    crew,
    console: null,
    atConsoles: { a: [], b: [] },
    readers: [],
  };
  const state = station.init(parsed, rng, setup);
  const viewer = { playerId: who, operating, reading: false, console: seat };
  const operators = operating && who !== null ? [who] : [];
  const view = station.view(parsed, state, viewer, { edgework, alarms: 0, crew, operators });
  const common = { index: 0, total: 1, title: parsed.title, manual: null, console: seat };
  return { ...view, ...common, backup: null } as PuzzleView;
}
