/**
 * The walkthrough's proof that a station's device fades out as it came (client
 * screens/Game.tsx, styles/interaction.css): what the page recorded of the panel frame by
 * frame as it was stepped back from, and a shot of the fade held part-way, against the panel
 * open and the panel gone. Pure.
 */

/** A frame as the page recorded it while the panel closed. */
/**
 * @typedef {{ t: number, present: boolean, leaving: boolean, inert: boolean, opacity: number }}
 *   FadeSample
 */

/**
 * The mean luma of `image` (a decoded PNG, tools/pixeldiff.mjs `decodePng`) over `box`, CSS
 * pixels, the picture taken at `scale` device pixels a CSS pixel.
 *
 * @param {{ width: number, height: number, rgba: Uint8Array }} image
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @param {number} [scale]
 * @returns {number} 0 to 255; 0 for a box that holds no pixel
 */
export function meanLuma(image, box, scale = 1) {
  const left = Math.max(0, Math.round(box.x * scale));
  const top = Math.max(0, Math.round(box.y * scale));
  const right = Math.min(image.width, Math.round((box.x + box.width) * scale));
  const bottom = Math.min(image.height, Math.round((box.y + box.height) * scale));
  let sum = 0;
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * image.width + x) * 4;
      sum += 0.2126 * image.rgba[i] + 0.7152 * image.rgba[i + 1] + 0.0722 * image.rgba[i + 2];
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * Whether `mid` lies between `open` and `closed`, at least `share` of their gap from either:
 * a picture of the panel on its way out, neither up nor gone.
 *
 * @param {number} open
 * @param {number} mid
 * @param {number} closed
 * @param {number} [share]
 * @returns {boolean}
 */
export function midway(open, mid, closed, share = 0.1) {
  const gap = Math.abs(open - closed);
  const low = Math.min(open, closed) + gap * share;
  const high = Math.max(open, closed) - gap * share;
  return gap > 0 && mid >= low && mid <= high;
}

/**
 * What the frames recorded as the panel closed say: how long it was leaving before it was
 * gone, ms (null where it never left, or never went); how many frames showed it midway, its
 * opacity past 0.05 and short of 0.95; whether its opacity only fell; whether it took nothing
 * the while (inert).
 *
 * @param {FadeSample[]} samples
 * @returns {{ ms: number | null, midway: number, falling: boolean, inert: boolean }}
 */
export function fadeOf(samples) {
  const leaving = samples.filter((s) => s.present && s.leaving);
  const first = leaving[0];
  const gone = samples.find((s) => !s.present && first !== undefined && s.t >= first.t);
  const falling = leaving.every((s, i) => i === 0 || s.opacity <= leaving[i - 1].opacity + 1e-3);
  return {
    ms: first === undefined || gone === undefined ? null : gone.t - first.t,
    midway: leaving.filter((s) => s.opacity > 0.05 && s.opacity < 0.95).length,
    falling,
    inert: leaving.every((s) => s.inert),
  };
}
