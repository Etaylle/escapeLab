import { z } from 'zod';

/**
 * Mission format: a mission is pure data (JSON), validated by these schemas.
 * The platform promise is that new missions require no code changes.
 */

export const roleDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
});

const symbolPairSchema = z.tuple([z.string().min(1), z.string().min(1)]);

/**
 * button-sync puzzle: every role listed in `buttons` must press its button.
 * With `windowMs` set, all presses must happen within that window of each
 * other, otherwise they expire and the team must retry.
 */
export const buttonSyncPuzzleSchema = z.object({
  type: z.literal('button-sync'),
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string(),
  buttons: z.array(z.object({ roleId: z.string(), label: z.string() })).min(1),
  infos: z.array(z.object({ roleId: z.string(), text: z.string() })).default([]),
  windowMs: z.number().int().positive().optional(),
});

/**
 * wiring puzzle: the cutter role sees wires whose ends carry symbols
 * (layout shuffled per game). `pairsToCut` must be cut in order; decoys and
 * out-of-order cuts trigger an alarm (time penalty), the wire stays intact.
 */
export const wiringPuzzleSchema = z.object({
  type: z.literal('wiring'),
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string(),
  cutterRoleId: z.string().min(1),
  pairsToCut: z.array(symbolPairSchema).min(1),
  decoyPairs: z.array(symbolPairSchema).min(1),
  penaltySec: z.number().int().positive().default(30),
  infos: z.array(z.object({ roleId: z.string(), text: z.string() })).default([]),
});

/**
 * keypad puzzle: the input role sees `gridSymbols` as a shuffled keypad and
 * must press the symbols of `code` in order. A wrong press resets progress
 * and costs time.
 */
export const keypadPuzzleSchema = z.object({
  type: z.literal('keypad'),
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string(),
  inputRoleId: z.string().min(1),
  gridSymbols: z.array(z.string().min(1)).min(4),
  code: z.array(z.string().min(1)).min(2),
  penaltySec: z.number().int().positive().default(20),
  infos: z.array(z.object({ roleId: z.string(), text: z.string() })).default([]),
});

/**
 * switches puzzle: the panel role sees a bank of toggle switches (shuffled
 * per game); the target role sees which symbols must be ON (chosen per
 * game). Toggling is free, committing a wrong configuration costs time.
 */
export const switchesPuzzleSchema = z.object({
  type: z.literal('switches'),
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string(),
  panelRoleId: z.string().min(1),
  targetRoleId: z.string().min(1),
  symbols: z.array(z.string().min(1)).min(4).max(10),
  onCount: z.number().int().positive(),
  penaltySec: z.number().int().positive().default(20),
  infos: z.array(z.object({ roleId: z.string(), text: z.string() })).default([]),
});

/**
 * simon puzzle: the display role watches a flashing color sequence and owns
 * the symbol buttons; the legend role holds the color→symbol mapping
 * (generated per game). Wrong press resets progress and costs time.
 */
export const simonPuzzleSchema = z.object({
  type: z.literal('simon'),
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string(),
  displayRoleId: z.string().min(1),
  legendRoleId: z.string().min(1),
  buttonSymbols: z.array(z.string().min(1)).length(4),
  sequenceLength: z.number().int().min(3).max(8).default(5),
  penaltySec: z.number().int().positive().default(20),
  infos: z.array(z.object({ roleId: z.string(), text: z.string() })).default([]),
});

/**
 * maze puzzle: the navigator role sees its marker and the goal but no walls,
 * the guide role sees the walls but not the marker. Bumping a wall costs time.
 */
export const mazePuzzleSchema = z.object({
  type: z.literal('maze'),
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string(),
  navigatorRoleId: z.string().min(1),
  guideRoleId: z.string().min(1),
  size: z.number().int().min(4).max(8).default(6),
  penaltySec: z.number().int().positive().default(15),
  infos: z.array(z.object({ roleId: z.string(), text: z.string() })).default([]),
});

export const puzzleDefSchema = z.discriminatedUnion('type', [
  buttonSyncPuzzleSchema,
  wiringPuzzleSchema,
  keypadPuzzleSchema,
  switchesPuzzleSchema,
  simonPuzzleSchema,
  mazePuzzleSchema,
]);

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
   * Recurring emergency: every panel must be manned at the same time, by a
   * different player each, before the timer runs out. Interrupts whatever
   * the crew was doing.
   */
  sabotage: z
    .object({
      label: z.string().min(1),
      hint: z.string().default(''),
      firstAfterSec: z.number().int().positive().default(90),
      everySec: z.number().int().positive().default(150),
      durationSec: z.number().int().positive().default(45),
      penaltySec: z.number().int().positive().default(60),
      panels: z.array(z.object({ id: z.string().min(1), x: coord, y: coord })).min(2),
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
      }),
    )
    .default([]),
});

const pairKey = ([a, b]: [string, string]): string => [a, b].sort().join('\u0000');

function validatePuzzle(puzzle: PuzzleDef, roleIds: Set<string>, ctx: z.RefinementCtx): void {
  const refs: string[] = puzzle.infos.map((i) => i.roleId);
  if (puzzle.type === 'button-sync') {
    refs.push(...puzzle.buttons.map((b) => b.roleId));
  }
  if (puzzle.type === 'wiring') {
    refs.push(puzzle.cutterRoleId);
    const targets = new Set(puzzle.pairsToCut.map(pairKey));
    if (targets.size !== puzzle.pairsToCut.length) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${puzzle.id}": duplicate target pair` });
    }
    if (puzzle.decoyPairs.some((d) => targets.has(pairKey(d)))) {
      ctx.addIssue({
        code: 'custom',
        message: `puzzle "${puzzle.id}": a decoy pair duplicates a target pair`,
      });
    }
  }
  if (puzzle.type === 'keypad') {
    refs.push(puzzle.inputRoleId);
    const grid = new Set(puzzle.gridSymbols);
    if (grid.size !== puzzle.gridSymbols.length) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${puzzle.id}": grid symbols not unique` });
    }
    if (new Set(puzzle.code).size !== puzzle.code.length) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${puzzle.id}": code symbols not unique` });
    }
    if (puzzle.code.some((s) => !grid.has(s))) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${puzzle.id}": code symbol not on grid` });
    }
  }
  if (puzzle.type === 'switches') {
    refs.push(puzzle.panelRoleId, puzzle.targetRoleId);
    if (new Set(puzzle.symbols).size !== puzzle.symbols.length) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${puzzle.id}": symbols not unique` });
    }
    if (puzzle.onCount >= puzzle.symbols.length) {
      ctx.addIssue({
        code: 'custom',
        message: `puzzle "${puzzle.id}": onCount must be below the number of switches`,
      });
    }
  }
  if (puzzle.type === 'maze') {
    refs.push(puzzle.navigatorRoleId, puzzle.guideRoleId);
    if (puzzle.navigatorRoleId === puzzle.guideRoleId) {
      ctx.addIssue({
        code: 'custom',
        message: `puzzle "${puzzle.id}": navigator and guide role must differ`,
      });
    }
  }
  if (puzzle.type === 'simon') {
    refs.push(puzzle.displayRoleId, puzzle.legendRoleId);
    if (new Set(puzzle.buttonSymbols).size !== puzzle.buttonSymbols.length) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${puzzle.id}": button symbols not unique` });
    }
    if (puzzle.displayRoleId === puzzle.legendRoleId) {
      ctx.addIssue({
        code: 'custom',
        message: `puzzle "${puzzle.id}": display and legend role must differ`,
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

export type RoleDef = z.infer<typeof roleDefSchema>;
export type ButtonSyncPuzzleDef = z.infer<typeof buttonSyncPuzzleSchema>;
export type WiringPuzzleDef = z.infer<typeof wiringPuzzleSchema>;
export type KeypadPuzzleDef = z.infer<typeof keypadPuzzleSchema>;
export type SwitchesPuzzleDef = z.infer<typeof switchesPuzzleSchema>;
export type SimonPuzzleDef = z.infer<typeof simonPuzzleSchema>;
export type MazePuzzleDef = z.infer<typeof mazePuzzleSchema>;
export type PuzzleDef = z.infer<typeof puzzleDefSchema>;
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
