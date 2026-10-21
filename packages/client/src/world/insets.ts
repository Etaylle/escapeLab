/**
 * How far the HUD's overlays reach into the world's canvas. The objective
 * bar and the control cluster are HTML overlays lying on the canvas, and
 * both change height with their contents. Anything the canvas draws near
 * those edges has to keep clear, so we track them instead of assuming a
 * height: how far the bar reaches down from the top edge, and how far the
 * cluster reaches up from the bottom one.
 */

/** The overlays' reach into the canvas, CSS pixels, kept up to date as they resize. */
export interface Insets {
  /** the objective bar, down from the top edge */
  top: number;
  /** the control cluster, up from the bottom edge */
  bottom: number;
  /** stops keeping them up to date */
  disconnect: () => void;
}

/**
 * Measures how far the objective bar of the stage round `canvas` and the
 * control cluster `controls` reach into it, now and as they resize;
 * `onReach` hears the cluster's reach each time.
 */
export function watchInsets(
  canvas: HTMLCanvasElement,
  controls: HTMLDivElement | null,
  onReach: (px: number) => void,
): Insets {
  const stageTop = canvas.closest('.stage')?.querySelector('.stage-top') ?? null;
  const wrap = canvas.parentElement;
  const insets: Insets = { top: 0, bottom: 0, disconnect: () => undefined };
  const measure = (): void => {
    insets.top = stageTop instanceof HTMLElement ? stageTop.offsetHeight : 0;
    const reach = controls === null || wrap === null ? 0 : wrap.clientHeight - controls.offsetTop;
    insets.bottom = Math.max(0, reach);
    onReach(insets.bottom);
  };
  measure();
  const observer = new ResizeObserver(measure);
  for (const el of [stageTop, controls, wrap]) {
    if (el !== null) {
      observer.observe(el);
    }
  }
  insets.disconnect = () => observer.disconnect();
  return insets;
}
