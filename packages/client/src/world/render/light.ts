import { bakeBox, type TileBox } from '../baked.js';
import { poolsOfPixels } from '../gl/maps.js';
import { openLightPath, pathNow, type LightPath } from '../gl/path.js';
import {
  EMERGENCY_GLOW,
  EMERGENCY_TINT,
  HATCH_TINT,
  spillTint,
  type Run,
  type TintStops,
} from '../light.js';
import { ALARM_RED, ceilingLayer, WARM, type CeilingLight } from '../power.js';
import { layBake } from './bakes.js';
import { cutDarkness, ESCAPE_RED, escapeTint, roomUp, wedge } from './darkness.js';
import {
  inTiles,
  profiled,
  type Frame,
  type FrameLit,
  type PoweredRoom,
  type RenderKit,
  type WorldMap,
} from './frame.js';
import { drawStandby } from './standby.js';

/**
 * The light over the picture: the darkness, and what cuts it open — the
 * lab's own warm light in your room while it has its power. The audience
 * sees the lab whole, warm all over while the power is on; and so does
 * everybody as every room's light comes on at the end of a run won, and
 * through the opening's shot (`frame.whole`, 0 to 1), the darkness lifting as
 * it does. Where there is
 * darkness, the WebGL light layer draws it all where the world's way for
 * its light says so (gl/path.ts); else, and as its fallback, this pass.
 * Either way the standby lights glow over it (standby.ts). Every light that
 * stands still is laid on from its bake on the frame's grid (bakes.ts).
 */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const whole = frame.whole;
  const path = lightPathOf(frame.kit, ctx.canvas);
  if (onLayer(ctx, frame) && drawLayer(ctx, frame, path)) {
    drawStandby(ctx, frame);
    return;
  }
  drawPower(ctx, frame, whole);
  if (inTheDark(frame)) {
    drawLighting(ctx, frame, 1 - whole);
    drawStandby(ctx, frame);
  }
}

/** Whether the world lies in the dark: not the audience's, nor lit whole (`frame.whole`). */
function inTheDark(frame: Frame): boolean {
  return !frame.spectator && frame.whole < 1;
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

/** The lab's own light: all of it where it shows lit whole, else your room while it has power. */
function drawPower(ctx: CanvasRenderingContext2D, frame: Frame, whole: number): void {
  const { light, spectator } = frame;
  if (whole > 0) {
    drawPowerOn(ctx, frame, null, whole);
  } else if (frame.scene.lit && (spectator || light.room !== null)) {
    drawPowerOn(ctx, frame, light.room, 1);
  }
}

/**
 * Adds the ceiling lights' pools of `layer` (a pixel a tile) over `map` in
 * `g`, tile space, scaled up smoothly. Always added ('lighter'), into a bake
 * too: the canvas scales an image smoothly along that way, but in steps of a
 * sixteenth of a pixel along 'source-over'.
 */
function drawPools(g: CanvasRenderingContext2D, layer: HTMLCanvasElement, map: WorldMap): void {
  g.globalCompositeOperation = 'lighter';
  g.drawImage(layer, 0, 0, map.width, map.height);
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

/** The box of whole tiles round `runs`, cut to `map`; null for none. */
function runsBox(map: WorldMap, runs: readonly Run[]): TileBox | null {
  const tiles = runs.flatMap((run) => [
    { x: run.x, y: run.y },
    { x: run.x + run.length - 1, y: run.y },
  ]);
  return bakeBox(map, tiles, []);
}

/**
 * The lab with its power on: the ceiling lights' warm pools and a warm lift
 * over the picture, in `room` — a player's room, whole, nothing beyond its
 * walls; the audience, and everybody at the end of a run won, the whole lab
 * (null) — `strength` up. The pools come baked for the room or the lab; the
 * darkness goes over it after.
 */
function drawPowerOn(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  room: PoweredRoom | null,
  strength: number,
): void {
  const { map } = frame;
  const layer = layerOf(frame.kit, map, WARM);
  const whole = { x: 0, y: 0, w: map.width, h: map.height };
  const box = room === null ? whole : runsBox(map, room.light.runs);
  const name = room === null ? 'power:whole' : 'power:room';
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = strength;
  layBake(ctx, frame, { name, of: room ?? layer, box }, (g) => {
    if (room !== null) {
      g.clip(room.path);
    }
    drawPools(g, layer, map);
  });
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(255, 186, 128, 0.05)';
  if (room === null) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillRect(0, 0, frame.viewport.w, frame.viewport.h);
  } else {
    inTiles(ctx, frame);
    ctx.beginPath();
    for (const run of room.light.runs) {
      ctx.rect(run.x, run.y, run.length, 1);
    }
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The darkness over the picture, `veil` strong, with every light cut into
 * it where its lamp can see (darkness.ts); then the colours of the lights over it.
 */
function drawLighting(ctx: CanvasRenderingContext2D, frame: Frame, veil: number): void {
  const { overlay } = frame.kit;
  profiled(frame.kit, 'darkness', overlay, () => cutDarkness(overlay, frame));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = veil;
  ctx.drawImage(overlay.canvas, 0, 0);
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawRoomLight(ctx, frame);
  drawHatchGlow(ctx, frame);
  drawLampLight(ctx, frame);
  drawSpillLight(ctx, frame);
  ctx.restore();
  drawEscapeTint(ctx, frame);
}

/** The ceiling lights' colours: warm, and the escape's red. */
const TINTS = [
  { name: 'warm', light: WARM },
  { name: 'red', light: ALARM_RED },
] as const;

/**
 * The light the lit rooms add over the darkness: a room a solved station
 * lit glows warm again, as the whole lab did with the power on, as far as
 * its lights have come on, and turns red as the escape's siren sounds. Once
 * every room's lights are up and the red has come in or not at all, all of
 * them baked together in their colour and laid on in one go; while any is
 * still coming on, each room's ceiling lights baked once in each colour, cut
 * to its tiles, and laid on at the strength of the moment.
 */
function drawRoomLight(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const settled =
    (frame.red === 0 || frame.red === 1) &&
    [...frame.lit.values()].every((room) => roomUp(frame, room.since) >= 1);
  if (settled) {
    drawRoomsTogether(ctx, frame);
  } else {
    drawRoomsApart(ctx, frame);
  }
}

/** Every lit room's ceiling lights, up, in the escape's red or warm, baked together. */
function drawRoomsTogether(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { map, kit, lit } = frame;
  if (lit.size === 0) {
    return;
  }
  const { name, light } = frame.red === 1 ? TINTS[1] : TINTS[0];
  const layer = layerOf(kit, map, light);
  const of = `${name}|${[...lit.keys()].join('\n')}|${map.tiles.join('/')}`;
  const box = bakeBox(map, [...lit.values()].flatMap((room) => room.tiles), []);
  layBake(ctx, frame, { name: 'rooms', of, box }, (g) => {
    for (const room of lit.values()) {
      g.save();
      g.clip(room.path);
      drawPools(g, layer, map);
      g.restore();
    }
  });
}

/** Each lit room's ceiling lights in each colour, as far as they are up and the red has come. */
function drawRoomsApart(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { map, kit } = frame;
  const shares = [1 - frame.red, frame.red];
  for (const [label, room] of frame.lit) {
    const up = roomUp(frame, room.since);
    TINTS.forEach(({ name, light }, i) => {
      const share = (shares[i] ?? 0) * up;
      if (share <= 0) {
        return;
      }
      const layer = layerOf(kit, map, light);
      const box = bakeBox(map, room.tiles, []);
      ctx.globalAlpha = share;
      layBake(ctx, frame, { name: `room:${label}:${name}`, of: room.path, box }, (g) => {
        g.clip(room.path);
        drawPools(g, layer, map);
      });
    });
  }
  ctx.globalAlpha = 1;
}

/** A radial gradient of `stops` round (x, y) out to `r`, in `g`'s space. */
function tintGradient(
  g: CanvasRenderingContext2D,
  [x, y, r]: readonly [number, number, number],
  stops: TintStops,
): CanvasGradient {
  const gradient = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [offset, [red, green, blue], alpha] of stops) {
    gradient.addColorStop(offset, `rgba(${red}, ${green}, ${blue}, ${alpha})`);
  }
  return gradient;
}

/**
 * Lays the light `stops` of `lit` out to `r` tiles over `ctx`, where it can
 * see — in its beam's cone where it has one — from its bake `name`, baked
 * once for its sight.
 */
function layLit(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  name: string,
  [lit, stops, r]: readonly [FrameLit, TintStops, number],
): void {
  const { x, y } = lit.lamp;
  const box = bakeBox(frame.map, [], [{ x, y, r }]);
  layBake(ctx, frame, { name, of: lit.sight, box }, (g) => {
    g.clip(lit.clip);
    wedge(g, lit);
    g.fillStyle = tintGradient(g, [x, y, r], stops);
    g.fillRect(x - r, y - r, r * 2, r * 2);
  });
}

/**
 * The open hatch's green-white light spilling out as far as it has ground
 * open, cut off by the walls like every light.
 */
function drawHatchGlow(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const exit = frame.light.exit;
  if (exit !== null) {
    ctx.globalAlpha = exit.open;
    layLit(ctx, frame, 'glow:hatch', [exit.lit, HATCH_TINT, exit.lit.lamp.glow]);
    ctx.globalAlpha = 1;
  }
}

/**
 * The emergency lamps' red over the dark, as brightly as they burn: a hot
 * spot where each hangs, dimming out to its reach, and cut off by the
 * walls like every light.
 */
function drawLampLight(ctx: CanvasRenderingContext2D, frame: Frame): void {
  ctx.globalAlpha = frame.burn;
  for (const { mount, lit } of frame.light.lamps) {
    const name = `glow:lamp:${mount.x},${mount.y}`;
    layLit(ctx, frame, name, [lit, EMERGENCY_TINT, EMERGENCY_GLOW]);
  }
  ctx.globalAlpha = 1;
}

/** The light through an open door in each of the ceiling lights' colours. */
const SPILL_TINTS = TINTS.map(({ name, light }) => ({ name, stops: spillTint(light.tint) }));

/**
 * A lit room's light through an open door: a wedge of its colour falling
 * into the dark — warm, turning red with the escape — as far as it stands open.
 */
function drawSpillLight(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const shares = [1 - frame.red, frame.red];
  for (const { lit, open } of frame.light.spills) {
    const reach = lit.lamp.beam?.reach ?? 0;
    SPILL_TINTS.forEach(({ name, stops }, i) => {
      const share = (shares[i] ?? 0) * open;
      if (share > 0) {
        const id = `glow:spill:${lit.lamp.x},${lit.lamp.y}:${name}`;
        ctx.globalAlpha = share;
        layLit(ctx, frame, id, [lit, stops, reach]);
      }
    });
  }
  ctx.globalAlpha = 1;
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
