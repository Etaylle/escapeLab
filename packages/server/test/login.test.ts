import type * as Crypto from 'node:crypto';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COST,
  fromTooMany,
  hashPassword,
  LOCK_MS,
  mintNumber,
  NUMBER_ALPHABET,
  numberLocked,
  numberOf,
  passwordFits,
  passwordMatches,
  SignInGuard,
  WRONG_PER_ADDRESS,
  WRONG_PER_NUMBER,
} from '../src/login.js';

// The real crypto, watched: which keys are derived, and how the keys are compared.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof Crypto>();
  return {
    ...actual,
    scrypt: vi.fn(actual.scrypt),
    timingSafeEqual: vi.fn(actual.timingSafeEqual),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/** A hash as a login keeps it: scrypt, its cost, a salt of 16 bytes and a key of 32, in hex. */
const HASH = new RegExp(
  `^scrypt\\$${COST.N}\\$${COST.r}\\$${COST.p}\\$[0-9a-f]{32}\\$[0-9a-f]{64}$`,
);

describe('the Ausweisnummer', () => {
  it('is minted readable: „EL-", two fours of digits and capitals without 0, O, 1 or I', () => {
    expect(NUMBER_ALPHABET).toHaveLength(32);
    expect(NUMBER_ALPHABET).not.toMatch(/[01OI]/);
    const minted = Array.from({ length: 2000 }, mintNumber);
    const shape = /^EL-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;
    expect(minted.filter((number) => !shape.test(number))).toEqual([]);
    // 2000 numbers of 32^8: none twice, and every character drawn.
    expect(new Set(minted).size).toBe(minted.length);
    const drawn = new Set(minted.flatMap((number) => [...number.slice(3).replace('-', '')]));
    expect([...drawn].sort().join('')).toBe(NUMBER_ALPHABET);
  });

  it('is read however it is typed — case, spaces, dashes, „EL" or not — and nothing else', () => {
    const read = ['EL-7K3M-9Q2D', 'el-7k3m-9q2d', ' EL 7K3M 9Q2D ', 'EL7K3M9Q2D', '7K3M-9Q2D'];
    for (const typed of read) {
      expect(numberOf(typed), typed).toBe('EL-7K3M-9Q2D');
    }
    const none = ['EL-7K3M-9Q2', 'EL-7K3M-9Q2DX', 'EL-0K3M-9Q2D', 'EL-7K3M-9O2D', 'EL-1K3M-9Q2D'];
    for (const typed of [...none, 'EL-IK3M-9Q2D', '', 'EL']) {
      expect(numberOf(typed), typed).toBeNull();
    }
  });
});

describe('the Kennwort', () => {
  it('has 8 to 128 characters, counted as typed, and nothing else asked of it', () => {
    expect(['1234567', 'a'.repeat(129)].map(passwordFits)).toEqual([false, false]);
    expect(['12345678', 'a'.repeat(128), '        '].map(passwordFits)).toEqual([true, true, true]);
    // A key is one character, two UTF-16 units: counted as typed, four are too few, 100 are not.
    expect(['🔑'.repeat(4), '🔑'.repeat(8), '🔑'.repeat(100), '🔑'.repeat(129)].map(passwordFits))
      .toEqual([false, true, true, false]);
  });

  it('is kept as scrypt with a salt of its own, never as itself', async () => {
    const first = await hashPassword('Kaltenbrunn 1986');
    const second = await hashPassword('Kaltenbrunn 1986');
    expect(first).toMatch(HASH);
    expect(second).toMatch(HASH);
    expect(first).not.toBe(second);
    expect(first).not.toContain('Kaltenbrunn');
    expect(vi.mocked(scrypt).mock.calls[0]?.[3]).toMatchObject({ N: 2 ** 15, r: 8, p: 1 });
  });

  it('matches the hash of itself alone, compared in constant time', async () => {
    const kept = await hashPassword('Kaltenbrunn 1986');
    vi.mocked(timingSafeEqual).mockClear();
    expect(await passwordMatches('Kaltenbrunn 1986', kept)).toBe(true);
    expect(await passwordMatches('kaltenbrunn 1986', kept)).toBe(false);
    expect(await passwordMatches('Kaltenbrunn 1986 ', kept)).toBe(false);
    const compared = vi.mocked(timingSafeEqual).mock.calls;
    expect(compared).toHaveLength(3);
    const lengths = compared.map(([a, b]) => [(a as Buffer).length, (b as Buffer).length]);
    expect(lengths).toEqual([
      [32, 32],
      [32, 32],
      [32, 32],
    ]);
  });

  it('reads the same however the keyboard composes it (NFKC)', async () => {
    const composed = 'B\u00e4renh\u00f6hle 7';
    const decomposed = 'Ba\u0308renho\u0308hle 7';
    expect(composed).not.toBe(decomposed);
    expect(await passwordMatches(decomposed, await hashPassword(composed))).toBe(true);
  });

  it('does the same work without a hash, or a readable one, and matches nothing', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(scrypt).mockClear();
    expect(await passwordMatches('Kaltenbrunn 1986', null)).toBe(false);
    expect(await passwordMatches('Kaltenbrunn 1986', 'scrypt$1$1$1$00$00')).toBe(false);
    expect(await passwordMatches('', `scrypt$${2 ** 15}$8$1$${'0'.repeat(32)}$`)).toBe(false);
    const costs = vi.mocked(scrypt).mock.calls.map((call) => call[3]);
    expect(costs).toHaveLength(3);
    expect(costs.every((cost) => (cost as { N: number }).N === COST.N)).toBe(true);
    expect(said).toHaveBeenCalledTimes(2);
    expect(said).toHaveBeenCalledWith(
      '[escapelab] a login keeps no readable scrypt hash: no Kennwort matches it',
    );
  });
});

describe('the limits on signing in', () => {
  /** A guard on a clock of its own: `at` moves it. */
  function guarded() {
    let at = 1_000_000;
    const guard = new SignInGuard(() => at);
    return { guard, pass: (ms: number) => (at += ms) };
  }

  it(`refuses an address after ${WRONG_PER_ADDRESS} wrong tries in a minute, others not`, () => {
    const { guard, pass } = guarded();
    for (let i = 0; i < WRONG_PER_ADDRESS; i += 1) {
      expect(guard.refusal('203.0.113.7', `EL-AAAA-AAA${i + 2}`)).toBeNull();
      guard.wrong('203.0.113.7', `EL-AAAA-AAA${i + 2}`);
      pass(1000);
    }
    expect(guard.refusal('203.0.113.7', 'EL-BBBB-BBBB')).toBe(fromTooMany(50));
    expect(guard.refusal('198.51.100.4', 'EL-BBBB-BBBB')).toBeNull();
    // A try refused counts nothing: the address is free a minute after its first wrong try.
    pass(49_000);
    expect(guard.refusal('203.0.113.7', null)).toBe(fromTooMany(1));
    pass(1000);
    expect(guard.refusal('203.0.113.7', null)).toBeNull();
  });

  it('lets a lecture behind one address sign in at once: right tries count nothing', () => {
    const { guard } = guarded();
    const right = Array.from({ length: 30 }, (_, i) => {
      const number = `EL-CCCC-CC${'23456789ABCDEFGHJKLMNPQRSTUVWXYZ'.charAt(i)}2`;
      const refused = guard.refusal('203.0.113.7', number);
      guard.right(number);
      return refused;
    });
    expect(right.every((refused) => refused === null)).toBe(true);
    // Typos too, as long as there are fewer than ten a minute.
    for (let i = 0; i < WRONG_PER_ADDRESS - 1; i += 1) {
      guard.wrong('203.0.113.7', 'EL-CCCC-CC22');
    }
    expect(guard.refusal('203.0.113.7', 'EL-DDDD-DDDD')).toBeNull();
  });

  it(`locks an Ausweisnummer at its ${WRONG_PER_NUMBER}th wrong Kennwort, from anywhere`, () => {
    const { guard, pass } = guarded();
    const number = 'EL-7K3M-9Q2D';
    for (let i = 0; i < WRONG_PER_NUMBER; i += 1) {
      expect(guard.refusal(`198.51.100.${i}`, number)).toBeNull();
      guard.wrong(`198.51.100.${i}`, number);
    }
    expect(guard.refusal('203.0.113.9', number)).toBe(numberLocked(60));
    expect(guard.refusal('203.0.113.9', 'EL-7K3M-9Q2E')).toBeNull();
    pass(LOCK_MS - 1);
    expect(guard.refusal('203.0.113.9', number)).toBe(numberLocked(1));
    pass(1);
    // The lock lifted, its count starts over: four more wrong ones lock nothing.
    expect(guard.refusal('203.0.113.9', number)).toBeNull();
    for (let i = 0; i < WRONG_PER_NUMBER - 1; i += 1) {
      guard.wrong(`192.0.2.${i}`, number);
    }
    expect(guard.refusal('203.0.113.9', number)).toBeNull();
  });

  it('forgets an Ausweisnummer’s wrong Kennwörter at a right one, and after their minute', () => {
    const { guard, pass } = guarded();
    const number = 'EL-7K3M-9Q2D';
    for (let i = 0; i < WRONG_PER_NUMBER - 1; i += 1) {
      guard.wrong(`198.51.100.${i}`, number);
    }
    guard.right(number);
    guard.wrong('198.51.100.9', number);
    expect(guard.refusal('203.0.113.9', number)).toBeNull();
    pass(LOCK_MS);
    for (let i = 0; i < WRONG_PER_NUMBER - 1; i += 1) {
      guard.wrong(`198.51.100.${i}`, number);
    }
    expect(guard.refusal('203.0.113.9', number)).toBeNull();
  });

  it('lets go of every address and number once its minute and its lock are over', () => {
    const { guard, pass } = guarded();
    for (let i = 0; i < WRONG_PER_NUMBER; i += 1) {
      guard.wrong('203.0.113.7', 'EL-7K3M-9Q2D');
    }
    guard.wrong('192.0.2.200', 'EL-BBBB-BBBB');
    expect(guard.size).toBe(4);
    pass(LOCK_MS - 1);
    expect(guard.refusal('192.0.2.1', null)).toBeNull();
    expect(guard.size).toBe(4);
    // The first check a minute after the last sweep sweeps on its own.
    pass(1);
    expect(guard.refusal('192.0.2.1', null)).toBeNull();
    expect(guard.size).toBe(0);
  });

  it('keeps no key longer than 64 characters: the rest of a longer one counts with it', () => {
    const { guard } = guarded();
    for (let i = 0; i < WRONG_PER_ADDRESS; i += 1) {
      guard.wrong(`${'x'.repeat(64)}${i}`, `EL-${'Z'.repeat(64)}${i}`);
    }
    expect(guard.size).toBe(2);
    expect(guard.refusal(`${'x'.repeat(64)}other`, null)).toBe(fromTooMany(60));
  });

  it('sweeps on a timer that keeps no process up, and stops', () => {
    vi.useFakeTimers();
    try {
      const guard = new SignInGuard();
      guard.wrong('203.0.113.7', null);
      const stop = guard.sweepEveryWindow();
      vi.advanceTimersByTime(LOCK_MS - 1);
      expect(guard.size).toBe(1);
      vi.advanceTimersByTime(1);
      expect(guard.size).toBe(0);
      stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
