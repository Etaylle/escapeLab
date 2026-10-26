import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALARM, EMERGENCY, mix, rgba } from '../src/world/palette.js';
import { vignetteShown } from '../src/world/vignette.js';

const NOW = 1_700_000_000_000;

describe('vignetteShown — when the red edge is up', () => {
  it('comes up in the clock’s last minute and not before', () => {
    expect(vignetteShown(NOW + 61_000, NOW, false, false)).toBe(false);
    expect(vignetteShown(NOW + 59_000, NOW, false, false)).toBe(true);
    expect(vignetteShown(NOW - 1_000, NOW, false, false)).toBe(true);
  });

  it('stays up all through the escape, however much time is left', () => {
    expect(vignetteShown(NOW + 300_000, NOW, true, false)).toBe(true);
  });

  it('never shows on a run without a clock, nor once the run’s end plays', () => {
    expect(vignetteShown(null, NOW, true, false)).toBe(false);
    expect(vignetteShown(NOW + 1_000, NOW, true, true)).toBe(false);
  });
});

const FINALE = readFileSync(new URL('../src/styles/finale.css', import.meta.url), 'utf8');

/** What the block opened by `header` holds, up to its matching brace; '' where there is none. */
function blockAfter(source: string, header: string): string {
  const start = source.indexOf(header);
  const open = source.indexOf('{', start);
  if (start === -1 || open === -1) {
    return '';
  }
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source.charAt(i) === '{') {
      depth += 1;
    } else if (source.charAt(i) === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, i);
      }
    }
  }
  return '';
}

describe('the red edge as the stylesheet draws it', () => {
  const edge = blockAfter(FINALE, '.vignette {');

  it('lies over the world it frames, round its corners, and lets every press through', () => {
    expect(edge).toMatch(/position:\s*absolute;/);
    expect(edge).toMatch(/inset:\s*0;/);
    expect(edge).toMatch(/border-radius:\s*14px;/);
    expect(edge).toMatch(/pointer-events:\s*none;/);
    // No z-index of its own: it keeps its place in the tree, right after the canvas, and so
    // lies under the strobe, the coach and the controls after it, and under the bar.
    expect(edge).not.toMatch(/z-index/);
  });

  it('glows inwards in the palette’s emergency red, solid 50px in and blurred over 160px', () => {
    const red = rgba(mix(EMERGENCY, ALARM, 0.3), 0.34);
    expect(red).toBe('rgba(253, 70, 70, 0.34)');
    expect(edge).toContain(`box-shadow: inset 0 0 160px 50px ${red};`);
  });

  it('breathes by its opacity alone, from full to 0.55 and back over 1.1 s', () => {
    expect(edge).toMatch(/will-change:\s*opacity;/);
    expect(edge).toMatch(/animation:\s*vignette-breathe 1\.1s ease-in-out infinite;/);
    const breath = blockAfter(FINALE, '@keyframes vignette-breathe {');
    expect(breath.replace(/\s+/g, ' ').trim()).toBe('50% { opacity: 0.55; }');
  });

  it('holds still under reduced motion', () => {
    const calm = blockAfter(FINALE, ":where([data-motion='reduce'])");
    expect(calm).toMatch(/\.vignette,[^{]*\{\s*animation:\s*none;/);
  });
});
