import {
  CLEAR,
  figureBox,
  GLANCE_STEP,
  HERO_BOX,
  HERO_FACING,
  heroPlace,
  heroTile,
  leftmostFeet,
  lookToward,
  STEP_TILES,
  stepped,
  type HeroPlace,
  type StageFacts,
} from './hero.js';

/**
 * The hero's companion (docs/art-bible.md „The hero", The companion): a second figure of the
 * crew standing with the hero where the stage has room for both — smaller and further back in
 * the room, beside the hero's back, its head and its clipboard clear of the hero's dome, so that
 * the two read as depth, the hero's canvas over its own. Pure: where the two stand (pairPlace),
 * and where the companion looks (companionLook). Lengths in CSS px, but where figure units are
 * said: the hero's, as hero.ts counts them.
 */

/** How large the companion stands against the hero: a step back into the room. */
export const COMPANION_SHARE = 0.58;
/** How far behind the hero its feet stand, up the floor, hero figure units. */
export const COMPANION_BACK = 0.7;
/**
 * How far right of the hero's feet its own stand, hero figure units: far enough that its body,
 * its head and the clipboard before it stand clear of the hero's dome — the hero's pack the most
 * of it the hero hides.
 */
export const COMPANION_ASIDE = 0.42;

/** What the companion's box gives up to whole pixels at either side, CSS px: as the hero's. */
const ROUNDING = 1;

/** Where the hero and its companion stand on the stage; the companion null where it does not. */
export interface PairPlace {
  hero: HeroPlace | null;
  companion: HeroPlace | null;
}

/** `place` moved `by` CSS px to the left. */
function shiftedLeft(place: HeroPlace, by: number): HeroPlace {
  const feet = { x: place.feet.x - by, y: place.feet.y };
  return { ...place, feet, box: figureBox(feet, place.scale) };
}

/**
 * Where the hero (hero.ts heroPlace) and its companion stand on the stage `f`: the companion
 * COMPANION_SHARE of the hero, COMPANION_BACK behind it and COMPANION_ASIDE right of it, clear of
 * the stage's right edge and its safe area by CLEAR stepped half a tile aside with the hero as a
 * panel opens — the two moved left together as far as that asks, the hero no further than its
 * room lets it (hero.ts leftmostFeet), clear of the menu's column and the widest panel. The
 * companion is left out, the hero standing where heroPlace has it, where no hero stands, where
 * even moved the two do not fit, or where its head would rise into the stage's padding at its top.
 */
export function pairPlace(f: StageFacts): PairPlace {
  const hero = heroPlace(f);
  if (hero === null) {
    return { hero, companion: null };
  }
  const scale = hero.scale * COMPANION_SHARE;
  const step = STEP_TILES * heroTile(f.windowH);
  const right = f.w - Math.max(CLEAR, f.safeRight) - step - ROUNDING;
  const x = hero.feet.x + COMPANION_ASIDE * hero.scale;
  const shift = Math.max(0, x + HERO_BOX.back * scale - right);
  const y = hero.feet.y - COMPANION_BACK * hero.scale;
  const fits = hero.feet.x - shift >= leftmostFeet(f, hero.scale);
  if (!fits || y - HERO_BOX.top * scale < f.ceiling + CLEAR) {
    return { hero, companion: null };
  }
  const feet = { x: x - shift, y };
  const tiles = hero.tiles * COMPANION_SHARE;
  const companion = { scale, feet, box: figureBox(feet, scale), tiles };
  return { hero: shiftedLeft(hero, shift), companion };
}

/** The companion's rhythm: it looks into the lab for so long, then at its clipboard. */
export const COMPANION_LOOKS = { everyMs: 9000, boardMs: 2600 } as const;
/** How far down from its facing it turns its head to read its clipboard, radians. */
export const BOARD_LOOK = 0.5;

/**
 * Where the companion looks at `t` ms after it came up, `phase` (0 to 1) into its rhythm, facing
 * `facing`: toward the room the scene shows (`scene`, the angle from its head to where the menu's
 * places show) — as far as the hero's looks turn (hero.ts lookToward), in the hero's glance's
 * steps, and held there — and for COMPANION_LOOKS.boardMs of every COMPANION_LOOKS.everyMs down
 * at its clipboard; under reduced motion, or with the lamp out (`scene` null), at its facing. So
 * its head turns twice in each rhythm, and its layers are drawn anew no more often.
 */
export function companionLook(
  [t, phase]: readonly [number, number],
  facing: number,
  scene: number | null,
  reduced: boolean,
): number {
  if (reduced || scene === null) {
    return facing;
  }
  const into = (t + phase * COMPANION_LOOKS.everyMs) % COMPANION_LOOKS.everyMs;
  if (into >= COMPANION_LOOKS.everyMs - COMPANION_LOOKS.boardMs) {
    return facing - BOARD_LOOK;
  }
  return facing + stepped(lookToward(scene, facing) - facing, GLANCE_STEP);
}

/** Where the companion faces: the hero's way while the hero turns away, else to the menu. */
export function companionFacing(heroFacing: number, leaving: boolean): number {
  return leaving ? heroFacing : HERO_FACING;
}
