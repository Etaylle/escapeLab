// The walkthrough's check of a flashlight's beam (beam-core.png, client world/beam.ts): the light
// on the beam's axis against its two flanks, at the same distances from the lamp, past its glow.
import { meanLuma } from './panelfade.mjs';

/** How far from the lamp the light is read, tiles: past the glow round it, inside the beam. */
export const DISTANCES = [3, 3.5, 4];
/** How far either side of the axis a flank is read, radians: past the core, inside the beam. */
export const FLANK_OFF = 0.36;
/** The side of each patch read, tiles. */
export const PATCH = 0.4;

/**
 * The patches read along a beam — the core on its axis, the left and right flank FLANK_OFF off
 * it — each a square PATCH tiles wide, CSS px, round where `toPage` (tiles to CSS px) puts it, a
 * tile `tile` CSS px wide.
 */
export function beamPatches(beam, toPage, tile) {
  const side = PATCH * tile;
  const at = (d, off) => {
    const angle = beam.facing + off;
    const p = toPage(beam.x + Math.cos(angle) * d, beam.y + Math.sin(angle) * d);
    return { x: p.x - side / 2, y: p.y - side / 2, width: side, height: side };
  };
  return {
    core: DISTANCES.map((d) => at(d, 0)),
    left: DISTANCES.map((d) => at(d, -FLANK_OFF)),
    right: DISTANCES.map((d) => at(d, FLANK_OFF)),
  };
}

/** The mean light of each row of `patches` in `image` ({ width, height, rgba }) at `dpr`. */
export function beamLight(image, patches, dpr) {
  const mean = (boxes) =>
    boxes.reduce((sum, box) => sum + meanLuma(image, box, dpr), 0) / boxes.length;
  return { core: mean(patches.core), left: mean(patches.left), right: mean(patches.right) };
}

/** Whether a beam reads brighter in its core than on either flank. */
export function beamVerdict({ core, left, right }) {
  return core > left && core > right;
}
