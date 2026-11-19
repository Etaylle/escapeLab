import { canSee, walkable, type DronePosition, type MapDef, type MapView } from '@escapelab/core';
import { distance, keyOf, lengthOf, middleOf, pointAlong, type Spot } from './route.js';

/**
 * Walking past the drones, worked out ahead, for the demo crew (crew.ts) — what a crew that knows
 * the lab does by eye: the beats are the mission's (a patrol flies the same loop every night),
 * where each drone is on its beat is what the seat's own stream of positions says. From that a
 * walk foretells every flight a drone may take and whether a figure walking a way from now on
 * would stand in a cone (drones.ts `detect`, with margins); the havens are the tiles no drone
 * ever looks at, where a walk waits. The harness walks past them by the same reckoning
 * (tools/patrol.mjs).
 */

/** How often the room steps its drones, s (room.ts DRONE_TICK_MS). */
const DRONE_TICK_S = 0.08;
/** Closer than this a drone spots nobody (drones.ts MIN_SPOT_DISTANCE). */
const BLIND_SPOT = 0.4;
/** Margins on the room's rule: on the range, in tiles, and on the cone's half angle, rad. */
const MARGIN = { range: 0.4, angle: (5 * Math.PI) / 180 };
/** A drone this close to a point of its beat stands on it, tiles. */
const ON_BEAT = 0.1;
/** … and flies along a leg when it faces this close to the leg's way, rad. */
const ALONG = 0.12;
/** How finely a walker's stretch of possible places is looked along, tiles. */
const ALONG_WAY = 0.25;

type Beat = Pick<MapDef['drones'][number], 'waypoints' | 'speed'>;

/** A drone on patrol: its beat and reach from the mission, where it is from the stream. */
export interface Patrol {
  beat: Beat;
  range: number;
  halfAngleDeg: number;
  at: { x: number; y: number; facing: number };
}

/** What sight goes by: the map's tiles and the doors shut, by key. */
export interface SightOn {
  map: MapView;
  shut: ReadonlySet<string>;
}

/** The drones of `stream` that look — awake and not held still — on the beats `drones` gives. */
export function patrolsOn(
  drones: MapDef['drones'],
  stream: Readonly<Record<string, DronePosition>>,
): Patrol[] {
  return drones.flatMap((drone) => {
    const at = stream[drone.id];
    return at === undefined || at.frozen
      ? []
      : [{ beat: drone, range: drone.range, halfAngleDeg: drone.halfAngleDeg, at }];
  });
}

/** The angle between two directions, 0 to π. */
function turnBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/** Whether a drone of `patrol`'s reach at `at` spots somebody at `p`: the room's rule, widened. */
function spots(patrol: Patrol, at: Patrol['at'], p: Spot, sight: SightOn): boolean {
  const dist = distance(at, p);
  if (dist > patrol.range + MARGIN.range || dist < BLIND_SPOT - MARGIN.range) {
    return false;
  }
  const off = turnBetween(Math.atan2(p.y - at.y, p.x - at.x), at.facing);
  const cone = (patrol.halfAngleDeg * Math.PI) / 180 + MARGIN.angle;
  return off <= cone && canSee(sight.map, at, p, sight.shut);
}

/** How far `p` lies from the segment `a`–`b`, tiles. */
function offLeg(p: Spot, a: Spot, b: Spot): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2;
  const along = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + along * dx), p.y - (a.y + along * dy));
}

/**
 * The waypoints of its beat a drone at `at` may be heading for, by index: the end of the leg it
 * flies along, or — on a waypoint, where it stops for a tick — that one and the next. A waypoint
 * the beat passes twice gives each of its futures.
 */
function headings(beat: Beat, at: Patrol['at']): number[] {
  const points = beat.waypoints.map(middleOf);
  const targets = new Set<number>();
  points.forEach((b, t) => {
    const a = points[(t - 1 + points.length) % points.length] as Spot;
    const way = Math.atan2(b.y - a.y, b.x - a.x);
    if (offLeg(at, a, b) < ON_BEAT && turnBetween(way, at.facing) < ALONG) {
      targets.add(t);
    }
    if (distance(at, b) < ON_BEAT) {
      targets.add(t);
      targets.add((t + 1) % points.length);
    }
  });
  // A drone the stream shows off every leg — it never should — may be heading anywhere.
  return targets.size > 0 ? [...targets] : points.map((_, t) => t);
}

/** A moment of a flight: where the drone is and looks, `time` s from the stream's word of it. */
interface Flown {
  time: number;
  x: number;
  y: number;
  facing: number;
}

/**
 * `patrol`'s drone flown on towards waypoint `target` for `seconds`, tick by tick as the room
 * steps it: a drone that reaches a waypoint keeps the look it came with until it sets out again.
 */
function flyOn(patrol: Patrol, target: number, seconds: number): Flown[] {
  const points = patrol.beat.waypoints.map(middleOf);
  const track: Flown[] = [];
  let { x, y, facing } = patrol.at;
  let next = target;
  for (let tick = 0; tick * DRONE_TICK_S <= seconds; tick++) {
    track.push({ time: tick * DRONE_TICK_S, x, y, facing });
    const goal = points[next] as Spot;
    const dist = Math.hypot(goal.x - x, goal.y - y);
    if (dist < 0.05) {
      next = (next + 1) % points.length;
      continue;
    }
    const step = Math.min(dist, patrol.beat.speed * DRONE_TICK_S);
    facing = Math.atan2(goal.y - y, goal.x - x);
    x += ((goal.x - x) / dist) * step;
    y += ((goal.y - y) / dist) * step;
  }
  return track;
}

/** A walk a figure is about to take: its way, its pace, and how exactly it keeps to it. */
export interface Walk {
  /** the points of the way, the first where the figure stands */
  points: readonly Spot[];
  /** tiles a second */
  speed: number;
  /** how long the figure stands at the way's end before it is in cover or off again, s */
  hold: number;
  /** how long before it sets out, s */
  delay?: number;
}

/** How far ahead of its pace, and behind it, a figure may be taken to be, s. */
const SLACK = { early: 0.2, late: 0.35 };

/**
 * The first moment, in s from the stream's word of them, a drone of `patrols` may spot a figure
 * taking `walk` — wherever between a little ahead of its pace and a little behind it — null for
 * none.
 */
export function spottedOn(walk: Walk, patrols: readonly Patrol[], sight: SightOn): number | null {
  const length = lengthOf(walk.points);
  const delay = walk.delay ?? 0;
  const end = delay + length / walk.speed + SLACK.late + walk.hold;
  let first: number | null = null;
  for (const patrol of patrols) {
    for (const target of headings(patrol.beat, patrol.at)) {
      const seen = flyOn(patrol, target, end).find((at) => {
        const t = at.time - delay;
        const from = Math.max(0, (t - SLACK.late) * walk.speed);
        const to = Math.min(length, Math.max(0, (t + SLACK.early) * walk.speed));
        const places = placesBetween(from, to).map((s) => pointAlong(walk.points, s));
        return places.some((place) => spots(patrol, at, place, sight));
      });
      if (seen !== undefined && (first === null || seen.time < first)) {
        first = seen.time;
      }
    }
  }
  return first;
}

/** The places from `from` to `to` tiles along a way, ALONG_WAY apart, both ends among them. */
function placesBetween(from: number, to: number): number[] {
  const places = [from];
  for (let s = from + ALONG_WAY; s < to; s += ALONG_WAY) {
    places.push(s);
  }
  if (to > from) {
    places.push(to);
  }
  return places;
}

/** Every point of a beat as a drone flies it, a tenth of a tile apart, facing its way. */
function beatPoints(beat: Beat): Patrol['at'][] {
  const points = beat.waypoints.map(middleOf);
  return points.flatMap((b, t) => {
    const a = points[(t - 1 + points.length) % points.length] as Spot;
    const facing = Math.atan2(b.y - a.y, b.x - a.x);
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.1));
    return Array.from({ length: n + 1 }, (_, i) => ({
      x: a.x + ((b.x - a.x) * i) / n,
      y: a.y + ((b.y - a.y) * i) / n,
      facing,
    }));
  });
}

/**
 * The floor tiles of `sight` no drone of `drones` spots anybody on — at the tile's middle,
 * wherever on its beat it flies — by key.
 */
export function havens(drones: MapDef['drones'], sight: SightOn): Set<string> {
  const looks = drones.map((drone) => {
    const { range, halfAngleDeg } = drone;
    const patrol: Patrol = { beat: drone, range, halfAngleDeg, at: { x: 0, y: 0, facing: 0 } };
    return { patrol, points: beatPoints(drone) };
  });
  const safe = new Set<string>();
  sight.map.tiles.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const p = middleOf({ x, y });
      const looked = (): boolean =>
        looks.some(({ patrol, points }) => points.some((at) => spots(patrol, at, p, sight)));
      if (walkable(sight.map, x, y) && !sight.shut.has(keyOf({ x, y })) && !looked()) {
        safe.add(keyOf({ x, y }));
      }
    }
  });
  return safe;
}
