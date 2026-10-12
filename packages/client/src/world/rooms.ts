import type { MapView } from '@escapelab/core';

type Spot = { x: number; y: number };
type RoomMap = Pick<MapView, 'tiles' | 'doors'>;

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const AROUND = [...STEPS, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * The floor of the room around `from`: every floor tile reachable from it
 * without crossing a door, open or not. Empty when `from` is no floor.
 */
export function roomFloor(map: RoomMap, from: Spot): Spot[] {
  const doors = new Set(map.doors.map((d) => key(d.x, d.y)));
  const inside = (x: number, y: number): boolean =>
    map.tiles[y]?.charAt(x) === '.' && !doors.has(key(x, y));
  if (!inside(from.x, from.y)) {
    return [];
  }
  const seen = new Set([key(from.x, from.y)]);
  const room = [{ x: from.x, y: from.y }];
  for (let i = 0; i < room.length; i++) {
    const at = room[i] ?? from;
    for (const [dx, dy] of STEPS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (inside(x, y) && !seen.has(key(x, y))) {
        seen.add(key(x, y));
        room.push({ x, y });
      }
    }
  }
  return room;
}

/**
 * Every tile a room's lights reach: its floor, the walls around it and the
 * doors in them — no floor beyond, so the room next door stays dark.
 */
export function roomArea(map: RoomMap, from: Spot): Spot[] {
  const doors = new Set(map.doors.map((d) => key(d.x, d.y)));
  const area = new Map<string, Spot>();
  for (const { x, y } of roomFloor(map, from)) {
    area.set(key(x, y), { x, y });
    for (const [dx, dy] of AROUND) {
      const at = { x: x + dx, y: y + dy };
      const wall = map.tiles[at.y]?.charAt(at.x) === '#';
      const door = doors.has(key(at.x, at.y)) && (dx === 0 || dy === 0);
      if (wall || door) {
        area.set(key(at.x, at.y), at);
      }
    }
  }
  return [...area.values()];
}

/**
 * The name of the room this player starts in: the room label on the floor
 * around the spawn that no door cuts through, failing that the label nearest
 * to the spawn. Null on a map without labels.
 */
export function startRoom(
  map: Pick<MapView, 'tiles' | 'doors' | 'labels' | 'yourSpawn'>,
): string | null {
  const spawn = map.yourSpawn;
  const room = roomFloor(map, spawn);
  const inside = map.labels.find((label) =>
    room.some((tile) => tile.x === label.x && tile.y === label.y),
  );
  if (inside !== undefined) {
    return inside.text;
  }
  const away = (label: { x: number; y: number }): number =>
    Math.hypot(label.x - spawn.x, label.y - spawn.y);
  return [...map.labels].sort((a, b) => away(a) - away(b))[0]?.text ?? null;
}
