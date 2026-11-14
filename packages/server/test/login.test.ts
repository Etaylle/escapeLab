import type * as Crypto from 'node:crypto';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NUMBER_ALPHABET, numberOf, passwordFits } from '@escapelab/core';
import {
  ADDRESS_WINDOW_MS,
  BUSY,
  changeLocked,
  COST,
  DeriveQueue,
  FIRST_LOCK_MS,
  fromTooMany,
  hashPassword,
  mintNumber,
  numberLocked,
  passwordMatches,
  QUIET_MS,
  SignInGuard,
  WRONG_PER_ADDRESS,
  WRONG_PER_LOCK,
  type Target,
  type Ticket,
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

/** What the guard logs: it says when an address is refused, and when an Ausweisnummer locks. */
let said: MockInstance<typeof console.log>;

/** A guard on a clock of its own: `pass` moves it. */
function guarded() {
  let at = 1_000_000;
  const guard = new SignInGuard(() => at);
  return { guard, pass: (ms: number) => (at += ms) };
}

/** Anna's Ausweisnummer, tried. */
const ANNAS: Target = { number: 'EL-7K3M-9Q2D' };

/** The try taken, as `SignInGuard.take` gives it: throws where it was refused. */
function ticket(taken: Ticket | string): Ticket {
  if (typeof taken === 'string') {
    throw new Error(`refused: ${taken}`);
  }
  return taken;
}

/** `times` tries at `on` taken from a machine each, never given back: what each was told. */
function wrongTries(guard: SignInGuard, on: Target, times: number): (string | null)[] {
  return Array.from({ length: times }, (_, i) => {
    const taken = guard.take(`198.51.100.${i}`, on);
    return typeof taken === 'string' ? taken : null;
  });
}

describe('the limits on signing in, by address', () => {
  beforeEach(() => {
    said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it(`refuses an address after ${WRONG_PER_ADDRESS} tries counted in a minute, others not`, () => {
    const { guard, pass } = guarded();
    for (let i = 0; i < WRONG_PER_ADDRESS; i += 1) {
      ticket(guard.take('203.0.113.7', { number: `EL-AAAA-A${(i + 1000).toString(32)}` }));
      pass(500);
    }
    expect(guard.refusal('203.0.113.7', { number: null })).toBe(fromTooMany(30));
    expect(guard.take('203.0.113.7', { pass: 'p-anna' })).toBe(fromTooMany(30));
    expect(guard.refusal('198.51.100.4', { number: null })).toBeNull();
    // The log says it once, naming no address.
    expect(said.mock.calls).toEqual([
      ['[escapelab] an address tried 60 wrong Kennwörter in a minute'],
    ]);
    // A try refused counts nothing: the address is free a minute after its first try.
    pass(29_000);
    expect(guard.refusal('203.0.113.7', { number: null })).toBe(fromTooMany(1));
    pass(1000);
    expect(guard.refusal('203.0.113.7', { number: null })).toBeNull();
  });

  it('counts tries taken at once, and gives a right one back: a lecture gets in', () => {
    const { guard } = guarded();
    const lecture = Array.from({ length: WRONG_PER_ADDRESS }, (_, i) =>
      ticket(guard.take('203.0.113.7', { number: `EL-CCCC-C${(i + 1000).toString(32)}` })),
    );
    // Sixty checked at once from one address: the next waits till one of them is right.
    expect(guard.take('203.0.113.7', ANNAS)).toBe(fromTooMany(60));
    lecture.forEach((taken) => taken.right());
    // Typos besides, as long as they are fewer than sixty a minute.
    for (let i = 0; i < WRONG_PER_ADDRESS - 1; i += 1) {
      ticket(guard.take('203.0.113.7', { number: null }));
    }
    expect(guard.refusal('203.0.113.7', ANNAS)).toBeNull();
  });

  it('keeps no key longer than 64 characters: the rest of a longer one counts with it', () => {
    const { guard } = guarded();
    for (let i = 0; i < WRONG_PER_ADDRESS; i += 1) {
      guard.take(`${'x'.repeat(64)}${i}`, { number: null });
    }
    const long = (end: string): Target => ({ number: `EL-${'Z'.repeat(64)}${end}` });
    for (let i = 0; i < WRONG_PER_LOCK; i += 1) {
      guard.take(`192.0.2.${i}`, long(String(i)));
    }
    // One address of the long ones, five short ones, one Ausweisnummer.
    expect(guard.size).toBe(1 + WRONG_PER_LOCK + 1);
    expect(guard.refusal(`${'x'.repeat(64)}other`, { number: null })).toBe(fromTooMany(60));
    expect(guard.refusal('192.0.2.99', long('other'))).toBe(numberLocked(60));
  });
});

describe('the limits on signing in, by Ausweisnummer', () => {
  beforeEach(() => {
    said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it(`locks an Ausweisnummer at its ${WRONG_PER_LOCK}th wrong Kennwort, from anywhere`, () => {
    const { guard, pass } = guarded();
    expect(wrongTries(guard, ANNAS, WRONG_PER_LOCK)).toEqual([null, null, null, null, null]);
    expect(guard.refusal('203.0.113.9', ANNAS)).toBe(numberLocked(60));
    expect(guard.refusal('203.0.113.9', { number: 'EL-7K3M-9Q2E' })).toBeNull();
    expect(said.mock.calls).toEqual([
      ['[escapelab] an Ausweisnummer locked for 60 s after 5 wrong Kennwörter'],
    ]);
    pass(FIRST_LOCK_MS - 1);
    expect(guard.refusal('203.0.113.9', ANNAS)).toBe(numberLocked(1));
    pass(1);
    expect(guard.refusal('203.0.113.9', ANNAS)).toBeNull();
  });

  it('holds tries taken at once to the five: the sixth is refused before any is checked', () => {
    const { guard } = guarded();
    const five = wrongTries(guard, ANNAS, WRONG_PER_LOCK);
    expect([...five, guard.take('203.0.113.9', ANNAS)]).toEqual([
      null,
      null,
      null,
      null,
      null,
      numberLocked(60),
    ]);
  });

  it('clears an Ausweisnummer at a right Kennwort, giving its try back', () => {
    const { guard } = guarded();
    wrongTries(guard, ANNAS, WRONG_PER_LOCK - 1);
    ticket(guard.take('203.0.113.9', ANNAS)).right();
    expect(wrongTries(guard, ANNAS, WRONG_PER_LOCK - 1)).toEqual([null, null, null, null]);
    expect(guard.refusal('203.0.113.9', ANNAS)).toBeNull();
    // The right one counted as the fifth while it was checked: its lock goes with it.
    wrongTries(guard, { number: 'EL-BBBB-BBBB' }, WRONG_PER_LOCK - 1);
    const fifth = ticket(guard.take('203.0.113.9', { number: 'EL-BBBB-BBBB' }));
    expect(guard.refusal('203.0.113.9', { number: 'EL-BBBB-BBBB' })).toBe(numberLocked(60));
    fifth.right();
    expect(guard.refusal('203.0.113.9', { number: 'EL-BBBB-BBBB' })).toBeNull();
  });

  it('counts „Kennwort ändern" against its pass alone, which a locked number holds not', () => {
    const { guard } = guarded();
    wrongTries(guard, ANNAS, WRONG_PER_LOCK);
    expect(guard.refusal('203.0.113.9', { pass: 'p-anna' })).toBeNull();
    expect(wrongTries(guard, { pass: 'p-anna' }, WRONG_PER_LOCK + 1).at(-1)).toBe(
      changeLocked(60),
    );
    expect(guard.refusal('203.0.113.9', { pass: 'p-phone' })).toBeNull();
    expect(said.mock.calls.at(-1)).toEqual([
      '[escapelab] a pass’s „Kennwort ändern“ locked for 60 s after 5 wrong Kennwörter',
    ]);
  });
});

describe('the locks, growing', () => {
  beforeEach(() => {
    said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  /** The locks five wrong Kennwörter bring, each waited out: their seconds, as told. */
  function locks(guard: SignInGuard, pass: (ms: number) => number, rounds: number): number[] {
    return Array.from({ length: rounds }, () => {
      wrongTries(guard, ANNAS, WRONG_PER_LOCK);
      const told = guard.refusal('203.0.113.9', ANNAS) ?? '';
      const seconds = [60, 120, 240, 480, 960, 1920, 3600].find((s) => told === numberLocked(s));
      pass((seconds ?? 0) * 1000);
      expect(guard.refusal('203.0.113.9', ANNAS)).toBeNull();
      return seconds ?? 0;
    });
  }

  it('locks for a minute, then twice as long each time, an hour at most', () => {
    const { guard, pass } = guarded();
    expect(locks(guard, pass, 8)).toEqual([60, 120, 240, 480, 960, 1920, 3600, 3600]);
    expect(numberLocked(3600)).toBe(
      'Diese Ausweisnummer ist nach 5 falschen Kennwörtern gesperrt — wieder möglich in 60 min.',
    );
  });

  it('counts however slowly they come, till an hour goes by quiet', () => {
    const { guard, pass } = guarded();
    for (let i = 0; i < WRONG_PER_LOCK - 1; i += 1) {
      wrongTries(guard, ANNAS, 1);
      pass(50 * 60_000);
    }
    wrongTries(guard, ANNAS, 1);
    expect(guard.refusal('203.0.113.9', ANNAS)).toBe(numberLocked(60));
    // A quiet hour from the lock's end forgets the count and the lock before.
    pass(FIRST_LOCK_MS + QUIET_MS);
    expect(locks(guard, pass, 1)).toEqual([60]);
  });

  it('begins the quiet hour at the end of the last lock: the next lock grows on', () => {
    const { guard, pass } = guarded();
    expect(locks(guard, pass, 2)).toEqual([60, 120]);
    pass(QUIET_MS - 1);
    expect(locks(guard, pass, 1)).toEqual([240]);
  });

  it('counts nothing that is refused, and clears all at a right Kennwort after the lift', () => {
    const { guard, pass } = guarded();
    wrongTries(guard, ANNAS, WRONG_PER_LOCK);
    expect(wrongTries(guard, ANNAS, 20).every((told) => told === numberLocked(60))).toBe(true);
    pass(FIRST_LOCK_MS);
    expect(wrongTries(guard, ANNAS, WRONG_PER_LOCK - 1)).toEqual([null, null, null, null]);
    expect(guard.refusal('203.0.113.9', ANNAS)).toBeNull();
    wrongTries(guard, ANNAS, 1);
    pass(2 * FIRST_LOCK_MS);
    ticket(guard.take('203.0.113.9', ANNAS)).right();
    expect(locks(guard, pass, 1)).toEqual([60]);
  });
});

describe('the limits letting go', () => {
  beforeEach(() => {
    said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('lets go of an address after its minute, of a number after its quiet hour', () => {
    const { guard, pass } = guarded();
    wrongTries(guard, ANNAS, WRONG_PER_LOCK);
    guard.take('192.0.2.200', { pass: 'p-anna' });
    expect(guard.size).toBe(WRONG_PER_LOCK + 3);
    pass(ADDRESS_WINDOW_MS - 1);
    expect(guard.refusal('192.0.2.1', { number: null })).toBeNull();
    expect(guard.size).toBe(WRONG_PER_LOCK + 3);
    // The first check a minute after the last sweep sweeps on its own: the addresses go.
    pass(1);
    expect(guard.refusal('192.0.2.1', { number: null })).toBeNull();
    expect(guard.size).toBe(2);
    pass(QUIET_MS);
    guard.sweep();
    expect(guard.size).toBe(0);
  });

  it('sweeps on a timer that keeps no process up, and stops', () => {
    vi.useFakeTimers();
    try {
      const guard = new SignInGuard();
      guard.take('203.0.113.7', { number: null });
      const stop = guard.sweepEveryWindow();
      vi.advanceTimersByTime(ADDRESS_WINDOW_MS - 1);
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

describe('the turns at deriving a Kennwort', () => {
  /** A derive that runs till it is ended: whether it began. */
  function derive() {
    let end = (): void => undefined;
    let began = false;
    const run = (): Promise<string> => {
      began = true;
      return new Promise((resolve) => {
        end = () => resolve('key');
      });
    };
    return { run, end: () => end(), began: () => began };
  }

  /** Lets what waits on promises go on. */
  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  it('derives so many at once, the rest in the order they came, none past the queue', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const queue = new DeriveQueue(2, 3);
    const derives = Array.from({ length: 6 }, derive);
    const runs = derives.map((d) => queue.run(d.run));
    await expect(runs[5]).rejects.toThrow(BUSY);
    await flush();
    expect(derives.map((d) => d.began())).toEqual([true, true, false, false, false, false]);
    derives[1]?.end();
    await expect(runs[1]).resolves.toBe('key');
    await flush();
    expect(derives.map((d) => d.began())).toEqual([true, true, true, false, false, false]);
    for (const d of derives.slice(0, 5)) {
      d.end();
      await flush();
    }
    await Promise.all(runs.slice(0, 5));
    expect(derives.map((d) => d.began())).toEqual([true, true, true, true, true, false]);
    // The log says it once, till the queue has emptied: then again.
    const full = '[escapelab] Kennwörter refused: 2 derive at once and 3 wait';
    expect(said.mock.calls).toEqual([[full]]);
    const again = Array.from({ length: 6 }, derive);
    const later = again.map((d) => queue.run(d.run));
    await expect(later[5]).rejects.toThrow(BUSY);
    expect(said.mock.calls).toEqual([[full], [full]]);
    for (const d of again.slice(0, 5)) {
      await flush();
      d.end();
    }
    await Promise.all(later.slice(0, 5));
  });

  it('gives a turn on however its derive ended', async () => {
    const queue = new DeriveQueue(1, 1);
    await expect(queue.run(() => Promise.reject(new Error('scrypt failed')))).rejects.toThrow(
      'scrypt failed',
    );
    await expect(queue.run(() => Promise.resolve('key'))).resolves.toBe('key');
  });
});
