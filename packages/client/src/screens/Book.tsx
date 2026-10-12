import { useState, type ReactNode } from 'react';
import type { ManualHere, PuzzleView } from '@escapelab/core';
import { useKeys, useNow, useSwipe } from '../hooks.js';
import {
  firstPageOf,
  paginate,
  pagesInView,
  turnFrom,
  type BookPage,
  type Fragment,
} from '../pages.js';
import { READERS } from '../puzzles/index.js';
import { Block } from './Manual.js';
import { ReaderPanel } from './PuzzlePanel.js';

/** One station's rules as read at a source, the last crew's notes beside them. */
export type ReadSection = ManualHere['sections'][number];

/** Where a station stands in the run. */
export type Progress = 'done' | 'now' | 'ahead';

export function progressOf(section: ReadSection, current: number): Progress {
  return section.index < current ? 'done' : section.index === current ? 'now' : 'ahead';
}

export function stationTitle(section: ReadSection): string {
  return `§${section.index + 1} — ${section.title}`;
}

/** Whether the open puzzle shows a reader more than the rules here: the maze's wall plan. */
function readerIn(puzzle: PuzzleView, section: ReadSection): boolean {
  return puzzle.index === section.index && READERS[puzzle.kind] !== undefined;
}

/** The open puzzle's reader view under its own station's rules; nothing under any other. */
export function SectionReader({
  puzzle,
  section,
}: {
  puzzle: PuzzleView | null;
  section: ReadSection;
}) {
  return puzzle !== null && readerIn(puzzle, section) ? <ReaderPanel puzzle={puzzle} /> : null;
}

/** Counts down to the next note, then asks for it at the price it names. */
function AskNote({ section, onAsk }: { section: ReadSection; onAsk: () => void }) {
  const now = useNow(1000);
  const wait = section.noteReadyAt === null ? 0 : Math.ceil((section.noteReadyAt - now) / 1000);
  return (
    <button className="note-ask" disabled={wait > 0} onClick={onAsk}>
      {wait > 0 ? `Notiz in ${wait} s` : `Notiz der letzten Crew erbitten · −${section.costSec} s`}
    </button>
  );
}

/**
 * What the last crew wrote beside the open station's rules, in their hand,
 * and the way to ask for the next note; nothing beside any other station.
 */
export function MarginNotes({ section, onAsk }: { section: ReadSection; onAsk: () => void }) {
  if (section.notes.length === 0 && section.notesLeft === 0) {
    return null;
  }
  return (
    <aside className="margin" aria-label="Notizen der letzten Crew">
      {section.notes.length > 0 && (
        <ol className="margin-notes">
          {section.notes.map((note, i) => (
            <li key={i} className="margin-note">
              {note}
            </li>
          ))}
        </ol>
      )}
      {section.notesLeft > 0 && <AskNote section={section} onAsk={onAsk} />}
    </aside>
  );
}

/** Everything a page needs to know about the book it is part of. */
interface BookContext {
  manual: ManualHere;
  puzzle: PuzzleView | null;
  /** index of the station that is up now; earlier ones are done */
  current: number;
  pages: BookPage[];
  /** opens the book at a page, from the contents */
  onOpen: (page: number) => void;
  onAskNote: () => void;
}

/** Which way a page faces: left or right in a spread, or alone. */
type Side = 'left' | 'right' | 'single';

function Contents({ book }: { book: BookContext }) {
  return (
    <nav className="contents" aria-label="Inhalt">
      <span className="contents-kicker">Inhalt</span>
      <h2 className="contents-title">{book.manual.label}</h2>
      <ol className="contents-list">
        {book.manual.sections.map((section, i) => {
          const page = firstPageOf(book.pages, i) ?? 1;
          const progress = progressOf(section, book.current);
          return (
            <li key={section.puzzleId} className={`contents-${progress}`}>
              <button
                className="contents-entry"
                aria-current={progress === 'now' ? 'step' : undefined}
                onClick={() => book.onOpen(page)}
              >
                <span className="contents-name">{stationTitle(section)}</span>
                <span className="contents-dots" aria-hidden="true" />
                <span className="contents-page">Seite {page}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function FragmentView({ fragment, puzzle }: { fragment: Fragment; puzzle: PuzzleView | null }) {
  switch (fragment.kind) {
    case 'title':
      return <h2 className="page-title">{fragment.text}</h2>;
    case 'heading':
      return <h3 className="page-heading">{fragment.text}</h3>;
    case 'rules':
      return <Block block={{ kind: 'rules', items: fragment.items }} start={fragment.start} />;
    case 'reader':
      return puzzle === null ? null : <ReaderPanel puzzle={puzzle} />;
    default:
      return <Block block={fragment} />;
  }
}

/**
 * A sheet of paper: the text, the outer margin, the page number in the
 * bottom outer corner. A station's first page carries the ribbon while the
 * station is up and a stamp once it is done; the pages after it name the
 * station at the top.
 */
function Sheet({
  number,
  side,
  progress,
  opener,
  head,
  margin,
  children,
}: {
  number: number;
  side: Side;
  progress: Progress | null;
  opener: boolean;
  head: string | null;
  margin: ReactNode;
  children: ReactNode;
}) {
  return (
    <article
      className={`page page-${side}${progress === null ? '' : ` page-${progress}`}`}
      aria-label={`Seite ${number}`}
    >
      <div className="page-in">
        {head !== null && <header className="page-head">{head}</header>}
        <div className="page-text">{children}</div>
        <div className="page-margin">{margin}</div>
        <span className="page-folio">{number}</span>
        {opener && progress === 'now' && <span className="page-ribbon" title="Lesezeichen" />}
        {opener && progress === 'done' && (
          <span className="page-stamp" aria-hidden="true">
            erledigt
          </span>
        )}
      </div>
    </article>
  );
}

function PageView({ number, side, book }: { number: number; side: Side; book: BookContext }) {
  const page = book.pages[number - 1];
  if (page === undefined) {
    return <article className={`page page-${side} page-blank`} aria-hidden="true" />;
  }
  if (page.section === null) {
    return (
      <Sheet number={number} side={side} progress={null} opener head={null} margin={null}>
        <Contents book={book} />
      </Sheet>
    );
  }
  const section = book.manual.sections[page.section];
  if (section === undefined) {
    throw new Error(`Book: page ${number} belongs to section ${page.section}, which is missing`);
  }
  return (
    <Sheet
      number={number}
      side={side}
      progress={progressOf(section, book.current)}
      opener={page.first}
      head={page.first ? null : stationTitle(section)}
      margin={page.first ? <MarginNotes section={section} onAsk={book.onAskNote} /> : null}
    >
      {page.fragments.map((fragment, i) => (
        <FragmentView key={i} fragment={fragment} puzzle={book.puzzle} />
      ))}
    </Sheet>
  );
}

function whereIn(shown: readonly number[], total: number): string {
  const [first = total, second] = shown.filter((n) => n <= total);
  return second === undefined
    ? `Seite ${first} von ${total}`
    : `Seite ${first}–${second} von ${total}`;
}

/**
 * Paper sources read as a book: the contents first, every station from a
 * page of its own, two pages side by side where the window is wide enough.
 * It opens where the bookmark lies — at the station that is up now, if this
 * book covers it — and turns with the arrow keys, the arrows below it or a
 * swipe.
 */
export function Book({
  manual,
  puzzle,
  current,
  spread,
  onAskNote,
}: {
  manual: ManualHere;
  /** the open puzzle as seen from here; null while no station is open */
  puzzle: PuzzleView | null;
  current: number;
  /** two pages side by side, or one at a time */
  spread: boolean;
  onAskNote: () => void;
}) {
  const pages = paginate(
    manual.sections.map((section) => ({
      title: stationTitle(section),
      manual: section.manual,
      reader: puzzle !== null && readerIn(puzzle, section),
    })),
  );
  const marked = manual.sections.findIndex((section) => section.index === current);
  const [page, setPage] = useState(() => (marked < 0 ? null : firstPageOf(pages, marked)) ?? 1);
  const [dir, setDir] = useState<1 | -1>(1);
  const at = Math.min(page, pages.length);
  const go = (to: number): void => {
    setDir(to < at ? -1 : 1);
    setPage(to);
  };
  const turn = (to: 1 | -1): void => {
    const next = turnFrom(at, pages.length, spread, to);
    if (next !== null) {
      go(next);
    }
  };
  useKeys(['arrowleft', 'arrowright'], (key) => turn(key === 'arrowright' ? 1 : -1));
  const swipe = useSwipe(turn);
  const shown = pagesInView(at, spread);
  const book: BookContext = { manual, puzzle, current, pages, onOpen: go, onAskNote };
  return (
    <div className={`book ${spread ? 'book-spread' : 'book-single'}`}>
      <div className="book-pages" {...swipe}>
        <div key={shown[0]} className={`book-leaves book-leaves-${dir === 1 ? 'next' : 'back'}`}>
          {shown.map((number, i) => (
            <PageView
              key={number}
              number={number}
              side={spread ? (i === 0 ? 'left' : 'right') : 'single'}
              book={book}
            />
          ))}
        </div>
      </div>
      <nav className="book-nav" aria-label="Blättern">
        <button
          className="turn-back"
          aria-label="Zurückblättern"
          title="Zurückblättern [←]"
          disabled={turnFrom(at, pages.length, spread, -1) === null}
          onClick={() => turn(-1)}
        >
          ‹
        </button>
        <span className="book-where">{whereIn(shown, pages.length)}</span>
        <button
          className="turn-next"
          aria-label="Weiterblättern"
          title="Weiterblättern [→]"
          disabled={turnFrom(at, pages.length, spread, 1) === null}
          onClick={() => turn(1)}
        >
          ›
        </button>
      </nav>
    </div>
  );
}
