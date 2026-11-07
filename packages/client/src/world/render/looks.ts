import type { MapSource } from '@escapelab/core';
import type { ManualObjectOpts, Tube } from '../art.js';
import { animTime, crtFlicker, propSeed, rollAt } from '../anim.js';
import { coversArmed } from '../interact.js';
import type { Frame } from './frame.js';

/**
 * How the lab's things look on a frame, as the objects pass draws them (objects.ts) and draws
 * a tall one again over what stands behind it (occluders.ts): a screen's tube as it flickers,
 * a source found or not.
 */

/**
 * The tube of the screen on the tile (x, y) this frame: flickering and its roll bar drifting
 * down (anim.ts), each screen out of step with the others.
 */
export function tubeAt(frame: Frame, x: number, y: number): Tube {
  const t = animTime(frame.time);
  const seed = propSeed(x, y);
  return { burn: crtFlicker(t, seed), roll: rollAt(t, seed, frame.reduced) };
}

/**
 * How `manual` looks this frame, its label's top at `place`: one nobody has found as what it
 * is, shut, holding nothing; one the crew knows of whole, named as far as this player has found
 * it — and only then lit up where it prints the armed station's rules.
 */
export function sourceLook(
  frame: Frame,
  manual: MapSource,
  place: number | null,
): ManualObjectOpts {
  const { pulse, text } = frame;
  const found = frame.labels({ of: 'source', id: manual.id });
  const tube = tubeAt(frame, manual.x, manual.y);
  const look = { kind: manual.kind, active: false, opened: false, pulse, text, tube, found };
  if (!manual.known) {
    return { ...look, labelAt: place };
  }
  const active = found > 0 && coversArmed(frame.map, manual);
  return { ...look, label: manual.label, active, opened: manual.opened, labelAt: place };
}

