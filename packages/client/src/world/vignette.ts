import { smooth } from './ease.js';

/**
 * The red edge of the clock's last minute and of the whole escape, drawn
 * into the world's canvas as the last thing on it (GameWorld.tsx). As an
 * element of its own over the page, breathing by its opacity, it made the
 * compositor redraw the whole window on every frame — the header's
 * backdrop blur and the page-wide overlays with it — which a machine without
 * a GPU could not keep up with: CI's escape ran at every other frame. Baked
 * once for the canvas's size, it now costs one plain copy a frame. Pure but
 * for the bake.
 */

/** The edge comes up this long before the deadline, ms. */
const LAST_MINUTE_MS = 60_000;
/** One breath, ms: from full to BREATH_LOW and back, easing in and out each way. */
export const BREATH_MS = 1100;
const BREATH_LOW = 0.55;
/** The edge's red, and how it reaches in, CSS pixels: solid as far as SPREAD, then blurred. */
const EDGE = 'rgba(248, 60, 60, 0.34)';
const SPREAD_PX = 50;
const BLUR_PX = 160;

/**
 * Whether the red edge shows: in the clock's last minute and all through
 * the escape (`escaping`) — never on a run without a clock, and no more once
 * the run's end plays on this screen (`ending`).
 */
export function vignetteShown(
  deadlineAt: number | null,
  now: number,
  escaping: boolean,
  ending: boolean,
): boolean {
  return !ending && deadlineAt !== null && (escaping || deadlineAt - now < LAST_MINUTE_MS);
}

/** How strong the edge is `ms` into its breathing, 0 to 1; held full under reduced motion. */
export function vignetteBreath(ms: number, reduced: boolean): number {
  if (reduced) {
    return 1;
  }
  const phase = (((ms % BREATH_MS) + BREATH_MS) % BREATH_MS) / BREATH_MS;
  const out = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return 1 - (1 - BREATH_LOW) * smooth(out);
}

/**
 * Bakes the edge into `into`, `width` × `height` device pixels at `dpr`
 * device pixels a CSS pixel: as CSS draws an inset box-shadow — everything
 * outside the canvas, grown in by the spread, casts its blurred shadow
 * inwards. The shape itself lies off the canvas; only its shadow falls on
 * it.
 */
export function bakeVignette(
  into: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number,
): void {
  into.width = width;
  into.height = height;
  const g = into.getContext('2d');
  if (g === null) {
    throw new Error('vignette: canvas.getContext("2d") returned null; cannot bake the red edge.');
  }
  const spread = SPREAD_PX * dpr;
  const blur = BLUR_PX * dpr;
  // Beyond twice its blur a shadow has faded to nothing; the shape reaches that far out.
  const reach = blur * 2;
  const away = width + 2 * reach;
  g.clearRect(0, 0, width, height);
  g.save();
  g.shadowColor = EDGE;
  g.shadowBlur = blur;
  g.shadowOffsetX = -away;
  g.fillStyle = '#000';
  g.beginPath();
  g.rect(away - reach, -reach, width + 2 * reach, height + 2 * reach);
  g.rect(away + spread, spread, Math.max(0, width - 2 * spread), Math.max(0, height - 2 * spread));
  g.fill('evenodd');
  g.restore();
}
