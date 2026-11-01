import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ManualHere, ManualSection, PuzzleView } from '@escapelab/core';
import {
  blockTaken,
  captureAt,
  NotepadContext,
  NotingPlace,
  notedPart,
  ownerOf,
  type Capture,
  type NotableBlock,
  type NotepadHand,
  type Place,
} from '../src/noting.js';
import { paginate } from '../src/pages.js';
import { ServersPanel } from '../src/puzzles/ServersPanel.js';
import { Book } from '../src/screens/Book.js';
import { gameClass, NOTHING_OVER } from '../src/screens/Game.js';
import { Block } from '../src/screens/Manual.js';
import { Notepad } from '../src/screens/Notepad.js';
import { PinnedNote } from '../src/screens/PinnedNote.js';
import { ReadingOverlay } from '../src/screens/Reading.js';
import { mapWith, NO_CLOCK } from './fixtures.js';
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

const CLIPBOARD: Place = { id: 'klemmbrett', name: 'Klemmbrett' };

/** A notepad's hand that keeps what it is handed, and has held one of each key before. */
function hand(): NotepadHand & { noted: Capture[] } {
  const noted: Capture[] = [];
  return {
    noted,
    noteDown: (capture) => {
      const again = noted.some((each) => each.key === capture.key);
      noted.push(capture);
      return again;
    },
    toggle: noop,
  };
}

describe('a printed block as the notepad takes it', () => {
  it('names a part by its heading; among several a list „Regeln", a table its first column', () => {
    const [signal, legend] = MANUAL;
    if (signal === undefined || legend === undefined) {
      throw new Error('the fixture lost a section');
    }
    expect(blockTaken(STATION, MANUAL, legend, LEGEND).part).toBe('Legende');
    expect(blockTaken(STATION, MANUAL, signal, RULES).part).toBe('Signalkette');
    const both: ManualSection = { heading: 'Befehle und Codes', blocks: [LEGEND, RULES] };
    expect(blockTaken(STATION, MANUAL, both, LEGEND).part).toBe('Zeile');
    expect(blockTaken(STATION, MANUAL, both, RULES).part).toBe('Regeln');
  });

  it('names the place it is taken at in its head, and keys it by place, station and part', () => {
    const legend: ManualSection = { heading: 'Legende', blocks: [LEGEND] };
    const taken = blockTaken(STATION, MANUAL, legend, LEGEND);
    expect(captureAt(CLIPBOARD, taken)).toEqual({
      key: 'klemmbrett/2/Legende',
      head: 'Klemmbrett · Legende',
      lines: [
        'Zeile  Pult A  Muster   Pult B  Muster',
        '1      rot     Kreis    gelb    Dreieck',
        '2      blau    Quadrat  rot     Kreis',
      ],
      form: 'table',
    });
    expect(captureAt(null, taken).head).toBe('Legende');
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
      expect(owner?.section.heading).toBe('Tafel');
      expect(notedPart({ index: 0, manual }, part)?.key).toBe(
        part.kind === 'table' ? '0/Zeile' : '0/Regeln',
      );
    }
    const strange = { kind: 'table' as const, head: ['Zeile', 'Wert'], rows: [['9', 'anders']] };
    expect(ownerOf(manual, strange)).toBeNull();
    expect(notedPart({ index: 0, manual }, strange)).toBeNull();
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
      pausedAt={null}
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

  it('hands the notepad the whole block, named for the source it is read at', () => {
    const notepad = hand();
    const elements = elementsOf(
      () => bookOf(clipboard),
      (probe) => (
        <NotepadContext value={notepad}>
          <NotingPlace value={CLIPBOARD}>{probe}</NotingPlace>
        </NotepadContext>
      ),
    );
    const [rules, legend] = buttonsOf(elements, 'note-down');
    press(rules);
    press(legend);
    expect(notepad.noted.map((capture) => capture.head)).toEqual([
      'Klemmbrett · Signalkette',
      'Klemmbrett · Legende',
    ]);
    expect(notepad.noted[0]?.lines).toEqual(['1. Rot zuerst.', '2. Dann blau.', '3. Nie grün.']);
  });

  it('stands by the rules on a terminal’s screen too, named for the source', () => {
    const notepad = hand();
    const terminal: ManualHere = { ...clipboard, kind: 'terminal', label: 'TERMINAL' };
    const overlay = (
      <ReadingOverlay
        manual={terminal}
        puzzle={null}
        current={2}
        mission="Blackout im Labor"
        map={mapWith({})}
        edgework={null}
        pausedAt={null}
        onAskNote={noop}
        onPutDown={noop}
      />
    );
    const elements = elementsOf(
      () => overlay,
      (probe) => (
        <NotepadContext value={notepad}>
          <NotingPlace value={{ id: 'terminal-quelle', name: 'Terminal' }}>{probe}</NotingPlace>
        </NotepadContext>
      ),
    );
    buttonsOf(elements, 'note-down').forEach(press);
    expect(notepad.noted.map((capture) => capture.head)).toEqual([
      'Terminal · Signalkette',
      'Terminal · Legende',
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
  it('sits on the terminal’s bezel and hands the table down as „Terminal · Dienste"', () => {
    const notepad = hand();
    const panel = (
      <ServersPanel
        puzzle={terminalView as Extract<PuzzleView, { kind: 'servers' }>}
        change={null}
        send={noop}
        mission={NO_CLOCK}
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
    expect(notepad.noted).toEqual([
      {
        key: 'terminal/3/dienste',
        head: 'Terminal · Dienste',
        lines: [
          'Dienst  Status      Strom  Braucht',
          'NETZ    RUNNING     AN     —',
          'DNS     FEHLER E23  AN     NETZ',
        ],
        form: 'table',
      },
    ]);
    expect(renderToStaticMarkup(panel)).not.toContain('note-down');
  });
});

describe('„Notieren" at a note of the last shift', () => {
  it('takes the note down word for word under the room it hangs in', () => {
    const notepad = hand();
    const text = 'Drei Tickets wegen der Lüfter, keins bearbeitet. – Admin';
    const elements = elementsOf(
      () => (
        <PinnedNote note={{ index: 1, text }} room="SERVERRAUM" edgework={null} onPutDown={noop} />
      ),
      (probe) => <NotepadContext value={notepad}>{probe}</NotepadContext>,
    );
    press(buttonsOf(elements, 'note-down')[0]);
    expect(notepad.noted).toEqual([
      { key: 'zettel/notiz/1', head: 'Zettel · Serverraum', lines: [text], form: 'text' },
    ]);
  });
});

describe('the notepad beside a source or a device', () => {
  const notes = {
    content: { text: 'Stufe 1', captures: [] },
    change: noop,
    saved: true,
  };

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
