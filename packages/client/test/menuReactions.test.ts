import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_MS } from '../src/world/figure.js';
import {
  AWAY_FACING,
  headAt,
  HERO_FACING,
  heroTile,
  LOOK_SHARE,
  lookToward,
  STEP_MS,
  STEP_TILES,
  steppingAt,
} from '../src/world/menu/hero.js';
import { heroPainter, type HeroPainting } from '../src/world/menu/heroStage.js';
import { holdLamp } from '../src/world/menu/lamp.js';
import { FakePath2D } from './fakeCanvas.js';
import { DESKTOP_STAGE, painting, placedOn } from './heroPage.js';

/**
 * The hero's reactions to the menu (world/menu/hero.ts, heroStage.ts): its head turned a little
 * to the item hovered or in the focus — else to a run's card — in the walk cycle's turn steps;
 * half a tile aside while a panel lies open; turned away toward the lab as the menu goes for the
 * lobby; under reduced motion none of it but the step, a cut.
 */

const PLACE = placedOn(DESKTOP_STAGE);
/** Half a scene tile in figure units: how far the hero steps aside. */
const STEP = (STEP_TILES * heroTile(DESKTOP_STAGE.windowH)) / PLACE.scale;

describe('lookToward — a head turned a little', () => {
  it('turns its share of the way to what it looks at, and never round', () => {
    expect(lookToward(HERO_FACING + 0.5, HERO_FACING)).toBeCloseTo(HERO_FACING + LOOK_SHARE * 0.5);
    expect(lookToward(HERO_FACING - 0.5, HERO_FACING)).toBeCloseTo(HERO_FACING - LOOK_SHARE * 0.5);
    // Down the picture and to its right: the look stays on the menu's side of its line.
    for (const angle of [0.2, 1, 1.4, 4.9, 5.5]) {
      expect(Math.cos(lookToward(angle, HERO_FACING))).toBeLessThan(0);
    }
  });

  it('looks from its head, up from its feet and ahead to the menu’s side', () => {
    const head = headAt(PLACE, 0);
    expect(head.x).toBeLessThan(PLACE.feet.x);
    expect(head.y).toBeLessThan(PLACE.feet.y - 0.5 * PLACE.scale);
    expect(headAt(PLACE, 0.2).x - head.x).toBeCloseTo(0.2 * PLACE.scale, 9);
  });
});

describe('steppingAt — half a tile aside', () => {
  it('walks there over the panel’s slide, easing, its legs in their cycle', () => {
    const step = { from: 0, to: STEP, since: 1000 };
    expect(steppingAt(step, 1000, false)).toMatchObject({ offset: 0, moving: true });
    expect(steppingAt(step, 1000 + STEP_MS / 2, false).offset).toBeCloseTo(STEP / 2, 9);
    expect(steppingAt(step, 1000 + STEP_MS, false)).toMatchObject({ offset: STEP, moving: false });
    expect(steppingAt(step, 1000 + STEP_MS / 4, false).walk).toBeGreaterThan(0);
  });

  it('stands there at once under reduced motion', () => {
    const step = { from: 0, to: STEP, since: 1000 };
    expect(steppingAt(step, 1000, true)).toMatchObject({ offset: STEP, moving: false });
  });
});

/** Paints with `paint` at 30 frames a second from `from` for `ms`; returns where it stopped. */
function run(paint: (now: number) => boolean, from: number, ms: number): number {
  let now = from;
  for (; now < from + ms; now += 1000 / 30) paint(now);
  return now;
}

/** An item of the menu on the menu's left, as attended: `id` at its middle, `y` down. */
const item = (id: string, y: number) => ({ id, x: 300, y });

/** A page for the hero's painter: paths and a density, the lamp let go after. */
function stubPage(): void {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
    vi.stubGlobal('window', { devicePixelRatio: 1 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    holdLamp(null);
  });
}

describe('the hero’s head on the stage', () => {
  stubPage();

  it('turns its head to the item attended in the turn’s steps, and back as it goes', () => {
    const on = painting();
    const paint = heroPainter(on, 0);
    let now = run(paint, 0, 500);
    expect(on.probe.look).toBeNull();
    on.attends.current = item('join', 310);
    const looks: number[] = [];
    for (const end = now + 2 * TURN_MS; now < end; now += 1000 / 60) {
      paint(now);
      looks.push(on.probe.glance);
    }
    // Three steps of the walk cycle's turn, then held.
    expect(new Set(looks.map((look) => look.toFixed(6))).size).toBe(3);
    expect(on.probe.look?.at).toBe('join');
    expect(on.probe.look?.turned).toBeGreaterThan(0.2);
    on.attends.current = null;
    now = run(paint, now, 2 * TURN_MS);
    expect(on.probe.look).toBeNull();
    expect(on.probe.glance).toBeCloseTo(0, 9);
  });

  it('looks from its head: at an item level with it, straight across', () => {
    const on = painting();
    const paint = heroPainter(on, 0);
    const head = headAt(PLACE, 0);
    on.attends.current = { id: 'join', x: head.x - 400, y: head.y + 60 };
    run(paint, 0, 400);
    const across = LOOK_SHARE * (Math.PI - HERO_FACING);
    expect(on.probe.look?.turned).toBeCloseTo(across, 6);
  });

  it('looks up at an item high on the menu more than at one low on it', () => {
    const turnedTo = (y: number): number => {
      const on = painting();
      const paint = heroPainter(on, 0);
      on.attends.current = item('join', y);
      run(paint, 0, 400);
      return on.probe.look?.turned ?? 0;
    };
    expect(turnedTo(260)).toBeGreaterThan(turnedTo(560));
  });

  it('looks at a run’s card first in the menu while nothing else holds its eye', () => {
    const card = { closest: () => card, getBoundingClientRect: () => cardBox, dataset: {} };
    const cardBox = { left: 72, top: 240, width: 440, height: 160 };
    vi.stubGlobal('Element', Object);
    vi.stubGlobal('HTMLElement', Object);
    const stage = { querySelector: (selector: string) => (selector === '.bound' ? card : null) };
    const canvas = { parentElement: stage, style: {} } as unknown as HTMLCanvasElement;
    const on: HeroPainting = painting({ look: { card: true }, canvas });
    const paint = heroPainter(on, 0);
    run(paint, 0, 400);
    expect(on.probe.look?.at).toBe('card');
    on.attends.current = item('join', 310);
    run(paint, 400, 400);
    expect(on.probe.look?.at).toBe('join');
  });

});

describe('the hero stepping aside and turning away on the stage', () => {
  stubPage();

  it('steps half a tile aside while a panel lies open, and back as it closes', () => {
    const on = painting();
    const paint = heroPainter(on, 0);
    let now = run(paint, 0, 300);
    const resting = on.probe.box?.left ?? 0;
    Object.assign(on.look.current, { panel: true });
    now = run(paint, now, STEP_MS + 100);
    expect(on.probe.step).toBeCloseTo(1, 9);
    const stepped = (on.probe.box?.left ?? 0) - resting;
    expect(stepped).toBeCloseTo(0.5 * heroTile(DESKTOP_STAGE.windowH), 6);
    Object.assign(on.look.current, { panel: false });
    run(paint, now, STEP_MS + 100);
    expect(on.probe.step).toBeCloseTo(0, 9);
  });

  it('turns away to the lab as the menu goes for the lobby, in the turn’s steps', () => {
    const on = painting();
    const paint = heroPainter(on, 0);
    on.attends.current = item('join', 310);
    let now = run(paint, 0, 400);
    Object.assign(on.look.current, { leaving: true });
    const facings: number[] = [];
    for (const end = now + 2 * TURN_MS; now < end; now += 1000 / 60) {
      paint(now);
      facings.push(on.probe.facing);
    }
    expect(new Set(facings.map((facing) => facing.toFixed(6))).size).toBe(3);
    expect(on.probe.facing).toBeCloseTo(AWAY_FACING, 9);
    expect(Math.sin(AWAY_FACING)).toBeLessThan(0);
    expect(Math.cos(AWAY_FACING)).toBeLessThan(0);
    expect(on.probe.leaving).toBe(true);
    expect(on.probe.look).toBeNull();
  });

  it('under reduced motion turns no head and no back, and steps aside at once', () => {
    const on = painting({ reduced: true });
    const paint = heroPainter(on, 0);
    on.attends.current = item('join', 310);
    Object.assign(on.look.current, { panel: true, leaving: true });
    paint(0);
    expect(on.probe.look).toBeNull();
    expect(on.probe.facing).toBe(HERO_FACING);
    expect(on.probe.step).toBeCloseTo(1, 9);
  });
});
