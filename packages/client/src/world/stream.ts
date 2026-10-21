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
 * Every position goes out stamped with the run it was walked in, as it
 * changes, every POS_SEND_MS at most — kept as streamed, so that its echo is
 * no correction (movement.ts). An audience connection streams nothing.
 * Returns the timer.
 */
export function streamPositions(
  sim: Sim,
  spectator: boolean,
  send: (msg: ClientMessage) => void,
): ReturnType<typeof setInterval> {
  const lastSent: Sent = { run: NaN, x: NaN, y: NaN, facing: NaN, moving: false };
  return setInterval(() => {
    const run = sim.run;
    if (run === null || spectator || !movedSince(lastSent, run, sim.self)) {
      return;
    }
    const { x, y, facing, moving } = sim.self;
    Object.assign(lastSent, { run, x, y, facing, moving });
    const now = performance.now();
    const spot = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
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
    });
  }, POS_SEND_MS);
}
