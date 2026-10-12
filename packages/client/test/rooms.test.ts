import { describe, expect, it } from 'vitest';
import { roomArea, roomFloor, startRoom } from '../src/world/rooms.js';

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

const keys = (spots: { x: number; y: number }[]): string[] =>
  spots.map((s) => `${s.x},${s.y}`).sort();

describe('roomFloor — the floor a room label stands on', () => {
  it('floods the floor up to the door, open or not', () => {
    const west = ['1,1', '1,2', '1,3', '2,1', '2,2', '2,3', '3,1', '3,2', '3,3'];
    expect(keys(roomFloor({ tiles, doors }, { x: 2, y: 1 }))).toEqual(west);
    const shut = [{ id: 'tuer', x: 4, y: 2, open: false }];
    expect(keys(roomFloor({ tiles, doors: shut }, { x: 2, y: 1 }))).toEqual(west);
  });

  it('runs on into the next room where no door stands between', () => {
    expect(roomFloor({ tiles, doors: [] }, { x: 2, y: 1 })).toHaveLength(19);
  });

  it('is empty off the floor and on a door', () => {
    expect(roomFloor({ tiles, doors }, { x: 0, y: 0 })).toEqual([]);
    expect(roomFloor({ tiles, doors }, { x: 4, y: 2 })).toEqual([]);
    expect(roomFloor({ tiles, doors }, { x: 40, y: 2 })).toEqual([]);
  });
});

describe("roomArea — what a room's lights reach", () => {
  it('lights the floor, the walls around it and the door in them', () => {
    const area = keys(roomArea({ tiles, doors }, { x: 2, y: 1 }));
    expect(area).toHaveLength(25);
    expect(area).toContain('0,0');
    expect(area).toContain('4,4');
    expect(area).toContain('4,2');
  });

  it('stops at the door: the floor of the room next door stays dark', () => {
    const area = keys(roomArea({ tiles, doors }, { x: 2, y: 1 }));
    expect(area.filter((tile) => Number(tile.split(',')[0]) > 4)).toEqual([]);
    const east = keys(roomArea({ tiles, doors }, { x: 6, y: 1 }));
    expect(east.filter((tile) => Number(tile.split(',')[0]) < 4)).toEqual([]);
    expect(east).toContain('4,2');
  });

  it('takes no floor across a corner, only the walls there — not even a door', () => {
    // Two rooms touching corner to corner: (1,1)–(2,2) and (3,3)–(4,4).
    const corner = ['######', '#..###', '#..###', '###..#', '###..#', '######'];
    const area = keys(roomArea({ tiles: corner, doors: [] }, { x: 1, y: 1 }));
    expect(area).not.toContain('3,3');
    expect(area).toContain('3,2');
    expect(area).toHaveLength(15);
    const door = [{ id: 'eck', x: 3, y: 3, open: false }];
    expect(keys(roomArea({ tiles: corner, doors: door }, { x: 1, y: 1 }))).toEqual(area);
  });

  it('lights nothing for a label off the floor', () => {
    expect(roomArea({ tiles, doors }, { x: 4, y: 0 })).toEqual([]);
  });
});
