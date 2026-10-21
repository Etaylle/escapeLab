import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { deflateSync } from 'node:zlib';
import { compareDirs, decodePng, diffImages, TOLERANCE } from './pixeldiff.mjs';

/** A PNG chunk: length, type, body and a CRC the decoder does not check. */
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, body, Buffer.alloc(4)]);
}

/** The left, upper and upper-left neighbours of byte `x` in `row`, `bpp` bytes a pixel. */
function neighbours(row, above, x, bpp) {
  return [x >= bpp ? row[x - bpp] : 0, above[x], x >= bpp ? above[x - bpp] : 0];
}

/** What each filter subtracts from a byte, written out here apart from the decoder. */
const ENCODERS = [
  () => 0,
  (left) => left,
  (left, up) => up,
  (left, up) => Math.floor((left + up) / 2),
  (left, up, upLeft) => {
    const p = left + up - upLeft;
    const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
    return a <= b && a <= c ? left : b <= c ? up : upLeft;
  },
];

/**
 * A PNG of `rows` (arrays of samples), `channels` a pixel, colour type `colour`: row i
 * filtered with filter `filters[i % filters.length]`; `extra` chunks go before the data.
 */
function png(rows, { colour, channels, filters = [0], extra = [], depth = 8, interlace = 0 }) {
  const width = rows[0].length / channels;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(rows.length, 4);
  header[8] = depth;
  header[9] = colour;
  header[12] = interlace;
  let above = new Array(rows[0].length).fill(0);
  const lines = rows.map((row, i) => {
    const filter = filters[i % filters.length];
    const coded = row.map((value, x) => {
      const predicted = ENCODERS[filter](...neighbours(row, above, x, channels));
      return (value - predicted + 256) & 0xff;
    });
    above = row;
    return [filter, ...coded];
  });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...extra,
    chunk('IDAT', deflateSync(Buffer.from(lines.flat()))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Five rows of four RGB pixels whose bytes change unevenly, so that every filter has work. */
const RGB_ROWS = Array.from({ length: 5 }, (_, y) =>
  Array.from({ length: 12 }, (_, x) => (x * 37 + y * 101 + ((x * y) % 7) * 29) % 256),
);

/** The RGBA bytes of RGB rows: each pixel opaque. */
function opaque(rows) {
  return rows.flatMap((row) =>
    Array.from({ length: row.length / 3 }, (_, i) => [...row.slice(i * 3, i * 3 + 3), 255]).flat(),
  );
}

describe('decodePng — a PNG to RGBA, with no dependency', () => {
  it('undoes every scanline filter: none, sub, up, average and Paeth', () => {
    for (const filter of [0, 1, 2, 3, 4]) {
      const image = decodePng(png(RGB_ROWS, { colour: 2, channels: 3, filters: [filter] }));
      assert.equal(image.width, 4);
      assert.equal(image.height, 5);
      assert.deepEqual([...image.rgba], opaque(RGB_ROWS), `filter ${filter}`);
    }
    const mixed = decodePng(png(RGB_ROWS, { colour: 2, channels: 3, filters: [4, 3, 2, 1, 0] }));
    assert.deepEqual([...mixed.rgba], opaque(RGB_ROWS));
  });

  it('breaks Paeth’s ties as PNG does: left before up before up-left', () => {
    // Left 15, up 60, up-left 30: up and up-left tie, up wins. Left 0, up 30, up-left 20:
    // left and up-left tie, left wins.
    for (const rows of [
      [
        [30, 60],
        [15, 99],
      ],
      [
        [20, 30],
        [0, 99],
      ],
    ]) {
      const grey = decodePng(png(rows, { colour: 0, channels: 1, filters: [4] }));
      assert.deepEqual([...grey.rgba].filter((_, i) => i % 4 === 0), rows.flat());
    }
  });

  it('reads RGBA, grey and grey with alpha as RGBA', () => {
    const rgba = [[10, 20, 30, 40, 50, 60, 70, 80]];
    assert.deepEqual([...decodePng(png(rgba, { colour: 6, channels: 4 })).rgba], rgba[0]);
    const grey = decodePng(png([[7, 200]], { colour: 0, channels: 1, filters: [1] }));
    assert.deepEqual([...grey.rgba], [7, 7, 7, 255, 200, 200, 200, 255]);
    const greyAlpha = decodePng(png([[9, 128]], { colour: 4, channels: 2 }));
    assert.deepEqual([...greyAlpha.rgba], [9, 9, 9, 128]);
  });

  it('looks palette indices up, with the alpha tRNS gives them and opaque past its end', () => {
    const extra = [
      chunk('PLTE', Buffer.from([255, 0, 0, 0, 255, 0])),
      chunk('tRNS', Buffer.from([64])),
    ];
    const image = decodePng(png([[0, 1]], { colour: 3, channels: 1, extra }));
    assert.deepEqual([...image.rgba], [255, 0, 0, 64, 0, 255, 0, 255]);
  });

  it('says what is wrong with a file it cannot read', () => {
    assert.throws(() => decodePng(Buffer.from('not a png at all'), 'x.png'), /x\.png: not a PNG/);
    const deep = png([[0, 0]], { colour: 0, channels: 1, depth: 16 });
    assert.throws(() => decodePng(deep, 'deep.png'), /16-bit.*reads 8-bit PNGs/);
    const laced = png([[0]], { colour: 0, channels: 1, interlace: 1 });
    assert.throws(() => decodePng(laced, 'laced.png'), /interlace 1/);
    const extra = [chunk('PLTE', Buffer.from([1, 2, 3]))];
    const outside = png([[5]], { colour: 3, channels: 1, extra });
    assert.throws(() => decodePng(outside), /palette index 5/);
  });

  it('refuses a scanline with a filter PNG does not have, and image data cut short', () => {
    const good = png([[1, 2, 3]], { colour: 2, channels: 3 });
    const header = good.subarray(0, 33);
    const badFilter = chunk('IDAT', deflateSync(Buffer.from([5, 1, 2, 3])));
    const short = chunk('IDAT', deflateSync(Buffer.from([0, 1])));
    const end = chunk('IEND', Buffer.alloc(0));
    assert.throws(
      () => decodePng(Buffer.concat([header, badFilter, end])),
      /row 0 names filter 5/,
    );
    assert.throws(() => decodePng(Buffer.concat([header, short, end])), /cut short/);
  });
});

/** A 3×2 image of one colour, with the pixel at `at` set to `pixel`. */
function image(pixel, at = 4) {
  const rgba = new Uint8Array(3 * 2 * 4).fill(100);
  rgba.set(pixel, at * 4);
  return { width: 3, height: 2, rgba };
}

describe('diffImages — which pixels changed', () => {
  it('counts nothing for the same pixels, nor for a step within the tolerance', () => {
    const same = diffImages(image([100, 100, 100, 100]), image([100, 100, 100, 100]));
    assert.deepEqual(same, { sameSize: true, differing: 0, share: 0, box: null, maxStep: 0 });
    const within = diffImages(image([100, 100, 100, 100]), image([100, 100 + TOLERANCE, 100, 100]));
    assert.equal(within.differing, 0);
    assert.equal(within.maxStep, TOLERANCE);
  });

  it('counts a pixel a channel of which moved past the tolerance, alpha too, and boxes it', () => {
    const moved = diffImages(image([100, 100, 100, 100]), image([100, 100, 100, 100 - 3]));
    assert.equal(moved.differing, 1);
    assert.equal(moved.share, 1 / 6);
    assert.deepEqual(moved.box, [1, 1, 1, 1]);
    assert.equal(moved.maxStep, 3);
  });

  it('boxes every changed pixel', () => {
    const a = image([0, 0, 0, 0], 0);
    const b = image([0, 0, 0, 0], 5);
    assert.deepEqual(diffImages(a, b).box, [0, 0, 2, 1]);
  });

  it('compares no images of two sizes', () => {
    const wide = { width: 6, height: 1, rgba: new Uint8Array(24) };
    assert.equal(diffImages(image([1, 1, 1, 1]), wide).sameSize, false);
  });
});

/** Writes `files` (name → PNG bytes) into a new folder under `root`; returns its path. */
function folder(root, name, files) {
  const dir = join(root, name);
  mkdirSync(dir);
  for (const [file, bytes] of Object.entries(files)) {
    writeFileSync(join(dir, file), bytes);
  }
  return dir;
}

describe('compareDirs — two capture folders, file by file', () => {
  const root = mkdtempSync(join(tmpdir(), 'pixeldiff-'));
  /** Two RGB pixels, and the same with the second one's red moved far. */
  const plain = png([[10, 10, 10, 10, 10, 10]], { colour: 2, channels: 3 });
  const changed = png([[10, 10, 10, 90, 10, 10]], { colour: 2, channels: 3 });

  it('passes the same pictures and reports every file at 0.00 %', () => {
    const lines = [];
    const ok = compareDirs(
      folder(root, 'a1', { 'one.png': plain }),
      folder(root, 'b1', { 'one.png': plain }),
      0,
      (line) => lines.push(line),
    );
    assert.equal(ok, true);
    assert.match(lines[0], /^one\.png\s+2×1\s+0\.00 %$/);
    assert.match(lines.at(-1), /1 compared, 0 failed/);
  });

  it('fails a file over the threshold, and passes it under a looser one', () => {
    const before = folder(root, 'a2', { 'one.png': plain });
    const after = folder(root, 'b2', { 'one.png': changed });
    const lines = [];
    assert.equal(compareDirs(before, after, 0, (line) => lines.push(line)), false);
    assert.match(lines[0], /^one\.png\s+!! 2×1\s+50\.00 %\s+1 px in x 1–1, y 0–0, max step 80$/);
    assert.equal(compareDirs(before, after, 50, () => undefined), true);
    assert.equal(compareDirs(before, after, 49.9, () => undefined), false);
  });

  it('fails where a file is in one folder only', () => {
    const lines = [];
    const ok = compareDirs(
      folder(root, 'a3', { 'one.png': plain, 'two.png': plain }),
      folder(root, 'b3', { 'one.png': plain, 'three.png': plain }),
      0,
      (line) => lines.push(line),
    );
    assert.equal(ok, false);
    assert.ok(lines.some((line) => /^two\.png\s+!! only in .*a3$/.test(line)));
    assert.ok(lines.some((line) => /^three\.png\s+!! only in .*b3$/.test(line)));
  });
});
