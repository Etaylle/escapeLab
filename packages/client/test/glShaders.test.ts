import { describe, expect, it } from 'vitest';
import {
  MAX_SOURCES,
  MAX_STEPS,
  PROGRAMS,
  SAMPLES,
  VECS_PER_SOURCE,
  type ProgramSource,
} from '../src/world/gl/shaders.js';

/**
 * jsdom has no WebGL: the light layer's shaders are checked by their
 * structure — the version line, every uniform the layer looks up declared
 * and nothing it does not, the outputs, the constants the TypeScript side
 * packs by, balanced brackets, nothing of GLSL ES 1.00.
 */

const programs = Object.entries(PROGRAMS) as [string, ProgramSource][];

/** The uniforms `source` declares, by name. */
function declared(source: string): string[] {
  return [...source.matchAll(/^[ \t]*uniform[ \t]+(?:\w+[ \t]+)?\w+[ \t]+(\w+)/gm)].map(
    (match) => match[1] ?? '',
  );
}

/** Whether every bracket of `source` closes the one opened last. */
function balanced(source: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const open: string[] = [];
  for (const char of source) {
    if ('([{'.includes(char)) {
      open.push(char);
    } else if (char in pairs && open.pop() !== pairs[char]) {
      return false;
    }
  }
  return open.length === 0;
}

describe('the light layer’s shaders, by their structure', () => {
  it('start each with the GLSL ES 3.00 version line, before anything else', () => {
    for (const [, { vertex, fragment }] of programs) {
      for (const source of [vertex, fragment]) {
        expect(source.startsWith('#version 300 es\n')).toBe(true);
        expect(source.match(/#version/g)).toHaveLength(1);
      }
    }
  });

  it('declare exactly the uniforms the layer looks up, each once', () => {
    for (const [name, { vertex, fragment, uniforms }] of programs) {
      const names = [...declared(vertex), ...declared(fragment)];
      expect(names.sort(), name).toEqual([...uniforms].sort());
      expect(new Set(names).size, name).toBe(names.length);
    }
  });

  it('use every uniform they declare beyond its declaration, so none is compiled away', () => {
    for (const [name, { vertex, fragment, uniforms }] of programs) {
      const body = `${vertex}\n${fragment}`.replace(/^\s*uniform .*$/gm, '');
      for (const uniform of uniforms) {
        expect(body.includes(uniform), `${name}: ${uniform}`).toBe(true);
      }
    }
  });

  it('give every fragment shader a precision and its outputs, two for the light pass', () => {
    for (const [name, { fragment }] of programs) {
      expect(fragment, name).toMatch(/^precision (highp|mediump) float;$/m);
      expect(fragment, name).toMatch(/^(layout\(location = 0\) )?out vec4 \w+;$/m);
    }
    expect(PROGRAMS.light.fragment).toMatch(/layout\(location = 0\) out vec4 outLight;/);
    expect(PROGRAMS.light.fragment).toMatch(/layout\(location = 1\) out vec4 outGlow;/);
  });

  it('pack and loop by the constants the TypeScript side uses', () => {
    const light = PROGRAMS.light.fragment;
    expect(light).toContain(`#define MAX_SOURCES ${MAX_SOURCES}`);
    expect(light).toContain(`#define SAMPLES ${SAMPLES}`);
    expect(light).toContain(`#define MAX_STEPS ${MAX_STEPS}`);
    expect(light).toContain(`#define VECS ${VECS_PER_SOURCE}`);
    expect(light).toContain('uniform vec4 uSources[MAX_SOURCES * VECS];');
    // Every vector of a light is read, and none past them.
    for (let v = 0; v < VECS_PER_SOURCE; v++) {
      expect(light).toContain(v === 0 ? 'uSources[i * VECS]' : `uSources[i * VECS + ${v}]`);
    }
    expect(light).not.toContain(`uSources[i * VECS + ${VECS_PER_SOURCE}]`);
    // The march and the penumbra stay within their bounds; the spec allows 24 steps, 3–5 samples.
    expect(light).toContain('for (int i = 0; i < MAX_STEPS; i++)');
    expect(light).toContain('for (int k = 0; k < SAMPLES; k++)');
    expect(MAX_STEPS).toBeLessThanOrEqual(24);
    expect(SAMPLES).toBeGreaterThanOrEqual(3);
    expect(SAMPLES).toBeLessThanOrEqual(5);
    expect(MAX_SOURCES).toBeLessThanOrEqual(32);
  });

  it('close every bracket, and keep to GLSL ES 3.00', () => {
    for (const [name, { vertex, fragment }] of programs) {
      for (const source of [vertex, fragment]) {
        expect(balanced(source), name).toBe(true);
        expect(source, name).not.toMatch(/gl_FragColor|texture2D|varying|attribute/);
        expect(source, name).not.toContain('${');
      }
    }
  });

  it('keep the light pass within the uniform room every WebGL2 GPU has (224 vectors)', () => {
    const vectors = MAX_SOURCES * VECS_PER_SOURCE + PROGRAMS.light.uniforms.length;
    expect(vectors).toBeLessThanOrEqual(224);
  });
});
