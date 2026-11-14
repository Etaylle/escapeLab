import type { EdgeLight } from '../art.js';
import { lift, SERVER_BLUE, TUNGSTEN } from '../palette.js';

/**
 * The owner's three looks for the menu's hero (docs/art-bible.md „The hero", Composition), with
 * the values the stills A, B and C were shot with: A, the lamp held at rest in the dark, its warm
 * light down the hero's front; B, as A with the figure sunk further and the server room's cold
 * blue down its back, against the lamp; C, as A with the lamp held out to the visor's height,
 * toward the menu. Two switches pick one — HERO_LIGHT for B, LAMP_RAISE for C —; A stands until
 * the owner chooses.
 */

/**
 * How the hero is lit at night: how far its colour sinks (scene.ts `nightTo` sinks the lab), the
 * lamp's warm light along its front edge, toward the menu, at its strongest, and a light along its
 * back edge, at its strongest; null for none.
 */
export interface HeroLight {
  readonly night: number;
  readonly front: EdgeLight;
  readonly back: EdgeLight | null;
}

/** Looks A and C: the lamp's warm edge down the hero's front alone, its back in the dark. */
export const WARM_EDGE: HeroLight = {
  night: 0.35,
  front: { rgb: lift(TUNGSTEN, 0.15), alpha: 0.85 },
  back: null,
};

/**
 * Look B: the figure sunk further, the warm edge a little softer, and the server room's cold blue
 * down its back, as if the lab's server light stood behind it.
 */
export const COLD_BACK: HeroLight = {
  night: 0.45,
  front: { rgb: lift(TUNGSTEN, 0.15), alpha: 0.8 },
  back: { rgb: lift(SERVER_BLUE, 0.45), alpha: 0.75 },
};

/** The switch for look B: WARM_EDGE for A and C, COLD_BACK for B, its cold back light on. */
export const HERO_LIGHT: HeroLight = WARM_EDGE;

/** How far the hero holds its lamp up from the chest: its arms raised, radians; the lamp, up. */
export interface LampRaise {
  readonly arms: number;
  /** figure units */
  readonly up: number;
}

/** Looks A and B: the lamp held at rest before the chest. */
export const LAMP_AT_REST: LampRaise = { arms: 0, up: 0 };

/** Look C: the lamp held out to the visor's height, toward the menu. */
export const LAMP_HELD_OUT: LampRaise = { arms: 0.3, up: 0.065 };

/** The switch for look C: LAMP_AT_REST for A and B, LAMP_HELD_OUT for C. */
export const LAMP_RAISE: LampRaise = LAMP_AT_REST;
