import { addProbes } from '../../probes.js';
import { traceRequested } from '../frameTrace.js';
import { createLightLayer, type LightLayer } from './lightLayer.js';
import { meanLuma } from './luma.js';

/**
 * Which way the world's light reaches the picture: through the WebGL light
 * layer (lightLayer.ts) or the Canvas pass (render/light.ts, the fallback).
 * Decided once a world is up, from the page's `?gl=` and the context it
 * gets: no WebGL2 context, a lost one or a software renderer — SwiftShader,
 * llvmpipe, Mesa's softpipe, anything calling itself software — keep the
 * Canvas pass, `?gl=0` too; `?gl=1` forces the layer on wherever a context
 * comes up, a software renderer included (the walkthrough's SHOTS_WEBGL).
 * Switching ways changes how the world is shaded, never what it shows.
 * With `?trace=1` the page carries the probe `window.__escapelab.light`.
 */

export type LightPathName = 'gl' | 'canvas';

/** What decides the way. */
export interface PathFacts {
  /** the page's `?gl=`: '0' keeps the layer off, '1' forces it on; null for neither */
  asked: '0' | '1' | null;
  /** a WebGL2 context came up */
  webgl2: boolean;
  /** the context was lost, and not given back */
  lost: boolean;
  /** what draws it, unmasked where the browser says; null where unknown */
  renderer: string | null;
}

/** The way, and why. */
export interface PathChoice {
  path: LightPathName;
  reason: string;
}

/** The probe the walkthrough reads (tools/shots.mjs), under `window.__escapelab.light`. */
export interface LightProbe {
  /** the way the light takes now */
  readonly path: LightPathName;
  /** what draws the WebGL context; null where none was asked for or none came up */
  readonly renderer: string | null;
  /** why the light takes that way */
  readonly reason: string;
  /** takes the light the other way for a comparison, or back to the decided one (null) */
  use(path: LightPathName | null): void;
  /** the mean luma of the world's canvas as last drawn, 0 to 255 (luma.ts) */
  luma(): number | null;
}

/** One world's way for its light: what was decided, and the layer where it draws. */
export interface LightPath {
  readonly asked: PathFacts['asked'];
  readonly renderer: string | null;
  choice: PathChoice;
  /** where the probe took the light the other way; null to follow the choice */
  forced: LightPathName | null;
  /** the layer, where the choice is GL and it built; null otherwise */
  layer: LightLayer | null;
  /** takes it all down: the layer, the context, the probe */
  dispose(): void;
}

/** Renderers that draw on the CPU: the light layer would cost every frame there. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software/i;

/** Whether `renderer` draws on the CPU. */
export function softwareRenderer(renderer: string): boolean {
  return SOFTWARE.test(renderer);
}

/** The page's `?gl=`, from its query string: '0', '1', or null for anything else. */
export function askedFor(search: string): PathFacts['asked'] {
  const value = new URLSearchParams(search).get('gl');
  return value === '0' || value === '1' ? value : null;
}

/** The way the light takes, and why: the fallback table. */
export function choosePath({ asked, webgl2, lost, renderer }: PathFacts): PathChoice {
  if (asked === '0') {
    return { path: 'canvas', reason: '?gl=0' };
  }
  if (!webgl2) {
    return { path: 'canvas', reason: 'no WebGL2 context' };
  }
  if (lost) {
    return { path: 'canvas', reason: 'WebGL2 context lost' };
  }
  if (asked === '1') {
    return { path: 'gl', reason: '?gl=1' };
  }
  if (renderer !== null && softwareRenderer(renderer)) {
    return { path: 'canvas', reason: 'software renderer' };
  }
  return { path: 'gl', reason: 'hardware renderer' };
}

/** The way the light of `state` takes now: as forced, else as chosen; GL only with a layer. */
export function pathNow(state: LightPath): LightPathName {
  const path = state.forced ?? state.choice.path;
  return path === 'gl' && state.layer !== null ? 'gl' : 'canvas';
}

/** What the context's renderer is called, unmasked where the browser allows. */
function rendererOf(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL);
  return typeof name === 'string' ? name : 'unknown';
}

/** The context attributes: an opaque canvas, nothing the passes do not use. */
const ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
};

/**
 * Builds the layer on `gl`; where a program does not build, says why on
 * the console and leaves the light to the Canvas pass.
 */
function buildLayer(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  state: LightPath,
): void {
  try {
    state.layer = createLightLayer(gl, canvas);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    console.error(`light layer: falling back to the Canvas pass — ${why}`);
    state.layer = null;
    state.choice = { path: 'canvas', reason: `layer failed: ${why}` };
  }
}

/**
 * Follows the context: lost, the light falls back to the Canvas pass;
 * given back, the layer is built again. Returns what stops following.
 */
function followContext(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  state: LightPath,
  facts: PathFacts,
): () => void {
  const lost = (event: Event): void => {
    event.preventDefault();
    state.layer = null;
    state.choice = choosePath({ ...facts, lost: true });
  };
  const restored = (): void => {
    state.choice = choosePath(facts);
    if (state.choice.path === 'gl') {
      buildLayer(gl, canvas, state);
    }
  };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  return () => {
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
  };
}

/** The probe on `state`, reading the world's canvas `world` for its luma. */
function probeOf(state: LightPath, world: HTMLCanvasElement): LightProbe {
  return {
    get path() {
      return pathNow(state);
    },
    get renderer() {
      return state.renderer;
    },
    get reason() {
      return state.forced === null ? state.choice.reason : `forced to ${state.forced} by the probe`;
    },
    use(path) {
      state.forced = path;
    },
    luma() {
      const g = world.getContext('2d');
      if (g === null || world.width === 0 || world.height === 0) {
        return null;
      }
      return meanLuma(g.getImageData(0, 0, world.width, world.height).data, 3);
    },
  };
}

/**
 * Holds `gl` for the layer where the choice is GL — building the layer and
 * following the context's loss — and gives it back at once where it is
 * not, or the layer does not build. Returns what gives it back.
 */
function holdContext(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  state: LightPath,
  facts: PathFacts,
): () => void {
  const release = (): void => {
    state.layer?.dispose();
    state.layer = null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  if (state.choice.path === 'gl') {
    buildLayer(gl, canvas, state);
  }
  if (state.layer === null) {
    release();
    return () => undefined;
  }
  const unfollow = followContext(canvas, gl, state, facts);
  return () => {
    unfollow();
    release();
  };
}

/**
 * The way for the light of the world drawn on `world`, for a page whose
 * query string is `search`: a WebGL2 context on a canvas of its own, unless
 * `?gl=0` — kept with the layer where the fallback table says GL, else
 * given back at once. Puts the probe on the page under `?trace=1`.
 */
export function openLightPath(world: HTMLCanvasElement, search: string): LightPath {
  const asked = askedFor(search);
  const canvas = asked === '0' ? null : document.createElement('canvas');
  const gl = canvas?.getContext('webgl2', ATTRIBUTES) ?? null;
  const facts: PathFacts = {
    asked,
    webgl2: gl !== null,
    lost: gl?.isContextLost() ?? false,
    renderer: gl === null ? null : rendererOf(gl),
  };
  const state: LightPath = {
    asked,
    renderer: facts.renderer,
    choice: choosePath(facts),
    forced: null,
    layer: null,
    dispose: () => undefined,
  };
  const drops: (() => void)[] = [];
  if (gl !== null && canvas !== null) {
    drops.push(holdContext(gl, canvas, state, facts));
  }
  if (traceRequested(search)) {
    drops.push(addProbes({ light: probeOf(state, world) }));
  }
  state.dispose = () => drops.splice(0).forEach((drop) => drop());
  return state;
}
