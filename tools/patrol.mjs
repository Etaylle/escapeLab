/**
 * Walking past the drones, worked out ahead — pure, for the harness
 * (tools/shots.mjs). The server flies each awake drone round its waypoints at
 * a fixed tick and spots whoever stands in its cone, within its range and in
 * its sight (server src/drones.ts, core src/sight.ts). From one snapshot of a
 * page's stream this foretells every flight a drone may take, and whether a
 * walker running a path from now on would be spotted on the way — wherever
 * between its fastest and its slowest run it may be — with margins for the
 * snapshot's age. Havens are the tiles no drone ever looks at: a walk waits
 * on them, and crosses what lies between in one go.
 */

/** How often the server steps its drones, in s (server src/room.ts DRONE_TICK_MS). */
export const DRONE_TICK_S = 0.08;
/** Closer than this a drone spots nobody: its blind spot (server drones.ts MIN_SPOT_DISTANCE). */
const BLIND_SPOT = 0.4;
/** Margins on the server's rule: on the range, in tiles, and on the cone's half angle. */
export const MARGIN = { range: 0.3, angle: (4 * Math.PI) / 180 };
/** A drone this close to a point of its beat stands on it, in tiles. */
const ON_BEAT = 0.1;
/** ... and flies along a leg when it faces this close to the leg's way, in radians. */
const ALONG = 0.12;
/** How finely a walker's stretch of possible places is looked along, in tiles. */
const ALONG_PATH = 0.2;
/** Slack round the walker's place at a moment, in tiles of its path. */
const PLACE_SLACK = 0.25;

/**
 * How the harness's avatar runs a path, in s: `tile` for each tile of a
 * straight stretch with its key held (4.2 tiles a second), `corner` more at
 * each turn and at the end, where it stops to line up — each as the fastest
 * and the slowest it takes.
 */
export const RUN = { tile: [0.235, 0.26], corner: [0.1, 0.5] };

const keyOf = (x, y) => `${x},${y}`;
const middleOf = (tile) => ({ x: tile.x + 0.5, y: tile.y + 0.5 });

/** The angle between two directions, 0 to π. */
function turnBetween(a, b) {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/** Whether a tile blocks sight: a wall, off the map, or a door shut (`shut`, by key). */
function blocks(sight, x, y) {
  return sight.tiles[y]?.charAt(x) !== '.' || sight.shut.has(keyOf(x, y));
}

/** Along one axis: how far from where the line starts the next grid line ahead lies. */
function gapAhead(from, cell, step) {
  return step > 0 ? cell + 1 - from : from - cell;
}

/**
 * The grid line a line crosses next: the vertical one (-1), the horizontal
 * one (1), both at a grid point (0), or none (null).
 */
function nextLine(gapX, gapY, runX, runY) {
  const crossX = gapX < runX;
  const crossY = gapY < runY;
  if (crossX && crossY) {
    return Math.sign(gapX * runY - gapY * runX);
  }
  return crossX ? -1 : crossY ? 1 : null;
}

/**
 * Whether points `a` and `b` see each other on `sight` ({ tiles, shut }):
 * core's rule (sight.ts `canSee`) — no wall or shut door touched on the way,
 * not even at a corner; the tiles at both ends never block.
 */
export function canSee(sight, a, b) {
  const stepX = Math.sign(b.x - a.x);
  const stepY = Math.sign(b.y - a.y);
  const runX = Math.abs(b.x - a.x);
  const runY = Math.abs(b.y - a.y);
  let x = Math.floor(a.x);
  let y = Math.floor(a.y);
  let passing = null;
  let line = nextLine(gapAhead(a.x, x, stepX), gapAhead(a.y, y, stepY), runX, runY);
  while (line !== null) {
    const grazes = line === 0 && (blocks(sight, x + stepX, y) || blocks(sight, x, y + stepY));
    x += line <= 0 ? stepX : 0;
    y += line >= 0 ? stepY : 0;
    if (grazes || (passing !== null && blocks(sight, passing.x, passing.y))) {
      return false;
    }
    passing = { x, y };
    line = nextLine(gapAhead(a.x, x, stepX), gapAhead(a.y, y, stepY), runX, runY);
  }
  return true;
}

/**
 * Whether `drone` ({ range, halfAngleDeg }), at `at` ({ x, y, facing }),
 * spots somebody at point `p`: the server's rule, widened by MARGIN.
 */
export function spots(drone, at, p, sight) {
  const dist = Math.hypot(p.x - at.x, p.y - at.y);
  if (dist > drone.range + MARGIN.range || dist < BLIND_SPOT - MARGIN.range) {
    return false;
  }
  const off = turnBetween(Math.atan2(p.y - at.y, p.x - at.x), at.facing);
  return off <= (drone.halfAngleDeg * Math.PI) / 180 + MARGIN.angle && canSee(sight, at, p);
}

/** How far point `p` lies from the segment `a`–`b`, in tiles. */
function offLeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2;
  const along = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + along * dx), p.y - (a.y + along * dy));
}

/**
 * The waypoints of `beat` ({ waypoints }) a drone at `at` may be heading for,
 * by index: the end of the leg it flies along, or — standing on a waypoint,
 * where it stops for a tick or two — that one and the next. A waypoint the
 * beat passes twice gives each of its futures.
 */
export function headings(beat, at) {
  const points = beat.waypoints.map(middleOf);
  const targets = new Set();
  points.forEach((b, t) => {
    const a = points[(t - 1 + points.length) % points.length];
    const way = Math.atan2(b.y - a.y, b.x - a.x);
    if (offLeg(at, a, b) < ON_BEAT && turnBetween(way, at.facing) < ALONG) {
      targets.add(t);
    }
    if (Math.hypot(at.x - b.x, at.y - b.y) < ON_BEAT) {
      targets.add(t);
      targets.add((t + 1) % points.length);
    }
  });
  return [...targets];
}

/**
 * A drone flown on from `at` towards waypoint `target` of `beat` ({
 * waypoints, speed }) for `seconds`, tick by tick as the server steps it: a
 * point every DRONE_TICK_S with the time since `at`. As on the server, a
 * drone that reaches a waypoint looks east there (atan2(0, 0)) until it
 * turns for the next.
 */
export function flyOn(beat, at, target, seconds) {
  const points = beat.waypoints.map(middleOf);
  const track = [];
  let { x, y, facing } = at;
  let next = target;
  for (let tick = 0; tick * DRONE_TICK_S <= seconds; tick++) {
    track.push({ time: tick * DRONE_TICK_S, x, y, facing });
    const goal = points[next];
    const dist = Math.hypot(goal.x - x, goal.y - y);
    if (dist < 0.05) {
      next = (next + 1) % points.length;
      continue;
    }
    const step = Math.min(dist, beat.speed * DRONE_TICK_S);
    x += ((goal.x - x) / dist) * step;
    y += ((goal.y - y) / dist) * step;
    facing = Math.atan2(goal.y - y, goal.x - x);
  }
  return track;
}

/**
 * Every flight the drones of `drones` ({ beat, range, halfAngleDeg, at }[])
 * may take over the next `seconds`: one track per waypoint each may be
 * heading for.
 */
export function flights(drones, seconds) {
  return drones.flatMap((drone) =>
    headings(drone.beat, drone.at).map((target) => ({
      drone,
      track: flyOn(drone.beat, drone.at, target, seconds),
    })),
  );
}

/** Whether the path turns at index `i`: the step into it and the step out of it differ. */
function turnsAt(path, i) {
  const [a, b, c] = [path[i - 1], path[i], path[i + 1]];
  return c !== undefined && (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y);
}

/** The indices of `path` a run stops at to line up: every turn, and the end. */
export function cornersOf(path) {
  const stops = [];
  for (let i = 1; i < path.length; i++) {
    if (i === path.length - 1 || turnsAt(path, i)) {
      stops.push(i);
    }
  }
  return stops;
}

/** When a run reaches each index of `path`, in s, at `tile` s a tile and `corner` s a stop. */
export function arrivals(path, tile, corner) {
  const times = [0];
  for (let i = 1; i < path.length; i++) {
    const stopped = i > 1 && turnsAt(path, i - 1) ? corner : 0;
    times.push(times[i - 1] + tile + stopped);
  }
  return times;
}

/** How far along its path (an index, with its fraction) a run of `times` is `t` s in. */
export function progressAt(times, t) {
  if (t <= 0) {
    return 0;
  }
  for (let i = 1; i < times.length; i++) {
    if (t < times[i]) {
      return i - 1 + (t - times[i - 1]) / (times[i] - times[i - 1]);
    }
  }
  return times.length - 1;
}

/** The point `s` tiles along `path` (an index with its fraction), at tile middles. */
export function pointOn(path, s) {
  const i = Math.min(path.length - 1, Math.floor(s));
  const j = Math.min(path.length - 1, i + 1);
  const f = Math.min(1, s - i);
  return middleOf({
    x: path[i].x + (path[j].x - path[i].x) * f,
    y: path[i].y + (path[j].y - path[i].y) * f,
  });
}

/**
 * The first moment, in s from now, a drone of `flying` (from `flights`) may
 * spot a walker who waits `delay` s where `path` starts, runs it at `pace`
 * and stands at its end for `hold` s more — anywhere between where its
 * fastest and its slowest run would have it; null for none.
 */
export function spottedOn(path, flying, sight, { delay = 0, hold = 0, pace = RUN } = {}) {
  const fast = arrivals(path, pace.tile[0], pace.corner[0]);
  const slow = arrivals(path, pace.tile[1], pace.corner[1]);
  const last = path.length - 1;
  const end = delay + slow[last] + pace.corner[1] + hold;
  for (const { drone, track } of flying) {
    for (const at of track) {
      if (at.time > end) {
        break;
      }
      const t = at.time - delay;
      const from = Math.max(0, progressAt(slow, t) - PLACE_SLACK);
      const to = t <= 0 ? 0 : Math.min(last, progressAt(fast, t) + PLACE_SLACK);
      for (let s = from; ; s = Math.min(to, s + ALONG_PATH)) {
        if (spots(drone, at, pointOn(path, s), sight)) {
          return at.time;
        }
        if (s >= to) {
          break;
        }
      }
    }
  }
  return null;
}

/**
 * Every point of a beat as a drone flies it, a tenth of a tile apart, facing
 * its way; and each waypoint looking east, as it does there for a tick.
 */
function beatPoints(beat) {
  const points = beat.waypoints.map(middleOf);
  return points.flatMap((b, t) => {
    const a = points[(t - 1 + points.length) % points.length];
    const facing = Math.atan2(b.y - a.y, b.x - a.x);
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1));
    const along = Array.from({ length: n + 1 }, (_, i) => ({
      x: a.x + ((b.x - a.x) * i) / n,
      y: a.y + ((b.y - a.y) * i) / n,
      facing,
    }));
    return [...along, { x: b.x, y: b.y, facing: 0 }];
  });
}

/**
 * The floor tiles of `sight` no drone of `drones` ({ beat, range,
 * halfAngleDeg }[]) spots anybody on — at the tile's middle, wherever on its
 * beat it flies and whichever way it looks there — as keys "x,y".
 */
export function havens(drones, sight) {
  const looks = drones.map((drone) => ({ drone, points: beatPoints(drone.beat) }));
  const safe = new Set();
  sight.tiles.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (blocks(sight, x, y)) {
        continue;
      }
      const p = middleOf({ x, y });
      if (!looks.some(({ drone, points }) => points.some((at) => spots(drone, at, p, sight)))) {
        safe.add(keyOf(x, y));
      }
    }
  });
  return safe;
}

/**
 * The stretch of `path` a walker crosses in one go: from its start up to the
 * first haven after it (`safe`, by key), or its end.
 */
export function stretchOf(path, safe) {
  const stop = path.findIndex(
    (tile, i) => i > 0 && (i === path.length - 1 || safe.has(keyOf(tile.x, tile.y))),
  );
  return path.slice(0, stop + 1);
}
