import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  askedFor,
  choosePath,
  openLightPath,
  pathNow,
  softwareRenderer,
  type LightPath,
  type PathFacts,
} from '../src/world/gl/path.js';
import type { Probes } from '../src/probes.js';

/**
 * Which way the world's light takes: the fallback table, and a world's way
 * opened on a canvas whose WebGL2 context is a stand-in — none at all, one
 * whose renderer draws in software or on a GPU, one whose shaders do not
 * compile, one that is lost and given back.
 */

const SWIFTSHADER =
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), ' +
  'SwiftShader driver)';
const APPLE = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)';

/** The facts of a hardware context nobody asked anything of, and `parts`. */
function facts(parts: Partial<PathFacts> = {}): PathFacts {
  return { asked: null, webgl2: true, lost: false, renderer: APPLE, ...parts };
}

describe('the fallback table', () => {
  it('takes the light layer on a GPU, the Canvas pass on a software renderer', () => {
    expect(choosePath(facts())).toEqual({ path: 'gl', reason: 'hardware renderer' });
    expect(choosePath(facts({ renderer: SWIFTSHADER }))).toEqual({
      path: 'canvas',
      reason: 'software renderer',
    });
  });

  it('keeps the Canvas pass without a WebGL2 context, with a lost one, and with ?gl=0', () => {
    expect(choosePath(facts({ webgl2: false, renderer: null })).path).toBe('canvas');
    expect(choosePath(facts({ webgl2: false })).reason).toBe('no WebGL2 context');
    expect(choosePath(facts({ lost: true }))).toEqual({
      path: 'canvas',
      reason: 'WebGL2 context lost',
    });
    expect(choosePath(facts({ asked: '0' }))).toEqual({ path: 'canvas', reason: '?gl=0' });
  });

  it('forces the layer on with ?gl=1, a software renderer too — not without a context', () => {
    const forced = facts({ asked: '1', renderer: SWIFTSHADER });
    expect(choosePath(forced)).toEqual({ path: 'gl', reason: '?gl=1' });
    expect(choosePath(facts({ asked: '1', webgl2: false })).path).toBe('canvas');
    expect(choosePath(facts({ asked: '1', lost: true })).path).toBe('canvas');
  });

  it('calls SwiftShader, llvmpipe, softpipe and anything “software” software — a GPU not', () => {
    const software = ['llvmpipe (LLVM 15.0.7, 256 bits)', 'Mesa softpipe', 'Software Rasterizer'];
    for (const name of [SWIFTSHADER, ...software]) {
      expect(softwareRenderer(name), name).toBe(true);
    }
    const gpus = ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)', 'Mesa Intel(R) UHD 620'];
    for (const name of [APPLE, ...gpus]) {
      expect(softwareRenderer(name), name).toBe(false);
    }
  });

  it('reads ?gl= off the page’s query string: 0 and 1, nothing else', () => {
    expect(askedFor('?gl=0')).toBe('0');
    expect(askedFor('?trace=1&gl=1')).toBe('1');
    expect(askedFor('?gl=yes')).toBeNull();
    expect(askedFor('')).toBeNull();
  });
});

/** A stand-in canvas whose WebGL2 context draws on `renderer` (null: none comes up). */
function glCanvas(renderer: string | null, compiles = true) {
  const listeners = new Map<string, (event: Event) => void>();
  const lose = vi.fn();
  const gl =
    renderer === null
      ? null
      : new Proxy(
          {},
          {
            get: (_, prop) => {
              if (typeof prop !== 'string') {
                return undefined;
              }
              if (/^[A-Z0-9_]+$/.test(prop)) {
                return prop.length;
              }
              const answers: Record<string, (...args: unknown[]) => unknown> = {
                getExtension: (name) =>
                  name === 'WEBGL_debug_renderer_info'
                    ? { UNMASKED_RENDERER_WEBGL: 'unmasked' }
                    : name === 'WEBGL_lose_context'
                      ? { loseContext: lose }
                      : null,
                getParameter: (what) => (what === 'unmasked' ? renderer : 'WebKit WebGL'),
                isContextLost: () => false,
                getShaderParameter: () => compiles,
                getProgramParameter: () => compiles,
                getShaderInfoLog: () => 'ERROR: 0:1: no such shader',
              };
              return answers[prop] ?? (() => ({}));
            },
          },
        );
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn((type: string) => (type === 'webgl2' ? gl : null)),
    addEventListener: (type: string, listener: (event: Event) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  return { canvas, lose, listeners };
}

/** The world's canvas, every pixel (r, g, b). */
function worldCanvas(r: number, g: number, b: number): HTMLCanvasElement {
  const data = new Uint8ClampedArray(4 * 6 * 4).map((_, i) => [r, g, b, 255][i % 4] ?? 0);
  return {
    width: 4,
    height: 6,
    getContext: () => ({ getImageData: () => ({ data }) }),
  } as unknown as HTMLCanvasElement;
}

describe('openLightPath — a world’s way for its light', () => {
  let window: { __escapelab?: Probes };
  let opened: LightPath[];
  /** The way opened on `fake` for a page asking `search`, the world drawn on `world`. */
  function open(fake: ReturnType<typeof glCanvas>, search: string, world = worldCanvas(0, 0, 0)) {
    vi.stubGlobal('document', { createElement: () => fake.canvas });
    const path = openLightPath(world, search);
    opened.push(path);
    return path;
  }
  beforeEach(() => {
    window = {};
    opened = [];
    vi.stubGlobal('window', window);
  });
  afterEach(() => {
    opened.forEach((path) => path.dispose());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds the layer on a GPU and keeps its context', () => {
    const fake = glCanvas(APPLE);
    const path = open(fake, '');
    expect(pathNow(path)).toBe('gl');
    expect(path.layer).not.toBeNull();
    expect(path.renderer).toBe(APPLE);
    expect(fake.lose).not.toHaveBeenCalled();
    path.dispose();
    expect(path.layer).toBeNull();
    expect(fake.lose).toHaveBeenCalledOnce();
  });

  it('keeps the Canvas pass on a software renderer, and gives the context back at once', () => {
    const fake = glCanvas(SWIFTSHADER);
    const path = open(fake, '');
    expect(pathNow(path)).toBe('canvas');
    expect(path.choice.reason).toBe('software renderer');
    expect(path.layer).toBeNull();
    expect(fake.lose).toHaveBeenCalledOnce();
  });

  it('asks for no context at all with ?gl=0, and keeps the Canvas pass without one', () => {
    const off = glCanvas(APPLE);
    expect(pathNow(open(off, '?gl=0'))).toBe('canvas');
    expect(off.canvas.getContext).not.toHaveBeenCalled();
    const none = glCanvas(null);
    const path = open(none, '');
    expect(path.choice).toEqual({ path: 'canvas', reason: 'no WebGL2 context' });
  });

  it('forces the layer on a software renderer with ?gl=1', () => {
    const path = open(glCanvas(SWIFTSHADER), '?gl=1');
    expect(pathNow(path)).toBe('gl');
    expect(path.choice.reason).toBe('?gl=1');
  });

  it('falls back to the Canvas pass, saying why, where the layer’s shaders do not compile', () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = glCanvas(APPLE, false);
    const path = open(fake, '');
    expect(pathNow(path)).toBe('canvas');
    expect(path.choice.reason).toMatch(/^layer failed: gl: the light vertex shader does not/);
    expect(said).toHaveBeenCalledOnce();
    expect(fake.lose).toHaveBeenCalledOnce();
  });

  it('falls back to the Canvas pass while the context is lost, builds the layer once back', () => {
    const fake = glCanvas(APPLE);
    const path = open(fake, '');
    const prevented = vi.fn();
    fake.listeners.get('webglcontextlost')?.({ preventDefault: prevented } as unknown as Event);
    expect(prevented).toHaveBeenCalled();
    expect(pathNow(path)).toBe('canvas');
    expect(path.choice.reason).toBe('WebGL2 context lost');
    fake.listeners.get('webglcontextrestored')?.({} as Event);
    expect(pathNow(path)).toBe('gl');
    path.dispose();
    expect(fake.listeners.size).toBe(0);
  });

  it('puts the probe on the page under ?trace=1: the way, renderer, why, a switch, luma', () => {
    const path = open(glCanvas(APPLE), '?trace=1', worldCanvas(200, 100, 50));
    const probe = window.__escapelab?.light;
    expect(probe).toMatchObject({ path: 'gl', renderer: APPLE, reason: 'hardware renderer' });
    probe?.use('canvas');
    expect(probe?.path).toBe('canvas');
    expect(probe?.reason).toBe('forced to canvas by the probe');
    expect(pathNow(path)).toBe('canvas');
    probe?.use(null);
    expect(probe?.path).toBe('gl');
    expect(probe?.luma()).toBeCloseTo(0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50);
    path.dispose();
    expect(window.__escapelab?.light).toBeUndefined();
  });

  it('never takes the layer where it has none, whatever the probe forces', () => {
    const path = open(glCanvas(SWIFTSHADER), '?trace=1');
    window.__escapelab?.light?.use('gl');
    expect(pathNow(path)).toBe('canvas');
    expect(open(glCanvas(APPLE), '').layer).not.toBeNull();
  });
});
