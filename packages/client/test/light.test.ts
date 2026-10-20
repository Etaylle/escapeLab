import { describe, expect, it } from 'vitest';
import { sightFrom } from '@escapelab/core';
import {
  doorsShut,
  lightClip,
  litTiles,
  reachOf,
  sightCache,
  type Lamp,
} from '../src/world/light.js';

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
const map = { tiles: ['#########', '#...#...#', '#.......#', '#...#...#', '#########'] };
const open = doorsShut({ doors: [{ id: 'tuer', x: 4, y: 2, open: true }] });
const shut = doorsShut({ doors: [{ id: 'tuer', x: 4, y: 2, open: false }] });

const glow = (x: number, y: number, radius: number): Lamp => ({ x, y, glow: radius, beam: null });

describe('doorsShut', () => {
  it('lists the doors that stop light right now, by tile', () => {
    expect([...open]).toEqual([]);
    expect([...shut]).toEqual(['4,2']);
  });
});

describe('lightClip — where a lamp’s light may fall', () => {
  it('takes the room’s walls whole, row by row, and nothing behind them', () => {
    const clip = lightClip(sightFrom(map, { x: 2.5, y: 2.5 }, 7.5, shut));
    expect(clip.walls).toEqual([
      { x: 0, y: 0, length: 5 },
      { x: 0, y: 1, length: 1 },
      { x: 4, y: 1, length: 1 },
      { x: 0, y: 2, length: 1 },
      { x: 4, y: 2, length: 1 },
      { x: 0, y: 3, length: 1 },
      { x: 4, y: 3, length: 1 },
      { x: 0, y: 4, length: 5 },
    ]);
  });

  it('outlines the floor up to the walls, and on through the door once it is open', () => {
    const inRoom = lightClip(sightFrom(map, { x: 2.5, y: 2.5 }, 7.5, shut)).outline;
    expect(inRoom.length).toBeGreaterThan(100);
    expect(inRoom.every((p) => p.x >= 1 - 1e-9 && p.x <= 4 + 1e-9)).toBe(true);
    expect(inRoom.every((p) => p.y >= 1 - 1e-9 && p.y <= 4 + 1e-9)).toBe(true);
    const through = lightClip(sightFrom(map, { x: 2.5, y: 2.5 }, 7.5, open)).outline;
    expect(Math.max(...through.map((p) => p.x))).toBeCloseTo(8, 6);
  });

  it('keeps the outline of the sight it was made from, corner by corner', () => {
    const sight = sightFrom(map, { x: 6.2, y: 1.7 }, 4, open);
    expect(lightClip(sight).outline).toBe(sight.outline);
  });
});

describe('litTiles — what a lamp lights', () => {
  it('lights what its glow touches and nothing beyond it', () => {
    const lit = litTiles(glow(2.5, 2.5, 1), sightFrom(map, { x: 2.5, y: 2.5 }, 1, shut));
    expect(lit.sort()).toEqual(['1,1', '1,2', '1,3', '2,1', '2,2', '2,3', '3,1', '3,2', '3,3']);
  });

  it('lights far down its beam, through an open door, and not beside it', () => {
    const lamp: Lamp = { x: 1.5, y: 2.5, glow: 0, beam: { facing: 0, halfAngle: 0.3, reach: 6 } };
    const lit = litTiles(lamp, sightFrom(map, lamp, reachOf(lamp), open));
    expect(lit).toEqual(expect.arrayContaining(['1,2', '5,2', '7,2']));
    expect(lit).not.toContain('1,1');
    expect(lit).not.toContain('1,3');
    const blocked = litTiles(lamp, sightFrom(map, lamp, reachOf(lamp), shut));
    expect(blocked).toContain('4,2');
    expect(blocked.filter((key) => Number(key.split(',')[0]) > 4)).toEqual([]);
  });

  it('lights nothing behind a wall, even close by', () => {
    const lit = litTiles(glow(3.5, 1.5, 3), sightFrom(map, { x: 3.5, y: 1.5 }, 3, shut));
    expect(lit).toContain('4,1');
    expect(lit).not.toContain('5,1');
  });
});

describe('reachOf', () => {
  it('reaches as far as the glow or the beam, whichever is longer', () => {
    expect(reachOf(glow(0, 0, 2.8))).toBe(2.8);
    expect(reachOf({ x: 0, y: 0, glow: 3.2, beam: { facing: 0, halfAngle: 0.5, reach: 7.5 } })).toBe(
      7.5,
    );
  });
});

describe('sightCache', () => {
  it('takes a sight once for a lamp standing still, and afresh when a door moves', () => {
    const look = sightCache();
    const first = look(map, { x: 2.5, y: 2.5 }, 5, open);
    expect(first).toEqual(sightFrom(map, { x: 2.5, y: 2.5 }, 5, open));
    expect(look(map, { x: 2.5, y: 2.5 }, 5, new Set())).toBe(first);
    expect(look(map, { x: 2.5004, y: 2.5 }, 5, open)).toBe(first);
    expect(look(map, { x: 2.6, y: 2.5 }, 5, open)).not.toBe(first);
    expect(look(map, { x: 2.5, y: 2.5 }, 5, shut)).not.toBe(first);
    expect(look(map, { x: 2.5, y: 2.5 }, 3, open)).not.toBe(first);
  });

  it('forgets everything once it holds as many sights as it may', () => {
    const look = sightCache(2);
    const first = look(map, { x: 1.5, y: 1.5 }, 3, open);
    look(map, { x: 2.5, y: 1.5 }, 3, open);
    look(map, { x: 3.5, y: 1.5 }, 3, open);
    expect(look(map, { x: 1.5, y: 1.5 }, 3, open)).not.toBe(first);
  });
});
