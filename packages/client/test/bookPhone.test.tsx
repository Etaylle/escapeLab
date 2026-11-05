import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ManualHere } from '@escapelab/core';
import { BOOK_PAGE } from '../src/pages.js';
import { ReadingOverlay, SPREAD_QUERY } from '../src/screens/Reading.js';
import { elementsOf, holds, Sheets, type Screen, type Styled } from './cascade.js';
import { mapWith } from './fixtures.js';

/**
 * A source's pages on a phone held sideways (styles/book.css, „a phone held sideways"), read
 * off the stylesheets in the bundle's order (cascade.ts) for a phone's 844×390 and a large
 * phone's 932×430: one page at a time, its body at 14 px on a sheet 30 em of it across, the
 * sheet as tall as the frame leaves it and the text scrolling inside it, the outer margin
 * with it. The walkthrough measures the same in a browser (book-phone-landscape.png).
 */

const sheets = new Sheets();

const PHONES: Screen[] = [
  { width: 844, height: 390, coarse: true },
  { width: 932, height: 430, coarse: true },
];
const LAPTOP: Screen = { width: 1280, height: 720, coarse: false };

const noop = (): void => undefined;

/** A book of one station, its rules a list. */
const BOOK: ManualHere = {
  id: 'buch',
  label: 'HANDBUCH',
  kind: 'book',
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

/** The book as the reading frame opens it: at the station's first page. */
const OPENED = elementsOf(
  renderToStaticMarkup(
    <ReadingOverlay
      manual={BOOK}
      puzzle={null}
      current={0}
      mission="Blackout im Labor"
      map={mapWith({})}
      edgework={null}
      pausedAt={null}
      onAskNote={noop}
      onPutDown={noop}
    />,
  ),
);

/** The open book's element of class `name`. */
function the(name: string): Styled {
  const node = OPENED.find((each) => each.classes.includes(name));
  if (node === undefined) {
    throw new Error(`the open book has no .${name}`);
  }
  return node;
}

describe('a book on a phone held sideways', () => {
  it('lies open one page at a time under 500 px of height, two side by side above it', () => {
    for (const phone of PHONES) {
      expect(holds(SPREAD_QUERY, phone)).toBe(false);
    }
    expect(holds(SPREAD_QUERY, { width: 1280, height: 500, coarse: false })).toBe(false);
    expect(holds(SPREAD_QUERY, { width: 900, height: 501, coarse: false })).toBe(true);
    expect(holds(SPREAD_QUERY, LAPTOP)).toBe(true);
    expect(holds(SPREAD_QUERY, { width: 899, height: 720, coarse: false })).toBe(false);
  });

  it('sets its body at 14 px, on a sheet 30 em of it across', () => {
    for (const phone of PHONES) {
      expect(sheets.fontSize(the('page-in'), phone)).toBeCloseTo(14, 5);
      expect(sheets.length(the('page'), 'width', phone)).toBeCloseTo(420, 5);
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
    // A laptop's window keeps the sheet's 30 × 42 em, the whole page standing on it.
    expect(sheets.declared(the('page'), 'aspect-ratio', LAPTOP)?.value).toBe('30 / 42');
    expect(sheets.declared(the('page-text'), 'position', LAPTOP)).toBeUndefined();
  });
});
