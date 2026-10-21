import { walkable, type MapView, type PlayerView, type ServerMessage } from '@escapelab/core';
import type { Room } from '../src/room.js';

/**
 * Walking as a client does. The room takes only steps an avatar can walk,
 * so the tests do not teleport: a walk goes from tile centre to tile centre
 * along a shortest path over floor and open doors, round the furniture — as
 * the walker's latest view shows them — and ends on the exact spot asked
 * for. Every step stays inside one tile or runs between the middles of two
 * neighbouring ones.
 */

/** A player as the tests drive one: its id and everything the room sent it. */
export interface Walker {
  playerId: string;
  messages: ServerMessage[];
}

interface Spot {
  x: number;
  y: number;
}

type Tile = [number, number];

/** Where each walk left each player, and in which run, by room and player id. */
const walked = new WeakMap<Room, Map<string, { run: number; at: Spot }>>();

function latestView(walker: Walker): PlayerView {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('a walker needs a view to walk by');
  }
  return last.view;
}

const key = ([x, y]: Tile): string => `${x},${y}`;
const tileOf = (spot: Spot): Tile => [Math.floor(spot.x), Math.floor(spot.y)];

/** Floor that no furniture takes, and no door shut on it. */
function passable(map: MapView, [x, y]: Tile): boolean {
  return walkable(map, x, y) && !map.doors.some((d) => d.x === x && d.y === y && !d.open);
}

/** The tiles after `from` on a shortest way to `to`; throws where none leads there. */
function wayTo(map: MapView, from: Tile, to: Tile): Tile[] {
  const cameFrom = new Map<string, Tile | null>([[key(from), null]]);
  const queue: Tile[] = [from];
  // A for…of over an array also visits what is pushed onto it while it runs.
  for (const tile of queue) {
    if (key(tile) === key(to)) {
      const way: Tile[] = [];
      for (let at: Tile | null = tile; at !== null && key(at) !== key(from); ) {
        way.unshift(at);
        at = cameFrom.get(key(at)) ?? null;
      }
      return way;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next: Tile = [tile[0] + dx, tile[1] + dy];
      if (!cameFrom.has(key(next)) && passable(map, next)) {
        cameFrom.set(key(next), tile);
        queue.push(next);
      }
    }
  }
  throw new Error(`no way from ${key(from)} to ${key(to)} through the doors as they stand`);
}

/**
 * Walk `walker` to the spot (x, y), in tiles. The first walk of a run sets
 * out from the spawn the walker drew; each later one from where the last
 * one ended. A door that shuts on the way ends the walk with an error.
 */
export function walkTo(room: Room, walker: Walker, x: number, y: number): void {
  const view = latestView(walker);
  const run = view.startedAt;
  if (view.map === null || run === null || view.pausedFor !== null) {
    throw new Error(`${view.you.name} cannot walk: no run under way`);
  }
  const spawn = { x: view.map.yourSpawn.x + 0.5, y: view.map.yourSpawn.y + 0.5 };
  const inRoom = walked.get(room) ?? new Map<string, { run: number; at: Spot }>();
  walked.set(room, inRoom);
  const last = inRoom.get(walker.playerId);
  let at = last?.run === run ? last.at : spawn;
  const step = (to: Spot): void => {
    if (to.x !== at.x || to.y !== at.y) {
      room.updatePosition(walker.playerId, run, { x: to.x, y: to.y, facing: 0, moving: false });
      at = to;
    }
  };
  const start = tileOf(at);
  const target = tileOf({ x, y });
  const tiles = key(start) === key(target) ? [] : [start, ...wayTo(view.map, start, target)];
  for (const [i, tile] of tiles.entries()) {
    const map = latestView(walker).map;
    if (map === null) {
      return; // the run ended on the way
    }
    if (i > 0 && !passable(map, tile)) {
      throw new Error(`the way to ${x},${y} shut at ${key(tile)}`);
    }
    step({ x: tile[0] + 0.5, y: tile[1] + 0.5 });
  }
  step({ x, y });
  inRoom.set(walker.playerId, { run, at });
}
