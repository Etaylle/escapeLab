import { missionSchema } from '@escapelab/core';
import { draftToJson, type Draft, type Tile } from './draft.js';
import { mapSize, tilesOf, type Ref } from './tools.js';

/**
 * The validator: the draft's mission file through the same check
 * `parseMission` makes (`missionSchema`, map rules and reachability proofs
 * included), plus a few things the format allows but a lab rarely wants.
 * Every finding knows where it is: the thing to select and the tiles to
 * light up on the map.
 */

/** Errors keep the server from saving; warnings and notes do not. */
export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  severity: Severity;
  /** as shown: „path: message" where the format names a field, the rule's own words otherwise */
  text: string;
  /** the words alone, for beside the field they are about */
  message: string;
  /** the dotted path into the mission file; '' where a rule speaks of the whole map */
  path: string;
  /** the thing it is about, to select; null where it is about none */
  target: Ref | null;
  /** tiles to light up on the map */
  spots: Tile[];
}

export interface Validation {
  findings: Finding[];
  errors: number;
  /** how long the check took, in ms */
  ms: number;
}

/** Issues that keep the map rules from running: the data has the wrong shape somewhere. */
const SHAPE_ISSUES: ReadonlySet<string> = new Set([
  'invalid_type',
  'invalid_union',
  'invalid_value',
  'invalid_key',
  'invalid_element',
]);

type Segment = string | number;

/** The map lists a path into the file may run through, with the ref of the entry it names. */
const MAP_REFS: Readonly<Record<string, (index: number, rest: readonly Segment[]) => Ref>> = {
  spawns: (index) => ({ kind: 'spawn', index }),
  doors: (index) => ({ kind: 'door', index }),
  plates: (index) => ({ kind: 'plate', index }),
  stations: (index) => ({ kind: 'station', index }),
  labels: (index) => ({ kind: 'label', index }),
  manuals: (index, rest) => ({
    kind: 'source',
    index,
    spot: rest[0] === 'spots' && typeof rest[1] === 'number' ? rest[1] : 0,
  }),
  items: (index, rest) =>
    rest[0] === 'deliverTo' ? { kind: 'dropoff', index } : { kind: 'item', index },
  drones: (index, rest) => ({
    kind: 'drone',
    index,
    waypoint: rest[0] === 'waypoints' && typeof rest[1] === 'number' ? rest[1] : 0,
  }),
};

/** The things of the map there is one of, by their field. */
const MAP_SINGLES: Readonly<Record<string, Ref>> = {
  edgeworkSign: { kind: 'sign' },
  exit: { kind: 'exit' },
};

/** The thing a path into the mission file points into; null for a field of the mission. */
export function refOfPath(path: readonly Segment[]): Ref | null {
  const [top, list, ...rest] = path;
  if (top === 'puzzles') {
    return typeof list === 'number' ? { kind: 'puzzle', index: list } : null;
  }
  return top === 'map' && typeof list === 'string' ? mapRefOfPath(list, rest) : null;
}

/** The thing a path below `map.<list>` points into. */
function mapRefOfPath(list: string, [index, ...rest]: readonly Segment[]): Ref | null {
  const single = MAP_SINGLES[list];
  if (single !== undefined) {
    return single;
  }
  if (list === 'sabotage') {
    const panel = rest[0];
    return index === 'panels' && typeof panel === 'number' ? { kind: 'panel', index: panel } : null;
  }
  const refOf = MAP_REFS[list];
  return refOf !== undefined && typeof index === 'number' ? refOf(index, rest) : null;
}

/** Every thing in the draft that carries this id, in the order a reader would look for it. */
function refsNamed(draft: Draft, id: string): Ref[] {
  const map = draft.map;
  const find = <T,>(
    list: readonly T[],
    has: (t: T) => boolean,
    ref: (index: number) => Ref,
  ): Ref[] => list.flatMap((t, index) => (has(t) ? [ref(index)] : []));
  return [
    ...find(map.stations, (s) => s.puzzleId === id, (index) => ({ kind: 'station', index })),
    ...find(map.doors, (d) => d.id === id, (index) => ({ kind: 'door', index })),
    ...find(map.plates, (p) => p.id === id, (index) => ({ kind: 'plate', index })),
    ...find(map.manuals, (m) => m.id === id, (index) => ({ kind: 'source', index, spot: 0 })),
    ...find(map.items, (i) => i.id === id, (index) => ({ kind: 'item', index })),
    ...find(map.drones, (d) => d.id === id, (index) => ({ kind: 'drone', index, waypoint: 0 })),
    ...find(map.sabotage?.panels ?? [], (p) => p.id === id, (index) => ({ kind: 'panel', index })),
    ...find(draft.puzzles, (p) => p.id === id, (index) => ({ kind: 'puzzle', index })),
  ];
}

const QUOTED = /"([^"]+)"/g;
const COORDINATES = /\b(\d+),(\d+)\b/g;

/**
 * Where a map rule's message points: the things it names in quotes and the
 * tiles it names as „x,y" — a station and the starts of the crew that got
 * stuck, a cabinet's spot, a drone's way through a wall.
 */
export function locate(draft: Draft, message: string): { target: Ref | null; spots: Tile[] } {
  const named = [...message.matchAll(QUOTED)].flatMap((match) => refsNamed(draft, match[1] ?? ''));
  const bare = message.replace(QUOTED, '');
  const tiles = [...bare.matchAll(COORDINATES)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
  const spots = [...named.flatMap((ref) => tilesOf(draft, ref)), ...tiles];
  return { target: named[0] ?? null, spots: unique(spots) };
}

function unique(tiles: readonly Tile[]): Tile[] {
  const seen = new Set<string>();
  return tiles.filter((t) => {
    const key = `${t.x},${t.y}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function schemaFindings(draft: Draft): { findings: Finding[]; shapeBroken: boolean } {
  const result = missionSchema.safeParse(draftToJson(draft));
  if (result.success) {
    return { findings: [], shapeBroken: false };
  }
  const findings = result.error.issues.map((issue): Finding => {
    const segments = issue.path.filter((s): s is Segment => typeof s !== 'symbol');
    const path = segments.join('.');
    const { message } = issue;
    if (path === '') {
      return { severity: 'error', text: message, message, path, ...locate(draft, message) };
    }
    const target = refOfPath(segments);
    const spots = target === null ? [] : tilesOf(draft, target);
    return { severity: 'error', text: `${path}: ${message}`, message, path, target, spots };
  });
  const shapeBroken = result.error.issues.some((issue) => SHAPE_ISSUES.has(issue.code));
  return { findings, shapeBroken };
}

/** Walls, the void and the map's edge: what a door has to stand between. */
function barrier(draft: Draft, x: number, y: number): boolean {
  const { width, height } = mapSize(draft);
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return true;
  }
  const tile = draft.map.tiles[y]?.charAt(x);
  return tile !== '.' || draft.map.doors.some((d) => d.x === x && d.y === y);
}

/** What the format allows but a lab hardly ever wants. */
function lintFindings(draft: Draft): Finding[] {
  const map = draft.map;
  const found: Finding[] = [];
  map.doors.forEach((door, index) => {
    const across = barrier(draft, door.x - 1, door.y) && barrier(draft, door.x + 1, door.y);
    const along = barrier(draft, door.x, door.y - 1) && barrier(draft, door.x, door.y + 1);
    if (!across && !along) {
      const text = `Tür „${door.id}" steht in keiner Wandlücke — man geht um sie herum.`;
      found.push({
        severity: 'warning',
        text,
        message: text,
        path: `map.doors.${index}`,
        target: { kind: 'door', index },
        spots: [{ x: door.x, y: door.y }],
      });
    }
  });
  const used = new Set([
    ...map.doors.flatMap((d) => (d.opensBy.kind === 'plate' ? [d.opensBy.plateId] : [])),
    ...map.drones.map((d) => d.extra['frozenByPlate']),
  ]);
  map.plates.forEach((plate, index) => {
    if (!used.has(plate.id)) {
      const text = `Platte „${plate.id}" öffnet keine Tür und hält keine Drohne an.`;
      found.push({
        severity: 'warning',
        text,
        message: text,
        path: `map.plates.${index}`,
        target: { kind: 'plate', index },
        spots: [{ x: plate.x, y: plate.y }],
      });
    }
  });
  return found;
}

function note(text: string): Finding {
  return { severity: 'info', text, message: text, path: '', target: null, spots: [] };
}

function notes(draft: Draft, shapeBroken: boolean): Finding[] {
  return [
    ...(shapeBroken
      ? [note('Karten- und Lösbarkeitsprüfung laufen erst, wenn jedes Feld die richtige Art hat.')]
      : []),
    ...(draft.map.exit === undefined
      ? [note('Kein Notausgang: Die Mission ist mit dem letzten Rätsel gewonnen.')]
      : []),
  ];
}

/**
 * Runs every check on the draft. `now` is the clock the duration is taken
 * with; Blackout's map takes a few ms, well under the 200 the editor allows
 * itself before the check would have to leave the main thread.
 */
export function validateDraft(
  draft: Draft,
  now: () => number = () => performance.now(),
): Validation {
  const started = now();
  const { findings, shapeBroken } = schemaFindings(draft);
  const all = [...findings, ...lintFindings(draft), ...notes(draft, shapeBroken)];
  return { findings: all, errors: findings.length, ms: now() - started };
}

/** The messages about one field, by its dotted path in the mission file. */
export function messagesAt(validation: Validation, path: string): string[] {
  return validation.findings.filter((f) => f.path === path).map((f) => f.message);
}

/** The messages about a field and every part of it: `wires` with `wires.min` and `wires.max`. */
export function messagesUnder(validation: Validation, path: string): string[] {
  return validation.findings
    .filter((f) => f.path === path || f.path.startsWith(`${path}.`))
    .map((f) => f.message);
}
