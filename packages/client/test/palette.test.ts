import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CREW_COLORS } from '@escapelab/core';
import {
  CREW,
  css,
  inLight,
  lift,
  mix,
  night,
  parseHex,
  rgba,
  sink,
  TEAL,
  type Rgb,
} from '../src/world/palette.js';
import { FALLBACK_COLOR } from '../src/world/render/frame.js';

/**
 * The art bible's colour rule: every colour the world draws with comes from
 * palette.ts. A file of the world's drawing code may not carry a colour
 * literal — '#rgb', '#rrggbb', 'rgb(…)', 'rgba(…)', 'hsl(…)' — in any string
 * it writes; the TypeScript scanner reads its strings, so a comment or a
 * palette call never counts.
 */

const WORLD = fileURLToPath(new URL('../src/world/', import.meta.url));

/**
 * Left out, each for its reason: the palette itself; the light layer, which
 * the WebGL package owns until the two merge (it then moves its colours here);
 * render/frame.ts, appended to only while both packages work on it — its one
 * colour, the crew's fallback, is checked against the palette below.
 */
const NOT_DRAWING_CODE = new Set([
  'palette.ts',
  'light.ts',
  'baked.ts',
  'frameLight.ts',
  'render/light.ts',
  'render/darkness.ts',
  'render/frame.ts',
]);

const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/i;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === 'gl' ? [] : filesUnder(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const STRINGS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

/** The colour literals in the strings of `source`, each with its line. */
function colourLiterals(source: string): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, source);
  const found: string[] = [];
  let braces = 0;
  const templates: number[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    // The scanner reads a template's rest only when asked at its closing brace.
    if (token === ts.SyntaxKind.OpenBraceToken) {
      braces += 1;
    } else if (token === ts.SyntaxKind.CloseBraceToken && templates.at(-1) === braces) {
      templates.pop();
      token = scanner.reScanTemplateToken(false);
    } else if (token === ts.SyntaxKind.CloseBraceToken) {
      braces -= 1;
    }
    if (token === ts.SyntaxKind.TemplateHead || token === ts.SyntaxKind.TemplateMiddle) {
      templates.push(braces);
    }
    if (STRINGS.has(token) && COLOUR.test(scanner.getTokenText())) {
      const line = source.slice(0, scanner.getTokenStart()).split('\n').length;
      found.push(`${line}: ${scanner.getTokenText()}`);
    }
  }
  return found;
}

describe('the palette — the only colours the world draws with', () => {
  const files = filesUnder(WORLD).filter((path) => !NOT_DRAWING_CODE.has(relative(WORLD, path)));

  it.each(files.map((path) => [relative(WORLD, path), path]))(
    '%s writes no colour literal',
    (_name, path) => {
      expect(colourLiterals(readFileSync(path, 'utf8'))).toEqual([]);
    },
  );

  it('covers the world’s drawing code: art, the passes, the dressing, the particles', () => {
    const names = files.map((path) => relative(WORLD, path));
    for (const name of ['art.ts', 'decor.ts', 'wallProps.ts', 'surfaces.ts', 'render/tiles.ts']) {
      expect(names).toContain(name);
    }
  });

  it('finds a literal in a string or a template, and none in a comment or a call', () => {
    expect(colourLiterals("const a = '#2dd4bf';")).toHaveLength(1);
    expect(colourLiterals('const a = `rgba(${r}, 0, 0, 1)`;')).toHaveLength(1);
    expect(colourLiterals('const a = `${x} and rgb(1, 2, 3)`;')).toHaveLength(1);
    expect(colourLiterals('// a #fff comment\nconst a = rgba(TEAL, 0.3);')).toEqual([]);
  });

  it('keeps the crew’s colours as the server hands them out, the fallback the first', () => {
    expect(CREW).toEqual([...CREW_COLORS]);
    expect(CREW).toHaveLength(8);
    expect(FALLBACK_COLOR).toBe(css(TEAL));
    expect(CREW[0]).toBe(css(TEAL));
  });
});

describe('the palette’s mixing', () => {
  const grey: Rgb = [100, 100, 100];

  it('writes a colour as #rrggbb and with an alpha, clamped', () => {
    expect(css([45, 212, 191])).toBe('#2dd4bf');
    expect(css([300, -4, 10.6])).toBe('#ff000b');
    expect(rgba([45, 212, 191], 0.3)).toBe('rgba(45, 212, 191, 0.3)');
    expect(rgba([0, 0, 0], 2)).toBe('rgba(0, 0, 0, 1)');
  });

  it('lifts toward white, sinks toward black, mixes in between', () => {
    expect(lift(grey, 0.5)).toEqual([177.5, 177.5, 177.5]);
    expect(sink(grey, 0.25)).toEqual([75, 75, 75]);
    expect(mix([0, 0, 0], [200, 100, 50], 0.5)).toEqual([100, 50, 25]);
  });

  it('shows a material darker and colder in the dark than under the ceiling lights', () => {
    const dark = night(grey);
    expect(dark[0] + dark[1] + dark[2]).toBeLessThan(150);
    expect(dark[2]).toBeGreaterThan(dark[0]);
    expect(inLight(grey, true)).toBe(grey);
    expect(inLight(grey, false)).toEqual(dark);
  });

  it('reads the crew’s colours, and turns away anything else by name', () => {
    expect(parseHex('#2dd4bf')).toEqual([45, 212, 191]);
    expect(parseHex('#abc')).toEqual([170, 187, 204]);
    expect(() => parseHex('teal')).toThrow(/'#rgb' or '#rrggbb'/);
  });
});
