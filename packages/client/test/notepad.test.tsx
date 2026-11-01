import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Edgework } from '@escapelab/core';
import {
  EMPTY_NOTEPAD,
  forgetNotes,
  notepadOf,
  notesKey,
  readNotes,
  withBody,
  withCapture,
  withoutEmpty,
  writeNotes,
  type NotepadContent,
  type NoteStore,
} from '../src/notes.js';
import { captureAt, edgeworkTaken, SIGN, type Capture } from '../src/noting.js';
import { Notepad, type Notes } from '../src/screens/Notepad.js';
import { elementsOf, press } from './probe.js';

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

const legend: Capture = {
  key: 'klemmbrett/2/Legende',
  head: 'Klemmbrett · Legende',
  lines: ['Zeile  Pult A', '1      rot'],
  form: 'table',
};

const terminal: Capture = {
  key: 'terminal/3/dienste',
  head: 'Terminal · Dienste',
  lines: ['Dienst  Status', 'NETZ    RUNNING'],
  form: 'table',
};

const written = (text: string): NotepadContent => ({ text, captures: [] });

describe('notepad persistence', () => {
  it('keeps writing and captures per room and player, and finds them after a reload', () => {
    const store = memoryStore();
    const content = withCapture(written('Spalte 4'), legend).content;
    expect(writeNotes(store, notesKey('KX4P', 'p1'), content)).toBe(true);
    expect(readNotes(store, notesKey('kx4p', 'p1'))).toEqual(content);
    expect(readNotes(store, notesKey('KX4P', 'p2'))).toEqual(EMPTY_NOTEPAD);
    expect(readNotes(store, notesKey('QQ22', 'p1'))).toEqual(EMPTY_NOTEPAD);
  });

  it('reads a pad kept before captures were kept apart as the player’s writing', () => {
    expect(notepadOf('Spalte 4\n\n§3 Signalkette · Legende')).toEqual(
      written('Spalte 4\n\n§3 Signalkette · Legende'),
    );
    expect(notepadOf('42')).toEqual(written('42'));
    expect(notepadOf('{"text":3}')).toEqual(written('{"text":3}'));
    // A capture the pad cannot read is left out, the rest kept.
    const kept = JSON.stringify({
      text: 'a',
      captures: [{ key: 1 }, { ...legend, body: 'x', updated: true }],
    });
    expect(notepadOf(kept).captures.map((each) => each.head)).toEqual(['Klemmbrett · Legende']);
  });

  it('forgets a room’s notes when the player leaves it, and only that room’s', () => {
    const store = memoryStore();
    writeNotes(store, notesKey('KX4P', 'p1'), written('hier'));
    writeNotes(store, notesKey('QQ22', 'p1'), written('dort'));
    forgetNotes(store, 'KX4P', 'p1');
    expect(readNotes(store, notesKey('KX4P', 'p1'))).toEqual(EMPTY_NOTEPAD);
    expect(readNotes(store, notesKey('QQ22', 'p1'))).toEqual(written('dort'));
  });

  it('leaves no entry behind for an emptied pad', () => {
    const store = memoryStore();
    const key = notesKey('KX4P', 'p1');
    writeNotes(store, key, written('weg damit'));
    writeNotes(store, key, EMPTY_NOTEPAD);
    expect(store.data.has(key)).toBe(false);
  });

  it('says so when the browser refuses to keep the pad', () => {
    const full: NoteStore = {
      ...memoryStore(),
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(writeNotes(full, notesKey('KX4P', 'p1'), written('zu viel'))).toBe(false);
  });
});

describe('captures in the notepad', () => {
  it('go down at the bottom, newest last, each under its head', () => {
    const one = withCapture(written('frei'), legend);
    const two = withCapture(one.content, terminal);
    expect([one.replaced, two.replaced]).toEqual([false, false]);
    expect(two.content.text).toBe('frei');
    expect(two.content.captures.map((each) => [each.head, each.body, each.updated])).toEqual([
      ['Klemmbrett · Legende', 'Zeile  Pult A\n1      rot', false],
      ['Terminal · Dienste', 'Dienst  Status\nNETZ    RUNNING', false],
    ]);
  });

  it('replace one of the same taken again, which then stands at the bottom and says so', () => {
    const both = withCapture(withCapture(EMPTY_NOTEPAD, legend).content, terminal).content;
    const again = withCapture(both, { ...legend, lines: ['Zeile  Pult A', '1      blau'] });
    expect(again.replaced).toBe(true);
    expect(again.content.captures.map((each) => [each.head, each.body, each.updated])).toEqual([
      ['Terminal · Dienste', 'Dienst  Status\nNETZ    RUNNING', false],
      ['Klemmbrett · Legende', 'Zeile  Pult A\n1      blau', true],
    ]);
  });

  it('are edited as text, and one wiped is gone', () => {
    const both = withCapture(withCapture(EMPTY_NOTEPAD, legend).content, terminal).content;
    const edited = withBody(both, legend.key, '1  rot!');
    expect(edited.captures[0]?.body).toBe('1  rot!');
    expect(withoutEmpty(edited)).toBe(edited);
    const wiped = withBody(edited, terminal.key, '  \n ');
    expect(withoutEmpty(wiped).captures.map((each) => each.key)).toEqual([legend.key]);
  });

  it('take the Laborkennung from the sign as one line under „Schild · Laborkennung"', () => {
    expect(captureAt(SIGN, edgeworkTaken(edgework))).toEqual({
      key: 'schild/laborkennung',
      head: 'Schild · Laborkennung',
      lines: ['K7G3A-2 · FRQ an, SIG aus, CAR an · 3 Notstromzellen'],
      form: 'text',
    });
  });
});

describe('the notepad', () => {
  const notes = (content: NotepadContent, parts: Partial<Notes> = {}): Notes => ({
    content,
    change: () => undefined,
    saved: true,
    ...parts,
  });

  function pad(seen: Edgework | null, content = written('Stufe 1: Position 2'), saved = true) {
    return renderToStaticMarkup(
      <Notepad notes={notes(content, { saved })} edgework={seen} onClose={() => undefined} />,
    );
  }

  it('shows the writing and offers the Laborkennung only once the sign was read', () => {
    const before = pad(null);
    expect(before).toContain('>Stufe 1: Position 2</textarea>');
    expect(before).toMatch(/<button class="notepad-take" disabled=""[^>]*>Laborkennung übernehmen/);
    expect(before).not.toContain('K7G3A-2');
    expect(pad(edgework)).toMatch(/<button class="notepad-take">Laborkennung übernehmen/);
  });

  it('takes the Laborkennung over as a capture of the sign, at the bottom', () => {
    const changed: NotepadContent[] = [];
    const elements = elementsOf(() => (
      <Notepad
        notes={notes(withCapture(written('frei'), legend).content, {
          change: (next) => changed.push(next),
        })}
        edgework={edgework}
        onClose={() => undefined}
      />
    ));
    press(elements.find((element) => element.props['className'] === 'notepad-take'));
    expect(changed[0]?.captures.map((each) => each.head)).toEqual([
      'Klemmbrett · Legende',
      'Schild · Laborkennung',
    ]);
  });

  it('shows each capture under its head below the writing, one taken again marked', () => {
    const both = withCapture(withCapture(written('frei'), legend).content, terminal).content;
    const html = pad(null, withCapture(both, legend).content);
    expect(html.indexOf('notepad-text')).toBeLessThan(html.indexOf('notepad-capture'));
    expect(html).toContain(
      '<h3 class="notepad-capture-head">Terminal · Dienste</h3>' +
        '<textarea class="notepad-capture-text" aria-label="Terminal · Dienste" rows="2" ' +
        'wrap="off" spellCheck="false">Dienst  Status\nNETZ    RUNNING</textarea>',
    );
    expect(html).toContain(
      '<h3 class="notepad-capture-head">Klemmbrett · Legende' +
        '<span class="notepad-capture-updated"> · aktualisiert</span></h3>',
    );
    expect(html.indexOf('Terminal · Dienste')).toBeLessThan(html.indexOf('Klemmbrett · Legende'));
  });

  it('warns when the browser keeps nothing', () => {
    expect(pad(null)).not.toContain('notepad-warn');
    expect(pad(null, written(''), false)).toContain('Wird nicht gespeichert');
  });
});
