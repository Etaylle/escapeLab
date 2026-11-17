import { FEEDERS, STARTUP_GAPS, type PuzzleInputOf, type StartupGap } from '@escapelab/core';
import { sharedStart } from './ServersPanel.js';

/**
 * startupPrompt.ts: what the Anlaufsteuerung's terminal (StartupPanel.tsx) reads from a line
 * typed at its prompt — `zeige`, `setze <lücke> <wert>` (or the script's own
 * `<lücke> = <wert>`), `start` — what Tab completes there, and what the keys of its bezel put
 * into the line. A line that asks for npm is the one a 1986 machine answers on its own. Pure.
 */

type StartupInput = PuzzleInputOf<'startup'>;

/** The terminal's commands, as its keys and its prompt take them. */
export const STARTUP_COMMANDS = ['zeige', 'setze', 'start'] as const;
type StartupCommand = (typeof STARTUP_COMMANDS)[number];

/** What a typed line comes to: an input to send, npm asked for, or nothing the terminal reads. */
export type StartupLine = { input: StartupInput } | { npm: true } | null;

const isGap = (word: string): word is StartupGap => STARTUP_GAPS.some((gap) => gap === word);

/** The words of a line, lower-cased, an `=` standing as a word of its own. */
const wordsIn = (line: string): string[] =>
  line
    .trim()
    .toLowerCase()
    .replace(/=/g, ' = ')
    .split(/\s+/)
    .filter((word) => word !== '');

/** A feeder's number as a word of the line; null for any other word. */
function feederIn(word: string | undefined): number | null {
  const value = word === undefined || !/^\d+$/.test(word) ? NaN : Number(word);
  return Number.isInteger(value) && value >= 1 && value <= FEEDERS ? value : null;
}

/** A gap and a feeder's number as a setze sends them; null where either is missing or wrong. */
function setting(gap: string | undefined, word: string | undefined): StartupInput | null {
  const value = feederIn(word);
  return gap !== undefined && isGap(gap) && value !== null ? { cmd: 'setze', gap, value } : null;
}

/**
 * The input a typed line sends: `zeige` and `start` alone, `setze` with a gap and a feeder's
 * number, or the script's own `abgang = 2`; npm and whatever follows it, the terminal answers
 * itself; null for any other line.
 */
export function lineOf(line: string): StartupLine {
  const words = wordsIn(line);
  const [first = ''] = words;
  if (first === 'npm') {
    return { npm: true };
  }
  if ((first === 'zeige' || first === 'start') && words.length === 1) {
    return { input: { cmd: first } };
  }
  const input = settingIn(words);
  return input === null ? null : { input };
}

/** A setze in its words — `setze <lücke> <wert>`, or `<lücke> = <wert>` —; null for any other. */
function settingIn(words: readonly string[]): StartupInput | null {
  if (words.length !== 3) {
    return null;
  }
  const [first, second, third] = words;
  if (first === 'setze') {
    return setting(second, third);
  }
  return second === '=' ? setting(first, third) : null;
}

/**
 * `line` with its last word completed, as Tab completes it: the first word to a command, the
 * word after `setze` to one of `gaps`, the gaps of the stage's script — as far as every word it
 * could still become agrees, whole where one alone fits, with the blank after it where a word
 * follows. A line it cannot complete stays as it was.
 */
export function completed(line: string, gaps: readonly StartupGap[]): string {
  const [, before = '', word = ''] = /^(.*?)(\S*)$/s.exec(line) ?? [];
  const fits = wordsAfter(wordsIn(before), gaps).filter((candidate) =>
    candidate.startsWith(word.toLowerCase()),
  );
  const [only] = fits;
  if (only === undefined) {
    return line;
  }
  const blank = only === 'setze' || isGap(only) ? ' ' : '';
  return fits.length > 1 ? `${before}${sharedStart(fits)}` : `${before}${only}${blank}`;
}

/** What the word after `said` may become: a command first, a gap of the script after `setze`. */
function wordsAfter(said: readonly string[], gaps: readonly StartupGap[]): readonly string[] {
  if (said.length === 0) {
    return STARTUP_COMMANDS;
  }
  return said.length === 1 && said[0] === 'setze' ? gaps : [];
}

/** A key of the terminal's bezel: a command, a gap of the script, a feeder's number, or erase. */
export type StartupKey =
  | { cmd: StartupCommand }
  | { gap: StartupGap }
  | { feeder: number }
  | { erase: true };

/**
 * A line with a key's word put in: `zeige` or `start` in place of the line; otherwise a `setze`
 * line, keeping the gap and the number the line names but for the one the key puts in its
 * place — a gap, or a feeder's number —, with the blank after it while the number is still to
 * come. The erase key takes the last character back.
 */
export function withKey(line: string, key: StartupKey): string {
  if ('erase' in key) {
    return line.slice(0, -1);
  }
  if ('cmd' in key && key.cmd !== 'setze') {
    return key.cmd;
  }
  const words = wordsIn(line);
  const gap = 'gap' in key ? key.gap : (words.find(isGap) ?? null);
  const feeder = 'feeder' in key ? key.feeder : feederIn(words.at(-1));
  const parts = ['setze', gap, feeder].filter((part) => part !== null);
  return `${parts.join(' ')}${feeder === null ? ' ' : ''}`;
}
