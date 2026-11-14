/**
 * What a login is, as server and client read it (docs/accounts.md, „Sign in"): an Ausweisnummer
 * the server mints, „EL-7K3M-9Q2D", and a Kennwort its player sets. The server mints, hashes and
 * checks (server login.ts); here only what both sides read the same way.
 */

/** The Ausweisnummer's characters: digits and capitals that read one way only — no 0, O, 1, I. */
export const NUMBER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** An Ausweisnummer as typed, case, spaces and dashes taken out: „EL" or not, then its eight. */
const TYPED_NUMBER = /^(?:EL)?([2-9A-HJ-NP-Z]{8})$/;

/** `chars`, eight of NUMBER_ALPHABET, as an Ausweisnummer is written: „EL-7K3M-9Q2D". */
export const writtenNumber = (chars: string): string =>
  `EL-${chars.slice(0, 4)}-${chars.slice(4)}`;

/**
 * The Ausweisnummer `typed` stands for, as the server writes it — typed in any case, with spaces
 * or dashes or none, with „EL" or without; null where it stands for none.
 */
export function numberOf(typed: string): string | null {
  const chars = TYPED_NUMBER.exec(typed.toUpperCase().replace(/[\s-]+/g, ''))?.[1];
  return chars === undefined ? null : writtenNumber(chars);
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
