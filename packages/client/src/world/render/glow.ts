import { animTime, propSeed } from '../anim.js';
import { dressedFor } from '../artKit.js';
import { bakeBox } from '../baked.js';
import { decorGlows, decorVariant, drawDecorGlow } from '../decor.js';
import { strengthAt } from '../gl/pack.js';
import { AMBER, lift, rgba } from '../palette.js';
import { glowSources, lightShown, powerAt, type LightSource } from '../sources.js';
import { drawWallPropGlow, glows } from '../wallProps.js';
import * as atmosphere from './atmosphere.js';
import { layBake } from './bakes.js';
import { clipOf, shutKey } from './clips.js';
import { inTiles, profiled, type Frame } from './frame.js';
import { glowsWithLight, onLayer } from './light.js';
import { fillPool, steadyOf, steadyPart } from './pools.js';

/**
 * What glows and moves in the lab — the glowing marks on the walls and the
 * furniture, the beacon's beams, the particles — drawn as the world's light
 * takes its way (light.ts `onLayer`). On the WebGL light layer `under` draws
 * it before the light, so that the layer's light map shades it like
 * everything else; the layer lights the coloured lights of sources.ts
 * itself, glow, shadows and bloom. On the Canvas pass `draw` lays it over
 * the darkness after the light pass, which draws the emergency lamps — and,
 * in the dark, the coloured lights' glow that holds still (pools.ts) — and
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
    const steady = !glowsWithLight(ctx, frame);
    drawGlowing(ctx, frame, { sources: glowSources(frame), steady });
  }
}

/** The coloured lights whose glow the glow pass lays, and whether it lays the steady ones too. */
interface Pools {
  sources: readonly LightSource[];
  /** false where the light pass laid the steady ones already (light.ts `glowsWithLight`) */
  steady: boolean;
}

/**
 * The glow of `pools` where given — each where its light can see: the faint
 * screens and racks baked together for the doors as they stand, unless the
 * light pass laid them; the pulsing core, the beacon and a screen striking up
 * each baked once at full strength and laid on at the strength of the moment
 * — then the beacon's beams, the glowing marks and the particles.
 */
function drawGlowing(ctx: CanvasRenderingContext2D, frame: Frame, pools: Pools | null): void {
  ctx.save();
  inTiles(ctx, frame);
  ctx.globalCompositeOperation = 'lighter';
  if (pools !== null) {
    drawPools(ctx, frame, pools);
  }
  drawBeacon(ctx, frame);
  ctx.globalCompositeOperation = 'source-over';
  drawEmissive(ctx, frame);
  profiled(frame.kit, 'atmosphere', ctx, () => atmosphere.draw(ctx, frame));
  ctx.restore();
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

/** The lights' glow: the steady ones in one go where the pass lays them, the rest each as now. */
function drawPools(ctx: CanvasRenderingContext2D, frame: Frame, pools: Pools): void {
  const shut = shutKey(frame);
  const steady = steadyOf(pools.sources);
  if (pools.steady) {
    // The steady faint lights, from one bake for them all and the doors as they stand.
    const part = steadyPart(frame, steady, shut);
    layBake(ctx, frame, part.bake, part.draw);
  }
  for (const source of pools.sources.filter((s) => !steady.includes(s))) {
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

/**
 * What glows on the walls and the furniture in view, where the world shows it: each thing's
 * tube and LEDs out of step with the others' (its seed, from its tile), a lab's screens
 * showing an oscilloscope's trace.
 */
function drawEmissive(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { dressing } = dressedFor(frame.kit.art, frame.map, frame.missionId);
  const t = animTime(frame.time);
  const base = { t, now: frame.now, reduced: frame.reduced, lit: true };
  for (const prop of dressing.props) {
    if (!glows(prop.kind) || !inView(frame, prop.x, prop.y)) continue;
    if (!lightShown(frame, prop.x, prop.y + 1)) continue;
    const on = powerAt(frame, prop.x, prop.y + 1, prop.room);
    const below = (prop.y + 1) * dressing.width + prop.x;
    const scope = dressing.kinds[below] === 'lab';
    const seed = propSeed(prop.x, prop.y);
    ctx.save();
    ctx.translate(prop.x, prop.y);
    drawWallPropGlow(ctx, prop.kind, prop.variant, { ...base, on, seed, scope });
    ctx.restore();
  }
  for (const piece of frame.map.decor) {
    const variant = decorVariant(piece);
    if (!decorGlows(piece.kind, variant) || !inView(frame, piece.x, piece.y)) continue;
    if (!lightShown(frame, piece.x, piece.y)) continue;
    const room = dressing.rooms[piece.y * dressing.width + piece.x] ?? null;
    const on = powerAt(frame, piece.x, piece.y, room);
    const seed = propSeed(piece.x, piece.y);
    ctx.save();
    ctx.translate(piece.x + 0.5, piece.y + 0.5);
    drawDecorGlow(ctx, piece.kind, variant, { ...base, on, seed });
    ctx.restore();
  }
}
