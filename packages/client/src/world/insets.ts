import { reachOf, type Box } from './viewport.js';

/**
 * How far the HUD's overlays reach into the world's canvas. The objective
 * bar and the controls are HTML overlays lying on the canvas, and both
 * change size with their contents. Anything the canvas draws near them has
 * to keep clear, so we track them instead of assuming a size: how far the
 * bar reaches down from the top edge, and where each group of the controls
 * lies — on a touch screen the steering pad in the bottom left corner and
 * the thumb's buttons in the bottom right one, with a keyboard the chat's
 * handle alone.
 */

/** The overlays' reach into the canvas, CSS pixels, kept up to date as they resize. */
export interface Insets {
  /** the objective bar, down from the top edge */
  top: number;
  /** how far the controls reach up from the bottom edge, the highest of them */
  bottom: number;
  /** each group of the controls shown, from the canvas's top left corner */
  controls: Box[];
  /** stops keeping them up to date */
  disconnect: () => void;
}

/** The groups `controls` shows — a hidden one has no size — as boxes from its parent's corner. */
function groupBoxes(controls: HTMLElement): Box[] {
  return [...controls.children].flatMap((group): Box[] => {
    if (!(group instanceof HTMLElement) || group.offsetWidth === 0) {
      return [];
    }
    const left = controls.offsetLeft + group.offsetLeft;
    const top = controls.offsetTop + group.offsetTop;
    return [{ left, top, right: left + group.offsetWidth, bottom: top + group.offsetHeight }];
  });
}

/**
 * Measures how far the objective bar of the stage round `canvas` reaches into it, and where
 * the groups of the controls `controls` lie on it, now and as they resize; `onReach` hears
 * the controls' reach each time.
 */
export function watchInsets(
  canvas: HTMLCanvasElement,
  controls: HTMLDivElement | null,
  onReach: (px: number) => void,
): Insets {
  const stageTop = canvas.closest('.stage')?.querySelector('.stage-top') ?? null;
  const wrap = canvas.parentElement;
  const insets: Insets = { top: 0, bottom: 0, controls: [], disconnect: () => undefined };
  const measure = (): void => {
    insets.top = stageTop instanceof HTMLElement ? stageTop.offsetHeight : 0;
    insets.controls = controls === null || wrap === null ? [] : groupBoxes(controls);
    insets.bottom = wrap === null ? 0 : reachOf(insets.controls, wrap.clientHeight);
    onReach(insets.bottom);
  };
  measure();
  const observer = new ResizeObserver(measure);
  const groups = controls === null ? [] : [...controls.children];
  for (const el of [stageTop, controls, wrap, ...groups]) {
    if (el !== null) {
      observer.observe(el);
    }
  }
  insets.disconnect = () => observer.disconnect();
  return insets;
}
