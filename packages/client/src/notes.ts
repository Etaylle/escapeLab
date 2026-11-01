import type { Capture, CaptureForm } from './noting.js';

/**
 * What the notepad holds — the player's own writing and the captures taken at sources, the
 * terminal, the sign and the notes of the last shift (noting.ts) — lives in the browser, one
 * entry per room and player: a reload mid-run keeps it, leaving the room forgets it.
 */

/** A capture in the notepad: where it came from and what, and its lines as the player has them. */
export interface NoteCapture {
  /** what tells it from the others: a capture of the same replaces it */
  key: string;
  /** „Klemmbrett · Legende" */
  head: string;
  /** its lines under the head, one text, as the player may have changed them */
  body: string;
  form: CaptureForm;
  /** taken again over an earlier one of the same */
  updated: boolean;
}

/** What the notepad holds: the player's own writing, and under it the captures, newest last. */
export interface NotepadContent {
  text: string;
  captures: NoteCapture[];
}

export const EMPTY_NOTEPAD: NotepadContent = { text: '', captures: [] };

/**
 * `content` with `capture` taken down at the bottom, newest last: a capture of the same key goes
 * from where it stood, and the new one says it was taken again („aktualisiert"). Whether it
 * replaced one.
 */
export function withCapture(
  content: NotepadContent,
  capture: Capture,
): { content: NotepadContent; replaced: boolean } {
  const replaced = content.captures.some((each) => each.key === capture.key);
  const taken: NoteCapture = {
    key: capture.key,
    head: capture.head,
    body: capture.lines.join('\n'),
    form: capture.form,
    updated: replaced,
  };
  const kept = content.captures.filter((each) => each.key !== capture.key);
  return { content: { ...content, captures: [...kept, taken] }, replaced };
}

/** `content` with the capture of `key` holding `body` now, as the player wrote it. */
export function withBody(content: NotepadContent, key: string, body: string): NotepadContent {
  const captures = content.captures.map((each) => (each.key === key ? { ...each, body } : each));
  return { ...content, captures };
}

/** `content` without the captures the player emptied: a capture wiped is a capture crossed out. */
export function withoutEmpty(content: NotepadContent): NotepadContent {
  const captures = content.captures.filter((each) => each.body.trim() !== '');
  return captures.length === content.captures.length ? content : { ...content, captures };
}

/** The part of the Web Storage API the notepad needs. */
export type NoteStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function notesKey(roomCode: string, playerId: string): string {
  return `escapelab-notes:${roomCode.toUpperCase()}:${playerId}`;
}

/** The browser's local storage; null where the browser does not let the page have it. */
export function localStore(): NoteStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stored capture as it was kept; null for anything that is none. */
function captureOf(value: unknown): NoteCapture | null {
  if (!isRecord(value)) {
    return null;
  }
  const { key, head, body, form, updated } = value;
  const texts = [key, head, body].every((part) => typeof part === 'string');
  if (!texts || (form !== 'table' && form !== 'text')) {
    return null;
  }
  const strings = { key: String(key), head: String(head), body: String(body) };
  return { ...strings, form, updated: updated === true };
}

/**
 * The notepad as kept: its writing and its captures — or, kept by a page before captures were
 * kept apart, all of it as the player's writing.
 */
export function notepadOf(kept: string): NotepadContent {
  let value: unknown = null;
  try {
    value = JSON.parse(kept);
  } catch {
    return { text: kept, captures: [] };
  }
  if (!isRecord(value) || typeof value['text'] !== 'string' || !Array.isArray(value['captures'])) {
    return { text: kept, captures: [] };
  }
  const captures = value['captures'].map(captureOf);
  return {
    text: value['text'],
    captures: captures.filter((each): each is NoteCapture => each !== null),
  };
}

export function readNotes(store: NoteStore, key: string): NotepadContent {
  const kept = store.getItem(key);
  return kept === null ? EMPTY_NOTEPAD : notepadOf(kept);
}

/** Keeps the notepad; false when the browser refuses it (storage full or switched off). */
export function writeNotes(store: NoteStore, key: string, content: NotepadContent): boolean {
  try {
    if (content.text === '' && content.captures.length === 0) {
      store.removeItem(key);
    } else {
      store.setItem(key, JSON.stringify(content));
    }
    return true;
  } catch {
    return false;
  }
}

/** Forgets what this player noted in this room. */
export function forgetNotes(store: NoteStore, roomCode: string, playerId: string): void {
  store.removeItem(notesKey(roomCode, playerId));
}
