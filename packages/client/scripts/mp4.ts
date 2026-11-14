/**
 * An .m4a made the same twice (scripts/afconvert.ts). afconvert writes the moment it encodes into
 * the file — the creation and modification times of its movie, its track and its media, in the
 * boxes `mvhd`, `tkhd` and `mdhd` — so that two encodes of one recording differ in those bytes
 * alone, and git would keep the whole file anew for them. `timeless` sets those times to zero: a
 * piece encoded again from what it was made from comes out byte for byte the same. Pure.
 *
 * Runs on Node's own TypeScript, as the scripts do: it imports nothing.
 */

/** The boxes that hold boxes on the way to the stamped ones. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia']);
/** The full boxes whose creation and modification times afconvert stamps. */
const STAMPED = new Set(['mvhd', 'tkhd', 'mdhd']);

/** A box in an MP4: its four-letter kind, where its body starts and where it ends. */
interface Box {
  readonly kind: string;
  readonly body: number;
  readonly end: number;
}

/** The box at `at`, within `to`; null where none fits there. */
function boxAt(view: DataView, at: number, to: number): Box | null {
  if (at + 8 > to) return null;
  const size = view.getUint32(at);
  const kind = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + at + 4, 4));
  if (size === 1) {
    if (at + 16 > to) return null;
    const large = Number(view.getBigUint64(at + 8));
    return large < 16 ? null : { kind, body: at + 16, end: Math.min(to, at + large) };
  }
  if (size === 0) return { kind, body: at + 8, end: to };
  return size < 8 ? null : { kind, body: at + 8, end: Math.min(to, at + size) };
}

/**
 * The times of the full box whose body starts at `body` set to zero: after its version and flags,
 * its creation and modification times, four bytes each in version 0 and eight in version 1.
 */
function zeroTimes(view: DataView, body: number, end: number): void {
  if (body + 4 > end) return;
  const width = view.getUint8(body) === 1 ? 8 : 4;
  const to = Math.min(end, body + 4 + 2 * width);
  for (let at = body + 4; at < to; at++) view.setUint8(at, 0);
}

/** Every stamped box from `from` to `to` set timeless, the containers on the way gone into. */
function zeroWithin(view: DataView, from: number, to: number): void {
  for (let box = boxAt(view, from, to); box !== null; box = boxAt(view, box.end, to)) {
    if (CONTAINERS.has(box.kind)) zeroWithin(view, box.body, box.end);
    else if (STAMPED.has(box.kind)) zeroTimes(view, box.body, box.end);
  }
}

/** `bytes` of an .m4a with every time afconvert stamps into it set to zero; the rest as it was. */
export function timeless(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  zeroWithin(new DataView(out.buffer, out.byteOffset, out.byteLength), 0, out.length);
  return out;
}
