import { useState } from 'react';
import type { Edgework, ManualHere, ManualKind, PuzzleView } from '@escapelab/core';
import { useKeys, useMedia, useSwipe } from '../hooks.js';
import {
  Book,
  MarginNotes,
  progressOf,
  SectionReader,
  stationTitle,
  type ReadSection,
} from './Book.js';
import { Manual } from './Manual.js';
import { WorldModal } from './WorldModal.js';

/** How a source reads: paper as a book, a terminal screen by screen, a wall chart all at once. */
const LOOKS: Record<ManualKind, 'book' | 'terminal' | 'chart'> = {
  book: 'book',
  clipboard: 'book',
  locker: 'book',
  cabinet: 'book',
  terminal: 'terminal',
  chart: 'chart',
};

/** Two pages side by side from this window width on. */
const SPREAD_QUERY = '(min-width: 900px)';

interface SourceProps {
  manual: ManualHere;
  /** the open puzzle as seen from here; null while no station is open */
  puzzle: PuzzleView | null;
  /** index of the station that is up now; earlier ones are done */
  current: number;
  onAskNote: () => void;
}

/**
 * A terminal shows one station per screen and starts at the one that is up
 * now, if it covers it. The last crew's notes stick on a slip beside it.
 */
function Terminal({ manual, puzzle, current, onAskNote }: SourceProps) {
  const sections = manual.sections;
  const last = sections.length - 1;
  const [at, setAt] = useState(() => Math.max(0, sections.findIndex((s) => s.index === current)));
  const shown = Math.min(at, last);
  const go = (dir: 1 | -1): void => setAt(Math.min(last, Math.max(0, shown + dir)));
  useKeys(['arrowleft', 'arrowright'], (key) => go(key === 'arrowright' ? 1 : -1));
  const swipe = useSwipe(go);
  const section = sections[shown];
  if (section === undefined) {
    return null;
  }
  return (
    <div className="terminal" {...swipe}>
      <div className="terminal-screen">
        <div className="terminal-status">
          <span>{stationTitle(section)}</span>
          <span>{`BILDSCHIRM ${shown + 1}/${sections.length}`}</span>
        </div>
        <div
          key={section.puzzleId}
          className={`terminal-body terminal-${progressOf(section, current)}`}
        >
          <SectionReader puzzle={puzzle} section={section} />
          <Manual sections={section.manual} />
        </div>
        <nav className="terminal-nav" aria-label="Bildschirme">
          <button className="turn-back" disabled={shown === 0} onClick={() => go(-1)}>
            ◂ ZURÜCK
          </button>
          <button className="turn-next" disabled={shown === last} onClick={() => go(1)}>
            WEITER ▸
          </button>
        </nav>
      </div>
      <MarginNotes section={section} onAsk={onAskNote} />
    </div>
  );
}

function ChartSection({
  section,
  puzzle,
  current,
  onAskNote,
}: Omit<SourceProps, 'manual'> & { section: ReadSection }) {
  return (
    <section className={`chart-section chart-${progressOf(section, current)}`}>
      <div className="chart-text">
        <h3 className="chart-heading">{stationTitle(section)}</h3>
        <SectionReader puzzle={puzzle} section={section} />
        <Manual sections={section.manual} />
      </div>
      <MarginNotes section={section} onAsk={onAskNote} />
    </section>
  );
}

/** A wall chart is one sheet: every station it covers at once, notes beside the open one. */
function Chart({ manual, ...rest }: SourceProps) {
  return (
    <div className="chart">
      <article className="chart-sheet">
        <h2 className="chart-title">{manual.label}</h2>
        {manual.sections.map((section) => (
          <ChartSection key={section.puzzleId} section={section} {...rest} />
        ))}
      </article>
    </div>
  );
}

/**
 * A source read on the spot: the printed rules of every station it covers,
 * set as the source is made — paper, screen or chart — with whatever the
 * open puzzle shows a reader on top of them (the maze's wall plan) and,
 * beside the open station's rules, the notes of the last crew.
 */
export function ReadingOverlay({
  manual,
  puzzle,
  current,
  edgework,
  onAskNote,
  onClose,
}: SourceProps & {
  edgework: Edgework | null;
  onClose: () => void;
}) {
  const spread = useMedia(SPREAD_QUERY);
  const look = LOOKS[manual.kind];
  const source = { manual, puzzle, current, onAskNote };
  return (
    <WorldModal
      kind="reading"
      look={`reading-${look}`}
      label={manual.label}
      edgework={edgework}
      onClose={onClose}
    >
      {look === 'book' && <Book {...source} spread={spread} />}
      {look === 'terminal' && <Terminal {...source} />}
      {look === 'chart' && <Chart {...source} />}
    </WorldModal>
  );
}
