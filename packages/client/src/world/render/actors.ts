import type { PartKind, PlayerView } from '@escapelab/core';
import { DRONE_MARK_MS } from '../alarm.js';
import {
  drawNameTag,
  drawScientist,
  drawVoiceRing,
  type Ground,
  type ScientistOpts,
} from '../art.js';
import { figureBox } from '../depth.js';
import { figurePhase, figurePose, type FigurePose } from '../figure.js';
import {
  drawAlarmMark,
  drawCarryable,
  drawDroneBody,
  drawDroneCone,
  drawDroneShadow,
} from '../hazards.js';
import { FALLBACK_COLOR, inTiles, profiled, type Frame, type OtherAvatar } from './frame.js';
import { occlude } from './occluders.js';
import { drawFans } from './props.js';

/**
 * Drones and the crew, in tile space: the drones' cones and shadows on the
 * floor under everybody; the crew from the back of the picture to its front
 * (the painter's y-sort), whoever speaks in a ring, each standing as the
 * frame says (crewPose) and holding what they carry before their chest, over
 * a shadow of the light they stand in — and a tall thing in front of one
 * drawn again over them (occluders.ts), so that whoever stands behind a
 * shelf shows only above it; the name tags over all of it; the drones' bodies
 * over everybody, and over them the ceiling fans' blades (props.ts).
 */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  inTiles(ctx, frame);
  drawCones(ctx, frame);
  drawDroneShadows(ctx, frame);
  const tagged = drawCrew(ctx, frame);
  drawNames(ctx, tagged);
  drawDrones(ctx, frame);
  profiled(frame.kit, 'props', ctx, () => drawFans(ctx, frame));
}

type Player = PlayerView['players'][number];

/**
 * Drone cones go under the avatars so figures stay readable inside them; a cone
 * ends at the walls, like the drone's sight on the server.
 */
function drawCones(ctx: CanvasRenderingContext2D, frame: Frame): void {
  for (const [id, drone] of Object.entries(frame.drones)) {
    const eye = frame.light.eyes.get(id);
    ctx.save();
    if (eye !== undefined) {
      ctx.clip(eye.clip);
    }
    ctx.translate(drone.x, drone.y);
    drawDroneCone(ctx, drone, frame.pulse);
    ctx.restore();
  }
}

/** A crew member as drawn this frame: where they stand, and how they look. */
interface Standing {
  id: string;
  spot: { x: number; y: number };
  look: ScientistOpts;
}

/** The crew that shows this frame: the rest where they show, and you but for the audience. */
function crewShown(frame: Frame): Standing[] {
  const metaOf = new Map(frame.players.map((p) => [p.id, p]));
  const shown = [...frame.others].filter(([, o]) => frame.light.crewShown(o.rx, o.ry));
  const crew = shown.map(([id, other]) => ({
    id,
    spot: { x: other.rx, y: other.ry },
    look: otherLook(id, metaOf.get(id), other, frame),
  }));
  if (!frame.spectator) {
    const look = yourLook(metaOf.get(frame.youId), frame);
    crew.push({ id: frame.youId, spot: { x: frame.self.x, y: frame.self.y }, look });
  }
  return crew;
}

/**
 * The crew from the back of the picture to its front — you over somebody standing level with
 * you — each without its name tag, a tall thing in front of one drawn again over them. Returns
 * them in that order, for their tags.
 */
function drawCrew(ctx: CanvasRenderingContext2D, frame: Frame): Standing[] {
  const crew = crewShown(frame)
    .map((one, i) => ({ one, i }))
    .sort((a, b) => a.one.spot.y - b.one.spot.y || a.i - b.i)
    .map(({ one }) => one);
  for (const { id, spot, look } of crew) {
    drawFigure(ctx, frame, id, spot, { ...look, named: false });
    occlude(ctx, frame, figureBox(spot.x, spot.y), spot.y);
  }
  return crew;
}

/** The crew's name tags over everything they stand among: no shelf hides a name. */
function drawNames(ctx: CanvasRenderingContext2D, crew: readonly Standing[]): void {
  for (const { spot, look } of crew) {
    ctx.save();
    ctx.translate(spot.x, spot.y + 0.3);
    drawNameTag(ctx, look);
    ctx.restore();
  }
}

/** The drones' shadows on the floor, under the crew. */
function drawDroneShadows(ctx: CanvasRenderingContext2D, frame: Frame): void {
  for (const drone of Object.values(frame.drones)) {
    ctx.save();
    ctx.translate(drone.x, drone.y);
    drawDroneShadow(ctx, drone);
    ctx.restore();
  }
}

/** Somebody else of the crew as the view names them. */
function otherLook(
  id: string,
  meta: Player | undefined,
  other: OtherAvatar,
  frame: Frame,
): ScientistOpts {
  return {
    color: meta?.color ?? FALLBACK_COLOR,
    name: meta?.name ?? '???',
    facing: other.facing,
    moving: other.moving,
    walkPhase: other.phase,
    isYou: false,
    connected: meta?.connected ?? true,
    text: frame.text,
    pose: crewPose(frame, id, other),
    ground: groundAt(frame, other.rx, other.ry),
    ...heldBy(frame, id),
  };
}

/**
 * The light a crew member standing at (x, y) stands in, for the shadow under them: the
 * ceiling lights of the lab with its power on, of a lit room, or of the lab lit whole at the
 * end; else the dark.
 */
export function groundAt(frame: Frame, x: number, y: number): Ground {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const lit = frame.whole > 0 || frame.light.powered(tx, ty) || frame.litTiles.has(`${tx},${ty}`);
  return lit ? 'lit' : 'dark';
}

/** You, as the view names you: by your own name where the crew's list has no entry for you. */
function yourLook(you: Player | undefined, frame: Frame): ScientistOpts {
  return {
    color: you?.color ?? FALLBACK_COLOR,
    name: you?.name ?? frame.youName,
    facing: frame.self.facing,
    moving: frame.self.moving,
    walkPhase: frame.walkPhase,
    isYou: true,
    connected: true,
    text: frame.text,
    pose: crewPose(frame, frame.youId, frame.self),
    ground: groundAt(frame, frame.self.x, frame.self.y),
    ...heldBy(frame, frame.youId),
  };
}

/**
 * How the crew member `id`, walking or not and facing as `gait` says, stands
 * in `frame` (figure.ts): with what they carry, whether they speak, how long
 * ago the last alarm came in, how long they have stood still, and the mood
 * the run's end puts the crew in — each at their own offset into the loops.
 */
export function crewPose(
  frame: Frame,
  id: string,
  gait: { moving: boolean; facing: number },
): FigurePose {
  const carried = frame.carrying.get(id);
  const t = frame.time * 1000;
  const still = frame.stillSince.get(id);
  return figurePose({
    moving: gait.moving,
    facing: gait.facing,
    carrying: carried ?? null,
    speaking: frame.speaking?.has(id) === true,
    alarmAgoMs: frame.alarm === null ? null : frame.now - frame.alarm.at,
    readyAgoMs: null,
    mood: frame.mood,
    t,
    idleMs: still === undefined ? 0 : t - still,
    phase: figurePhase(id),
    reduced: frame.reduced,
  });
}

/** How large hazards.ts's drawCarryable draws a carried item, against its size on the floor. */
const CARRIED_SIZE = 0.82;

/**
 * An item as the hands hold it: drawn as carried — no shadow, glow or label —
 * at its size on the floor, which the figure takes to its HELD_SCALE.
 */
export function heldItem(kind: PartKind, pulse: number): (ctx: CanvasRenderingContext2D) => void {
  return (ctx) => {
    ctx.scale(1 / CARRIED_SIZE, 1 / CARRIED_SIZE);
    drawCarryable(ctx, { kind, pulse, carried: true });
  };
}

/** What `id` carries, for their hands; nothing for none. */
function heldBy(frame: Frame, id: string): Pick<ScientistOpts, 'held'> {
  const kind = frame.carrying.get(id);
  return kind === undefined ? {} : { held: heldItem(kind, frame.pulse) };
}

/** A crew member standing at `spot`, in a ring while they speak. */
function drawFigure(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  id: string,
  spot: { x: number; y: number },
  look: ScientistOpts,
): void {
  ctx.save();
  ctx.translate(spot.x, spot.y + 0.3);
  if (frame.speaking?.has(id) === true) {
    drawVoiceRing(ctx, look.color, frame.time);
  }
  drawScientist(ctx, look);
  ctx.restore();
}

/** The drones' bodies; for a second after an alarm every drone wears a „!" (alarm.ts). */
function drawDrones(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { alarm } = frame;
  const marked = alarm === null ? 1 : (frame.now - alarm.at) / DRONE_MARK_MS;
  for (const drone of Object.values(frame.drones)) {
    ctx.save();
    ctx.translate(drone.x, drone.y);
    drawDroneBody(ctx, drone, frame.pulse);
    drawAlarmMark(ctx, marked);
    ctx.restore();
  }
}
