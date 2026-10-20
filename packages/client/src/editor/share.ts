import { draftFromJson, type Draft } from './draft.js';
import { MAX_MISSION_BYTES } from './server.js';

/**
 * Sharing a mission by link: the whole mission file, packed with
 * deflate-raw and written in base64url after `#m=`, on the editor's own
 * address — `${origin}/editor#m=…`. Nothing goes to the server; whoever
 * opens the link gets the mission in their editor and saves it on theirs.
 */

/** How large a mission may be once packed for a link, in bytes. */
export const SHARE_MAX_BYTES = 32 * 1024;

/** Where the editor opens: a link to this path opens the app on the editor. */
export const EDITOR_PATH = '/editor';

/** What a link puts before the packed mission, in the address's fragment. */
const MARK = '#m=';

/** base64url's alphabet, without padding. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** A link for a mission, or why there is none. */
export type Shared = { ok: true; link: string; bytes: number } | { ok: false; error: string };

/** A mission read from a link, or what was wrong with the link. */
export type Unpacked = { ok: true; draft: Draft } | { ok: false; problems: string[] };

/** A link whose mission unpacks to more than the server takes. */
class TooLarge extends Error {}

async function pack(text: string): Promise<Uint8Array> {
  const packed = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(packed).arrayBuffer());
}

/**
 * Unpacks, and stops reading once the text would run past what the server
 * takes for a mission: a short link cannot make the page unpack megabytes.
 */
async function unpack(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    size += value.byteLength;
    if (size > MAX_MISSION_BYTES) {
      await reader.cancel();
      throw new TooLarge('Die Mission im Link ist größer als 256 kB.');
    }
    text += decoder.decode(value, { stream: true });
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
}

/** The link that opens `mission` in the editor at `origin`; refused above 32 kB packed. */
export async function shareLink(
  mission: Record<string, unknown>,
  origin: string,
): Promise<Shared> {
  let bytes: Uint8Array;
  try {
    bytes = await pack(JSON.stringify(mission));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Dieser Browser kann die Mission nicht packen (${reason}).` };
  }
  if (bytes.byteLength > SHARE_MAX_BYTES) {
    const kb = Math.ceil(bytes.byteLength / 1024);
    return { ok: false, error: `Zu groß für einen Link: gepackt ${kb} kB, erlaubt sind 32 kB.` };
  }
  const link = `${origin}${EDITOR_PATH}${MARK}${toBase64Url(bytes)}`;
  return { ok: true, link, bytes: bytes.byteLength };
}

/** The packed mission in an address's fragment (`location.hash`); null where it carries none. */
export function sharedIn(hash: string): string | null {
  return hash.startsWith(MARK) ? hash.slice(MARK.length) : null;
}

/** The mission a link carries, read into a draft; what was wrong with the link where it cannot. */
export async function readShared(packed: string): Promise<Unpacked> {
  const broken = 'Der Link ist unvollständig oder verändert.';
  // 32 kB packed are 43 690 characters of base64url; anything longer was never made here.
  if (!BASE64URL.test(packed) || packed.length > Math.ceil((SHARE_MAX_BYTES * 4) / 3)) {
    return { ok: false, problems: [broken] };
  }
  let data: unknown;
  try {
    data = JSON.parse(await unpack(fromBase64Url(packed)));
  } catch (err) {
    return { ok: false, problems: [err instanceof TooLarge ? err.message : broken] };
  }
  const loaded = draftFromJson(data);
  return loaded.ok ? { ok: true, draft: loaded.draft } : loaded;
}
