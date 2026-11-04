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
  /**
   * the objective bar with a line on the air (`barWithLine`): steady while lines and notes
   * come and go, so that the camera's zoom, which keeps the band below it, holds
   */
  bar: number;
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
 * How tall the objective bar's steady row stands, CSS pixels, to the fraction (an offset is
 * rounded to whole pixels): the clock's column — the clock or the plant's state, the alarms
 * under it — or the goal down to its title, the taller; what comes and goes under the title, a
 * station's missing part, the escape's checklist, no part.
 */
function steadyRow(bar: HTMLElement): number {
  const clock = bar.querySelector('.stage-clock')?.getBoundingClientRect().height ?? 0;
  const goal = bar.querySelector('.stage-goal');
  const title = goal?.querySelector('h1') ?? null;
  const titled =
    goal === null || title === null
      ? 0
      : title.getBoundingClientRect().bottom - goal.getBoundingClientRect().top;
  return Math.max(clock, titled);
}

/**
 * How much a line on the air adds to the bar, CSS pixels, `gap` the bar's row gap: a radio
 * banner of one line, set into the bar unseen and taken out again before anything is drawn, so
 * that it measures what the stylesheet gives one there — the reader's text size, a phone's
 * smaller type — and nothing else ever finds it.
 */
function lineRow(bar: HTMLElement, gap: number): number {
  const line = document.createElement('div');
  line.className = 'radio-banner';
  line.setAttribute('aria-hidden', 'true');
  line.style.cssText = 'position: absolute; visibility: hidden; animation: none; white-space: nowrap';
  line.textContent = 'Leitstelle';
  bar.append(line);
  const { height } = line.getBoundingClientRect();
  line.remove();
  return gap + height;
}

/**
 * How far the objective bar reaches down with a line on the air, CSS pixels: its padding, its
 * steady row (`steadyRow`) and one line's row (`lineRow`) — what it reaches whenever mission
 * control speaks, whatever stands on the air now.
 */
function barWithLine(bar: HTMLElement): number {
  const style = getComputedStyle(bar);
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  return padding + steadyRow(bar) + lineRow(bar, parseFloat(style.rowGap) || 0);
}

/**
 * Measures how far the objective bar of the stage round `canvas` reaches into it, now and with
 * a line on the air, and where the groups of the controls `controls` lie on it, now and as they
 * resize; `onReach` hears the controls' reach each time.
 */
export function watchInsets(
  canvas: HTMLCanvasElement,
  controls: HTMLDivElement | null,
  onReach: (px: number) => void,
): Insets {
  const stageTop = canvas.closest('.stage')?.querySelector('.stage-top') ?? null;
  const wrap = canvas.parentElement;
  const insets: Insets = { top: 0, bar: 0, bottom: 0, controls: [], disconnect: () => undefined };
  const measure = (): void => {
    const bar = stageTop instanceof HTMLElement ? stageTop : null;
    insets.top = bar === null ? 0 : bar.offsetHeight;
    insets.bar = bar === null ? 0 : barWithLine(bar);
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
