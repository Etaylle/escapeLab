/**
 * The walkthrough's proof that a station's device fades out as it came (client
 * screens/Game.tsx, styles/interaction.css): what the page recorded of the panel on its own
 * clock as it was stepped back from, and a shot of the fade held part-way, against the panel
 * open and the panel gone. Pure.
 */

/**
 * A frame as the page drew it while the panel closed: when, on the page's clock, ms; whether
 * the panel was there, on its way out (`puzzle-modal--leaving`), inert; its opacity; and how far
 * its fade-out had run on the fade's own clock (the animation's currentTime, ms), null where no
 * fade-out ran on it.
 *
 * @typedef {{
 *   t: number, present: boolean, leaving: boolean, inert: boolean, opacity: number,
 *   fade: number | null
 * }} FadeSample
 */

/**
 * What the page recorded as the panel closed: when it began to leave and when it was gone, on
 * its own clock as its DOM changed (ms; null where it never did), whether it was inert as it
 * began to leave, and the frames it drew meanwhile.
 *
 * @typedef {{
 *   left: number | null, gone: number | null, inertAtLeft: boolean | null,
 *   frames: FadeSample[]
 * }} FadeRecord
 */

/**
 * The stretch of the fade, as shares of its length, in which a frame has to show the panel
 * midway: from half its length, where its ease-in has the panel at 0.86 opacity, to nine
 * tenths, at 0.28.
 */
export const MIDDLE = [0.5, 0.9];

/** How long a panel may take to go once it began to leave, ms: its fade, and a page's lag. */
export const GONE_MS = [100, 600];

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
 * What the page recorded as the panel closed (`record`, its fade-out `fadeMs` long) says, all
 * on the page's clock: whether the panel began to leave; how long it was leaving before it was
 * gone, ms (null where it never left, or never went); whether its opacity only fell; whether it
 * took nothing the while (inert); whether a fade-out ran on it; how many frames showed it
 * midway, its opacity past 0.05 and short of 0.95; how many frames the page drew in the fade's
 * middle (MIDDLE), each of which shows it midway where the fade falls as it should; and how far
 * the fade had run at each frame drawn while the panel left.
 *
 * @param {FadeRecord} record
 * @param {number} fadeMs
 * @returns {{
 *   left: boolean, ms: number | null, falling: boolean, inert: boolean, faded: boolean,
 *   midway: number, middle: number, drawn: Array<number | null>
 * }}
 */
export function fadeOf({ left, gone, inertAtLeft, frames }, fadeMs) {
  const leaving = frames.filter((s) => s.present && s.leaving);
  const [from, to] = MIDDLE.map((share) => share * fadeMs);
  const inMiddle = (s) => s.fade !== null && s.fade >= from && s.fade < to;
  return {
    left: left !== null,
    ms: left === null || gone === null ? null : gone - left,
    falling: leaving.every((s, i) => i === 0 || s.opacity <= leaving[i - 1].opacity + 1e-3),
    inert: inertAtLeft !== false && leaving.every((s) => s.inert),
    faded: leaving.some((s) => s.fade !== null),
    midway: leaving.filter((s) => s.opacity > 0.05 && s.opacity < 0.95).length,
    middle: leaving.filter(inMiddle).length,
    drawn: leaving.map((s) => s.fade),
  };
}

/**
 * The verdict on a fade as the page played it (`fade`, from fadeOf; `fadeMs` its length): what
 * is wrong with it, in the log's words — a panel gone at once or outside GONE_MS, an opacity
 * that rose, a panel taking input as it left, no fade-out on it, frames drawn in the fade's
 * middle none of which showed it midway — and, where no frame showed it midway because the page
 * drew none in the fade's middle, why the midway frames go unjudged, naming the frames' times.
 *
 * @param {ReturnType<typeof fadeOf>} fade
 * @param {number} fadeMs
 * @returns {{ faults: string[], unjudged: string | null }}
 */
export function fadeVerdict(fade, fadeMs) {
  const faults = [
    goneFault(fade),
    fade.falling ? null : 'its opacity rose on its way out',
    fade.inert ? null : 'it took input as it left',
    fade.faded ? null : 'no fade-out ran on it',
  ].filter((fault) => fault !== null);
  if (fade.midway > 0 || !fade.faded) {
    return { faults, unjudged: null };
  }
  const times = drawnText(fade.drawn);
  if (fade.middle > 0) {
    const came = `its frames came ${times} ms into the ${fadeMs}-ms fade`;
    return { faults: [...faults, `no frame showed it midway: ${came}`], unjudged: null };
  }
  const [from, to] = MIDDLE.map((share) => Math.round(share * fadeMs));
  const gone =
    fade.ms === null ? 'never gone' : `gone ${Math.round(fade.ms)} ms after it began to leave`;
  const unjudged =
    `the page drew no frame ${from} to ${to} ms into the ${fadeMs}-ms fade, only at ${times} ms ` +
    `of it, the panel ${gone}: no frame to judge midway; the held shot judges the fade`;
  return { faults, unjudged };
}

/** What is wrong with when the panel went (`left`, `ms` from fadeOf), or null. */
function goneFault({ left, ms }) {
  if (!left) {
    return 'it went at once, never leaving';
  }
  if (ms === null) {
    return 'it never went';
  }
  const [least, most] = GONE_MS;
  return ms >= least && ms <= most
    ? null
    : `it went ${Math.round(ms)} ms after it began to leave, on the page's clock`;
}

/**
 * The fade's times at the frames drawn while the panel left (fadeOf's `drawn`), ms, as the log
 * says them: „0, 17, 33", a dash for a frame without a fade-out.
 *
 * @param {Array<number | null>} drawn
 * @returns {string}
 */
export function drawnText(drawn) {
  return drawn.length === 0
    ? 'at no time'
    : drawn.map((ms) => (ms === null ? '–' : String(Math.round(ms)))).join(', ');
}
