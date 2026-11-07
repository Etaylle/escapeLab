import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changedShare, LEAST_CHANGE, sweepOf, sweepVerdict, TURN_SLACK } from './sweep.mjs';

/** An image `width` × `height`, every pixel `rgb`. */
function flat(width, height, [r, g, b]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba.set([r, g, b, 255], i);
  }
  return { width, height, rgba };
}

describe('changedShare — how much of a box changed between two pictures', () => {
  it('counts the pixels moved past the tolerance in a channel, at the pictures’ scale', () => {
    const a = flat(10, 10, [10, 10, 10]);
    const b = flat(10, 10, [10, 10, 10]);
    // A quarter of the picture lit red in the second, a step of 2 elsewhere (within tolerance).
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        b.rgba.set([200, 30, 30, 255], (y * 10 + x) * 4);
      }
    }
    b.rgba.set([12, 12, 12, 255], (9 * 10 + 9) * 4);
    assert.equal(changedShare(a, b, { x: 0, y: 0, width: 10, height: 10 }), 0.25);
    assert.equal(changedShare(a, b, { x: 0, y: 0, width: 2.5, height: 2.5 }, 2), 1);
    assert.equal(changedShare(a, b, { x: 5, y: 5, width: 5, height: 5 }), 0);
  });

  it('finds nothing in a box off the pictures, or between pictures of other sizes', () => {
    const a = flat(4, 4, [0, 0, 0]);
    assert.equal(changedShare(a, flat(4, 4, [99, 0, 0]), { x: 9, y: 9, width: 3, height: 3 }), 0);
    assert.equal(changedShare(a, flat(5, 4, [99, 0, 0]), { x: 0, y: 0, width: 4, height: 4 }), 0);
  });
});

describe('sweepOf, sweepVerdict — a beacon’s lobe turned as its clock says', () => {
  it('reads a third of a turn in a second of a 3-second turn, across the wrap', () => {
    const third = (2 * Math.PI) / 3;
    const sweep = sweepOf({ angle: 5.9, t: 10 }, { angle: 5.9 + third - 2 * Math.PI, t: 11 }, 3000);
    assert.ok(Math.abs(sweep.turned - (2 * Math.PI) / 3) < 1e-9);
    assert.ok(Math.abs(sweep.expected - (2 * Math.PI) / 3) < 1e-9);
    assert.ok(sweep.off < 1e-9);
    assert.equal(sweepVerdict(sweep, LEAST_CHANGE), true);
  });

  it('fails a lobe standing still, one turned the wrong way, and a picture unchanged', () => {
    const still = sweepOf({ angle: 1, t: 10 }, { angle: 1, t: 11 }, 3000);
    assert.equal(sweepVerdict(still, 0.3), false);
    const wrong = sweepOf({ angle: 1, t: 10 }, { angle: 1 - (2 * Math.PI) / 3, t: 11 }, 3000);
    assert.ok(wrong.off > TURN_SLACK);
    assert.equal(sweepVerdict(wrong, 0.3), false);
    const turned = sweepOf({ angle: 1, t: 10 }, { angle: 1 + (2 * Math.PI) / 3, t: 11 }, 3000);
    assert.equal(sweepVerdict(turned, LEAST_CHANGE / 2), false);
  });

  it('reads a slow sweep against its own turn', () => {
    const slow = sweepOf({ angle: 0, t: 0 }, { angle: Math.PI / 3, t: 1 }, 6000);
    assert.ok(slow.off < 1e-9);
    assert.equal(sweepVerdict(slow, 0.1), true);
  });
});
