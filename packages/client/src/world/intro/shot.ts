import type { WorldMap } from '../render/frame.js';

/**
 * The opening's camera (sequence.ts `shotProgress`): one slow shot across the lab with its
 * power on, from the reactor end to this player's spawn, a little wider than play frames it.
 * Both ends are held where the camera can look first (assemble.ts), so that on a screen the
 * lab nearly fills the shot moves from its first frame to its last. Pure; tiles.
 */

type Spot = { x: number; y: number };

/** How much wider the shot frames the lab than play does: its zoom against the play zoom. */
export const SHOT_WIDE = 0.9;

/** The middle of a label's tile. */
const middleOf = (spot: Spot): Spot => ({ x: spot.x + 0.5, y: spot.y + 0.5 });

/**
 * Where the shot starts: the reactor end of the lab — the room a label names as the reactor —
 * or, on a map without one, the room furthest from the spawn; the middle of the map on a map
 * without a room name at all.
 */
export function shotStart(map: Pick<WorldMap, 'labels' | 'width' | 'height'>, spawn: Spot): Spot {
  const reactor = map.labels.find((label) => label.kind === 'reactor');
  if (reactor !== undefined) {
    return middleOf(reactor);
  }
  const away = (label: Spot): number => Math.hypot(label.x - spawn.x, label.y - spawn.y);
  const furthest = [...map.labels].sort((a, b) => away(b) - away(a))[0];
  return furthest === undefined ? { x: map.width / 2, y: map.height / 2 } : middleOf(furthest);
}

/** Where the camera looks `progress` of the way along the shot from `from` to `to`, tiles. */
export function shotPoint(from: Spot, to: Spot, progress: number): Spot {
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}
