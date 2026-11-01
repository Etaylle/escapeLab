/**
 * The Tagesschicht: one seed a day for a mission that offers it (`Mission['daily']`), the
 * same for every room and every crew, so that the day's runs all play the same instance and
 * rank against each other. The day is the UTC date of the moment a run starts, as the
 * server's clock has it, and the seed mixes the day with a salt only the server holds, so
 * that nobody works the day's instance out from its date. Epoch ms in, a day out, no clock
 * read here: the server hands the reducer the day and its seed with the start (`DailyStart`).
 */

/** A UTC day as the Tagesschicht names it: „2026-10-31". */
export type DailyDay = string;

/** What the server hands a run on the Tagesschicht as it starts: its day, and the day's seed. */
export interface DailyStart {
  day: DailyDay;
  seed: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * The civil date of `days` days after 1970-01-01 (Howard Hinnant's `civil_from_days`):
 * year, month 1–12, day 1–31, for any day of the proleptic Gregorian calendar.
 */
function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const leap = Math.floor(doe / 1460) - Math.floor(doe / 36_524) + Math.floor(doe / 146_096);
  const yoe = Math.floor((doe - leap) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

const two = (n: number): string => String(n).padStart(2, '0');

/** The UTC day of the moment `at` (epoch ms): „2026-10-31". */
export function utcDay(at: number): DailyDay {
  if (!Number.isFinite(at)) {
    throw new Error(`utcDay: ${at} is no moment — pass epoch ms`);
  }
  const { year, month, day } = civilFromDays(Math.floor(at / MS_PER_DAY));
  return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}`;
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `text` names a day as `utcDay` writes it. */
export function isDailyDay(text: string): text is DailyDay {
  const match = DAY_PATTERN.exec(text);
  if (match === null) {
    return false;
  }
  const [, , month = '0', day = '0'] = match;
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31;
}

/**
 * The seed of the Tagesschicht of `day` on a server holding `salt`: FNV-1a over the salt and
 * the day's text, mixed through a finaliser so that neighbouring days land far apart — 32 bits,
 * as the PRNG takes them. Without the salt the day's seed cannot be worked out.
 */
export function dailySeed(day: DailyDay, salt: string): number {
  if (!isDailyDay(day)) {
    throw new Error(`dailySeed: "${day}" is no day — pass one as utcDay writes it, YYYY-MM-DD`);
  }
  if (salt === '') {
    throw new Error('dailySeed: an empty salt makes the day\'s seed public — pass the server\'s');
  }
  let hash = 0x811c9dc5;
  for (const char of `tagesschicht:${salt}:${day}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** The day as the lobby's switch names it: „31.10.". */
export function dailyLabel(day: DailyDay): string {
  const match = DAY_PATTERN.exec(day);
  if (match === null) {
    throw new Error(`dailyLabel: "${day}" is no day — pass one as utcDay writes it, YYYY-MM-DD`);
  }
  const [, , month, date] = match;
  return `${date}.${month}.`;
}
