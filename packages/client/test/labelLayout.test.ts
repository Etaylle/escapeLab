import { describe, expect, it } from 'vitest';
import { placeLabels, type PropLabel } from '../src/world/labelLayout.js';

/** A label two tiles wide and a fifth high, its top 0.41 under its thing at (x, y). */
function label(key: string, x: number, y: number, rank = 1): PropLabel {
  return { key, x, y, below: 0.41, width: 2, height: 0.2, rank };
}

describe('placeLabels — the labels under the lab’s things, kept apart', () => {
  it('keeps every label in its own place where nothing lies in its way', () => {
    const { spots, boxes } = placeLabels([label('a', 2, 2), label('b', 6, 2), label('c', 2, 5)]);
    expect(boxes).toHaveLength(3);
    expect([...spots]).toEqual([
      ['a', 0.41],
      ['b', 0.41],
      ['c', 0.41],
    ]);
  });

  it('moves the one that matters less a line down where two would lie on each other', () => {
    // „HALTEN · TÜR" under a plate and „KLEMMBRETT" under the clipboard two tiles on.
    const { spots } = placeLabels([label('klemmbrett', 8.5, 9.5, 1), label('platte', 6.5, 9.5, 2)]);
    expect(spots.get('platte')).toBe(0.41);
    expect(spots.get('klemmbrett')).toBeCloseTo(0.41 + 0.2 + 0.08, 9);
  });

  it('lets the first given keep its place among labels that matter alike', () => {
    const { spots } = placeLabels([label('a', 2, 2), label('b', 3, 2)]);
    expect(spots.get('a')).toBe(0.41);
    expect(spots.get('b')).toBeGreaterThan(0.41);
  });

  it('leaves a label out where its place and the line under it are both taken', () => {
    // A label of a thing a little lower takes the line under the first one's place.
    const below = label('below', 3, 2.3, 3);
    const { spots, boxes } = placeLabels([label('a', 2, 2, 2), below, label('c', 2.5, 2, 1)]);
    expect(spots.get('a')).toBe(0.41);
    expect(spots.get('below')).toBe(0.41);
    expect(spots.get('c')).toBeNull();
    // What it covers is the two placed: the one left out covers nothing.
    expect(boxes).toHaveLength(2);
  });

  it('places nothing for no labels', () => {
    expect(placeLabels([])).toEqual({ spots: new Map(), boxes: [] });
  });
});
