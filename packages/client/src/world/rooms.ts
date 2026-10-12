import type { MapView } from '@escapelab/core';

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * The name of the room this player starts in: the room label on the floor
 * around the spawn that no door cuts through, failing that the label nearest
 * to the spawn. Null on a map without labels.
 */
export function startRoom(
  map: Pick<MapView, 'tiles' | 'doors' | 'labels' | 'yourSpawn'>,
): string | null {
  const key = (x: number, y: number): string => `${x},${y}`;
  const doors = new Set(map.doors.map((d) => key(d.x, d.y)));
  const spawn = map.yourSpawn;
  const room = new Set([key(spawn.x, spawn.y)]);
  const queue = [spawn];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] ?? spawn;
    for (const [dx, dy] of STEPS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (map.tiles[y]?.charAt(x) === '.' && !doors.has(key(x, y)) && !room.has(key(x, y))) {
        room.add(key(x, y));
        queue.push({ x, y });
      }
    }
  }
  const inside = map.labels.find((label) => room.has(key(label.x, label.y)));
  if (inside !== undefined) {
    return inside.text;
  }
  const away = (label: { x: number; y: number }): number =>
    Math.hypot(label.x - spawn.x, label.y - spawn.y);
  return [...map.labels].sort((a, b) => away(a) - away(b))[0]?.text ?? null;
}
