import { doorOpen, type DronePosition, type GameState, type MapDef } from '@escapelab/core';

/** Runtime state of one patrolling drone; lives outside the pure game state. */
interface DroneRuntime {
  /** index of the waypoint it is heading towards */
  target: number;
  x: number;
  y: number;
  facing: number;
  /** epoch ms until which it cannot trigger another alarm */
  quietUntil: number;
}

const ALARM_COOLDOWN_MS = 5000;
/** The cone is slightly blind right at the drone so you can slip past behind it. */
const MIN_SPOT_DISTANCE = 0.4;
const LOS_SAMPLE = 0.2;

export interface SpottedEvent {
  droneId: string;
  penaltySec: number;
}

/**
 * Drone patrols: deterministic waypoint loops, cone-of-vision detection with
 * line of sight, and a cooldown so one sighting costs time exactly once.
 * Players working at a station (a puzzle is open) are not spotted — the
 * console counts as cover, which keeps the penalty fair.
 */
export class DronePatrol {
  private readonly runtime = new Map<string, DroneRuntime>();

  constructor(private readonly map: MapDef) {
    this.reset();
  }

  get active(): boolean {
    return this.map.drones.length > 0;
  }

  reset(): void {
    this.runtime.clear();
    for (const drone of this.map.drones) {
      const start = drone.waypoints[0];
      if (start === undefined) {
        continue;
      }
      this.runtime.set(drone.id, {
        target: 1 % drone.waypoints.length,
        x: start.x + 0.5,
        y: start.y + 0.5,
        facing: 0,
        quietUntil: 0,
      });
    }
  }

  /** Advance every drone by `dt` seconds along its waypoint loop. */
  step(dt: number): void {
    for (const drone of this.map.drones) {
      const self = this.runtime.get(drone.id);
      const target = drone.waypoints[self?.target ?? 0];
      if (self === undefined || target === undefined) {
        continue;
      }
      const tx = target.x + 0.5;
      const ty = target.y + 0.5;
      const dist = Math.hypot(tx - self.x, ty - self.y);
      if (dist < 0.05) {
        self.target = (self.target + 1) % drone.waypoints.length;
        continue;
      }
      const stepLen = Math.min(dist, drone.speed * dt);
      self.x += ((tx - self.x) / dist) * stepLen;
      self.y += ((ty - self.y) / dist) * stepLen;
      self.facing = Math.atan2(ty - self.y, tx - self.x);
    }
  }

  /**
   * Check every drone against every exposed player. Returns one event per
   * drone that just caught someone (at most one per cooldown window).
   */
  detect(
    state: GameState,
    playerPositions: Map<string, { x: number; y: number }>,
    now: number,
  ): SpottedEvent[] {
    if (state.puzzleState !== null) {
      return []; // everyone is heads-down at a console
    }
    const events: SpottedEvent[] = [];
    for (const drone of this.map.drones) {
      const self = this.runtime.get(drone.id);
      if (self === undefined || now < self.quietUntil) {
        continue;
      }
      const halfAngle = (drone.halfAngleDeg * Math.PI) / 180;
      const caught = state.players.some((player) => {
        if (!player.connected) {
          return false;
        }
        const pos = playerPositions.get(player.id);
        if (pos === undefined) {
          return false;
        }
        const dx = pos.x - self.x;
        const dy = pos.y - self.y;
        const dist = Math.hypot(dx, dy);
        if (dist > drone.range || dist < MIN_SPOT_DISTANCE) {
          return false;
        }
        let delta = Math.abs(Math.atan2(dy, dx) - self.facing) % (Math.PI * 2);
        if (delta > Math.PI) {
          delta = Math.PI * 2 - delta;
        }
        if (delta > halfAngle) {
          return false;
        }
        return this.hasLineOfSight(state, self.x, self.y, pos.x, pos.y);
      });
      if (caught) {
        self.quietUntil = now + ALARM_COOLDOWN_MS;
        events.push({ droneId: drone.id, penaltySec: drone.penaltySec });
      }
    }
    return events;
  }

  /** Wire-format snapshot for the clients. */
  snapshot(now: number): Record<string, DronePosition> {
    const out: Record<string, DronePosition> = {};
    for (const drone of this.map.drones) {
      const self = this.runtime.get(drone.id);
      if (self === undefined) {
        continue;
      }
      out[drone.id] = {
        x: Math.round(self.x * 100) / 100,
        y: Math.round(self.y * 100) / 100,
        facing: Math.round(self.facing * 100) / 100,
        range: drone.range,
        halfAngleDeg: drone.halfAngleDeg,
        alerted: now < self.quietUntil,
      };
    }
    return out;
  }

  private hasLineOfSight(
    state: GameState,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / LOS_SAMPLE);
    for (let i = 1; i < steps; i++) {
      const x = ax + ((bx - ax) * i) / steps;
      const y = ay + ((by - ay) * i) / steps;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (this.map.tiles[ty]?.charAt(tx) !== '.') {
        return false;
      }
      const door = this.map.doors.find((d) => d.x === tx && d.y === ty);
      if (door !== undefined && !doorOpen(this.map, state, door.id)) {
        return false;
      }
    }
    return true;
  }
}
