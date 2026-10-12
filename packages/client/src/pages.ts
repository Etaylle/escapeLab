import type { ManualBlock, ManualSection } from '@escapelab/core';

/**
 * Printed rules laid out as the pages of a book. Page 1 is the contents;
 * every station starts on a fresh page and its blocks flow on from there: a
 * rules list or a table breaks between items, two at least to a page — the
 * list repeats its heading „(Fortsetzung)" where it goes on, the table its
 * head on every page it spans — everything else moves on whole, and a heading
 * never ends a page.
 * Heights are estimates in em of the page's body text. ui.css draws the page
 * to the same measure at whatever size it is shown, so the same pages come
 * out on every screen — and every player's page 3 is the same page 3.
 */

/** One station's part of the book. */
export interface BookSection {
  /** „§n — Titel", heading the station's first page */
  title: string;
  manual: ManualSection[];
  /** the open puzzle adds a plan to its rules here, the size of a block */
  reader: boolean;
}

/** What a page holds, in reading order. */
export type Fragment =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'p'; text: string }
  // `start` numbers the first item as counted over the whole list
  | { kind: 'rules'; items: string[]; start: number }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'columns'; columns: string[][] }
  | { kind: 'reader' };

export interface BookPage {
  /** the station the page belongs to, by index into the sections; null for the contents */
  section: number | null;
  /** opens its station, or is the contents */
  first: boolean;
  fragments: Fragment[];
}

/** The text column of a page, in em of its body text. */
export interface PageSize {
  width: number;
  height: number;
}

/** The text column as ui.css draws it (`.page-text` on a 30 × 42 em sheet). */
export const BOOK_PAGE: PageSize = { width: 18.8, height: 37 };

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
    case 'reader':
      return READER;
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

  /** A fresh page: a station's first, a continuation, or the contents (null). */
  open(section: number | null, first: boolean): void {
    this.pages.push({ section, first, fragments: [] });
    this.used = 0;
    this.last = null;
  }

  turn(): void {
    this.open(this.pages.at(-1)?.section ?? null, false);
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

  /**
   * Puts fragments on the page together. If they do not fit but would on a
   * fresh page, they go on the next one; if not even that would hold them,
   * they stay and the page runs over rather than lose a rule.
   */
  put(fragments: readonly Fragment[], slack = 0): void {
    if (fragments.length === 0) {
      return;
    }
    const fresh = this.cost(fragments, null) <= this.size.height;
    if (!this.blank() && !this.fits(fragments, slack) && fresh) {
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

/**
 * A block that may break between its `count` units, `part(from, to)` being
 * the fragment that holds units from..to-1. Each page takes as many units as
 * fit, the first of them together with `lead` (a heading waiting for it) and
 * every later page's first with `resumed`. A page holds two units at least,
 * so neither the first nor the last unit stands alone; the page that would
 * take the last unit may run `slack` em longer.
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
  if (count === 0) {
    pager.put(lead);
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
      placeSplit(
        pager,
        block.items.length,
        (from, to) => ({ kind: 'rules', items: block.items.slice(from, to), start: from + 1 }),
        lead,
        [{ kind: 'heading', text: `${heading} (Fortsetzung)` }],
        slack,
      );
      return;
    case 'table':
      placeSplit(
        pager,
        block.rows.length,
        (from, to) => ({ kind: 'table', head: block.head, rows: block.rows.slice(from, to) }),
        lead,
        [],
        slack,
      );
      return;
    default:
      pager.put([...lead, block], slack);
  }
}

/**
 * The book's pages: the contents, then each section from a fresh page. A
 * reader's plan goes right under the station's title, so it is on the page
 * the bookmark opens; the station's last block may run a little long rather
 * than leave a line or two alone on a page.
 */
export function paginate(sections: readonly BookSection[], size: PageSize = BOOK_PAGE): BookPage[] {
  const pager = new Pager(size);
  pager.open(null, true);
  sections.forEach((section, index) => {
    pager.open(index, true);
    pager.put([{ kind: 'title', text: section.title }]);
    if (section.reader) {
      pager.put([{ kind: 'reader' }]);
    }
    section.manual.forEach((part, p) => {
      let lead: Fragment[] = [{ kind: 'heading', text: part.heading }];
      part.blocks.forEach((block, b) => {
        const closing = p === section.manual.length - 1 && b === part.blocks.length - 1;
        place(pager, block, part.heading, lead, closing ? OVERRUN : 0);
        lead = [];
      });
      pager.put(lead);
    });
  });
  return pager.pages;
}

/** The page a section starts on, numbered from 1 like the book; null when it has none. */
export function firstPageOf(pages: readonly BookPage[], section: number): number | null {
  const index = pages.findIndex((page) => page.section === section && page.first);
  return index < 0 ? null : index + 1;
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
