import { noteSpot, type DecorKind } from '@escapelab/core';
import {
  defaultFields,
  freeId,
  newPuzzle,
  SOURCE_NAMES,
  twoConsoles,
  type Draft,
  type DraftMap,
  type DraftPanel,
  type DraftPuzzle,
  type DraftStation,
  type StationType,
  type Tile,
} from './draft.js';

/**
 * What the editor's tools do to a draft, as pure functions: placing,
 * selecting, moving, deleting, painting and renaming. The rules:
 *
 * - Things stand on floor. A press on a wall or the void places nothing and
 *   says why — but a note of the last crew may also hang on a wall with
 *   floor beside it.
 * - One solid thing a tile — start, door, plate, station, source, sign, exit,
 *   item, valve, a piece of furniture, a note. A press on a tile that has one
 *   selects it instead.
 *   Marks — room names, drop-offs, drone waypoints — may lie on anything.
 * - The sign and the exit exist once: placing them again moves them; so does
 *   placing a station whose puzzle (or, at two consoles, whose console)
 *   already has one.
 * - The drone tool adds waypoints to the selected drone; with none selected
 *   it starts a new one. A source gets more spots, an item its drop-off,
 *   through a pending press the side form arms.
 */

export type Tool =
  | 'select'
  | 'floor'
  | 'wall'
  | 'spawn'
  | 'door'
  | 'plate'
  | 'station'
  | 'source'
  | 'sign'
  | 'label'
  | 'exit'
  | 'item'
  | 'drone'
  | 'decor'
  | 'note';

/** The tools that put a thing on the map, as against selecting and painting. */
export type PlacingTool = Exclude<Tool, 'select' | 'floor' | 'wall'>;

/** One thing in the draft: on the map, or — a puzzle — in its list. */
export type Ref =
  | { kind: 'spawn'; index: number }
  | { kind: 'door'; index: number }
  | { kind: 'plate'; index: number }
  | { kind: 'station'; index: number }
  | { kind: 'source'; index: number; spot: number }
  | { kind: 'sign' }
  | { kind: 'label'; index: number }
  | { kind: 'exit' }
  | { kind: 'item'; index: number }
  | { kind: 'dropoff'; index: number }
  | { kind: 'drone'; index: number; waypoint: number }
  | { kind: 'panel'; index: number }
  | { kind: 'decor'; index: number }
  | { kind: 'note'; index: number }
  | { kind: 'puzzle'; index: number };

/** A press the side form armed: the next tile pressed is a source's spot or an item's drop-off. */
export type Pending = { kind: 'spot'; source: number } | { kind: 'dropoff'; item: number };

/**
 * What the placing tools are set to: the station tool, for which puzzle and
 * at which console (null picks itself); the furniture tool, which piece and
 * in which look (null leaves it to the tile).
 */
export interface ToolChoice {
  puzzleId: string | null;
  console: 'a' | 'b' | null;
  decor: DecorKind;
  variant: number | null;
}

/** The tools as a new editor sets them. */
export const NO_CHOICE: ToolChoice = {
  puzzleId: null,
  console: null,
  decor: 'shelf',
  variant: null,
};

/** A press's outcome: the draft, what is selected now, and a word for the status line. */
export interface Placement {
  draft: Draft;
  selection: Ref | null;
  note: string | null;
}

/** Floor brush and wall brush. */
export const MATERIAL = { floor: '.', wall: '#' } as const;

const SOLID_KINDS: ReadonlySet<Ref['kind']> = new Set([
  'spawn',
  'door',
  'plate',
  'station',
  'source',
  'sign',
  'exit',
  'item',
  'panel',
  'decor',
  'note',
]);

const SOLID_TOOLS: ReadonlySet<Tool> = new Set([
  'spawn',
  'door',
  'plate',
  'station',
  'source',
  'sign',
  'exit',
  'item',
  'decor',
  'note',
]);

export const isSolid = (ref: Ref): boolean => SOLID_KINDS.has(ref.kind);

export const sameTile = (a: Tile, b: Tile): boolean => a.x === b.x && a.y === b.y;

export function mapSize(draft: Draft): { width: number; height: number } {
  return { width: draft.map.tiles[0]?.length ?? 0, height: draft.map.tiles.length };
}

export function isFloor(draft: Draft, at: Tile): boolean {
  return draft.map.tiles[at.y]?.charAt(at.x) === '.';
}

/** Where a thing may go: on floor — a note also on a wall with floor beside it. */
function fits(draft: Draft, kind: Tool | Ref['kind'], at: Tile): boolean {
  return kind === 'note' ? noteSpot(draft.map, at) !== null : isFloor(draft, at);
}

function inside(draft: Draft, at: Tile): boolean {
  const { width, height } = mapSize(draft);
  return at.x >= 0 && at.y >= 0 && at.x < width && at.y < height;
}

// ── where things are ─────────────────────────────────────────────────────

/** Everything on the map with its tile: solid things first, then the marks. */
export function placedRefs(draft: Draft): { ref: Ref; at: Tile }[] {
  const map = draft.map;
  const all: { ref: Ref; at: Tile }[] = [
    ...map.spawns.map((at, index) => ({ ref: { kind: 'spawn', index } as Ref, at })),
    ...map.doors.map((at, index) => ({ ref: { kind: 'door', index } as Ref, at })),
    ...map.plates.map((at, index) => ({ ref: { kind: 'plate', index } as Ref, at })),
    ...map.stations.map((at, index) => ({ ref: { kind: 'station', index } as Ref, at })),
    ...map.manuals.flatMap((source, index) =>
      source.spots.map((at, spot) => ({ ref: { kind: 'source', index, spot } as Ref, at })),
    ),
    ...(map.edgeworkSign === undefined
      ? []
      : [{ ref: { kind: 'sign' } as Ref, at: map.edgeworkSign }]),
    ...(map.exit === undefined ? [] : [{ ref: { kind: 'exit' } as Ref, at: map.exit }]),
    ...map.items.map((at, index) => ({ ref: { kind: 'item', index } as Ref, at })),
    ...(map.sabotage?.panels ?? []).map((at, index) => ({
      ref: { kind: 'panel', index } as Ref,
      at,
    })),
    ...map.decor.map((at, index) => ({ ref: { kind: 'decor', index } as Ref, at })),
    ...map.notes.map((at, index) => ({ ref: { kind: 'note', index } as Ref, at })),
    ...map.labels.map((at, index) => ({ ref: { kind: 'label', index } as Ref, at })),
    ...map.items.flatMap((item, index) =>
      item.deliverTo === undefined
        ? []
        : [{ ref: { kind: 'dropoff', index } as Ref, at: item.deliverTo }],
    ),
    ...map.drones.flatMap((drone, index) =>
      drone.waypoints.map((at, waypoint) => ({
        ref: { kind: 'drone', index, waypoint } as Ref,
        at,
      })),
    ),
  ];
  return all.map(({ ref, at }) => ({ ref, at: { x: at.x, y: at.y } }));
}

/** What lies on a tile, solid things first. */
export function refsAt(draft: Draft, at: Tile): Ref[] {
  return placedRefs(draft)
    .filter((placed) => sameTile(placed.at, at))
    .map((placed) => placed.ref);
}

/** The tile one thing stands on; null for a puzzle or a ref that points past its list. */
export function tileOf(draft: Draft, ref: Ref): Tile | null {
  const found = placedRefs(draft).find((placed) => sameRef(placed.ref, ref));
  return found?.at ?? null;
}

/**
 * Every tile that belongs to a thing, for outlining it: all spots of a
 * source, all waypoints of a drone, an item and its drop-off, all stations
 * of a puzzle; the one tile of anything else.
 */
export function tilesOf(draft: Draft, ref: Ref): Tile[] {
  return partsOf(draft, ref).map(({ x, y }) => ({ x, y }));
}

function partsOf(draft: Draft, ref: Ref): readonly Tile[] {
  switch (ref.kind) {
    case 'source':
      return partsAt(draft.map.manuals, ref.index, (source) => source.spots);
    case 'drone':
      return partsAt(draft.map.drones, ref.index, (drone) => drone.waypoints);
    case 'item':
    case 'dropoff':
      return itemParts(draft, ref.index);
    case 'puzzle':
      return partsAt(draft.puzzles, ref.index, (puzzle) =>
        draft.map.stations.filter((s) => s.puzzleId === puzzle.id),
      );
    default:
      return [tileOf(draft, ref)].filter((at) => at !== null);
  }
}

/** The tiles of the entry at `index` of a list; none past its end. */
function partsAt<T>(
  list: readonly T[],
  index: number,
  parts: (entry: T) => readonly Tile[],
): readonly Tile[] {
  const entry = list[index];
  return entry === undefined ? [] : parts(entry);
}

/** An item where it lies, and its drop-off. */
function itemParts(draft: Draft, index: number): Tile[] {
  const item = draft.map.items[index];
  if (item === undefined) {
    return [];
  }
  return item.deliverTo === undefined ? [item] : [item, item.deliverTo];
}

export function sameRef(a: Ref, b: Ref): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Whether two refs name the same thing: one source by any of its spots, one
 * drone by any of its waypoints, an item by itself or by its drop-off.
 */
export function sameThing(a: Ref, b: Ref): boolean {
  const thing = (ref: Ref): Ref['kind'] => (ref.kind === 'dropoff' ? 'item' : ref.kind);
  if (thing(a) !== thing(b)) {
    return false;
  }
  return 'index' in a && 'index' in b ? a.index === b.index : true;
}

// ── placing ──────────────────────────────────────────────────────────────

export function withMap(draft: Draft, patch: Partial<DraftMap>): Draft {
  return { ...draft, map: { ...draft.map, ...patch } };
}

export function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((old, i) => (i === index ? value : old));
}

const placed = (draft: Draft, selection: Ref): Placement => ({ draft, selection, note: null });

/** The puzzle a station would be placed for: the chosen one, else the first still without. */
export function stationTarget(draft: Draft, chosen: string | null): DraftPuzzle | undefined {
  const picked = draft.puzzles.find((p) => p.id === chosen);
  if (picked !== undefined) {
    return picked;
  }
  const missing = (p: DraftPuzzle): boolean => {
    const spots = draft.map.stations.filter((s) => s.puzzleId === p.id);
    return twoConsoles(p.type) ? spots.length < 2 : spots.length === 0;
  };
  return draft.puzzles.find(missing) ?? draft.puzzles[0];
}

/** The console the station tool places next for a puzzle: the chosen one, else the one missing. */
export function stationConsole(
  draft: Draft,
  puzzleId: string,
  chosen: 'a' | 'b' | null,
): 'a' | 'b' {
  if (chosen !== null) {
    return chosen;
  }
  const has = (console: 'a' | 'b'): boolean =>
    draft.map.stations.some((s) => s.puzzleId === puzzleId && s.console === console);
  return has('a') && !has('b') ? 'b' : 'a';
}

function placeStation(draft: Draft, at: Tile, choice: ToolChoice): Placement {
  const puzzle = stationTarget(draft, choice.puzzleId);
  if (puzzle === undefined) {
    return { draft, selection: null, note: 'Erst ein Rätsel anlegen (Reiter „Rätsel").' };
  }
  const console = twoConsoles(puzzle.type)
    ? stationConsole(draft, puzzle.id, choice.console)
    : null;
  const station: DraftStation = {
    puzzleId: puzzle.id,
    x: at.x,
    y: at.y,
    ...(console === null ? {} : { console }),
  };
  const stations = draft.map.stations;
  const existing = stations.findIndex(
    (s) => s.puzzleId === puzzle.id && (console === null || s.console === console),
  );
  if (existing >= 0) {
    return placed(withMap(draft, { stations: replaceAt(stations, existing, station) }), {
      kind: 'station',
      index: existing,
    });
  }
  return placed(withMap(draft, { stations: [...stations, station] }), {
    kind: 'station',
    index: stations.length,
  });
}

/** The first puzzle whose rules nothing covers yet and somebody has to read. */
function uncovered(draft: Draft): DraftPuzzle | undefined {
  const covered = new Set(draft.map.manuals.flatMap((m) => m.puzzleIds));
  return draft.puzzles.find((p) => p.type !== 'button-sync' && !covered.has(p.id));
}

function placeSource(draft: Draft, at: Tile): Placement {
  const target = uncovered(draft);
  const source = {
    id: freeId('quelle', draft.map.manuals.map((m) => m.id)),
    kind: 'book' as const,
    label: SOURCE_NAMES.book.label,
    puzzleIds: target === undefined ? [] : [target.id],
    spots: [at],
    needsKey: '',
  };
  const manuals = draft.map.manuals;
  return placed(withMap(draft, { manuals: [...manuals, source] }), {
    kind: 'source',
    index: manuals.length,
    spot: 0,
  });
}

function placeDoor(draft: Draft, at: Tile): Placement {
  const [puzzle] = draft.puzzles;
  const [plate] = draft.map.plates;
  const door = {
    id: freeId('tuer', draft.map.doors.map((d) => d.id)),
    x: at.x,
    y: at.y,
    opensBy:
      puzzle === undefined && plate !== undefined
        ? { kind: 'plate' as const, plateId: plate.id, untilSolved: '' }
        : { kind: 'puzzle' as const, puzzleId: puzzle?.id ?? '' },
  };
  const doors = draft.map.doors;
  return placed(withMap(draft, { doors: [...doors, door] }), { kind: 'door', index: doors.length });
}

function placeDrone(draft: Draft, at: Tile, selection: Ref | null): Placement {
  const drones = draft.map.drones;
  const drone = selection?.kind === 'drone' ? drones[selection.index] : undefined;
  if (selection?.kind === 'drone' && drone !== undefined) {
    const waypoints = [...drone.waypoints, at];
    const longer = replaceAt(drones, selection.index, { ...drone, waypoints });
    return placed(withMap(draft, { drones: longer }), {
      kind: 'drone',
      index: selection.index,
      waypoint: waypoints.length - 1,
    });
  }
  const id = freeId('drohne', drones.map((d) => d.id));
  return placed(withMap(draft, { drones: [...drones, { id, waypoints: [at], extra: {} }] }), {
    kind: 'drone',
    index: drones.length,
    waypoint: 0,
  });
}

type Placer = (draft: Draft, at: Tile, selection: Ref | null, choice: ToolChoice) => Placement;

const PLACERS: Readonly<Record<PlacingTool, Placer>> = {
  spawn: (draft, at) =>
    placed(withMap(draft, { spawns: [...draft.map.spawns, at] }), {
      kind: 'spawn',
      index: draft.map.spawns.length,
    }),
  door: (draft, at) => placeDoor(draft, at),
  plate: (draft, at) => {
    const id = freeId('platte', draft.map.plates.map((p) => p.id));
    const plates = [...draft.map.plates, { id, x: at.x, y: at.y, label: 'HALTEN' }];
    return placed(withMap(draft, { plates }), { kind: 'plate', index: plates.length - 1 });
  },
  station: (draft, at, _selection, choice) => placeStation(draft, at, choice),
  source: (draft, at) => placeSource(draft, at),
  sign: (draft, at) => placed(withMap(draft, { edgeworkSign: at }), { kind: 'sign' }),
  label: (draft, at) => {
    const labels = [...draft.map.labels, { text: 'RAUM', x: at.x, y: at.y, kind: '' as const }];
    return placed(withMap(draft, { labels }), { kind: 'label', index: labels.length - 1 });
  },
  exit: (draft, at) => placed(withMap(draft, { exit: at }), { kind: 'exit' }),
  item: (draft, at) => {
    const id = freeId('teil', draft.map.items.map((i) => i.id));
    const items = [...draft.map.items, { id, label: 'KISTE', x: at.x, y: at.y, requiredFor: '' }];
    return placed(withMap(draft, { items }), { kind: 'item', index: items.length - 1 });
  },
  drone: (draft, at, selection) => placeDrone(draft, at, selection),
  decor: (draft, at, _selection, choice) => {
    const piece = { kind: choice.decor, x: at.x, y: at.y, variant: choice.variant };
    const decor = [...draft.map.decor, piece];
    return placed(withMap(draft, { decor }), { kind: 'decor', index: decor.length - 1 });
  },
  note: (draft, at) => {
    const notes = [...draft.map.notes, { x: at.x, y: at.y, text: NEW_NOTE }];
    return placed(withMap(draft, { notes }), { kind: 'note', index: notes.length - 1 });
  },
};

/** What a new note of the last crew says until its author writes it. */
export const NEW_NOTE = 'Wer das liest, ist nicht der Erste hier.';
export const ON_FLOOR_ONLY = 'Nur auf Boden — erst mit dem Boden-Pinsel Fläche malen.';
export const NOTE_SPOT = 'Eine Notiz hängt an einer Wand neben dem Boden oder liegt auf dem Boden.';
export const TAKEN = 'Dort steht schon etwas.';

/** Why a thing may not go to `at`: the note's own word, or the floor's. */
const notThere = (kind: Tool | Ref['kind']): string =>
  kind === 'note' ? NOTE_SPOT : ON_FLOOR_ONLY;

/**
 * A press with a placing tool. On a tile with a solid thing, a tool that
 * places one selects that thing; a room name already there is selected the
 * same way by the room-name tool.
 */
export function place(
  draft: Draft,
  tool: PlacingTool,
  at: Tile,
  selection: Ref | null,
  choice: ToolChoice,
): Placement {
  if (!inside(draft, at)) {
    return { draft, selection, note: null };
  }
  const here = refsAt(draft, at);
  const occupant = SOLID_TOOLS.has(tool)
    ? here.find(isSolid)
    : here.find((ref) => tool === 'label' && ref.kind === 'label');
  if (occupant !== undefined) {
    return { draft, selection: occupant, note: null };
  }
  if (!fits(draft, tool, at)) {
    return { draft, selection, note: notThere(tool) };
  }
  return PLACERS[tool](draft, at, selection, choice);
}

/** A press while the side form waits for one: a source's next spot or an item's drop-off. */
export function placePending(draft: Draft, pending: Pending, at: Tile): Placement {
  if (!inside(draft, at) || !isFloor(draft, at)) {
    return { draft, selection: null, note: ON_FLOOR_ONLY };
  }
  if (pending.kind === 'dropoff') {
    const item = draft.map.items[pending.item];
    if (item === undefined) {
      return { draft, selection: null, note: null };
    }
    const items = replaceAt(draft.map.items, pending.item, { ...item, deliverTo: at });
    return placed(withMap(draft, { items }), { kind: 'dropoff', index: pending.item });
  }
  const source = draft.map.manuals[pending.source];
  if (source === undefined) {
    return { draft, selection: null, note: null };
  }
  if (refsAt(draft, at).some(isSolid)) {
    return { draft, selection: null, note: TAKEN };
  }
  const spots = [...source.spots, at];
  const manuals = replaceAt(draft.map.manuals, pending.source, { ...source, spots });
  return placed(withMap(draft, { manuals }), {
    kind: 'source',
    index: pending.source,
    spot: spots.length - 1,
  });
}

// ── moving and deleting ──────────────────────────────────────────────────

/** The things that are entries of one map list, found by their kind and index. */
const LISTS = {
  spawn: 'spawns',
  door: 'doors',
  plate: 'plates',
  station: 'stations',
  label: 'labels',
  item: 'items',
  decor: 'decor',
  note: 'notes',
} as const;

type ListRef = Extract<Ref, { kind: keyof typeof LISTS }>;
type PartRef = Exclude<Ref, ListRef>;

const isListRef = (ref: Ref): ref is ListRef => ref.kind in LISTS;

/**
 * A map list with one entry changed or gone. Every list in LISTS holds
 * things with a tile, and `change` keeps an entry's type, so the patch is
 * one of the draft map's own.
 */
function editList(draft: Draft, ref: ListRef, change: (list: readonly Tile[]) => Tile[]): Draft {
  const key = LISTS[ref.kind];
  return withMap(draft, { [key]: change(draft.map[key]) } as Partial<DraftMap>);
}

const without = <T>(list: readonly T[], index: number): T[] => list.filter((_, i) => i !== index);

/** Moving a part of a thing, or a thing there is only one of: the sign, the exit. */
function relocatePart(draft: Draft, ref: PartRef, tile: Tile): Draft {
  const map = draft.map;
  switch (ref.kind) {
    case 'sign':
      return withMap(draft, { edgeworkSign: tile });
    case 'exit':
      return withMap(draft, { exit: tile });
    case 'source':
      return withMap(draft, {
        manuals: map.manuals.map((m, i) =>
          i === ref.index ? { ...m, spots: replaceAt(m.spots, ref.spot, tile) } : m,
        ),
      });
    case 'drone':
      return withMap(draft, {
        drones: map.drones.map((d, i) =>
          i === ref.index ? { ...d, waypoints: replaceAt(d.waypoints, ref.waypoint, tile) } : d,
        ),
      });
    case 'dropoff':
      return withMap(draft, {
        items: map.items.map((t, i) => (i === ref.index ? { ...t, deliverTo: tile } : t)),
      });
    case 'panel':
      return editPanels(draft, (panels) =>
        panels.map((p, i) => (i === ref.index ? { ...p, ...tile } : p)),
      );
    default:
      return draft;
  }
}

/** The emergency's valves changed; nothing happens to a mission without one. */
function editPanels(draft: Draft, change: (panels: readonly DraftPanel[]) => DraftPanel[]): Draft {
  const sabotage = draft.map.sabotage;
  return sabotage === undefined
    ? draft
    : withMap(draft, { sabotage: { ...sabotage, panels: change(sabotage.panels) } });
}

/** Drags a thing to another tile, by the same floor and one-solid-a-tile rules as placing. */
export function move(draft: Draft, ref: Ref, to: Tile): Placement {
  if (!inside(draft, to) || !fits(draft, ref.kind, to)) {
    return { draft, selection: ref, note: notThere(ref.kind) };
  }
  if (isSolid(ref) && refsAt(draft, to).some((other) => isSolid(other) && !sameRef(other, ref))) {
    return { draft, selection: ref, note: TAKEN };
  }
  const tile = { x: to.x, y: to.y };
  const moved = isListRef(ref)
    ? editList(draft, ref, (list) => list.map((t, i) => (i === ref.index ? { ...t, ...tile } : t)))
    : relocatePart(draft, ref, tile);
  return { draft: moved, selection: ref, note: null };
}

/**
 * Deletes a thing. A source's last spot takes the source with it, a drone's
 * last waypoint the drone; a drop-off only leaves its item without one. A
 * puzzle takes its stations and leaves every source covering it; doors and
 * items that name it are left for the validator to point at.
 */
export function remove(draft: Draft, ref: Ref): Draft {
  return isListRef(ref)
    ? editList(draft, ref, (list) => without(list, ref.index))
    : removePart(draft, ref);
}

function removePart(draft: Draft, ref: PartRef): Draft {
  switch (ref.kind) {
    case 'sign': {
      const map = { ...draft.map };
      delete map.edgeworkSign;
      return { ...draft, map };
    }
    case 'exit': {
      const map = { ...draft.map };
      delete map.exit;
      return { ...draft, map };
    }
    case 'puzzle':
      return removePuzzle(draft, ref.index);
    case 'source':
      return removeSpot(draft, ref.index, ref.spot);
    case 'drone':
      return removeWaypoint(draft, ref.index, ref.waypoint);
    case 'dropoff':
      return removeDropoff(draft, ref.index);
    case 'panel':
      return editPanels(draft, (panels) => without(panels, ref.index));
  }
}

function removeSpot(draft: Draft, index: number, spot: number): Draft {
  const manuals = draft.map.manuals;
  const source = manuals[index];
  if (source === undefined || source.spots.length <= 1) {
    return withMap(draft, { manuals: without(manuals, index) });
  }
  return withMap(draft, {
    manuals: replaceAt(manuals, index, { ...source, spots: without(source.spots, spot) }),
  });
}

function removeWaypoint(draft: Draft, index: number, waypoint: number): Draft {
  const drones = draft.map.drones;
  const drone = drones[index];
  if (drone === undefined || drone.waypoints.length <= 1) {
    return withMap(draft, { drones: without(drones, index) });
  }
  return withMap(draft, {
    drones: replaceAt(drones, index, { ...drone, waypoints: without(drone.waypoints, waypoint) }),
  });
}

function removeDropoff(draft: Draft, index: number): Draft {
  const item = draft.map.items[index];
  if (item === undefined) {
    return draft;
  }
  const kept = { ...item };
  delete kept.deliverTo;
  return withMap(draft, { items: replaceAt(draft.map.items, index, kept) });
}

// ── puzzles ──────────────────────────────────────────────────────────────

export function addPuzzle(draft: Draft, type: StationType): Draft {
  return { ...draft, puzzles: [...draft.puzzles, newPuzzle(type, draft.puzzles.map((p) => p.id))] };
}

function removePuzzle(draft: Draft, index: number): Draft {
  const id = draft.puzzles[index]?.id;
  if (id === undefined) {
    return draft;
  }
  return {
    ...draft,
    puzzles: without(draft.puzzles, index),
    map: {
      ...draft.map,
      stations: draft.map.stations.filter((s) => s.puzzleId !== id),
      manuals: draft.map.manuals.map((m) => ({
        ...m,
        puzzleIds: m.puzzleIds.filter((p) => p !== id),
      })),
    },
  };
}

/** Moves a puzzle one place up (-1) or down (1) in mission order. */
export function shiftPuzzle(draft: Draft, index: number, by: -1 | 1): Draft {
  const puzzle = draft.puzzles[index];
  const other = draft.puzzles[index + by];
  if (puzzle === undefined || other === undefined) {
    return draft;
  }
  const puzzles = replaceAt(replaceAt(draft.puzzles, index, other), index + by, puzzle);
  return { ...draft, puzzles };
}

/**
 * Gives a puzzle another module. Its own fields belong to the old module:
 * the new module's take their place, at their defaults. Its stations
 * follow: one console keeps the first and drops the console letter, two
 * consoles letter the one there as console a.
 */
export function retype(draft: Draft, index: number, type: StationType): Draft {
  const puzzle = draft.puzzles[index];
  if (puzzle === undefined || puzzle.type === type) {
    return draft;
  }
  const two = twoConsoles(type);
  const mine = draft.map.stations.filter((s) => s.puzzleId === puzzle.id);
  const kept: DraftStation[] = two
    ? mine.map((s, i) => ({ ...s, console: s.console ?? (i === 0 ? 'a' : 'b') }))
    : mine.slice(0, 1).map((s) => {
        const one = { ...s };
        delete one.console;
        return one;
      });
  const others = draft.map.stations.filter((s) => s.puzzleId !== puzzle.id);
  return {
    ...draft,
    puzzles: replaceAt(draft.puzzles, index, { ...puzzle, type, fields: defaultFields(type) }),
    map: { ...draft.map, stations: [...others, ...kept] },
  };
}

// ── renaming ─────────────────────────────────────────────────────────────

/**
 * Gives a puzzle, plate or item a new id and follows it everywhere it is
 * named: stations, doors, sources, items, drones, keys.
 */
export function rename(
  draft: Draft,
  what: 'puzzle' | 'plate' | 'item',
  from: string,
  to: string,
): Draft {
  const swap = (id: string): string => (id === from ? to : id);
  const map = draft.map;
  if (what === 'puzzle') {
    return {
      ...draft,
      puzzles: draft.puzzles.map((p) => ({ ...p, id: swap(p.id) })),
      map: {
        ...map,
        stations: map.stations.map((s) => ({ ...s, puzzleId: swap(s.puzzleId) })),
        doors: map.doors.map((d) => ({
          ...d,
          opensBy:
            d.opensBy.kind === 'puzzle'
              ? { ...d.opensBy, puzzleId: swap(d.opensBy.puzzleId) }
              : { ...d.opensBy, untilSolved: swap(d.opensBy.untilSolved) },
        })),
        manuals: map.manuals.map((m) => ({ ...m, puzzleIds: m.puzzleIds.map(swap) })),
        items: map.items.map((i) => ({ ...i, requiredFor: swap(i.requiredFor) })),
      },
    };
  }
  if (what === 'plate') {
    return withMap(draft, {
      plates: map.plates.map((p) => ({ ...p, id: swap(p.id) })),
      doors: map.doors.map((d) =>
        d.opensBy.kind === 'plate'
          ? { ...d, opensBy: { ...d.opensBy, plateId: swap(d.opensBy.plateId) } }
          : d,
      ),
      drones: map.drones.map((d) =>
        d.extra['frozenByPlate'] === from ? { ...d, extra: { ...d.extra, frozenByPlate: to } } : d,
      ),
    });
  }
  return withMap(draft, {
    items: map.items.map((i) => ({ ...i, id: swap(i.id) })),
    manuals: map.manuals.map((m) => ({ ...m, needsKey: swap(m.needsKey) })),
  });
}

// ── painting ─────────────────────────────────────────────────────────────

/** The tiles a straight stroke from `a` to `b` passes, both ends included (Bresenham). */
export function lineBetween(a: Tile, b: Tile): Tile[] {
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  const line: Tile[] = [];
  let { x, y } = a;
  let err = dx + dy;
  for (;;) {
    line.push({ x, y });
    if (x === b.x && y === b.y) {
      return line;
    }
    const twice = 2 * err;
    if (twice >= dy) {
      err += dy;
      x += sx;
    }
    if (twice <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Paints tiles with floor or wall; tiles outside the map are left alone. */
export function paint(draft: Draft, tiles: readonly Tile[], material: '.' | '#'): Draft {
  const rows = [...draft.map.tiles];
  let changed = false;
  for (const at of tiles) {
    const row = rows[at.y];
    if (row === undefined || at.x < 0 || at.x >= row.length || row.charAt(at.x) === material) {
      continue;
    }
    rows[at.y] = `${row.slice(0, at.x)}${material}${row.slice(at.x + 1)}`;
    changed = true;
  }
  return changed ? withMap(draft, { tiles: rows }) : draft;
}

/** The map's size bounds, in tiles. */
export const MAP_LIMITS = { min: 5, maxWidth: 60, maxHeight: 40 } as const;

/** The map at another size: cut at the right and bottom, or grown there with wall. */
export function resize(draft: Draft, width: number, height: number): Draft {
  const w = Math.min(MAP_LIMITS.maxWidth, Math.max(MAP_LIMITS.min, Math.round(width)));
  const h = Math.min(MAP_LIMITS.maxHeight, Math.max(MAP_LIMITS.min, Math.round(height)));
  const tiles = Array.from({ length: h }, (_, y) =>
    (draft.map.tiles[y] ?? '').slice(0, w).padEnd(w, '#'),
  );
  return withMap(draft, { tiles });
}
