import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dilate, glowAtCorners, haloAgainst, verticalShift } from './glowcheck.mjs';

const W = 40;
const H = 40;

/** A `W` × `H` picture whose pixel (x, y) is `value(x, y)`, row by row. */
const picture = (value) =>
  Array.from({ length: W * H }, (_, i) => value(i % W, Math.floor(i / W)));

/** How far (x, y) lies outside the square from 15 to 24 each way, in pixels; 0 inside it. */
const outside = (x, y) => Math.hypot(Math.max(0, 15 - x, x - 24), Math.max(0, 15 - y, y - 24));

/** A thing: the square opaque, all else clear. */
const SQUARE = picture((x, y) => (outside(x, y) === 0 ? 255 : 0));
/** Its glow: falling off from its edge over about 6 pixels. */
const GLOW = picture((x, y) => Math.round(255 * Math.exp(-((outside(x, y) / 3) ** 2))));

describe('dilate — where a glow may lie round a thing', () => {
  it('grows a pixel into a square `reach` each way, cut at the edges', () => {
    const one = new Uint8Array(W * H);
    one[2 * W + 30] = 1;
    const grown = dilate(one, W, H, 3);
    const on = [...grown].flatMap((v, i) => (v ? [[i % W, Math.floor(i / W)]] : []));
    assert.equal(on.length, 7 * 6); // rows 0 to 5 only: two lie above the picture
    assert.ok(on.every(([x, y]) => Math.abs(x - 30) <= 3 && y <= 5));
  });
});

describe('haloAgainst — whether a glow follows its thing', () => {
  it('finds a glow in the thing’s shape strong, and none of it astray', () => {
    const pixels = { halo: GLOW, silhouette: SQUARE, width: W, height: H };
    const seen = haloAgainst(pixels, 10);
    assert.equal(seen.strongest, 255);
    assert.equal(seen.solid, 100);
    assert.ok(seen.glowing > 100);
    assert.equal(seen.stray, 0);
  });

  it('finds a box drawn round the thing astray', () => {
    const ring = (x, y) => Math.max(Math.abs(x - 19.5), Math.abs(y - 19.5)) === 17.5;
    const box = picture((x, y) => (ring(x, y) ? 200 : 0));
    const seen = haloAgainst({ halo: box, silhouette: SQUARE, width: W, height: H }, 10);
    assert.ok(seen.stray > 0, `${seen.stray} pixels astray`);
  });
});

describe('glowAtCorners — the old box’s corners on the halo', () => {
  it('reads each corner of the box round the anchor, and none off the canvas', () => {
    // 10 px a tile, the anchor at (20, 20): the box one tile round it has its corners at 10 and 30.
    const halo = picture((x, y) => (x === 30 && y === 10 ? 90 : 0));
    const pixels = { level: 10, left: -20, top: -20, width: W, height: H, halo };
    assert.deepEqual(glowAtCorners(pixels, { x: -1, y: -1, w: 2, h: 2 }), [0, 90, 0, 0]);
    assert.deepEqual(glowAtCorners(pixels, { x: -3, y: -1, w: 2, h: 2 }), [null, 0, null, 0]);
  });

  it('finds no glow at the corners of a box round a thing that glows in its shape', () => {
    const pixels = { level: 10, left: -20, top: -20, width: W, height: H, halo: GLOW };
    assert.deepEqual(glowAtCorners(pixels, { x: -1.7, y: -1.7, w: 3.4, h: 3.4 }), [0, 0, 0, 0]);
  });
});

describe('verticalShift — how far a picture moved up or down', () => {
  /** A bar three rows high with its top at `top`, on a grey of `ground`. */
  const bar = (top, ground = 30) =>
    picture((x, y) => (y >= top && y < top + 3 && x > 5 ? 220 : ground));

  it('finds a bar three pixels lower, and the light changing over it counts for nothing', () => {
    assert.deepEqual(
      { ...verticalShift(bar(10), bar(13), W, H, 6), cost: 0, still: 0 },
      { shift: 3, cost: 0, still: 0 },
    );
    const darker = verticalShift(bar(10), bar(8, 10), W, H, 6);
    assert.equal(darker.shift, -2);
    assert.ok(darker.cost < darker.still);
  });

  it('finds no shift between two pictures alike', () => {
    assert.equal(verticalShift(bar(10), bar(10), W, H, 6).shift, 0);
  });
});
