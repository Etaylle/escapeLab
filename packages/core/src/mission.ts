import { z } from 'zod';
import { moduleFor, puzzleDefSchema, type PuzzleDef } from './puzzles/index.js';
import { RELAY_MAX_PLAYERS } from './puzzles/relay.js';
import { canGather, canStandAt, crewsOf, reachability, tileKey, type Spot } from './reach.js';

/**
 * Mission format: a mission is pure data (JSON), validated by these schemas.
 * The platform promise is that new missions require no code changes. The
 * puzzle shapes come from the modules in ./puzzles/.
 */

const coord = z.number().int().nonnegative();
const tile = z.object({ x: coord, y: coord });

export const MANUAL_KINDS = [
  'book',
  'terminal',
  'chart',
  'clipboard',
  'locker',
  'cabinet',
] as const;
export type ManualKind = (typeof MANUAL_KINDS)[number];

/** A locker has to be searched and a cabinet unlocked before either can be read. */
export function startsClosed(kind: ManualKind): boolean {
  return kind === 'locker' || kind === 'cabinet';
}

/**
 * The tile map: players walk a grid, puzzle stations must be activated in
 * mission order, plate doors stay open only while someone stands on the
 * plate, puzzle doors open permanently once solved.
 * Tiles: '#' wall, '.' floor, ' ' void.
 */
export const mapDefSchema = z.object({
  tiles: z.array(z.string().min(1)).min(3),
  /** start tiles: every run draws one for each player, so there is one per player at least */
  spawns: z.array(tile).min(2),
  doors: z
    .array(
      z.object({
        id: z.string().min(1),
        x: coord,
        y: coord,
        opensBy: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('plate'), plateId: z.string().min(1) }),
          z.object({ kind: z.literal('puzzle'), puzzleId: z.string().min(1) }),
        ]),
      }),
    )
    .default([]),
  plates: z
    .array(z.object({ id: z.string().min(1), x: coord, y: coord, label: z.string().default('') }))
    .default([]),
  stations: z.array(z.object({ puzzleId: z.string().min(1), x: coord, y: coord })).min(1),
  labels: z.array(z.object({ text: z.string().min(1), x: coord, y: coord })).default([]),
  /**
   * Where the printed rules lie — a book, a terminal, a wall chart, a
   * clipboard, or a locker or cabinet that has to be opened first: whoever
   * stands at an open one reads the rules of every puzzle it covers. Each
   * run draws one of its spots to put it on. Every puzzle needs one, except
   * where the whole crew works the panel.
   */
  manuals: z
    .array(
      z.object({
        id: z.string().min(1),
        kind: z.enum(MANUAL_KINDS),
        label: z.string().min(1),
        puzzleIds: z.array(z.string().min(1)).min(1),
        spots: z.array(tile).min(1),
        /** a cabinet's key: the item somebody has to carry to it */
        needsKey: z.string().min(1).optional(),
      }),
    )
    .default([]),
  /** The Laborkennung on a wall: whoever walks up to it keeps the edgework for the run. */
  edgeworkSign: tile.optional(),
  /**
   * Escape hatch: once every puzzle is solved it opens, and ALL connected
   * players must gather there (while the clock still runs) to win. Without
   * an exit the mission is won with the last puzzle.
   */
  exit: tile.optional(),
  /**
   * Recurring emergency that interrupts whatever the crew was doing. In
   * `valves` mode every panel must be manned at the same time, by a
   * different player each, before the timer runs out. In `relay` mode there
   * are no panels: every player gets a console and reads out instructions
   * for the others' consoles (puzzles/relay.ts).
   */
  sabotage: z
    .object({
      mode: z.enum(['valves', 'relay']).default('valves'),
      label: z.string().min(1),
      hint: z.string().default(''),
      firstAfterSec: z.number().int().positive().default(90),
      everySec: z.number().int().positive().default(150),
      durationSec: z.number().int().positive().default(45),
      penaltySec: z.number().int().positive().default(60),
      /** relay: seconds an instruction waits for its owner */
      windowSec: z.number().int().positive().default(12),
      /** relay: completed instructions that clear it; three per player when left out */
      required: z.number().int().positive().optional(),
      /** valves: two at least, each manned by a different player */
      panels: z.array(z.object({ id: z.string().min(1), x: coord, y: coord })).default([]),
    })
    .optional(),
  /**
   * Objects that have to be carried across the lab by hand. A station whose
   * puzzle is named in `requiredFor` stays inert until its item arrives; a
   * cabinet's key has no drop-off of its own, it goes into that cabinet.
   */
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        x: coord,
        y: coord,
        deliverTo: tile.optional(),
        requiredFor: z.string().min(1).optional(),
      }),
    )
    .default([]),
  /** Security drones patrolling their waypoint loop; their cone costs time. */
  drones: z
    .array(
      z.object({
        id: z.string().min(1),
        waypoints: z.array(tile).min(2),
        /** tiles per second */
        speed: z.number().positive().max(6).default(1.5),
        /** how far the cone reaches, in tiles */
        range: z.number().positive().max(12).default(4.5),
        /** half opening angle of the cone, in degrees */
        halfAngleDeg: z.number().positive().max(90).default(30),
        penaltySec: z.number().int().positive().default(15),
        /** puzzles the crew must have solved before it starts patrolling */
        activeAfterSolved: z.number().int().nonnegative().default(0),
        /** a plate id: while that plate is held, the drone neither moves nor sees */
        frozenByPlate: z.string().min(1).optional(),
      }),
    )
    .default([]),
});

export const missionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    /** one-line teaser for the mission picker */
    subtitle: z.string().default(''),
    /** sort key in the mission picker, ascending */
    listOrder: z.number().int().default(50),
    /** how many play it: a run starts with any count from min to max */
    players: z.object({
      min: z.number().int().min(2).max(4),
      /** every player gets a relay console, and the control names last for this many */
      max: z.number().int().min(2).max(RELAY_MAX_PLAYERS),
    }),
    story: z.object({
      intro: z.string(),
      win: z.string(),
      lose: z.string(),
    }),
    timeLimitSec: z.number().int().positive(),
    /** seconds every note of the last crew takes off the clock */
    hintCostSec: z.number().int().positive().default(20),
    /** seconds at an open puzzle before the first or next note may be asked for */
    hintDelaySec: z.number().int().positive().default(45),
    /** mission control's lines for the start of the run and the unlocked exit */
    radio: z
      .object({
        start: z.string().min(1).optional(),
        escape: z.string().min(1).optional(),
      })
      .default({}),
    puzzles: z.array(puzzleDefSchema).min(1),
    map: mapDefSchema,
  })
  .superRefine((mission, ctx) => {
    if (mission.players.min > mission.players.max) {
      ctx.addIssue({ code: 'custom', message: 'players: min must not be above max' });
    }
    for (const puzzle of mission.puzzles) {
      if (puzzle.type === 'relay') {
        ctx.addIssue({
          code: 'custom',
          message:
            `puzzle "${puzzle.id}": relay is an emergency, not a station — ` +
            'set map.sabotage.mode to "relay" instead',
        });
      }
    }
    validateMap(mission, ctx);
  });

/** What every map check gets: the map, the mission's puzzles and a way to report. */
interface MapCheck {
  map: MapDef;
  puzzleIds: Set<string>;
  issue: (message: string) => void;
  floor: (x: number, y: number) => boolean;
  requireFloor: (what: string, x: number, y: number) => void;
}

type Crew = { min: number; max: number };
type MissionParts = { players: Crew; puzzles: PuzzleDef[]; map: MapDef };

function validateMap(mission: MissionParts, ctx: z.RefinementCtx): void {
  const map = mission.map;
  const issue = (message: string): void => ctx.addIssue({ code: 'custom', message });
  const width = map.tiles[0]?.length ?? 0;
  if (map.tiles.some((row) => row.length !== width)) {
    issue('map: all tile rows must have the same length');
    return;
  }
  const floor = (x: number, y: number): boolean => map.tiles[y]?.charAt(x) === '.';
  const check: MapCheck = {
    map,
    puzzleIds: new Set(mission.puzzles.map((p) => p.id)),
    issue,
    floor,
    requireFloor: (what, x, y) => {
      if (!floor(x, y)) {
        issue(`map: ${what} at ${x},${y} is not on a floor tile`);
      }
    },
  };
  checkSpawns(check, mission.players.max);
  if (map.exit !== undefined) {
    check.requireFloor('exit', map.exit.x, map.exit.y);
  }
  checkStations(check);
  checkPlates(check);
  checkDoors(check);
  checkSabotage(check, mission.players.min);
  checkItems(check);
  checkDrones(check, mission.puzzles.length);
  const stations = mission.puzzles.filter((p) => p.type !== 'relay');
  checkLights(check, stations);
  checkManuals(check, stations);
  checkSpots(check);
  checkKeys(check);
  checkSign(check, stations);
  checkSolvable(check, mission.players, stations);
}

function checkSpawns({ map, issue, requireFloor }: MapCheck, maxPlayers: number): void {
  if (map.spawns.length < maxPlayers) {
    issue(`map: ${map.spawns.length} spawns for up to ${maxPlayers} players — each needs one`);
  }
  for (const spawn of map.spawns) {
    requireFloor('spawn', spawn.x, spawn.y);
  }
}

function checkStations({ map, puzzleIds, issue, requireFloor }: MapCheck): void {
  const stationIds = map.stations.map((s) => s.puzzleId);
  if (new Set(stationIds).size !== stationIds.length) {
    issue('map: duplicate station for a puzzle');
  }
  for (const id of puzzleIds) {
    if (!stationIds.includes(id)) {
      issue(`map: no station for puzzle "${id}"`);
    }
  }
  for (const station of map.stations) {
    if (!puzzleIds.has(station.puzzleId)) {
      issue(`map: station references unknown puzzle "${station.puzzleId}"`);
    }
    requireFloor(`station "${station.puzzleId}"`, station.x, station.y);
  }
}

function checkPlates({ map, issue, requireFloor }: MapCheck): void {
  if (new Set(map.plates.map((p) => p.id)).size !== map.plates.length) {
    issue('map: plate ids must be unique');
  }
  for (const plate of map.plates) {
    requireFloor(`plate "${plate.id}"`, plate.x, plate.y);
  }
}

function checkDoors({ map, puzzleIds, issue, requireFloor }: MapCheck): void {
  const plateIds = new Set(map.plates.map((p) => p.id));
  const doorIds = new Set(map.doors.map((d) => d.id));
  if (doorIds.size !== map.doors.length) {
    issue('map: door ids must be unique');
  }
  for (const door of map.doors) {
    requireFloor(`door "${door.id}"`, door.x, door.y);
    if (door.opensBy.kind === 'plate' && !plateIds.has(door.opensBy.plateId)) {
      issue(`map: door "${door.id}" references unknown plate "${door.opensBy.plateId}"`);
    }
    if (door.opensBy.kind === 'puzzle' && !puzzleIds.has(door.opensBy.puzzleId)) {
      issue(`map: door "${door.id}" references unknown puzzle "${door.opensBy.puzzleId}"`);
    }
  }
}

function checkSabotage({ map, issue, requireFloor }: MapCheck, minPlayers: number): void {
  if (map.sabotage === undefined) {
    return;
  }
  const panelIds = new Set(map.sabotage.panels.map((p) => p.id));
  if (panelIds.size !== map.sabotage.panels.length) {
    issue('map: sabotage panel ids must be unique');
  }
  if (map.sabotage.panels.length > minPlayers) {
    issue('map: more sabotage panels than the smallest crew has players — nobody could clear it');
  }
  for (const panel of map.sabotage.panels) {
    requireFloor(`sabotage panel "${panel.id}"`, panel.x, panel.y);
  }
  validateEmergencyMode(map.sabotage, issue);
}

/** Every item lies on the floor and has somewhere to go: its drop-off, or its cabinet's lock. */
function checkItems({ map, puzzleIds, issue, requireFloor }: MapCheck): void {
  const itemIds = new Set(map.items.map((i) => i.id));
  if (itemIds.size !== map.items.length) {
    issue('map: item ids must be unique');
  }
  const keys = new Set(map.manuals.map((m) => m.needsKey));
  for (const item of map.items) {
    requireFloor(`item "${item.id}"`, item.x, item.y);
    if (keys.has(item.id)) {
      if (item.deliverTo !== undefined || item.requiredFor !== undefined) {
        issue(
          `map: item "${item.id}" is a key and goes into its cabinet — ` +
            'leave out deliverTo and requiredFor',
        );
      }
    } else if (item.deliverTo === undefined) {
      issue(
        `map: item "${item.id}" has no deliverTo — say where it goes, or make it a cabinet's key`,
      );
    } else {
      requireFloor(`drop-off of item "${item.id}"`, item.deliverTo.x, item.deliverTo.y);
    }
    if (item.requiredFor !== undefined && !puzzleIds.has(item.requiredFor)) {
      issue(`map: item "${item.id}" is required for unknown puzzle "${item.requiredFor}"`);
    }
  }
}

function checkDrones(check: MapCheck, puzzleCount: number): void {
  const { map, issue, requireFloor } = check;
  const droneIds = new Set(map.drones.map((d) => d.id));
  if (droneIds.size !== map.drones.length) {
    issue('map: drone ids must be unique');
  }
  const plateIds = new Set(map.plates.map((p) => p.id));
  for (const drone of map.drones) {
    if (drone.activeAfterSolved >= puzzleCount) {
      issue(`map: drone "${drone.id}": activeAfterSolved must be below the number of puzzles`);
    }
    if (drone.frozenByPlate !== undefined && !plateIds.has(drone.frozenByPlate)) {
      issue(`map: drone "${drone.id}" is frozen by unknown plate "${drone.frozenByPlate}"`);
    }
    for (const [i, point] of drone.waypoints.entries()) {
      requireFloor(`waypoint ${i} of drone "${drone.id}"`, point.x, point.y);
    }
    checkFlightPath(check, drone);
  }
}

/** Drones fly straight between waypoints, so those lines must stay indoors. */
function checkFlightPath({ issue, floor }: MapCheck, drone: MapDef['drones'][number]): void {
  for (const [i, from] of drone.waypoints.entries()) {
    const to = drone.waypoints[(i + 1) % drone.waypoints.length];
    if (to === undefined) {
      continue;
    }
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 4);
    for (let s = 1; s < steps; s++) {
      const x = Math.floor(from.x + 0.5 + ((to.x - from.x) * s) / steps);
      const y = Math.floor(from.y + 0.5 + ((to.y - from.y) * s) / steps);
      if (!floor(x, y)) {
        issue(`map: drone "${drone.id}" would fly through a wall at ${x},${y}`);
        break;
      }
    }
  }
}

/** A solved station lights rooms by the names their labels give them. */
function checkLights({ map, issue }: MapCheck, stations: PuzzleDef[]): void {
  const rooms = new Set(map.labels.map((label) => label.text));
  for (const puzzle of stations) {
    for (const room of puzzle.lights.filter((text) => !rooms.has(text))) {
      issue(`map: puzzle "${puzzle.id}" lights "${room}", but no label on the map reads so`);
    }
  }
}

/** Every puzzle somebody has to read is covered by a manual object. */
function checkManuals(check: MapCheck, stations: PuzzleDef[]): void {
  const { map, puzzleIds, issue } = check;
  const manualIds = new Set(map.manuals.map((m) => m.id));
  if (manualIds.size !== map.manuals.length) {
    issue('map: manual object ids must be unique');
  }
  for (const manual of map.manuals) {
    for (const puzzleId of manual.puzzleIds.filter((id) => !puzzleIds.has(id))) {
      issue(`map: manual object "${manual.id}" covers unknown puzzle "${puzzleId}"`);
    }
  }
  const covered = new Set(map.manuals.flatMap((m) => m.puzzleIds));
  for (const puzzle of stations) {
    if (!moduleFor(puzzle.type).wholeCrew && !covered.has(puzzle.id)) {
      issue(
        `map: no manual object covers puzzle "${puzzle.id}" — ` +
          'put its rules in a book, a terminal or a chart',
      );
    }
  }
}

/** Every spot a manual object may be drawn to lies on the floor, and no two objects share one. */
function checkSpots({ map, issue, requireFloor }: MapCheck): void {
  const drawnTo = new Map<string, string>();
  for (const manual of map.manuals) {
    for (const spot of manual.spots) {
      requireFloor(`manual object "${manual.id}"`, spot.x, spot.y);
      const other = drawnTo.get(tileKey(spot.x, spot.y));
      if (other !== undefined && other !== manual.id) {
        issue(
          `map: manual objects "${other}" and "${manual.id}" may both be drawn to ` +
            `${spot.x},${spot.y}`,
        );
      }
      drawnTo.set(tileKey(spot.x, spot.y), manual.id);
    }
  }
}

/** A cabinet is unlocked with an item of the map; nothing else takes a key, no key opens two. */
function checkKeys({ map, issue }: MapCheck): void {
  const itemIds = new Set(map.items.map((i) => i.id));
  const lockOf = new Map<string, string>();
  for (const manual of map.manuals) {
    const key = manual.needsKey;
    if (key === undefined) {
      if (manual.kind === 'cabinet') {
        issue(`map: cabinet "${manual.id}" needs a key — name an item in needsKey`);
      }
      continue;
    }
    if (manual.kind !== 'cabinet') {
      issue(`map: only a cabinet takes a key, but "${manual.id}" is a ${manual.kind}`);
    }
    if (!itemIds.has(key)) {
      issue(`map: "${manual.id}" needs unknown item "${key}" as its key`);
    }
    const other = lockOf.get(key);
    if (other !== undefined) {
      issue(`map: item "${key}" cannot unlock both "${other}" and "${manual.id}"`);
    }
    lockOf.set(key, manual.id);
  }
}

/** A rule that reads the edgework needs the sign somewhere on the map. */
function checkSign({ map, issue, requireFloor }: MapCheck, stations: PuzzleDef[]): void {
  if (map.edgeworkSign !== undefined) {
    requireFloor('edgework sign', map.edgeworkSign.x, map.edgeworkSign.y);
    return;
  }
  const readers = stations.filter((p) => moduleFor(p.type).usesEdgework).map((p) => `"${p.id}"`);
  if (readers.length > 0) {
    issue(
      `map: puzzles ${readers.join(', ')} read the edgework, but there is no edgeworkSign — ` +
        'put the Laborkennung on a wall the crew passes',
    );
  }
}

/**
 * Solvability for every crew the mission takes — any count of players from
 * min to max, starting on any choice of that many spawns — walked the way
 * the game opens doors. Reports the first crew that gets stuck.
 */
function checkSolvable(check: MapCheck, players: Crew, stations: PuzzleDef[]): void {
  if (check.map.spawns.length < players.max) {
    return;
  }
  for (const crew of crewsOf(check.map.spawns, players.min, players.max)) {
    const stuck: string[] = [];
    walkStations({ ...check, issue: (message) => stuck.push(message) }, crew, stations);
    if (stuck.length > 0) {
      const from = crew.map((spawn) => `${spawn.x},${spawn.y}`).join(' · ');
      for (const message of stuck) {
        check.issue(`${message} (crew of ${crew.length} starting at ${from})`);
      }
      return;
    }
  }
}

/**
 * One crew through the stations in mission order: each can be reached — by
 * the whole crew together where everyone presses — every spot of a manual
 * object can be reached once the first puzzle it covers is open (a
 * cabinet's with its key in hand), and the sign before the first rule that
 * reads it.
 */
function walkStations(check: MapCheck, crew: Spot[], stations: PuzzleDef[]): void {
  const firstNeed = (manual: ManualDef): string | undefined =>
    stations.find((p) => manual.puzzleIds.includes(p.id))?.id;
  const solved = new Set<string>();
  for (const puzzle of stations) {
    const reach = reachability(check.map, crew, solved);
    const station = check.map.stations.find((s) => s.puzzleId === puzzle.id);
    if (station !== undefined) {
      checkReachable(check, { crew, solved, reach }, puzzle, station);
    }
    for (const manual of check.map.manuals.filter((m) => firstNeed(m) === puzzle.id)) {
      checkSource(check, reach, manual, puzzle.id);
    }
    solved.add(puzzle.id);
  }
}

/** Where a crew can be while one puzzle is open. */
interface Stage {
  crew: Spot[];
  solved: ReadonlySet<string>;
  /** per player, the tiles they can reach */
  reach: Set<string>[];
}

function checkReachable(
  { map, issue }: MapCheck,
  { crew, solved, reach }: Stage,
  puzzle: PuzzleDef,
  station: Spot,
): void {
  const { wholeCrew, usesEdgework } = moduleFor(puzzle.type);
  const someone = (spot: Spot): boolean => reach.some((tiles) => canStandAt(tiles, spot));
  if (wholeCrew ? !canGather(map, crew, solved, station) : !someone(station)) {
    issue(
      wholeCrew
        ? `map: the whole crew cannot stand at station "${puzzle.id}" together — nobody may ` +
            'be left outside on a plate, and somebody has to walk in without one'
        : `map: nobody can reach station "${puzzle.id}" once the puzzles before it are solved`,
    );
  }
  if (usesEdgework && map.edgeworkSign !== undefined && !someone(map.edgeworkSign)) {
    issue(`map: nobody can reach the edgework sign before puzzle "${puzzle.id}" reads it`);
  }
}

/**
 * Wherever a manual object is drawn to, somebody can stand at it while
 * `puzzleId`, the first puzzle it covers, is open — for a cabinet, somebody
 * who can fetch its key on the way.
 */
function checkSource(
  { map, issue }: MapCheck,
  reach: Set<string>[],
  manual: ManualDef,
  puzzleId: string,
): void {
  const key = map.items.find((item) => item.id === manual.needsKey);
  for (const spot of manual.spots) {
    const there = reach.filter((tiles) => canStandAt(tiles, spot));
    if (there.length === 0) {
      issue(
        `map: nobody can reach manual object "${manual.id}" at ${spot.x},${spot.y} ` +
          `while puzzle "${puzzleId}" is open`,
      );
    } else if (key !== undefined && !there.some((tiles) => tiles.has(tileKey(key.x, key.y)))) {
      issue(
        `map: nobody can carry "${key.id}" to cabinet "${manual.id}" at ${spot.x},${spot.y} ` +
          `while puzzle "${puzzleId}" is open`,
      );
    }
  }
}

/**
 * Valves need panels to man; a relay emergency has none and gives every
 * player a console. (Its other needs — two players at least, `required`
 * ≥ 1 — the mission and sabotage schemas already enforce.)
 */
function validateEmergencyMode(
  sabotage: NonNullable<MapDef['sabotage']>,
  issue: (message: string) => void,
): void {
  if (sabotage.mode === 'valves' && sabotage.panels.length < 2) {
    issue('map: a valves emergency needs two sabotage panels at least');
  }
  if (sabotage.mode === 'relay' && sabotage.panels.length > 0) {
    issue('map: a relay emergency has no panels — remove sabotage.panels');
  }
}

export type MapDef = z.infer<typeof mapDefSchema>;
export type ManualDef = MapDef['manuals'][number];
export type Mission = z.infer<typeof missionSchema>;

/** Parse and validate a mission from unknown JSON data. Throws with details on invalid input. */
export function parseMission(data: unknown): Mission {
  const result = missionSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid mission file: ${issues}`);
  }
  return result.data;
}
