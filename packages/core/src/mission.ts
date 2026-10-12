import { z } from 'zod';
import { moduleFor, puzzleDefSchema, type PuzzleDef } from './puzzles/index.js';
import { RELAY_MAX_ROLES } from './puzzles/relay.js';
import { canGather, canStandAt, reachability, type Spot } from './reach.js';

/**
 * Mission format: a mission is pure data (JSON), validated by these schemas.
 * The platform promise is that new missions require no code changes. The
 * puzzle shapes come from the modules in ./puzzles/.
 */

/** A crew label: name, colour and spawn. What a player sees depends on where they stand. */
export const roleDefSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /** where this role starts and what is near */
  description: z.string(),
});

const coord = z.number().int().nonnegative();

export const MANUAL_KINDS = ['book', 'terminal', 'chart'] as const;
export type ManualKind = (typeof MANUAL_KINDS)[number];

/**
 * The tile map: players walk a grid, puzzle stations must be activated in
 * mission order, plate doors stay open only while someone stands on the
 * plate, puzzle doors open permanently once solved.
 * Tiles: '#' wall, '.' floor, ' ' void.
 */
export const mapDefSchema = z.object({
  tiles: z.array(z.string().min(1)).min(3),
  spawns: z.record(z.string(), z.object({ x: coord, y: coord })),
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
   * Where the printed rules lie — a book, a terminal, a wall chart: whoever
   * stands at one reads the rules of every puzzle it covers. Every puzzle
   * needs one, except where the whole crew works the panel.
   */
  manuals: z
    .array(
      z.object({
        id: z.string().min(1),
        kind: z.enum(MANUAL_KINDS),
        x: coord,
        y: coord,
        label: z.string().min(1),
        puzzleIds: z.array(z.string().min(1)).min(1),
      }),
    )
    .default([]),
  /** The Laborkennung on a wall: whoever walks up to it keeps the edgework for the run. */
  edgeworkSign: z.object({ x: coord, y: coord }).optional(),
  /**
   * Escape hatch: once every puzzle is solved it opens, and ALL connected
   * players must gather there (while the clock still runs) to win. Without
   * an exit the mission is won with the last puzzle.
   */
  exit: z.object({ x: coord, y: coord }).optional(),
  /**
   * Recurring emergency that interrupts whatever the crew was doing. In
   * `valves` mode every panel must be manned at the same time, by a
   * different player each, before the timer runs out. In `relay` mode there
   * are no panels: every role gets a console and reads out instructions for
   * the others' consoles (puzzles/relay.ts).
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
      /** relay: completed instructions that clear it; three per role when left out */
      required: z.number().int().positive().optional(),
      /** valves: two at least, each manned by a different player */
      panels: z.array(z.object({ id: z.string().min(1), x: coord, y: coord })).default([]),
    })
    .optional(),
  /**
   * Objects that have to be carried across the lab by hand. A station whose
   * puzzle is named in `requiredFor` stays inert until its item arrives.
   */
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        x: coord,
        y: coord,
        deliverTo: z.object({ x: coord, y: coord }),
        requiredFor: z.string().min(1).optional(),
      }),
    )
    .default([]),
  /** Security drones patrolling their waypoint loop; their cone costs time. */
  drones: z
    .array(
      z.object({
        id: z.string().min(1),
        waypoints: z.array(z.object({ x: coord, y: coord })).min(2),
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
    story: z.object({
      intro: z.string(),
      win: z.string(),
      lose: z.string(),
    }),
    timeLimitSec: z.number().int().positive(),
    /** seconds every hint from mission control takes off the clock */
    hintCostSec: z.number().int().positive().default(20),
    /** seconds at an open puzzle before mission control offers the first or next hint */
    hintDelaySec: z.number().int().positive().default(45),
    /** mission control's lines for the start of the run and the unlocked exit */
    radio: z
      .object({
        start: z.string().min(1).optional(),
        escape: z.string().min(1).optional(),
      })
      .default({}),
    roles: z.array(roleDefSchema).min(2),
    puzzles: z.array(puzzleDefSchema).min(1),
    map: mapDefSchema,
  })
  .superRefine((mission, ctx) => {
    const roleIds = new Set(mission.roles.map((r) => r.id));
    if (roleIds.size !== mission.roles.length) {
      ctx.addIssue({ code: 'custom', message: 'role ids must be unique' });
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

type MissionParts = { roles: RoleDef[]; puzzles: PuzzleDef[]; map: MapDef };

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
  for (const role of mission.roles) {
    const spawn = map.spawns[role.id];
    if (spawn === undefined) {
      issue(`map: missing spawn for role "${role.id}"`);
    } else {
      check.requireFloor(`spawn of "${role.id}"`, spawn.x, spawn.y);
    }
  }
  if (map.exit !== undefined) {
    check.requireFloor('exit', map.exit.x, map.exit.y);
  }
  checkStations(check);
  checkPlates(check);
  checkDoors(check);
  checkSabotage(check, mission.roles.length);
  checkItems(check);
  checkDrones(check, mission.puzzles.length);
  const stations = mission.puzzles.filter((p) => p.type !== 'relay');
  checkManuals(check, stations);
  checkSign(check, stations);
  checkSolvable(check, mission.roles, stations);
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

function checkSabotage({ map, issue, requireFloor }: MapCheck, roleCount: number): void {
  if (map.sabotage === undefined) {
    return;
  }
  const panelIds = new Set(map.sabotage.panels.map((p) => p.id));
  if (panelIds.size !== map.sabotage.panels.length) {
    issue('map: sabotage panel ids must be unique');
  }
  if (map.sabotage.panels.length > roleCount) {
    issue('map: more sabotage panels than roles — nobody could clear it');
  }
  for (const panel of map.sabotage.panels) {
    requireFloor(`sabotage panel "${panel.id}"`, panel.x, panel.y);
  }
  validateEmergencyMode(map.sabotage, roleCount, issue);
}

function checkItems({ map, puzzleIds, issue, requireFloor }: MapCheck): void {
  const itemIds = new Set(map.items.map((i) => i.id));
  if (itemIds.size !== map.items.length) {
    issue('map: item ids must be unique');
  }
  for (const item of map.items) {
    requireFloor(`item "${item.id}"`, item.x, item.y);
    requireFloor(`drop-off of item "${item.id}"`, item.deliverTo.x, item.deliverTo.y);
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

/** Every puzzle somebody has to read is covered by a manual object. */
function checkManuals(check: MapCheck, stations: PuzzleDef[]): void {
  const { map, puzzleIds, issue, requireFloor } = check;
  const manualIds = new Set(map.manuals.map((m) => m.id));
  if (manualIds.size !== map.manuals.length) {
    issue('map: manual object ids must be unique');
  }
  for (const manual of map.manuals) {
    requireFloor(`manual object "${manual.id}"`, manual.x, manual.y);
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
 * Solvability, walked the way the game opens doors, one player per role
 * from their spawn: every station can be reached in mission order — by the
 * whole crew together where everyone presses — a manual object covering it
 * can be reached while it is open (maybe by somebody else), and the sign
 * before the first rule that reads it.
 */
function checkSolvable(check: MapCheck, roles: RoleDef[], stations: PuzzleDef[]): void {
  const spawns = roles.map((role) => check.map.spawns[role.id]);
  const crew = spawns.filter((spawn): spawn is Spot => spawn !== undefined);
  if (crew.length < spawns.length) {
    return;
  }
  const solved = new Set<string>();
  for (const puzzle of stations) {
    const station = check.map.stations.find((s) => s.puzzleId === puzzle.id);
    if (station !== undefined) {
      checkReachable(check, crew, solved, puzzle, station);
    }
    solved.add(puzzle.id);
  }
}

function checkReachable(
  { map, issue }: MapCheck,
  crew: Spot[],
  solved: ReadonlySet<string>,
  puzzle: PuzzleDef,
  station: Spot,
): void {
  const { wholeCrew, usesEdgework } = moduleFor(puzzle.type);
  const reach = reachability(map, crew, solved);
  const someone = (spot: Spot): boolean => reach.some((tiles) => canStandAt(tiles, spot));
  const outOfReach = (spot: Spot | undefined): boolean => spot !== undefined && !someone(spot);
  if (wholeCrew ? !canGather(map, crew, solved, station) : !someone(station)) {
    issue(
      wholeCrew
        ? `map: the whole crew cannot stand at station "${puzzle.id}" together — nobody may ` +
            'be left outside on a plate, and somebody has to walk in without one'
        : `map: nobody can reach station "${puzzle.id}" once the puzzles before it are solved`,
    );
  }
  const manuals = map.manuals.filter((m) => m.puzzleIds.includes(puzzle.id));
  if (manuals.length > 0 && manuals.every(outOfReach)) {
    issue(`map: nobody can reach a manual object for puzzle "${puzzle.id}" while it is open`);
  }
  if (usesEdgework && outOfReach(map.edgeworkSign)) {
    issue(`map: nobody can reach the edgework sign before puzzle "${puzzle.id}" reads it`);
  }
}

/**
 * Valves need panels to man; a relay emergency has none and names a console
 * per role from a fixed pool. (Its other needs — two roles at least,
 * `required` ≥ 1 — the mission and sabotage schemas already enforce.)
 */
function validateEmergencyMode(
  sabotage: NonNullable<MapDef['sabotage']>,
  roleCount: number,
  issue: (message: string) => void,
): void {
  if (sabotage.mode === 'valves' && sabotage.panels.length < 2) {
    issue('map: a valves emergency needs two sabotage panels at least');
  }
  if (sabotage.mode === 'relay' && sabotage.panels.length > 0) {
    issue('map: a relay emergency has no panels — remove sabotage.panels');
  }
  if (sabotage.mode === 'relay' && roleCount > RELAY_MAX_ROLES) {
    issue(`map: a relay emergency has control names for ${RELAY_MAX_ROLES} roles at most`);
  }
}

export type RoleDef = z.infer<typeof roleDefSchema>;
export type MapDef = z.infer<typeof mapDefSchema>;
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
