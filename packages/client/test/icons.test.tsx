import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon, ICON_NAMES } from '../src/screens/Icon.js';
import { PICTOGRAPH } from './fixtures.js';

/** An icon's markup. */
const drawn = (name: (typeof ICON_NAMES)[number]): string =>
  renderToStaticMarkup(<Icon name={name} />);

describe('the icon set', () => {
  it.each(ICON_NAMES)('draws %s on the 16-unit square, sized and coloured by its text', (name) => {
    const html = drawn(name);
    expect(html.startsWith(`<svg class="icon icon-${name}" viewBox="0 0 16 16"`)).toBe(true);
    expect(html).toContain('width="1em" height="1em"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toMatch(/<(path|circle|rect)\b/);
    // Pure line work: no colour of its own, no text, no emoji.
    expect(html).not.toMatch(/(fill|stroke)="#/);
    expect(html).not.toMatch(/<text\b/);
    expect(html).not.toMatch(PICTOGRAPH);
  });

  it.each(ICON_NAMES)('keeps %s to the eye: the words beside it carry its meaning', (name) => {
    expect(drawn(name)).toContain('aria-hidden="true"');
    expect(drawn(name)).not.toContain('aria-label');
  });

  it('draws every icon differently', () => {
    const glyphs = ICON_NAMES.map((name) => drawn(name).replace(/^<svg[^>]*>/, ''));
    expect(new Set(glyphs).size).toBe(ICON_NAMES.length);
  });

  it('keeps every circle and box on the square', () => {
    for (const name of ICON_NAMES) {
      const numbers = [...drawn(name).matchAll(/ (?:cx|cy|x|y|width|height)="([\d.]+)"/g)];
      for (const [, value] of numbers) {
        expect(Number(value), name).toBeLessThanOrEqual(16);
      }
    }
  });
});
