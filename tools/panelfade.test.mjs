import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drawnText, fadeOf, fadeVerdict, meanLuma, midway } from './panelfade.mjs';

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

const FADE = 150;
/** A frame drawn `t` ms into the record, `fade` ms into the fade (null: none), at `opacity`. */
const frame = (t, fade, opacity, inert = true) => ({
  t,
  present: true,
  leaving: fade !== null,
  inert,
  opacity,
  fade,
});
const goneAt = (t) => ({ ...frame(t, null, 0, false), present: false });
/** The record of a panel that began to leave at 10 ms and was gone at `gone`. */
const record = (frames, gone = 162) => ({
  left: 10,
  gone,
  inertAtLeft: true,
  frames: [frame(2, null, 1, false), ...frames, goneAt(gone + 4)],
});
/** A fade at the screen's pace: a frame every 16.7 ms, the ease-in's opacities. */
const paced = record([
  frame(12, 0, 1),
  frame(29, 17, 1),
  frame(46, 33, 0.98),
  frame(62, 50, 0.95),
  frame(79, 67, 0.9),
  frame(96, 83, 0.81),
  frame(112, 100, 0.69),
  frame(129, 117, 0.54),
  frame(146, 133, 0.33),
]);

describe('fadeOf and fadeVerdict — the frames a panel going drew, on the page’s own clock', () => {
  it('judges a fade at the screen’s pace by its frames: midway in its middle, all well', () => {
    const fade = fadeOf(paced, FADE);
    assert.deepEqual(fade, {
      left: true,
      ms: 152,
      falling: true,
      inert: true,
      faded: true,
      midway: 5,
      middle: 4,
      drawn: [0, 17, 33, 50, 67, 83, 100, 117, 133],
    });
    assert.deepEqual(fadeVerdict(fade, FADE), { faults: [], unjudged: null });
  });

  it('leaves the midway frames unjudged where the page drew none in the fade’s middle', () => {
    // Under load: the fade's first frame, then none until the panel was gone.
    const fade = fadeOf(record([frame(110, 0, 1)], 182), FADE);
    assert.equal(fade.midway, 0);
    assert.equal(fade.middle, 0);
    assert.deepEqual(fadeVerdict(fade, FADE), {
      faults: [],
      unjudged:
        'the page drew no frame 75 to 135 ms into the 150-ms fade, only at 0 ms of it, the ' +
        'panel gone 172 ms after it began to leave: no frame to judge midway; the held shot ' +
        'judges the fade',
    });
  });

  it('leaves them unjudged where the page drew no frame at all while the panel left', () => {
    // Under load: a frame before the panel began to leave, the next once it was gone.
    const fade = fadeOf(record([], 162), FADE);
    assert.deepEqual(fade.drawn, []);
    assert.deepEqual(fadeVerdict(fade, FADE), {
      faults: [],
      unjudged:
        'the page drew no frame while the panel left, the panel gone 152 ms after it began to ' +
        'leave: no frame to judge midway; the held shot judges the fade',
    });
  });

  it('judges no frames midway of a panel gone at once: it had no fade to draw', () => {
    // The page drew the panel whole, then gone: it never began to leave.
    const frames = [frame(2, null, 1), goneAt(24)];
    const once = { left: null, gone: 20, inertAtLeft: null, frames };
    assert.deepEqual(fadeVerdict(fadeOf(once, FADE), FADE), {
      faults: ['it went at once, never leaving'],
      unjudged: null,
    });
  });

  it('fails a fade that never falls on a frame in its middle, naming the frames’ times', () => {
    const still = fadeOf(record([frame(12, 0, 1), frame(100, 88, 1), frame(140, 128, 0.99)]), FADE);
    assert.deepEqual(fadeVerdict(still, FADE), {
      faults: ['no frame showed it midway: its frames came 0, 88, 128 ms into the 150-ms fade'],
      unjudged: null,
    });
  });

  it('says the fade’s times at the frames drawn, a dash where none ran', () => {
    assert.equal(drawnText([0, 16.6, null]), '0, 17, –');
    assert.equal(drawnText([]), 'none');
  });
});

describe('fadeVerdict — what is wrong with a panel going, on the page’s own clock', () => {
  it('fails a panel gone at once, never gone, gone too soon or too late, or with no fade', () => {
    const at = (left, gone) => fadeVerdict(fadeOf({ ...paced, left, gone }, FADE), FADE).faults;
    assert.deepEqual(at(null, 20), ['it went at once, never leaving']);
    assert.deepEqual(at(10, null), ['it never went']);
    assert.deepEqual(at(10, 700), ["it went 690 ms after it began to leave, on the page's clock"]);
    assert.deepEqual(at(10, 90), ["it went 80 ms after it began to leave, on the page's clock"]);
    const bare = record([frame(12, null, 1), frame(29, null, 1)]);
    bare.frames = bare.frames.map((f) => (f.t > 10 && f.present ? { ...f, leaving: true } : f));
    assert.deepEqual(fadeVerdict(fadeOf(bare, FADE), FADE), {
      faults: ['no fade-out ran on the frames it drew'],
      unjudged: null,
    });
  });

  it('fails an opacity that rises on the way out, and a panel taking input as it left', () => {
    const back = record([frame(12, 0, 1), frame(80, 70, 0.5), frame(120, 110, 0.9)]);
    assert.deepEqual(fadeVerdict(fadeOf(back, FADE), FADE).faults, [
      'its opacity rose on its way out',
    ]);
    const keys = fadeOf({ ...paced, inertAtLeft: false }, FADE);
    assert.deepEqual(fadeVerdict(keys, FADE).faults, ['it took input as it left']);
    const late = record([frame(12, 0, 1), frame(80, 70, 0.9, false)]);
    assert.deepEqual(fadeVerdict(fadeOf(late, FADE), FADE).faults, ['it took input as it left']);
  });
});
