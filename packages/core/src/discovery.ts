import type { MapDef } from './mission.js';
import { noteSpot } from './notes.js';
import type { ConsoleId } from './puzzles/module.js';
import { canSee, type SightMap } from './sight.js';
import type { GameState } from './state.js';

/**
 * Finding things is an act, not a side effect of entering a room. A player
 * finds a source, a note of the last shift, a part, a console or the sign
 * when it lies within FIND_REACH of them with nothing in between, or when
 * it has stood in their lamp's cone — LAMP_HALF_ANGLE either side of where
 * they face, out to LAMP_REACH, nothing in between — for LOOK_MS; a part
 * within ITEM_REACH is found whatever stands between. A room the power
 * lights shows its things, but finds nothing for anybody: the same two
 * rules hold there. What a player has found stays theirs for the run; the
 * crew shares it only as the game already shares things — the minimap, the
 * arrows, a key's lock once somebody has come across it. Pure: the server
 * says where everybody stands and when, this says what they found.
 */

/** How near a thing has to lie to be found outright, tiles, with nothing in between. */
export const FIND_REACH = 2;
/** A part this near is found whatever stands between, tiles: it lies at the player's feet. */
export const ITEM_REACH = 0.9;
/** Half the width of the lamp's cone either side of where its player faces, radians. */
export const LAMP_HALF_ANGLE = 0.5;
/** How far the lamp's cone reaches, tiles: as far as its beam shows on the screens. */
export const LAMP_REACH = 7.5;
/** How long a thing has to stand in the lamp's cone to be found, ms. */
export const LOOK_MS = 250;

/** One thing to find, as the views name it. */
export type Find =
  | { of: 'source'; id: string }
  | { of: 'note'; index: number }
  | { of: 'item'; id: string }
  | { of: 'console'; puzzleId: string; console: ConsoleId | null }
  | { of: 'sign' };

/** What the state keeps a find by: `source:<id>`, `note:<index>`, `item:<id>`, … */
export type FindKey = string;

type StationSpot = MapDef['stations'][number];

/** A station's spot as a find: the console of its puzzle there. */
export function consoleFind(spot: Pick<StationSpot, 'puzzleId' | 'console'>): Find {
  return { of: 'console', puzzleId: spot.puzzleId, console: spot.console ?? null };
}

/** The key the state keeps `find` by. */
export function findKey(find: Find): FindKey {
  switch (find.of) {
    case 'source':
    case 'item':
      return `${find.of}:${find.id}`;
    case 'note':
      return `note:${find.index}`;
    case 'console':
      return `console:${find.puzzleId}/${find.console ?? '-'}`;
    case 'sign':
      return 'sign';
  }
}

/** A thing of this run to find: what it is, and the point in tiles it is looked for at. */
export interface Findable {
  find: Find;
  key: FindKey;
  x: number;
  y: number;
}

function findable(find: Find, x: number, y: number): Findable {
  return { find, key: findKey(find), x, y };
}

/** How far over the floor a note pinned to a wall is looked for, past the wall's face, tiles. */
const FACE_INSET = 0.05;

/**
 * Where a note of the last shift is looked for: on the floor, its tile's
 * middle; pinned to a wall, just over the floor before the face it hangs on
 * — a point on the face itself would count as the wall's, and be seen from
 * behind it.
 */
function notePoint(map: MapDef, note: { x: number; y: number }): { x: number; y: number } | null {
  const spot = noteSpot(map, note);
  if (spot === null) {
    return null;
  }
  const out = 0.5 + FACE_INSET;
  return { x: note.x + 0.5 + (spot.x - note.x) * out, y: note.y + 0.5 + (spot.y - note.y) * out };
}

/**
 * Everything this run has to find, in map order: the sources where the run
 * placed them, the notes, the parts lying loose — a part in somebody's
 * hands or in its place is found by nobody —, every console and the sign.
 */
export function findables(state: GameState): Findable[] {
  const { map } = state.mission;
  const sources = map.manuals.flatMap((m) => {
    const at = state.places[m.id];
    return at === undefined ? [] : [findable({ of: 'source', id: m.id }, at.x + 0.5, at.y + 0.5)];
  });
  const notes = map.notes.flatMap((note, index) => {
    const at = notePoint(map, note);
    return at === null ? [] : [findable({ of: 'note', index }, at.x, at.y)];
  });
  const items = map.items.flatMap((def) => {
    const live = state.items[def.id];
    const loose = live !== undefined && live.carriedBy === null && !live.delivered;
    return loose ? [findable({ of: 'item', id: def.id }, live.x, live.y)] : [];
  });
  const consoles = map.stations.map((s) => findable(consoleFind(s), s.x + 0.5, s.y + 0.5));
  const sign = map.edgeworkSign;
  const signs = sign === undefined ? [] : [findable({ of: 'sign' }, sign.x + 0.5, sign.y + 0.5)];
  return [...sources, ...notes, ...items, ...consoles, ...signs];
}

/** Where a player stands and which way they face, in tiles and radians (0 east, π/2 south). */
export interface Looker {
  x: number;
  y: number;
  facing: number;
}

/** Whether `thing` lies within the reach that finds it outright. */
function inReach(
  map: SightMap,
  shut: ReadonlySet<string>,
  looker: Looker,
  thing: Findable,
): boolean {
  const away = Math.hypot(thing.x - looker.x, thing.y - looker.y);
  if (thing.find.of === 'item' && away <= ITEM_REACH) {
    return true;
  }
  return away <= FIND_REACH && canSee(map, looker, thing, shut);
}

/** Whether `thing` lies in the looker's lamp cone, within its reach, with nothing in between. */
export function inCone(
  map: SightMap,
  shut: ReadonlySet<string>,
  looker: Looker,
  thing: { x: number; y: number },
): boolean {
  const dx = thing.x - looker.x;
  const dy = thing.y - looker.y;
  if (Math.hypot(dx, dy) > LAMP_REACH) {
    return false;
  }
  const turn = Math.atan2(dy, dx) - looker.facing;
  const off = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
  return off <= LAMP_HALF_ANGLE && canSee(map, looker, thing, shut);
}

/** Since when each thing has stood in a player's lamp cone, epoch ms, by key. */
export type Glances = Readonly<Record<FindKey, number>>;

/** What one look round finds, the glances still running, and when the next of them is due. */
export interface Look {
  found: FindKey[];
  glances: Record<FindKey, number>;
  /** epoch ms the next running glance lasts LOOK_MS; null with none running */
  dueAt: number | null;
}

/**
 * What `looker` finds at `now` (epoch ms) of `things`: whatever lies in
 * reach, and whatever has stood in the lamp's cone for LOOK_MS — `glances`
 * says since when each thing has; a thing gone out of the cone starts again.
 * The doors in `shut` stop sight like walls.
 */
export function lookAround(
  map: SightMap,
  shut: ReadonlySet<string>,
  looker: Looker,
  things: readonly Findable[],
  glances: Glances,
  now: number,
): Look {
  const found: FindKey[] = [];
  const running: Record<FindKey, number> = {};
  let dueAt: number | null = null;
  for (const thing of things) {
    if (inReach(map, shut, looker, thing)) {
      found.push(thing.key);
    } else if (inCone(map, shut, looker, thing)) {
      const since = glances[thing.key] ?? now;
      if (now - since >= LOOK_MS) {
        found.push(thing.key);
      } else {
        running[thing.key] = since;
        dueAt = Math.min(dueAt ?? Infinity, since + LOOK_MS);
      }
    }
  }
  return { found, glances: running, dueAt };
}

/** Whether somebody of the crew has found the thing kept as `key`: what the game shares of it. */
export function crewFound(state: GameState, key: FindKey): boolean {
  return Object.values(state.found).some((keys) => keys.includes(key));
}
