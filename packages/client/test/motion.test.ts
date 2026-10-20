import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Where a player asks for reduced motion, the devices shake nothing and move
 * nothing for longer than 120 ms (CALM_MS in puzzles/feel.ts). Their
 * stylesheets say so in their `prefers-reduced-motion: reduce` blocks: this
 * reads those blocks.
 */
const SRC = new URL('../src/', import.meta.url);
const SHEETS = [
  'styles/devices.css',
  ...readdirSync(new URL('puzzles/', SRC))
    .filter((name) => name.endsWith('.css'))
    .map((name) => `puzzles/${name}`),
];

/** The bodies of a stylesheet's reduced-motion blocks, comments taken out. */
function calmBlocks(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: string[] = [];
  const head = /@media \(prefers-reduced-motion: reduce\)\s*\{/g;
  for (let match = head.exec(source); match !== null; match = head.exec(source)) {
    let depth = 1;
    let i = head.lastIndex;
    for (; i < source.length && depth > 0; i++) {
      depth += source[i] === '{' ? 1 : source[i] === '}' ? -1 : 0;
    }
    blocks.push(source.slice(head.lastIndex, i - 1));
  }
  return blocks;
}

/** Every rule in a block: its selectors, and its declarations by property. */
function rulesOf(block: string): { selectors: string[]; declarations: Map<string, string> }[] {
  return [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors = '', body = '']) => ({
    selectors: selectors.split(',').map((selector) => selector.trim()),
    declarations: new Map(
      body
        .split(';')
        .map((declaration) => declaration.split(':').map((part) => part.trim()))
        .filter((pair): pair is [string, string] => pair.length >= 2 && pair[0] !== '')
        .map(([property, ...value]) => [property, value.join(':')] as [string, string]),
    ),
  }));
}

/** Every time a block names, in ms. */
function timesIn(block: string): number[] {
  return [...block.matchAll(/(?<![\w-])(\d+(?:\.\d+)?)(ms|s)\b/g)].map(([, value = '0', unit]) =>
    unit === 's' ? Number(value) * 1000 : Number(value),
  );
}

describe.each(SHEETS)('%s, with reduced motion', (sheet) => {
  const blocks = calmBlocks(readFileSync(new URL(sheet, SRC), 'utf8'));

  it('moves nothing for longer than 120 ms', () => {
    for (const block of blocks) {
      for (const ms of timesIn(block)) {
        expect(ms).toBeLessThanOrEqual(120);
      }
    }
  });
});

describe('the devices, with reduced motion', () => {
  const rules = SHEETS.flatMap((sheet) =>
    calmBlocks(readFileSync(new URL(sheet, SRC), 'utf8')).flatMap(rulesOf),
  );
  const animationOf = (selector: string): string | undefined =>
    rules.find((rule) => rule.selectors.includes(selector))?.declarations.get('animation');

  it('shakes nothing: no jolt, no shaking control, no shaking collar', () => {
    for (const selector of [
      '.device--alarm-odd',
      '.device--alarm-even',
      'button.feel-reject',
      '.sync-collar--missed',
    ]) {
      expect(animationOf(selector), selector).toBe('none');
    }
  });

  it('flashes an alarm and a bump once, still, where they would shake', () => {
    const strip = animationOf('.device--alarm-odd .device-strip-led');
    expect(strip).toBe('strip-calm-odd 120ms step-end');
    expect(animationOf('.maze-marker--bump-odd')).toBe('marker-calm 120ms step-end');
  });

  it('would notice a block that runs too long', () => {
    const [block = ''] = calmBlocks(
      '@media (prefers-reduced-motion: reduce) {\n  .a { animation: x 0.4s; }\n}\n',
    );
    expect(timesIn(block)).toEqual([400]);
    expect(rulesOf(block)[0]?.declarations.get('animation')).toBe('x 0.4s');
  });
});
