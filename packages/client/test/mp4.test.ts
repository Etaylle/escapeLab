import { describe, expect, it } from 'vitest';
import { timeless } from '../scripts/mp4.js';

/**
 * An .m4a made the same twice (scripts/mp4.ts): the times afconvert stamps into the movie's, the
 * track's and the media's headers set to zero, nothing else touched — on a file of the test's own,
 * laid out as afconvert lays one out.
 */

/** A box of `kind` around `body`. */
function box(kind: string, ...body: Uint8Array[]): Uint8Array {
  const size = 8 + body.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set([...kind].map((c) => c.charCodeAt(0)), 4);
  let at = 8;
  for (const part of body) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A full box's body: its version, no flags, its two times, then `rest` bytes of 0x5a. */
function stamped(version: 0 | 1, rest: number): Uint8Array {
  const width = version === 1 ? 8 : 4;
  const out = new Uint8Array(4 + 2 * width + rest).fill(0x5a);
  out.set([version, 0, 0, 0], 0);
  for (let i = 0; i < 2 * width; i++) out[4 + i] = 0xe0 + i; // the times, never zero
  return out;
}

/** A file as afconvert lays one out: its type, the movie with one track, the media's data. */
function m4a(): Uint8Array {
  const media = box('mdia', box('mdhd', stamped(1, 8)), box('hdlr', new Uint8Array(25).fill(7)));
  const track = box('trak', box('tkhd', stamped(0, 72)), media);
  const movie = box('moov', box('mvhd', stamped(0, 88)), track);
  const data = box('mdat', new Uint8Array(64).fill(0xe1));
  return Uint8Array.from([...box('ftyp', new Uint8Array(20).fill(3)), ...movie, ...data]);
}

/** Where `kind`'s body starts in `bytes`: just past its first appearance. */
const bodyOf = (bytes: Uint8Array, kind: string): number =>
  Buffer.from(bytes).indexOf(kind, 0, 'latin1') + 4;

describe('an .m4a made timeless', () => {
  it('has the times of its movie, track and media at zero, version 0 and 1 alike', () => {
    const file = m4a();
    const out = timeless(file);
    const timesOf = (kind: string, width: number): number[] => {
      const at = bodyOf(out, kind) + 4;
      return [...out.slice(at, at + 2 * width)];
    };
    expect(timesOf('mvhd', 4)).toEqual(new Array(8).fill(0));
    expect(timesOf('tkhd', 4)).toEqual(new Array(8).fill(0));
    expect(timesOf('mdhd', 8)).toEqual(new Array(16).fill(0));
    // Nothing else moves: every byte but those 32 is as it was.
    const changed = [...out].filter((byte, i) => byte !== file[i]);
    expect(changed).toHaveLength(32);
    expect(out[bodyOf(out, 'mdhd') + 4 + 16]).toBe(0x5a); // the field after the times
  });

  it('leaves the file it was given alone, and comes out the same made twice', () => {
    const file = m4a();
    const copy = file.slice();
    const once = timeless(file);
    expect(file).toEqual(copy);
    expect(timeless(once)).toEqual(once);
  });

  it('touches nothing in the media data, nor in a box of another kind', () => {
    const file = m4a();
    const out = timeless(file);
    const data = bodyOf(out, 'mdat');
    expect([...out.slice(data, data + 64)]).toEqual(new Array(64).fill(0xe1));
    const handler = bodyOf(out, 'hdlr');
    expect([...out.slice(handler, handler + 25)]).toEqual(new Array(25).fill(7));
  });

  it('reads a last box of size 0 as running to the file’s end, as MP4 has it', () => {
    const data = box('mdat', new Uint8Array(16).fill(0xe1));
    const movie = box('moov', box('mvhd', stamped(0, 88)));
    new DataView(movie.buffer).setUint32(0, 0); // its size left open: to the file's end
    const out = timeless(Uint8Array.from([...data, ...movie]));
    const at = bodyOf(out, 'mvhd') + 4;
    expect([...out.slice(at, at + 8)]).toEqual(new Array(8).fill(0));
  });

  it('reads a box whose size takes 64 bits, as a large file’s does', () => {
    const inner = box('mvhd', stamped(0, 88));
    const large = new Uint8Array(16 + inner.length);
    const view = new DataView(large.buffer);
    view.setUint32(0, 1); // its size follows the kind, in 64 bits
    large.set([...'moov'].map((c) => c.charCodeAt(0)), 4);
    view.setBigUint64(8, BigInt(large.length));
    large.set(inner, 16);
    const out = timeless(large);
    const at = bodyOf(out, 'mvhd') + 4;
    expect([...out.slice(at, at + 8)]).toEqual(new Array(8).fill(0));
  });

  it('stops at a box that claims less than its own header, leaving the rest as it was', () => {
    const broken = Uint8Array.from([0, 0, 0, 4]); // a size of 4: under the 8 its header takes
    const file = Uint8Array.from([...broken, ...box('moov', box('mvhd', stamped(0, 88)))]);
    expect(timeless(file)).toEqual(file);
  });

  it('stops at a box that runs past the file, and throws nothing on bytes of no box', () => {
    const file = m4a();
    const cut = file.slice(0, bodyOf(file, 'tkhd') + 6); // the track's header broken off
    const out = timeless(cut);
    expect(out.slice(0, bodyOf(file, 'mvhd'))).toEqual(cut.slice(0, bodyOf(file, 'mvhd')));
    expect(() => timeless(Uint8Array.from([0, 0, 0, 3, 1, 2]))).not.toThrow();
    expect(timeless(new Uint8Array(0))).toEqual(new Uint8Array(0));
  });
});
