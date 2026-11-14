/**
 * Contrast as WCAG 2.2 measures it, for text that lies over a picture: a colour's relative
 * luminance, the ratio of two, and a line's colour against every pixel of what lies behind it.
 * The walkthrough measures the menu's quiet lines with it over the scene (shots.mjs
 * `checkMenuLines`).
 */

/** The least contrast WCAG 2.2 asks of text smaller than 18.66 px bold or 24 px (AA). */
export const TEXT_CONTRAST = 4.5;

/** A channel of 0 to 255 as light: the sRGB curve undone. */
function linear(channel) {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/**
 * The relative luminance of a colour, from 0 for black to 1 for white.
 *
 * @param {readonly number[]} rgb its red, green and blue, 0 to 255 each
 * @returns {number}
 */
export function luminance([r, g, b]) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * The contrast of two luminances, the lighter's over the darker's, from 1 to 21.
 *
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function contrastOf(a, b) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `rgb(r, g, b)` or `rgba(r, g, b, a)`, as getComputedStyle gives a colour. */
const COMPUTED = /^rgba?\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)(?:, (\d*\.?\d+))?\)$/;

/**
 * A colour as getComputedStyle gives it, as its channels and its alpha.
 *
 * @param {string} text `rgb(r, g, b)` or `rgba(r, g, b, a)`
 * @returns {{ rgb: number[], alpha: number }}
 * @throws {Error} for any other form of colour
 */
export function parseColour(text) {
  const m = COMPUTED.exec(text);
  if (m === null) {
    throw new Error(`colour ${text}: not rgb() or rgba() as getComputedStyle gives it`);
  }
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha };
}

/**
 * How text in `colour` stands against the pixels behind it: the colour laid over each pixel at
 * its alpha, as the page blends it, and the least contrast of the two at any pixel — WCAG's
 * measure where text lies over a picture — with the lightest pixel's luminance beside it.
 *
 * @param {string} colour the text's colour, as getComputedStyle gives it
 * @param {Uint8Array} rgba the pixels behind the text, four bytes a pixel (decodePng)
 * @returns {{ worst: number, lightest: number }}
 * @throws {Error} for no pixels, or a colour parseColour does not read
 */
export function lineContrast(colour, rgba) {
  if (rgba.length < 4) {
    throw new Error("line contrast over no pixels: shoot the line's box with something in it");
  }
  const { rgb, alpha } = parseColour(colour);
  let worst = Infinity;
  let lightest = 0;
  for (let p = 0; p + 3 < rgba.length; p += 4) {
    const behind = [rgba[p], rgba[p + 1], rgba[p + 2]];
    const back = luminance(behind);
    const over = luminance(rgb.map((c, i) => c * alpha + behind[i] * (1 - alpha)));
    worst = Math.min(worst, contrastOf(over, back));
    lightest = Math.max(lightest, back);
  }
  return { worst, lightest };
}
