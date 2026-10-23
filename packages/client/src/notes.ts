import type { Edgework } from '@escapelab/core';

/**
 * The notepad's text lives in the browser, one entry per room and player: a
 * reload mid-run keeps it, leaving the room forgets it.
 */

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

export function readNotes(store: NoteStore, key: string): string {
  return store.getItem(key) ?? '';
}

/** Keeps the text; false when the browser refuses it (storage full or switched off). */
export function writeNotes(store: NoteStore, key: string, text: string): boolean {
  try {
    if (text === '') {
      store.removeItem(key);
    } else {
      store.setItem(key, text);
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

/** The Laborkennung as the notepad takes it over, under the names the rules use. */
export function edgeworkLines(edgework: Edgework): string {
  const lamps = edgework.indicators.map((i) => `${i.id} ${i.lit ? 'an' : 'aus'}`).join(', ');
  return [
    `Laborkennung: ${edgework.serial}`,
    `Kontrollleuchten: ${lamps}`,
    `Notstromzellen: ${edgework.cells}`,
  ].join('\n');
}

/** `text` with `lines` added below it, on lines of their own. */
export function appendLines(text: string, lines: string): string {
  if (text === '' || text.endsWith('\n')) {
    return `${text}${lines}`;
  }
  return `${text}\n${lines}`;
}

/** `text` with a noted block (noting.ts) below it, an empty line between the two. */
export function appendBlock(text: string, block: string): string {
  const kept = text.replace(/\s+$/, '');
  return kept === '' ? block : `${kept}\n\n${block}`;
}
