import type { Direction } from './pad.js';

/**
 * Moving between a panel's controls with a controller: the D-pad, or a flick of the stick, goes
 * to the control lying nearest that way (`nextInDirection`), A presses it (`activate`). Which
 * panel: the dialog open on top, else the page as it stands (`menuScope`). A slider takes left
 * and right as its own steps.
 */

/** A box on the screen, CSS pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const middle = (box: Box): [number, number] => [
  (box.left + box.right) / 2,
  (box.top + box.bottom) / 2,
];

/** How far a control has to lie the way the stick points before it counts as lying that way. */
const AHEAD_PX = 1;
/** A step across the way counts this many times a step along it: the line of travel wins. */
const ACROSS_WEIGHT = 2;

/**
 * Of `candidates`, the one to go to from `from` towards `dir`: of those whose middle lies that
 * way, the nearest — a step across the way weighing ACROSS_WEIGHT times one along it. Null
 * where none lies that way.
 */
export function nextInDirection(
  from: Box,
  candidates: readonly Box[],
  dir: Direction,
): number | null {
  const [fx, fy] = middle(from);
  let best: number | null = null;
  let least = Infinity;
  candidates.forEach((box, i) => {
    const [cx, cy] = middle(box);
    const along = { right: cx - fx, left: fx - cx, down: cy - fy, up: fy - cy }[dir];
    const across = dir === 'left' || dir === 'right' ? Math.abs(cy - fy) : Math.abs(cx - fx);
    const score = along + ACROSS_WEIGHT * across;
    if (along > AHEAD_PX && score < least) {
      least = score;
      best = i;
    }
  });
  return best;
}

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** The controls in `scope` a controller can go to: shown, enabled, not in an inert part. */
export function focusables(scope: Element): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0 && el.closest('[inert]') === null,
  );
}

/**
 * What holds a controller inside it while it is open: anything modal, and a dialog that is not —
 * a panel over the menu, which leaves the profile's name beside it within reach.
 */
export const DIALOGS = '[aria-modal="true"], [role="dialog"]';

/**
 * The part of the page a controller moves in: the settings over everything, else the topmost
 * dialog (the last open one), else the quick chat's wheel open over the world, else the page;
 * null while the world takes the controller.
 */
export function menuScope(doc: Document): Element | null {
  const dialogs = [...doc.querySelectorAll(DIALOGS)].filter(
    (el) => el.closest('[inert]') === null && el.getClientRects().length > 0,
  );
  const settings = dialogs.find((el) => el.classList.contains('settings'));
  const dialog = settings ?? dialogs.at(-1);
  if (dialog !== undefined) {
    return dialog;
  }
  const wheel = doc.querySelector('.chat-wheel');
  if (wheel !== null && wheel.closest('[inert]') === null) {
    return wheel;
  }
  if (doc.querySelector('.world-wrap') !== null) {
    return null;
  }
  return doc.querySelector('.app') ?? doc.body;
}

/** The focused control, where it lies in `scope`; null elsewhere. */
function focusedIn(scope: Element): HTMLElement | null {
  const active = scope.ownerDocument.activeElement;
  return active instanceof HTMLElement && scope.contains(active) && active !== scope
    ? active
    : null;
}

/** A slider one step on, as a hand would move it: the page hears of it as of any input. */
function stepSlider(slider: HTMLInputElement, dir: 'left' | 'right'): void {
  const step = Number(slider.step) || 1;
  const value = Number(slider.value) + (dir === 'right' ? step : -step);
  const bounded = Math.min(Number(slider.max || 100), Math.max(Number(slider.min || 0), value));
  // React's controlled input listens for the native setter's change, then for `input`.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(slider, String(bounded));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
}

const isSlider = (el: HTMLElement | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && el.type === 'range';

/**
 * One move towards `dir` in `scope`: a slider in the focus steps itself left and right;
 * otherwise the focus goes to the nearest control that way — or, where none has it yet, to the
 * first. Returns whether anything moved.
 */
export function moveFocus(scope: Element, dir: Direction): boolean {
  const focused = focusedIn(scope);
  if (isSlider(focused) && (dir === 'left' || dir === 'right')) {
    stepSlider(focused, dir);
    return true;
  }
  const controls = focusables(scope).filter((el) => el !== focused);
  if (focused === null) {
    controls[0]?.focus();
    return controls.length > 0;
  }
  const next = nextInDirection(
    focused.getBoundingClientRect(),
    controls.map((el) => el.getBoundingClientRect()),
    dir,
  );
  if (next === null) {
    return false;
  }
  controls[next]?.focus();
  return true;
}

/** A's press in `scope`: the control in the focus is pressed; with none, the first gets it. */
export function activate(scope: Element): void {
  const focused = focusedIn(scope);
  if (focused === null) {
    focusables(scope)[0]?.focus();
    return;
  }
  focused.click();
}
