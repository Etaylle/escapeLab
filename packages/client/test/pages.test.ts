import { describe, expect, it } from 'vitest';
import { MODULES, type ManualBlock, type ManualSection } from '@escapelab/core';
import {
  BOOK_PAGE,
  filled,
  firstPageOf,
  lineCount,
  paginate,
  pagesInView,
  turnFrom,
  type BookPage,
  type BookSection,
  type Fragment,
} from '../src/pages.js';

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
  it('opens with the contents, then every station on a fresh page under its title', () => {
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

  it('repeats the head of a table on every page it spans', () => {
    const head = ['LED', 'Stern', 'Buchstabe'];
    const rows = Array.from({ length: 24 }, (_, i) => ['an', i % 2 === 0 ? 'ja' : 'nein', `${i}`]);
    const pages = paginate([station('§2 — Schalter', [{ kind: 'table', head, rows }])], SMALL);
    const parts = fragmentsOf(pages, 'table') as Extract<Fragment, { kind: 'table' }>[];
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.head === head)).toBe(true);
    expect(parts.flatMap((part) => part.rows)).toEqual(rows);
  });

  it('moves symbol columns and paragraphs on whole', () => {
    const columns: ManualBlock = { kind: 'columns', columns: [['Ω', 'Ж', '☆', '¶']] };
    const text = 'Vier Tasten mit je einem Zeichen. '.repeat(4);
    const pages = paginate([station('§1 — Tasten', [{ kind: 'p', text }, columns])], SMALL);
    expect(pages).toHaveLength(3);
    expect(pages[1]?.fragments.at(-1)).toEqual({ kind: 'p', text });
    expect(pages[2]?.fragments).toEqual([columns]);
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
          if (f.kind === 'title') {
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
