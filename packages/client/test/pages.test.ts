import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MODULES,
  moduleFor,
  PATTERN_FIGURE,
  puzzleDefSchema,
  type ManualBlock,
  type ManualSection,
} from '@escapelab/core';
import { TEXT_SCALE } from '../src/settings.js';
import {
  BOOK_PAGE,
  bookPage,
  FIGURE_WIDTH,
  filled,
  firstPageOf,
  leafFor,
  lineCount,
  openingPage,
  paginate,
  pagesInView,
  turnFrom,
  type BookPage,
  type BookSection,
  type Fragment,
  type Leaf,
} from '../src/pages.js';
import { FIGURE_VIEW } from '../src/screens/Figure.js';

/** A small page, so a few blocks already need several of them. */
const SMALL = { width: 20, height: 12 };

function station(title: string, blocks: ManualBlock[], reader = false): BookSection {
  return { title, manual: [{ heading: title.toUpperCase(), blocks }], reader };
}

function items(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Regel ${i + 1}: wenn das gilt, dann jenes.`);
}

function fragmentsOf(pages: BookPage[], kind: Fragment['kind']): Fragment[] {
  return pages.flatMap((page) => page.fragments.filter((f) => f.kind === kind));
}

describe('paginate', () => {
  it('opens with the cover, then every station on a fresh page under its title', () => {
    const pages = paginate([
      station('§1 — Kabel', [{ kind: 'p', text: 'Rot zuerst.' }]),
      station('§3 — Netz', [{ kind: 'p', text: 'Wände zeigt der Plan.' }]),
    ]);
    expect(pages.map((page) => [page.section, page.first])).toEqual([
      [null, true],
      [0, true],
      [1, true],
    ]);
    expect(pages[0]?.fragments).toEqual([]);
    expect(pages[2]?.fragments).toEqual([
      { kind: 'title', text: '§3 — Netz' },
      { kind: 'heading', text: '§3 — NETZ' },
      { kind: 'p', text: 'Wände zeigt der Plan.' },
    ]);
    expect(firstPageOf(pages, 1)).toBe(3);
    expect(firstPageOf(pages, 2)).toBeNull();
  });

  it('breaks a rules list between items, numbering on, and loses none', () => {
    const all = items(14);
    const pages = paginate([station('§1 — Lang', [{ kind: 'rules', items: all }])], SMALL);
    const parts = fragmentsOf(pages, 'rules') as Extract<Fragment, { kind: 'rules' }>[];
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.flatMap((part) => part.items)).toEqual(all);
    parts.forEach((part, i) => {
      const before = parts[i - 1];
      expect(part.start).toBe(before === undefined ? 1 : before.start + before.items.length);
    });
    expect(pages.slice(1).every((page) => page.section === 0)).toBe(true);
    expect(pages.slice(2).every((page) => !page.first)).toBe(true);
  });

  it('heads every page a rules list continues on with its heading and „(Fortsetzung)"', () => {
    const pages = paginate([station('§1 — Lang', [{ kind: 'rules', items: items(14) }])], SMALL);
    expect(pages[1]?.fragments.slice(0, 2)).toEqual([
      { kind: 'title', text: '§1 — Lang' },
      { kind: 'heading', text: '§1 — LANG' },
    ]);
    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages.slice(2)) {
      expect(page.fragments[0]).toEqual({ kind: 'heading', text: '§1 — LANG (Fortsetzung)' });
      expect(page.fragments[1]?.kind).toBe('rules');
    }
  });

  it('never leaves the last rule — the „Sonst" line — alone on a page', () => {
    // Five of the six fit under the title: the fifth goes over with the sixth.
    const book = [station('§1 — Knapp', [{ kind: 'rules', items: items(6) }])];
    const parts = fragmentsOf(paginate(book, { width: 20, height: 12.5 }), 'rules');
    expect(parts.map((part) => (part.kind === 'rules' ? part.items.length : 0))).toEqual([4, 2]);
  });

  it('keeps two rules together on every page a list spans, wherever the list starts', () => {
    for (let height = 6; height <= 24; height += 1) {
      for (let count = 2; count <= 9; count += 1) {
        const lead: ManualBlock = { kind: 'p', text: 'Vorab etwas Text. '.repeat(height % 7) };
        const book = [station('§1 — Knapp', [lead, { kind: 'rules', items: items(count) }])];
        const parts = fragmentsOf(paginate(book, { width: 20, height }), 'rules') as Extract<
          Fragment,
          { kind: 'rules' }
        >[];
        expect(parts.flatMap((part) => part.items)).toEqual(items(count));
        expect(parts.every((part) => part.items.length >= 2)).toBe(true);
      }
    }
  });

  it('repeats the head of a table on every page it spans', () => {
    const head = ['LED', 'Stern', 'Buchstabe'];
    const rows = Array.from({ length: 24 }, (_, i) => ['an', i % 2 === 0 ? 'ja' : 'nein', `${i}`]);
    const pages = paginate([station('§2 — Schalter', [{ kind: 'table', head, rows }])], SMALL);
    const parts = fragmentsOf(pages, 'table') as Extract<Fragment, { kind: 'table' }>[];
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.head === head)).toBe(true);
    expect(parts.flatMap((part) => part.rows)).toEqual(rows);
    expect(fragmentsOf(pages, 'heading')).toHaveLength(1);
  });

  it('moves symbol columns and paragraphs on whole', () => {
    const columns: ManualBlock = { kind: 'columns', columns: [['Ω', 'Ж', '☆', '¶']] };
    const text = 'Vier Tasten mit je einem Zeichen. '.repeat(4);
    const pages = paginate([station('§1 — Tasten', [{ kind: 'p', text }, columns])], SMALL);
    expect(pages).toHaveLength(3);
    expect(pages[1]?.fragments.at(-1)).toEqual({ kind: 'p', text });
    expect(pages[2]?.fragments).toEqual([columns]);
  });

  it('moves an example box and a device drawing on whole, each taking its room', () => {
    const drawing: ManualBlock = { kind: 'figure', of: 'wiring', caption: 'Abb. 1: der Kasten' };
    const worked: ManualBlock = {
      kind: 'example',
      title: 'Beispiel',
      lines: ['rot, blau, blau', 'Regel 4 greift', 'Kabel 3 trennen'],
    };
    const pages = paginate([station('§1 — Kabel', [drawing, worked])], SMALL);
    const kinds = pages.map((page) => page.fragments.map((f) => f.kind));
    expect(fragmentsOf(pages, 'figure')).toHaveLength(1);
    expect(fragmentsOf(pages, 'example')).toHaveLength(1);
    // The drawing fills most of the small page: the example box gets the next one, whole.
    const drawn = kinds.findIndex((page) => page.includes('figure'));
    expect(kinds[drawn]).not.toContain('example');
    expect(kinds[drawn + 1]).toEqual(['example']);
  });

  it('sets a station printed as a manual within its pages, the drawing under its heading', () => {
    const drawing: ManualBlock = {
      kind: 'figure',
      of: 'wiring',
      caption: 'Abb. 1 — Sicherungskasten',
    };
    const worked: ManualBlock = {
      kind: 'example',
      title: 'Beispiel',
      lines: [
        'Gesehen: rot, blau, blau.',
        'Liste 3 Kabel, Regel 4: erstes Kabel ist nicht blau — Regel 5 gilt.',
        'Getrennt: das letzte Kabel, Nr. 3.',
      ],
    };
    const device: ManualBlock = {
      kind: 'p',
      text: 'Ein Sicherungskasten mit 3 bis 6 Kabeln. '.repeat(3),
    };
    const penalty: ManualBlock = { kind: 'p', text: 'Fehlgriff: Alarm, −20 s.' };
    for (let count = 2; count <= 30; count += 4) {
      const manual: ManualSection[] = [
        { heading: 'Notstrom-Brücken', blocks: [drawing, device] },
        {
          heading: `${count} Kabel`,
          blocks: [{ kind: 'rules', items: items(count) }, worked, penalty],
        },
      ];
      const pages = paginate([{ title: '§1 — Notstrom', manual, reader: false }]);
      expect(pages[1]?.fragments.slice(0, 3)).toEqual([
        { kind: 'title', text: '§1 — Notstrom' },
        { kind: 'heading', text: 'Notstrom-Brücken' },
        drawing,
      ]);
      expect(fragmentsOf(pages, 'example')).toEqual([worked]);
      expect(pages.at(-1)?.fragments.at(-1)).toEqual(penalty);
      pages.slice(1).forEach((page, i) => {
        const room = i === pages.length - 2 ? BOOK_PAGE.height + 1.5 : BOOK_PAGE.height;
        expect(filled(page)).toBeLessThanOrEqual(room);
      });
    }
  });

  it('never ends a page on a heading: it moves on with what it heads', () => {
    // Room is left for the heading, not for the heading and a first rule.
    const text = 'Ein Absatz, der fast die ganze Seite füllt. '.repeat(2);
    const manual: ManualSection[] = [
      { heading: 'Erst', blocks: [{ kind: 'p', text }] },
      { heading: 'Dann', blocks: [{ kind: 'rules', items: items(8) }] },
    ];
    const pages = paginate([{ title: '§1 — Zwei', manual, reader: false }], SMALL);
    expect(pages[1]?.fragments.at(-1)).toEqual({ kind: 'p', text });
    expect(pages[2]?.fragments[0]).toEqual({ kind: 'heading', text: 'Dann' });
    expect(pages.every((page) => page.fragments.at(-1)?.kind !== 'heading')).toBe(true);
  });

  it('puts the open puzzle’s plan right under the station’s title', () => {
    const pages = paginate([station('§5 — Netz', [{ kind: 'rules', items: items(2) }], true)]);
    expect(pages[1]?.fragments.map((f) => f.kind)).toEqual(['title', 'reader', 'heading', 'rules']);
  });

  it('lets a station’s last lines run a little long rather than open a page for them', () => {
    const book = [station('§1 — Knapp', [{ kind: 'rules', items: items(6) }])];
    const long = paginate(book, { width: 20, height: 14 });
    expect(long).toHaveLength(2);
    expect(filled(long[1]!, { width: 20, height: 14 })).toBeGreaterThan(14);
    const tooLong = paginate(book, { width: 20, height: 12 });
    expect(tooLong).toHaveLength(3);
    expect(tooLong.slice(1).every((page) => page.fragments.length > 0)).toBe(true);
  });

  it('runs a page over with a block taller than any page instead of turning for ever', () => {
    const text = 'Sehr lang. '.repeat(200);
    const pages = paginate([station('§1 — Wand', [{ kind: 'p', text }])], SMALL);
    expect(pages).toHaveLength(2);
    expect(pages[1]?.fragments.at(-1)).toEqual({ kind: 'p', text });
    expect(filled(pages[1]!, SMALL)).toBeGreaterThan(SMALL.height);
  });

  it('sets every module’s printed rules whole, in order, within the page', () => {
    const sections = MODULES.flatMap((module) => {
      const def = module.defSchema.safeParse({ type: module.type, id: module.type, title: 'X' });
      const manual = def.success ? module.manual(def.data as never) : null;
      return manual === null ? [] : [{ title: `§1 — ${module.type}`, manual, reader: false }];
    });
    expect(sections.length).toBeGreaterThan(8);
    const pages = paginate(sections);
    sections.forEach((section, index) => {
      const own = pages.filter((page) => page.section === index);
      const units = own.flatMap((page) =>
        page.fragments.flatMap((f): unknown[] => {
          if (f.kind === 'title' || (f.kind === 'heading' && f.text.endsWith('(Fortsetzung)'))) {
            return [];
          }
          return f.kind === 'rules' ? f.items : f.kind === 'table' ? f.rows : [f];
        }),
      );
      const printed = section.manual.flatMap((part): unknown[] => [
        { kind: 'heading', text: part.heading },
        ...part.blocks.flatMap((b): unknown[] =>
          b.kind === 'rules' ? b.items : b.kind === 'table' ? b.rows : [b],
        ),
      ]);
      expect(units).toEqual(printed);
      own.forEach((page, i) => {
        const room = i === own.length - 1 ? BOOK_PAGE.height + 1.5 : BOOK_PAGE.height;
        expect(filled(page)).toBeLessThanOrEqual(room);
        expect(page.fragments.length).toBeGreaterThan(0);
      });
    });
  });

  it('sets the Signalkette’s legend, its key of patterns drawn, within the page', () => {
    const signal = moduleFor('signal');
    const def = signal.defSchema.parse({
      type: 'signal',
      id: 'kette',
      title: 'Signalkette',
      legend: true,
      fleetingFrom: 3,
    });
    for (const reader of [false, true]) {
      const manual = signal.manual(def as never);
      const pages = paginate([{ title: '§2 — Signalkette', manual, reader }]);
      const own = pages.filter((page) => page.section === 0);
      const fragments = own.flatMap((page) => page.fragments);
      expect(fragments.flatMap((f) => (f.kind === 'figure' ? [f.of] : []))).toEqual([
        'signal',
        PATTERN_FIGURE,
      ]);
      expect(fragments.flatMap((f) => (f.kind === 'table' ? f.rows : []))).toHaveLength(4);
      own.forEach((page, i) => {
        const room = i === own.length - 1 ? BOOK_PAGE.height + 1.5 : BOOK_PAGE.height;
        expect(filled(page), `reader ${reader}, page ${i + 1}`).toBeLessThanOrEqual(room);
      });
    }
  });
});

/**
 * The heights ui.css gives a drawing and an example box on a book's page, in
 * em of its body text (section „worked examples, device drawings and the
 * page foot"), against what the pager counts: never less, so no page runs
 * over, and no more than a hair.
 */
describe('drawings and example boxes as ui.css sets them', () => {
  /** The body face: 1.42 em a line (`.page-in`). */
  const BODY_LINE = 1.42;

  function alone(fragment: Fragment): number {
    return filled({ section: 0, first: false, fragments: [fragment] });
  }

  function close(counted: number, css: number): void {
    expect(counted).toBeGreaterThanOrEqual(css);
    expect(counted - css).toBeLessThan(0.01);
  }

  it('counts a drawing 7 em tall in the column, its caption 0.2 em under it', () => {
    // Figure.tsx draws 376 × 140 units across its 18.8 em, centred in the column.
    const drawn = (FIGURE_WIDTH * FIGURE_VIEW.height) / FIGURE_VIEW.width;
    expect(drawn).toBeCloseTo(7, 9);
    expect(FIGURE_WIDTH).toBeLessThan(BOOK_PAGE.width);
    // The caption: 0.8 em of the body face, its margin 0.25 of its own em.
    const caption = 0.8 * BODY_LINE;
    const gap = 0.25 * 0.8;
    const short = alone({ kind: 'figure', of: 'wiring', caption: 'Abb. 1 — Sicherungskasten' });
    close(short, drawn + gap + caption);
    const wrapped = `Abb. 1 — ${'Kasten '.repeat(9)}`;
    close(alone({ kind: 'figure', of: 'wiring', caption: wrapped }), drawn + gap + 2 * caption);
  });

  it('counts an example box as its padding, its title, its lines and nothing for its rule', () => {
    // Padding 0.4 em above, 0.5 below; the title 0.7 em mono, the lines 0.15 em under it
    // and 0.2 em apart; the rule is an outline and takes no room.
    const title = 0.7 * BODY_LINE;
    const box = (lines: number, rows: number): number =>
      0.4 + title + 0.15 + rows * BODY_LINE + 0.2 * (lines - 1) + 0.5;
    const example = (...lines: string[]): Fragment => ({
      kind: 'example',
      title: 'Beispiel',
      lines,
    });
    close(alone(example('Gesehen: rot.', 'Getrennt: Nr. 2.')), box(2, 2));
    // The padding takes 0.7 em a side: 23.2 em of the body face hold 44 characters a line.
    close(alone(example('x'.repeat(44))), box(1, 1));
    close(alone(example('x'.repeat(45))), box(1, 2));
  });
});

/**
 * The page as styles/book.css draws it, against what the pager counts: the
 * sheet 30 of its em across, the text column between the margins as tall as
 * it counts and a little wider — so a line that only just fits is counted as
 * two, and a page never runs over for it — at every text size, the text set
 * in the sheet's em times the size.
 */
describe('the page as book.css draws it', () => {
  const sheet = readFileSync(new URL('../src/styles/book.css', import.meta.url), 'utf8');
  /** A declaration in the first rule `selector` opens, as written. */
  function declared(selector: string, property: string): string {
    const from = sheet.indexOf(`${selector} {`);
    if (from < 0) {
      throw new Error(`book.css has no rule "${selector}"`);
    }
    const rule = sheet.slice(from, sheet.indexOf('}', from));
    return (new RegExp(`\\n  ${property}: ([^;]+);`).exec(rule)?.[1] ?? '').replace(/\s+/g, ' ');
  }
  /** The sheet's em a declaration counts: every `calc(n * var(--sheet-em))` in it, in order. */
  function sheetEms(selector: string, property: string): number[] {
    const value = declared(selector, property);
    return [...value.matchAll(/calc\(([\d.]+) \* var\(--sheet-em\)\)/g)].map((m) => Number(m[1]));
  }
  const [column = 0] = sheetEms('.page-in', 'grid-template-columns');
  const [top = 0, outer = 0, bottom = 0, gutter = 0] = sheetEms('.page-in', 'padding');

  it('sets one text column between a gutter of 1.8 sheet em and an outer margin of 3', () => {
    expect([gutter, column, outer]).toEqual([1.8, 25.2, 3]);
    expect(gutter + column + outer).toBeCloseTo(30, 9);
    expect(42 - top - bottom).toBeCloseTo(BOOK_PAGE.height, 9);
    // A left-hand page mirrors it: the gutter on its right.
    expect(sheetEms('.page-left .page-in', 'padding')).toEqual([top, gutter, bottom, outer]);
  });

  it('measures the sheet in a thirtieth of its width, the text in that times the text size', () => {
    expect(declared('.page-in', '--sheet-em')).toBe('calc(100cqw / 30)');
    expect(declared('.page-in', 'font-size')).toBe('calc(var(--sheet-em) * var(--text-scale))');
    // The book's frame is paper: the text size leaves the stack, the tabs and the slip alone.
    expect(declared('.book-leaves', 'font-size')).toBe('calc(var(--sheet-h) / 42)');
  });

  it('counts the column a little narrower than it is drawn at every text size, never wider', () => {
    for (const scale of Object.values(TEXT_SCALE)) {
      // The sheet's column holds column / scale of the text's em.
      const slack = column / scale - bookPage(scale).width;
      expect(slack, `at ${scale}`).toBeGreaterThan(0);
      expect(slack, `at ${scale}`).toBeLessThanOrEqual(0.6 + 1e-9);
      expect((42 - top - bottom) / scale).toBeCloseTo(bookPage(scale).height, 9);
    }
  });
});

describe('bookPage', () => {
  it('counts the normal text size’s column, and fewer of the text’s em at a larger size', () => {
    expect(BOOK_PAGE.width).toBeCloseTo(24.6, 9);
    expect(BOOK_PAGE.height).toBe(37);
    expect(bookPage(1.15).width).toBeCloseTo(25.2 / 1.15 - 0.6, 9);
    expect(bookPage(1.15).height).toBeCloseTo(37 / 1.15, 9);
    expect(bookPage(0.9).width).toBeGreaterThan(BOOK_PAGE.width);
    expect(bookPage(0.9).height).toBeGreaterThan(BOOK_PAGE.height);
  });

  it('refuses a size that is no factor above 0', () => {
    for (const scale of [0, -1, Number.NaN]) {
      expect(() => bookPage(scale)).toThrow(/factor above 0/);
    }
  });
});

describe('a table or a rules list that would break over a page turn', () => {
  const half = 'Ein Absatz, der die Seite gut zur Hälfte füllt. ';
  const lead: ManualBlock = { kind: 'p', text: half.repeat(3) };
  const rows = Array.from({ length: 5 }, (_, i) => [`Zeile ${i + 1}`, 'an', 'aus']);
  const table: ManualBlock = { kind: 'table', head: ['Name', 'Links', 'Rechts'], rows };

  it('moves to the next page whole, under its heading, where it fits there', () => {
    const manual: ManualSection[] = [
      { heading: 'Vorab', blocks: [lead] },
      { heading: 'Tafel', blocks: [table] },
    ];
    const pages = paginate([{ title: '§1 — Tafel', manual, reader: false }], SMALL);
    expect(pages[1]?.fragments.at(-1)).toEqual(lead);
    expect(pages[2]?.fragments).toEqual([{ kind: 'heading', text: 'Tafel' }, { ...table }]);
  });

  it('moves a list on whole under its heading „(Fortsetzung)" where it follows a block', () => {
    const manual: ManualSection[] = [
      { heading: 'Regeln', blocks: [lead, { kind: 'rules', items: items(4) }] },
    ];
    const pages = paginate([{ title: '§1 — Regeln', manual, reader: false }], SMALL);
    expect(pages[2]?.fragments).toEqual([
      { kind: 'heading', text: 'Regeln (Fortsetzung)' },
      { kind: 'rules', items: items(4), start: 1 },
    ]);
  });

  it('still breaks where not even a fresh page holds it', () => {
    const long: ManualBlock = { ...table, rows: [...rows, ...rows, ...rows] };
    const manual: ManualSection[] = [{ heading: 'Tafel', blocks: [lead, long] }];
    const pages = paginate([{ title: '§1 — Tafel', manual, reader: false }], SMALL);
    const parts = fragmentsOf(pages, 'table') as Extract<Fragment, { kind: 'table' }>[];
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flatMap((part) => part.rows)).toEqual(long.rows);
  });
});

describe('a drawing', () => {
  const drawing: ManualBlock = { kind: 'figure', of: 'wiring', caption: 'Abb. 1 — Kasten' };
  // One line under the title: the drawing alone would still fit on that page.
  const lead: ManualBlock = { kind: 'p', text: 'Ein Absatz über dem Aufbau.' };
  const page = { width: 20, height: 16 };

  it('stays with the paragraph after it, onto the next page', () => {
    const text: ManualBlock = { kind: 'p', text: 'Pult A ist der Kasten. '.repeat(4) };
    const manual: ManualSection[] = [{ heading: 'Aufbau', blocks: [lead, drawing, text] }];
    const pages = paginate([{ title: '§1 — Kasten', manual, reader: false }], page);
    expect(pages[1]?.fragments.at(-1)).toEqual(lead);
    expect(pages[2]?.fragments).toEqual([drawing, text]);
  });

  it('stays with the table after it, the table whole', () => {
    const rows = Array.from({ length: 2 }, (_, i) => [`${i + 1}`, 'rot']);
    const table: ManualBlock = { kind: 'table', head: ['Nr.', 'Farbe'], rows };
    const manual: ManualSection[] = [
      { heading: 'Aufbau', blocks: [lead] },
      { heading: 'Legende', blocks: [drawing, table] },
      { heading: 'Werkstatt', blocks: [lead] },
    ];
    const pages = paginate([{ title: '§1 — Kasten', manual, reader: false }], {
      width: 20,
      height: 20,
    });
    const kinds = pages.map((p) => p.fragments.map((f) => f.kind));
    expect(kinds[1]).toEqual(['title', 'heading', 'p']);
    expect(kinds[2]?.slice(0, 3)).toEqual(['heading', 'figure', 'table']);
  });

  it('goes first where not even a fresh page holds it together with the block after it', () => {
    // The paragraph fills most of a page on its own.
    const wall: ManualBlock = { kind: 'p', text: 'Sehr viel Text. '.repeat(19) };
    const manual: ManualSection[] = [{ heading: 'Aufbau', blocks: [drawing, wall] }];
    const pages = paginate([{ title: '§1 — Kasten', manual, reader: false }], page);
    const kinds = pages.map((p) => p.fragments.map((f) => f.kind));
    expect(kinds.slice(1)).toEqual([['title', 'heading', 'figure'], ['p']]);
  });
});

describe('a book lying open as a spread', () => {
  // Four rules under the title, four more on the next page.
  const short = station('§1 — Kurz', [{ kind: 'rules', items: items(8) }]);

  it('opens a station of two pages on a left-hand page, a blank page before it', () => {
    const one = paginate([short], SMALL, { spread: false });
    expect(one.filter((page) => page.section === 0)).toHaveLength(2);
    const two = paginate([short], SMALL, { spread: true });
    expect(two.map((page) => [page.section, page.first])).toEqual([
      [null, true],
      [null, false],
      [0, true],
      [0, false],
    ]);
    expect(two[1]?.fragments).toEqual([]);
    expect(pagesInView(firstPageOf(two, 0) ?? 0, true)).toEqual([3, 4]);
    expect(openingPage(two, null)).toBe(3);
  });

  it('leaves no page blank where the book lies open one page at a time', () => {
    const pages = paginate([short, short, short], SMALL);
    expect(pages.slice(1).every((page) => page.section !== null)).toBe(true);
  });

  it('opens a station of three pages where it stands, both sides alike', () => {
    // Three paragraphs, each with most of a page to itself.
    const text: ManualBlock = { kind: 'p', text: 'Noch ein Absatz. '.repeat(11) };
    const three = station('§1 — Drei', [text, text, text]);
    const pages = paginate([three], SMALL, { spread: true });
    expect(pages.filter((page) => page.section === 0)).toHaveLength(3);
    expect(firstPageOf(pages, 0)).toBe(2);
  });
});

/** A Blackout station's printed rules, as its module prints them for its def in the mission. */
function blackout(id: string, index: number): BookSection {
  const mission = JSON.parse(
    readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8'),
  ) as { puzzles: { id: string }[] };
  const raw = mission.puzzles.find((puzzle) => puzzle.id === id);
  if (raw === undefined) {
    throw new Error(`blackout.json has no puzzle "${id}"`);
  }
  const def = puzzleDefSchema.parse(raw);
  const manual = moduleFor(def.type).manual(def as never);
  return { title: `§${index + 1} — ${def.title}`, manual, reader: false };
}

/** The tables of `pages` whose head starts with `first`, as set: one per page they stand on. */
function tablesHeaded(pages: readonly BookPage[], first: string): number[] {
  return pages.flatMap((page, i) =>
    page.fragments.some((f) => f.kind === 'table' && f.head[0] === first) ? [i + 1] : [],
  );
}

describe('Blackout’s manuals at every text size, a page at a time and as a spread', () => {
  const frequenz = blackout('frequenz', 4);
  const serverraum = blackout('subsysteme', 3);
  const signal = blackout('signalkette', 2);
  const notstrom = blackout('notstrom', 1);
  const cases = Object.values(TEXT_SCALE).flatMap((scale) =>
    [false, true].map((spread) => ({ scale, spread, size: bookPage(scale) })),
  );

  it.each(cases)('sets the Morsetafel and Frequenztabelle whole, at $scale', ({ size, spread }) => {
    const pages = paginate([frequenz], size, { spread });
    const tables = fragmentsOf(pages, 'table') as Extract<Fragment, { kind: 'table' }>[];
    expect(tables.map((table) => [table.head[0], table.rows.length])).toEqual([
      ['Buchstabe', 13],
      ['Wort', 16],
    ]);
    if (spread) {
      // Read together, the two tables lie open together.
      const [morse = 0] = tablesHeaded(pages, 'Buchstabe');
      const [words = 0] = tablesHeaded(pages, 'Wort');
      expect(pagesInView(morse, true)).toContain(words);
    }
  });

  it.each(cases)('sets the Serverraum’s tables and rules whole, at $scale', ({ size, spread }) => {
    const pages = paginate([serverraum], size, { spread });
    const tables = fragmentsOf(pages, 'table') as Extract<Fragment, { kind: 'table' }>[];
    expect(tables.map((table) => [table.head[0], table.rows.length])).toEqual([
      ['Dienst', 6],
      ['Befehl am Terminal', 3],
      ['Code', 4],
    ]);
    const rules = fragmentsOf(pages, 'rules') as Extract<Fragment, { kind: 'rules' }>[];
    expect(rules.map((list) => [list.start, list.items.length])).toEqual([[1, 6]]);
  });

  it.each(cases)('keeps the Signalkette’s key with its legend, at $scale', ({ size, spread }) => {
    const pages = paginate([signal], size, { spread });
    const legend = pages.find((page) => page.fragments.some((f) => f.kind === 'table'));
    const kinds = legend?.fragments.map((f) => (f.kind === 'figure' ? f.of : f.kind)) ?? [];
    expect(kinds.slice(-3)).toEqual(['heading', PATTERN_FIGURE, 'table']);
    const rows = fragmentsOf(pages, 'table').flatMap((t) => (t.kind === 'table' ? t.rows : []));
    expect(rows).toHaveLength(4);
  });

  it.each(cases)('fills no page past its foot, at $scale', ({ size, spread }) => {
    for (const section of [notstrom, signal, serverraum, frequenz]) {
      const pages = paginate([section], size, { spread });
      const own = pages.filter((page) => page.section === 0);
      own.forEach((page, i) => {
        const room = i === own.length - 1 ? size.height + 1.5 : size.height;
        expect(filled(page, size), `${section.title}, page ${i + 1}`).toBeLessThanOrEqual(room);
      });
    }
  });
});

describe('lineCount', () => {
  it('wraps between words, as many as fit on a line', () => {
    expect(lineCount('ab cd ef', 5)).toBe(2);
    expect(lineCount('ab cd ef', 8)).toBe(1);
    expect(lineCount('  ab   cd  ', 5)).toBe(1);
  });

  it('breaks a word longer than a line inside itself', () => {
    expect(lineCount('Notstromzellen', 5)).toBe(3);
    expect(lineCount('ab Notstromzellen', 5)).toBe(4);
  });
});

describe('opening the book', () => {
  const one = paginate([station('§2 — Kabel', [{ kind: 'p', text: 'Rot zuerst.' }])]);
  const three = paginate([
    station('§1 — Kabel', [{ kind: 'p', text: 'Rot zuerst.' }]),
    station('§3 — Netz', [{ kind: 'rules', items: items(30) }]),
    station('§5 — Frequenz', [{ kind: 'p', text: 'Langsam drehen.' }]),
  ]);

  it('opens where the bookmark lies: the first page of the station that is up', () => {
    expect(openingPage(three, 2)).toBe(firstPageOf(three, 2));
    expect(openingPage(three, 2)).toBeGreaterThan(3);
    expect(openingPage(one, 0)).toBe(2);
  });

  it('opens a book of one station on it, past the cover; any other on the cover', () => {
    expect(openingPage(one, null)).toBe(2);
    expect(openingPage(three, null)).toBe(1);
    expect(openingPage(paginate([]), null)).toBe(1);
  });
});

/** The pages open while a leaf lifts, as they lay before the turn. */
function before(leaf: Leaf, spread: boolean): number[] {
  if (!spread) {
    return leaf.dir === 1 ? [leaf.front] : leaf.under;
  }
  return leaf.dir === 1 ? [leaf.under[0]!, leaf.front] : [leaf.front, leaf.under[1]!];
}

/** The pages open once the leaf lies still. */
function after(leaf: Leaf, spread: boolean): number[] {
  if (!spread) {
    return leaf.dir === 1 ? leaf.under : [leaf.front];
  }
  return leaf.dir === 1 ? [leaf.back!, leaf.under[1]!] : [leaf.under[0]!, leaf.back!];
}

describe('a turning leaf', () => {
  it('turns a spread over the spine: the right page forwards, the left one back', () => {
    expect(leafFor(1, 3, true)).toEqual({ dir: 1, under: [1, 4], front: 2, back: 3 });
    expect(leafFor(4, 2, true)).toEqual({ dir: -1, under: [1, 4], front: 3, back: 2 });
    // The contents or a tab jump: one leaf all the same.
    expect(leafFor(2, 7, true)).toEqual({ dir: 1, under: [1, 8], front: 2, back: 7 });
  });

  it('lifts a page alone away going forwards, and lays the one before down going back', () => {
    expect(leafFor(2, 3, false)).toEqual({ dir: 1, under: [3], front: 2, back: null });
    expect(leafFor(3, 2, false)).toEqual({ dir: -1, under: [3], front: 2, back: null });
  });

  it('turns nothing within one view', () => {
    expect(leafFor(1, 2, true)).toBeNull();
    expect(leafFor(4, 4, false)).toBeNull();
  });

  it('starts from the view it leaves and lands on exactly the one turnFrom leads to', () => {
    for (const spread of [false, true]) {
      for (let page = 1; page <= 9; page += 1) {
        for (const dir of [1, -1] as const) {
          const to = turnFrom(page, 9, spread, dir);
          const leaf = to === null ? null : leafFor(page, to, spread);
          if (to === null || leaf === null) {
            expect(to).toBeNull();
            continue;
          }
          expect(leaf.dir).toBe(dir);
          expect(before(leaf, spread)).toEqual(pagesInView(page, spread));
          expect(after(leaf, spread)).toEqual(pagesInView(to, spread));
        }
      }
    }
  });
});

describe('turning pages', () => {
  it('shows one page, or the spread holding it with odd pages on the left', () => {
    expect(pagesInView(4, false)).toEqual([4]);
    expect(pagesInView(1, true)).toEqual([1, 2]);
    expect(pagesInView(2, true)).toEqual([1, 2]);
    expect(pagesInView(5, true)).toEqual([5, 6]);
  });

  it('turns a page alone or a whole spread, and not past either end', () => {
    expect(turnFrom(2, 5, false, 1)).toBe(3);
    expect(turnFrom(2, 5, false, -1)).toBe(1);
    expect(turnFrom(1, 5, false, -1)).toBeNull();
    expect(turnFrom(5, 5, false, 1)).toBeNull();
    expect(turnFrom(2, 5, true, 1)).toBe(3);
    expect(turnFrom(4, 5, true, -1)).toBe(1);
    expect(turnFrom(5, 5, true, 1)).toBeNull();
    expect(turnFrom(3, 4, true, 1)).toBeNull();
  });
});
