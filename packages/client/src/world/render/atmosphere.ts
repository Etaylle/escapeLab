import type { Sight } from '@escapelab/core';
import { dressedFor } from '../artKit.js';
import { decorSteams, decorVariant } from '../decor.js';
import { AMBER, lift, PAPER, rgba, STEEL, TUNGSTEN, WHITE, type Rgb } from '../palette.js';
import {
  breakerSmoke,
  inCone,
  particleAlpha,
  stepParticles,
  type Beam,
  type Emitters,
  type Particle,
  type Spot,
} from '../particles.js';
import { lightShown } from '../sources.js';
import { STEAM_SPOT } from '../wallProps.js';
import type { Frame, FrameLit } from './frame.js';

/**
 * The air of the lab (particles.ts): what makes particles this frame — the
 * light cones dust drifts in, the vents and the reactors' cores in sight,
 * a short at the fuse box, the main breaker smoking after the blackout's
 * thunk, the hatch grinding open — the particles moved on to it, and each
 * drawn: a mote only inside a cone and where its lamp can see, so that the
 * dark between the beams stays dark. Drawn with what glows and moves
 * (glow.ts): over the Canvas pass's darkness, under the light layer's light.
 * Tile space.
 */

/** A light cone dust may show in, and what its lamp sees: no mote shows behind a wall. */
interface Cone {
  beam: Beam;
  sight: Sight;
}

/** How close to you a steam vent in the dark has to be for your lamp to show its steam, tiles. */
const STEAM_SEEN = 4.5;
/** How far a door has to stand open for dust to show in the light through it. */
const SPILL_OPEN = 0.3;

const DUST: Rgb = lift(TUNGSTEN, 0.4);
const SPARK: Rgb = lift(AMBER, 0.6);
const SMOKE: Rgb = lift(STEEL, 0.25);
const DEBRIS: Rgb = lift(PAPER, 0.1);

/** The particles moved on to this frame, then drawn: steam and smoke, sparks, debris, the motes. */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { particles } = frame.kit.art;
  const cones = conesOf(frame);
  stepParticles(particles, frame.time, emittersOf(frame, cones));
  for (const particle of particles.live) {
    drawParticle(ctx, particle);
  }
  if (cones.length > 0) {
    drawDust(ctx, particles.live, cones);
  }
}

/** What makes particles in `frame`: its light cones, vents, cores, short, breaker and hatch. */
export function emittersOf(frame: Frame, cones: readonly Cone[]): Emitters {
  return {
    cones: cones.map((cone) => cone.beam),
    vents: ventsOf(frame),
    cores: coresOf(frame),
    short: frame.short,
    smoke: smokeOf(frame),
    hatch: hatchRim(frame),
    reduced: frame.reduced,
  };
}

/** A lamp's light as a cone dust shows in; null for a lamp without a beam. */
function coneOf({ lamp, sight }: FrameLit): Cone | null {
  return lamp.beam === null ? null : { beam: { x: lamp.x, y: lamp.y, ...lamp.beam }, sight };
}

/**
 * The light cones in `frame` dust may show in: the flashlights' beams — yours and the crew's —
 * the drones' eyes, a lit room's light through a door standing open — none for the audience,
 * nor while the lab has its power and nobody carries a lamp.
 */
export function conesOf(frame: Frame): Cone[] {
  if (frame.spectator) {
    return [];
  }
  const { own, crew, eyes, spills } = frame.light;
  const lamps = [
    ...(own === null ? [] : [own]),
    ...crew,
    ...eyes.values(),
    ...spills.filter((spill) => spill.open > SPILL_OPEN).map((spill) => spill.lit),
  ];
  return lamps.flatMap((lit) => {
    const cone = coneOf(lit);
    return cone === null ? [] : [cone];
  });
}

/** Whether the tile (x, y) lies in the camera's view, a tile's margin kept. */
function inView(frame: Frame, x: number, y: number): boolean {
  const { camera, viewport } = frame;
  const halfW = viewport.w / 2 / camera.scale + 1;
  const halfH = viewport.h / 2 / camera.scale + 1;
  return Math.abs(x + 0.5 - camera.x) <= halfW && Math.abs(y + 0.5 - camera.y) <= halfH;
}

/** Where steam rises: the vents in view whose steam light shows — a lit room's, or near you. */
function ventsOf(frame: Frame): Spot[] {
  const { dressing } = dressedFor(frame.kit.art, frame.map, frame.missionId);
  const seen = (x: number, y: number): boolean => {
    if (!inView(frame, x, y) || !frame.light.shown(x, y)) return false;
    const near = Math.hypot(x + 0.5 - frame.self.x, y + 0.5 - frame.self.y) < STEAM_SEEN;
    return frame.spectator || near || frame.light.powered(x, y) || frame.litTiles.has(`${x},${y}`);
  };
  const walls = dressing.props
    .filter((prop) => prop.kind === 'steam' && seen(prop.x, prop.y + 1))
    .map((prop) => ({ x: prop.x + STEAM_SPOT.x, y: prop.y + STEAM_SPOT.y }));
  const stacks = frame.map.decor
    .filter((piece) => decorSteams(piece.kind, decorVariant(piece)) && seen(piece.x, piece.y))
    .map((piece) => ({ x: piece.x + 0.55, y: piece.y + 0.05 }));
  return [...walls, ...stacks];
}

/** The reactors' cores in view where the world shows them: their vents puff steam now and then. */
function coresOf(frame: Frame): Spot[] {
  return frame.map.decor
    .filter((piece) => piece.kind === 'core' && inView(frame, piece.x, piece.y))
    .filter((piece) => lightShown(frame, piece.x, piece.y))
    .map((piece) => ({ x: piece.x + 0.5, y: piece.y + 0.3 }));
}

/** The main breaker while it smokes after the blackout's thunk, where the world shows it. */
function smokeOf(frame: Frame): Spot | null {
  const smoke = breakerSmoke(frame.map.stations, frame.blackoutAt, frame.now);
  return smoke !== null && frame.light.shown(smoke.x, smoke.y) ? smoke : null;
}

/** The hatch's rim while the hatch grinds open, dust shaken off it; null otherwise. */
function hatchRim(frame: Frame): Spot | null {
  const exit = frame.map.exit;
  if (exit === null || frame.hatch <= 0 || frame.hatch >= 1) {
    return null;
  }
  return { x: exit.x + 0.5, y: exit.y + 0.2 };
}

/** Fills a soft round puff of `rgb` at `alpha`: steam and smoke. */
function puff(ctx: CanvasRenderingContext2D, particle: Particle, rgb: Rgb, alpha: number): void {
  ctx.fillStyle = rgba(rgb, alpha);
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
  ctx.fill();
}

/** One particle as its kind looks; the motes are drawn apart, inside the cones (drawDust). */
function drawParticle(ctx: CanvasRenderingContext2D, particle: Particle): void {
  const alpha = particleAlpha(particle);
  if (particle.kind === 'steam') {
    puff(ctx, particle, WHITE, 0.13 * alpha);
  } else if (particle.kind === 'smoke') {
    puff(ctx, particle, SMOKE, 0.2 * alpha);
  } else if (particle.kind === 'debris') {
    ctx.fillStyle = rgba(DEBRIS, 0.7 * alpha);
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
  } else if (particle.kind === 'spark') {
    ctx.strokeStyle = rgba(SPARK, alpha);
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(particle.x, particle.y);
    ctx.lineTo(particle.x - particle.vx * 0.04, particle.y - particle.vy * 0.04);
    ctx.stroke();
  }
}

/** Whether a mote at (x, y) is lit: inside a cone, on a tile its lamp can see. */
export function motesLit(cones: readonly Cone[], x: number, y: number): boolean {
  const key = `${Math.floor(x)},${Math.floor(y)}`;
  return cones.some((cone) => inCone(cone.beam, x, y) && cone.sight.tiles.has(key));
}

/** The motes lit in the cones, only where their lamps can see: none behind a wall. */
function drawDust(
  ctx: CanvasRenderingContext2D,
  live: readonly Particle[],
  cones: readonly Cone[],
): void {
  for (const particle of live) {
    if (particle.kind === 'dust' && motesLit(cones, particle.x, particle.y)) {
      ctx.fillStyle = rgba(DUST, 0.55 * particleAlpha(particle));
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
  }
}
