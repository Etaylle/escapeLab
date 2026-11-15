import type { Wear } from '../art.js';
import { addCircle, roundRectPath, TAU } from '../brush.js';
import { BRASS, css, parseHex, PAPER, sink, STEEL, type Rgb } from '../palette.js';

/**
 * The workwear of the Forschungsanlage Kaltenbrunn, 1980s, as the menu's hero and its companion
 * wear it (docs/art-bible.md „The hero", Outfits): four outfits of the plant's own, drawn over the
 * crew figure as art.ts lays a `Wear` — flat shapes, a thin edge a step darker, the figure's rim
 * light over them — each leaving the body's colour, the player's crew colour, on the dome, the
 * front of the body and the legs. Which pair a visit of the menu shows is picked here too
 * (`visitOutfits`). Lengths in figure units, body space: facing right, the feet at the origin.
 */

/** The outfits, in the order the visits go through their pairs. */
export const OUTFITS = ['coat', 'suit', 'overall', 'watch'] as const;
export type Outfit = (typeof OUTFITS)[number];

/** What the hero and its companion wear on one visit of the menu: never the same. */
export interface OutfitPair {
  hero: Outfit;
  companion: Outfit;
}

/**
 * The pairs in the order the visits go through them: each outfit with the one after it, then
 * with the one two after, then three — so that from one visit to the next both figures change,
 * and every pair comes once in twelve.
 */
export const PAIRS: readonly OutfitPair[] = [1, 2, 3].flatMap((shift) =>
  OUTFITS.map((hero, i) => ({ hero, companion: OUTFITS[(i + shift) % OUTFITS.length] ?? hero })),
);

/** Where the browser keeps the pair the last visit showed. */
export const OUTFITS_KEY = 'escapelab.menuOutfits';

/** `pair` as it is kept. */
const keyOf = (pair: OutfitPair): string => `${pair.hero}/${pair.companion}`;

/**
 * The pair the visit after the one that showed `last` shows (kept as `keyOf` keeps it): the next
 * in PAIRS; where none was kept, or what was kept is no pair, one picked by `random` (0 to 1).
 */
export function nextOutfits(last: string | null, random: number): OutfitPair {
  const at = PAIRS.findIndex((pair) => keyOf(pair) === last);
  const index = at < 0 ? Math.floor(random * PAIRS.length) : at + 1;
  return PAIRS[index % PAIRS.length] ?? { hero: 'coat', companion: 'suit' };
}

/** The browser's storage that outlives the page, where it lets the page have one; else null. */
function keptStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The pair this visit of the menu shows (`nextOutfits`), kept for the next: coming back from a
 * lobby or a run, which loads the page anew, shows another. Where the browser keeps nothing, as
 * in a private window that refuses its storage, each visit picks one at random.
 */
export function visitOutfits(storage: Storage | null = keptStorage()): OutfitPair {
  let last: string | null = null;
  try {
    last = storage?.getItem(OUTFITS_KEY) ?? null;
  } catch {
    last = null;
  }
  const pair = nextOutfits(last, Math.random());
  try {
    storage?.setItem(OUTFITS_KEY, keyOf(pair));
  } catch {
    // A storage that refuses the write leaves the next visit to chance: it still shows a pair.
  }
  return pair;
}

/** How wide the edge round a piece of wear is, figure units: thinner than the body's outline. */
const EDGE_W = 0.018;

/** A piece of wear's colours: its cloth, its edge, and what is sewn or clipped onto it. */
interface Cloth {
  fill: string;
  edge: string;
}

/** `rgb` as cloth, sunk `night` for the lab at night as the body is: its edge a step darker. */
function clothOf(rgb: Rgb, night: number): Cloth {
  const lit = sink(rgb, night);
  return { fill: css(lit), edge: css(sink(lit, 0.5)) };
}

/** Fills the path `build` lays with `cloth` and strokes its edge. */
function shape(ctx: CanvasRenderingContext2D, cloth: Cloth, build: (p: CanvasPath) => void): void {
  ctx.beginPath();
  build(ctx);
  ctx.fillStyle = cloth.fill;
  ctx.fill();
  ctx.lineWidth = EDGE_W;
  ctx.strokeStyle = cloth.edge;
  ctx.stroke();
}

/** A line from `a` to `b` in `colour`, `w` wide, its ends round. */
function line(
  ctx: CanvasRenderingContext2D,
  [a, b]: readonly [readonly [number, number], readonly [number, number]],
  colour: string,
  w: number,
): void {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineCap = 'round';
  ctx.lineWidth = w;
  ctx.strokeStyle = colour;
  ctx.stroke();
}

/** The plant's cloths and fittings, lit as in a lit room: the wear sinks them for the night. */
const COAT_WHITE: Rgb = [226, 224, 214];
const BADGE_RED: Rgb = [196, 58, 48];
const PEN_BLUE: Rgb = [52, 84, 168];
const RUBBER: Rgb = [38, 42, 44];
const FILTER_GREY: Rgb = [84, 90, 92];
const HOOD_GREY: Rgb = [204, 208, 198];
const TAPE_YELLOW: Rgb = [232, 192, 40];
const HELMET_WHITE: Rgb = [236, 232, 216];
const REFLECTOR: Rgb = [236, 120, 40];
const LEATHER: Rgb = [104, 70, 42];
const NAVY: Rgb = [40, 50, 78];
const PEAK_BLACK: Rgb = [20, 22, 28];
const SILVER: Rgb = [190, 198, 204];

/**
 * The lab coat with its badge: white, open down the front over the body's colour, its lapel
 * folded, a pen in its breast pocket and the plant's red-striped badge clipped to it; its hem
 * hangs over the tops of the legs.
 */
function labCoat(night: number): Wear {
  const coat = clothOf(COAT_WHITE, night);
  const fold = clothOf(sink(COAT_WHITE, 0.22), night);
  const badge = clothOf(PAPER, night);
  const stripe = css(sink(BADGE_RED, night));
  const pen = css(sink(PEN_BLUE, night));
  return {
    body(ctx) {
      shape(ctx, coat, (p) => {
        p.moveTo(-0.3, -0.5);
        p.lineTo(0.02, -0.48);
        p.lineTo(0.06, -0.1);
        p.lineTo(-0.3, -0.1);
        p.closePath();
      });
      shape(ctx, fold, (p) => {
        p.moveTo(0.02, -0.48);
        p.lineTo(-0.04, -0.47);
        p.lineTo(0.01, -0.3);
        p.lineTo(0.035, -0.3);
        p.closePath();
      });
      shape(ctx, fold, (p) => roundRectPath(p, -0.19, -0.33, 0.11, 0.075, 0.012));
      line(ctx, [[-0.16, -0.37], [-0.16, -0.33]], pen, 0.022);
      shape(ctx, badge, (p) => roundRectPath(p, -0.06, -0.29, 0.085, 0.105, 0.01));
      ctx.fillStyle = stripe;
      ctx.fillRect(-0.06, -0.29, 0.085, 0.028);
    },
    over(ctx) {
      ctx.beginPath();
      ctx.moveTo(-0.215, -0.18);
      ctx.lineTo(0.058, -0.18);
      ctx.lineTo(0.065, -0.09);
      ctx.lineTo(-0.225, -0.09);
      ctx.closePath();
      ctx.fillStyle = coat.fill;
      ctx.fill();
      line(ctx, [[-0.225, -0.09], [0.065, -0.09]], coat.edge, EDGE_W);
      line(ctx, [[0.058, -0.18], [0.065, -0.09]], coat.edge, EDGE_W);
    },
  };
}

/**
 * The protective suit with its hood and filter: the suit in the body's colour, a pale hood over
 * the dome closed by a drawstring under it, the black rubber seal of the hood round the visor, a
 * filter screwed on at the chin, and the plant's yellow warning tape round the waist.
 */
function protectiveSuit(night: number): Wear {
  const hood = clothOf(HOOD_GREY, night);
  const seal = css(sink(RUBBER, night));
  const filter = clothOf(FILTER_GREY, night);
  const tape = css(sink(TAPE_YELLOW, night));
  const ink = css(sink(RUBBER, night));
  return {
    body(ctx) {
      shape(ctx, hood, (p) => p.rect(-0.3, -0.9, 0.6, 0.43));
      line(ctx, [[-0.24, -0.47], [0.24, -0.47]], hood.edge, 0.025);
      ctx.fillStyle = tape;
      ctx.fillRect(-0.24, -0.27, 0.48, 0.05);
      for (let x = -0.22; x < 0.24; x += 0.08) {
        line(ctx, [[x, -0.22], [x + 0.04, -0.27]], ink, 0.02);
      }
    },
    over(ctx) {
      ctx.beginPath();
      roundRectPath(ctx, -0.04, -0.7, 0.35, 0.24, 0.12);
      ctx.lineWidth = 0.035;
      ctx.strokeStyle = seal;
      ctx.stroke();
      shape(ctx, filter, (p) => addCircle(p, 0.2, -0.475, 0.06));
      ctx.beginPath();
      ctx.arc(0.2, -0.475, 0.032, 0, TAU);
      ctx.lineWidth = 0.02;
      ctx.strokeStyle = filter.edge;
      ctx.stroke();
    },
  };
}

/**
 * The technician's overall with its helmet and tool belt: a white hard hat with an orange
 * reflector band over the dome, its brim over the visor; a leather belt with a brass buckle, a
 * pouch at the front hip and a spanner hanging at the back.
 */
function technicianOverall(night: number): Wear {
  const helmet = clothOf(HELMET_WHITE, night);
  const band = css(sink(REFLECTOR, night));
  const belt = clothOf(LEATHER, night);
  const buckle = css(sink(BRASS, night));
  const spanner = css(sink(STEEL, night));
  return {
    body(ctx) {
      shape(ctx, belt, (p) => p.rect(-0.3, -0.27, 0.6, 0.055));
      ctx.fillStyle = buckle;
      ctx.fillRect(0.1, -0.275, 0.05, 0.065);
    },
    over(ctx) {
      line(ctx, [[-0.19, -0.23], [-0.21, -0.1]], spanner, 0.026);
      shape(ctx, belt, (p) => roundRectPath(p, 0.05, -0.24, 0.13, 0.1, 0.02));
      shape(ctx, helmet, (p) => {
        p.moveTo(-0.235, -0.67);
        p.arc(0, -0.63, 0.235, Math.PI + 0.17, -0.17);
        p.closePath();
      });
      ctx.fillStyle = band;
      ctx.fillRect(-0.215, -0.73, 0.43, 0.035);
      shape(ctx, helmet, (p) => roundRectPath(p, -0.25, -0.69, 0.6, 0.035, 0.017));
    },
  };
}

/**
 * The night watch's jacket with its cap and key ring: a navy jacket open over the body's colour
 * with a silver reflector band, a peaked cap with a brass badge over the dome, and the plant's
 * keys on a ring at the hip.
 */
function nightWatch(night: number): Wear {
  const jacket = clothOf(NAVY, night);
  const peak = clothOf(PEAK_BLACK, night);
  const brass = css(sink(BRASS, night));
  const silver = css(sink(SILVER, night));
  return {
    body(ctx) {
      shape(ctx, jacket, (p) => {
        p.moveTo(-0.3, -0.5);
        p.lineTo(0.03, -0.48);
        p.lineTo(0.04, -0.2);
        p.lineTo(-0.3, -0.2);
        p.closePath();
      });
      ctx.fillStyle = silver;
      ctx.fillRect(-0.3, -0.31, 0.335, 0.03);
      ctx.fillStyle = brass;
      for (const y of [-0.43, -0.37]) {
        ctx.beginPath();
        addCircle(ctx, 0.0, y, 0.014);
        ctx.fill();
      }
    },
    over(ctx) {
      shape(ctx, jacket, (p) => {
        p.moveTo(-0.2, -0.71);
        p.lineTo(-0.24, -0.84);
        p.quadraticCurveTo(0, -0.9, 0.24, -0.84);
        p.lineTo(0.2, -0.71);
        p.closePath();
      });
      shape(ctx, peak, (p) => {
        p.moveTo(0.06, -0.72);
        p.quadraticCurveTo(0.24, -0.735, 0.33, -0.69);
        p.lineTo(0.3, -0.675);
        p.quadraticCurveTo(0.2, -0.69, 0.06, -0.69);
        p.closePath();
      });
      ctx.fillStyle = brass;
      ctx.beginPath();
      addCircle(ctx, 0.12, -0.79, 0.024);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0.12, -0.17, 0.03, 0, TAU);
      ctx.lineWidth = 0.014;
      ctx.strokeStyle = brass;
      ctx.stroke();
      line(ctx, [[0.11, -0.145], [0.1, -0.09]], silver, 0.018);
      line(ctx, [[0.135, -0.145], [0.15, -0.1]], brass, 0.018);
    },
  };
}

/** What draws each outfit, sunk as far as the night asks. */
const WEAR: Readonly<Record<Outfit, (night: number) => Wear>> = {
  coat: labCoat,
  suit: protectiveSuit,
  overall: technicianOverall,
  watch: nightWatch,
};

/** The wear made so far, by outfit and night: made once, as a figure's layers are drawn anew. */
const made = new Map<string, Wear>();

/** What `outfit` draws over the crew figure, its cloth sunk `night` (0 to 1) for the night. */
export function wearOf(outfit: Outfit, night: number): Wear {
  const key = `${outfit} ${night}`;
  let wear = made.get(key);
  if (wear === undefined) {
    wear = WEAR[outfit](night);
    made.set(key, wear);
  }
  return wear;
}

/** The hue of `color` ('#rgb' or '#rrggbb'), 0 to 1 round the colour wheel. */
function hueOf(color: string): number {
  const [r, g, b] = parseHex(color).map((c) => c / 255) as [number, number, number];
  const hi = Math.max(r, g, b);
  const span = hi - Math.min(r, g, b);
  if (span === 0) {
    return 0;
  }
  const sector = hi === r ? (g - b) / span : hi === g ? 2 + (b - r) / span : 4 + (r - g) / span;
  return (((sector / 6) % 1) + 1) % 1;
}

/** How far apart two hues are round the wheel, 0 to 0.5. */
const hueApart = (a: number, b: number): number => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

/**
 * The crew colour the companion wears beside a hero in `color`: of `crew`, the one furthest from
 * it round the colour wheel, so that the two read as two people at a glance.
 */
export function companionColor(color: string, crew: readonly string[]): string {
  const own = hueOf(color);
  let best = crew[0] ?? color;
  for (const other of crew) {
    if (hueApart(hueOf(other), own) > hueApart(hueOf(best), own)) best = other;
  }
  return best;
}
