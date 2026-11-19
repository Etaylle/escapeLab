import { WALK_SPEED, type MapDef, type Mission } from '@escapelab/core';
import { havens, patrolsOn, spottedOn, type Patrol, type SightOn } from './patrol.js';
import {
  distance,
  groundOf,
  keyOf,
  lengthOf,
  middleOf,
  pointAlong,
  shutOn,
  tileOf,
  wayOver,
  type Spot,
} from './route.js';
import { pause, type Clock, type Script } from './script.js';
import type { Seat } from './seat.js';

/**
 * How the demo crew walks: at a player's pace, from tile to tile along a shortest way over the
 * floor its view shows, and past the drones as a crew times its run past a patrol — from haven
 * to haven, each stretch between taken in one go once no flight foretold from the stream would
 * have a cone on it (patrol.ts). It never runs for it: a walk waits for its gap.
 */

/** A figure this near its goal stands on it, tiles. */
const ARRIVED = 0.02;
/** The longest a tick is taken to have lasted, s: a server that hung does not fling a figure. */
const LONGEST_TICK_S = 0.25;
/** How often a walk that waits for its gap looks at the patrols again, ms. */
const LOOK_AGAIN_MS = 160;
/** How long ahead a figure caught in the open weighs staying where it is, s. */
const STAY_S = 1.5;

/** No way leads where a seat is to go, the doors as they stand. */
export class NoWay extends Error {}

export class Walks {
  /** the havens worked out so far, by the drones they are from and the doors shut */
  private readonly havensBy = new Map<string, Set<string>>();
  /** the tiles a walk goes round: where the mission's consoles stand and its sources may lie */
  private readonly round: ReadonlySet<string>;

  /** `emergency` says whether one has the lab: the drones spot nobody while it lasts. */
  constructor(
    private readonly mission: Mission,
    private readonly clock: Clock,
    private readonly emergency: () => boolean,
  ) {
    const { stations, manuals } = mission.map;
    this.round = new Set([...stations, ...manuals.flatMap((source) => source.spots)].map(keyOf));
  }

  /**
   * `seat` walks to the point `goal`, where it will stand in the open for `hold` s — until it is
   * in cover at a console, or off again. Throws NoWay where the doors leave none.
   */
  *to(seat: Seat, goal: Spot, hold = 0): Script {
    while (distance(seat.at, goal) > ARRIVED) {
      const way = this.wayOf(seat, goal);
      const stretch = this.stretchOf(seat, way);
      const last = stretch.length === way.length;
      yield* this.gap(seat, stretch, last ? hold : 0);
      yield* this.stride(seat, stretch);
    }
  }

  /** Whether a way leads `seat` to the tile of `goal`, the doors as they stand. */
  reaches(seat: Seat, goal: Spot): boolean {
    return this.tilesTo(seat, goal) !== null;
  }

  /** The points of `seat`'s way to `goal`: where it stands, the tiles' middles, the goal. */
  private wayOf(seat: Seat, goal: Spot): Spot[] {
    const tiles = this.tilesTo(seat, goal);
    if (tiles === null) {
      const from = keyOf(tileOf(seat.at));
      throw new NoWay(`no way for ${seat.name} from ${from} to ${keyOf(tileOf(goal))}`);
    }
    return [seat.at, ...tiles.slice(1, -1).map(middleOf), goal];
  }

  /** The tiles of `seat`'s way to `goal`, round the consoles and the sources; null for none. */
  private tilesTo(seat: Seat, goal: Spot): Spot[] | null {
    const ground = groundOf(seat.map, new Set(), this.round);
    return wayOver(ground, tileOf(seat.at), tileOf(goal));
  }

  /** What sight goes by on `seat`'s map as it stands. */
  private sightOf(seat: Seat): SightOn {
    return { map: seat.map, shut: shutOn(seat.map) };
  }

  /**
   * The tiles of `seat`'s map none of `drones` ever looks at, the doors as they stand, by key:
   * all of the mission's drones where none is named — a place to stand that stays one when the
   * next patrol wakes.
   */
  havensFor(seat: Seat, drones: MapDef['drones'] = this.mission.map.drones): Set<string> {
    const sight = this.sightOf(seat);
    const key = `${drones.map((d) => d.id).join(',')}|${[...sight.shut].sort().join(';')}`;
    let safe = this.havensBy.get(key);
    if (safe === undefined) {
      safe = havens(drones, sight);
      this.havensBy.set(key, safe);
    }
    return safe;
  }

  /** The drones that look right now, as `seat`'s stream has them. */
  private patrolsOf(seat: Seat): Patrol[] {
    return patrolsOn(this.mission.map.drones, seat.drones);
  }

  /**
   * The stretch of `way` a figure takes in one go: all of it while no drone looks, else up to
   * the first haven after its start.
   */
  private stretchOf(seat: Seat, way: Spot[]): Spot[] {
    const awake = this.mission.map.drones.filter((drone) => seat.drones[drone.id] !== undefined);
    if (awake.length === 0) {
      return way;
    }
    const safe = this.havensFor(seat, awake);
    const stop = way.findIndex((point, i) => i > 0 && safe.has(keyOf(tileOf(point))));
    return stop < 0 ? way : way.slice(0, stop + 1);
  }

  /**
   * Gives way until `seat` can take `stretch` and stand at its end for `hold` s with no cone on
   * it. An emergency is waited out where it stands: the drones fly on through it, and see
   * again the moment it is over. A figure in the open sets out all the same once staying is no
   * better.
   */
  private *gap(seat: Seat, stretch: Spot[], hold: number): Script {
    for (;;) {
      const patrols = this.patrolsOf(seat);
      if (patrols.length === 0 || (!this.emergency() && this.clear(seat, stretch, hold))) {
        return;
      }
      yield* pause(this.clock, LOOK_AGAIN_MS);
    }
  }

  /** Whether `seat` may set out on `stretch` now: no cone foretold on it, or staying no better. */
  private clear(seat: Seat, stretch: Spot[], hold: number): boolean {
    const sight = this.sightOf(seat);
    const patrols = this.patrolsOf(seat);
    const delay = Math.max(0, (this.clock.now - seat.dronesAt) / 1000);
    const going = spottedOn({ points: stretch, speed: WALK_SPEED, hold, delay }, patrols, sight);
    if (going === null) {
      return true;
    }
    const staying = spottedOn(
      { points: [seat.at], speed: WALK_SPEED, hold: STAY_S, delay },
      patrols,
      sight,
    );
    return staying !== null && staying <= going;
  }

  /**
   * `seat` walks `stretch` at a player's pace, a step a tick, every corner of it passed on the
   * way. Ends early where the room threw the figure back — a door shut before it.
   */
  private *stride(seat: Seat, stretch: Spot[]): Script {
    const length = lengthOf(stretch);
    let along = 0;
    let last = this.clock.now;
    while (along < length) {
      yield;
      if (distance(seat.at, pointAlong(stretch, along)) > ARRIVED) {
        return;
      }
      const seconds = Math.min(LONGEST_TICK_S, (this.clock.now - last) / 1000);
      last = this.clock.now;
      const next = Math.min(length, along + WALK_SPEED * seconds);
      for (const corner of cornersBetween(stretch, along, next)) {
        seat.stepTo(corner, true);
      }
      seat.stepTo(pointAlong(stretch, next), next < length);
      along = next;
    }
  }
}

/** The points of `way` that lie strictly between `from` and `to` tiles along it. */
function cornersBetween(way: readonly Spot[], from: number, to: number): Spot[] {
  const corners: Spot[] = [];
  let along = 0;
  for (let i = 1; i < way.length - 1; i++) {
    along += distance(way[i - 1] as Spot, way[i] as Spot);
    if (along > from && along < to) {
      corners.push(way[i] as Spot);
    }
  }
  return corners;
}
