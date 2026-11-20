/**
 * The machine's fixed step (the reference's src/game.js): the simulation advances in steps of
 * 1/120 s whatever the screen's rate, gaps over 0.1 s clamped, and keeps where things stood
 * before the latest step, so that drawing can place them in between (`alpha`).
 */
import { current, step, type Actions, type Game } from './rules.js';
import { stepModern } from './modern.js';

export const STEP = 1 / 120;

/** One step under the rules the game was started with. */
export function advanceGame(g: Game, input: Actions, dt: number): void {
  if (g.classic) step(g, input, dt);
  else stepModern(g, input, dt);
}

/** Where things stood before a step, by object: [x, y], a diver's by its dive offset. */
export type Snapshot = Map<object, readonly [number, number]>;

export function snapshot(g: Game): Snapshot {
  const p = current(g);
  const seen: Snapshot = new Map([[p, [p.x, 0] as const]]);
  for (const o of [...p.shots, ...p.pickups, p.saucer, p.boss]) {
    if (o) seen.set(o, [o.x, o.y]);
  }
  for (const d of p.ducks) if (d.dive) seen.set(d, [d.ox ?? 0, d.oy ?? 0]);
  return seen;
}

export class FixedClock {
  last: number | null = null;
  accumulator = 0;
  hold = 0;
  previous: Snapshot = new Map();

  reset(): void {
    this.last = null;
    this.accumulator = 0;
    this.hold = 0;
    this.previous = new Map();
  }

  /** Hit-stop: the simulation waits a moment while drawing goes on. */
  freeze(seconds: number): void {
    this.hold = Math.max(this.hold, seconds);
  }

  get alpha(): number {
    return Math.min(1, this.accumulator / STEP);
  }

  /** Advances `game` to the page's time `now` (ms) with `input` held. */
  tick(now: number, game: Game, input: Actions): void {
    if (this.last === null) {
      this.last = now;
      return;
    }
    const elapsed = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.hold > 0) {
      this.hold = Math.max(0, this.hold - elapsed);
      return;
    }
    this.accumulator += elapsed;
    while (this.accumulator >= STEP) {
      this.previous = snapshot(game);
      advanceGame(game, input, STEP);
      this.accumulator -= STEP;
    }
  }
}
