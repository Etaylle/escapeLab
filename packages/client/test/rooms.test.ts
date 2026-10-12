import { describe, expect, it } from 'vitest';
import { startRoom } from '../src/world/rooms.js';

/**
 * Two rooms, west (x 1–3) and east (x 5–7), joined by a door at (4,2).
 *
 *   012345678
 * 0 #########
 * 1 #...#...#
 * 2 #.......#   door at (4,2)
 * 3 #...#...#
 * 4 #########
 */
const tiles = ['#########', '#...#...#', '#.......#', '#...#...#', '#########'];
const doors = [{ id: 'tuer', x: 4, y: 2, open: true }];
const labels = [
  { text: 'WEST', x: 2, y: 1 },
  { text: 'OST', x: 6, y: 1 },
];

describe('startRoom — where the briefing says you start', () => {
  it('names the room around the spawn; a door bounds it, open or not', () => {
    expect(startRoom({ tiles, doors, labels, yourSpawn: { x: 5, y: 3 } })).toBe('OST');
    expect(startRoom({ tiles, doors, labels, yourSpawn: { x: 1, y: 3 } })).toBe('WEST');
  });

  it('falls back to the nearest label when none lies in the room', () => {
    const elsewhere = [
      { text: 'FERN', x: 8, y: 4 },
      { text: 'OST', x: 6, y: 1 },
    ];
    expect(startRoom({ tiles, doors, labels: elsewhere, yourSpawn: { x: 1, y: 3 } })).toBe('OST');
  });

  it('says nothing on a map without labels', () => {
    expect(startRoom({ tiles, doors, labels: [], yourSpawn: { x: 1, y: 3 } })).toBeNull();
  });
});
