import { bake, bakeBox, bakeStep, drawBaked, type Baked } from '../baked.js';
import { SPILL_REACH } from '../doors.js';
import { poolsOfPixels } from '../gl/maps.js';
import { openLightPath, pathNow, type LightPath } from '../gl/path.js';
import {
  EMERGENCY_GLOW,
  EMERGENCY_TINT,
  HATCH_TINT,
  spillTint,
  type TintStops,
} from '../light.js';
import { ALARM_RED, ceilingLayer, mixTint, WARM, type CeilingLight } from '../power.js';
import { cutDarkness, ESCAPE_RED, escapeTint, roomUp } from './darkness.js';
import {
  inTiles,
  toScreen,
  type Frame,
  type FrameLit,
  type RenderKit,
  type WorldMap,
} from './frame.js';

/**
 * The light over the picture: the darkness, and what cuts it open — the
 * lab's own warm light in your room while it has its power. The audience
 * sees the lab whole, warm all over while the power is on; and so does
 * everybody as every room's light comes on at the end of a run won
 * (`ending.lit`, 0 to 1), the darkness lifting as it does. Where there is
 * darkness, the WebGL light layer draws it all where the world's way for
 * its light says so (gl/path.ts); else, and as its fallback, this pass.
 */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const whole = frame.ending?.lit ?? 0;
  const path = lightPathOf(frame.kit, ctx.canvas);
  if (onLayer(ctx, frame) && drawLayer(ctx, frame, path)) {
    return;
  }
  drawPower(ctx, frame, whole);
  if (inTheDark(frame)) {
    drawLighting(ctx, frame, 1 - whole);
  }
}

/** Whether the world lies in the dark: not the audience's, nor lit whole by a run won. */
function inTheDark(frame: Frame): boolean {
  return !frame.spectator && (frame.ending?.lit ?? 0) < 1;
}

/**
 * Whether the WebGL light layer lights this frame of the world drawn on
 * `ctx`: a world in the dark whose light takes the GL way (gl/path.ts),
 * opened on the first frame that asks. The art's glow pass asks too
 * (render/glow.ts): on the layer what glows and moves goes under the light
 * map, on the Canvas pass over the darkness with the coloured lights' glow.
 */
export function onLayer(ctx: CanvasRenderingContext2D, frame: Frame): boolean {
  return inTheDark(frame) && pathNow(lightPathOf(frame.kit, ctx.canvas)) === 'gl';
}

/** The way for the light of the world drawn on `world`, opened on its first frame (gl/path.ts). */
function lightPathOf(kit: RenderKit, world: HTMLCanvasElement): LightPath {
  kit.light ??= openLightPath(world, location.search);
  return kit.light;
}

/** Takes the light of a world down as the world goes: its layer, its context, its probe. */
export function dropLight(kit: RenderKit): void {
  kit.light?.dispose();
  kit.light = null;
}

/**
 * The light layer's frame over the picture: its light map multiplied in,
 * keeping of the picture what the light leaves — remembered tiles dim,
 * never black — then its glow and bloom added. False where it has no layer.
 */
function drawLayer(ctx: CanvasRenderingContext2D, frame: Frame, path: LightPath): boolean {
  const { layer } = path;
  if (layer === null) {
    return false;
  }
  const { canvas, w, h } = layer.render(frame, (light) => poolsOf(frame.kit, frame.map, light));
  const { w: vw, h: vh } = frame.viewport;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(canvas, 0, 0, w, h, 0, 0, vw, vh);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(canvas, 0, h, w, h, 0, 0, vw, vh);
  ctx.restore();
  return true;
}

/** The ceiling lights' pools read off their baked layers, by layer: once per map and colour. */
const pools = new WeakMap<HTMLCanvasElement, Float32Array>();

/** The pools of the ceiling `light` over `map`, a tile at a time (gl/maps.ts), off its layer. */
function poolsOf(kit: RenderKit, map: WorldMap, light: CeilingLight): Float32Array {
  const layer = layerOf(kit, map, light);
  const known = pools.get(layer);
  if (known !== undefined) {
    return known;
  }
  const g = layer.getContext('2d');
  if (g === null) {
    throw new Error('light: the ceiling layer has no 2D context to read its pools from.');
  }
  const pixels = g.getImageData(0, 0, layer.width, layer.height).data;
  const read = poolsOfPixels(pixels, map.width * map.height);
  pools.set(layer, read);
  return read;
}

/** The lab's own light: all of it at the end of a run won, else your room while it has power. */
function drawPower(ctx: CanvasRenderingContext2D, frame: Frame, whole: number): void {
  const { light, spectator } = frame;
  if (whole > 0) {
    drawPowerOn(ctx, frame, null, whole);
  } else if (frame.scene.lit && (spectator || light.room !== null)) {
    drawPowerOn(ctx, frame, light.room?.path ?? null, 1);
  }
}

/** The lab's ceiling lights baked in `light`'s colour for `map`, kept in the kit. */
function layerOf(kit: RenderKit, map: WorldMap, light: CeilingLight): HTMLCanvasElement {
  const tiles = map.tiles.join('\n');
  if (kit.ceiling === null || kit.ceiling.tiles !== tiles) {
    kit.ceiling = { tiles, byLight: new Map() };
  }
  const baked = kit.ceiling.byLight.get(light) ?? ceilingLayer(map, light);
  kit.ceiling.byLight.set(light, baked);
  return baked;
}

/**
 * The lab with its power on: the ceiling lights' warm pools and a warm lift
 * over the picture, within `clip` (a path in tiles) — a player's room,
 * whole, nothing beyond its walls; the audience, and everybody at the end
 * of a run won, the whole lab (null) — `strength` up. The darkness goes
 * over it after.
 */
function drawPowerOn(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  clip: Path2D | null,
  strength: number,
): void {
  const { map } = frame;
  const { w, h } = frame.viewport;
  ctx.save();
  inTiles(ctx, frame);
  if (clip !== null) {
    ctx.clip(clip);
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = strength;
  ctx.drawImage(layerOf(frame.kit, map, WARM), 0, 0, map.width, map.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(255, 186, 128, 0.05)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * The darkness over the picture, `veil` strong, with every light cut into
 * it where its lamp can see (darkness.ts); then the colours of the lights over it.
 */
function drawLighting(ctx: CanvasRenderingContext2D, frame: Frame, veil: number): void {
  const { overlay } = frame.kit;
  cutDarkness(overlay, frame);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = veil;
  ctx.drawImage(overlay.canvas, 0, 0);
  ctx.globalAlpha = 1;
  drawRoomLight(ctx, frame);
  drawLampLight(ctx, frame);
  drawSpillLight(ctx, frame);
  drawEscapeTint(ctx, frame);
}

/**
 * The light the lit rooms and the open hatch add over the darkness: a
 * room a solved station lit glows warm again, as the whole lab did with
 * the power on, and turns red as the escape's siren sounds; the hatch
 * spills its green-white light as far as it has ground open, cut off by
 * the walls like every light. Baked (baked.ts): a frame lays it over the
 * picture in one go.
 */
function drawRoomLight(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const baked = roomLight(frame);
  if (baked === null) {
    return;
  }
  ctx.save();
  inTiles(ctx, frame);
  ctx.globalCompositeOperation = 'lighter';
  drawBaked(ctx, baked);
  ctx.restore();
}

/**
 * What the lit rooms' and the open hatch's light is baked for: the map,
 * the red, how far the hatch stands open and each room's warm-up, each in
 * the steps of `bakeStep`.
 */
function roomLightKey(frame: Frame): string {
  const exit = frame.light.exit;
  const rooms = [...frame.lit].map(
    ([label, room]) => `${label} ${bakeStep(roomUp(frame, room.since))}`,
  );
  const open = exit === null ? 'shut' : bakeStep(exit.open);
  return [frame.map.tiles.join('/'), bakeStep(frame.red), open, ...rooms].join('|');
}

/**
 * The lit rooms' and the open hatch's light, baked again only once it has
 * changed since the last bake — a room warming up, the red coming in,
 * the hatch grinding open, or the walls and doors the hatch's light stops
 * at. Null while there is none.
 */
function roomLight(frame: Frame): Baked | null {
  const { kit } = frame;
  const key = roomLightKey(frame);
  const sight = frame.light.exit?.lit.sight ?? null;
  if (kit.roomLight === null || kit.roomLight.key !== key || kit.roomLight.sight !== sight) {
    const into = kit.roomLight?.baked?.canvas;
    kit.roomLight = { key, sight, baked: bakeRoomLight(frame, bakeStep(frame.red), into) };
  }
  return kit.roomLight.baked;
}

/**
 * Bakes the lit rooms' ceiling lights, `red` of the way from warm to red,
 * and the open hatch's glow over them — into `into`, where given.
 */
function bakeRoomLight(
  frame: Frame,
  red: number,
  into: HTMLCanvasElement | undefined,
): Baked | null {
  const { map, kit } = frame;
  const exit = frame.light.exit;
  const rooms = [...frame.lit.values()];
  const glows =
    exit === null ? [] : [{ x: exit.lit.lamp.x, y: exit.lit.lamp.y, r: exit.lit.lamp.glow }];
  const box = bakeBox(map, rooms.flatMap((room) => room.tiles), glows);
  if (box === null) {
    return null;
  }
  const tints = [
    { layer: layerOf(kit, map, WARM), share: 1 - red },
    { layer: layerOf(kit, map, ALARM_RED), share: red },
  ].filter(({ share }) => share > 0);
  const draw = (g: CanvasRenderingContext2D): void => {
    g.globalCompositeOperation = 'lighter';
    for (const room of rooms) {
      g.save();
      g.clip(room.path);
      for (const { layer, share } of tints) {
        g.globalAlpha = bakeStep(roomUp(frame, room.since)) * share;
        g.drawImage(layer, 0, 0, map.width, map.height);
      }
      g.restore();
    }
    if (exit !== null) {
      bakeHatchGlow(g, exit.lit, bakeStep(exit.open));
    }
  };
  return bake(box, draw, into);
}

/** A radial gradient of `stops` round (x, y) out to `r`, in `g`'s space, each `share` strong. */
function tintGradient(
  g: CanvasRenderingContext2D,
  [x, y, r]: readonly [number, number, number],
  stops: TintStops,
  share: number,
): CanvasGradient {
  const gradient = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [offset, [red, green, blue], alpha] of stops) {
    gradient.addColorStop(offset, `rgba(${red}, ${green}, ${blue}, ${alpha * share})`);
  }
  return gradient;
}

/** The open hatch's green-white light, `open` (0 to 1) of its full, where `lit` sees; tiles. */
function bakeHatchGlow(g: CanvasRenderingContext2D, lit: FrameLit, open: number): void {
  const { x, y, glow: r } = lit.lamp;
  const glow = tintGradient(g, [x, y, r], HATCH_TINT, open);
  g.save();
  g.clip(lit.clip);
  g.fillStyle = glow;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

/**
 * Adds `fill` over the square `r` round (sx, sy) where `lit`'s lamp can
 * see — and within its beam, where it has one: lit, as the darkness was
 * cut, only where its light falls.
 */
function addLight(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  lit: FrameLit,
  fill: CanvasGradient,
  [sx, sy, r]: [number, number, number],
): void {
  ctx.save();
  inTiles(ctx, frame);
  ctx.clip(lit.clip);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cone = lit.lamp.beam;
  if (cone !== null) {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, r, cone.facing - cone.halfAngle, cone.facing + cone.halfAngle);
    ctx.closePath();
    ctx.clip();
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = fill;
  ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  ctx.restore();
}

/**
 * The emergency lamps' red over the dark, as brightly as they burn: a hot
 * spot where each hangs, dimming out to its reach, and cut off by the
 * walls like every light.
 */
function drawLampLight(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { burn } = frame;
  const r = EMERGENCY_GLOW * frame.camera.scale;
  for (const { mount, lit } of frame.light.lamps) {
    const [sx, sy] = toScreen(frame, mount.x, mount.y);
    const red = tintGradient(ctx, [sx, sy, r], EMERGENCY_TINT, burn);
    addLight(ctx, frame, lit, red, [sx, sy, r]);
  }
}

/** A lit room's light through an open door: a wedge of its colour falling into the dark. */
function drawSpillLight(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const stops = spillTint(mixTint(WARM.tint, ALARM_RED.tint, frame.red));
  for (const { lit, open } of frame.light.spills) {
    const [sx, sy] = toScreen(frame, lit.lamp.x, lit.lamp.y);
    const reach = SPILL_REACH * frame.camera.scale;
    const wedge = tintGradient(ctx, [sx, sy, reach], stops, open);
    addLight(ctx, frame, lit, wedge, [sx, sy, reach]);
  }
}

/** The red the escape bathes the world in, as far as it has turned, swelling with the siren. */
function drawEscapeTint(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const share = escapeTint(frame);
  if (share <= 0) {
    return;
  }
  const { w, h } = frame.viewport;
  const [r, g, b] = ESCAPE_RED;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${share})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
