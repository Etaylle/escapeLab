import { describe, expect, it } from 'vitest';
import {
  behind,
  CABINET_RISE,
  decorRise,
  figureBox,
  hidersOf,
  hidingBox,
  RISE,
  sourceRise,
  type Tall,
} from '../src/world/depth.js';
import { isPillar, spriteHeight, spriteLift } from '../src/world/surfaces.js';
import { FLOOR_E, FLOOR_N, FLOOR_S, FLOOR_W } from '../src/world/surfaces.js';

const shelf: Tall = { x: 2, y: 5, rise: RISE, of: 'decor' };

describe('what stands tall — shelves, racks, a locker, the filing cabinet, free pillars', () => {
  it('raises the shelves and the racks half a tile, and no other furniture', () => {
    expect(decorRise('shelf')).toBe(RISE);
    expect(decorRise('rack')).toBe(RISE);
    for (const kind of ['bench', 'desk', 'barrel', 'cart', 'core', 'generator'] as const) {
      expect(decorRise(kind)).toBe(0);
    }
  });

  it('raises a locker as far, the filing cabinet less, no book or terminal', () => {
    expect(sourceRise('locker')).toBe(RISE);
    expect(sourceRise('cabinet')).toBe(CABINET_RISE);
    expect(CABINET_RISE).toBeLessThan(RISE);
    expect(sourceRise('book')).toBe(0);
    expect(sourceRise('terminal')).toBe(0);
  });

  it('takes a wall with floor all round for a pillar, and gives its sprite the rise', () => {
    const all = FLOOR_N | FLOOR_E | FLOOR_S | FLOOR_W;
    expect(isPillar(all)).toBe(true);
    expect(isPillar(FLOOR_S | FLOOR_E | FLOOR_W)).toBe(false);
    const pillar = { wall: 'server' as const, mask: all, lit: false, faceLit: false };
    const wall = { ...pillar, mask: FLOOR_S };
    expect(spriteLift(pillar)).toBe(RISE);
    expect(spriteHeight(pillar)).toBe(2 + RISE);
    expect(spriteLift(wall)).toBe(0);
    expect(spriteHeight(wall)).toBe(2);
  });
});

describe('hidersOf — what in front of something hides part of it', () => {
  it('hides a figure walking behind a shelf below the shelf’s top, and nothing above it', () => {
    // Anna in the aisle north of the shelf, her feet 0.3 under her place.
    const box = figureBox(2.6, 4.5);
    const [hiding, ...rest] = hidersOf([shelf], box, 4.5);
    expect(rest).toEqual([]);
    expect(hiding?.tall).toBe(shelf);
    expect(hiding?.clip.top).toBe(5 - RISE);
    expect(hiding?.clip.bottom).toBeCloseTo(4.8 + 0.22, 9);
    // Her head and shoulders stand over the shelf's top: only her upper part shows.
    expect(box.top).toBeLessThan(hiding?.clip.top ?? 0);
  });

  it('hides nobody standing in front of it, nor beside it on its row', () => {
    expect(hidersOf([shelf], figureBox(2.5, 6.4), 6.4)).toEqual([]);
    expect(hidersOf([shelf], figureBox(3.4, 5.5), 5.5)).toEqual([]);
  });

  it('hides nobody whose drawing lies clear of it', () => {
    expect(hidersOf([shelf], figureBox(6.5, 4.5), 4.5)).toEqual([]);
    expect(hidersOf([shelf], figureBox(2.5, 2.2), 2.2)).toEqual([]);
  });

  it('lists the tall things back to front, the nearer drawn last', () => {
    const front = { ...shelf, y: 6 };
    const box = { left: 2, top: 3, right: 3, bottom: 6.4 };
    expect(hidersOf([front, shelf], box, 4).map(({ tall }) => tall.y)).toEqual([5, 6]);
  });

  it('keeps a tall thing’s foot out of what it draws again: its shadow is not drawn twice', () => {
    expect(hidingBox(shelf)).toEqual({ left: 2, top: 4.5, right: 3, bottom: 5.5 });
    expect(behind(shelf, 5.49)).toBe(true);
    expect(behind(shelf, 5.5)).toBe(false);
  });
});
