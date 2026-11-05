import { useEffect, useState, type PointerEvent } from 'react';

/**
 * The action cluster under the right thumb of a touch screen (GameWorld.tsx, styles/world.css):
 * four buttons two by two, at rest a little see-through so that the lab shows through them, and
 * whole while a finger is on one of them and for CLUSTER_AWAKE_MS after the last one lifted.
 * Pure but for `useClusterWake`.
 */

/** How long the cluster stays whole after the last finger lifted off it, ms. */
export const CLUSTER_AWAKE_MS = 2000;

/** The fingers on the cluster, and when it goes back to rest once none is. */
export class ClusterWake {
  private readonly fingers = new Set<number>();
  private rests = Number.NEGATIVE_INFINITY;

  /** A finger, by its pointer id, came down on the cluster. */
  down(id: number): void {
    this.fingers.add(id);
  }

  /** A finger lifted off the cluster at `now` (ms), or the browser took it away. */
  up(id: number, now: number): void {
    if (this.fingers.delete(id) && this.fingers.size === 0) {
      this.rests = now + CLUSTER_AWAKE_MS;
    }
  }

  /** Whether the cluster stands whole at `now` (ms). */
  awake(now: number): boolean {
    return this.fingers.size > 0 || now < this.rests;
  }

  /**
   * How long from `now` (ms) until the cluster is to be looked at again: a moment past the time
   * it goes back to rest, so that a timer that came a moment early is set once more instead of
   * leaving it whole; null while a finger is on it, and once it rests.
   */
  nextLook(now: number): number | null {
    return this.fingers.size > 0 || now >= this.rests ? null : this.rests - now + 1;
  }
}

/** The pointer handlers that wake the cluster, caught on their way down to its buttons. */
export interface WakeHandlers {
  onPointerDownCapture: (e: PointerEvent) => void;
  onPointerUpCapture: (e: PointerEvent) => void;
  onPointerCancelCapture: (e: PointerEvent) => void;
}

/**
 * The cluster's wake on this screen (`ClusterWake`): whether it stands whole now, and the
 * handlers its box catches every finger with — whatever button the finger is for, held or
 * pressed — drawing it anew as it wakes, and after every drawing that finds it whole with no
 * finger on it once more when it is to go back to rest (`nextLook`).
 */
export function useClusterWake(): { awake: boolean; handlers: WakeHandlers } {
  const [wake] = useState(() => new ClusterWake());
  const [, redraw] = useState(0);
  const now = performance.now();
  const next = wake.nextLook(now);
  useEffect(() => {
    if (next === null) {
      return undefined;
    }
    const timer = setTimeout(() => redraw((n) => n + 1), next);
    return () => clearTimeout(timer);
  });
  const lift = (e: PointerEvent): void => {
    wake.up(e.pointerId, performance.now());
    redraw((n) => n + 1);
  };
  return {
    awake: wake.awake(now),
    handlers: {
      onPointerDownCapture: (e) => {
        wake.down(e.pointerId);
        redraw((n) => n + 1);
      },
      onPointerUpCapture: lift,
      onPointerCancelCapture: lift,
    },
  };
}
