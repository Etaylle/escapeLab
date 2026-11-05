import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchInsets } from '../src/world/insets.js';
import { clampCamera, liftAbove, tileCss } from '../src/world/viewport.js';

/** A line on the air's banner, one line high, as the stylesheet sets it at a laptop's size. */
const LINE = 38.3;

/**
 * An element laid out as insets.ts reads it — its class, its offsets within the objective bar,
 * its children. A radio banner stands one line high once it is in the page, and like any
 * element out of the page it measures nothing.
 */
class Laid {
  className: string;
  children: Laid[] = [];
  parent: Laid | null = null;
  style = { cssText: '' };
  textContent = '';
  layout: { top?: number; height?: number };
  tag: string;

  constructor(className = '', layout: { top?: number; height?: number } = {}, tag = 'div') {
    this.className = className;
    this.layout = layout;
    this.tag = tag;
  }

  /** How tall it stands, to the fraction. */
  height(): number {
    if (this.className === 'radio-banner') {
      return this.inPage() ? LINE : 0;
    }
    return this.layout.height ?? 0;
  }

  /** Its box, from the bar's top: an offset rounds it to whole pixels, a box does not. */
  getBoundingClientRect(): { top: number; bottom: number; height: number } {
    const top = this.layout.top ?? 0;
    return { top, bottom: top + this.height(), height: this.height() };
  }

  get offsetHeight(): number {
    return Math.round(this.height());
  }

  get offsetTop(): number {
    return Math.round(this.layout.top ?? 0);
  }

  get offsetWidth(): number {
    return 0;
  }

  get clientHeight(): number {
    return this.layout.height ?? 0;
  }

  get parentElement(): Laid | null {
    return this.parent;
  }

  inPage(): boolean {
    return this.parent !== null && (this.parent.className === 'stage' || this.parent.inPage());
  }

  append(child: Laid): void {
    child.parent = this;
    this.children.push(child);
  }

  remove(): void {
    if (this.parent !== null) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
  }

  setAttribute(): void {}

  matches(selector: string): boolean {
    return selector.startsWith('.') ? this.className === selector.slice(1) : this.tag === selector;
  }

  querySelector(selector: string): Laid | null {
    for (const child of this.children) {
      const found = child.matches(selector) ? child : child.querySelector(selector);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  closest(selector: string): Laid | null {
    return this.matches(selector) ? this : (this.parent?.closest(selector) ?? null);
  }
}

/** Blackout's objective bar at a laptop's size after the blackout: 81 px tall, the clock 57. */
function stageWith(clock = true) {
  const stage = new Laid('stage');
  const bar = new Laid('stage-top', { height: 81 });
  const goal = new Laid('stage-goal', { top: 12, height: 40 });
  goal.append(new Laid('', { top: 23, height: 23 }, 'h1'));
  bar.append(goal);
  if (clock) {
    bar.append(new Laid('stage-clock', { top: 12, height: 57 }));
  }
  const wrap = new Laid('world-wrap', { height: 671 });
  const canvas = new Laid('world-canvas', { height: 671 });
  wrap.append(canvas);
  stage.append(bar);
  stage.append(wrap);
  return { bar, goal, canvas: canvas as unknown as HTMLCanvasElement };
}

/** The measuring the ResizeObserver set off last, by hand. */
let resized: () => void = () => undefined;

describe('watchInsets — how far the objective bar reaches', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', Laid);
    vi.stubGlobal('document', { createElement: () => new Laid() });
    vi.stubGlobal('getComputedStyle', () => ({
      paddingTop: '12px',
      paddingBottom: '12px',
      rowGap: '10px',
    }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the bar with a line on the air steady while lines come and go', () => {
    const { bar, goal, canvas } = stageWith();
    const insets = watchInsets(canvas, null, () => undefined);
    expect(insets.top).toBe(81);
    // Its padding, the clock's column, the row gap and one line: 12 + 57 + 10 + 38.3 + 12.
    expect(insets.bar).toBeCloseTo(129.3, 9);
    // Mission control on the air: the bar grows a row — its reach now in whole pixels, as an
    // offset gives it —; the zoom's reach stays where it was.
    bar.append(new Laid('radio-banner'));
    bar.layout.height = 81 + 10 + LINE;
    resized();
    expect(insets.top).toBe(129);
    expect(insets.bar).toBeCloseTo(129.3, 9);
    // The escape: the checklist under the goal's title grows its column, not the steady row.
    goal.layout.height = 96;
    bar.layout.height = 120 + 10 + LINE;
    resized();
    expect(insets.bar).toBeCloseTo(129.3, 9);
  });

  it('takes the line it measured by out of the bar again: nothing else finds it', () => {
    const { bar, canvas } = stageWith();
    watchInsets(canvas, null, () => undefined);
    expect(bar.querySelector('.radio-banner')).toBeNull();
    expect(bar.children.map((child) => child.className)).toEqual(['stage-goal', 'stage-clock']);
  });

  it('counts the goal down to its title where no clock stands taller', () => {
    const { canvas } = stageWith(false);
    const insets = watchInsets(canvas, null, () => undefined);
    // The title's foot 23 + 23 px down, the goal's head at 12: 34 px, then the line's row.
    expect(insets.bar).toBeCloseTo(12 + 34 + 10 + LINE + 12, 9);
  });

  /**
   * A phone held sideways, its bar folded into the row (screens/hudFold.ts): no padding round
   * the 44-px row, the goal and the clock in it, over a canvas 345 px tall.
   */
  function foldedStage() {
    vi.stubGlobal('getComputedStyle', () => ({
      paddingTop: '0px',
      paddingBottom: '0px',
      rowGap: '0px',
    }));
    const stage = new Laid('stage');
    const bar = new Laid('stage-top', { height: 44 });
    const row = new Laid('stage-row', { top: 0, height: 44 });
    const goal = new Laid('stage-goal', { top: 8, height: 27 });
    goal.append(new Laid('', { top: 16, height: 19 }, 'h1'));
    row.append(goal);
    row.append(new Laid('stage-clock', { top: 8, height: 28 }));
    bar.append(row);
    const wrap = new Laid('world-wrap', { height: 345 });
    const canvas = new Laid('world-canvas', { height: 345 });
    wrap.append(canvas);
    stage.append(bar);
    stage.append(wrap);
    return { bar, canvas: canvas as unknown as HTMLCanvasElement };
  }

  it('counts the row a phone held sideways folds the bar into: a line adds nothing', () => {
    const { bar, canvas } = foldedStage();
    const insets = watchInsets(canvas, null, () => undefined);
    expect(insets.top).toBe(44);
    expect(insets.bar).toBe(44);
    // An alarm stands under the row while it lasts: the bar reaches lower, the zoom's reach stays.
    bar.append(new Laid('alarm', { top: 44, height: 40 }));
    bar.layout.height = 84;
    resized();
    expect(insets.top).toBe(84);
    expect(insets.bar).toBe(44);
  });

  it('frames that phone nine tiles high, the avatar lifted clear of the pad', () => {
    const { canvas } = foldedStage();
    const insets = watchInsets(canvas, null, () => undefined);
    const tile = tileCss({ height: 345, bar: insets.bar, touch: true });
    expect(tile).toBeCloseTo(345 / 9, 9);
    // At density 2, over the 36×22 lab: the pad reaches 158 px up from the canvas's foot — 12
    // px off it, three cells of 48 and its border (styles/world.css).
    const dpr = 2;
    const reach = 158;
    const lens = { scale: tile * dpr, w: 826 * dpr, h: 345 * dpr, top: insets.top * dpr };
    const lift = liftAbove(reach * dpr, lens.h, lens.top, lens.scale);
    expect(lift).toBeGreaterThan(0);
    const cam = clampCamera({ width: 36, height: 22 }, { x: 18, y: 11 }, { ...lens, lift });
    const screenY = (y: number): number => lens.h / 2 + (y - cam.y) * lens.scale;
    // The feet, half a tile under the spot, on the pad's top edge; the head a tile up, under it.
    expect(screenY(11.5)).toBeCloseTo(lens.h - reach * dpr, 6);
    expect(screenY(10)).toBeGreaterThan(lens.top);
  });

  it('reaches nothing on a canvas with no stage round it', () => {
    const canvas = new Laid('world-canvas', { height: 400 });
    new Laid('world-wrap', { height: 400 }).append(canvas);
    const insets = watchInsets(canvas as unknown as HTMLCanvasElement, null, () => undefined);
    expect(insets.top).toBe(0);
    expect(insets.bar).toBe(0);
  });
});
