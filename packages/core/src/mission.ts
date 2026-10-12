import { z } from 'zod';
import { moduleFor, puzzleDefSchema, type PuzzleDef } from './puzzles/index.js';
import { RELAY_MAX_ROLES } from './puzzles/relay.js';

/**
 * Mission format: a mission is pure data (JSON), validated by these schemas.
 * The platform promise is that new missions require no code changes. The
 * puzzle shapes come from the modules in ./puzzles/.
 */

export const roleDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  /** this role reads the lab's edgework (serial, lamps, cells) to the crew */
  seesEdgework: z.boolean().default(false),
});

const coord = z.number().int().nonnegative();

/**
 * Optional top-down tile map: players walk a grid, puzzle stations must be
 * activated in mission order, plate doors stay open only while someone
 * stands on the plate, puzzle doors open permanently once solved.
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
      }),
    )
    .default([]),
});

/**
 * Role references of one puzzle. Per-type rules beyond these (unique symbols
 * and the like) live in each module's def schema.
 */
function validatePuzzle(puzzle: PuzzleDef, roleIds: Set<string>, ctx: z.RefinementCtx): void {
  if (puzzle.type === 'relay') {
    ctx.addIssue({
      code: 'custom',
      message:
        `puzzle "${puzzle.id}": relay is an emergency, not a station — ` +
        'set map.sabotage.mode to "relay" instead',
    });
  }
  const refs: string[] = puzzle.infos.map((i) => i.roleId);
  if (puzzle.type === 'button-sync') {
    refs.push(...puzzle.buttons.map((b) => b.roleId));
  }
  if ('operatorRoleId' in puzzle) {
    refs.push(puzzle.operatorRoleId, puzzle.manualRoleId);
    if (puzzle.operatorRoleId === puzzle.manualRoleId) {
      ctx.addIssue({
        code: 'custom',
        message: `puzzle "${puzzle.id}": operatorRoleId and manualRoleId must be different roles`,
      });
    }
  }
  for (const roleId of refs) {
    if (!roleIds.has(roleId)) {
      ctx.addIssue({
        code: 'custom',
        message: `puzzle "${puzzle.id}" references unknown role "${roleId}"`,
      });
    }
  }
}

/** A puzzle whose rules read the edgework is unsolvable when nobody can see it. */
function validateEdgework(
  mission: { roles: RoleDef[]; puzzles: PuzzleDef[] },
  ctx: z.RefinementCtx,
): void {
  if (mission.roles.some((r) => r.seesEdgework)) {
    return;
  }
  const readers = mission.puzzles.filter((p) => moduleFor(p.type).usesEdgework).map((p) => p.id);
  if (readers.length > 0) {
    ctx.addIssue({
      code: 'custom',
      message:
        `puzzles ${readers.map((id) => `"${id}"`).join(', ')} read the edgework, but no role ` +
        'sees it — set "seesEdgework": true on the role that should read it out',
    });
  }
}

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
    map: mapDefSchema.optional(),
  })
  .superRefine((mission, ctx) => {
    const roleIds = new Set(mission.roles.map((r) => r.id));
    if (roleIds.size !== mission.roles.length) {
      ctx.addIssue({ code: 'custom', message: 'role ids must be unique' });
    }
    for (const puzzle of mission.puzzles) {
      validatePuzzle(puzzle, roleIds, ctx);
    }
    validateEdgework(mission, ctx);
    if (mission.map !== undefined) {
      validateMap(mission, ctx);
    }
  });

function validateMap(
  mission: { map?: z.infer<typeof mapDefSchema> | undefined; roles: RoleDef[]; puzzles: { id: string }[] },
  ctx: z.RefinementCtx,
): void {
  const map = mission.map;
  if (map === undefined) {
    return;
  }
  const width = map.tiles[0]?.length ?? 0;
  if (map.tiles.some((row) => row.length !== width)) {
    ctx.addIssue({ code: 'custom', message: 'map: all tile rows must have the same length' });
    return;
  }
  const floor = (x: number, y: number): boolean => map.tiles[y]?.charAt(x) === '.';
  const requireFloor = (what: string, x: number, y: number): void => {
    if (!floor(x, y)) {
      ctx.addIssue({ code: 'custom', message: `map: ${what} at ${x},${y} is not on a floor tile` });
    }
  };

  for (const role of mission.roles) {
    const spawn = map.spawns[role.id];
    if (spawn === undefined) {
      ctx.addIssue({ code: 'custom', message: `map: missing spawn for role "${role.id}"` });
    } else {
      requireFloor(`spawn of "${role.id}"`, spawn.x, spawn.y);
    }
  }

  const puzzleIds = new Set(mission.puzzles.map((p) => p.id));
  const stationIds = map.stations.map((s) => s.puzzleId);
  if (new Set(stationIds).size !== stationIds.length) {
    ctx.addIssue({ code: 'custom', message: 'map: duplicate station for a puzzle' });
  }
  for (const id of puzzleIds) {
    if (!stationIds.includes(id)) {
      ctx.addIssue({ code: 'custom', message: `map: no station for puzzle "${id}"` });
    }
  }
  for (const station of map.stations) {
    if (!puzzleIds.has(station.puzzleId)) {
      ctx.addIssue({
        code: 'custom',
        message: `map: station references unknown puzzle "${station.puzzleId}"`,
      });
    }
    requireFloor(`station "${station.puzzleId}"`, station.x, station.y);
  }

  const plateIds = new Set(map.plates.map((p) => p.id));
  if (plateIds.size !== map.plates.length) {
    ctx.addIssue({ code: 'custom', message: 'map: plate ids must be unique' });
  }
  for (const plate of map.plates) {
    requireFloor(`plate "${plate.id}"`, plate.x, plate.y);
  }
  const doorIds = new Set(map.doors.map((d) => d.id));
  if (doorIds.size !== map.doors.length) {
    ctx.addIssue({ code: 'custom', message: 'map: door ids must be unique' });
  }
  if (map.exit !== undefined) {
    requireFloor('exit', map.exit.x, map.exit.y);
  }
  if (map.sabotage !== undefined) {
    const panelIds = new Set(map.sabotage.panels.map((p) => p.id));
    if (panelIds.size !== map.sabotage.panels.length) {
      ctx.addIssue({ code: 'custom', message: 'map: sabotage panel ids must be unique' });
    }
    if (map.sabotage.panels.length > mission.roles.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'map: more sabotage panels than roles — nobody could clear it',
      });
    }
    for (const panel of map.sabotage.panels) {
      requireFloor(`sabotage panel "${panel.id}"`, panel.x, panel.y);
    }
    validateEmergencyMode(map.sabotage, mission.roles.length, ctx);
  }
  const itemIds = new Set(map.items.map((i) => i.id));
  if (itemIds.size !== map.items.length) {
    ctx.addIssue({ code: 'custom', message: 'map: item ids must be unique' });
  }
  for (const item of map.items) {
    requireFloor(`item "${item.id}"`, item.x, item.y);
    requireFloor(`drop-off of item "${item.id}"`, item.deliverTo.x, item.deliverTo.y);
    if (item.requiredFor !== undefined && !puzzleIds.has(item.requiredFor)) {
      ctx.addIssue({
        code: 'custom',
        message: `map: item "${item.id}" is required for unknown puzzle "${item.requiredFor}"`,
      });
    }
  }
  const droneIds = new Set(map.drones.map((d) => d.id));
  if (droneIds.size !== map.drones.length) {
    ctx.addIssue({ code: 'custom', message: 'map: drone ids must be unique' });
  }
  for (const drone of map.drones) {
    if (drone.activeAfterSolved >= mission.puzzles.length) {
      ctx.addIssue({
        code: 'custom',
        message: `map: drone "${drone.id}": activeAfterSolved must be below the number of puzzles`,
      });
    }
    for (const [i, point] of drone.waypoints.entries()) {
      requireFloor(`waypoint ${i} of drone "${drone.id}"`, point.x, point.y);
    }
    // Drones fly straight between waypoints, so those lines must stay indoors.
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
          ctx.addIssue({
            code: 'custom',
            message: `map: drone "${drone.id}" would fly through a wall at ${x},${y}`,
          });
          break;
        }
      }
    }
  }
  for (const door of map.doors) {
    requireFloor(`door "${door.id}"`, door.x, door.y);
    if (door.opensBy.kind === 'plate' && !plateIds.has(door.opensBy.plateId)) {
      ctx.addIssue({
        code: 'custom',
        message: `map: door "${door.id}" references unknown plate "${door.opensBy.plateId}"`,
      });
    }
    if (door.opensBy.kind === 'puzzle' && !puzzleIds.has(door.opensBy.puzzleId)) {
      ctx.addIssue({
        code: 'custom',
        message: `map: door "${door.id}" references unknown puzzle "${door.opensBy.puzzleId}"`,
      });
    }
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
  ctx: z.RefinementCtx,
): void {
  if (sabotage.mode === 'valves' && sabotage.panels.length < 2) {
    ctx.addIssue({
      code: 'custom',
      message: 'map: a valves emergency needs two sabotage panels at least',
    });
  }
  if (sabotage.mode === 'relay' && sabotage.panels.length > 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'map: a relay emergency has no panels — remove sabotage.panels',
    });
  }
  if (sabotage.mode === 'relay' && roleCount > RELAY_MAX_ROLES) {
    ctx.addIssue({
      code: 'custom',
      message: `map: a relay emergency has control names for ${RELAY_MAX_ROLES} roles at most`,
    });
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
