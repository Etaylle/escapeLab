import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Edgework } from '@escapelab/core';
import {
  appendLines,
  edgeworkLines,
  forgetNotes,
  notesKey,
  readNotes,
  writeNotes,
  type NoteStore,
} from '../src/notes.js';
import { Notepad, type Notes } from '../src/screens/Notepad.js';

/** Local storage as far as the notepad uses it, in memory. */
function memoryStore(): NoteStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const edgework: Edgework = {
  serial: 'K7G3A-2',
  indicators: [
    { id: 'FRQ', lit: true },
    { id: 'SIG', lit: false },
    { id: 'CAR', lit: true },
  ],
  cells: 3,
};

describe('notepad persistence', () => {
  it('keeps the text per room and player and finds it again after a reload', () => {
    const store = memoryStore();
    expect(writeNotes(store, notesKey('KX4P', 'p1'), 'Spalte 4')).toBe(true);
    expect(readNotes(store, notesKey('kx4p', 'p1'))).toBe('Spalte 4');
    expect(readNotes(store, notesKey('KX4P', 'p2'))).toBe('');
    expect(readNotes(store, notesKey('QQ22', 'p1'))).toBe('');
  });

  it('forgets a room’s notes when the player leaves it, and only that room’s', () => {
    const store = memoryStore();
    writeNotes(store, notesKey('KX4P', 'p1'), 'hier');
    writeNotes(store, notesKey('QQ22', 'p1'), 'dort');
    forgetNotes(store, 'KX4P', 'p1');
    expect(readNotes(store, notesKey('KX4P', 'p1'))).toBe('');
    expect(readNotes(store, notesKey('QQ22', 'p1'))).toBe('dort');
  });

  it('leaves no entry behind for an emptied pad', () => {
    const store = memoryStore();
    const key = notesKey('KX4P', 'p1');
    writeNotes(store, key, 'weg damit');
    writeNotes(store, key, '');
    expect(store.data.has(key)).toBe(false);
  });

  it('says so when the browser refuses to keep the text', () => {
    const full: NoteStore = {
      ...memoryStore(),
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(writeNotes(full, notesKey('KX4P', 'p1'), 'zu viel')).toBe(false);
  });

  it('takes the Laborkennung over line by line, under the names the rules use', () => {
    expect(edgeworkLines(edgework)).toBe(
      'Laborkennung: K7G3A-2\nKontrollleuchten: FRQ an, SIG aus, CAR an\nNotstromzellen: 3',
    );
  });

  it('adds what it takes over below the text, on lines of its own', () => {
    expect(appendLines('', 'neu')).toBe('neu');
    expect(appendLines('alt', 'neu')).toBe('alt\nneu');
    expect(appendLines('alt\n', 'neu')).toBe('alt\nneu');
  });
});

describe('the notepad', () => {
  const notes = (parts: Partial<Notes> = {}): Notes => ({
    text: 'Stufe 1: Position 2',
    change: () => undefined,
    saved: true,
    ...parts,
  });

  function pad(seen: Edgework | null, parts: Partial<Notes> = {}): string {
    return renderToStaticMarkup(
      <Notepad notes={notes(parts)} edgework={seen} onClose={() => undefined} />,
    );
  }

  it('shows the text and offers the Laborkennung only once the sign was read', () => {
    const before = pad(null);
    expect(before).toContain('>Stufe 1: Position 2</textarea>');
    expect(before).toMatch(/<button class="notepad-take" disabled=""[^>]*>Laborkennung übernehmen/);
    expect(before).not.toContain('K7G3A-2');
    expect(pad(edgework)).toMatch(/<button class="notepad-take">Laborkennung übernehmen/);
  });

  it('warns when the browser keeps nothing', () => {
    expect(pad(null)).not.toContain('notepad-warn');
    expect(pad(null, { saved: false })).toContain('Wird nicht gespeichert');
  });
});
