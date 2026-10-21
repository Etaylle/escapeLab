import type { PlayerView } from '@escapelab/core';
import { DRONE_MARK_MS } from '../alarm.js';
import { drawScientist, drawVoiceRing, type ScientistOpts } from '../art.js';
import { drawAlarmMark, drawCarryable, drawDroneBody, drawDroneCone } from '../hazards.js';
import { FALLBACK_COLOR, inTiles, type Frame, type OtherAvatar } from './frame.js';

/**
 * Drones and the crew, in tile space: the drones' cones under everybody, the
 * crew — remote first, you on top, whoever speaks in a ring, each with a
 * name tag — the drones' bodies, and what somebody carries above their head.
 */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  inTiles(ctx, frame);
  drawCones(ctx, frame);
  drawCrew(ctx, frame);
  drawDrones(ctx, frame);
  drawCarried(ctx, frame);
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
    const look = otherLook(metaOf.get(id), other, frame);
    drawFigure(ctx, frame, id, { x: other.rx, y: other.ry }, look);
  }
  if (!frame.spectator) {
    drawFigure(ctx, frame, frame.youId, frame.self, yourLook(metaOf.get(frame.youId), frame));
  }
}

/** Somebody else of the crew as the view names them. */
function otherLook(meta: Player | undefined, other: OtherAvatar, frame: Frame): ScientistOpts {
  return {
    color: meta?.color ?? FALLBACK_COLOR,
    name: meta?.name ?? '???',
    facing: other.facing,
    moving: other.moving,
    walkPhase: other.phase,
    isYou: false,
    connected: meta?.connected ?? true,
    text: frame.text,
  };
}

/** You, as the view names you. */
function yourLook(you: Player | undefined, frame: Frame): ScientistOpts {
  return {
    color: you?.color ?? FALLBACK_COLOR,
    name: you?.name ?? 'DU',
    facing: frame.self.facing,
    moving: frame.self.moving,
    walkPhase: frame.walkPhase,
    isYou: true,
    connected: true,
    text: frame.text,
  };
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

/** What somebody carries rides above their head. */
function drawCarried(ctx: CanvasRenderingContext2D, frame: Frame): void {
  for (const item of frame.map.items) {
    const carrier =
      item.delivered || item.carriedBy === null ? undefined : drawnAt(frame, item.carriedBy);
    if (carrier !== undefined) {
      ctx.save();
      ctx.translate(carrier.x, carrier.y - 0.75);
      drawCarryable(ctx, { label: item.label, pulse: frame.pulse, carried: true });
      ctx.restore();
    }
  }
}

/** Where a crew member is drawn now: you where you stand, the rest where they ease to. */
function drawnAt(frame: Frame, playerId: string): { x: number; y: number } | undefined {
  if (playerId === frame.youId) {
    return frame.self;
  }
  const other = frame.others.get(playerId);
  return other === undefined ? undefined : { x: other.rx, y: other.ry };
}
