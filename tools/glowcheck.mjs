/**
 * The glow round what the E prompt names, checked on its pixels (shots.mjs):
 * the walkthrough reads the halo's bake and the silhouette it was baked from
 * off the page (client world/render/highlight.ts) and asks whether the thing
 * glows in its own shape — strongly enough to be seen, nowhere farther from
 * its silhouette than the blur reaches, dark where the corners of the box
 * once drawn round it stood — and, from two reads of the canvas a second
 * apart, how far a part bobbing has moved up or down on its own pixels, and
 * whether that is its bob (`bobVerdict`).
 */

/** A silhouette's pixel at least this opaque, of 255, is the thing. */
export const SOLID = 128;
/** A halo's pixel at least this strong, of 255, glows. */
export const GLOWING = 8;

/** `mask` (1 on, 0 off) grown `reach` pixels along one axis: rows, or columns with `columns`. */
function grow(mask, width, height, reach, columns) {
  const out = new Uint8Array(width * height);
  const [lines, length] = columns ? [width, height] : [height, width];
  const at = (line, i) => (columns ? i * width + line : line * width + i);
  for (let line = 0; line < lines; line++) {
    // How many pixels on the line lie on before each one: a window sums in constant time.
    const before = new Int32Array(length + 1);
    for (let i = 0; i < length; i++) {
      before[i + 1] = before[i] + (mask[at(line, i)] ? 1 : 0);
    }
    for (let i = 0; i < length; i++) {
      const from = Math.max(0, i - reach);
      const to = Math.min(length, i + reach + 1);
      out[at(line, i)] = before[to] - before[from] > 0 ? 1 : 0;
    }
  }
  return out;
}

/** The pixels within `reach` of an on pixel of `mask`, a square each way: `mask` dilated. */
export function dilate(mask, width, height, reach) {
  return grow(grow(mask, width, height, reach, false), width, height, reach, true);
}

/**
 * How a glow's halo lies against its silhouette, both `width` × `height`
 * alphas, row by row: its strongest pixel, how many pixels glow, how many of
 * those lie farther than `reach` pixels from the thing (none, for a glow in
 * its shape), and how many pixels the thing covers.
 */
export function haloAgainst({ halo, silhouette, width, height }, reach) {
  const solid = Uint8Array.from(silhouette, (alpha) => (alpha >= SOLID ? 1 : 0));
  const near = dilate(solid, width, height, reach);
  let strongest = 0;
  let glowing = 0;
  let stray = 0;
  for (let i = 0; i < width * height; i++) {
    const alpha = halo[i] ?? 0;
    strongest = Math.max(strongest, alpha);
    if (alpha >= GLOWING) {
      glowing += 1;
      stray += near[i] ? 0 : 1;
    }
  }
  return { strongest, glowing, stray, solid: solid.reduce((sum, on) => sum + on, 0) };
}

/**
 * The halo's strength at the four corners of `box` — tiles round the anchor,
 * as the old outline stood round the thing — each the strongest pixel
 * within `r` of the corner; null for a corner off the halo's canvas, where
 * nothing of the glow can lie.
 */
export function glowAtCorners({ level, left, top, width, height, halo }, box, r = 2) {
  const { x, y, w, h } = box;
  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ];
  return corners.map(([tx, ty]) => {
    const cx = Math.round(tx * level) - left;
    const cy = Math.round(ty * level) - top;
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
      return null;
    }
    let most = 0;
    for (let py = Math.max(0, cy - r); py <= Math.min(height - 1, cy + r); py++) {
      for (let px = Math.max(0, cx - r); px <= Math.min(width - 1, cx + r); px++) {
        most = Math.max(most, halo[py * width + px] ?? 0);
      }
    }
    return most;
  });
}

/** A pixel of the art at 64 px a tile: how far a part the E prompt names bobs (client BOB). */
export const ART_PX = 1 / 64;
/** How many of a part's own pixels its bob is judged on at least: fewer, and nothing is shown. */
export const BOB_PIXELS = 20;
/**
 * How far a part's own pixels spread round their grey's mean at least, in grey levels: a part
 * of one grey all over matches any patch of one grey, and shows no move.
 */
export const BOB_SPREAD = 8;
/** How far the part's shift on the canvas may lie from the one its lifts say, px. */
const BOB_SLACK = 1.5;

/**
 * The pairs of grey values `a` and `b` compare when `b` lies `shift` rows below `a`: each pixel
 * `mask` marks in `a` (1 on, 0 off) — both `width` wide, `height` high, row by row — with the
 * one `shift` rows below it in `b`, where that lies in the picture.
 */
function pairsAt(a, b, mask, width, height, shift) {
  const pairs = [];
  for (let y = Math.max(0, -shift); y < Math.min(height, height - shift); y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] === 1) {
        pairs.push([a[i], b[i + shift * width]]);
      }
    }
  }
  return pairs;
}

/**
 * `values` against their own mean and spread: how many spreads each lies above the mean; all
 * nought where they spread not at all.
 */
function standardized(values) {
  const middle = values.reduce((sum, v) => sum + v, 0) / values.length;
  const spread = Math.sqrt(values.reduce((sum, v) => sum + (v - middle) ** 2, 0) / values.length);
  return values.map((v) => (spread === 0 ? 0 : (v - middle) / spread));
}

/**
 * How far the picture `b` lies below the picture `a`, both `width` × `height` grey values, row
 * by row, judged on the pixels `mask` marks in `a` alone — a thing's own, where the still ground
 * round it, larger, would hold the match at no move: the shift within ±`most` whole pixels at
 * which the two match best — by the mean absolute difference of the pairs, each side taken
 * against its own mean and spread over them first, so that light brightening or dimming the
 * thing between the two counts for nothing — with that difference, and the one unshifted.
 */
export function verticalShift(a, b, mask, width, height, most) {
  const costAt = (shift) => {
    const pairs = pairsAt(a, b, mask, width, height, shift);
    if (pairs.length === 0) {
      return Infinity;
    }
    const za = standardized(pairs.map(([va]) => va));
    const zb = standardized(pairs.map(([, vb]) => vb));
    return za.reduce((sum, v, i) => sum + Math.abs(v - zb[i]), 0) / pairs.length;
  };
  let best = { shift: 0, cost: costAt(0) };
  for (let shift = -most; shift <= most; shift++) {
    const cost = costAt(shift);
    if (cost < best.cost) {
      best = { shift, cost };
    }
  }
  return { ...best, still: costAt(0) };
}

/**
 * Whether two reads of a part the E prompt names, taken at opposite peaks of its bob, show it
 * bob on the canvas. Each read holds how far the page drew it risen (`lift`, tiles), the
 * canvas's pixels a tile (`scale`) and the grey of the canvas round it (`grey`, `width` ×
 * `height`), its own pixels marked (`mask`) where the frame drew it. It bobbed where the lifts
 * lie on either side of its middle, BOB_PIXELS of it at least show and not all of one grey
 * (BOB_SPREAD), and those pixels moved down or up by as many canvas pixels as the lifts say,
 * BOB_SLACK off at most and closer than unmoved. With what was expected and what was found; not
 * fine where either read is missing.
 */
export function bobVerdict(first, second) {
  if (first === null || second === null) {
    return { fine: false, expected: 0, pixels: 0, spread: 0, shift: null, cost: null, still: null };
  }
  const expected = (first.lift - second.lift) * first.scale;
  const most = Math.ceil(3 * first.scale * ART_PX) + 2;
  const { grey, mask, width, height } = first;
  const moved = verticalShift(grey, second.grey, mask, width, height, most);
  const own = grey.filter((_, i) => mask[i] === 1);
  const count = Math.max(1, own.length);
  const middle = own.reduce((sum, v) => sum + v, 0) / count;
  const spread = Math.sqrt(own.reduce((sum, v) => sum + (v - middle) ** 2, 0) / count);
  const checks = [
    first.lift * second.lift < 0,
    own.length >= BOB_PIXELS,
    spread >= BOB_SPREAD,
    moved.shift !== 0,
    Math.sign(moved.shift) === Math.sign(expected),
    Math.abs(moved.shift - expected) <= BOB_SLACK,
    moved.cost < moved.still,
  ];
  return { fine: checks.every(Boolean), expected, pixels: own.length, spread, ...moved };
}
