import { describe, expect, it } from 'vitest';
import { drawsFrame } from '../src/world/drawRate.js';

const PLAYER = { locked: false, spectator: false };
const UNDER_PANEL = { locked: true, spectator: false };
const AUDIENCE = { locked: true, spectator: true };

/** Whether each of `count` frames from number `from` on is drawn. */
function drawn(from: number, count: number, world: typeof PLAYER): boolean[] {
  return Array.from({ length: count }, (_, i) => drawsFrame(from + i, world));
}

/** The longest run of undrawn frames in a row. */
function longestGap(frames: boolean[]): number {
  let longest = 0;
  let gap = 0;
  for (const draws of frames) {
    gap = draws ? 0 : gap + 1;
    longest = Math.max(longest, gap);
  }
  return longest;
}

describe('drawsFrame — how often the world is drawn', () => {
  it('draws every frame while the player moves in the world', () => {
    expect(drawn(1, 9, PLAYER)).toEqual(Array<boolean>(9).fill(true));
  });

  it('draws every third frame under an open panel', () => {
    expect(drawn(1, 9, UNDER_PANEL)).toEqual([
      false, false, true,
      false, false, true,
      false, false, true,
    ]);
  });

  it('never leaves more than two frames in a row undrawn, wherever the panel opens', () => {
    for (const from of [1, 2, 3, 1000]) {
      const frames = drawn(from, 30, UNDER_PANEL);
      expect(frames.filter(Boolean)).toHaveLength(10);
      expect(longestGap(frames)).toBe(2);
    }
  });

  it('draws the very next frame once the panel closes', () => {
    expect(drawsFrame(4, UNDER_PANEL)).toBe(false);
    expect(drawsFrame(4, PLAYER)).toBe(true);
  });

  it('keeps every frame for the audience, whose world is locked for want of controls', () => {
    expect(drawn(1, 9, AUDIENCE)).toEqual(Array<boolean>(9).fill(true));
  });
});
