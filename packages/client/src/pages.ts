import type { ManualBlock, ManualSection } from '@escapelab/core';

/**
 * Printed rules laid out as the pages of a book. Page 1 is the cover;
 * every station starts on a fresh page and its blocks flow on from there. A
 * rules list or a table that would break over a page turn moves to the next
 * page whole where it fits there, as KTANE's manual gives a module its page;
 * only one taller than a page breaks between items, two at least to a page —
 * the list repeats its heading „(Fortsetzung)" where it goes on, the table its
 * head on every page it spans. Everything else moves on whole, a drawing
 * together with the block it illustrates, and a heading never ends a page.
 * Seen as a spread, a station opens on a left-hand page where that saves a
 * turn, a blank page before it, so that a station of two pages lies open whole.
 * Heights are estimates in em of the page's body text. styles/book.css draws
 * the page to the same measure at whatever size it is shown, so the same
 * pages come out on every screen at one text size — and every player's page 3
 * at that size is the same page 3. A larger text size sets fewer words on the
 * same sheet (bookPage).
 */

/** One station's part of the book. */
export interface BookSection {
  /** „§n — Titel", heading the station's first page */
  title: string;
  manual: ManualSection[];
  /** the open puzzle adds a plan to its rules here, the size of a block */
  reader: boolean;
}

/**
 * What a page holds, in reading order: a station's title, a heading, the printed blocks — a
 * rules list or a table perhaps only in part — and the open puzzle's plan. A block of a kind
 * core adds later comes along as it is, measured and set as a paragraph.
 */
export type Fragment =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  // `start` numbers the first item as counted over the whole list
  | { kind: 'rules'; items: string[]; start: number }
  | Exclude<ManualBlock, { kind: 'rules' }>
  | { kind: 'reader' };

/** What a block of a kind this client does not know says, as one paragraph: its words in order. */
export function blockText(block: object): string {
  const words: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      words.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    }
  };
  for (const [key, value] of Object.entries(block)) {
    if (key !== 'kind') {
      collect(value);
    }
  }
  return words.join(' ');
}

export interface BookPage {
  /**
   * the station the page belongs to, by index into the sections; null for the cover and for a
   * blank page left before a station that opens a spread
   */
  section: number | null;
  /** opens its station, or is the cover; a blank page is neither */
  first: boolean;
  fragments: Fragment[];
}

/** The text column of a page, in em of its body text. */
export interface PageSize {
  width: number;
  height: number;
}

/**
 * The text column as styles/book.css draws it — `.page-text`, 25.2 × 37 em of
 * a 30 × 42 em sheet, within a book's usual margins — at text size `scale`
 * (settings.ts TEXT_SCALE): the sheet and its margins stay, and the body text
 * grows by `scale`, so the column holds 1/scale as many of its em. Counted
 * 0.6 em narrower: a line that only just fits in print is counted as
 * wrapping, so an estimate errs toward a fuller page rather than one that
 * runs over.
 */
export function bookPage(scale: number): PageSize {
  if (!(scale > 0)) {
    throw new Error(`bookPage: a text size scales by a factor above 0, not ${scale}`);
  }
  return { width: SHEET_COLUMN.width / scale - NARROWER, height: SHEET_COLUMN.height / scale };
}

/** The text column in em of the sheet (book.css `.page-in`), and how much narrower it counts. */
const SHEET_COLUMN = { width: 25.2, height: 37 } as const;
const NARROWER = 0.6;

/** The text column at the normal text size. */
export const BOOK_PAGE: PageSize = bookPage(1);

/**
 * A device drawing keeps its printed width on the page, centred in the
 * column: Figure.tsx draws 376 × 140 units across it, 7 em tall.
 */
export const FIGURE_WIDTH = 18.8;

/** A typeface as set on the page: mean advance of a character and line height, in body em. */
interface Face {
  advance: number;
  line: number;
}

// Advances are set for the widest of the serif faces ui.css may fall back to
// (Georgia), hyphenation off; narrower faces leave a little room at the foot.
const BODY: Face = { advance: 0.52, line: 1.42 };
const TITLE: Face = { advance: 0.76, line: 1.56 };
const HEADING: Face = { advance: 0.62, line: 1.02 };
const CELL: Face = { advance: 0.47, line: 1.1 };
/** A drawing's caption: the body face at 0.8 em. */
const CAPTION: Face = { advance: 0.42, line: 1.14 };
/** An example box's title: mono caps at 0.7 em, spaced 0.16 em apart. */
const LABEL: Face = { advance: 0.54, line: 1 };

/** The rule under a station's title, with the space it keeps. */
const TITLE_RULE = 0.45;
/** Rule items hang their numbers in this indent and stand this far apart. */
const RULE_INDENT = 1.6;
const RULE_GAP = 0.25;
/** A cell's padding left and right, and top and bottom with its border. */
const CELL_SIDES = 0.6;
const CELL_ENDS = 0.42;
/** One symbol of a keypad column, and the column's own padding. */
const GLYPH_ROW = 2.3;
const COLUMNS_PAD = 0.6;
/** The reader's plan is drawn this tall. */
const READER = 13;
/**
 * An example box's padding sideways in all (0.7 a side), and top and bottom
 * together with the space under its title (0.4 + 0.5 + 0.15); its rule is an
 * outline and takes no room. Its lines stand EXAMPLE_GAP apart.
 */
const EXAMPLE_SIDES = 1.4;
const EXAMPLE_ENDS = 1.05;
const EXAMPLE_GAP = 0.2;
/** A device drawing stands 7 em tall (FIGURE_WIDTH); its caption follows 0.2 em below. */
const FIGURE = 7.2;
/** A station's last lines may run this far into the foot of its page rather than open one. */
const OVERRUN = 1.5;

/** Lines a text takes at `chars` characters a line, wrapped between words as a browser does. */
export function lineCount(text: string, chars: number): number {
  let lines = 1;
  // The space before a line's first word is never set.
  let used = -1;
  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    if (used >= 0 && used + 1 + word.length > chars) {
      lines += 1;
      used = -1;
    }
    used += 1 + word.length;
    // A word longer than the line breaks inside itself.
    while (used > chars) {
      lines += 1;
      used -= chars;
    }
  }
  return lines;
}

function textHeight(text: string, width: number, face: Face): number {
  return lineCount(text, Math.max(1, Math.floor(width / face.advance))) * face.line;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Characters each column gets: as many as its longest cell where the table
 * fits, a share of the width by that length where it does not. Taken over
 * the whole table, so every page of it is set alike.
 */
function columnWidths(head: readonly string[], rows: readonly string[][], width: number): number[] {
  const room = (width - head.length * CELL_SIDES) / CELL.advance;
  const longest = head.map((_, i) =>
    Math.max(1, ...[head, ...rows].map((row) => (row[i] ?? '').length)),
  );
  const total = sum(longest);
  return total <= room ? longest : longest.map((n) => Math.max(1, Math.floor((room * n) / total)));
}

function rowHeight(row: readonly string[], widths: readonly number[]): number {
  const lines = Math.max(1, ...row.map((cell, i) => lineCount(cell, widths[i] ?? 1)));
  return lines * CELL.line + CELL_ENDS;
}

function tableHeight(head: string[], rows: string[][], width: number): number {
  const widths = columnWidths(head, rows, width);
  return rowHeight(head, widths) + sum(rows.map((row) => rowHeight(row, widths)));
}

function rulesHeight(items: readonly string[], width: number): number {
  const lines = items.map((item) => textHeight(item, width - RULE_INDENT, BODY));
  return sum(lines) + RULE_GAP * Math.max(0, items.length - 1);
}

/** An example box: its title, then its lines one under another, without numbers. */
function exampleHeight(title: string, lines: readonly string[], width: number): number {
  const inner = width - EXAMPLE_SIDES;
  const text = lines.map((line) => textHeight(line, inner, BODY));
  return (
    EXAMPLE_ENDS +
    textHeight(title, inner, LABEL) +
    sum(text) +
    EXAMPLE_GAP * Math.max(0, lines.length - 1)
  );
}

function heightOf(fragment: Fragment, width: number): number {
  switch (fragment.kind) {
    case 'title':
      return textHeight(fragment.text, width, TITLE) + TITLE_RULE;
    case 'heading':
      return textHeight(fragment.text, width, HEADING);
    case 'p':
      return textHeight(fragment.text, width, BODY);
    case 'rules':
      return rulesHeight(fragment.items, width);
    case 'table':
      return tableHeight(fragment.head, fragment.rows, width);
    case 'columns':
      return Math.max(0, ...fragment.columns.map((c) => c.length)) * GLYPH_ROW + COLUMNS_PAD;
    case 'example':
      return exampleHeight(fragment.title, fragment.lines, width);
    case 'figure':
      return FIGURE + textHeight(fragment.caption, width, CAPTION);
    case 'reader':
      return READER;
    default:
      return textHeight(blockText(fragment), width, BODY);
  }
}

/** Space above a fragment, by what comes before it; a page's first fragment has none. */
function spaceAbove(before: Fragment['kind'], kind: Fragment['kind']): number {
  if (kind === 'heading') {
    return 1;
  }
  if (before === 'title') {
    return 0.8;
  }
  return before === 'heading' ? 0.3 : 0.55;
}

/** What fragments set one after another take, following `before` (null: at the top). */
function costOf(
  fragments: readonly Fragment[],
  before: Fragment['kind'] | null,
  width: number,
): number {
  let last = before;
  let total = 0;
  for (const fragment of fragments) {
    total += (last === null ? 0 : spaceAbove(last, fragment.kind)) + heightOf(fragment, width);
    last = fragment.kind;
  }
  return total;
}

/** How much of the text column a page fills, as estimated, in em. */
export function filled(page: BookPage, size: PageSize = BOOK_PAGE): number {
  return costOf(page.fragments, null, size.width);
}

/** Fills pages one after another, keeping track of the room left on the last. */
class Pager {
  readonly pages: BookPage[] = [];
  private used = 0;
  private last: Fragment['kind'] | null = null;

  constructor(private readonly size: PageSize) {}

  /** A fresh page: a station's first, or a continuation. */
  open(section: number, first: boolean): void {
    this.pages.push({ section, first, fragments: [] });
    this.used = 0;
    this.last = null;
  }

  turn(): void {
    this.open(this.pages.at(-1)?.section ?? 0, false);
  }

  blank(): boolean {
    return this.last === null;
  }

  /** What fragments put together add to the page, after `last` (null: at its top). */
  cost(fragments: readonly Fragment[], last = this.last): number {
    return costOf(fragments, last, this.size.width);
  }

  /** Whether fragments still fit on the page, running `slack` em past its foot at most. */
  fits(fragments: readonly Fragment[], slack = 0): boolean {
    return this.used + this.cost(fragments) <= this.size.height + slack;
  }

  /** Whether fragments would fit on a fresh page, running `slack` em past its foot at most. */
  fitsFresh(fragments: readonly Fragment[], slack = 0): boolean {
    return this.cost(fragments, null) <= this.size.height + slack;
  }

  /**
   * Puts fragments on the page together. If they do not fit but would on a
   * fresh page, they go on the next one; if not even that would hold them,
   * they stay and the page runs over rather than lose a rule.
   */
  put(fragments: readonly Fragment[], slack = 0): void {
    if (fragments.length === 0) {
      return;
    }
    if (!this.blank() && !this.fits(fragments, slack) && this.fitsFresh(fragments)) {
      this.turn();
    }
    const page = this.pages.at(-1);
    if (page === undefined) {
      return;
    }
    this.used += this.cost(fragments);
    page.fragments.push(...fragments);
    this.last = fragments.at(-1)?.kind ?? this.last;
  }
}

/** A block that may break between its units: a rules list's items, a table's rows. */
interface Breakable {
  count: number;
  /** the fragment that holds units from..to-1 */
  part: (from: number, to: number) => Fragment;
  /** what heads every page the block goes on, or moves on to, with nothing else to lead it */
  resumed: Fragment[];
}

/**
 * A block that may break between its units, set after `lead` (a heading, a
 * drawing, waiting for it): whole on this page where it fits, else whole on
 * the next page where it fits there — after `lead`, or where nothing leads it
 * after `resumed` — and only where not even a fresh page holds it, broken
 * (placeSplit). The block that closes its station may run `slack` em longer.
 */
function placeBreakable(pager: Pager, block: Breakable, lead: Fragment[], slack: number): void {
  const { count, part, resumed } = block;
  if (count === 0) {
    pager.put(lead);
    return;
  }
  const whole = part(0, count);
  if (pager.fits([...lead, whole], slack)) {
    pager.put([...lead, whole], slack);
    return;
  }
  const opening = lead.length > 0 ? lead : resumed;
  if (!pager.blank() && pager.fitsFresh([...opening, whole], slack)) {
    pager.turn();
    pager.put([...opening, whole], slack);
    return;
  }
  placeSplit(pager, count, part, lead, resumed, slack);
}

/**
 * A block taller than a page, broken between its `count` units, `part(from,
 * to)` being the fragment that holds units from..to-1. Each page takes as
 * many units as fit, the first of them together with `lead` and every later
 * page's first with `resumed`. A page holds two units at least, so neither the
 * first nor the last unit stands alone; the page that would take the last
 * unit may run `slack` em longer.
 */
function placeSplit(
  pager: Pager,
  count: number,
  part: (from: number, to: number) => Fragment,
  lead: Fragment[],
  resumed: Fragment[],
  slack: number,
): void {
  const least = Math.min(2, count);
  const slackTo = (to: number): number => (to === count ? slack : 0);
  let from = 0;
  let before = lead;
  while (from < count) {
    let to = from;
    while (to < count && pager.fits([...before, part(from, to + 1)], slackTo(to + 1))) {
      to += 1;
    }
    if (count > 1 && to === count - 1) {
      to -= 1;
    }
    if (to - from < least) {
      if (!pager.blank()) {
        pager.turn();
        continue;
      }
      // Not even a fresh page holds them: it runs over rather than part them.
      to = from + least === count - 1 ? count : from + least;
    }
    pager.put([...before, part(from, to)], slackTo(to));
    before = resumed;
    from = to;
    if (from < count) {
      pager.turn();
    }
  }
}

function place(
  pager: Pager,
  block: ManualBlock,
  heading: string,
  lead: Fragment[],
  slack: number,
): void {
  switch (block.kind) {
    case 'rules':
      placeBreakable(
        pager,
        {
          count: block.items.length,
          part: (from, to) => ({
            kind: 'rules',
            items: block.items.slice(from, to),
            start: from + 1,
          }),
          resumed: [{ kind: 'heading', text: `${heading} (Fortsetzung)` }],
        },
        lead,
        slack,
      );
      return;
    case 'table':
      placeBreakable(
        pager,
        {
          count: block.rows.length,
          part: (from, to) => ({
            kind: 'table',
            head: block.head,
            rows: block.rows.slice(from, to),
          }),
          resumed: [],
        },
        lead,
        slack,
      );
      return;
    default:
      if (lead.some((f) => f.kind === 'figure') && !pager.fitsFresh([...lead, block], slack)) {
        // Not even a fresh page holds the drawing and the block together: one after the other.
        pager.put(lead);
        pager.put([block], slack);
        return;
      }
      pager.put([...lead, block], slack);
  }
}

/**
 * One station's pages, from a fresh page of its own: its title, a reader's
 * plan right under it, so it is on the page the bookmark opens, then its
 * printed parts. The title, the plan, a heading and a drawing wait for the
 * block after them and go with it — a drawing only within its part — so
 * none of them ends a page; the station's last block may run a little long
 * rather than leave a line or two alone on a page.
 */
function stationPages(section: BookSection, index: number, size: PageSize): BookPage[] {
  const pager = new Pager(size);
  pager.open(index, true);
  let lead: Fragment[] = [{ kind: 'title', text: section.title }];
  if (section.reader) {
    lead.push({ kind: 'reader' });
  }
  section.manual.forEach((part, p) => {
    lead = [...lead, { kind: 'heading', text: part.heading }];
    part.blocks.forEach((block, b) => {
      if (block.kind === 'figure' && b < part.blocks.length - 1) {
        lead = [...lead, block];
        return;
      }
      const closing = p === section.manual.length - 1 && b === part.blocks.length - 1;
      place(pager, block, part.heading, lead, closing ? OVERRUN : 0);
      lead = [];
    });
  });
  pager.put(lead);
  return pager.pages;
}

/** How the book lies open: two pages side by side, odd ones on the left, or one at a time. */
export interface Opening {
  spread: boolean;
}

/** What a reader consults while the station is worked: its rules, tables, symbols and plan. */
const LAW: ReadonlySet<Fragment['kind']> = new Set(['rules', 'table', 'columns', 'reader']);

/**
 * How many spreads a station's pages at `offsets` (0 for its first page) lie in, opening on a
 * left-hand page (`shift` 0) or a right-hand one (1).
 */
function spreadsOf(offsets: readonly number[], shift: 0 | 1): number {
  return new Set(offsets.map((i) => Math.floor((i + shift) / 2))).size;
}

/**
 * The side a station's pages lie open best from: the one that shows its rules
 * in fewer spreads — two tables read together face each other — or, where
 * that is alike, the whole station in fewer; null where both lie alike.
 */
function bestSide(own: readonly BookPage[]): 'left' | 'right' | null {
  const all = own.map((_, i) => i);
  const law = all.filter((i) => own[i]?.fragments.some((f) => LAW.has(f.kind)) === true);
  for (const offsets of [law, all]) {
    const [left, right] = [spreadsOf(offsets, 0), spreadsOf(offsets, 1)];
    if (left !== right) {
      return left < right ? 'left' : 'right';
    }
  }
  return null;
}

/**
 * The book's pages at text column `size`: the cover, then each station from
 * a fresh page. Seen as a spread, a station opens on the side its pages lie
 * open best from (bestSide) — a station of two pages lies open whole — a
 * blank page before it where the next page is on the other side.
 */
export function paginate(
  sections: readonly BookSection[],
  size: PageSize = BOOK_PAGE,
  { spread }: Opening = { spread: false },
): BookPage[] {
  const pages: BookPage[] = [{ section: null, first: true, fragments: [] }];
  sections.forEach((section, index) => {
    const own = stationPages(section, index, size);
    // The next page is a left-hand one, odd, while the book so far has an even count of pages.
    const next = pages.length % 2 === 0 ? 'left' : 'right';
    const side = spread ? bestSide(own) : null;
    if (side !== null && side !== next) {
      pages.push({ section: null, first: false, fragments: [] });
    }
    pages.push(...own);
  });
  return pages;
}

/** The page a section starts on, numbered from 1 like the book; null when it has none. */
export function firstPageOf(pages: readonly BookPage[], section: number): number | null {
  const index = pages.findIndex((page) => page.section === section && page.first);
  return index < 0 ? null : index + 1;
}

/**
 * The page a book opens at: where the bookmark lies — the first page of
 * `marked`, the section that is up now — if the book has it; a book of a
 * single section opens on that section, past the cover; any other on the
 * cover, whose contents lead on from there.
 */
export function openingPage(pages: readonly BookPage[], marked: number | null): number {
  const sections = new Set(pages.flatMap((page) => (page.section === null ? [] : [page.section])));
  const only = sections.size === 1 ? [...sections][0] : undefined;
  const at = marked ?? only ?? null;
  return (at === null ? null : firstPageOf(pages, at)) ?? 1;
}

/** The first page in view: `page` itself, or the left page of the spread holding it. */
function viewStart(page: number, spread: boolean): number {
  return spread && page % 2 === 0 ? page - 1 : page;
}

/** The pages in view: `page` alone, or the spread holding it, odd pages on the left. */
export function pagesInView(page: number, spread: boolean): number[] {
  const start = viewStart(page, spread);
  return spread ? [start, start + 1] : [start];
}

/** Where one turn forwards (1) or back (-1) leads from `page`; null past either end. */
export function turnFrom(page: number, total: number, spread: boolean, dir: 1 | -1): number | null {
  const next = viewStart(page, spread) + dir * (spread ? 2 : 1);
  return next >= 1 && next <= total ? next : null;
}

/**
 * A leaf in the middle of a turn: the pages lying open beneath it and the
 * pages on its two faces. In a spread it turns over the spine — forwards
 * from right to left, back from left to right — lifting `front` off the
 * view it leaves and landing `back` in the view it opens. Alone, a page is
 * lifted away (forwards) or laid down (back): `front` is that page, and
 * there is no `back`.
 */
export interface Leaf {
  dir: 1 | -1;
  /** the pages open beneath the leaf, left to right */
  under: number[];
  front: number;
  back: number | null;
}

/**
 * The leaf that turns from the view holding page `from` to the one holding
 * `to`; null when both are in the same view. Once it lies still, the book
 * shows exactly `pagesInView(to)`.
 */
export function leafFor(from: number, to: number, spread: boolean): Leaf | null {
  const leaving = viewStart(from, spread);
  const arriving = viewStart(to, spread);
  if (leaving === arriving) {
    return null;
  }
  const dir = arriving > leaving ? 1 : -1;
  if (!spread) {
    return dir === 1
      ? { dir, under: [arriving], front: leaving, back: null }
      : { dir, under: [leaving], front: arriving, back: null };
  }
  return dir === 1
    ? { dir, under: [leaving, arriving + 1], front: leaving + 1, back: arriving }
    : { dir, under: [arriving, leaving + 1], front: leaving, back: arriving + 1 };
}
