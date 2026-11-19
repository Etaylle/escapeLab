/**
 * A QR code of a short text — the site's address, a room's invite link — worked out in the page:
 * no service asked, nothing loaded. ISO/IEC 18004 as far as an address needs it: bytes (UTF-8),
 * error correction level M (a code a camera reads off a screen with some glare still reads),
 * versions 1 to 6 — 21 to 41 modules a side, 106 bytes at most — which need neither the
 * version's own blocks nor more than one alignment pattern. Pure: text in, modules out.
 */

/** A code's modules, row by row from the top: true for a dark one. Without the quiet zone. */
export type QrModules = boolean[][];

/** The light modules a reader wants round a code, on every side (ISO/IEC 18004, 4 modules). */
export const QUIET_MODULES = 4;

/** The bytes the largest version made here, 6, holds at level M. */
export const QR_MAX_BYTES = 106;

/** A version's data at level M: how many blocks, the data and the correction codewords of each. */
interface Layout {
  blocks: number;
  data: number;
  correction: number;
}

/** Versions 1 to 6 at level M, by version (ISO/IEC 18004, table 9). */
const LAYOUTS: readonly Layout[] = [
  { blocks: 1, data: 16, correction: 10 },
  { blocks: 1, data: 28, correction: 16 },
  { blocks: 1, data: 44, correction: 26 },
  { blocks: 2, data: 32, correction: 18 },
  { blocks: 2, data: 43, correction: 24 },
  { blocks: 4, data: 27, correction: 16 },
];

/** The modules a side of version `version`. */
export const sizeOf = (version: number): number => 17 + 4 * version;

/** `a` times `b` in the code's field, GF(2^8) by x^8 + x^4 + x^3 + x^2 + 1. */
function times(a: number, b: number): number {
  let product = 0;
  for (let bit = 7; bit >= 0; bit--) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((b >>> bit) & 1) * a;
  }
  return product;
}

/** The Reed–Solomon generator of `degree`, its leading 1 left out, highest power first. */
function generatorOf(degree: number): number[] {
  const generator: number[] = Array.from({ length: degree }, (_, i) => Number(i === degree - 1));
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      generator[j] = times(generator[j] ?? 0, root) ^ (generator[j + 1] ?? 0);
    }
    root = times(root, 2);
  }
  return generator;
}

/** The `degree` correction codewords of `data`: the remainder of its division by the generator. */
export function correctionOf(data: readonly number[], degree: number): number[] {
  const generator = generatorOf(degree);
  const remainder = Array.from({ length: degree }, () => 0);
  for (const codeword of data) {
    const factor = codeword ^ (remainder.shift() ?? 0);
    remainder.push(0);
    generator.forEach((coefficient, i) => {
      remainder[i] = (remainder[i] ?? 0) ^ times(coefficient, factor);
    });
  }
  return remainder;
}

/** The smallest version that holds `bytes` bytes; throws for more than QR_MAX_BYTES. */
function versionFor(bytes: number): number {
  // A byte segment costs its mode (4 bits) and its count (8 bits) beside its bytes.
  const version = LAYOUTS.findIndex(({ blocks, data }) => bytes + 2 <= blocks * data) + 1;
  if (version === 0) {
    throw new Error(`a QR code here holds ${QR_MAX_BYTES} bytes at most, not ${bytes}`);
  }
  return version;
}

/** The data codewords of `bytes` at `version`: mode, count, the bytes, terminator, padding. */
function dataOf(bytes: Uint8Array, version: number): number[] {
  const { blocks, data } = LAYOUTS[version - 1] as Layout;
  const bits: number[] = [0, 1, 0, 0];
  const push = (value: number, length: number): void => {
    for (let bit = length - 1; bit >= 0; bit--) {
      bits.push((value >>> bit) & 1);
    }
  };
  push(bytes.length, 8);
  bytes.forEach((byte) => push(byte, 8));
  const capacity = blocks * data * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) {
    push(pad, 8);
  }
  return Array.from({ length: bits.length / 8 }, (_, i) =>
    bits.slice(i * 8, i * 8 + 8).reduce((byte, bit) => (byte << 1) | bit, 0),
  );
}

/** The codewords as the code carries them: the blocks' data interleaved, then their correction. */
function codewordsOf(data: readonly number[], version: number): number[] {
  const { blocks, data: each, correction } = LAYOUTS[version - 1] as Layout;
  const parts = Array.from({ length: blocks }, (_, b) => data.slice(b * each, (b + 1) * each));
  const checks = parts.map((part) => correctionOf(part, correction));
  const interleaved = (rows: number[][], length: number): number[] =>
    Array.from({ length }, (_, i) => rows.map((row) => row[i] ?? 0)).flat();
  return [...interleaved(parts, each), ...interleaved(checks, correction)];
}

/** A code being drawn: its modules, and which of them the function patterns hold. */
interface Sheet {
  size: number;
  dark: boolean[][];
  held: boolean[][];
}

/** A module of the function patterns set at column `x`, row `y`, where the sheet has one. */
function hold(sheet: Sheet, x: number, y: number, dark: boolean): void {
  const row = sheet.dark[y];
  const held = sheet.held[y];
  if (row !== undefined && held !== undefined && x >= 0 && x < sheet.size) {
    row[x] = dark;
    held[x] = true;
  }
}

/** A finder pattern with its separator, its middle at (`cx`, `cy`). */
function drawFinder(sheet: Sheet, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      hold(sheet, cx + dx, cy + dy, ring !== 2 && ring !== 4);
    }
  }
}

/** The alignment pattern of versions 2 and up, its middle six modules in from the far corner. */
function drawAlignment(sheet: Sheet): void {
  const middle = sheet.size - 7;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      hold(sheet, middle + dx, middle + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

/**
 * The format's fifteen bits for level M and mask `mask`, drawn in both their places, and the
 * module that is always dark beside the second.
 */
function drawFormat(sheet: Sheet, mask: number): void {
  // Level M is 00; ten check bits by the generator 10100110111, the whole masked by the standard's.
  let check = mask;
  for (let i = 0; i < 10; i++) {
    check = (check << 1) ^ ((check >>> 9) * 0x537);
  }
  const bits = ((mask << 10) | check) ^ 0x5412;
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
  const { size } = sheet;
  for (let i = 0; i <= 5; i++) {
    hold(sheet, 8, i, bit(i));
  }
  hold(sheet, 8, 7, bit(6));
  hold(sheet, 8, 8, bit(7));
  hold(sheet, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) {
    hold(sheet, 14 - i, 8, bit(i));
  }
  for (let i = 0; i < 8; i++) {
    hold(sheet, size - 1 - i, 8, bit(i));
  }
  for (let i = 8; i < 15; i++) {
    hold(sheet, 8, size - 15 + i, bit(i));
  }
  hold(sheet, 8, size - 8, true);
}

/** The sheet of `version` with its function patterns drawn, the format's places held. */
function sheetOf(version: number): Sheet {
  const size = sizeOf(version);
  const grid = (): boolean[][] =>
    Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const sheet: Sheet = { size, dark: grid(), held: grid() };
  for (let i = 0; i < size; i++) {
    hold(sheet, 6, i, i % 2 === 0);
    hold(sheet, i, 6, i % 2 === 0);
  }
  drawFinder(sheet, 3, 3);
  drawFinder(sheet, size - 4, 3);
  drawFinder(sheet, 3, size - 4);
  if (version >= 2) {
    drawAlignment(sheet);
  }
  drawFormat(sheet, 0);
  return sheet;
}

/** The sheet's free modules in the order the codewords' bits take them: column, row. */
function freeModules(sheet: Sheet): [number, number][] {
  const { size } = sheet;
  const free: [number, number][] = [];
  // Two columns at a time from the right, up and down in turn; the timing column is stepped over.
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      free.push(...[right, right - 1].map((x): [number, number] => [x, y]));
    }
  }
  return free.filter(([x, y]) => sheet.held[y]?.[x] !== true);
}

/** The codewords laid into the sheet's free modules, bit by bit; what is left over stays light. */
function drawCodewords(sheet: Sheet, codewords: readonly number[]): void {
  freeModules(sheet)
    .slice(0, codewords.length * 8)
    .forEach(([x, y], i) => {
      const row = sheet.dark[y] ?? [];
      row[x] = (((codewords[i >>> 3] ?? 0) >>> (7 - (i & 7))) & 1) === 1;
    });
}

/** Whether mask `mask` turns the module at column `x`, row `y` over (ISO/IEC 18004, table 10). */
const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The sheet's modules under mask `mask`, the function patterns left as they are. */
function masked(sheet: Sheet, mask: number): boolean[][] {
  const turns = MASKS[mask] ?? (() => false);
  return sheet.dark.map((row, y) =>
    row.map((dark, x) => (sheet.held[y]?.[x] === true ? dark : dark !== turns(x, y))),
  );
}

/** What runs of five and more alike in a line, and a finder's look in it, cost. */
function linePenalty(line: readonly boolean[]): number {
  let penalty = 0;
  let run = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === line[i - 1]) {
      run += 1;
    } else {
      penalty += run >= 5 ? run - 2 : 0;
      run = 1;
    }
  }
  const text = line.map((dark) => (dark ? '1' : '0')).join('');
  for (const pattern of ['10111010000', '00001011101']) {
    for (let at = text.indexOf(pattern); at >= 0; at = text.indexOf(pattern, at + 1)) {
      penalty += 40;
    }
  }
  return penalty;
}

/** How hard `modules` are to read, by the standard's four rules: the least hard mask is taken. */
function penaltyOf(modules: readonly boolean[][]): number {
  const size = modules.length;
  const columns = modules.map((_, x) => modules.map((row) => row[x] === true));
  let penalty = [...modules, ...columns].reduce((sum, line) => sum + linePenalty(line), 0);
  let dark = 0;
  modules.forEach((row, y) =>
    row.forEach((module, x) => {
      dark += Number(module);
      const below = modules[y + 1];
      const block = below !== undefined && x + 1 < size;
      if (block && module === row[x + 1] && module === below[x] && module === below[x + 1]) {
        penalty += 3;
      }
    }),
  );
  return penalty + 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
}

/**
 * The QR code of `text`: the smallest version that holds it, under the mask that reads best —
 * or under `mask`, for a test. Throws for a text of more than QR_MAX_BYTES bytes.
 */
export function qrOf(text: string, mask?: number): QrModules {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  const sheet = sheetOf(version);
  drawCodewords(sheet, codewordsOf(dataOf(bytes, version), version));
  const under = (pick: number): boolean[][] => {
    drawFormat(sheet, pick);
    return masked(sheet, pick);
  };
  if (mask !== undefined) {
    return under(mask);
  }
  const ranked = MASKS.map((_, pick) => ({ pick, penalty: penaltyOf(under(pick)) }));
  ranked.sort((a, b) => a.penalty - b.penalty || a.pick - b.pick);
  return under(ranked[0]?.pick ?? 0);
}

/**
 * The code's dark modules as one SVG path in a box of its size plus the quiet zone on every
 * side, a module a unit: `M x y h 1 v 1 h -1 z` for each.
 */
export function qrPath(modules: QrModules): string {
  return modules
    .flatMap((row, y) =>
      row.flatMap((dark, x) =>
        dark ? [`M${x + QUIET_MODULES} ${y + QUIET_MODULES}h1v1h-1z`] : [],
      ),
    )
    .join('');
}
