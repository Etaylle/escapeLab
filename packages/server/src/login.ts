import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { GameError, NUMBER_ALPHABET, writtenNumber } from '@escapelab/core';
import { MAX_KEY_LENGTH } from './rateLimiter.js';

/**
 * Signing in (docs/accounts.md, „Sign in"): an account's own way in beside the crew passes of its
 * devices — an Ausweisnummer the server mints, „EL-7K3M-9Q2D", and a Kennwort its player sets
 * (core login.ts reads both as the client does),
 * kept as a scrypt hash with a random salt and compared in constant time — and the limits on
 * trying them: so many tries an address a minute, five wrong Kennwörter an Ausweisnummer — or a
 * pass's „Kennwort ändern" — before it locks, each lock twice as long as the one before, up to an
 * hour; and so many Kennwörter derived at once on the whole server. The log never holds a
 * Kennwort or a hash.
 */

/**
 * A new Ausweisnummer: eight characters of NUMBER_ALPHABET (core login.ts, which reads them back),
 * each from the system's CSPRNG.
 */
export function mintNumber(): string {
  const draw = (): string => NUMBER_ALPHABET.charAt(randomInt(NUMBER_ALPHABET.length));
  return writtenNumber(Array.from({ length: 8 }, draw).join(''));
}

/** scrypt's cost for a Kennwort: N, r and p. */
export const COST = { N: 2 ** 15, r: 8, p: 1 } as const;

/** The bytes of a hash's salt, and of the key scrypt derives. */
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** scrypt's memory bound: twice the 128 · N · r bytes COST takes, which Node's default just is. */
const MAXMEM = 2 * 128 * COST.N * COST.r;

/** scrypt's cost as a hash names it: N, r and p. */
type Cost = { N: number; r: number; p: number };

/** A scrypt hash as a login keeps it, read back: its cost, its salt, its key. */
interface Kept extends Cost {
  salt: Buffer;
  key: Buffer;
}

/** The key scrypt derives from `password` — NFKC-normalised, as typed on any keyboard. */
function derive(password: string, salt: Buffer, cost: Cost, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options = { N: cost.N, r: cost.r, p: cost.p, maxmem: MAXMEM };
    scrypt(password.normalize('NFKC'), salt, length, options, (err, key) => {
      if (err === null) {
        resolve(key);
      } else {
        reject(err);
      }
    });
  });
}

/** `password` as a login keeps it: `scrypt$N$r$p$salt$hash`, salt and hash in hex, the salt new. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST, KEY_BYTES);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('hex'), key.toString('hex')].join('$');
}

/** `text` as bytes, where it is 16 to 64 of them in hex; null otherwise. */
function hexBytes(text: string | undefined): Buffer | null {
  const sound = text !== undefined && /^(?:[0-9a-f]{2}){16,64}$/.test(text);
  return sound ? Buffer.from(text, 'hex') : null;
}

/** Whether a hash's cost is one scrypt may derive within MAXMEM, as this server's are. */
function costFits({ N, r, p }: Cost): boolean {
  const power = Number.isInteger(Math.log2(N)) && N >= 2 ** 10;
  return power && r >= 1 && p >= 1 && p <= 16 && 128 * N * r <= MAXMEM;
}

/** A hash as `hashPassword` writes it, read back; null for anything else, or a cost too high. */
function readHash(stored: string): Kept | null {
  const [kind, n, r, p, saltHex, keyHex, ...rest] = stored.split('$');
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (kind !== 'scrypt' || rest.length > 0 || !costFits(cost)) {
    return null;
  }
  const salt = hexBytes(saltHex);
  const key = hexBytes(keyHex);
  return salt === null || key === null ? null : { ...cost, salt, key };
}

/**
 * What a Kennwort is checked against where there is no login to check it against: the same work
 * as for a real one, so that no answer's timing tells which Ausweisnummern are given.
 */
const NOBODY: Kept = { ...COST, salt: Buffer.alloc(SALT_BYTES), key: Buffer.alloc(KEY_BYTES) };

/**
 * Whether `password` is the Kennwort whose hash `stored` keeps (`hashPassword`), the keys compared
 * in constant time; false — after the same work — where nothing is stored, or nothing readable,
 * which the log says without the hash.
 */
export async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  const kept = stored === null ? null : readHash(stored);
  if (stored !== null && kept === null) {
    console.error('[escapelab] a login keeps no readable scrypt hash: no Kennwort matches it');
  }
  const against = kept ?? NOBODY;
  const key = await derive(password, against.salt, against, against.key.length);
  return timingSafeEqual(key, against.key) && kept !== null;
}

/** Kennwörter scrypt derives at once on the whole server (`DeriveQueue`). */
export const DERIVES_AT_ONCE = 4;

/** Kennwörter that may wait for a turn at once (`DeriveQueue`): beyond them one is refused. */
export const DERIVES_WAITING = 32;

/** What a Kennwort is told that finds every turn taken and the queue full (`DeriveQueue`). */
export const BUSY = 'Die Kennwortprüfung ist gerade ausgelastet — in einem Moment wieder möglich.';

/** The places one address holds in the queue at once (`DeriveQueue`): deriving and waiting. */
interface Held {
  places: number;
  /** whether the log said that it was refused, since it last held none */
  told: boolean;
}

/**
 * The turns at deriving a Kennwort's key on the whole server — a hash made (`hashPassword`), a
 * Kennwort checked (`passwordMatches`): `atOnce` at a time, the rest waiting in the order they
 * came, `mayWait` at most; one more is refused (BUSY), which the log says once till the queue
 * has emptied. One address holds half the places at most, deriving and waiting together, and is
 * refused the same way beyond: a machine that floods the queue keeps no other out, and a hall
 * behind one address still gets its half. scrypt takes 32 MiB and one of Node's four worker
 * threads each: a lecture signing in at once neither runs the server out of memory nor keeps its
 * files and its database waiting behind a crowd of keys.
 */
export class DeriveQueue {
  /** how many derive now */
  private running = 0;
  /** who waits for a turn, the first first */
  private readonly waiting: (() => void)[] = [];
  /** whether one was refused since the queue was last empty */
  private refusing = false;
  /** the places each address holds now, by address (`Held`) */
  private readonly held = new Map<string, Held>();
  /** the places one address may hold at once: half of all */
  private readonly share: number;

  constructor(
    private readonly atOnce = DERIVES_AT_ONCE,
    private readonly mayWait = DERIVES_WAITING,
  ) {
    this.share = Math.max(1, Math.floor((atOnce + mayWait) / 2));
  }

  /**
   * `job` in a turn of its own, asked from the address `from` — at once, or once those before it
   * are done — the turn going on to the next once `job` settles, however. Rejects with
   * GameError(BUSY), running nothing, where `from` holds its share of the places already, or
   * `mayWait` wait.
   */
  async run<T>(job: () => Promise<T>, from: string): Promise<T> {
    this.take(from);
    try {
      await this.turn();
      try {
        return await job();
      } finally {
        this.next();
      }
    } finally {
      this.letGo(from);
    }
  }

  /** A place for `from`, where it holds fewer than its share; else BUSY, the log saying it once. */
  private take(from: string): void {
    const held = this.held.get(from) ?? { places: 0, told: false };
    if (held.places < this.share) {
      this.held.set(from, { ...held, places: held.places + 1 });
      return;
    }
    if (!held.told) {
      this.held.set(from, { ...held, told: true });
      const places = `${this.share} of the ${this.atOnce + this.mayWait} places`;
      console.log(`[escapelab] Kennwörter refused: one address holds ${places}`);
    }
    throw new GameError(BUSY);
  }

  /** A place `from` held, given back: done, or refused by the queue. */
  private letGo(from: string): void {
    const held = this.held.get(from);
    if (held === undefined || held.places <= 1) {
      this.held.delete(from);
    } else {
      this.held.set(from, { ...held, places: held.places - 1 });
    }
  }

  /** A turn: at once where one is free, else once those waiting before it had theirs. */
  private turn(): Promise<void> {
    if (this.running < this.atOnce) {
      this.running += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.mayWait) {
      if (!this.refusing) {
        this.refusing = true;
        const full = `${this.atOnce} derive at once and ${this.mayWait} wait`;
        console.log(`[escapelab] Kennwörter refused: ${full}`);
      }
      return Promise.reject(new GameError(BUSY));
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  /** A turn done: the first waiting has it, else it is free. */
  private next(): void {
    const first = this.waiting.shift();
    if (first === undefined) {
      this.running -= 1;
      this.refusing = false;
    } else {
      first();
    }
  }
}

/**
 * Tries an address may have counted in a minute (`SignInGuard`): a lecture hall's typos behind
 * one address fit, guessing not.
 */
export const WRONG_PER_ADDRESS = 60;

/** The minute an address's tries count in, ms. */
export const ADDRESS_WINDOW_MS = 60_000;

/**
 * Every so many wrong Kennwörter counted on an Ausweisnummer, or on a pass's „Kennwort ändern",
 * lock it (`LockBook`).
 */
export const WRONG_PER_LOCK = 5;

/** The first lock, ms; each lock after lasts twice as long as the one before, up to the longest. */
export const FIRST_LOCK_MS = 60_000;

/** The longest lock, ms: an hour. */
export const LONGEST_LOCK_MS = 3_600_000;

/**
 * How long a count stays quiet before it is forgotten, its locks with it, ms: an hour from its
 * last wrong Kennwort or the end of its last lock, whichever is later (`quietFrom`).
 */
export const QUIET_MS = 3_600_000;

/** `s` seconds as a wait is told: in seconds up to two minutes, in whole minutes beyond. */
const waitOf = (s: number): string => (s <= 120 ? `${s} s` : `${Math.ceil(s / 60)} min`);

/** What a try is told whose address is over its tries: `s` seconds until the next may go. */
export const fromTooMany = (s: number): string =>
  `Zu viele falsche Anmeldungen von dieser Adresse — wieder möglich in ${waitOf(s)}.`;

/** What a try on an Ausweisnummer locked is told: `s` seconds until the lock lifts. */
export const numberLocked = (s: number): string =>
  `Diese Ausweisnummer ist nach ${WRONG_PER_LOCK} falschen Kennwörtern gesperrt — ` +
  `wieder möglich in ${waitOf(s)}.`;

/** What „Kennwort ändern" is told on a pass locked: `s` seconds until the lock lifts. */
export const changeLocked = (s: number): string =>
  `Nach ${WRONG_PER_LOCK} falschen Kennwörtern ist das Ändern hier gesperrt — ` +
  `wieder möglich in ${waitOf(s)}.`;

/** Whole seconds from `now` until `at`, at least one. */
const secondsUntil = (at: number, now: number): number => Math.max(1, Math.ceil((at - now) / 1000));

/** `text` as a key of the limits: its first MAX_KEY_LENGTH characters, the rest counted with it. */
const keyOf = (text: string): string => text.slice(0, MAX_KEY_LENGTH);

/**
 * What a try at a Kennwort tries: the Kennwort of an Ausweisnummer, as a sign-in does — null for
 * none readable — or the present Kennwort of a pass's account, as „Kennwort ändern" shows it on a
 * pass signed in already, by the pass's id.
 */
export type Target = { number: string | null } | { pass: string };

/** A try counted before its Kennwort is checked (`SignInGuard.take`). */
export interface Ticket {
  /** The Kennwort was right: the try is given back to its address, and what it tried cleared. */
  right: () => void;
}

/** A key's wrong Kennwörter and its locks (`LockBook`), times in epoch ms. */
interface Count {
  /** wrong Kennwörter counted since its last lock, or since counting began */
  wrong: number;
  /** when the last of them was counted */
  last: number;
  /** how long its last lock was, ms; 0 before the first */
  lock: number;
  /** when its last lock lifts, or lifted; 0 before the first */
  until: number;
}

/** When `count` began to go quiet: at its last wrong Kennwort or its last lock's end, the later. */
const quietFrom = (count: Count): number => Math.max(count.last, count.until);

/**
 * Wrong Kennwörter counted by key — an Ausweisnummer, or a pass — and the locks they bring: every
 * WRONG_PER_LOCK-th locks the key, for FIRST_LOCK_MS the first time and twice as long as the lock
 * before each time after, LONGEST_LOCK_MS at most. They are counted however they are paced, till
 * a right Kennwort clears the key or it stays quiet for QUIET_MS (`quietFrom`), which forgets it.
 */
class LockBook {
  private readonly counts = new Map<string, Count>();

  /** `what` names a key of the book in the log line of its lock. */
  constructor(private readonly what: string) {}

  /** How many keys it holds now. */
  get size(): number {
    return this.counts.size;
  }

  /** How long `key` stays locked from `now`, ms; 0 where it is not. */
  lockedFor(key: string, now: number): number {
    const count = this.current(key, now);
    return count === undefined ? 0 : Math.max(0, count.until - now);
  }

  /** A wrong Kennwort counted on `key` at `now`: every WRONG_PER_LOCK-th locks it, logged. */
  count(key: string, now: number): void {
    const count = this.current(key, now) ?? { wrong: 0, last: now, lock: 0, until: 0 };
    const wrong = count.wrong + 1;
    if (wrong < WRONG_PER_LOCK) {
      this.counts.set(key, { ...count, wrong, last: now });
      return;
    }
    const lock = count.lock === 0 ? FIRST_LOCK_MS : Math.min(2 * count.lock, LONGEST_LOCK_MS);
    this.counts.set(key, { wrong: 0, last: now, lock, until: now + lock });
    const after = `${WRONG_PER_LOCK} wrong Kennwörter`;
    console.log(`[escapelab] ${this.what} locked for ${lock / 1000} s after ${after}`);
  }

  /** `key` cleared, its count and its locks with it: a right Kennwort. */
  clear(key: string): void {
    this.counts.delete(key);
  }

  /** Forgets every key that has been quiet for QUIET_MS at `now`. */
  sweep(now: number): void {
    for (const [key, count] of this.counts) {
      if (now - quietFrom(count) >= QUIET_MS) {
        this.counts.delete(key);
      }
    }
  }

  /** The count of `key` at `now`; undefined for none, or for one quiet for QUIET_MS, forgotten. */
  private current(key: string, now: number): Count | undefined {
    const count = this.counts.get(key);
    if (count !== undefined && now - quietFrom(count) >= QUIET_MS) {
      this.counts.delete(key);
      return undefined;
    }
    return count;
  }
}

/**
 * The limits on trying a Kennwort, counted in memory — a restart forgets them. Every try counts
 * the moment it goes ahead (`take`), before its Kennwort is checked, as a wrong one, and a right
 * one is given back once it is: tries sent at once are held to the limits as tries one after the
 * other. An address with WRONG_PER_ADDRESS tries counted in the last minute is refused till the
 * oldest is a minute old — right tries given back, a lecture's sign-ins behind one address go
 * through. An Ausweisnummer, known or not so that a lock tells nothing, and a pass's „Kennwort
 * ändern" each lock as `LockBook` says. A try refused counts nothing. Every key is let go of once
 * nothing counts any more — by the next check once a minute has passed since the last sweep, or
 * by the timer of `sweepEveryWindow` — and none is kept longer than MAX_KEY_LENGTH.
 */
export class SignInGuard {
  /** each address's tries counted in the last minute, the oldest first */
  private readonly addresses = new Map<string, number[]>();
  /** the Ausweisnummern tried, and their locks */
  private readonly numbers = new LockBook('an Ausweisnummer');
  /** the passes whose „Kennwort ändern" tried a wrong present Kennwort, and their locks */
  private readonly passes = new LockBook('a pass’s „Kennwort ändern“');
  /** when the keys were last swept */
  private swept: number;

  constructor(private readonly now: () => number = Date.now) {
    this.swept = now();
  }

  /** How many addresses, Ausweisnummern and passes it holds now. */
  get size(): number {
    return this.addresses.size + this.numbers.size + this.passes.size;
  }

  /**
   * Why a try from `address` at `on` may not go ahead now, with the time until it may; null where
   * it may. Counts nothing.
   */
  refusal(address: string, on: Target): string | null {
    const now = this.now();
    if (now - this.swept >= ADDRESS_WINDOW_MS) {
      this.sweep();
    }
    const tries = this.counted(keyOf(address), now);
    const oldest = tries[0];
    if (tries.length >= WRONG_PER_ADDRESS && oldest !== undefined) {
      return fromTooMany(secondsUntil(oldest + ADDRESS_WINDOW_MS, now));
    }
    const { book, key, told } = this.lockOf(on);
    const locked = key === null ? 0 : book.lockedFor(key, now);
    return locked > 0 ? told(secondsUntil(now + locked, now)) : null;
  }

  /**
   * A try from `address` at `on`, counted as a wrong one before its Kennwort is checked, where it
   * may go ahead (`refusal`): the ticket that gives it back where the Kennwort is right. Else why
   * it may not, counting nothing. The log says when an address reaches its limit, naming none.
   */
  take(address: string, on: Target): Ticket | string {
    const refused = this.refusal(address, on);
    if (refused !== null) {
      return refused;
    }
    const now = this.now();
    const from = keyOf(address);
    const tries = [...this.counted(from, now), now];
    this.addresses.set(from, tries);
    if (tries.length === WRONG_PER_ADDRESS) {
      console.log(`[escapelab] an address tried ${WRONG_PER_ADDRESS} wrong Kennwörter in a minute`);
    }
    const { book, key } = this.lockOf(on);
    if (key !== null) {
      book.count(key, now);
    }
    return {
      right: () => {
        this.giveBack(from, now);
        if (key !== null) {
          book.clear(key);
        }
      },
    };
  }

  /** Lets go of every address, Ausweisnummer and pass that nothing counts on any more. */
  sweep(): void {
    const now = this.now();
    this.swept = now;
    for (const address of this.addresses.keys()) {
      if (this.counted(address, now).length === 0) {
        this.addresses.delete(address);
      }
    }
    this.numbers.sweep(now);
    this.passes.sweep(now);
  }

  /** Sweeps once a minute from now, never keeping the process up for it; returns how to stop. */
  sweepEveryWindow(): () => void {
    const timer = setInterval(() => this.sweep(), ADDRESS_WINDOW_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  /** The tries counted from the address `from` within the minute before `now`, the oldest first. */
  private counted(from: string, now: number): number[] {
    return (this.addresses.get(from) ?? []).filter((at) => now - at < ADDRESS_WINDOW_MS);
  }

  /** The try counted from `from` at `at` given back: a right one. */
  private giveBack(from: string, at: number): void {
    const tries = this.addresses.get(from) ?? [];
    const index = tries.indexOf(at);
    if (index >= 0) {
      tries.splice(index, 1);
    }
  }

  /** The book a try at `on` is counted in, its key there — null for none — and its refusal. */
  private lockOf(on: Target): { book: LockBook; key: string | null; told: (s: number) => string } {
    if ('pass' in on) {
      return { book: this.passes, key: keyOf(on.pass), told: changeLocked };
    }
    const key = on.number === null ? null : keyOf(on.number);
    return { book: this.numbers, key, told: numberLocked };
  }
}
