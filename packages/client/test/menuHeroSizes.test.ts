import { describe, expect, it } from 'vitest';
import {
  CLEAR,
  FIGURE_TALL,
  heroPlace,
  heroTile,
  SMALLEST_WINDOW,
  STEP_TILES,
  type HeroPlace,
  type StageFacts,
} from '../src/world/menu/hero.js';
import { PHONE_QUERY } from '../src/world/menu/heroStage.js';
import {
  elementsOf,
  holds,
  lengthOf,
  Sheets,
  splitTop,
  type Screen,
  type Styled,
} from './cascade.js';

/**
 * The hero at the sizes the menu is laid out for (world/menu/hero.ts `heroPlace`), the stage laid
 * out as the stylesheets lay it out (cascade.ts): about five scene tiles at 1280 × 720 and
 * 1440 × 820 and on a desktop, three or so at 1024 px across, smaller to 900 px and left out
 * below and on every phone; at every size nothing of it over the menu's column and its lead line,
 * the profile, or the widest panel — resting, or stepped half a tile aside for the panel — and
 * clear of the window's safe areas. The walkthrough measures the same in a browser
 * (tools/shots.mjs `checkHero`).
 */

const sheets = new Sheets();

/** The menu's stage as markup: its column, a panel, the profile with its figure. */
const [STAGE, BODY, PANEL, CHIP, FIGURE] = ((): Styled[] => {
  const nodes = elementsOf(
    '<div class="menu"><div class="menu-body"></div><section class="menu-panel"></section>' +
      '<section class="profile-chip"><canvas class="seat-figure"></canvas></section></div>',
  );
  const find = (name: string): Styled => {
    const node = nodes.find((each) => each.classes.includes(name));
    if (node === undefined) throw new Error(`no .${name}`);
    return node;
  };
  return ['menu', 'menu-body', 'menu-panel', 'profile-chip', 'seat-figure'].map(find);
})() as [Styled, Styled, Styled, Styled, Styled];

/** The top bar over the stage, CSS px: a line of its buttons and its padding (ui.css). */
const TOP_BAR = 61;

/** `value` read into px on `screen` for `node`: the safe areas none, `%` of `whole`. */
function lengthIn(node: Styled, value: string, screen: Screen, whole = 0): number {
  const plain = value.replace(/env\([^)]*\)/g, '0px').replace(/100%/g, `${whole}px`);
  return lengthOf(plain, { screen, em: 16, custom: (name) => sheets.custom(node, name, screen) });
}

/** What `property` of `node` comes to on `screen`: its four sides, top first, as a box's. */
function sidesOf(
  node: Styled,
  property: string,
  screen: Screen,
): [top: number, right: number, bottom: number, left: number] {
  const value = sheets.declared(node, property, screen)?.value ?? '0px';
  const parts = splitTop(value, ' ').map((part) => lengthIn(node, part, screen));
  const [top = 0, right = top, bottom = top, left = right] = parts;
  return [top, right, bottom, left];
}

/** The width `node` is declared at on `screen`, its `100%` being `whole`. */
const widthOf = (node: Styled, screen: Screen, whole: number): number =>
  lengthIn(node, sheets.declared(node, 'width', screen)?.value ?? '0px', screen, whole);

/** The stage on `screen` and what stands on it, as the stylesheets lay them out. */
function stageOn(screen: Screen, safe = { right: 0, bottom: 0 }): StageFacts {
  const [padTop, padRight, padBottom, padLeft] = sidesOf(STAGE, 'padding', screen);
  const content = screen.width - Math.max(padRight, safe.right) - padLeft;
  const [chipTop, , chipBottom] = sidesOf(CHIP, 'padding', screen);
  const figure = lengthIn(FIGURE, sheets.declared(FIGURE, 'height', screen)?.value ?? '0', screen);
  return {
    w: screen.width,
    h: screen.height - TOP_BAR,
    windowW: screen.width,
    windowH: screen.height,
    phone: holds(PHONE_QUERY, screen),
    padBottom,
    safeRight: safe.right,
    safeBottom: safe.bottom,
    menuRight: padLeft + widthOf(BODY, screen, content),
    panelRight: padLeft + widthOf(PANEL, screen, content),
    chipBottom: padTop + chipTop + figure + chipBottom + 2,
  };
}

/** A window `width` × `height` under a mouse. */
const at = (width: number, height: number): Screen => ({ width, height, coarse: false });

/** The five sizes the hero stands at: a desktop, the two laptops, 1024 px across, 900. */
const FIVE = [at(1920, 1080), at(1440, 820), at(1280, 720), at(1024, 768), at(900, 700)];

/** Where the hero stands on `facts`, there by the test's word. */
function placed(facts: StageFacts): HeroPlace {
  const place = heroPlace(facts);
  if (place === null) throw new Error(`no hero on ${JSON.stringify(facts)}`);
  return place;
}

/** The hero's box on the stage resting, and stepped half a tile aside for a panel. */
function boxesOf(place: HeroPlace, facts: StageFacts) {
  const step = STEP_TILES * heroTile(facts.windowH);
  const { left, top, width, height } = place.box;
  const resting = { left, top, right: left + width, bottom: top + height };
  return { resting, stepped: { ...resting, left: left + step, right: left + width + step } };
}

describe('the hero at the menu’s sizes', () => {
  it('stands about five scene tiles tall on a desktop and both laptops', () => {
    for (const screen of FIVE.slice(0, 3)) {
      expect(placed(stageOn(screen)).tiles).toBeGreaterThan(4.8);
      expect(placed(stageOn(screen)).tiles).toBeLessThan(5.2);
    }
  });

  it('shrinks to three tiles or so at 1024 px across, and smaller to 900', () => {
    const at1024 = [at(1024, 768), at(1024, 700), at(1024, 640)].map((s) => placed(stageOn(s)));
    for (const place of at1024) {
      expect(place.tiles).toBeGreaterThan(2.5);
      expect(place.tiles).toBeLessThan(3.3);
    }
    const narrow = placed(stageOn(at(900, 700)));
    expect(narrow.tiles).toBeLessThan(at1024[0]?.tiles ?? 0);
    expect(narrow.tiles).toBeGreaterThanOrEqual(1);
  });

  it('is left out below 900 px and on every phone: the profile’s figure stands for it', () => {
    expect(SMALLEST_WINDOW).toBe(900);
    expect(heroPlace(stageOn(at(899, 700)))).toBeNull();
    const phones: Screen[] = [
      { width: 844, height: 390, coarse: true },
      { width: 932, height: 430, coarse: true },
      { width: 420, height: 760, coarse: true },
      { width: 1024, height: 480, coarse: false },
    ];
    for (const phone of phones) {
      expect(holds(PHONE_QUERY, phone), `${phone.width}x${phone.height}`).toBe(true);
      expect(heroPlace(stageOn(phone)), `${phone.width}x${phone.height}`).toBeNull();
    }
    // On a phone it is left out whatever room the stage leaves it.
    expect(heroPlace({ ...stageOn(at(1440, 820)), phone: true })).toBeNull();
  });

  it('is left out where the room beside the panel holds less than a scene tile of it', () => {
    // A window 900 px across but tall: its tiles large, the room beside the panel not.
    expect(heroPlace(stageOn(at(900, 1400)))).toBeNull();
    expect(heroPlace(stageOn(at(900, 700)))).not.toBeNull();
  });

  it('covers nothing of the menu, its lead line, the profile or a panel at the five sizes', () => {
    for (const screen of FIVE) {
      const facts = stageOn(screen);
      const { resting, stepped } = boxesOf(placed(facts), facts);
      const size = `${screen.width}x${screen.height}`;
      // The menu's column — its items, the card, the lead line under them — ends at menuRight.
      expect(resting.left, size).toBeGreaterThanOrEqual(Math.floor(facts.menuRight + CLEAR));
      expect(resting.top, size).toBeGreaterThanOrEqual(Math.floor(facts.chipBottom + CLEAR));
      expect(stepped.left, size).toBeGreaterThanOrEqual(Math.floor(facts.panelRight + CLEAR));
      expect(stepped.right, size).toBeLessThanOrEqual(Math.ceil(facts.w - CLEAR));
      expect(resting.bottom, size).toBeLessThanOrEqual(Math.ceil(facts.h - facts.padBottom));
    }
  });

  it('keeps clear of a window’s safe areas, a notch at the right and a home bar under it', () => {
    const safe = { right: 47, bottom: 34 };
    for (const screen of [at(1180, 820), at(1366, 1024)]) {
      const facts = stageOn(screen, safe);
      const { resting, stepped } = boxesOf(placed(facts), facts);
      expect(stepped.right).toBeLessThanOrEqual(Math.ceil(facts.w - safe.right));
      expect(resting.bottom).toBeLessThanOrEqual(Math.ceil(facts.h - safe.bottom));
    }
  });

  it('reads the menu’s padding, column, widest panel and profile off the stylesheets', () => {
    const facts = stageOn(at(1440, 820));
    expect(facts.menuRight).toBeCloseTo(72 + 440, 6);
    expect(facts.panelRight).toBeCloseTo(72 + 760, 6);
    expect(facts.padBottom).toBeCloseTo(32.8, 6);
    expect(FIGURE_TALL * placed(facts).scale).toBeGreaterThan(300);
  });
});
