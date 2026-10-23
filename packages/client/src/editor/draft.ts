import {
  MODULES,
  missionSchema,
  moduleFor,
  type DecorKind,
  type FieldSpec,
  type ManualKind,
  type PuzzleDef,
  type RoomKind,
} from '@escapelab/core';

/**
 * The mission the editor works on. It holds what the mission file holds, in
 * a shape that is easy to edit: every list there even where the file may
 * leave it out, optional words as '' where the file leaves them out, every
 * field a puzzle's module lists (`fields`), and what the editor does not
 * show (a drone's speed, the emergency, the cost of notes) kept as it came.
 * A draft may be unsound — that is what the validator is for — but it
 * always has the file's types, so the validator's map and reachability
 * checks can run. Its id is no field of its own: it follows from the title
 * (`customIdOf`).
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
  servers: { title: 'Serverraum', kind: 'Serverraum' },
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

/** What each kind of room is called in the editor. */
export const ROOM_KIND_NAMES: Readonly<Record<RoomKind, string>> = {
  archive: 'Archiv',
  corridor: 'Flur',
  machine: 'Maschinenraum',
  server: 'Serverraum',
  lab: 'Labor',
  reactor: 'Reaktor',
  control: 'Leitstand',
};

/** What each piece of furniture is called in the editor. */
export const DECOR_NAMES: Readonly<Record<DecorKind, string>> = {
  shelf: 'Regal',
  cart: 'Aktenwagen',
  bench: 'Labortisch',
  hood: 'Abzug',
  rack: 'Serverschrank',
  generator: 'Generator',
  pipes: 'Rohrleitung',
  barrel: 'Fass',
  core: 'Reaktorkern',
  cables: 'Kabelstrang',
  desk: 'Schaltpult',
};

export interface DraftPuzzle {
  type: StationType;
  id: string;
  title: string;
  /** up to three; empty ones are left out of the file */
  hints: string[];
  /**
   * mission control's lines for a station left quiet, up to two; the form shows none, and
   * the file keeps what it had
   */
  nudges: string[];
  lights: string[];
  /** '' for none */
  onSolved: string;
  /** what a wrong move costs, in seconds; null for the module's own default */
  penaltySec: number | null;
  /**
   * the module's own fields (wires, stages, …) by key, exactly those its
   * module lists; an empty field that can be off holds null
   */
  fields: Record<string, unknown>;
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
  /** the kind of room it names; '' for a plain one */
  kind: RoomKind | '';
}

/** A piece of furniture: solid, on a floor tile of its own. */
export interface DraftDecor {
  kind: DecorKind;
  x: number;
  y: number;
  /** its look, 0 to 3; null leaves it to the tile */
  variant: number | null;
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

/** A note of the last crew: on a wall beside the floor, or on the floor; free to read. */
export interface DraftNote {
  x: number;
  y: number;
  text: string;
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
  decor: DraftDecor[];
  manuals: DraftSource[];
  notes: DraftNote[];
  edgeworkSign?: Tile;
  exit?: Tile;
  items: DraftItem[];
  drones: DraftDrone[];
  sabotage?: DraftSabotage;
  /** emergency lamps, kept as they came: the editor places none */
  lamps?: Tile[];
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

// ── a module's own fields ────────────────────────────────────────────────

/** The fields a module lists for its puzzles, in the order its form shows them. */
export function fieldSpecs(type: StationType): readonly FieldSpec[] {
  return moduleFor(type).fields;
}

/** Every field of a module's own at its default: what a new puzzle of the type starts with. */
export function defaultFields(type: StationType): Record<string, unknown> {
  return Object.fromEntries(
    fieldSpecs(type).map((spec) => [spec.key, structuredClone(spec.default)]),
  );
}

/** What a wrong move costs at a puzzle of this type whose file names no penaltySec. */
export function defaultPenalty(type: StationType): number {
  return moduleFor(type).defSchema.parse({ type, id: type, title: type }).penaltySec;
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
    nudges: [],
    lights: [],
    onSolved: '',
    penaltySec: null,
    fields: defaultFields(type),
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
      decor: [],
      manuals: [],
      notes: [],
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

/**
 * A puzzle's own fields as the file has them: those `specs` list, nothing
 * else. An empty field that can be off is written the way its module says,
 * as null or as no key at all.
 */
export function fieldsToJson(
  specs: readonly FieldSpec[],
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  for (const spec of specs) {
    const value = fields[spec.key];
    if (value === undefined || (value === null && spec.kind === 'int' && spec.off === 'omit')) {
      continue;
    }
    json[spec.key] = structuredClone(value);
  }
  return json;
}

function puzzleJson(puzzle: DraftPuzzle): Record<string, unknown> {
  return {
    type: puzzle.type,
    id: puzzle.id,
    title: puzzle.title,
    ...fieldsToJson(fieldSpecs(puzzle.type), puzzle.fields),
    ...(puzzle.penaltySec === null ? {} : { penaltySec: puzzle.penaltySec }),
    hints: puzzle.hints.filter((hint) => hint.trim() !== ''),
    ...(puzzle.nudges.length === 0 ? {} : { nudges: [...puzzle.nudges] }),
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
    labels: map.labels.map((l) => ({ text: l.text, x: l.x, y: l.y, ...given('kind', l.kind) })),
    decor: map.decor.map((d) => ({
      kind: d.kind,
      x: d.x,
      y: d.y,
      ...(d.variant === null ? {} : { variant: d.variant }),
    })),
    manuals: map.manuals.map((m) => ({
      id: m.id,
      kind: m.kind,
      label: m.label,
      puzzleIds: [...m.puzzleIds],
      spots: m.spots.map(tileJson),
      ...given('needsKey', m.needsKey),
    })),
    ...(map.notes.length === 0
      ? {}
      : { notes: map.notes.map((n) => ({ x: n.x, y: n.y, text: n.text })) }),
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
    ...(map.lamps === undefined ? {} : { lamps: map.lamps.map(tileJson) }),
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
  /** the module's own fields, and whatever else the file may hold */
  [key: string]: unknown;
  type: string;
  id: string;
  title: string;
  hints?: string[] | undefined;
  nudges?: string[] | undefined;
  lights?: string[] | undefined;
  onSolved?: string | undefined;
  penaltySec?: number | undefined;
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
  labels?: { text: string; x: number; y: number; kind?: RoomKind | undefined }[] | undefined;
  decor?: { kind: DecorKind; x: number; y: number; variant?: number | undefined }[] | undefined;
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
  notes?: { x: number; y: number; text: string }[] | undefined;
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
  lamps?: LooseTile[] | undefined;
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

/** The keys every puzzle has besides its module's own: the puzzle form's common inputs. */
const COMMON_KEYS: ReadonlySet<string> = new Set([
  'type',
  'id',
  'title',
  'hints',
  'nudges',
  'lights',
  'onSolved',
  'penaltySec',
]);

/** What a file without the key says: off for a field that can be off, else its default. */
function missingValue(spec: FieldSpec): unknown {
  return spec.kind === 'int' && spec.off !== undefined ? null : structuredClone(spec.default);
}

/**
 * A puzzle's own fields from its file: every one `specs` list, those the
 * file leaves out as it means them — off where a field can be off, else
 * the default the schema fills in too.
 */
export function fieldsFromJson(
  specs: readonly FieldSpec[],
  puzzle: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    specs.map((spec) => {
      const value = puzzle[spec.key];
      return [spec.key, value === undefined ? missingValue(spec) : structuredClone(value)];
    }),
  );
}

/** The keys of a station's puzzle that neither every puzzle nor its module knows. */
function strangeKeys(puzzle: LoosePuzzle, type: StationType): string[] {
  const own = new Set(fieldSpecs(type).map((spec) => spec.key));
  return Object.keys(puzzle).filter((key) => !COMMON_KEYS.has(key) && !own.has(key));
}

/** A station's type; a relay never gets here, draftFromJson turns a file with one away. */
const stationType = (puzzle: LoosePuzzle): StationType => puzzle.type as StationType;

function puzzleOf(puzzle: LoosePuzzle): DraftPuzzle {
  const type = stationType(puzzle);
  return {
    type,
    id: puzzle.id,
    title: puzzle.title,
    hints: [...(puzzle.hints ?? [])],
    nudges: [...(puzzle.nudges ?? [])],
    lights: [...(puzzle.lights ?? [])],
    onSolved: puzzle.onSolved ?? '',
    penaltySec: puzzle.penaltySec ?? null,
    fields: fieldsFromJson(fieldSpecs(type), puzzle),
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
type DraftLists = Pick<
  DraftMap,
  'doors' | 'plates' | 'labels' | 'decor' | 'manuals' | 'notes' | 'items' | 'drones'
>;

function listsOf(map: LooseMap): DraftLists {
  return {
    doors: (map.doors ?? []).map(doorOf),
    plates: (map.plates ?? []).map((p) => ({ id: p.id, x: p.x, y: p.y, label: p.label ?? '' })),
    labels: (map.labels ?? []).map((l) => ({ text: l.text, x: l.x, y: l.y, kind: l.kind ?? '' })),
    decor: (map.decor ?? []).map((d) => ({
      kind: d.kind,
      x: d.x,
      y: d.y,
      variant: d.variant ?? null,
    })),
    manuals: (map.manuals ?? []).map(sourceOf),
    notes: (map.notes ?? []).map((n) => ({ x: n.x, y: n.y, text: n.text })),
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
    ...(map.lamps === undefined || map.lamps.length === 0 ? {} : { lamps: map.lamps.map(tile) }),
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
 * A draft from a mission file — a shipped one, one from the server, a
 * shared link, or an export that was still unsound when it was saved. What
 * the file leaves out reads as the schema means it: a module's own field at
 * its default (or off, where it can be), no penaltySec as the module's own.
 * Turns away what is no mission file at all: anything with a field of the
 * wrong type, a module the game does not know, a relay at a station, or a
 * puzzle field neither every puzzle nor its module knows — the draft could
 * not keep it.
 */
export function draftFromJson(data: unknown): Loaded {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, problems: ['Die Datei enthält kein Missionsobjekt.'] };
  }
  const parsed = missionSchema.safeParse(data);
  const problems = parsed.success
    ? []
    : parsed.error.issues
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
  const strangers = mission.puzzles.flatMap((p) =>
    strangeKeys(p, stationType(p)).map((key) => `Rätsel „${p.id}“: unbekanntes Feld „${key}“.`),
  );
  if (strangers.length > 0) {
    return { ok: false, problems: strangers };
  }
  return { ok: true, draft: draftOf(mission) };
}
