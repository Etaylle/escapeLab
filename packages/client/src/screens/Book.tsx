import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { ManualHere, PuzzleView } from '@escapelab/core';
import { useKeys, useMedia, useNow, useSwipe } from '../hooks.js';
import {
  firstPageOf,
  leafFor,
  openingPage,
  paginate,
  pagesInView,
  turnFrom,
  type BookPage,
  type Fragment,
  type Leaf,
} from '../pages.js';
import { READERS } from '../puzzles/index.js';
import { Block } from './Manual.js';
import { ReaderPanel } from './PuzzlePanel.js';
import { Seal } from './Seal.js';

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
 * The station the last crew left notes on among a source's: the open one,
 * the only station the view gives notes or notes still to ask for; none
 * where the source does not cover it.
 */
function notedSection(sections: readonly ReadSection[]): ReadSection | null {
  return sections.find((section) => section.notes.length > 0 || section.notesLeft > 0) ?? null;
}

/**
 * The last crew's note, stuck on the source itself rather than on a page —
 * a slip tucked into a book, a Post-it on a clipboard's board, a sticky
 * label on a terminal's bezel or by a wall chart (styles/book.css) — so it
 * is there whichever page or screen is open. It names the station it is
 * for and holds the notes asked for so far, in their hand, and the way to
 * ask for the next; nothing at all where the source does not cover the
 * open station.
 */
export function NoteSlip({
  sections,
  onAsk,
}: {
  sections: readonly ReadSection[];
  onAsk: () => void;
}) {
  const section = notedSection(sections);
  if (section === null) {
    return null;
  }
  const label = `Notizen der letzten Crew zu ${stationTitle(section)}`;
  return (
    <aside className="note-slip" aria-label={label}>
      <p className="note-slip-for">{`zu §${section.index + 1}`}</p>
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

/** What a book's cover prints besides the source's own label. */
export interface Imprint {
  /** the mission's title, round the lab's seal */
  mission: string;
  /** the room the source lies in; null where no label on the map names it */
  room: string | null;
}

/** How the sheets are held: bound as a book, or clipped to a board one at a time. */
export type Binding = 'bound' | 'clip';

/** Everything a page needs to know about the book it is part of. */
interface BookContext {
  manual: ManualHere;
  puzzle: PuzzleView | null;
  /** index of the station that is up now; earlier ones are done */
  current: number;
  pages: BookPage[];
  imprint: Imprint;
  /** opens the book at a page, from the contents or a thumb tab */
  onOpen: (page: number) => void;
  onAskNote: () => void;
}

/** Which way a page faces: left or right in a spread, or alone. */
export type Side = 'left' | 'right' | 'single';

/** The line a printed manual carries at the foot of every page but the cover. */
const FOOTER = 'ESCAPELAB · HANDBUCH · REV. 3';

/** How long a leaf takes to turn over, in ms; styles/book.css times the motion by it. */
const LEAF_MS = 450;

/** Readers who asked for less motion see the page change without a leaf turning. */
const STILL_QUERY = '(prefers-reduced-motion: reduce)';

/** A label longer than this is set smaller on the cover, so it stays on one line. */
const LONG_LABEL = 9;

/** The stations the book covers, each with the page it starts on. */
function Contents({ book }: { book: BookContext }) {
  return (
    <nav className="contents" aria-label="Inhalt">
      <span className="contents-kicker">Inhalt</span>
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

/**
 * Page 1: the source's label, the lab's seal round the mission's title, the
 * revision and where the source lies — and, where the book covers more than
 * one station, the contents under them.
 */
function Cover({ book }: { book: BookContext }) {
  const { manual, imprint } = book;
  const many = manual.sections.length > 1;
  return (
    <div className={`cover${many ? ' cover-contents' : ''}`}>
      <h2 className={`cover-title${manual.label.length > LONG_LABEL ? ' cover-title-long' : ''}`}>
        {manual.label}
      </h2>
      <Seal mission={imprint.mission} />
      <p className="cover-imprint">
        <span>Rev. 3</span>
        {imprint.room !== null && <span>{`Liegt aus: ${imprint.room}`}</span>}
      </p>
      {many && <Contents book={book} />}
    </div>
  );
}

function FragmentView({
  fragment,
  section,
  puzzle,
}: {
  fragment: Fragment;
  section: ReadSection;
  puzzle: PuzzleView | null;
}) {
  switch (fragment.kind) {
    case 'title':
      // pages.ts counts the whole „§n — Titel"; the number as a badge takes less room.
      return (
        <h2 className="page-title">
          <span className="page-badge">{`§${section.index + 1}`}</span>
          {` ${section.title}`}
        </h2>
      );
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
 * A sheet of paper: the text within a book's usual margins, the page number
 * in the bottom outer corner and the manual's line centred under the text.
 * A station's first page carries the ribbon while the station is up and a
 * stamp once it is done; the pages after it name the station at the top.
 */
function Sheet({
  number,
  side,
  progress,
  opener,
  head,
  children,
}: {
  number: number;
  side: Side;
  progress: Progress;
  opener: boolean;
  head: string | null;
  children: ReactNode;
}) {
  return (
    <article className={`page page-${side} page-${progress}`} aria-label={`Seite ${number}`}>
      <div className="page-in">
        {head !== null && <header className="page-head">{head}</header>}
        <div className="page-text">{children}</div>
        <span className="page-folio">{number}</span>
        <footer className="page-foot" aria-hidden="true">
          {FOOTER}
        </footer>
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

/** The cover: no running head, no page number, no foot line, the whole sheet for itself. */
function CoverSheet({ side, book }: { side: Side; book: BookContext }) {
  return (
    <article className={`page page-${side} page-cover`} aria-label="Seite 1">
      <div className="page-in">
        <div className="page-text">
          <Cover book={book} />
        </div>
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
    return <CoverSheet side={side} book={book} />;
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
    >
      {page.fragments.map((fragment, i) => (
        <FragmentView key={i} fragment={fragment} section={section} puzzle={book.puzzle} />
      ))}
    </Sheet>
  );
}

/**
 * Thumb tabs on the fore-edge: one per station the book covers, coloured by
 * how far the run has come, the tab of a station in view pulled out a
 * little; a tab turns to the first page of its station.
 */
function Tabs({ book, shown }: { book: BookContext; shown: readonly number[] }) {
  const inView = new Set(shown.map((number) => book.pages[number - 1]?.section));
  return (
    <nav className="book-tabs" aria-label="Register">
      {book.manual.sections.map((section, i) => {
        const page = firstPageOf(book.pages, i) ?? 1;
        const progress = progressOf(section, book.current);
        return (
          <button
            key={section.puzzleId}
            className={`book-tab book-tab-${progress}${inView.has(i) ? ' book-tab-open' : ''}`}
            aria-label={`${stationTitle(section)}, Seite ${page}`}
            aria-current={progress === 'now' ? 'step' : undefined}
            title={`${stationTitle(section)} · Seite ${page}`}
            onClick={() => book.onOpen(page)}
          >
            {`§${section.index + 1}`}
          </button>
        );
      })}
    </nav>
  );
}

/** The sides a leaf's two faces show on: in a spread, from right to left going forwards. */
function leafSides(leaf: Leaf, spread: boolean): [Side, Side] {
  if (!spread) {
    return ['single', 'single'];
  }
  return leaf.dir === 1 ? ['right', 'left'] : ['left', 'right'];
}

/**
 * A copy of the sheet that turns, its faces back to back, over the pages it
 * uncovers; styles/book.css swings it round its spine — or, on a clipboard,
 * up over the clip — and shades it as it goes. Only for the eye: nothing on
 * it is read out or reached by the keyboard.
 */
export function TurningLeaf({
  leaf,
  spread,
  face,
}: {
  leaf: Leaf;
  spread: boolean;
  /** draws a page of the book as it faces */
  face: (page: number, side: Side) => ReactNode;
}) {
  const [frontSide, backSide] = leafSides(leaf, spread);
  const timing = { '--leaf-ms': `${LEAF_MS}ms` } as CSSProperties;
  return (
    <div
      className={`book-leaf book-leaf-${leaf.dir === 1 ? 'next' : 'back'}`}
      style={timing}
      aria-hidden="true"
      inert
    >
      <div className={`leaf-face leaf-front leaf-${frontSide}`}>{face(leaf.front, frontSide)}</div>
      {leaf.back !== null && (
        <div className={`leaf-face leaf-back leaf-${backSide}`}>{face(leaf.back, backSide)}</div>
      )}
    </div>
  );
}

/** A leaf on its way over, the view it turns in, and its count, which restarts the motion. */
interface Turning {
  leaf: Leaf;
  spread: boolean;
  count: number;
}

/**
 * The page the book lies open at and the leaf turning over to it: `go`
 * opens another page, a leaf turning there unless the reader asked for less
 * motion; it lies still after LEAF_MS. A leaf of a view the window has just
 * left behind is dropped.
 */
function usePage(opening: number, total: number, spread: boolean) {
  const [page, setPage] = useState(opening);
  const [turning, setTurning] = useState<Turning | null>(null);
  const still = useMedia(STILL_QUERY);
  useEffect(() => {
    if (turning === null) {
      return undefined;
    }
    const timer = setTimeout(() => setTurning(null), LEAF_MS + 40);
    return () => clearTimeout(timer);
  }, [turning]);
  const at = Math.min(page, total);
  const go = (to: number): void => {
    const leaf = still ? null : leafFor(at, to, spread);
    setTurning((last) => (leaf === null ? null : { leaf, spread, count: (last?.count ?? 0) + 1 }));
    setPage(to);
  };
  return { at, go, turning: turning?.spread === spread ? turning : null };
}

/** The book's look: a spread or a single page, bound or clipped, with a note on it or not. */
function lookOf(spread: boolean, binding: Binding, noted: boolean): string {
  const parts = ['book', spread ? 'book-spread' : 'book-single'];
  if (binding === 'clip') {
    parts.push('book-clip');
  }
  if (noted) {
    parts.push('book-noted');
  }
  return parts.join(' ');
}

/**
 * Paper sources read as a book: the cover first, every station from a page
 * of its own, two pages side by side where the window is wide enough — or,
 * clipped to a board, one sheet at a time. It opens where the bookmark lies:
 * at the station that is up now, if this book covers it, at its only
 * station, or on the cover. It turns with the arrow keys, the arrows below
 * it, a swipe, the contents or a thumb tab, a leaf turning over each time.
 * The last crew's note on the open station stays with the book as it turns:
 * a slip tucked in at the front, or a Post-it on the clipboard's board.
 */
export function Book({
  manual,
  puzzle,
  current,
  spread,
  binding,
  imprint,
  onAskNote,
}: {
  manual: ManualHere;
  /** the open puzzle as seen from here; null while no station is open */
  puzzle: PuzzleView | null;
  current: number;
  /** two pages side by side, or one at a time */
  spread: boolean;
  binding: Binding;
  imprint: Imprint;
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
  const { at, go, turning } = usePage(
    openingPage(pages, marked < 0 ? null : marked),
    pages.length,
    spread,
  );
  const turn = (to: 1 | -1): void => {
    const next = turnFrom(at, pages.length, spread, to);
    if (next !== null) {
      go(next);
    }
  };
  useKeys(['arrowleft', 'arrowright'], (key) => turn(key === 'arrowright' ? 1 : -1));
  const swipe = useSwipe(turn);
  const shown = pagesInView(at, spread);
  const book: BookContext = { manual, puzzle, current, pages, imprint, onOpen: go, onAskNote };
  const sideOf = (i: number): Side => (spread ? (i === 0 ? 'left' : 'right') : 'single');
  return (
    <div className={lookOf(spread, binding, notedSection(manual.sections) !== null)}>
      <div className="book-pages" {...swipe}>
        <div className="book-leaves">
          <NoteSlip sections={manual.sections} onAsk={onAskNote} />
          {(turning?.leaf.under ?? shown).map((number, i) => (
            <PageView key={number} number={number} side={sideOf(i)} book={book} />
          ))}
          {turning !== null && (
            <TurningLeaf
              key={turning.count}
              leaf={turning.leaf}
              spread={spread}
              face={(number, side) => <PageView number={number} side={side} book={book} />}
            />
          )}
          <Tabs book={book} shown={shown} />
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

function whereIn(shown: readonly number[], total: number): string {
  const [first = total, second] = shown.filter((n) => n <= total);
  return second === undefined
    ? `Seite ${first} von ${total}`
    : `Seite ${first}–${second} von ${total}`;
}
