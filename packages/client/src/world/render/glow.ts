import { animTime } from '../anim.js';
import { dressedFor } from '../artKit.js';
import { bakeBox } from '../baked.js';
import { decorGlows, decorSteams, decorVariant, drawDecorGlow } from '../decor.js';
import { strengthAt } from '../gl/pack.js';
import { AMBER, lift, rgba, TUNGSTEN, WHITE, type Rgb } from '../palette.js';
import {
  particleAlpha,
  stepParticles,
  type Beam,
  type Emitters,
  type Particle,
} from '../particles.js';
import { glowSources, lightShown, powerAt, type LightSource } from '../sources.js';
import { drawWallPropGlow, glows, STEAM_SPOT } from '../wallProps.js';
import { layBake } from './bakes.js';
import { clipOf, shutKey } from './clips.js';
import { inTiles, type Frame } from './frame.js';
import { onLayer } from './light.js';

/**
 * What glows and moves in the lab — the glowing marks on the walls and the
 * furniture, the beacon's beams, the particles — drawn as the world's light
 * takes its way (light.ts `onLayer`). On the WebGL light layer `under` draws
 * it before the light, so that the layer's light map shades it like
 * everything else; the layer lights the coloured lights of sources.ts
 * itself, glow, shadows and bloom. On the Canvas pass `draw` lays it over
 * the darkness after the light pass, which draws the emergency lamps, and
 * the other coloured lights' glow under it. Tile space.
 */
export function under(ctx: CanvasRenderingContext2D, frame: Frame): void {
  if (onLayer(ctx, frame)) {
    drawGlowing(ctx, frame, null);
  }
}

/** Over the Canvas pass's darkness: the coloured lights' glow, then what glows and moves. */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  if (!onLayer(ctx, frame)) {
    drawGlowing(ctx, frame, glowSources(frame));
  }
}

/**
 * The glow of `pools` where given — each where its light can see: the faint
 * screens and racks baked together for the doors as they stand; the pulsing
 * core, the beacon and a screen striking up each baked once at full strength
 * and laid on at the strength of the moment — then the beacon's beams, the
 * glowing marks and the particles.
 */
function drawGlowing(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  pools: readonly LightSource[] | null,
): void {
  ctx.save();
  inTiles(ctx, frame);
  ctx.globalCompositeOperation = 'lighter';
  if (pools !== null) {
    drawPools(ctx, frame, pools);
  }
  drawBeacon(ctx, frame);
  ctx.globalCompositeOperation = 'source-over';
  drawEmissive(ctx, frame);
  drawParticles(ctx, frame);
  ctx.restore();
}

/** How bright a light's glow is at its middle, part of the way out and at its rim. */
const POOL_STOPS = [
  [0, 0.55],
  [0.4, 0.22],
  [1, 0],
] as const;

/** Fills a light's glow round its spot in `g`, tile space, `strength` bright. */
function fillPool(g: CanvasRenderingContext2D, source: LightSource, strength: number): void {
  const { x, y, reach } = source;
  const glow = g.createRadialGradient(x, y, 0, x, y, reach);
  for (const [offset, alpha] of POOL_STOPS) {
    glow.addColorStop(offset, rgba(source.colour, alpha * strength));
  }
  g.fillStyle = glow;
  g.fillRect(x - reach, y - reach, reach * 2, reach * 2);
}

/** The steady faint lights, from one bake for them all and the doors as they stand. */
function laySteady(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  steady: readonly LightSource[],
  shut: string,
): void {
  const lights = steady.map((s) => [s.x, s.y, s.colour, s.reach, s.strength.toFixed(2)]);
  const of = JSON.stringify([frame.missionId, shut, lights]);
  const rounds = steady.map((s) => ({ x: s.x, y: s.y, r: s.reach }));
  const box = steady.length === 0 ? null : bakeBox(frame.map, [], rounds);
  layBake(ctx, frame, { name: 'pools', of, box }, (g) => {
    g.globalCompositeOperation = 'lighter';
    for (const source of steady) {
      g.save();
      g.clip(clipOf(frame, source, shut));
      fillPool(g, source, source.strength);
      g.restore();
    }
  });
}

/** A light's glow at full strength where it can see, from its bake for the doors as they stand. */
function layLive(ctx: CanvasRenderingContext2D, frame: Frame, source: LightSource, shut: string) {
  const of = `${source.x},${source.y},${source.reach},${source.colour.join(',')},${shut}`;
  const box = bakeBox(frame.map, [], [{ x: source.x, y: source.y, r: source.reach }]);
  layBake(ctx, frame, { name: `pool:${source.x},${source.y}`, of, box }, (g) => {
    g.clip(clipOf(frame, source, shut));
    fillPool(g, { ...source, strength: 1 }, 1);
  });
}

/** The lights' glow: the steady ones in one go, the rest each at its strength now. */
function drawPools(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  sources: readonly LightSource[],
): void {
  const shut = shutKey(frame);
  const steady = sources.filter((s) => s.pulse === undefined && s.flicker !== true);
  laySteady(ctx, frame, steady, shut);
  for (const source of sources.filter((s) => !steady.includes(s))) {
    ctx.globalAlpha = strengthAt(source, frame.time * 1000);
    layLive(ctx, frame, source, shut);
  }
  ctx.globalAlpha = 1;
}

/** One turn of the beacon over the hatch, s: its two beams sweep slower than anybody walks. */
const BEACON_TURN = 4;
/** How bright a beam starts at the beacon: amber that never outshines the open hatch. */
export const BEAM_ALPHA = 0.28;

/** The beacon's two amber beams sweeping round the open hatch while the crew runs for it. */
function drawBeacon(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const exit = frame.map.exit;
  if (exit === null || !exit.open || frame.escapeSince === null || frame.red <= 0) {
    return;
  }
  const x = exit.x + 0.88;
  const y = exit.y + 0.12;
  const turn = frame.reduced ? 0 : (animTime(frame.time) / BEACON_TURN) * Math.PI * 2;
  for (const side of [0, Math.PI]) {
    const a = turn + side;
    const beam = ctx.createRadialGradient(x, y, 0, x, y, 2.2);
    beam.addColorStop(0, rgba(AMBER, BEAM_ALPHA));
    beam.addColorStop(1, rgba(AMBER, 0));
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, 2.2, a - 0.22, a + 0.22);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = rgba(lift(AMBER, 0.4), 0.95);
  ctx.beginPath();
  ctx.arc(x, y, 0.06, 0, Math.PI * 2);
  ctx.fill();
}

/** Whether the tile (x, y) lies in the camera's view, a tile's margin kept. */
function inView(frame: Frame, x: number, y: number): boolean {
  const { camera, viewport } = frame;
  const halfW = viewport.w / 2 / camera.scale + 1;
  const halfH = viewport.h / 2 / camera.scale + 1;
  return Math.abs(x + 0.5 - camera.x) <= halfW && Math.abs(y + 0.5 - camera.y) <= halfH;
}

/** What glows on the walls and the furniture in view, where the world shows it. */
function drawEmissive(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { dressing } = dressedFor(frame.kit.art, frame.map, frame.missionId);
  const t = animTime(frame.time);
  const base = { t, now: frame.now, reduced: frame.reduced, lit: true };
  for (const prop of dressing.props) {
    if (!glows(prop.kind) || !inView(frame, prop.x, prop.y)) continue;
    if (!lightShown(frame, prop.x, prop.y + 1)) continue;
    const on = powerAt(frame, prop.x, prop.y + 1, prop.room);
    ctx.save();
    ctx.translate(prop.x, prop.y);
    drawWallPropGlow(ctx, prop.kind, prop.variant, { ...base, on });
    ctx.restore();
  }
  for (const piece of frame.map.decor) {
    const variant = decorVariant(piece);
    if (!decorGlows(piece.kind, variant) || !inView(frame, piece.x, piece.y)) continue;
    if (!lightShown(frame, piece.x, piece.y)) continue;
    const room = dressing.rooms[piece.y * dressing.width + piece.x] ?? null;
    const on = powerAt(frame, piece.x, piece.y, room);
    ctx.save();
    ctx.translate(piece.x + 0.5, piece.y + 0.5);
    drawDecorGlow(ctx, piece.kind, variant, { ...base, on });
    ctx.restore();
  }
}

/** How close to you a steam vent in the dark has to be for your lamp to show its steam, tiles. */
const STEAM_SEEN = 4.5;

/** Your flashlight's beam; none for the audience, nor while the lab has its power. */
function beamOf(frame: Frame): Beam | null {
  const own = frame.light.own;
  const beam = own?.lamp.beam;
  if (frame.spectator || own === null || beam === null || beam === undefined) {
    return null;
  }
  return { x: own.lamp.x, y: own.lamp.y, ...beam };
}

/** Where steam rises: the vents in view whose steam light shows — a lit room's, or near you. */
function ventsOf(frame: Frame): { x: number; y: number }[] {
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

/** Whether a mote at (x, y) is in the beam, and so lit. */
function inBeam(beam: Beam, particle: Particle): boolean {
  const dx = particle.x - beam.x;
  const dy = particle.y - beam.y;
  const turn = Math.atan2(dy, dx) - beam.facing;
  const off = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
  return off < beam.halfAngle && Math.hypot(dx, dy) < beam.reach;
}

const DUST: Rgb = lift(TUNGSTEN, 0.4);
const SPARK: Rgb = lift(AMBER, 0.6);

/** The motes lit in your beam, only where your lamp can see: none behind a wall. */
function drawDust(ctx: CanvasRenderingContext2D, frame: Frame, beam: Beam): void {
  const own = frame.light.own;
  ctx.save();
  if (own !== null) {
    ctx.clip(own.clip);
  }
  for (const particle of frame.kit.art.particles.live) {
    if (particle.kind === 'dust' && inBeam(beam, particle)) {
      ctx.fillStyle = rgba(DUST, 0.55 * particleAlpha(particle));
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
  }
  ctx.restore();
}

/** The particles, moved on to this frame: steam, the motes in your beam, the sparks. */
function drawParticles(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { particles } = frame.kit.art;
  const beam = beamOf(frame);
  const { short, reduced } = frame;
  const emitters: Emitters = { beam, vents: ventsOf(frame), short, reduced };
  stepParticles(particles, frame.time, emitters);
  for (const particle of particles.live) {
    const alpha = particleAlpha(particle);
    if (particle.kind === 'steam') {
      ctx.fillStyle = rgba(WHITE, 0.13 * alpha);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (particle.kind === 'spark') {
      ctx.strokeStyle = rgba(SPARK, alpha);
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(particle.x - particle.vx * 0.04, particle.y - particle.vy * 0.04);
      ctx.stroke();
    }
  }
  if (beam !== null) {
    drawDust(ctx, frame, beam);
  }
}
