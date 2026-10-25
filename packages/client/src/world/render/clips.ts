import { sightFrom } from '@escapelab/core';
import { doorsShut, lightClip } from '../light.js';
import type { LightSource } from '../sources.js';
import type { Frame } from './frame.js';

/**
 * Where a coloured light of the lab may fall — what it sees from its spot,
 * walls and shut doors stopping it — as a path in tiles, worked out once for
 * its spot, its reach and the doors shut (kept in the art's kit).
 */

/** The doors shut right now, as text. */
export function shutKey(frame: Frame): string {
  return [...doorsShut(frame.map)].sort().join(';');
}

/** Where `source` may fall with the doors `shut` (shutKey) as they are, as a path in tiles. */
export function clipOf(
  frame: Frame,
  source: Pick<LightSource, 'x' | 'y' | 'reach'>,
  shut: string,
): Path2D {
  const { clips } = frame.kit.art;
  const key = `${source.x.toFixed(2)},${source.y.toFixed(2)},${source.reach},${shut}`;
  const known = clips.get(key);
  if (known !== undefined) {
    return known;
  }
  if (clips.size > 256) {
    clips.clear();
  }
  const sight = sightFrom(frame.map, source, source.reach, doorsShut(frame.map));
  const { outline, walls } = lightClip(sight);
  const path = new Path2D();
  outline.forEach((spot, i) =>
    i === 0 ? path.moveTo(spot.x, spot.y) : path.lineTo(spot.x, spot.y),
  );
  path.closePath();
  for (const run of walls) {
    path.rect(run.x, run.y, run.length, 1);
  }
  clips.set(key, path);
  return path;
}
