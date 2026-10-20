import {
  MODULES,
  missionSchema,
  moduleFor,
  type ManualKind,
  type PuzzleDef,
} from '@escapelab/core';

/**
 * The mission the editor works on. It holds what the mission file holds, in
 * a shape that is easy to edit: every list there even where the file may
 * leave it out, optional words as '' where the file leaves them out, and
 * what part 1 of the editor does not show (penalties, a module's own
 * fields, a drone's speed, the emergency) kept as it came. A draft may be
 * unsound — that is what the validator is for — but it always has the
 * file's types, so the validator's map and reachability checks can run.
 * Its id is no field of its own: it follows from the title (`customIdOf`).
 */

export interface Tile {
  x: number;
  y: number;
}

/** Every puzzle type that stands at a station; the relay only runs as an emergency. */
export type StationType = Exclude<PuzzleDef['type'], 'relay'>;

export const STATION_TYPES: readonly StationType[] = MODULES.flatMap((m) =>
  m.type === 'relay' ? [] : [m.type],
);

/** What a module is called: the title a new puzzle gets, and the word in the type list. */
export const MODULE_NAMES: Readonly<Record<StationType, { title: string; kind: string }>> = {
  keypad: { title: 'Tastenfeld', kind: 'Tastenfeld' },
  wiring: { title: 'Notstrom-Brücken', kind: 'Kabel' },
  switches: { title: 'Subsysteme', kind: 'Schalter' },
  simon: { title: 'Frequenz-Abgleich', kind: 'Farbfolge' },
  maze: { title: 'Leitungsnetz', kind: 'Labyrinth' },
  memory: { title: 'Speicherbank', kind: 'Speicher' },
  morse: { title: 'Funkfeuer', kind: 'Morse' },
  button: { title: 'Der Knopf', kind: 'Knopf' },
  signal: { title: 'Signalkette', kind: 'Signalkette' },
  circuit: { title: 'Sicherungskasten', kind: 'Sicherungskasten' },
  'button-sync': { title: 'Synchronschaltung', kind: 'Synchronschaltung' },
};

/** What a source is called in the editor, and the label a new one carries in the lab. */
export const SOURCE_NAMES: Readonly<Record<ManualKind, { name: string; label: string }>> = {
  book: { name: 'Buch', label: 'HANDBUCH' },
  terminal: { name: 'Terminal', label: 'TERMINAL' },
  chart: { name: 'Wandtafel', label: 'WANDTAFEL' },
  clipboard: { name: 'Klemmbrett', label: 'KLEMMBRETT' },
  locker: { name: 'Spind', label: 'SPIND' },
  cabinet: { name: 'Aktenschrank', label: 'AKTENSCHRANK' },
};

export interface DraftPuzzle {
  type: StationType;
  id: string;
  title: string;
  /** up to three; empty ones are left out of the file */
  hints: string[];
  lights: string[];
  /** '' for none */
  onSolved: string;
  /** penaltySec and the module's own fields (wires, stages, …), as they came */
  extra: Record<string, unknown>;
}

export type DoorOpens =
  /** untilSolved: '' for none */
  | { kind: 'plate'; plateId: string; untilSolved: string }
  | { kind: 'puzzle'; puzzleId: string };

export interface DraftDoor {
  id: string;
  x: number;
  y: number;
  opensBy: DoorOpens;
}

export interface DraftPlate {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface DraftStation {
  puzzleId: string;
  x: number;
  y: number;
  console?: 'a' | 'b';
}

export interface DraftLabel {
  text: string;
  x: number;
  y: number;
}

/** A manual object, „Quelle" in the editor: where a puzzle's rules lie. */
export interface DraftSource {
  id: string;
  kind: ManualKind;
  label: string;
  puzzleIds: string[];
  spots: Tile[];
  /** a cabinet's key, an item id; '' for none */
  needsKey: string;
}

export interface DraftItem {
  id: string;
  label: string;
  x: number;
  y: number;
  deliverTo?: Tile;
  /** a puzzle id; '' for none */
  requiredFor: string;
}

export interface DraftDrone {
  id: string;
  waypoints: Tile[];
  /** speed, range, cone, penalty, when it starts, its plate: as they came */
  extra: Record<string, unknown>;
}

export interface DraftPanel {
  id: string;
  x: number;
  y: number;
}

/** The emergency: part 1 shows its valve panels and keeps the rest as it came. */
export interface DraftSabotage {
  panels: DraftPanel[];
  extra: Record<string, unknown>;
}

export interface DraftMap {
  /** '#' wall, '.' floor, ' ' void; all rows equally long */
  tiles: string[];
  spawns: Tile[];
  doors: DraftDoor[];
  plates: DraftPlate[];
  stations: DraftStation[];
  labels: DraftLabel[];
  manuals: DraftSource[];
  edgeworkSign?: Tile;
  exit?: Tile;
  items: DraftItem[];
  drones: DraftDrone[];
  sabotage?: DraftSabotage;
}

export interface Draft {
  title: string;
  subtitle: string;
  players: { min: number; max: number };
  timeLimitSec: number;
  story: { intro: string; win: string; lose: string };
  /** mission control's lines; '' for none */
  radio: { start: string; escape: string };
  puzzles: DraftPuzzle[];
  map: DraftMap;
  /** listOrder, hintCostSec, hintDelaySec, maxAlarms: as they came */
  extra: Record<string, unknown>;
}

// ── ids ──────────────────────────────────────────────────────────────────

const SPELLED: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** The longest slug, so that „custom-" and the slug stay within the 64 an id may have. */
const SLUG_MAX = 48;

/**
 * Lower-case words of letters and digits joined by dashes: umlauts spelled
 * out, accents dropped, everything else a break; whole words up to 48
 * characters. '' where the text has no letter or digit.
 */
export function slugOf(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[äöüß]/g, (ch) => SPELLED[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
  let slug = '';
  for (const word of words) {
    const longer = slug === '' ? word : `${slug}-${word}`;
    if (longer.length > SLUG_MAX) {
      break;
    }
    slug = longer;
  }
  return slug === '' ? (words[0] ?? '').slice(0, SLUG_MAX) : slug;
}

/** The id a mission with this title is saved under: „custom-" and the title's slug. */
export function customIdOf(title: string): string {
  return `custom-${slugOf(title) || 'mission'}`;
}

/** `base` if nobody has it yet, else the first of base-2, base-3, … that is free. */
export function freeId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) {
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}

// ── new drafts ───────────────────────────────────────────────────────────

/** A new puzzle of a type: named after its module, every field of its own at the default. */
export function newPuzzle(type: StationType, taken: Iterable<string>): DraftPuzzle {
  const { title } = MODULE_NAMES[type];
  return {
    type,
    id: freeId(slugOf(title), taken),
    title,
    hints: [],
    lights: [],
    onSolved: '',
    extra: {},
  };
}

/** The size of a new lab, in tiles: all wall, to be carved out with the floor brush. */
export const NEW_MAP = { width: 20, height: 13 } as const;

/** A blank lab with one keypad to place, for two players and ten minutes. */
export function newDraft(): Draft {
  return {
    title: 'Neue Mission',
    subtitle: '',
    players: { min: 2, max: 2 },
    timeLimitSec: 600,
    story: { intro: '', win: '', lose: '' },
    radio: { start: '', escape: '' },
    puzzles: [newPuzzle('keypad', [])],
    map: {
      tiles: Array.from({ length: NEW_MAP.height }, () => '#'.repeat(NEW_MAP.width)),
      spawns: [],
      doors: [],
      plates: [],
      stations: [],
      labels: [],
      manuals: [],
      items: [],
      drones: [],
    },
    extra: {},
  };
}

/** A shipped mission as the start of a new one: the same, under a title of its own. */
export function copyOf(draft: Draft): Draft {
  return { ...draft, title: `${draft.title} (Kopie)` };
}

/** Whether a puzzle of this type is worked at two consoles. */
export function twoConsoles(type: StationType): boolean {
  return moduleFor(type).consoles === 2;
}

// ── draft → file ─────────────────────────────────────────────────────────

/** `{ [key]: value }` where the value says something, `{}` where it is '' or missing. */
function given<K extends string, V>(key: K, value: V | '' | undefined): { [P in K]?: V } {
  return value === '' || value === undefined ? {} : ({ [key]: value } as { [P in K]: V });
}

function puzzleJson(puzzle: DraftPuzzle): Record<string, unknown> {
  return {
    type: puzzle.type,
    id: puzzle.id,
    title: puzzle.title,
    ...puzzle.extra,
    hints: puzzle.hints.filter((hint) => hint.trim() !== ''),
    lights: [...puzzle.lights],
    ...given('onSolved', puzzle.onSolved),
  };
}

function opensJson(opens: DoorOpens): Record<string, unknown> {
  return opens.kind === 'puzzle'
    ? { kind: 'puzzle', puzzleId: opens.puzzleId }
    : { kind: 'plate', plateId: opens.plateId, ...given('untilSolved', opens.untilSolved) };
}

const tileJson = ({ x, y }: Tile): Tile => ({ x, y });

function mapJson(map: DraftMap): Record<string, unknown> {
  return {
    tiles: [...map.tiles],
    spawns: map.spawns.map(tileJson),
    doors: map.doors.map((d) => ({ id: d.id, x: d.x, y: d.y, opensBy: opensJson(d.opensBy) })),
    plates: map.plates.map((p) => ({ ...p })),
    stations: map.stations.map((s) => ({
      puzzleId: s.puzzleId,
      x: s.x,
      y: s.y,
      ...given('console', s.console),
    })),
    labels: map.labels.map((l) => ({ ...l })),
    manuals: map.manuals.map((m) => ({
      id: m.id,
      kind: m.kind,
      label: m.label,
      puzzleIds: [...m.puzzleIds],
      spots: m.spots.map(tileJson),
      ...given('needsKey', m.needsKey),
    })),
    ...given('edgeworkSign', map.edgeworkSign),
    ...given('exit', map.exit),
    items: map.items.map((i) => ({
      id: i.id,
      label: i.label,
      x: i.x,
      y: i.y,
      ...given('deliverTo', i.deliverTo),
      ...given('requiredFor', i.requiredFor),
    })),
    drones: map.drones.map((d) => ({ id: d.id, waypoints: d.waypoints.map(tileJson), ...d.extra })),
    ...(map.sabotage === undefined ? {} : { sabotage: sabotageJson(map.sabotage) }),
  };
}

function sabotageJson(sabotage: DraftSabotage): Record<string, unknown> {
  return { ...sabotage.extra, panels: sabotage.panels.map((p) => ({ ...p })) };
}

/** The mission file the draft stands for: what is saved, exported and validated. */
export function draftToJson(draft: Draft): Record<string, unknown> {
  return {
    id: customIdOf(draft.title),
    title: draft.title,
    subtitle: draft.subtitle,
    ...draft.extra,
    players: { ...draft.players },
    story: { ...draft.story },
    timeLimitSec: draft.timeLimitSec,
    radio: { ...given('start', draft.radio.start), ...given('escape', draft.radio.escape) },
    puzzles: draft.puzzles.map(puzzleJson),
    map: mapJson(draft.map),
  };
}

// ── file → draft ─────────────────────────────────────────────────────────

/**
 * A mission file as the format allows it, with the types right but maybe
 * unsound: defaults left out, references dangling, numbers out of range.
 * Optional fields may be undefined, as zod's own output types have them.
 */
interface LooseTile {
  x: number;
  y: number;
}

interface LoosePuzzle {
  type: string;
  id: string;
  title: string;
  hints?: string[] | undefined;
  lights?: string[] | undefined;
  onSolved?: string | undefined;
}

interface LooseMap {
  tiles: string[];
  spawns: LooseTile[];
  doors?:
    | {
        id: string;
        x: number;
        y: number;
        opensBy:
          | { kind: 'plate'; plateId: string; untilSolved?: string | undefined }
          | { kind: 'puzzle'; puzzleId: string };
      }[]
    | undefined;
  plates?: { id: string; x: number; y: number; label?: string | undefined }[] | undefined;
  stations: { puzzleId: string; x: number; y: number; console?: 'a' | 'b' | undefined }[];
  labels?: { text: string; x: number; y: number }[] | undefined;
  manuals?:
    | {
        id: string;
        kind: ManualKind;
        label: string;
        puzzleIds: string[];
        spots: LooseTile[];
        needsKey?: string | undefined;
      }[]
    | undefined;
  edgeworkSign?: LooseTile | undefined;
  exit?: LooseTile | undefined;
  items?:
    | {
        id: string;
        label: string;
        x: number;
        y: number;
        deliverTo?: LooseTile | undefined;
        requiredFor?: string | undefined;
      }[]
    | undefined;
  drones?: { id: string; waypoints: LooseTile[] }[] | undefined;
  sabotage?: { panels?: { id: string; x: number; y: number }[] | undefined } | undefined;
}

interface LooseMission {
  title: string;
  subtitle?: string | undefined;
  players: { min: number; max: number };
  timeLimitSec: number;
  story: { intro: string; win: string; lose: string };
  radio?: { start?: string | undefined; escape?: string | undefined } | undefined;
  puzzles: LoosePuzzle[];
  map: LooseMap;
}

/** The fields of `object` the editor does not know by name, to be kept as they came. */
function extraOf(object: object, known: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !known.includes(key)));
}

const tile = ({ x, y }: LooseTile): Tile => ({ x, y });

function puzzleOf(puzzle: LoosePuzzle): DraftPuzzle {
  return {
    // A relay never gets here: draftFromJson turns a file with one away.
    type: puzzle.type as StationType,
    id: puzzle.id,
    title: puzzle.title,
    hints: [...(puzzle.hints ?? [])],
    lights: [...(puzzle.lights ?? [])],
    onSolved: puzzle.onSolved ?? '',
    extra: extraOf(puzzle, ['type', 'id', 'title', 'hints', 'lights', 'onSolved']),
  };
}

function doorOf(door: NonNullable<LooseMap['doors']>[number]): DraftDoor {
  const { opensBy } = door;
  return {
    id: door.id,
    x: door.x,
    y: door.y,
    opensBy:
      opensBy.kind === 'puzzle'
        ? { kind: 'puzzle', puzzleId: opensBy.puzzleId }
        : { kind: 'plate', plateId: opensBy.plateId, untilSolved: opensBy.untilSolved ?? '' },
  };
}

function itemOf(item: NonNullable<LooseMap['items']>[number]): DraftItem {
  return {
    id: item.id,
    label: item.label,
    x: item.x,
    y: item.y,
    ...(item.deliverTo === undefined ? {} : { deliverTo: tile(item.deliverTo) }),
    requiredFor: item.requiredFor ?? '',
  };
}

function sabotageOf(sabotage: NonNullable<LooseMap['sabotage']>): DraftSabotage {
  return {
    panels: (sabotage.panels ?? []).map((p) => ({ id: p.id, x: p.x, y: p.y })),
    extra: extraOf(sabotage, ['panels']),
  };
}

function sourceOf(source: NonNullable<LooseMap['manuals']>[number]): DraftSource {
  return {
    id: source.id,
    kind: source.kind,
    label: source.label,
    puzzleIds: [...source.puzzleIds],
    spots: source.spots.map(tile),
    needsKey: source.needsKey ?? '',
  };
}

function stationOf(station: LooseMap['stations'][number]): DraftStation {
  const { puzzleId, x, y } = station;
  return station.console === undefined
    ? { puzzleId, x, y }
    : { puzzleId, x, y, console: station.console };
}

/** The lists a mission file may leave out, there in the draft even when empty. */
type DraftLists = Pick<DraftMap, 'doors' | 'plates' | 'labels' | 'manuals' | 'items' | 'drones'>;

function listsOf(map: LooseMap): DraftLists {
  return {
    doors: (map.doors ?? []).map(doorOf),
    plates: (map.plates ?? []).map((p) => ({ id: p.id, x: p.x, y: p.y, label: p.label ?? '' })),
    labels: (map.labels ?? []).map((l) => ({ text: l.text, x: l.x, y: l.y })),
    manuals: (map.manuals ?? []).map(sourceOf),
    items: (map.items ?? []).map(itemOf),
    drones: (map.drones ?? []).map((d) => ({
      id: d.id,
      waypoints: d.waypoints.map(tile),
      extra: extraOf(d, ['id', 'waypoints']),
    })),
  };
}

function mapOf(map: LooseMap): DraftMap {
  return {
    tiles: [...map.tiles],
    spawns: map.spawns.map(tile),
    stations: map.stations.map(stationOf),
    ...listsOf(map),
    ...(map.edgeworkSign === undefined ? {} : { edgeworkSign: tile(map.edgeworkSign) }),
    ...(map.exit === undefined ? {} : { exit: tile(map.exit) }),
    ...(map.sabotage === undefined ? {} : { sabotage: sabotageOf(map.sabotage) }),
  };
}

function draftOf(mission: LooseMission): Draft {
  return {
    title: mission.title,
    subtitle: mission.subtitle ?? '',
    players: { min: mission.players.min, max: mission.players.max },
    timeLimitSec: mission.timeLimitSec,
    story: { intro: mission.story.intro, win: mission.story.win, lose: mission.story.lose },
    radio: { start: mission.radio?.start ?? '', escape: mission.radio?.escape ?? '' },
    puzzles: mission.puzzles.map(puzzleOf),
    map: mapOf(mission.map),
    extra: extraOf(mission, [
      'id',
      'title',
      'subtitle',
      'players',
      'timeLimitSec',
      'story',
      'radio',
      'puzzles',
      'map',
    ]),
  };
}

/**
 * Issues that say the data has the wrong shape, not just unsound values: a
 * draft cannot be made from such a file. Lengths, ranges, unknown keys and
 * the map rules (`custom`) are left to the validator.
 */
const SHAPE_ISSUES: ReadonlySet<string> = new Set([
  'invalid_type',
  'invalid_union',
  'invalid_value',
  'invalid_key',
  'invalid_element',
]);

/** A mission file read into the editor, or why it cannot be. */
export type Loaded = { ok: true; draft: Draft } | { ok: false; problems: string[] };

/**
 * A draft from a mission file — a shipped one, one from the server, or an
 * export that was still unsound when it was saved. Turns away what is no
 * mission file at all: anything with a field of the wrong type, a module
 * the game does not know, or a relay at a station.
 */
export function draftFromJson(data: unknown): Loaded {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, problems: ['Die Datei enthält kein Missionsobjekt.'] };
  }
  const parsed = missionSchema.safeParse(data);
  if (parsed.success) {
    return { ok: true, draft: draftOf(parsed.data) };
  }
  const problems = parsed.error.issues
    .filter((issue) => SHAPE_ISSUES.has(issue.code))
    .map((issue) => `${issue.path.map(String).join('.') || '(Wurzel)'}: ${issue.message}`);
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  // The shape holds, so this is a LooseMission: zod named every field of the wrong type.
  const mission = data as LooseMission;
  const relays = mission.puzzles.filter((p) => p.type === 'relay');
  if (relays.length > 0) {
    const ids = relays.map((p) => `„${p.id}“`).join(', ');
    return { ok: false, problems: [`Rätsel ${ids}: relay ist ein Notfall, keine Station.`] };
  }
  return { ok: true, draft: draftOf(mission) };
}
