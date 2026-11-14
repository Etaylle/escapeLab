import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contrastOf, lineContrast, luminance, parseColour, TEXT_CONTRAST } from './contrast.mjs';

/** Pixels of the colours `rgbs`, four bytes each, opaque. */
const pixels = (...rgbs) => Uint8Array.from(rgbs.flatMap(([r, g, b]) => [r, g, b, 255]));

/** Whether `a` and `b` agree to `places` decimal places. */
const near = (a, b, places = 3) => Math.abs(a - b) < 10 ** -places;

describe('luminance and contrast — WCAG 2.2', () => {
  it('reads black as 0 and white as 1, the muted grey as about a quarter', () => {
    assert.equal(luminance([0, 0, 0]), 0);
    assert.equal(luminance([255, 255, 255]), 1);
    assert.ok(near(luminance([125, 143, 158]), 0.2647));
  });

  it('puts white on black at 21:1, either way round, and a colour on itself at 1:1', () => {
    assert.equal(contrastOf(1, 0), 21);
    assert.equal(contrastOf(0, 1), 21);
    assert.equal(contrastOf(0.3, 0.3), 1);
    assert.equal(TEXT_CONTRAST, 4.5);
  });
});

describe('parseColour', () => {
  it('reads rgb() and rgba() as getComputedStyle gives them', () => {
    assert.deepEqual(parseColour('rgb(125, 143, 158)'), { rgb: [125, 143, 158], alpha: 1 });
    assert.deepEqual(parseColour('rgba(198, 186, 165, 0.78)'), { rgb: [198, 186, 165], alpha: 0.78 });
    assert.deepEqual(parseColour('rgba(0, 0, 0, 0)'), { rgb: [0, 0, 0], alpha: 0 });
  });

  it('refuses a colour in any other form, naming it', () => {
    assert.throws(() => parseColour('#7d8f9e'), /colour #7d8f9e: not rgb\(\)/);
    assert.throws(() => parseColour('transparent'), /colour transparent/);
  });
});

describe('lineContrast', () => {
  it('judges the line by the lightest pixel behind it, not by their mean', () => {
    const behind = pixels([0, 0, 0], [0, 0, 0], [0, 0, 0], [128, 128, 128]);
    const { worst, lightest } = lineContrast('rgb(255, 255, 255)', behind);
    const grey = luminance([128, 128, 128]);
    assert.ok(near(lightest, grey));
    assert.ok(near(worst, contrastOf(1, grey)));
    assert.ok(worst < 4.5);
  });

  it('lays a translucent colour over each pixel as the page blends it', () => {
    const { worst } = lineContrast('rgba(255, 255, 255, 0.5)', pixels([0, 0, 0]));
    assert.ok(near(worst, contrastOf(luminance([127.5, 127.5, 127.5]), 0)));
    // Fully clear, the text is what lies behind it.
    assert.equal(lineContrast('rgba(255, 255, 255, 0)', pixels([40, 50, 60])).worst, 1);
  });

  it('reads every pixel, the last one too', () => {
    const behind = pixels([0, 0, 0], [0, 0, 0], [255, 255, 255]);
    assert.equal(lineContrast('rgb(0, 0, 0)', behind).worst, 1);
  });

  it('refuses no pixels, and a colour it cannot read', () => {
    assert.throws(() => lineContrast('rgb(1, 2, 3)', new Uint8Array(0)), /over no pixels/);
    assert.throws(() => lineContrast('red', pixels([0, 0, 0])), /colour red/);
  });
});
