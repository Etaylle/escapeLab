import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ART_PX,
  BOB_PIXELS,
  BOB_SPREAD,
  bobVerdict,
  dilate,
  glowAtCorners,
  haloAgainst,
  verticalShift,
} from './glowcheck.mjs';

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

/** Every pixel of a `W` × `H` picture marked. */
const ALL = new Array(W * H).fill(1);

/** A bar three rows high with its top at `top`, from column 6 on, on a grey of `ground`. */
const bar = (top, ground = 30) =>
  picture((x, y) => (y >= top && y < top + 3 && x > 5 ? 220 : ground));

/** The pixels of a bar of `bar`'s with its top at `top`: its own, marked. */
const barMask = (top) => picture((x, y) => (y >= top && y < top + 3 && x > 5 ? 1 : 0));

/** A small part's rows from its top, as a fuse lies: a bright edge, its body, a dark outline. */
const PART_ROWS = [250, 160, 120, 30];

/** Whether (x, y) lies on a part of PART_ROWS's rows over columns 16 to 23, its top at `top`. */
const onPart = (x, y, top) => x >= 16 && x < 24 && y >= top && y < top + PART_ROWS.length;

/**
 * That part with its top at `top` on a floor: of one grey, `ground`, or — `ground` left out —
 * of planks that stay where they are, light and dark rows sharp at every fourth.
 */
const withPart = (top, ground) =>
  picture((x, y) => {
    if (onPart(x, y, top)) {
      return PART_ROWS[y - top];
    }
    return ground ?? (y % 4 === 0 ? 60 : 140);
  });

/** The pixels of `withPart`'s part with its top at `top`. */
const partMask = (top) => picture((x, y) => (onPart(x, y, top) ? 1 : 0));

describe('verticalShift — how far a picture moved up or down', () => {
  it('finds a bar three pixels lower, and the light changing over it counts for nothing', () => {
    assert.deepEqual(
      { ...verticalShift(bar(10), bar(13), ALL, W, H, 6), cost: 0, still: 0 },
      { shift: 3, cost: 0, still: 0 },
    );
    const darker = verticalShift(bar(10), bar(8, 10), ALL, W, H, 6);
    assert.equal(darker.shift, -2);
    assert.ok(darker.cost < darker.still);
  });

  it('finds no shift between two pictures alike', () => {
    assert.equal(verticalShift(bar(10), bar(10), ALL, W, H, 6).shift, 0);
  });

  it('judges on the marked pixels alone: a still floor round a small part holds no sway', () => {
    // Judged on the whole picture the planks, still, hold the match where it was…
    assert.equal(verticalShift(withPart(18), withPart(20), ALL, W, H, 4).shift, 0);
    // …judged on the part's own pixels it moved two rows down.
    const moved = verticalShift(withPart(18), withPart(20), partMask(18), W, H, 4);
    assert.equal(moved.shift, 2);
    assert.ok(moved.cost < moved.still);
  });

  it('finds nothing to compare where nothing is marked', () => {
    const none = new Array(W * H).fill(0);
    assert.deepEqual(verticalShift(bar(10), bar(12), none, W, H, 3), {
      shift: 0,
      cost: Infinity,
      still: Infinity,
    });
  });
});

describe('bobVerdict — whether a part the E prompt names bobbed on the canvas', () => {
  /** A read at 64 canvas px a tile — an art pixel a canvas pixel — of `grey`, risen `lift` px. */
  const read = (lift, grey, mask) => ({
    lift: lift * ART_PX,
    scale: 64,
    width: W,
    height: H,
    grey,
    mask,
  });
  /** A read of the part with its top at `top` on a floor of `ground`, risen `lift` px. */
  const part = (lift, top, ground) => read(lift, withPart(top, ground), partMask(top));

  it('passes a part risen a pixel, then sunk one, that moved two pixels down on its own', () => {
    const verdict = bobVerdict(part(1, 10, 30), part(-1, 12, 30));
    assert.equal(verdict.fine, true);
    assert.equal(verdict.expected, 2);
    assert.equal(verdict.shift, 2);
    assert.ok(verdict.pixels >= BOB_PIXELS && verdict.spread >= BOB_SPREAD);
  });

  it('passes it among planks that stay where they are, judged on the part alone', () => {
    const verdict = bobVerdict(part(1, 18), part(-1, 20));
    assert.equal(verdict.fine, true);
    assert.equal(verdict.shift, 2);
  });

  it('fails a canvas that did not move between reads at opposite peaks, as on c500306', () => {
    // Up 0.91 px, then down 0.94, and the canvas round the part moved 0 px (1.7 expected).
    const verdict = bobVerdict(part(0.91, 18), part(-0.94, 18));
    assert.equal(verdict.fine, false);
    assert.equal(verdict.shift, 0);
  });

  it('fails reads on one side of its middle, and a move the wrong way', () => {
    assert.equal(bobVerdict(part(1, 18), part(0.5, 20)).fine, false);
    assert.equal(bobVerdict(part(1, 20), part(-1, 18)).fine, false);
  });

  it('judges nothing on too few pixels of the part, or on a part of one grey', () => {
    const sliver = picture((x, y) => (y === 18 && x >= 16 && x < 20 ? 1 : 0));
    const few = bobVerdict(read(1, withPart(18), sliver), read(-1, withPart(20), sliver));
    assert.equal(few.fine, false);
    // A bar of one grey matches the planks' light rows as well as itself.
    const flat = bobVerdict(read(1, bar(18), barMask(18)), read(-1, bar(20), barMask(20)));
    assert.equal(flat.fine, false);
    assert.ok(flat.spread < BOB_SPREAD);
  });

  it('fails where either read is missing', () => {
    assert.equal(bobVerdict(null, part(-1, 20)).fine, false);
    assert.equal(bobVerdict(part(1, 18), null).fine, false);
  });
});
