import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fadeOf, meanLuma, midway } from './panelfade.mjs';

/** An image `width` × `height`, every pixel `rgb`. */
function flat(width, height, [r, g, b]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba.set([r, g, b, 255], i);
  }
  return { width, height, rgba };
}

describe('meanLuma — how bright a box of a picture is', () => {
  it('averages the luma of the pixels in the box, at the picture’s scale', () => {
    const image = flat(10, 10, [0, 0, 0]);
    // The right half white.
    for (let y = 0; y < 10; y++) {
      for (let x = 5; x < 10; x++) {
        image.rgba.set([255, 255, 255, 255], (y * 10 + x) * 4);
      }
    }
    assert.ok(Math.abs(meanLuma(image, { x: 0, y: 0, width: 10, height: 10 }) - 127.5) < 1e-9);
    assert.ok(Math.abs(meanLuma(image, { x: 3, y: 0, width: 2, height: 2 }, 2) - 255) < 1e-9);
    assert.equal(meanLuma(image, { x: 20, y: 20, width: 5, height: 5 }), 0);
  });
});

describe('midway — a picture between the panel up and gone', () => {
  it('holds a value well between the two, either way round, and nothing at their ends', () => {
    assert.equal(midway(200, 120, 40), true);
    assert.equal(midway(40, 120, 200), true);
    assert.equal(midway(200, 195, 40), false);
    assert.equal(midway(200, 45, 40), false);
    assert.equal(midway(100, 100, 100), false);
  });
});

describe('fadeOf — the frames a panel took to go', () => {
  const frame = (t, present, opacity, leaving = present, inert = leaving) => ({
    t,
    present,
    leaving,
    inert,
    opacity,
  });

  it('says how long it was leaving, the frames midway, that it only fell and took nothing', () => {
    const samples = [
      frame(0, true, 1, false, false),
      frame(16, true, 1),
      frame(33, true, 0.8),
      frame(50, true, 0.55),
      frame(66, true, 0.3),
      frame(83, true, 0.04),
      frame(166, false, 0),
    ];
    assert.deepEqual(fadeOf(samples), { ms: 150, midway: 3, falling: true, inert: true });
  });

  it('tells a panel that went at once, one that flickered back, and one that kept the keys', () => {
    assert.deepEqual(fadeOf([frame(0, true, 1, false), frame(16, false, 0)]), {
      ms: null,
      midway: 0,
      falling: true,
      inert: true,
    });
    const back = fadeOf([frame(0, true, 0.5), frame(16, true, 0.9), frame(33, false, 0)]);
    assert.equal(back.falling, false);
    const keys = fadeOf([frame(0, true, 0.5, true, false), frame(16, false, 0)]);
    assert.equal(keys.inert, false);
  });
});
