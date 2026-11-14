import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { MAX_KEY_LENGTH } from './rateLimiter.js';

/**
 * Signing in (docs/accounts.md, „Sign in"): an account's own way in beside the crew passes of its
 * devices — an Ausweisnummer the server mints, „EL-7K3M-9Q2D", and a Kennwort its player sets,
 * kept as a scrypt hash with a random salt and compared in constant time — and the limits on
 * trying them: so many wrong tries an address a minute, so many wrong Kennwörter an
 * Ausweisnummer before it locks for a minute. The log never holds a Kennwort or a hash.
 */

/** The Ausweisnummer's characters: digits and capitals that read one way only — no 0, O, 1, I. */
export const NUMBER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** An Ausweisnummer as typed, case, spaces and dashes taken out: „EL" or not, then its eight. */
const TYPED_NUMBER = /^(?:EL)?([2-9A-HJ-NP-Z]{8})$/;

/** `chars`, eight of NUMBER_ALPHABET, as an Ausweisnummer is written: „EL-7K3M-9Q2D". */
const written = (chars: string): string => `EL-${chars.slice(0, 4)}-${chars.slice(4)}`;

/** A new Ausweisnummer: eight characters of NUMBER_ALPHABET, each from the system's CSPRNG. */
export function mintNumber(): string {
  const draw = (): string => NUMBER_ALPHABET.charAt(randomInt(NUMBER_ALPHABET.length));
  return written(Array.from({ length: 8 }, draw).join(''));
}

/**
 * The Ausweisnummer `typed` stands for, as the server writes it — typed in any case, with spaces
 * or dashes or none, with „EL" or without; null where it stands for none.
 */
export function numberOf(typed: string): string | null {
  const chars = TYPED_NUMBER.exec(typed.toUpperCase().replace(/[\s-]+/g, ''))?.[1];
  return chars === undefined ? null : written(chars);
}

/** The fewest and the most characters a Kennwort has; nothing else is asked of it. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** What a Kennwort too short or too long is told. */
export const PASSWORD_SIZE = `Ein Kennwort hat ${PASSWORD_MIN} bis ${PASSWORD_MAX} Zeichen.`;

/** Whether `password` has a Kennwort's length, its characters counted as typed. */
export function passwordFits(password: string): boolean {
  const length = [...password].length;
  return length >= PASSWORD_MIN && length <= PASSWORD_MAX;
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

/** Wrong tries an address may make a minute: a lecture's typos behind a NAT fit, guessing not. */
export const WRONG_PER_ADDRESS = 10;

/** Wrong Kennwörter an Ausweisnummer takes within a minute before it locks (LOCK_MS). */
export const WRONG_PER_NUMBER = 5;

/** How long an Ausweisnummer stays locked, ms — and the minute both limits count wrong tries in. */
export const LOCK_MS = 60_000;

/** What a try is told whose address is over its wrong tries: `s` seconds until the next may go. */
export const fromTooMany = (s: number): string =>
  `Zu viele falsche Anmeldungen von dieser Adresse — wieder möglich in ${s} s.`;

/** What a try on an Ausweisnummer locked is told: `s` seconds until the lock lifts. */
export const numberLocked = (s: number): string =>
  `Diese Ausweisnummer ist nach ${WRONG_PER_NUMBER} falschen Kennwörtern gesperrt — ` +
  `wieder möglich in ${s} s.`;

/** Whole seconds from `now` until `at`, at least one. */
const secondsUntil = (at: number, now: number): number => Math.max(1, Math.ceil((at - now) / 1000));

/** The moments of `moments` within the last LOCK_MS before `now`. */
const recent = (moments: readonly number[] | undefined, now: number): number[] =>
  (moments ?? []).filter((at) => now - at < LOCK_MS);

/** An Ausweisnummer's wrong Kennwörter in the last minute, and until when it is locked (ms). */
interface Tried {
  wrong: number[];
  until: number;
}

/**
 * The limits on signing in, counted in memory — a restart forgets them: an address with
 * WRONG_PER_ADDRESS wrong tries in the last minute is refused until the oldest is a minute old;
 * an Ausweisnummer locks for LOCK_MS at its WRONG_PER_NUMBER-th wrong Kennwort within a minute,
 * whoever tried it — known or not, so that a lock tells nothing — and its count starts over then,
 * or at a right one. Only wrong tries count: thirty right sign-ins of a lecture behind one address
 * go through in the same minute; and a try refused counts nothing, so that no limit holds longer
 * than a minute after the wrong tries stop. Every key is let go of once its minute and its lock
 * are over — by the next check once a minute has passed since the last sweep, or by the timer of
 * `sweepEveryWindow` — and none is kept longer than MAX_KEY_LENGTH.
 */
export class SignInGuard {
  /** each address's wrong tries in the last minute, the oldest first */
  private readonly addresses = new Map<string, number[]>();
  /** each Ausweisnummer's wrong Kennwörter and its lock (`Tried`) */
  private readonly numbers = new Map<string, Tried>();
  /** when the keys were last swept */
  private swept: number;

  constructor(private readonly now: () => number = Date.now) {
    this.swept = now();
  }

  /** How many addresses and Ausweisnummern it holds now. */
  get size(): number {
    return this.addresses.size + this.numbers.size;
  }

  /**
   * Why a try from `address` on the Ausweisnummer `number` (null for none readable) may not go
   * ahead now, with the seconds until it may; null where it may.
   */
  refusal(address: string, number: string | null): string | null {
    const now = this.now();
    if (now - this.swept >= LOCK_MS) {
      this.sweep();
    }
    const wrong = recent(this.addresses.get(address.slice(0, MAX_KEY_LENGTH)), now);
    const oldest = wrong[0];
    if (wrong.length >= WRONG_PER_ADDRESS && oldest !== undefined) {
      return fromTooMany(secondsUntil(oldest + LOCK_MS, now));
    }
    const tried = number === null ? undefined : this.numbers.get(number.slice(0, MAX_KEY_LENGTH));
    const until = tried?.until ?? 0;
    return until > now ? numberLocked(secondsUntil(until, now)) : null;
  }

  /**
   * A wrong try from `address` on `number` counted: the number locks at WRONG_PER_NUMBER. The log
   * says when an address is refused or a number locks, naming neither.
   */
  wrong(address: string, number: string | null): void {
    const now = this.now();
    const from = address.slice(0, MAX_KEY_LENGTH);
    const tries = [...recent(this.addresses.get(from), now), now];
    this.addresses.set(from, tries);
    if (tries.length === WRONG_PER_ADDRESS) {
      console.log(`[escapelab] an address tried ${WRONG_PER_ADDRESS} wrong Kennwörter in a minute`);
    }
    if (number === null) {
      return;
    }
    const key = number.slice(0, MAX_KEY_LENGTH);
    const was = this.numbers.get(key);
    const wrong = [...recent(was?.wrong, now), now];
    const locks = wrong.length >= WRONG_PER_NUMBER;
    const next = locks ? { wrong: [], until: now + LOCK_MS } : { wrong, until: was?.until ?? 0 };
    this.numbers.set(key, next);
    if (locks) {
      const wrongs = `${WRONG_PER_NUMBER} wrong Kennwörter`;
      console.log(`[escapelab] an Ausweisnummer locked for ${LOCK_MS / 1000} s after ${wrongs}`);
    }
  }

  /** A right Kennwort for `number`: its wrong ones are forgotten. */
  right(number: string): void {
    this.numbers.delete(number.slice(0, MAX_KEY_LENGTH));
  }

  /** Lets go of every address and every Ausweisnummer with no wrong try and no lock left. */
  sweep(): void {
    const now = this.now();
    this.swept = now;
    for (const [address, wrong] of this.addresses) {
      if (recent(wrong, now).length === 0) {
        this.addresses.delete(address);
      }
    }
    for (const [number, tried] of this.numbers) {
      if (recent(tried.wrong, now).length === 0 && tried.until <= now) {
        this.numbers.delete(number);
      }
    }
  }

  /** Sweeps once a minute from now, never keeping the process up for it; returns how to stop. */
  sweepEveryWindow(): () => void {
    const timer = setInterval(() => this.sweep(), LOCK_MS);
    timer.unref();
    return () => clearInterval(timer);
  }
}
