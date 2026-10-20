import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODULES, type ManualBlock, type ManualSection } from '@escapelab/core';
import {
  BOOK_PAGE,
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
 * sheet 30 em across, the text column between the margins as tall as it
 * counts and a little wider — so a line that only just fits is counted as
 * two, and a page never runs over for it.
 */
describe('the page as book.css draws it', () => {
  const sheet = readFileSync(new URL('../src/styles/book.css', import.meta.url), 'utf8');
  /** The em values of a declaration in the first rule `selector` opens. */
  function ems(selector: string, property: string): number[] {
    const from = sheet.indexOf(`${selector} {`);
    if (from < 0) {
      throw new Error(`book.css has no rule "${selector}"`);
    }
    const rule = sheet.slice(from, sheet.indexOf('}', from));
    const value = new RegExp(`\\n  ${property}: ([^;]+);`).exec(rule)?.[1] ?? '';
    return [...value.matchAll(/([\d.]+)em/g)].map((m) => Number(m[1]));
  }

  it('sets one text column between a gutter of 1.8 em and an outer margin of 3', () => {
    const [column = 0] = ems('.page-in', 'grid-template-columns');
    const [top = 0, outer = 0, bottom = 0, gutter = 0] = ems('.page-in', 'padding');
    expect([gutter, column, outer]).toEqual([1.8, 25.2, 3]);
    expect(gutter + column + outer).toBeCloseTo(30, 9);
    expect(42 - top - bottom).toBeCloseTo(BOOK_PAGE.height, 9);
    // A left-hand page mirrors it: the gutter on its right.
    expect(ems('.page-left .page-in', 'padding')).toEqual([top, gutter, bottom, outer]);
  });

  it('counts the column a little narrower than it is drawn, never wider', () => {
    const [column = 0] = ems('.page-in', 'grid-template-columns');
    const slack = column - BOOK_PAGE.width;
    expect(slack).toBeGreaterThan(0);
    expect(slack).toBeLessThanOrEqual(0.6 + 1e-9);
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
