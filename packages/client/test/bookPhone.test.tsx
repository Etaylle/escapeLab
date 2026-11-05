import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ManualHere, ManualKind } from '@escapelab/core';
import { NotepadContext } from '../src/noting.js';
import { BOOK_PAGE } from '../src/pages.js';
import { ReadingOverlay, SPREAD_QUERY } from '../src/screens/Reading.js';
import { TEXT_SCALE } from '../src/settings.js';
import { elementsOf, holds, Sheets, type Screen, type Styled } from './cascade.js';
import { mapWith } from './fixtures.js';

/**
 * A source's pages on a phone (styles/book.css, „a phone, held sideways or upright"), read off
 * the stylesheets in the bundle's order (cascade.ts): held sideways at a phone's 844×390 and a
 * large phone's 932×430, and upright at 420×760 with the notepad's drawer down or up — one page
 * at a time, its body at 14 px, the sheet as tall as the frame leaves it and the text scrolling
 * inside it, the outer margin with it. Upright the sheet gives up paper rather than its em, so
 * that the frame holds it across. The walkthrough measures the same in a browser
 * (book-phone-landscape.png, book-phone-notepad.png).
 */

const sheets = new Sheets();

const PHONES: Screen[] = [
  { width: 844, height: 390, coarse: true },
  { width: 932, height: 430, coarse: true },
];
const UPRIGHT: Screen = { width: 420, height: 760, coarse: true };
const LAPTOPS: Screen[] = [
  { width: 1440, height: 820, coarse: false },
  { width: 1280, height: 720, coarse: false },
];

const noop = (): void => undefined;

/** A source of one station, its rules a list, as `kind` binds it. */
function sourceOf(kind: ManualKind): ManualHere {
  return {
    id: 'buch',
    label: 'HANDBUCH',
    kind,
    sections: [
      {
        puzzleId: 'kabel',
        index: 0,
        title: 'Kabel',
        manual: [
          {
            heading: 'Schnittfolge',
            blocks: [{ kind: 'rules', items: ['Rot zuerst.', 'Dann Blau.'] }],
          },
        ],
        notes: [],
        noteReadyAt: null,
        notesLeft: 0,
        costSec: 20,
      },
    ],
  };
}

/** The source as the reading frame opens it: at the station's first page. */
function overlay(kind: ManualKind) {
  return (
    <ReadingOverlay
      manual={sourceOf(kind)}
      puzzle={null}
      current={0}
      mission="Blackout im Labor"
      map={mapWith({})}
      edgework={null}
      pausedAt={null}
      onAskNote={noop}
      onPutDown={noop}
    />
  );
}

/** The book as the reading frame opens it, out of the game. */
const OPENED = elementsOf(renderToStaticMarkup(overlay('book')));

/**
 * The source as the game opens it, the notepad within reach — „Notieren" by the rules — and
 * its drawer down, or up under the frame (`noting`).
 */
function inGame(kind: ManualKind, noting: boolean): Styled[] {
  const source = renderToStaticMarkup(
    <NotepadContext value={{ noteDown: () => true, toggle: noop }}>{overlay(kind)}</NotepadContext>,
  );
  const pad = noting ? '<section class="notepad"></section>' : '';
  return elementsOf(`<div class="game${noting ? ' game--noting' : ''}">${source}${pad}</div>`);
}

const DRAWER = { down: inGame('book', false), up: inGame('book', true) };

/** The element of class `name` among `elements`. */
function find(elements: Styled[], name: string): Styled {
  const node = elements.find((each) => each.classes.includes(name));
  if (node === undefined) {
    throw new Error(`the open source has no .${name}`);
  }
  return node;
}

/** The open book's element of class `name`. */
function the(name: string): Styled {
  return find(OPENED, name);
}

/** The body's own size on `screen`: devices.css `--type-body`, on the page's root. */
function typeBody(screen: Screen): number {
  let root = the('page');
  while (root.parent !== null) {
    root = root.parent;
  }
  return sheets.length(root, '--type-body', screen);
}

describe('a book on a phone held sideways', () => {
  it('lies open one page at a time under 500 px of height, two side by side above it', () => {
    for (const phone of PHONES) {
      expect(holds(SPREAD_QUERY, phone)).toBe(false);
    }
    expect(holds(SPREAD_QUERY, { width: 1280, height: 500, coarse: false })).toBe(false);
    expect(holds(SPREAD_QUERY, { width: 900, height: 501, coarse: false })).toBe(true);
    for (const laptop of LAPTOPS) {
      expect(holds(SPREAD_QUERY, laptop)).toBe(true);
    }
    expect(holds(SPREAD_QUERY, { width: 899, height: 720, coarse: false })).toBe(false);
  });

  it('sets its body at 14 px, on a sheet 30 em of it across beside its tabs', () => {
    for (const phone of PHONES) {
      expect(sheets.fontSize(the('page-in'), phone)).toBeCloseTo(14, 5);
      expect(sheets.length(the('page'), 'width', phone)).toBeCloseTo(420, 5);
      expect(sheets.hidden(the('book-tabs'), phone)).toBe(false);
    }
  });

  it('stands as tall as the frame leaves it, the text scrolling inside with its margin', () => {
    for (const phone of PHONES) {
      // A page's column holds 37 em of the body (pages.ts): more than the window's height.
      const column = BOOK_PAGE.height * sheets.fontSize(the('page-in'), phone);
      expect(column).toBeGreaterThan(phone.height);
      expect(sheets.declared(the('page'), 'aspect-ratio', phone)?.value).toBe('auto');
      expect(sheets.declared(the('page'), 'height', phone)?.value).toBe('100%');
      expect(sheets.declared(the('page-text'), 'overflow-y', phone)?.value).toBe('auto');
      // The outer margin, 3 em, scrolls with the text: a block's „Notieren" mark stays by it.
      expect(sheets.declared(the('page-text'), 'position', phone)?.value).toBe('relative');
      expect(sheets.length(the('page-text'), 'margin-right', phone)).toBeCloseTo(-42, 5);
      expect(sheets.length(the('page-text'), 'padding-right', phone)).toBeCloseTo(42, 5);
    }
  });

  it('leaves a laptop its sheet of 30 × 42 em, the whole page standing on it', () => {
    for (const laptop of LAPTOPS) {
      expect(sheets.declared(the('page'), 'aspect-ratio', laptop)?.value).toBe('30 / 42');
      expect(sheets.declared(the('page-text'), 'position', laptop)).toBeUndefined();
      expect(sheets.hidden(the('book-tabs'), laptop)).toBe(false);
    }
  });
});

describe('a book on a phone held upright', () => {
  const drawers = [DRAWER.down, DRAWER.up];

  it('lies open one page at a time, its body at 14 px whether the drawer is down or up', () => {
    expect(holds(SPREAD_QUERY, UPRIGHT)).toBe(false);
    expect(typeBody(UPRIGHT)).toBeGreaterThanOrEqual(14);
    for (const elements of drawers) {
      const body = sheets.fontSize(find(elements, 'page-in'), UPRIGHT);
      expect(body).toBeGreaterThanOrEqual(14);
      expect(body).toBeCloseTo(typeBody(UPRIGHT), 5);
    }
  });

  it('keeps the column pages.ts paginates for, on a sheet the frame holds across', () => {
    /** What `property` takes of the width at `name`'s left and right. */
    const leftAndRight = (elements: Styled[], name: string, property: 'margin' | 'padding') => {
      const { left, right } = sheets.sides(find(elements, name), property, UPRIGHT);
      return left + right;
    };
    for (const kind of ['book', 'clipboard'] as const) {
      const elements = inGame(kind, true);
      const frame =
        UPRIGHT.width -
        leftAndRight(elements, 'puzzle-modal', 'padding') -
        leftAndRight(elements, 'panel', 'padding');
      const pageIn = find(elements, 'page-in');
      const body = sheets.fontSize(pageIn, UPRIGHT);
      // The text column: 25.2 em of the body, which pages.ts counts 0.6 em narrower.
      const column = sheets.length(pageIn, 'grid-template-columns', UPRIGHT);
      expect(column / body).toBeCloseTo(BOOK_PAGE.width + 0.6, 5);
      // The sheet, the stack's edge or the board beside it: within the frame's width.
      const page = sheets.length(find(elements, 'page'), 'width', UPRIGHT);
      expect(page + leftAndRight(elements, 'book-leaves', 'margin')).toBeLessThanOrEqual(frame);
      expect(sheets.hidden(find(elements, 'book-tabs'), UPRIGHT)).toBe(true);
    }
  });

  it('stands as tall as the frame leaves it, the text scrolling inside with its „Notieren"', () => {
    for (const elements of drawers) {
      const page = find(elements, 'page');
      const text = find(elements, 'page-text');
      expect(sheets.declared(page, 'aspect-ratio', UPRIGHT)?.value).toBe('auto');
      expect(sheets.declared(page, 'height', UPRIGHT)?.value).toBe('100%');
      expect(sheets.declared(text, 'overflow-y', UPRIGHT)?.value).toBe('auto');
      expect(sheets.declared(text, 'position', UPRIGHT)?.value).toBe('relative');
      const margin = sheets.length(text, 'padding-right', UPRIGHT);
      expect(sheets.length(text, 'margin-right', UPRIGHT)).toBeCloseTo(-margin, 5);
      // The mark stands in the outer margin, clear of the text, at the large text size too.
      const mark = find(elements, 'note-down');
      const reach = sheets.length(mark, 'right', UPRIGHT) + sheets.length(mark, 'width', UPRIGHT);
      expect(reach * TEXT_SCALE.large).toBeLessThanOrEqual(margin);
    }
  });

  it('gives the drawer its 42 % of the height, the frame its head back once it is down', () => {
    expect(sheets.length(find(DRAWER.up, 'notepad'), 'height', UPRIGHT)).toBeCloseTo(
      0.42 * UPRIGHT.height,
      5,
    );
    expect(sheets.hidden(find(DRAWER.up, 'modal-head'), UPRIGHT)).toBe(true);
    expect(sheets.hidden(find(DRAWER.down, 'modal-head'), UPRIGHT)).toBe(false);
  });
});
