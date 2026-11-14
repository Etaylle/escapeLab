import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { afconvertOut } from '../scripts/afconvert.js';

/**
 * The encoder the sound and pack scripts use (scripts/afconvert.ts), its converter the test's own:
 * whatever times the converter stamps into the .m4a it writes, every encode comes out without
 * them — the same PCM, the same bytes.
 */

/** A file as a converter writes it: its movie's header carrying the moment `at`, then data. */
function converted(at: number): Uint8Array {
  const body = new Uint8Array(100);
  new DataView(body.buffer).setUint32(4, at); // created
  new DataView(body.buffer).setUint32(8, at); // modified
  const mvhd = new Uint8Array(8 + body.length);
  new DataView(mvhd.buffer).setUint32(0, mvhd.length);
  mvhd.set([...'mvhd'].map((c) => c.charCodeAt(0)), 4);
  mvhd.set(body, 8);
  const moov = new Uint8Array(8 + mvhd.length);
  new DataView(moov.buffer).setUint32(0, moov.length);
  moov.set([...'moov'].map((c) => c.charCodeAt(0)), 4);
  moov.set(mvhd, 8);
  return moov;
}

describe('an encode', () => {
  it('comes out without the moment it was made, and leaves no scratch behind', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'escapelab-afconvert-test-'));
    const asked: string[][] = [];
    let at = 1_000_000;
    const encode = afconvertOut(scratch, 128_000, (args) => {
      asked.push([...args]);
      at += 1;
      writeFileSync(args.at(-1) ?? '', converted(at));
    });
    const pcm = { rate: 8000, channels: [new Float32Array(800).fill(0.1)] };
    const [first, second] = [join(scratch, 'a.m4a'), join(scratch, 'b.m4a')];
    try {
      encode(pcm, first);
      encode(pcm, second);
      expect(readFileSync(first)).toEqual(readFileSync(second));
      expect(readFileSync(first).subarray(20, 28)).toEqual(Buffer.alloc(8));
      const aac = ['-f', 'm4af', '-d', 'aac', '-b', '128000', '-q', '127'];
      expect(asked[0]?.slice(0, 8)).toEqual(aac);
      expect(readdirSync(scratch).sort()).toEqual(['a.m4a', 'b.m4a']);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
