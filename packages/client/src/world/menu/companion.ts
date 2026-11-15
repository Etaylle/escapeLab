import {
  CLEAR,
  HERO_BOX,
  HERO_FACING,
  heroTile,
  lookToward,
  stepped,
  GLANCE_STEP,
  STEP_TILES,
  type HeroPlace,
  type StageFacts,
} from './hero.js';

/**
 * The hero's companion (docs/art-bible.md „The hero", The companion): a second figure of the
 * crew standing with the hero where the stage has room for both — smaller and a little behind
 * it, at its back's side, so that the two read as depth, the hero's canvas over its own. Pure:
 * where and how large it stands (companionPlace), and where it looks (companionLook). Lengths in
 * CSS px, but where figure units are said: the hero's, as hero.ts counts them.
 */

/** How large the companion stands against the hero: a step back into the room. */
export const COMPANION_SHARE = 0.62;
/**
 * How far behind the hero its feet stand, up the floor, hero figure units: far enough back in the
 * room that it stands over the hero's shoulder, its clipboard clear of the hero's dome.
 */
export const COMPANION_BACK = 0.5;
/**
 * How far right of the hero's feet its own stand, hero figure units: as far as `most` where the
 * stage has the room, never nearer than `least` — nearer, the hero would hide it, and it is left
 * out.
 */
export const COMPANION_ASIDE = { most: 0.42, least: 0.2 } as const;

/** What the companion's box gives up to whole pixels at either side, CSS px: as the hero's. */
const ROUNDING = 1;

/**
 * Where the companion stands beside the hero placed `hero` on the stage `f`, and how large:
 * COMPANION_SHARE of the hero, COMPANION_BACK behind it, as far right of it as COMPANION_ASIDE
 * and the stage's right edge allow — clear of the edge and its safe area by CLEAR, stepped half
 * a tile aside with the hero as a panel opens. Null where no hero stands, where the room right
 * of it holds the companion nearer than COMPANION_ASIDE's least, or where its head would rise
 * into the stage's padding at its top.
 */
export function companionPlace(hero: HeroPlace | null, f: StageFacts): HeroPlace | null {
  if (hero === null) {
    return null;
  }
  const scale = hero.scale * COMPANION_SHARE;
  const step = STEP_TILES * heroTile(f.windowH);
  const right = f.w - Math.max(CLEAR, f.safeRight) - step - ROUNDING;
  const most = hero.feet.x + COMPANION_ASIDE.most * hero.scale;
  const x = Math.min(most, right - HERO_BOX.back * scale);
  if (x < hero.feet.x + COMPANION_ASIDE.least * hero.scale) {
    return null;
  }
  const y = hero.feet.y - COMPANION_BACK * hero.scale;
  const left = Math.floor(x - HERO_BOX.front * scale);
  const top = Math.floor(y - HERO_BOX.top * scale);
  if (top < f.ceiling + CLEAR) {
    return null;
  }
  const box = {
    left,
    top,
    width: Math.ceil(x + HERO_BOX.back * scale) - left,
    height: Math.ceil(y + HERO_BOX.bottom * scale) - top,
  };
  return { scale, feet: { x, y }, box, tiles: hero.tiles * COMPANION_SHARE };
}

/** The companion's rhythm: it looks where the beam shows for so long, then at its clipboard. */
export const COMPANION_LOOKS = { everyMs: 9000, boardMs: 2600 } as const;
/** How far down from its facing it turns its head to read its clipboard, radians. */
export const BOARD_LOOK = 0.5;

/**
 * Where the companion looks at `t` ms after it came up, `phase` (0 to 1) into its rhythm, facing
 * `facing`: at what the beam shows (`beam`, the angle from its head to the beam's middle) — as
 * far as the hero's looks turn (hero.ts lookToward), in the hero's glance's steps — and for
 * COMPANION_LOOKS.boardMs of every COMPANION_LOOKS.everyMs down at its clipboard; under reduced
 * motion, or with no beam, at its facing.
 */
export function companionLook(
  [t, phase]: readonly [number, number],
  facing: number,
  beam: number | null,
  reduced: boolean,
): number {
  if (reduced || beam === null) {
    return facing;
  }
  const into = (t + phase * COMPANION_LOOKS.everyMs) % COMPANION_LOOKS.everyMs;
  if (into >= COMPANION_LOOKS.everyMs - COMPANION_LOOKS.boardMs) {
    return facing - BOARD_LOOK;
  }
  return facing + stepped(lookToward(beam, facing) - facing, GLANCE_STEP);
}

/** Where the companion faces: the hero's way while the hero turns away, else to the menu. */
export function companionFacing(heroFacing: number, leaving: boolean): number {
  return leaving ? heroFacing : HERO_FACING;
}
