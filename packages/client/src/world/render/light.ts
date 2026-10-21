import { bake, bakeBox, bakeStep, drawBaked, type Baked } from '../baked.js';
import { SPILL_REACH } from '../doors.js';
import { EMERGENCY_GLOW } from '../light.js';
import { ALARM_RED, ceilingLayer, mixTint, WARM, type CeilingLight } from '../power.js';
import { cutDarkness, roomUp, sirenSwell } from './darkness.js';
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
 * (`ending.lit`, 0 to 1), the darkness lifting as it does.
 */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const whole = frame.ending?.lit ?? 0;
  drawPower(ctx, frame, whole);
  if (!frame.spectator && whole < 1) {
    drawLighting(ctx, frame, 1 - whole);
  }
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

/** The open hatch's green-white light, `open` (0 to 1) of its full, where `lit` sees; tiles. */
function bakeHatchGlow(g: CanvasRenderingContext2D, lit: FrameLit, open: number): void {
  const { x, y, glow: r } = lit.lamp;
  const glow = g.createRadialGradient(x, y, 0, x, y, r);
  glow.addColorStop(0, `rgba(240, 255, 246, ${0.8 * open})`);
  glow.addColorStop(0.16, `rgba(160, 245, 196, ${0.5 * open})`);
  glow.addColorStop(0.5, `rgba(74, 222, 128, ${0.18 * open})`);
  glow.addColorStop(1, 'rgba(74, 222, 128, 0)');
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
    const red = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    red.addColorStop(0, `rgba(255, 112, 98, ${0.85 * burn})`);
    red.addColorStop(0.12, `rgba(255, 50, 42, ${0.42 * burn})`);
    red.addColorStop(0.5, `rgba(255, 38, 32, ${0.16 * burn})`);
    red.addColorStop(1, 'rgba(255, 38, 32, 0)');
    addLight(ctx, frame, lit, red, [sx, sy, r]);
  }
}

/** A lit room's light through an open door: a wedge of its colour falling into the dark. */
function drawSpillLight(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const [r, g, b] = mixTint(WARM.tint, ALARM_RED.tint, frame.red);
  for (const { lit, open } of frame.light.spills) {
    const [sx, sy] = toScreen(frame, lit.lamp.x, lit.lamp.y);
    const reach = SPILL_REACH * frame.camera.scale;
    const wedge = ctx.createRadialGradient(sx, sy, 0, sx, sy, reach);
    wedge.addColorStop(0, `rgba(${r},${g},${b},${0.3 * open})`);
    wedge.addColorStop(0.6, `rgba(${r},${g},${b},${0.1 * open})`);
    wedge.addColorStop(1, `rgba(${r},${g},${b},0)`);
    addLight(ctx, frame, lit, wedge, [sx, sy, reach]);
  }
}

/** The red the escape bathes the world in, as far as it has turned, swelling with the siren. */
function drawEscapeTint(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { red } = frame;
  if (red <= 0) {
    return;
  }
  const { w, h } = frame.viewport;
  const swell = sirenSwell(frame);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(255, 34, 22, ${(0.06 + 0.05 * swell) * red})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
