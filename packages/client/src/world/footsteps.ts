import type { RoomPlan } from './ambience.js';
import type { SfxId } from './samples.js';
import type { FloorKind } from './surfaces.js';

/**
 * footsteps.ts: what a step sounds like on the floor it lands on. Each kind of room has its floor
 * of one of three materials — concrete in the corridors, the machine room and a room without a
 * kind; linoleum in the lab, the archive and the control room; steel in the server room, its
 * raised floor's panels, and in the reactor, its tread plate — and each material three recorded
 * takes of the same work boot (audio/catalog.json). A step is one of them at random, a little
 * faster or slower each time. Which room a tile belongs to comes from the plan the beds work out
 * (ambience.ts `roomPlan`), handed over ten times a second with the room the player stands in
 * (`followFloors`), so that your own steps (audio.ts `footstep`) sound the floor under you and
 * a partner's (spatial.ts) the floor under them. Pure but for that plan and that room, kept.
 */

/** What a floor is made of, as a step hears it. */
export type Surface = 'concrete' | 'lino' | 'steel';

/** The floor of each kind of room. */
export const SURFACES: Readonly<Record<FloorKind, Surface>> = {
  corridor: 'concrete',
  machine: 'concrete',
  plain: 'concrete',
  lab: 'lino',
  archive: 'lino',
  control: 'lino',
  server: 'steel',
  reactor: 'steel',
};

/** The three takes of a step on each floor. */
export const STEPS: Readonly<Record<Surface, readonly [SfxId, SfxId, SfxId]>> = {
  concrete: ['step-concrete-1', 'step-concrete-2', 'step-concrete-3'],
  lino: ['step-lino-1', 'step-lino-2', 'step-lino-3'],
  steel: ['step-steel-1', 'step-steel-2', 'step-steel-3'],
};

/** How far a step's speed strays from the take's, either way: ±5 %. */
export const STEP_SPREAD = 0.05;

/** A step's speed: within STEP_SPREAD of the take's, at random. */
export function stepRate(): number {
  return 1 + (Math.random() * 2 - 1) * STEP_SPREAD;
}

/** One of `surface`'s takes, at random. */
export function stepTake(surface: Surface): SfxId {
  const takes = STEPS[surface];
  return takes[Math.floor(Math.random() * takes.length)] ?? takes[0];
}

/** The plan the floors are read off, and the room the player stands in; none before the first. */
let floors: { plan: RoomPlan; room: string | null } | null = null;

/** The plan of the map in play, and the room the player stands in now (ambience.ts). */
export function followFloors(plan: RoomPlan, room: string | null): void {
  floors = { plan, room };
}

/** The world is gone: no floor is known until the next one says. */
export function forgetFloors(): void {
  floors = null;
}

/** The floor of the room `room`; concrete where it has none, or none is known. */
function surfaceOf(room: string | null): Surface {
  const kind = room === null ? undefined : floors?.plan.kinds.get(room);
  return SURFACES[kind ?? 'plain'];
}

/** The floor under your own feet: your room's, as the last round heard it. */
export function ownSurface(): Surface {
  return surfaceOf(floors?.room ?? null);
}

/**
 * The floor at the tile (x, y): its room's; on a doorway or floor no room claims, null — the
 * one who stands there keeps the floor of their last step.
 */
export function surfaceAt(x: number, y: number): Surface | null {
  const plan = floors?.plan;
  if (plan === undefined || x < 0 || x >= plan.width) return null;
  const room = plan.rooms[y * plan.width + x] ?? null;
  return room === null ? null : surfaceOf(room);
}
