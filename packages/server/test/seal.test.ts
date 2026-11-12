import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SealedSnapshot } from '@escapelab/core';
import {
  open,
  ROOM_SECRET_MIN,
  roomKey,
  roomKeyLogLine,
  seal,
  SealError,
  type SealRefusal,
} from '../src/seal.js';
import { blackoutMidway } from './blackout.js';

/** A ROOM_SECRET as `openssl rand -hex 32` makes one. */
const SECRET = 'c0ffee'.repeat(10) + 'abcd';
const KEY = roomKey({ ROOM_SECRET: SECRET }).key;

/** Why `open` refused the blob: the reason its SealError names; 'opened' where it did not. */
function refusalOf(blob: string, code: string, key = KEY): SealRefusal | 'opened' {
  try {
    open(blob, code, key);
    return 'opened';
  } catch (err) {
    if (err instanceof SealError) {
      return err.reason;
    }
    throw err;
  }
}

/** `blob` with the byte at `index` of its part `part` (1 the nonce, 2 the ciphertext) changed. */
function changed(blob: string, part: 1 | 2, index: number): string {
  const parts = blob.split('.');
  const bytes = Buffer.from(parts[part] ?? '', 'base64url');
  bytes[index] = (bytes[index] ?? 0) ^ 0x01;
  parts[part] = bytes.toString('base64url');
  return parts.join('.');
}

/** Blackout mid-way for two, as its room snapshots it, and sealed under KEY by an instance. */
let kept: SealedSnapshot;
let blob: string;

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  const { room } = blackoutMidway();
  vi.advanceTimersByTime(2000);
  kept = { ...room.snapshot(), instance: 'the-instance', final: false };
  room.dispose();
  vi.useRealTimers();
  blob = seal(kept, kept.code, KEY);
});

describe('a room’s sealed snapshot', () => {
  it('opens to the snapshot it sealed, its instance named, for its room under its key', () => {
    expect(blob).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(open(blob, kept.code, KEY)).toEqual(kept);
    // A room's code goes in capitals, however a resume spells it.
    expect(open(blob, kept.code.toLowerCase(), KEY)).toEqual(kept);
    // A fresh nonce every time: two seals of the same snapshot differ.
    expect(seal(kept, kept.code, KEY)).not.toBe(blob);
  });

  it('holds Blackout mid-way packed, in under 10 kB: a fraction of its JSON', () => {
    expect(blob.length).toBeLessThan(10 * 1024);
    expect(blob.length).toBeLessThan(JSON.stringify(kept).length / 2);
  });

  it('is refused where what its seal holds does not unpack, or unpacks to over 4 MB', () => {
    // Sealed as a server would, but its JSON not packed.
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', KEY, nonce);
    cipher.setAAD(Buffer.from(kept.code, 'utf8'));
    const body = Buffer.concat([
      cipher.update(JSON.stringify(kept), 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const unpacked = `v1.${nonce.toString('base64url')}.${body.toString('base64url')}`;
    expect(refusalOf(unpacked, kept.code)).toBe('invalid');
    // A key this build does not know passes through, but not 5 MB of it.
    const huge = { ...kept, filler: 'x'.repeat(5 * 1024 * 1024) };
    expect(refusalOf(seal(huge, kept.code, KEY), kept.code)).toBe('invalid');
  });

  it('is refused with a byte changed, of its ciphertext, its tag or its nonce', () => {
    const body = Buffer.from(blob.split('.')[2] ?? '', 'base64url');
    expect(refusalOf(changed(blob, 2, 10), kept.code)).toBe('unverified');
    expect(refusalOf(changed(blob, 2, body.length - 1), kept.code)).toBe('unverified');
    expect(refusalOf(changed(blob, 1, 0), kept.code)).toBe('unverified');
  });

  it('is refused under another key: another ROOM_SECRET, or a key of another boot', () => {
    const other = roomKey({ ROOM_SECRET: SECRET.replace('c0', 'c1') }).key;
    expect(refusalOf(blob, kept.code, other)).toBe('unverified');
    expect(refusalOf(blob, kept.code, roomKey({}).key)).toBe('unverified');
  });

  it('is refused for another room', () => {
    expect(refusalOf(blob, kept.code === 'ABCD' ? 'ABCE' : 'ABCD')).toBe('unverified');
  });

  it('is refused malformed: no v1 blob, its parts not base64url, its nonce or body short', () => {
    const [, nonce = '', body = ''] = blob.split('.');
    const short = Buffer.alloc(8).toString('base64url');
    for (const bad of [
      '',
      'v1',
      `v2.${nonce}.${body}`,
      `v1.${nonce}`,
      `v1.${nonce}.${body}.${body}`,
      `v1.${nonce}.${body}=`,
      `v1.@@.${body}`,
      `v1.${short}.${body}`,
      `v1.${Buffer.alloc(16).toString('base64url')}.${body}`,
      `v1.${nonce}.${Buffer.alloc(16).toString('base64url')}`,
    ]) {
      expect(refusalOf(bad, kept.code), bad.slice(0, 40)).toBe('malformed');
    }
  });

  it('is refused where what it holds is no snapshot of this build’s shape', () => {
    const { mission } = kept.state;
    const invalid = [
      { ...kept, seq: -1 },
      { ...kept, state: { ...kept.state, paused: { since: 1, kind: 'pause' } } },
      { ...kept, state: { ...kept.state, mission: { ...mission, timeLimitSec: -1 } } },
      // Its facts not its game's: another mission, or a seat its game has nobody for.
      { ...kept, missionId: 'systemcheck' },
      { ...kept, seats: [...kept.seats, { ...kept.seats[0], playerId: 'nobody' }] },
      // What the seal says of it: an instance with no id, or no word whether it was its last.
      { ...kept, instance: '' },
      { ...kept, final: 'yes' },
    ] as SealedSnapshot[];
    for (const snapshot of invalid) {
      expect(refusalOf(seal(snapshot, kept.code, KEY), kept.code)).toBe('invalid');
    }
  });
});

describe('the key snapshots are sealed with', () => {
  it('is the SHA-256 of ROOM_SECRET, and rooms survive a restart', () => {
    const key = roomKey({ ROOM_SECRET: SECRET });
    expect(key).toEqual({ key: createHash('sha256').update(SECRET).digest(), from: 'env' });
    expect(roomKeyLogLine(key)).toBe(
      'rooms survive a restart: their snapshots are sealed with ROOM_SECRET',
    );
  });

  it('is one of this boot alone without ROOM_SECRET, or with an empty one, as the log says', () => {
    const first = roomKey({});
    expect(first.from).toBe('boot');
    expect(first.key).toHaveLength(32);
    expect(roomKey({ ROOM_SECRET: '' }).key.equals(first.key)).toBe(false);
    expect(roomKeyLogLine(first)).toBe(
      'ROOM_SECRET unset: snapshots are sealed with a key of this boot alone, ' +
        'rooms will not survive a restart',
    );
  });

  it('refuses a ROOM_SECRET too short to keep it from being guessed', () => {
    expect(() => roomKey({ ROOM_SECRET: 'x'.repeat(ROOM_SECRET_MIN - 1) })).toThrow(
      `ROOM_SECRET hat ${ROOM_SECRET_MIN - 1} Zeichen, zu wenige`,
    );
    expect(roomKey({ ROOM_SECRET: 'x'.repeat(ROOM_SECRET_MIN) }).from).toBe('env');
  });
});
