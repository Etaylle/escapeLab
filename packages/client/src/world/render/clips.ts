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

/** Whether each spot's reach holds a wall or a shut door, by the key clipOf keeps a clip by. */
const blocked = new WeakMap<object, Map<string, boolean>>();

/**
 * Whether `source` needs its clip with the doors `shut` (shutKey) as they are: a wall or a shut
 * door lies within its reach of its spot — a tile scan, kept a spot for the map. In the open
 * middle of a room it does not: what it sees there is all of its round.
 */
export function clipNeeded(
  frame: Frame,
  source: Pick<LightSource, 'x' | 'y' | 'reach'>,
  shut: string,
): boolean {
  const known = blocked.get(frame.map) ?? new Map<string, boolean>();
  blocked.set(frame.map, known);
  const key = `${source.x.toFixed(2)},${source.y.toFixed(2)},${source.reach},${shut}`;
  const kept = known.get(key);
  if (kept !== undefined) {
    return kept;
  }
  const doors = doorsShut(frame.map);
  const near = (x: number, y: number): boolean =>
    frame.map.tiles[y]?.charAt(x) === '#' || doors.has(`${x},${y}`);
  const r = Math.ceil(source.reach);
  const [cx, cy] = [Math.floor(source.x), Math.floor(source.y)];
  let found = false;
  for (let y = cy - r; y <= cy + r && !found; y++) {
    for (let x = cx - r; x <= cx + r && !found; x++) {
      found = near(x, y);
    }
  }
  known.set(key, found);
  return found;
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
  frame.kit.census.sights += 1;
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
