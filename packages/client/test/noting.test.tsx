import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ManualHere, ManualSection, PuzzleView } from '@escapelab/core';
import { appendBlock } from '../src/notes.js';
import {
  NotepadContext,
  notedHead,
  notedPart,
  notedText,
  ownerOf,
  type NotableBlock,
  type NotepadHand,
} from '../src/noting.js';
import { paginate } from '../src/pages.js';
import { ServersPanel, terminalTable } from '../src/puzzles/ServersPanel.js';
import { Book } from '../src/screens/Book.js';
import { gameClass, NOTHING_OVER } from '../src/screens/Game.js';
import { Block } from '../src/screens/Manual.js';
import { Notepad } from '../src/screens/Notepad.js';
import { ReadingOverlay } from '../src/screens/Reading.js';
import { mapWith } from './fixtures.js';
import { buttonsOf, elementsOf, press } from './probe.js';

const noop = (): void => undefined;

/** The Signalkette's legend as a clipboard prints it: a row number, then each console's sign. */
const LEGEND: NotableBlock = {
  kind: 'table',
  head: ['Zeile', 'Pult A', 'Muster', 'Pult B', 'Muster'],
  rows: [
    ['1', 'rot', 'Kreis', 'gelb', 'Dreieck'],
    ['2', 'blau', 'Quadrat', 'rot', 'Kreis'],
  ],
};

const RULES: NotableBlock = { kind: 'rules', items: ['Rot zuerst.', 'Dann blau.', 'Nie grün.'] };

/** A station's rules: the device and its rules, then a legend under a heading of its own. */
const MANUAL: ManualSection[] = [
  {
    heading: 'Signalkette',
    blocks: [
      { kind: 'p', text: 'Zwei Pulte.' },
      RULES,
      { kind: 'figure', of: 'signal', caption: 'Abb. 1' },
    ],
  },
  { heading: 'Legende', blocks: [LEGEND] },
];

const STATION = { index: 2, title: 'Signalkette' };

/** A notepad's hand that keeps what it is handed. */
function hand(): NotepadHand & { noted: string[] } {
  const noted: string[] = [];
  return { noted, noteDown: (text) => noted.push(text), toggle: noop };
}

describe('a block taken down into the notepad', () => {
  it('opens with the station and the part of its rules, the part left out where it repeats', () => {
    expect(notedHead(STATION, 'Legende')).toBe('§3 Signalkette · Legende');
    expect(notedHead(STATION, 'Signalkette')).toBe('§3 Signalkette');
    expect(notedHead(STATION, null)).toBe('§3 Signalkette');
  });

  it('writes a table as its columns once and a line a row: „Zeile 1: rot · …"', () => {
    expect(notedText('§3 Signalkette · Legende', LEGEND)).toBe(
      [
        '§3 Signalkette · Legende',
        'Spalten: Pult A · Muster · Pult B · Muster',
        'Zeile 1: rot · Kreis · gelb · Dreieck',
        'Zeile 2: blau · Quadrat · rot · Kreis',
      ].join('\n'),
    );
    // A table that does not number its rows is numbered from 1.
    const codes: NotableBlock = {
      kind: 'table',
      head: ['Code', 'Bedeutung'],
      rows: [['E11', 'Absturz']],
    };
    expect(notedText('§4 Serverraum', codes)).toBe(
      '§4 Serverraum\nSpalten: Code · Bedeutung\nZeile 1: E11 · Absturz',
    );
  });

  it('writes a rules list numbered as printed', () => {
    expect(notedText('§3 Signalkette', RULES)).toBe(
      '§3 Signalkette\n1. Rot zuerst.\n2. Dann blau.\n3. Nie grün.',
    );
  });

  it('notes the whole of a table or a list from any page it runs over', () => {
    const rows = Array.from({ length: 60 }, (_, i) => [String(i + 1), `Wert ${i + 1}`]);
    const long: NotableBlock = { kind: 'table', head: ['Zeile', 'Wert'], rows };
    const items = Array.from({ length: 40 }, (_, i) => `Regel Nummer ${i + 1}, recht lang gesagt.`);
    const list: NotableBlock = { kind: 'rules', items };
    const manual: ManualSection[] = [{ heading: 'Tafel', blocks: [list, long] }];
    const pages = paginate([{ title: '§1 — Tafel', manual, reader: false }]);
    const parts = pages.flatMap((page) =>
      page.fragments.filter((f) => f.kind === 'table' || f.kind === 'rules'),
    );
    expect(parts.filter((part) => part.kind === 'table').length).toBeGreaterThan(1);
    expect(parts.filter((part) => part.kind === 'rules').length).toBeGreaterThan(1);
    for (const part of parts) {
      if (part.kind !== 'table' && part.kind !== 'rules') {
        continue;
      }
      const owner = ownerOf(manual, part);
      expect(owner?.block).toBe(part.kind === 'table' ? long : list);
      expect(owner?.heading).toBe('Tafel');
    }
    const strange = { kind: 'table' as const, head: ['Zeile', 'Wert'], rows: [['9', 'anders']] };
    expect(ownerOf(manual, strange)).toBeNull();
    expect(notedPart({ index: 0, title: 'Tafel', manual }, strange)).toBeNull();
  });

  it('goes below what is written, an empty line between', () => {
    expect(appendBlock('', 'neu')).toBe('neu');
    expect(appendBlock('alt', 'neu')).toBe('alt\n\nneu');
    expect(appendBlock('alt\n\n\n', 'neu')).toBe('alt\n\nneu');
    expect(appendBlock('  \n', 'neu')).toBe('neu');
  });
});

/** The station's rules bound as a book, as the clipboard sets them one sheet at a time. */
const clipboard: ManualHere = {
  id: 'klemmbrett',
  label: 'KLEMMBRETT',
  kind: 'clipboard',
  sections: [
    {
      puzzleId: 'kette',
      index: 2,
      title: 'Signalkette',
      manual: MANUAL,
      notes: [],
      noteReadyAt: null,
      notesLeft: 0,
      costSec: 20,
    },
  ],
};

function bookOf(manual: ManualHere) {
  return (
    <Book
      manual={manual}
      puzzle={null}
      current={2}
      spread={false}
      binding="clip"
      imprint={{ mission: 'Blackout im Labor', room: 'FLUR' }}
      onAskNote={noop}
    />
  );
}

describe('„Notieren" at a source', () => {
  it('stands by every rules list and table of the page, and by nothing else', () => {
    const html = renderToStaticMarkup(
      <NotepadContext value={hand()}>{bookOf(clipboard)}</NotepadContext>,
    );
    expect(html.match(/class="note-down"/g)).toHaveLength(2);
    expect(html).toContain('<div class="noted"><button type="button" class="note-down"');
    expect(html).toContain('<span class="note-down-word">Notieren</span>');
  });

  it('is nowhere a notepad is not within reach: the page as it always was', () => {
    const html = renderToStaticMarkup(bookOf(clipboard));
    expect(html).not.toContain('note-down');
    expect(html).not.toContain('class="noted"');
  });

  it('hands the notepad the whole block under the station it belongs to', () => {
    const notepad = hand();
    const elements = elementsOf(
      () => bookOf(clipboard),
      (probe) => <NotepadContext value={notepad}>{probe}</NotepadContext>,
    );
    const [rules, legend] = buttonsOf(elements, 'note-down');
    press(rules);
    press(legend);
    expect(notepad.noted).toEqual([
      notedText('§3 Signalkette', RULES),
      notedText('§3 Signalkette · Legende', LEGEND),
    ]);
  });

  it('stands by the rules on a terminal’s screen too, named for the station', () => {
    const notepad = hand();
    const terminal: ManualHere = { ...clipboard, kind: 'terminal' };
    const overlay = (
      <ReadingOverlay
        manual={terminal}
        puzzle={null}
        current={2}
        mission="Blackout im Labor"
        map={mapWith({})}
        edgework={null}
        onAskNote={noop}
        onPutDown={noop}
      />
    );
    const elements = elementsOf(
      () => overlay,
      (probe) => <NotepadContext value={notepad}>{probe}</NotepadContext>,
    );
    buttonsOf(elements, 'note-down').forEach(press);
    expect(notepad.noted).toEqual([
      notedText('§3 Signalkette', RULES),
      notedText('§3 Signalkette · Legende', LEGEND),
    ]);
  });

  it('takes nothing down from a paragraph or a block of a kind this client does not know', () => {
    const notepad = hand();
    const strange = { kind: 'log', lines: ['23:41 Pult A zeigt rot.'] } as unknown as NotableBlock;
    const html = renderToStaticMarkup(
      <NotepadContext value={notepad}>
        <Block block={{ kind: 'p', text: 'Zwei Pulte.' }} noted={null} />
        <Block block={strange} noted={null} />
      </NotepadContext>,
    );
    expect(html).toBe('<p>Zwei Pulte.</p><p>23:41 Pult A zeigt rot.</p>');
  });
});

/** The Serverraum's terminal as its operator sees it: two services, one down. */
const terminalView: PuzzleView = {
  kind: 'servers',
  role: 'terminal',
  rows: [
    { service: 'netz', running: true, code: null, power: true },
    { service: 'dns', running: false, code: 'E23', power: true },
  ],
  log: [],
  rack: null,
  index: 3,
  total: 6,
  title: 'Serverraum',
  manual: null,
  console: 'a',
  backup: null,
} as unknown as PuzzleView;

describe('„Notieren" at the Serverraum terminal', () => {
  it('takes the code table down as it stands, a row a service, with what each needs', () => {
    const rows = terminalView.kind === 'servers' ? (terminalView.rows ?? []) : [];
    expect(notedText(notedHead(terminalView, 'Terminal'), terminalTable(rows))).toBe(
      [
        '§4 Serverraum · Terminal',
        'Spalten: Dienst · Status · Strom · Braucht',
        'Zeile 1: NETZ · RUNNING · AN · —',
        'Zeile 2: DNS · FEHLER E23 · AN · NETZ',
      ].join('\n'),
    );
  });

  it('sits on the terminal’s bezel in the game, and hands the table to the notepad', () => {
    const notepad = hand();
    const panel = (
      <ServersPanel
        puzzle={terminalView as Extract<PuzzleView, { kind: 'servers' }>}
        change={null}
        send={noop}
        deadlineAt={null}
        crew={{ you: 'p1', mates: [] }}
      />
    );
    const elements = elementsOf(
      () => panel,
      (probe) => <NotepadContext value={notepad}>{probe}</NotepadContext>,
    );
    const [button] = buttonsOf(elements, 'note-down');
    expect(button?.props['type']).toBe('button');
    press(button);
    expect(notepad.noted[0]).toMatch(/^§4 Serverraum · Terminal\nSpalten: Dienst · Status · Strom/);
    expect(renderToStaticMarkup(panel)).not.toContain('note-down');
  });
});

describe('the notepad beside a source or a device', () => {
  const notes = { text: 'Stufe 1', change: noop, saved: true };

  it('is put away by a word, not a window’s ✕', () => {
    const html = renderToStaticMarkup(<Notepad notes={notes} edgework={null} onClose={noop} />);
    expect(html).toContain('<button class="notepad-close" title="Weglegen [N]">Weglegen</button>');
    expect(html).not.toContain('✕');
  });

  it('stays open as what lies over the world is put away, beside the next one too', () => {
    const reading = { operating: false, readingId: 'buch', noteIndex: null, notes: true };
    expect({ ...reading, ...NOTHING_OVER }).toEqual({ ...reading, readingId: null });
    expect(NOTHING_OVER).not.toHaveProperty('notes');
  });

  it('stands as a strip of its own while something lies over the world, in a run only', () => {
    expect(gameClass(null, true)).toBe('game game--noting');
    expect(gameClass(null, false)).toBe('game');
    expect(gameClass({ ending: 'won', since: 0 } as never, false)).toBe(
      'game game--finale game--won',
    );
  });

  const css = readFileSync(new URL('../src/styles/putdown.css', import.meta.url), 'utf8');
  /** The rules of the first block opened by `header`, from `from` on. */
  const rulesOf = (header: string, from = 0): string => {
    const start = css.indexOf(header, from);
    return start === -1 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  };

  it('takes the right third beside a source or a device, which keeps the rest', () => {
    expect(css).toMatch(/--note-strip: clamp\(260px, 33\.333vw, 520px\);/);
    expect(rulesOf('.game--noting .puzzle-modal:not(.relay-modal) {')).toMatch(
      /right: var\(--note-strip\);/,
    );
    const strip = rulesOf('.game--noting .notepad {');
    expect(strip).toMatch(/position: fixed;/);
    expect(strip).toMatch(/right: 0;/);
    expect(strip).toMatch(/width: var\(--note-strip\);/);
  });

  it('comes up from the bottom as a drawer on a phone, the page above it', () => {
    const phone = css.indexOf('@media (max-width: 560px)');
    expect(phone).toBeGreaterThan(-1);
    expect(rulesOf('.game--noting .puzzle-modal:not(.relay-modal) {', phone)).toMatch(
      /bottom: var\(--note-drawer\);/,
    );
    const drawer = rulesOf('.game--noting .notepad {', phone);
    expect(drawer).toMatch(/top: auto;/);
    expect(drawer).toMatch(/height: var\(--note-drawer\);/);
  });
});
