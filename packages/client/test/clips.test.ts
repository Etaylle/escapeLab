import { describe, expect, it } from 'vitest';
import type { MapView } from '@escapelab/core';
import { clipNeeded, shutKey } from '../src/world/render/clips.js';
import { mapWith } from './fixtures.js';
import { frameWith } from './frames.js';

/**
 * Whether a moving light needs the clip of what it sees (clips.ts `clipNeeded`): a wrong „no"
 * lets its light through a wall or a shut door, so every way of getting it wrong is held here.
 */

/** A hall of 15 × 11 tiles, walls round it, `doors` on its floor. */
function hall(doors: MapView['doors'] = []): MapView {
  return mapWith({
    width: 15,
    height: 11,
    tiles: ['#'.repeat(15), ...Array(9).fill(`#${'.'.repeat(13)}#`), '#'.repeat(15)],
    doors,
  });
}

const REACH = 1.5;
const at = (x: number, y: number) => ({ x, y, reach: REACH });
const needs = (map: MapView, spot: { x: number; y: number; reach: number }) => {
  const frame = frameWith({ map });
  return clipNeeded(frame, spot, shutKey(frame));
};

describe('clipNeeded', () => {
  it('spares the clip in the open middle of a room, and not at a wall 1.1 tiles away', () => {
    const map = hall();
    expect(needs(map, at(7.5, 5.5))).toBe(false);
    // The west wall's face stands at x = 1: 1.1 tiles from the spot, within its reach.
    expect(needs(map, at(2.1, 5.5))).toBe(true);
  });

  it('answers each spot of the same map on its own', () => {
    const map = hall();
    expect(needs(map, at(7.5, 5.5))).toBe(false);
    expect(needs(map, at(1.5, 5.5))).toBe(true);
    expect(needs(map, at(7.5, 5.5))).toBe(false);
  });

  it('wants the clip where a shut door lies within reach, not where it stands open', () => {
    expect(needs(hall([{ id: 'tuer', x: 8, y: 6, open: false }]), at(7.5, 5.5))).toBe(true);
    expect(needs(hall([{ id: 'tuer', x: 8, y: 6, open: true }]), at(7.5, 5.5))).toBe(false);
  });

  it('asks again where a door shuts between two frames at the same spot', () => {
    const map = hall([{ id: 'tuer', x: 8, y: 6, open: true }]);
    expect(needs(map, at(7.5, 5.5))).toBe(false);
    const door = map.doors[0];
    if (door !== undefined) {
      door.open = false;
    }
    expect(needs(map, at(7.5, 5.5))).toBe(true);
  });
});
