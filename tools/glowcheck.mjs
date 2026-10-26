/**
 * The glow round what the E prompt names, checked on its pixels (shots.mjs):
 * the walkthrough reads the halo's bake and the silhouette it was baked from
 * off the page (client world/render/highlight.ts) and asks whether the thing
 * glows in its own shape — strongly enough to be seen, nowhere farther from
 * its silhouette than the blur reaches, dark where the corners of the box
 * once drawn round it stood — and, from two reads of the canvas a second
 * apart, how far a part bobbing has moved up or down.
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

/** The mean of `values`. */
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);

/**
 * How far the picture `b` lies below the picture `a`, both `width` ×
 * `height` grey values, row by row: the shift within ±`most` whole pixels at
 * which `a` matches `b` best — by the mean absolute difference of the two,
 * each picture's own mean taken away first, so that light coming and going
 * over both counts for nothing — with that difference, and the one unshifted.
 */
export function verticalShift(a, b, width, height, most) {
  const ma = mean(a);
  const mb = mean(b);
  const costAt = (shift) => {
    let sum = 0;
    let count = 0;
    for (let y = Math.max(0, -shift); y < Math.min(height, height - shift); y++) {
      for (let x = 0; x < width; x++) {
        sum += Math.abs(a[y * width + x] - ma - (b[(y + shift) * width + x] - mb));
        count += 1;
      }
    }
    return count === 0 ? Infinity : sum / count;
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
