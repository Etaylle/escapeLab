import { doorsShut } from '../light.js';
import { darknessDepth, ESCAPE_RED, escapeTint } from '../render/darkness.js';
import type { Frame, WorldMap } from '../render/frame.js';
import { ambientOf, occupancy, occupancyKey, wallFaces, type Pools } from './maps.js';
import { FLOATS_PER_SOURCE, packLights, viewOf } from './pack.js';
import {
  dropTarget,
  fillTexture,
  linkProgram,
  makeTarget,
  makeTexture,
  sizeTarget,
  uniformOf,
  type Program,
  type Target,
} from './programs.js';
import { BLOOM_THRESHOLD, MAX_SOURCES, PROGRAMS, type ProgramName } from './shaders.js';
import { lightsOf } from './sources.js';

/**
 * The light layer: an offscreen canvas with a WebGL2 context, sized to the
 * world's canvas at min(dpr, MAX_DPR), drawing each frame's light in four
 * passes (shaders.ts) — the light map in the upper half of its canvas,
 * glow and bloom in the lower — for render/light.ts to lay over the
 * picture. The map's textures are made again only as the map changes:
 * the faces of its walls once per map, which tiles stop light — walls,
 * furniture, shut doors — as the map's furniture or its doors change; the
 * light that is no lamp's every frame, a texel a tile.
 */

/** The layer draws at most this many pixels a CSS pixel, whatever the screen's density. */
export const MAX_DPR = 1.5;
/** How far apart the blur's taps lie, in quarter-size pixels: its width. */
const BLOOM_SPREAD = 1.6;
/** How strongly the bloom is added back. */
const BLOOM_GAIN = 1.1;

/** The layer's canvas after a frame, and the size of each of its two halves. */
export interface LayerOutput {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

export interface LightLayer {
  /** Draws the light of `frame`, the ceiling lights' pools as `pools` gives them. */
  render(frame: Frame, pools: Pools): LayerOutput;
  /** Releases every texture, target and program; the layer draws no more. */
  dispose(): void;
}

/** The layer's textures a texel a tile. */
interface MapTextures {
  occupancy: WebGLTexture;
  faces: WebGLTexture;
  keep: WebGLTexture;
  over: WebGLTexture;
  under: WebGLTexture;
}

/** The layer's render targets: the light pass's two, the bloom's three at a quarter size. */
interface Targets {
  light: Target;
  bright: Target;
  across: Target;
  down: Target;
}

/** What the layer worked out last, so that it is not worked out again. */
interface Kept {
  /** the map whose wall faces the texture holds, by its rows */
  tiles: string;
  /** the tiles stopping light the occupancy texture holds, by map, furniture and doors shut */
  occupancy: string;
}

/** The size of the layer's light map for a world canvas `w` × `h` at `dpr`. */
export function layerSize(w: number, h: number, dpr: number): { w: number; h: number } {
  const k = Math.min(dpr, MAX_DPR) / dpr;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** A layer drawing with `gl` into `canvas` (gl's own). Throws where a program does not build. */
export function createLightLayer(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
): LightLayer {
  const programs = linkAll(gl);
  const vao = gl.createVertexArray();
  const textures: MapTextures = {
    occupancy: makeTexture(gl, gl.NEAREST),
    faces: makeTexture(gl, gl.NEAREST),
    keep: makeTexture(gl, gl.NEAREST),
    over: makeTexture(gl, gl.LINEAR),
    under: makeTexture(gl, gl.LINEAR),
  };
  const sources = new Float32Array(MAX_SOURCES * FLOATS_PER_SOURCE);
  const kept: Kept = { tiles: '', occupancy: '' };
  let targets: Targets | null = null;
  return {
    render(frame, pools) {
      const size = layerSize(frame.viewport.w, frame.viewport.h, frame.viewport.dpr);
      targets = sized(gl, canvas, targets, size);
      mapTextures(gl, textures, kept, frame.map);
      ambientTextures(gl, textures, frame, pools);
      gl.bindVertexArray(vao);
      lightPass(gl, programs.light, { frame, size, textures, sources }, targets.light);
      bloomPasses(gl, programs, targets);
      outputPass(gl, programs.output, size, targets);
      return { canvas, ...size };
    },
    dispose() {
      if (targets !== null) {
        Object.values(targets).forEach((target) => dropTarget(gl, target));
      }
      Object.values(textures).forEach((texture) => gl.deleteTexture(texture));
      Object.values(programs).forEach(({ program }) => gl.deleteProgram(program));
      gl.deleteVertexArray(vao);
    },
  };
}

/** Every program of shaders.ts, linked, its samplers pointed at their texture units. */
function linkAll(gl: WebGL2RenderingContext): Record<ProgramName, Program> {
  const programs = {
    light: linkProgram(gl, 'light', PROGRAMS.light),
    bright: linkProgram(gl, 'bright', PROGRAMS.bright),
    blur: linkProgram(gl, 'blur', PROGRAMS.blur),
    output: linkProgram(gl, 'output', PROGRAMS.output),
  };
  const units: [ProgramName, string, number][] = [
    ['light', 'uOccupancy', 0],
    ['light', 'uFaces', 1],
    ['light', 'uKeep', 2],
    ['light', 'uOver', 3],
    ['light', 'uUnder', 4],
    ['bright', 'uSource', 0],
    ['blur', 'uSource', 0],
    ['output', 'uLight', 0],
    ['output', 'uGlow', 1],
    ['output', 'uBloom', 2],
  ];
  for (const [name, sampler, unit] of units) {
    gl.useProgram(programs[name].program);
    gl.uniform1i(uniformOf(programs[name], sampler), unit);
  }
  return programs;
}

/**
 * The canvas and the targets at the size of this frame's light map: the
 * canvas twice as tall, for the light map over glow and bloom; made on the
 * first frame, sized anew only as the world's canvas changes.
 */
function sized(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  targets: Targets | null,
  { w, h }: { w: number; h: number },
): Targets {
  if (canvas.width !== w || canvas.height !== h * 2) {
    canvas.width = w;
    canvas.height = h * 2;
  }
  const qw = Math.max(1, Math.ceil(w / 4));
  const qh = Math.max(1, Math.ceil(h / 4));
  if (targets === null) {
    return {
      light: makeTarget(gl, w, h, 2),
      bright: makeTarget(gl, qw, qh, 1),
      across: makeTarget(gl, qw, qh, 1),
      down: makeTarget(gl, qw, qh, 1),
    };
  }
  sizeTarget(gl, targets.light, w, h);
  for (const target of [targets.bright, targets.across, targets.down]) {
    sizeTarget(gl, target, qw, qh);
  }
  return targets;
}

/**
 * The map's textures: the faces of its walls once per map, which tiles stop
 * light again whenever a door has opened or shut since, or the furniture
 * stands elsewhere (another map).
 */
function mapTextures(
  gl: WebGL2RenderingContext,
  textures: MapTextures,
  kept: Kept,
  map: WorldMap,
): void {
  const size = [map.width, map.height] as const;
  const tiles = map.tiles.join('\n');
  if (kept.tiles !== tiles) {
    fillTexture(gl, textures.faces, size, 'rgba8', wallFaces(map));
    kept.tiles = tiles;
  }
  const shut = doorsShut(map);
  const occupied = occupancyKey(map, shut);
  if (kept.occupancy !== occupied) {
    fillTexture(gl, textures.occupancy, size, 'r8', occupancy(map, shut));
    kept.occupancy = occupied;
  }
}

/** The light that is no lamp's this frame, a texel a tile (maps.ts). */
function ambientTextures(
  gl: WebGL2RenderingContext,
  textures: MapTextures,
  frame: Frame,
  pools: Pools,
): void {
  const { map } = frame;
  const size = [map.width, map.height] as const;
  const ambient = ambientOf(frame, pools);
  fillTexture(gl, textures.keep, size, 'r8', ambient.keep);
  fillTexture(gl, textures.over, size, 'rgba8', ambient.over);
  fillTexture(gl, textures.under, size, 'rgba8', ambient.under);
}

/** Binds `textures` to texture units 0, 1, … in order. */
function bindUnits(gl: WebGL2RenderingContext, textures: readonly WebGLTexture[]): void {
  textures.forEach((texture, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  });
}

/** Draws the covering triangle into `target` (null: the canvas) over `width` × `height`. */
function cover(
  gl: WebGL2RenderingContext,
  target: Target | null,
  width: number,
  height: number,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
  gl.viewport(0, 0, width, height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** What the light pass draws from. */
interface LightInputs {
  frame: Frame;
  size: { w: number; h: number };
  textures: MapTextures;
  sources: Float32Array;
}

/** Every light at every pixel, with the rooms' light and the darkness (shaders.ts `light`). */
function lightPass(
  gl: WebGL2RenderingContext,
  program: Program,
  { frame, size, textures, sources }: LightInputs,
  target: Target,
): void {
  const { camera, map, viewport } = frame;
  const packed = packLights(lightsOf(frame), frame.time * 1000, viewOf(frame), sources);
  const u = (name: string): WebGLUniformLocation => uniformOf(program, name);
  gl.useProgram(program.program);
  gl.uniform2f(u('uView'), size.w, size.h);
  gl.uniform2f(u('uCamera'), camera.x, camera.y);
  gl.uniform1f(u('uScale'), (camera.scale * size.w) / viewport.w);
  gl.uniform2i(u('uMapSize'), map.width, map.height);
  gl.uniform1f(u('uDark'), darknessDepth(frame));
  gl.uniform1f(u('uVeil'), 1 - (frame.ending?.lit ?? 0));
  const [r, g, b] = ESCAPE_RED;
  gl.uniform4f(u('uTint'), r / 255, g / 255, b / 255, escapeTint(frame));
  gl.uniform1i(u('uCount'), packed.count);
  gl.uniform4fv(u('uSources'), packed.data);
  const { occupancy: occ, faces, keep, over, under } = textures;
  bindUnits(gl, [occ, faces, keep, over, under]);
  cover(gl, target, size.w, size.h);
}

/** What blooms, at a quarter of the size, blurred across and then down. */
function bloomPasses(
  gl: WebGL2RenderingContext,
  programs: Record<ProgramName, Program>,
  { light, bright, across, down }: Targets,
): void {
  const { bright: brightProgram, blur } = programs;
  gl.useProgram(brightProgram.program);
  gl.uniform2f(uniformOf(brightProgram, 'uTexel'), 1 / light.width, 1 / light.height);
  gl.uniform1f(uniformOf(brightProgram, 'uThreshold'), BLOOM_THRESHOLD);
  bindUnits(gl, light.textures.slice(0, 1));
  cover(gl, bright, bright.width, bright.height);
  gl.useProgram(blur.program);
  gl.uniform2f(uniformOf(blur, 'uSize'), bright.width, bright.height);
  const passes: [Target, Target, number, number][] = [
    [bright, across, BLOOM_SPREAD / bright.width, 0],
    [across, down, 0, BLOOM_SPREAD / bright.height],
  ];
  for (const [from, to, dx, dy] of passes) {
    gl.uniform2f(uniformOf(blur, 'uStep'), dx, dy);
    bindUnits(gl, from.textures.slice(0, 1));
    cover(gl, to, to.width, to.height);
  }
}

/** The layer's canvas: the light map over its upper half, glow and bloom over its lower. */
function outputPass(
  gl: WebGL2RenderingContext,
  program: Program,
  size: { w: number; h: number },
  { light, down }: Targets,
): void {
  gl.useProgram(program.program);
  gl.uniform2f(uniformOf(program, 'uView'), size.w, size.h);
  gl.uniform1f(uniformOf(program, 'uBloomGain'), BLOOM_GAIN);
  const [lightMap, glow] = light.textures;
  const [bloom] = down.textures;
  if (lightMap === undefined || glow === undefined || bloom === undefined) {
    throw new Error('gl: the light layer lost a target texture');
  }
  bindUnits(gl, [lightMap, glow, bloom]);
  cover(gl, null, size.w, size.h * 2);
}
