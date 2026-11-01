import type { ClientMessage } from '@escapelab/core';
import { ECHO_MS } from './movement.js';
import type { Sim } from './sim.js';

/** How often your position may go out, ms. */
const POS_SEND_MS = 80;

/** What went out last. */
interface Sent {
  run: number;
  x: number;
  y: number;
  facing: number;
  moving: boolean;
}

/** Whether your avatar stands elsewhere than it last went out: another run, a step, a turn. */
function movedSince(sent: Sent, run: number, { x, y, facing, moving }: Sim['self']): boolean {
  return (
    run !== sent.run ||
    Math.abs(x - sent.x) > 0.01 ||
    Math.abs(y - sent.y) > 0.01 ||
    Math.abs(facing - sent.facing) > 0.05 ||
    moving !== sent.moving
  );
}

/**
 * Every position goes out stamped with the run it was walked in and the moment it was true —
 * the frame that walked it, epoch ms by this page's clock (`Sim.selfAt`): the partners draw
 * the walk on those moments (trail.ts) — as it changes, every POS_SEND_MS at most, kept as
 * streamed, so that its echo is no correction (movement.ts). An audience connection streams
 * nothing, nor a screen whose opening holds its avatar (`Sim.held`). Returns the timer.
 */
export function streamPositions(
  sim: Sim,
  spectator: boolean,
  send: (msg: ClientMessage) => void,
): ReturnType<typeof setInterval> {
  const lastSent: Sent = { run: NaN, x: NaN, y: NaN, facing: NaN, moving: false };
  return setInterval(() => {
    const run = sim.run;
    if (run === null || spectator || sim.held || !movedSince(lastSent, run, sim.self)) {
      return;
    }
    const { x, y, facing, moving } = sim.self;
    Object.assign(lastSent, { run, x, y, facing, moving });
    const now = performance.now();
    // A thousandth of a tile: the partners draw the walk through these points (trail.ts).
    const spot = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
    sim.streamed = [
      ...sim.streamed.filter((sent) => now - sent.at <= ECHO_MS),
      { ...spot, at: now },
    ];
    send({
      kind: 'pos',
      run,
      ...spot,
      facing: Math.round(facing * 100) / 100,
      moving,
      t: Math.round((performance.timeOrigin + sim.selfAt) * 10) / 10,
    });
  }, POS_SEND_MS);
}
