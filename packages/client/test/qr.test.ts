import { describe, expect, it } from 'vitest';
import {
  correctionOf,
  QR_MAX_BYTES,
  QUIET_MODULES,
  qrOf,
  qrPath,
  sizeOf,
  type QrModules,
} from '../src/qr.js';

/**
 * The QR codes the page makes, read back: a reader of its own here takes a code's modules apart
 * as a scanner does — the format's bits in both their places, the mask taken off, the codewords
 * out of the free modules, each block's Reed–Solomon check, the bytes — by the standard's tables
 * written down a second time, not by the encoder's.
 */

/** `a` times `b` in GF(2^8) by 0x11d, by logs: another way than the encoder's shifts. */
const EXP: number[] = [];
const LOG: number[] = [];
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x = x * 2 >= 256 ? (x * 2) ^ 0x11d : x * 2;
}
const mul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : (EXP[((LOG[a] ?? 0) + (LOG[b] ?? 0)) % 255] ?? 0);

/** Whether `block`, data then correction, is a codeword: zero at α^0 … α^(checks−1). */
function checksOut(block: readonly number[], checks: number): boolean {
  return Array.from({ length: checks }, (_, i) =>
    block.reduce((sum, codeword) => mul(sum, EXP[i] ?? 0) ^ codeword, 0),
  ).every((syndrome) => syndrome === 0);
}

/** The fifteen format strings of level M by mask (ISO/IEC 18004, annex C). */
const FORMAT_M = [
  '101010000010010',
  '101000100100101',
  '101111001111100',
  '101101101001011',
  '100010111111001',
  '100000011001110',
  '100111110010111',
  '100101010100000',
];

/** Blocks and their data and correction codewords at level M, versions 1 to 6. */
const BLOCKS = [
  [1, 16, 10],
  [1, 28, 16],
  [1, 44, 26],
  [2, 32, 18],
  [2, 43, 24],
  [4, 27, 16],
] as const;

const MASKS: ((row: number, col: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

/** Whether `row`, `col` lies in a finder's corner of a code `size` a side, its format beside it. */
function inCorner(size: number, row: number, col: number): boolean {
  const far = size - 8;
  return [row < 9 && col < 9, row < 9 && col >= far, row >= far && col < 9].some(Boolean);
}

/** Whether the module at `row`, `col` of a code `size` a side belongs to a function pattern. */
function functional(size: number, row: number, col: number): boolean {
  const near = (at: number): boolean => Math.abs(at - (size - 7)) <= 2;
  const alignment = size > 21 && near(row) && near(col);
  return inCorner(size, row, col) || row === 6 || col === 6 || alignment;
}

/** The format's bits as read from the code's first place, most significant first, and second. */
function formatsOf(m: QrModules): [string, string] {
  const size = m.length;
  const at = (row: number, col: number): string => (m[row]?.[col] === true ? '1' : '0');
  const first = [
    ...[0, 1, 2, 3, 4, 5, 7, 8].map((col) => at(8, col)),
    ...[7, 5, 4, 3, 2, 1, 0].map((row) => at(row, 8)),
  ];
  const second = [
    ...[1, 2, 3, 4, 5, 6, 7].map((k) => at(size - k, 8)),
    ...[8, 7, 6, 5, 4, 3, 2, 1].map((k) => at(8, size - k)),
  ];
  return [first.join(''), second.join('')];
}

/** The bits of `m`'s free modules in the order a reader takes them, the mask `mask` taken off. */
function bitsIn(m: QrModules, mask: number): number[] {
  const size = m.length;
  const bits: number[] = [];
  const pairs = Array.from({ length: (size - 1) / 2 }, (_, k) => {
    const right = size - 1 - 2 * k;
    return right <= 6 ? right - 1 : right;
  });
  pairs.forEach((right, k) => {
    for (let step = 0; step < size; step++) {
      const row = k % 2 === 0 ? size - 1 - step : step;
      for (const col of [right, right - 1].filter((c) => !functional(size, row, c))) {
        bits.push(Number((m[row]?.[col] === true) !== (MASKS[mask]?.(row, col) === true)));
      }
    }
  });
  return bits;
}

/** What a reader makes of `m`: its version and mask, whether every block checks out, its text. */
function read(m: QrModules) {
  const version = (m.length - 17) / 4;
  const [first, second] = formatsOf(m);
  const mask = FORMAT_M.indexOf(first);
  const bits = bitsIn(m, mask);
  const [blocks, data, correction] = BLOCKS[version - 1] ?? [0, 0, 0];
  const total = blocks * (data + correction);
  const codewords = Array.from({ length: total }, (_, i) =>
    bits.slice(i * 8, i * 8 + 8).reduce((byte, bit) => (byte << 1) | bit, 0),
  );
  const block = (b: number): number[] => [
    ...Array.from({ length: data }, (_, i) => codewords[i * blocks + b] ?? 0),
    ...Array.from({ length: correction }, (_, i) => codewords[blocks * data + i * blocks + b] ?? 0),
  ];
  const all = Array.from({ length: blocks }, (_, b) => block(b));
  const stream = all.flatMap((codeword) => codeword.slice(0, data));
  const bitsOf = stream.flatMap((byte) =>
    Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1),
  );
  const take = (from: number, length: number): number =>
    bitsOf.slice(from, from + length).reduce((value, bit) => (value << 1) | bit, 0);
  const count = take(4, 8);
  const bytes = Uint8Array.from({ length: count }, (_, i) => take(12 + i * 8, 8));
  return {
    version,
    mask,
    formatsAgree: first === second,
    mode: take(0, 4),
    sound: all.every((codeword) => checksOut(codeword, correction)),
    spare: bits.length - total * 8,
    text: new TextDecoder().decode(bytes),
  };
}

const SITE = 'https://escapelab.onrender.com';

describe('the Reed–Solomon check', () => {
  it('is the standard’s: the textbook’s codewords of version 1-M come out', () => {
    // „HELLO WORLD" at 1-M, as every tutorial of the code works it through.
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(correctionOf(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
    expect(checksOut([...data, ...correctionOf(data, 10)], 10)).toBe(true);
    expect(checksOut([...data, ...correctionOf(data, 10).reverse()], 10)).toBe(false);
  });
});

describe('a QR code of the page’s', () => {
  it('reads back as its text, in every version it makes and under every mask', () => {
    const texts = [
      'HCW',
      SITE,
      `${SITE}/?room=QX7R`,
      'Ä'.repeat(31),
      'x'.repeat(84),
      'y'.repeat(QR_MAX_BYTES),
    ];
    expect(texts.map((text) => read(qrOf(text)).version)).toEqual([1, 3, 3, 4, 5, 6]);
    for (const text of texts) {
      for (let mask = 0; mask < 8; mask++) {
        const got = read(qrOf(text, mask));
        const version = got.version;
        expect(got, `${text.slice(0, 12)} mask ${mask}`).toEqual({
          version,
          mask,
          formatsAgree: true,
          mode: 0b0100,
          sound: true,
          spare: version === 1 ? 0 : 7,
          text,
        });
      }
      expect(read(qrOf(text)).text).toBe(text);
    }
  });

  it('carries the patterns a camera finds it by', () => {
    const m = qrOf(SITE);
    const size = sizeOf(3);
    expect([m.length, m[0]?.length]).toEqual([size, size]);
    const rows = (from: number, left: number, n: number): string[] =>
      m.slice(from, from + n).map((row) => row.slice(left, left + n).map(Number).join(''));
    const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
    expect(rows(0, 0, 7)).toEqual(finder);
    expect(rows(0, size - 7, 7)).toEqual(finder);
    expect(rows(size - 7, 0, 7)).toEqual(finder);
    // Light separators round each, the timing lines between them, the module always dark.
    expect(m[7]?.slice(0, 8).some(Boolean)).toBe(false);
    expect(m.slice(0, 8).some((row) => row[7])).toBe(false);
    expect(m[6]?.slice(8, size - 8).map(Number).join('')).toBe('1010101010101');
    expect(m[size - 8]?.[8]).toBe(true);
    expect(rows(size - 9, size - 9, 5)).toEqual(['11111', '10001', '10101', '10001', '11111']);
  });

  it('takes the mask that reads best, the same one every time', () => {
    const picked = read(qrOf(SITE)).mask;
    expect(read(qrOf(SITE)).mask).toBe(picked);
    expect(qrOf(SITE)).toEqual(qrOf(SITE, picked));
    // Not just the first: among these texts more than one mask is taken.
    const masks = ['a', 'bb', SITE, `${SITE}/?room=AB2C`, 'q'.repeat(50)].map(
      (text) => read(qrOf(text)).mask,
    );
    expect(new Set(masks).size).toBeGreaterThan(1);
  });

  it('refuses a text too long for it, saying so', () => {
    expect(() => qrOf('z'.repeat(QR_MAX_BYTES + 1))).toThrow('106 bytes at most, not 107');
    expect(() => qrOf('Ä'.repeat(54))).toThrow('not 108');
  });

  it('draws as one path, a module a unit, the quiet zone left free on every side', () => {
    const m = qrOf('HCW', 0);
    const path = qrPath(m);
    const dark = m.flat().filter(Boolean).length;
    expect(path.match(/M/g)).toHaveLength(dark);
    expect(QUIET_MODULES).toBe(4);
    expect(path.startsWith('M4 4h1v1h-1z')).toBe(true);
    const xs = [...path.matchAll(/M(\d+) (\d+)/g)].flatMap((at) => [Number(at[1]), Number(at[2])]);
    expect(Math.min(...xs)).toBe(4);
    expect(Math.max(...xs)).toBe(4 + 20);
  });
});
