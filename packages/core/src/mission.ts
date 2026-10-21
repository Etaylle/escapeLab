import { z } from 'zod';
import { decorIssues } from './decor.js';
import { moduleFor, puzzleDefSchema, type PuzzleDef } from './puzzles/index.js';
import { RELAY_MAX_PLAYERS } from './puzzles/relay.js';
import {
  canGather,
  canStandAt,
  crewsOf,
  reachability,
  tileKey,
  twoAtOnce,
  type Spot,
} from './reach.js';

/**
 * Mission format: a mission is pure data (JSON), validated by these schemas.
 * The platform promise is that new missions require no code changes. The
 * puzzle shapes come from the modules in ./puzzles/.
 */

const coord = z.number().int().nonnegative();
const tile = z.object({ x: coord, y: coord });

/** How many emergency lamps a map may have: each is a light the clients draw on every frame. */
export const MAX_LAMPS = 16;

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
 * What a room is, by its label: the clients dress it after its kind — its
 * floor, what hangs on its walls. A label without one is a plain lab room.
 */
export const ROOM_KINDS = [
  'archive',
  'corridor',
  'machine',
  'server',
  'lab',
  'reactor',
  'control',
] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

/**
 * The lab's furniture: solid props standing on floor tiles, which nobody
 * walks through — shelves and a cart (archive), benches and a fume hood
 * (lab), racks (server), a generator, pipes and barrels (machine room), the
 * core and its cables (reactor), console desks (control room, reactor).
 */
export const DECOR_KINDS = [
  'shelf',
  'cart',
  'bench',
  'hood',
  'rack',
  'generator',
  'pipes',
  'barrel',
  'core',
  'cables',
  'desk',
] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

/** How many looks every piece of decor comes in: `variant` 0 to DECOR_VARIANTS − 1. */
export const DECOR_VARIANTS = 4;

/**
 * The tile map: players walk a grid, puzzle stations must be activated in
 * mission order, puzzle doors open permanently once solved, plate doors stay
 * open only while someone stands on the plate — or, where they name a puzzle
 * in `untilSolved`, for good once that puzzle is solved.
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
          z.object({
            kind: z.literal('plate'),
            plateId: z.string().min(1),
            /** a puzzle id: once that puzzle is solved, the door stays open without the plate */
            untilSolved: z.string().min(1).optional(),
          }),
          z.object({ kind: z.literal('puzzle'), puzzleId: z.string().min(1) }),
        ]),
      }),
    )
    .default([]),
  plates: z
    .array(z.object({ id: z.string().min(1), x: coord, y: coord, label: z.string().default('') }))
    .default([]),
  /**
   * Where each puzzle is worked: one spot, or — for a module worked at two
   * consoles — one spot for console a and one for console b, more than 4
   * tiles apart.
   */
  stations: z
    .array(
      z.object({
        puzzleId: z.string().min(1),
        x: coord,
        y: coord,
        console: z.enum(['a', 'b']).optional(),
      }),
    )
    .min(1),
  /** room names: a solved station lights a room by its name; `kind` says how it is dressed */
  labels: z
    .array(
      z.object({
        text: z.string().min(1),
        x: coord,
        y: coord,
        kind: z.enum(ROOM_KINDS).optional(),
      }),
    )
    .default([]),
  /**
   * Furniture on floor tiles, solid like walls for everybody's steps: never
   * where anything else of the map stands or a drone flies, and every proof
   * of reach holds with it in the way.
   */
  decor: z
    .array(
      z.object({
        kind: z.enum(DECOR_KINDS),
        x: coord,
        y: coord,
        variant: z
          .number()
          .int()
          .min(0)
          .max(DECOR_VARIANTS - 1)
          .optional(),
      }),
    )
    .default([]),
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
      /**
       * puzzles the crew must have solved before emergencies start — until
       * then it may still be locked in its separate starting rooms; with as
       * many as the mission has, none ever comes
       */
      afterSolved: z.number().int().nonnegative().default(2),
    })
    .optional(),
  /**
   * Emergency lamps, on the floor or on a wall beside the floor: once the
   * lights are out, each glows red. Up to MAX_LAMPS.
   */
  lamps: z.array(tile).max(MAX_LAMPS).default([]),
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
    /**
     * the mission a won run leads on to, by its id in the catalog: the end
     * screen offers it to the crew; the server checks that it exists
     */
    next: z.string().min(1).optional(),
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
    /**
     * how many alarms end the run — the one that reaches it loses — or null
     * for no limit; left out, `scaleMission` sets it from the difficulty
     */
    maxAlarms: z.number().int().positive().nullable().optional(),
    /**
     * The run opens with the power on: the lab lit, the clock standing still
     * and no station armed, until the lights fail `lightsSec` seconds in.
     * Left out, the lights are out from the start.
     */
    intro: z.object({ lightsSec: z.number().min(1).max(10) }).optional(),
    /** mission control's lines for the moment the clock starts and for the unlocked exit */
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
  const stations = mission.puzzles.filter((p) => p.type !== 'relay');
  checkStations(check, stations);
  checkPlates(check);
  checkDoors(check);
  checkSabotage(check, mission.players.min);
  checkItems(check);
  checkDrones(check, mission.puzzles.length);
  checkLamps(check);
  checkLights(check, stations);
  checkManuals(check, stations);
  checkSpots(check);
  checkKeys(check);
  checkSign(check, stations);
  decorIssues(map, floor).forEach(issue);
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

type StationDef = MapDef['stations'][number];

/**
 * Every puzzle has its station on the floor: one spot without a console, or
 * — where its module is worked at two consoles — console a and console b,
 * more than CONSOLES_APART tiles apart.
 */
function checkStations(check: MapCheck, stations: PuzzleDef[]): void {
  const { map, puzzleIds, issue, requireFloor } = check;
  for (const id of puzzleIds) {
    if (!map.stations.some((s) => s.puzzleId === id)) {
      issue(`map: no station for puzzle "${id}"`);
    }
  }
  for (const station of map.stations) {
    if (!puzzleIds.has(station.puzzleId)) {
      issue(`map: station references unknown puzzle "${station.puzzleId}"`);
    }
    const what =
      station.console === undefined
        ? `station "${station.puzzleId}"`
        : `console ${station.console} of station "${station.puzzleId}"`;
    requireFloor(what, station.x, station.y);
  }
  for (const puzzle of stations) {
    const spots = map.stations.filter((s) => s.puzzleId === puzzle.id);
    if (spots.length === 0) {
      continue;
    }
    if (moduleFor(puzzle.type).consoles === 2) {
      checkConsoles(issue, puzzle.id, spots);
    } else {
      checkOneConsole(issue, puzzle.id, spots);
    }
  }
}

/**
 * How far apart the two consoles of a station stand at least, in tiles: the
 * server keeps a player at a spot within 2 tiles of it once there, so with
 * more than twice that between them nobody is ever counted at both.
 */
const CONSOLES_APART = 4;

/** A station worked at two consoles: console a and console b, once each, apart. */
function checkConsoles(issue: MapCheck['issue'], puzzleId: string, spots: StationDef[]): void {
  const a = spots.find((s) => s.console === 'a');
  const b = spots.find((s) => s.console === 'b');
  if (a === undefined || b === undefined || spots.length !== 2) {
    issue(
      `map: puzzle "${puzzleId}" is worked at two consoles — give it one station with ` +
        'console "a" and one with console "b"',
    );
    return;
  }
  const apart = Math.hypot(a.x - b.x, a.y - b.y);
  if (apart <= CONSOLES_APART) {
    issue(
      `map: consoles a and b of station "${puzzleId}" at ${a.x},${a.y} and ${b.x},${b.y} ` +
        `stand ${Number(apart.toFixed(1))} tiles apart — put them more than ` +
        `${CONSOLES_APART} apart, so nobody is counted at both`,
    );
  }
}

/** A station worked at one console: one spot, and no console named. */
function checkOneConsole(issue: MapCheck['issue'], puzzleId: string, spots: StationDef[]): void {
  if (spots.length > 1) {
    issue(`map: ${spots.length} stations for puzzle "${puzzleId}" — it is worked at one console`);
  }
  if (spots.some((s) => s.console !== undefined)) {
    issue(`map: station "${puzzleId}" is worked at one console — leave out console`);
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
    const { opensBy } = door;
    if (opensBy.kind === 'puzzle') {
      if (!puzzleIds.has(opensBy.puzzleId)) {
        issue(`map: door "${door.id}" references unknown puzzle "${opensBy.puzzleId}"`);
      }
      continue;
    }
    if (!plateIds.has(opensBy.plateId)) {
      issue(`map: door "${door.id}" references unknown plate "${opensBy.plateId}"`);
    }
    if (opensBy.untilSolved !== undefined && !puzzleIds.has(opensBy.untilSolved)) {
      issue(
        `map: door "${door.id}" stays open once unknown puzzle "${opensBy.untilSolved}" ` +
          'is solved — name a puzzle of this mission in untilSolved',
      );
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

/**
 * Every emergency lamp hangs on the floor or on a wall with floor right
 * beside it, where its light can fall; no two share a tile.
 */
function checkLamps({ map, issue, floor }: MapCheck): void {
  const hung = new Set<string>();
  for (const { x, y } of map.lamps) {
    const beside = [floor(x, y - 1), floor(x, y + 1), floor(x - 1, y), floor(x + 1, y)];
    const onWall = map.tiles[y]?.charAt(x) === '#';
    if (!floor(x, y) && !(onWall && beside.some(Boolean))) {
      issue(
        `map: the lamp at ${x},${y} lights nothing — hang it on the floor or on a wall ` +
          'beside the floor',
      );
    }
    if (hung.has(tileKey(x, y))) {
      issue(`map: two lamps hang at ${x},${y}`);
    }
    hung.add(tileKey(x, y));
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
 * the whole crew together where everyone presses, by two players at once
 * where it has two consoles, and by one player while another reads its
 * rules where it has one — every spot of a manual object can be reached
 * once the first puzzle it covers is open (a cabinet's with its key in
 * hand), and the sign before the first rule that reads it.
 */
function walkStations(check: MapCheck, crew: Spot[], stations: PuzzleDef[]): void {
  const firstNeed = (manual: ManualDef): string | undefined =>
    stations.find((p) => manual.puzzleIds.includes(p.id))?.id;
  const solved = new Set<string>();
  for (const puzzle of stations) {
    const reach = reachability(check.map, crew, solved);
    const spots = check.map.stations.filter((s) => s.puzzleId === puzzle.id);
    if (spots.length > 0) {
      checkReachable(check, { crew, solved, reach }, puzzle, spots);
      checkBackup(check, { crew, solved, reach }, puzzle, spots);
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
  spots: StationDef[],
): void {
  const { wholeCrew, usesEdgework, consoles } = moduleFor(puzzle.type);
  const someone = (spot: Spot): boolean => reach.some((tiles) => canStandAt(tiles, spot));
  const [station] = spots;
  if (consoles === 2) {
    checkConsoleReach(issue, reach, puzzle.id, spots);
  } else if (
    station !== undefined &&
    (wholeCrew ? !canGather(map, crew, solved, station) : !someone(station))
  ) {
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
 * A station with two consoles is worked by two players at once: somebody
 * at console a and somebody else at console b, each walking the doors as
 * for a station with one. Names the console nobody else can reach.
 */
function checkConsoleReach(
  issue: MapCheck['issue'],
  reach: Set<string>[],
  puzzleId: string,
  spots: StationDef[],
): void {
  const a = spots.find((s) => s.console === 'a');
  const b = spots.find((s) => s.console === 'b');
  if (a === undefined || b === undefined) {
    return; // checkStations reports the missing console
  }
  const at = (spot: Spot): number[] =>
    reach.flatMap((tiles, player) => (canStandAt(tiles, spot) ? [player] : []));
  const problem = consoleOutOfReach(at(a), at(b));
  if (problem !== null) {
    issue(`map: ${problem} of station "${puzzleId}" once the puzzles before it are solved`);
  }
}

/** Who cannot work which console, by the players who can stand at each; null when two can. */
function consoleOutOfReach(atA: number[], atB: number[]): string | null {
  if (atA.length === 0) {
    return 'nobody can reach console a';
  }
  if (atB.length === 0) {
    return 'nobody can reach console b';
  }
  if (atA.some((i) => atB.some((j) => j !== i))) {
    return null;
  }
  return 'nobody but the player at console a can reach console b';
}

/**
 * Nobody works a station alone: at a station with one console, wherever its
 * rules are drawn to, one player can stand at it while another stands at a
 * source covering it — lockers and cabinets alike, which other checks see
 * opened. A station with two consoles has its second player at the other
 * console; one the whole crew works needs nobody to read. What nobody can
 * reach at all, other checks report.
 */
function checkBackup(check: MapCheck, stage: Stage, puzzle: PuzzleDef, spots: StationDef[]): void {
  const { wholeCrew, consoles } = moduleFor(puzzle.type);
  const [station] = spots;
  const someone = (spot: Spot): boolean => stage.reach.some((tiles) => canStandAt(tiles, spot));
  if (wholeCrew || consoles === 2 || station === undefined || !someone(station)) {
    return;
  }
  const pair = twoAtOnce(check.map, stage.crew, stage.solved);
  const sources = check.map.manuals.filter((manual) => manual.puzzleIds.includes(puzzle.id));
  // Each source lies on one of its spots; one source that pairs up there is enough.
  const alone = sources.flatMap((manual) => {
    const spot = manual.spots.find((s) => someone(s) && !pair(station, s));
    return spot === undefined ? [] : [`${manual.label} at ${spot.x},${spot.y}`];
  });
  if (sources.length > 0 && alone.length === sources.length) {
    check.issue(
      `map: station "${puzzle.id}" and its rules (${alone.join(', ')}) are never reachable ` +
        'by two different players at once — the crew would be alone',
    );
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

/** Mission data checked: the mission, or every issue found, each as "path: message". */
export type MissionCheck = { ok: true; mission: Mission } | { ok: false; issues: string[] };

/**
 * Checks mission data against the format and every map rule, the
 * reachability proofs included, without throwing: what `parseMission`
 * does, with the issues as a list.
 */
export function checkMission(data: unknown): MissionCheck {
  const result = missionSchema.safeParse(data);
  if (result.success) {
    return { ok: true, mission: result.data };
  }
  const where = (path: readonly PropertyKey[]): string => path.map(String).join('.') || '(root)';
  return { ok: false, issues: result.error.issues.map((i) => `${where(i.path)}: ${i.message}`) };
}

/** Parse and validate a mission from unknown JSON data. Throws with details on invalid input. */
export function parseMission(data: unknown): Mission {
  const checked = checkMission(data);
  if (!checked.ok) {
    throw new Error(`Invalid mission file: ${checked.issues.join('; ')}`);
  }
  return checked.mission;
}
