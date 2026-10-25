import type { PlayerView } from '@escapelab/core';
import { DRONE_MARK_MS } from '../alarm.js';
import { drawScientist, drawVoiceRing, type ScientistOpts } from '../art.js';
import { figurePhase, figurePose, type FigurePose } from '../figure.js';
import {
  carryableKind,
  drawAlarmMark,
  drawCarryable,
  drawDroneBody,
  drawDroneCone,
} from '../hazards.js';
import { FALLBACK_COLOR, inTiles, type Frame, type OtherAvatar } from './frame.js';

/**
 * Drones and the crew, in tile space: the drones' cones under everybody, the
 * crew — remote first, you on top, whoever speaks in a ring, each with a
 * name tag, each standing as the frame says (crewPose) and holding what they
 * carry before their chest — and the drones' bodies.
 */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  inTiles(ctx, frame);
  drawCones(ctx, frame);
  drawCrew(ctx, frame);
  drawDrones(ctx, frame);
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

/** Avatars: remote first, where they show, local on top. */
function drawCrew(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const metaOf = new Map(frame.players.map((p) => [p.id, p]));
  const shown = [...frame.others].filter(([, o]) => frame.light.crewShown(o.rx, o.ry));
  for (const [id, other] of shown) {
    const look = otherLook(id, metaOf.get(id), other, frame);
    drawFigure(ctx, frame, id, { x: other.rx, y: other.ry }, look);
  }
  if (!frame.spectator) {
    drawFigure(ctx, frame, frame.youId, frame.self, yourLook(metaOf.get(frame.youId), frame));
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
    ...heldBy(frame, id),
  };
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
    carrying: carried === undefined ? null : carryableKind(carried),
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
export function heldItem(label: string, pulse: number): (ctx: CanvasRenderingContext2D) => void {
  return (ctx) => {
    ctx.scale(1 / CARRIED_SIZE, 1 / CARRIED_SIZE);
    drawCarryable(ctx, { label, pulse, carried: true });
  };
}

/** What `id` carries, for their hands; nothing for none. */
function heldBy(frame: Frame, id: string): Pick<ScientistOpts, 'held'> {
  const label = frame.carrying.get(id);
  return label === undefined ? {} : { held: heldItem(label, frame.pulse) };
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
