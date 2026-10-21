/**
 * Pixel comparison of two capture folders, PNG by PNG under the same names —
 * the proof that a refactoring of the world's drawing changed no pixel:
 *
 *   node tools/pixeldiff.mjs <before-dir> <after-dir> <max-percent>
 *
 * Prints, per file, the share of pixels that differ by more than TOLERANCE
 * (2 of 255) in any channel, with the box they lie in and the largest step,
 * and fails (exit code 1) where a file's share lies above <max-percent>, where
 * the two sizes differ, or where a file is in one folder only. No dependency:
 * PNG is decoded here, with zlib's inflate and the five scanline filters, for
 * 8-bit images without interlacing — what Chromium's screenshots are.
 */
import { Buffer } from 'node:buffer';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

/** How far a channel may move, of 255, before its pixel counts as changed. */
export const TOLERANCE = 2;

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Channels per pixel by PNG colour type: grey, RGB, palette, grey + alpha, RGBA. */
const CHANNELS = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
]);
/** The colour type whose samples index a palette. */
const PALETTE = 3;

/** A PNG's header: its size and the format of its samples. */
function readHeader(body) {
  const head = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    width: head.getUint32(0),
    height: head.getUint32(4),
    depth: body[8],
    colour: body[9],
    interlace: body[12],
  };
}

/**
 * The chunks of a PNG that make its pixels: the header, the palette and its
 * transparency where there are, and the pieces of the image data.
 */
function readChunks(bytes, name) {
  if (!SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    throw new Error(`${name}: not a PNG (its first eight bytes are no PNG signature)`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found = { header: null, palette: null, alpha: null, data: [] };
  let pos = SIGNATURE.length;
  while (pos + 8 <= bytes.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const body = bytes.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === 'IHDR') {
      found.header = readHeader(body);
    } else if (type === 'PLTE') {
      found.palette = body;
    } else if (type === 'tRNS') {
      found.alpha = body;
    } else if (type === 'IDAT') {
      found.data.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }
  return found;
}

/** Checks that this decoder reads the image `header` describes; says what it cannot. */
function checkHeader(header, name) {
  if (header === null) {
    throw new Error(`${name}: no IHDR chunk, so no size or format to read the pixels by`);
  }
  const { depth, colour, interlace } = header;
  if (depth !== 8 || !CHANNELS.has(colour) || interlace !== 0) {
    throw new Error(
      `${name}: ${depth}-bit, colour type ${colour}, interlace ${interlace} — this ` +
        'decoder reads 8-bit PNGs without interlacing (colour types 0, 2, 3, 4, 6), ' +
        'as Chromium writes them',
    );
  }
}

/** The Paeth predictor: of left, up and up-left, the one nearest to left + up - up-left. */
function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const toLeft = Math.abs(p - left);
  const toUp = Math.abs(p - up);
  const toUpLeft = Math.abs(p - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) {
    return left;
  }
  return toUp <= toUpLeft ? up : upLeft;
}

/** What scanline filter `filter` predicts a byte to be from its neighbours. */
function predict(filter, left, up, upLeft) {
  switch (filter) {
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4:
      return paeth(left, up, upLeft);
    default:
      return 0;
  }
}

/**
 * Undoes one scanline's filter: `raw` holds its bytes after the filter byte,
 * and `out` gets the row at `at`, the row above it already undone; `bpp`
 * bytes a pixel.
 */
function unfilterRow(filter, raw, out, at, stride, bpp) {
  const above = at - stride;
  for (let x = 0; x < stride; x++) {
    const left = x >= bpp ? out[at + x - bpp] : 0;
    const up = above >= 0 ? out[above + x] : 0;
    const upLeft = x >= bpp && above >= 0 ? out[above + x - bpp] : 0;
    out[at + x] = (raw[x] + predict(filter, left, up, upLeft)) & 0xff;
  }
}

/** The image's samples, row by row with the filters undone: `channels` bytes a pixel. */
function unfilter(inflated, { width, height }, channels, name) {
  const stride = width * channels;
  if (inflated.length < height * (stride + 1)) {
    throw new Error(
      `${name}: the image data holds ${inflated.length} bytes, a ${width}×${height} image ` +
        `needs ${height * (stride + 1)} — the file is cut short`,
    );
  }
  const out = new Uint8Array(height * stride);
  for (let row = 0; row < height; row++) {
    const start = row * (stride + 1);
    const filter = inflated[start];
    if (filter > 4) {
      throw new Error(`${name}: row ${row} names filter ${filter}; PNG has filters 0 to 4`);
    }
    const raw = inflated.subarray(start + 1, start + 1 + stride);
    unfilterRow(filter, raw, out, row * stride, stride, channels);
  }
  return out;
}

/** Palette samples as RGBA: each index looked up, its alpha from tRNS where it has one. */
function fromPalette(samples, palette, alpha, name) {
  const rgba = new Uint8Array(samples.length * 4);
  samples.forEach((index, i) => {
    if (palette === null || index * 3 + 2 >= palette.length) {
      throw new Error(`${name}: palette index ${index}, and the palette has no such colour`);
    }
    rgba.set(palette.subarray(index * 3, index * 3 + 3), i * 4);
    rgba[i * 4 + 3] = alpha !== null && index < alpha.length ? alpha[index] : 255;
  });
  return rgba;
}

/** Grey, grey with alpha, RGB or RGBA samples, `channels` a pixel, as RGBA. */
function fromSamples(samples, channels) {
  const pixels = samples.length / channels;
  const rgba = new Uint8Array(pixels * 4);
  const grey = channels < 3;
  const withAlpha = channels === 2 || channels === 4;
  for (let i = 0; i < pixels; i++) {
    const s = i * channels;
    if (grey) {
      rgba.fill(samples[s], i * 4, i * 4 + 3);
    } else {
      rgba.set(samples.subarray(s, s + 3), i * 4);
    }
    rgba[i * 4 + 3] = withAlpha ? samples[s + channels - 1] : 255;
  }
  return rgba;
}

/**
 * Decodes a PNG file's bytes into its size and its pixels as RGBA, four bytes
 * a pixel, row by row.
 *
 * @param {Uint8Array} bytes the whole file
 * @param {string} [name] the file's name, for the errors
 * @returns {{ width: number, height: number, rgba: Uint8Array }}
 * @throws {Error} for a file that is no PNG, is cut short, or is in a format this does not read
 */
export function decodePng(bytes, name = 'png') {
  const { header, palette, alpha, data } = readChunks(bytes, name);
  checkHeader(header, name);
  if (data.length === 0) {
    throw new Error(`${name}: no IDAT chunk, so no pixels`);
  }
  const channels = CHANNELS.get(header.colour);
  const samples = unfilter(inflateSync(Buffer.concat(data)), header, channels, name);
  const rgba =
    header.colour === PALETTE
      ? fromPalette(samples, palette, alpha, name)
      : fromSamples(samples, channels);
  return { width: header.width, height: header.height, rgba };
}

/** `box` — left, top, right, bottom — grown to take in (x, y). */
function grow(box, x, y) {
  if (box === null) {
    return [x, y, x, y];
  }
  const [left, top, right, bottom] = box;
  return [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)];
}

/**
 * How two decoded images differ.
 *
 * @param {{ width: number, height: number, rgba: Uint8Array }} a the one before
 * @param {{ width: number, height: number, rgba: Uint8Array }} b the one after
 * @param {number} [tolerance] how far a channel may move, of 255, and its pixel still count as
 *   the same
 * @returns {{ sameSize: boolean, differing: number, share: number,
 *   box: number[] | null, maxStep: number }} the pixels changed in any channel by more than
 *   `tolerance`, their share of the image, the box they lie in (left, top, right, bottom,
 *   inclusive; null for none) and the largest step of any channel; for two sizes `sameSize`
 *   is false and the counts 0
 */
export function diffImages(a, b, tolerance = TOLERANCE) {
  if (a.width !== b.width || a.height !== b.height) {
    return { sameSize: false, differing: 0, share: 0, box: null, maxStep: 0 };
  }
  let differing = 0;
  let maxStep = 0;
  let box = null;
  for (let i = 0; i < a.rgba.length; i += 4) {
    let step = 0;
    for (let c = 0; c < 4; c++) {
      step = Math.max(step, Math.abs(a.rgba[i + c] - b.rgba[i + c]));
    }
    maxStep = Math.max(maxStep, step);
    if (step > tolerance) {
      differing += 1;
      box = grow(box, (i / 4) % a.width, Math.floor(i / 4 / a.width));
    }
  }
  return { sameSize: true, differing, share: differing / (a.width * a.height), box, maxStep };
}

/** The PNG files of a folder, by name, sorted. */
function pngsIn(dir) {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .sort();
}

/** One file's line of the report, and whether it passes `maxPercent`. */
function compareFile(beforeDir, afterDir, name, maxPercent) {
  const a = decodePng(readFileSync(join(beforeDir, name)), join(beforeDir, name));
  const b = decodePng(readFileSync(join(afterDir, name)), join(afterDir, name));
  const diff = diffImages(a, b);
  if (!diff.sameSize) {
    const sizes = `${a.width}×${a.height} before, ${b.width}×${b.height} after`;
    return { line: `${name.padEnd(24)} !! sizes differ: ${sizes}`, ok: false };
  }
  const ok = diff.share * 100 <= maxPercent;
  const share = `${(diff.share * 100).toFixed(2)} %`.padStart(8);
  const size = `${a.width}×${a.height}`.padEnd(10);
  const [left, top, right, bottom] = diff.box ?? [];
  const box = `x ${left}–${right}, y ${top}–${bottom}`;
  const where =
    diff.box === null ? '' : `  ${diff.differing} px in ${box}, max step ${diff.maxStep}`;
  return { line: `${name.padEnd(24)} ${ok ? '  ' : '!!'} ${size} ${share}${where}`, ok };
}

/**
 * Compares every PNG of one folder with its namesake in the other and prints
 * the report, a line a file and a summary.
 *
 * @param {string} beforeDir the captures before
 * @param {string} afterDir the captures after
 * @param {number} maxPercent the share of changed pixels a file may have, in percent
 * @param {(line: string) => void} [log] where the report goes
 * @returns {boolean} whether every file passes: in both folders, of one size, at most
 *   `maxPercent` of its pixels changed
 */
export function compareDirs(beforeDir, afterDir, maxPercent, log = console.log) {
  const before = pngsIn(beforeDir);
  const after = new Set(pngsIn(afterDir));
  let failed = 0;
  for (const name of before) {
    if (!after.has(name)) {
      log(`${name.padEnd(24)} !! only in ${beforeDir}`);
      failed += 1;
      continue;
    }
    const { line, ok } = compareFile(beforeDir, afterDir, name, maxPercent);
    log(line);
    failed += ok ? 0 : 1;
  }
  for (const name of [...after].filter((n) => !before.includes(n))) {
    log(`${name.padEnd(24)} !! only in ${afterDir}`);
    failed += 1;
  }
  const compared = before.filter((name) => after.has(name)).length;
  log(
    `${'summary'.padEnd(24)} ${compared} compared, ${failed} failed ` +
      `(over ${maxPercent} %, of two sizes or in one folder only)`,
  );
  return failed === 0;
}

/** The command line: two folders and the share of changed pixels a file may have, in percent. */
function main(args) {
  const [beforeDir, afterDir, max] = args;
  const maxPercent = Number(max);
  if (beforeDir === undefined || afterDir === undefined || !(maxPercent >= 0)) {
    console.error('usage: node tools/pixeldiff.mjs <before-dir> <after-dir> <max-percent>');
    console.error('  e.g. node tools/pixeldiff.mjs shots-before shots-after 0');
    process.exitCode = 2;
    return;
  }
  process.exitCode = compareDirs(beforeDir, afterDir, maxPercent) ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
