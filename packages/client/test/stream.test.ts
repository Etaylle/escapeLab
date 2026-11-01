import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage } from '@escapelab/core';
import { newSim } from '../src/world/sim.js';
import { streamPositions } from '../src/world/stream.js';

const RUN = 1_000;

describe('the position stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps each position with the frame it was walked in, to the thousandth of a tile', () => {
    const sim = newSim(0);
    sim.run = RUN;
    const sent: ClientMessage[] = [];
    const timer = streamPositions(sim, false, (msg) => sent.push(msg));
    for (const [frame, x] of [
      [1_000, 3.50012],
      [1_083.3, 3.83372],
    ] as const) {
      Object.assign(sim.self, { x, y: 2.5, facing: 0, moving: true });
      sim.selfAt = frame;
      vi.advanceTimersByTime(80);
    }
    expect(sent).toEqual([
      { kind: 'pos', run: RUN, x: 3.5, y: 2.5, facing: 0, moving: true, t: stamp(1_000) },
      { kind: 'pos', run: RUN, x: 3.834, y: 2.5, facing: 0, moving: true, t: stamp(1_083.3) },
    ]);
    clearInterval(timer);
  });

  it('sends nothing while the avatar stands as it was sent', () => {
    const sim = newSim(0);
    sim.run = RUN;
    Object.assign(sim.self, { x: 3.5, y: 2.5 });
    const sent: ClientMessage[] = [];
    const timer = streamPositions(sim, false, (msg) => sent.push(msg));
    vi.advanceTimersByTime(80);
    sim.selfAt += 400;
    vi.advanceTimersByTime(400);
    expect(sent).toHaveLength(1);
    clearInterval(timer);
  });
});

/** A frame's moment as the stream stamps it: epoch ms by the page's clock, to a tenth. */
function stamp(frame: number): number {
  return Math.round((performance.timeOrigin + frame) * 10) / 10;
}
