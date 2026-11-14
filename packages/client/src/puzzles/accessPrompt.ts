import {
  ACCESS_DOORS,
  ACCOUNT_PATTERN,
  TOKEN_DIGITS,
  type AccessDoor,
  type PuzzleInputOf,
} from '@escapelab/core';
import { sharedStart } from './ServersPanel.js';

/**
 * accessPrompt.ts: what the Zugangskontrolle's terminal (AccessPanel.tsx) reads from a line
 * typed at its prompt — a command, or the six digits of a token — what Tab completes there, and
 * what the keys of its bezel put into the line. Pure.
 */

type AccessInput = PuzzleInputOf<'access'>;

/** The terminal's commands, as its keys and its prompt take them. */
export const ACCESS_COMMANDS = ['login', 'status', 'freigeben'] as const;
export type AccessCommand = (typeof ACCESS_COMMANDS)[number];

const isCommand = (word: string): word is AccessCommand =>
  ACCESS_COMMANDS.some((cmd) => cmd === word);
const isDoor = (word: string): word is AccessDoor => ACCESS_DOORS.some((door) => door === word);

/** The words of a command line, lower-cased, the blanks between them dropped. */
const wordsIn = (line: string): string[] =>
  line
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');

const TOKEN = new RegExp(`^\\d{${TOKEN_DIGITS}}$`);

/**
 * A line as a token: its digits, the blanks the device groups them by dropped („405 217" is
 * 405217); null for a line that is not six digits.
 */
export function tokenIn(line: string): string | null {
  const digits = line.replace(/\s+/g, '');
  return TOKEN.test(digits) ? digits : null;
}

/** What a command reads from the word after it, by command; null where it takes none of that. */
const READS: Readonly<Record<AccessCommand, (word: string | undefined) => AccessInput | null>> = {
  status: (word) => (word === undefined ? { cmd: 'status' } : null),
  login: (word) =>
    word !== undefined && ACCOUNT_PATTERN.test(word) ? { cmd: 'login', account: word } : null,
  freigeben: (word) => (word !== undefined && isDoor(word) ? { cmd: 'freigeben', door: word } : null),
};

/**
 * The input a typed line sends: a token, `status`, `login` and an account, `freigeben` and a
 * door; null for a line the terminal cannot read.
 */
export function inputOf(line: string): AccessInput | null {
  const token = tokenIn(line);
  if (token !== null) {
    return { token };
  }
  const [cmd = '', word, ...more] = wordsIn(line);
  return isCommand(cmd) && more.length === 0 ? READS[cmd](word) : null;
}

/**
 * `line` with its last word completed, as Tab completes it: the first word to a command, the
 * word after `freigeben` to one of `doors`, the doors the terminal asks for — as far as every
 * word it could still become agrees, whole where one alone fits, a command that takes a word
 * with the blank after it. An account it never completes: the terminal names none. A line it
 * cannot complete stays as it was.
 */
export function completed(line: string, doors: readonly AccessDoor[]): string {
  const [, before = '', word = ''] = /^(.*?)(\S*)$/s.exec(line) ?? [];
  const said = wordsIn(before);
  const fits = wordsAfter(said, doors).filter((candidate) => candidate.startsWith(word.toLowerCase()));
  const [only] = fits;
  if (only === undefined) {
    return line;
  }
  return fits.length > 1 ? `${before}${sharedStart(fits)}` : `${before}${only}${blankAfter(only)}`;
}

/** What the word after `said` may become: a command first, a door after `freigeben`, else none. */
function wordsAfter(said: readonly string[], doors: readonly AccessDoor[]): readonly string[] {
  if (said.length === 0) {
    return ACCESS_COMMANDS;
  }
  return said.length === 1 && said[0] === 'freigeben' ? doors : [];
}

/** The blank a whole command gets after it where it takes a word: login and freigeben do. */
const blankAfter = (word: string): string => (word === 'login' || word === 'freigeben' ? ' ' : '');

/** A key of the terminal's bezel: a command, a door, a digit, or the one that takes one back. */
export type AccessKey =
  | { cmd: AccessCommand }
  | { door: AccessDoor }
  | { digit: string }
  | { erase: true };

/** Whether a line holds digits so far, or nothing: a token being put together. */
const typingToken = (line: string): boolean => /^[\d\s]*$/.test(line);

/**
 * A command line with a key's word put in: a digit at the end of a token being put together,
 * or starting one; the erase key taking the last character back; a door after `freigeben`; a
 * command in place of the line — `freigeben` keeping the door the line names.
 */
export function withKey(line: string, key: AccessKey): string {
  if ('digit' in key) {
    return typingToken(line) ? `${line}${key.digit}` : key.digit;
  }
  if ('erase' in key) {
    return line.slice(0, -1);
  }
  if ('door' in key) {
    return `freigeben ${key.door}`;
  }
  if (key.cmd === 'freigeben') {
    const door = wordsIn(line).find(isDoor);
    return door === undefined ? 'freigeben ' : `freigeben ${door}`;
  }
  return key.cmd === 'status' ? 'status' : 'login ';
}

/** A token as the device shows it: two groups of three, a blank between. */
export const grouped = (token: string): string => `${token.slice(0, 3)} ${token.slice(3)}`;
