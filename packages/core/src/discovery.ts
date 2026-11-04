import { lightsAreOut } from './map.js';
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
 * within ITEM_REACH is found whatever stands between. A console is found
 * only while its station is armed: one passed before is found once it is,
 * as the thing to work then. While the power lights the whole lab — the
 * opening, before the lights fail, and the way out once every station is
 * solved (`labLit`) — every player sees all of it, but the light finds
 * nothing for anybody: the same two rules hold there. In the dark a view
 * carries a thing nobody has found only while its player has it in sight
 * (`inSight`). What a player has found stays theirs for the run; the crew
 * shares it only as the game already shares things — the minimap, the
 * arrows, a key's lock once somebody has come across it.
 *
 * A find that matters is a discovery for whoever made it, once (`discover`):
 * a console of the armed station, a source printing its rules, a part, a
 * note, the sign. Its caption always shows; its chime sounds at most once
 * every CHIME_GAP_MS for a player — one the gap would hold back is dropped,
 * not kept for later. Pure: the server says where everybody stands and when,
 * this says what they found.
 */

/** How near a thing has to lie to be found outright, tiles, with nothing in between. */
export const FIND_REACH = 2;
/** A part this near is found whatever stands between, tiles: it lies at the player's feet. */
export const ITEM_REACH = 0.9;
/** Half the width of the lamp's cone either side of where its player faces, radians. */
export const LAMP_HALF_ANGLE = 0.5;
/**
 * How far the lamp's cone finds things, tiles: what its player holds it on close by. Its beam
 * shows further on the screens; what lies out there is seen, and found only once come nearer.
 */
export const LAMP_REACH = 3;
/** How long a thing has to stand in the lamp's cone to be found, ms: held on it, not swept past. */
export const LOOK_MS = 600;
/** How long after one chime the next may sound for the same player, ms. */
export const CHIME_GAP_MS = 1500;

/** One thing to find, as the views name it. */
export type Find =
  | { of: 'source'; id: string }
  | { of: 'note'; index: number }
  | { of: 'item'; id: string }
  | { of: 'console'; puzzleId: string; console: ConsoleId | null }
  | { of: 'sign' };

/** What the state keeps a find by: `source:<id>`, `note:<index>`, `item:<id>`, … */
export type FindKey = string;

/** A find that matters, as its finder's view lists it: what, when, and whether it chimes. */
export interface Discovery {
  find: Find;
  /** epoch ms */
  at: number;
  /** its chime sounds: at most once every CHIME_GAP_MS for a player; its caption always shows */
  chime: boolean;
}

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

/** The finds a map holds, by key: its sources, notes, parts, consoles and sign. */
function findsOf(map: MapDef): Map<FindKey, Find> {
  const finds: Find[] = [
    ...map.manuals.map((m): Find => ({ of: 'source', id: m.id })),
    ...map.notes.map((_, index): Find => ({ of: 'note', index })),
    ...map.items.map((item): Find => ({ of: 'item', id: item.id })),
    ...map.stations.map(consoleFind),
    ...(map.edgeworkSign === undefined ? [] : [{ of: 'sign' } as const]),
  ];
  return new Map(finds.map((find) => [findKey(find), find]));
}

/** The finds of each map, worked out once per map. */
const findsByMap = new WeakMap<MapDef, Map<FindKey, Find>>();

/** The thing of `map` kept as `key`; null where the map holds none. */
export function findOf(map: MapDef, key: FindKey): Find | null {
  let finds = findsByMap.get(map);
  if (finds === undefined) {
    finds = findsOf(map);
    findsByMap.set(map, finds);
  }
  return finds.get(key) ?? null;
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

/** The puzzle of the armed station, while one is: the lights out and a station still to work. */
function armedPuzzle(state: GameState): string | null {
  const current = state.mission.puzzles[state.currentPuzzleIndex];
  return lightsAreOut(state) && current !== undefined ? current.id : null;
}

/** The sources where the run placed them, in map order. */
function placedSources(state: GameState): Findable[] {
  return state.mission.map.manuals.flatMap((m) => {
    const at = state.places[m.id];
    return at === undefined ? [] : [findable({ of: 'source', id: m.id }, at.x + 0.5, at.y + 0.5)];
  });
}

/** The notes of the last shift, each at the point it is looked for. */
function notesOf(map: MapDef): Findable[] {
  return map.notes.flatMap((note, index) => {
    const at = notePoint(map, note);
    return at === null ? [] : [findable({ of: 'note', index }, at.x, at.y)];
  });
}

/** The parts lying loose: one in somebody's hands or in its place is found by nobody. */
function looseParts(state: GameState): Findable[] {
  return state.mission.map.items.flatMap((def) => {
    const live = state.items[def.id];
    const loose = live !== undefined && live.carriedBy === null && !live.delivered;
    return loose ? [findable({ of: 'item', id: def.id }, live.x, live.y)] : [];
  });
}

/** The consoles at `spots`, each at its tile's middle. */
function consolesAt(spots: readonly StationSpot[]): Findable[] {
  return spots.map((s) => findable(consoleFind(s), s.x + 0.5, s.y + 0.5));
}

/**
 * Everything this run has to find, in map order: the sources where the run
 * placed them, the notes, the parts lying loose, the consoles of the armed
 * station and the sign.
 */
export function findables(state: GameState): Findable[] {
  const { map } = state.mission;
  const armed = armedPuzzle(state);
  const sign = map.edgeworkSign;
  const signs = sign === undefined ? [] : [findable({ of: 'sign' }, sign.x + 0.5, sign.y + 0.5)];
  return [
    ...placedSources(state),
    ...notesOf(map),
    ...looseParts(state),
    ...consolesAt(map.stations.filter((s) => s.puzzleId === armed)),
    ...signs,
  ];
}

/**
 * Whether the power lights the whole lab, so that every player sees all of it: the opening,
 * before the lights fail, and the way out, once every station is solved.
 */
export function labLit(state: GameState): boolean {
  const solved = state.currentPuzzleIndex >= state.mission.puzzles.length;
  return state.phase === 'playing' && (state.lightsOutAt === null || solved);
}

/**
 * What a view carries only while its player has it in sight: what nobody of the crew has found
 * — the sources where the run placed them, the notes, the parts lying loose and the consoles of
 * every station but the armed one. Every view carries the rest whole, the sign, a fixture,
 * included; and sight is kept of nothing else, so that a known thing coming into sight sends no
 * view.
 */
export function sightables(state: GameState): Findable[] {
  const { map } = state.mission;
  const armed = armedPuzzle(state);
  return [
    ...placedSources(state),
    ...notesOf(map),
    ...looseParts(state),
    ...consolesAt(map.stations.filter((s) => s.puzzleId !== armed)),
  ].filter((thing) => !crewFound(state, thing.key));
}

/**
 * What `looker` has in sight of `things`, by key: every one a straight line reaches from where
 * they stand with nothing in between — however far, whichever way they face; what the light
 * on their screen shows of it is the screen's affair. The doors in `shut` stop sight like walls.
 */
export function inSight(
  map: SightMap,
  shut: ReadonlySet<string>,
  looker: { x: number; y: number },
  things: readonly Findable[],
): FindKey[] {
  return things.filter((thing) => canSee(map, looker, thing, shut)).map((thing) => thing.key);
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

/** Whether `playerId` has found the thing kept as `key` this run. */
export function foundBy(state: GameState, playerId: string, key: FindKey): boolean {
  return state.found[playerId]?.includes(key) === true;
}

/** Whether the source `id` prints the rules of the armed station. */
function printsArmedRules(state: GameState, id: string): boolean {
  const armed = armedPuzzle(state);
  const source = state.mission.map.manuals.find((m) => m.id === id);
  return armed !== null && source?.puzzleIds.includes(armed) === true;
}

/**
 * How much finding `find` matters now, most first, or null where it does
 * not: a console of the armed station, a source printing its rules, a part,
 * a note, the sign. A console or the rules of any other station stay quiet,
 * as a find to work later would only drown the one at hand; decor,
 * furniture, lamps and plates are never found at all.
 */
export function mattering(state: GameState, find: Find): number | null {
  switch (find.of) {
    case 'console':
      return find.puzzleId === armedPuzzle(state) ? 0 : null;
    case 'source':
      return printsArmedRules(state, find.id) ? 1 : null;
    case 'item':
      return 2;
    case 'note':
      return 3;
    case 'sign':
      return 4;
  }
}

/** Of a player's first finds `keys`, the ones that matter, most mattering first. */
function thatMatter(state: GameState, keys: readonly FindKey[]): FindKey[] {
  return keys
    .map((key) => {
      const find = findOf(state.mission.map, key);
      return { key, rank: find === null ? null : mattering(state, find) };
    })
    .filter((one): one is { key: FindKey; rank: number } => one.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((one) => one.key);
}

/** Whether a chime may sound at `at` (epoch ms) after a player's discoveries `had`. */
function chimeFree(had: readonly { at: number; chime: boolean }[], at: number): boolean {
  const last = had.filter((one) => one.chime).at(-1);
  return last === undefined || at - last.at >= CHIME_GAP_MS;
}

/**
 * Each player's discoveries after their first finds `fresh` at `at` (epoch ms), by player id:
 * every one of them that matters joins the player's list, most mattering first, its caption
 * certain; the first of them chimes where the player's last chime was CHIME_GAP_MS ago or more.
 * A chime the gap holds back is dropped for good, and a thing is found for the first time once.
 */
export function discover(
  state: GameState,
  fresh: Readonly<Record<string, readonly FindKey[]>>,
  at: number,
): GameState['discoveries'] {
  const discoveries = { ...state.discoveries };
  for (const [playerId, keys] of Object.entries(fresh)) {
    const had = discoveries[playerId] ?? [];
    const due = thatMatter(state, keys);
    if (due.length > 0) {
      const chimes = chimeFree(had, at);
      const made = due.map((key, i) => ({ key, at, chime: chimes && i === 0 }));
      discoveries[playerId] = [...had, ...made];
    }
  }
  return discoveries;
}
