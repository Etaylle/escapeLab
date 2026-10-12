import { shuffle, type Rng } from './rng.js';

/**
 * Edgework: the lab's serial, control lamps and emergency cells, rolled once
 * per run. Only players who have walked up to the sign get it, and manual
 * rules may read it — so the answer to a station changes from run to run
 * while the printed rules stay the same. Player-facing names:
 * „Laborkennung", „Kontrollleuchten", „Notstromzellen".
 */

export const INDICATOR_IDS = ['FRQ', 'SIG', 'CAR', 'NSA', 'BOB', 'IND'] as const;
export type IndicatorId = (typeof INDICATOR_IDS)[number];

export interface Edgework {
  /** e.g. "K7G3-2": five alphanumerics, dash, one digit. Letters are uppercase, no O/I. */
  serial: string;
  /** three of the pool above, in a random order, each lit or dark */
  indicators: { id: IndicatorId; lit: boolean }[];
  /** 0–4 */
  cells: number;
}

/** O and I are left out: said out loud they pass for 0 and 1. */
const SERIAL_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '0123456789';
const VOWELS = new Set(['A', 'E', 'U']);

export function generateEdgework(rng: Rng): Edgework {
  const pick = (chars: string): string => chars.charAt(Math.floor(rng() * chars.length));
  const head = Array.from({ length: 5 }, () => pick(SERIAL_LETTERS + DIGITS)).join('');
  const serial = `${head}-${pick(DIGITS)}`;
  const indicators = shuffle(INDICATOR_IDS, rng)
    .slice(0, 3)
    .map((id) => ({ id, lit: rng() < 0.5 }));
  return { serial, indicators, cells: Math.floor(rng() * 5) };
}

/** The digit after the dash. */
export function serialLastDigit(edgework: Edgework): number {
  return Number(edgework.serial.charAt(edgework.serial.length - 1));
}

export function serialLastDigitIsOdd(edgework: Edgework): boolean {
  return serialLastDigit(edgework) % 2 === 1;
}

/** A, E or U anywhere in the serial (O and I never occur). */
export function serialHasVowel(edgework: Edgework): boolean {
  return [...edgework.serial].some((char) => VOWELS.has(char));
}

export function indicatorLit(edgework: Edgework, id: IndicatorId): boolean {
  return edgework.indicators.some((indicator) => indicator.id === id && indicator.lit);
}

export function indicatorPresent(edgework: Edgework, id: IndicatorId): boolean {
  return edgework.indicators.some((indicator) => indicator.id === id);
}
