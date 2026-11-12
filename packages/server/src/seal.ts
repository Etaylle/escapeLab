import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { roomSnapshotSchema, type RoomSnapshot } from '@escapelab/core';

/**
 * The seal a room's snapshot travels in (core snapshot.ts): every client of the crew keeps the
 * newest of its room and hands it back once the server knows the room no more — after a deploy,
 * a restart — and only a server with the key reads it, or could have made it. A blob is
 * `v1.<nonce>.<ciphertext>`, both parts base64url: the snapshot as JSON, sealed with AES-256-GCM
 * under the SHA-256 of ROOM_SECRET, the room's code its additional data, the tag after the
 * ciphertext. A blob sealed for one room opens for no other.
 */

/** The seal's format, as the blob's first part says it. */
const VERSION = 'v1';
const CIPHER = 'aes-256-gcm';
/** A fresh nonce for every blob: GCM's 96 bits. */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** The fewest characters ROOM_SECRET may have: random ones, as `openssl rand -hex 32` gives 64. */
export const ROOM_SECRET_MIN = 32;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The key the server seals snapshots with, and where it came from: ROOM_SECRET, or this boot. */
export interface RoomKey {
  key: Buffer;
  from: 'env' | 'boot';
}

/**
 * The key from ROOM_SECRET (its SHA-256); without one, or with an empty one, a key made anew for
 * this boot alone — no snapshot it seals opens after a restart. Throws for a ROOM_SECRET shorter
 * than ROOM_SECRET_MIN, which would let anybody guess the key.
 */
export function roomKey(env: NodeJS.ProcessEnv): RoomKey {
  const secret = env['ROOM_SECRET'] ?? '';
  if (secret === '') {
    return { key: randomBytes(32), from: 'boot' };
  }
  if (secret.length < ROOM_SECRET_MIN) {
    throw new Error(
      `ROOM_SECRET hat ${secret.length} Zeichen, zu wenige — mindestens ${ROOM_SECRET_MIN} ` +
        'zufällige, etwa aus `openssl rand -hex 32`',
    );
  }
  return { key: createHash('sha256').update(secret).digest(), from: 'env' };
}

/** What the start-up log says of the key: whether rooms survive a restart. */
export function roomKeyLogLine(key: RoomKey): string {
  return key.from === 'env'
    ? 'rooms survive a restart: their snapshots are sealed with ROOM_SECRET'
    : 'ROOM_SECRET unset: snapshots are sealed with a key of this boot alone, ' +
        'rooms will not survive a restart';
}

/**
 * Why a blob was refused: not a blob of this format at all; its seal does not verify — a byte
 * changed, made with another key, or for another room; or what it holds is no snapshot of this
 * build's shape.
 */
export type SealRefusal = 'malformed' | 'unverified' | 'invalid';

/** A blob refused, with why (`SealRefusal`) and the detail in words, for the log. */
export class SealError extends Error {
  constructor(
    readonly reason: SealRefusal,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = 'SealError';
  }
}

/** The room code a blob is sealed for, as its additional data: in capitals, as rooms go by. */
const aadOf = (code: string): Buffer => Buffer.from(code.toUpperCase(), 'utf8');

/** `snapshot` sealed for the room `code` under `key`: `v1.<nonce>.<ciphertext>`. */
export function seal(snapshot: RoomSnapshot, code: string, key: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(CIPHER, key, nonce);
  cipher.setAAD(aadOf(code));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(snapshot), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${VERSION}.${nonce.toString('base64url')}.${body.toString('base64url')}`;
}

/**
 * The snapshot `blob` holds, sealed for the room `code` under `key`: its seal verified, its
 * content checked for this build's shape. Throws a SealError saying why it is refused.
 */
export function open(blob: string, code: string, key: Buffer): RoomSnapshot {
  const { nonce, body } = partsOf(blob);
  const text = unsealed(nonce, body, code, key);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SealError('invalid', 'its content is no JSON');
  }
  const parsed = roomSnapshotSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? '' : ` at ${issue.path.map(String).join('.') || '(root)'}`;
    throw new SealError('invalid', `no room's snapshot${where}: ${issue?.message ?? 'refused'}`);
  }
  return parsed.data;
}

/** The nonce and the sealed body of `blob`; a SealError where it is no blob of this format. */
function partsOf(blob: string): { nonce: Buffer; body: Buffer } {
  const parts = blob.split('.');
  const [version, nonce, body] = parts;
  if (parts.length !== 3 || version !== VERSION || nonce === undefined || body === undefined) {
    throw new SealError('malformed', `not ${VERSION}.<nonce>.<ciphertext>`);
  }
  const bytes = { nonce: bytesOf(nonce, NONCE_BYTES), body: bytesOf(body, TAG_BYTES + 1) };
  if (bytes.nonce.length !== NONCE_BYTES) {
    throw new SealError('malformed', `its nonce is not ${NONCE_BYTES} bytes`);
  }
  return bytes;
}

/** The bytes `part` of a blob holds, `least` at the fewest; a SealError for anything else. */
function bytesOf(part: string, least: number): Buffer {
  if (!BASE64URL.test(part)) {
    throw new SealError('malformed', 'its nonce or ciphertext is not base64url');
  }
  const bytes = Buffer.from(part, 'base64url');
  if (bytes.length < least) {
    throw new SealError('malformed', `its nonce or body is shorter than ${least} bytes`);
  }
  return bytes;
}

/** The text sealed in `body`; a SealError where its tag does not verify for `code` and `key`. */
function unsealed(nonce: Buffer, body: Buffer, code: string, key: Buffer): string {
  const decipher = createDecipheriv(CIPHER, key, nonce);
  decipher.setAAD(aadOf(code));
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  try {
    const plain = Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch {
    throw new SealError(
      'unverified',
      'its seal does not verify: a byte changed, sealed with another key, or for another room',
    );
  }
}
