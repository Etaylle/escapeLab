import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The notepad's look (styles/notepad.css): the player's writing in a hand shipped with the game
 * — one woff2 of an OFL font, 60 kB at most, under public/fonts with its licence, loaded from
 * nowhere else —, captured tables in the pencil's monospace on ruled lines, everything at least
 * 15 px at text size 1 and 4.5:1 against the paper, following the text size, and nothing that
 * moves, so that reduced motion has nothing to change.
 */

const CLIENT = new URL('../', import.meta.url);
const css = readFileSync(new URL('src/styles/notepad.css', CLIENT), 'utf8');
const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector is `selector` and nothing else. */
function rulesOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
  const match = new RegExp(`(?:^|[};])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(plain);
  if (match?.[1] === undefined) {
    throw new Error(`notepad.css has no rule for ${selector}`);
  }
  return match[1];
}

/** A custom property's value as `.notepad` sets it. */
function token(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(rulesOf('.notepad'));
  if (match?.[1] === undefined) {
    throw new Error(`.notepad sets no ${name}`);
  }
  return match[1].trim();
}

/** A colour of the sheet as sRGB channels 0–255: #rrggbb only. */
function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) {
    throw new Error(`${hex} is no #rrggbb`);
  }
  return [match[1], match[2], match[3]].map((part) => parseInt(part ?? '0', 16)) as [
    number,
    number,
    number,
  ];
}

/** WCAG 2's contrast of two colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, bl] = rgb(hex).map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** The font sizes a rule sets, in px at text size 1: `calc(18px * var(--text-scale))`. */
function sizesIn(rules: string): number[] {
  return [...rules.matchAll(/calc\((\d+(?:\.\d+)?)px \* var\(--text-scale\)\)/g)].map((m) =>
    Number(m[1]),
  );
}

describe('the notepad’s hand', () => {
  const font = new URL('public/fonts/kalam-latin.woff2', CLIENT);

  it('is one woff2 of an OFL face under public/fonts, 60 kB at most, its licence beside it', () => {
    const bytes = readFileSync(font);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(statSync(font).size).toBeLessThanOrEqual(60 * 1024);
    const licence = readFileSync(new URL('public/fonts/kalam-OFL.txt', CLIENT), 'utf8');
    expect(licence).toContain('SIL Open Font License, Version 1.1');
    expect(licence).toContain('Indian Type Foundry');
    // The copyright statement reserves no name: a subset may keep it.
    expect(licence.split('\n')[0]).not.toMatch(/Reserved Font Name/i);
  });

  it('is loaded by the game itself, its stylesheet and the page’s preload, never a CDN', () => {
    const src = /src: url\('\/fonts\/kalam-latin\.woff2'\) format\('woff2'\);/;
    expect(rulesOf('@font-face')).toMatch(src);
    expect(plain).not.toMatch(/https?:/);
    const page = readFileSync(new URL('index.html', CLIENT), 'utf8');
    expect(page).toContain(
      '<link rel="preload" href="/fonts/kalam-latin.woff2" as="font" type="font/woff2" ' +
        'crossorigin />',
    );
  });

  it('writes the player’s own words, the captures’ heads and their running text', () => {
    expect(token('--pen-hand')).toBe("'Kalam', var(--hand)");
    const writing = /font: calc\(18px \* var\(--text-scale\)\) \/ var\(--rule\) var\(--pen-hand\);/;
    expect(rulesOf('.notepad-text')).toMatch(writing);
    expect(rulesOf('.notepad-capture-head')).toMatch(/var\(--pen-hand\)/);
    expect(rulesOf('.notepad-capture--text .notepad-capture-text')).toMatch(/var\(--pen-hand\)/);
  });
});

describe('the notepad’s paper and pencil', () => {
  it('rules the writing faintly and a table in pencil, the lines scrolling with the text', () => {
    const writing = rulesOf('.notepad-text,\n.notepad-capture--text .notepad-capture-text');
    expect(writing).toMatch(/repeating-linear-gradient\([\s\S]*var\(--pad-rule\)/);
    expect(writing).toMatch(/background-attachment: local;/);
    const table = rulesOf('.notepad-capture--table .notepad-capture-text');
    expect(table).toMatch(/var\(--mono\)/);
    expect(table).toMatch(/repeating-linear-gradient\([\s\S]*var\(--lead-rule\)/);
    expect(table).toMatch(/white-space: pre;/);
  });

  it('sets every text at 15 px or more at text size 1, every size following the setting', () => {
    for (const selector of [
      '.notepad-text',
      '.notepad-capture-head',
      '.notepad-capture-updated',
      '.notepad-capture--table .notepad-capture-text',
      '.notepad-capture--text .notepad-capture-text',
    ]) {
      const sizes = sizesIn(rulesOf(selector));
      expect(sizes.length, selector).toBeGreaterThan(0);
      expect(Math.min(...sizes), selector).toBeGreaterThanOrEqual(15);
    }
    expect(plain).not.toMatch(/font(?:-size)?:[^;]*\b\d+px(?! \* var\(--text-scale\))[^;]*;/);
  });

  it('keeps pen, pencils, the red pencil and the placeholder at 4.5:1 against the paper', () => {
    const paper = token('--pad-paper');
    /** The colour `property` takes in the rule of `selector`. */
    const colour = (selector: string, property: string): string =>
      new RegExp(`${property}:\\s*(#[0-9a-f]{6});`, 'i').exec(rulesOf(selector))?.[1] ?? '';
    const inks = {
      pen: token('--pen'),
      lead: token('--lead'),
      'second lead': colour('.notepad-capture:nth-of-type(even)', '--lead'),
      'red pencil': colour('.notepad-capture-updated', 'color'),
      placeholder: colour('.notepad-text::placeholder', 'color'),
    };
    for (const [name, ink] of Object.entries(inks)) {
      expect(contrast(ink, paper), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('moves nothing: reduced motion has nothing to change', () => {
    expect(plain).not.toMatch(/\banimation\b|\btransition\b|@keyframes/);
  });
});
