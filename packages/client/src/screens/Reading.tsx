import { useState } from 'react';
import type { Edgework, ManualHere, ManualKind, MapView, PuzzleView } from '@escapelab/core';
import { useKeys, useMedia, useSwipe } from '../hooks.js';
import { roomFloor } from '../world/rooms.js';
import {
  Book,
  NoteSlip,
  progressOf,
  SectionReader,
  stationTitle,
  type ReadSection,
} from './Book.js';
import { Manual } from './Manual.js';
import { WorldModal } from './WorldModal.js';

/**
 * How a source reads: paper bound as a book or clipped to a board, a
 * terminal screen by screen, a wall chart all at once.
 */
const LOOKS: Record<ManualKind, 'book' | 'clipboard' | 'terminal' | 'chart'> = {
  book: 'book',
  clipboard: 'clipboard',
  locker: 'book',
  cabinet: 'book',
  terminal: 'terminal',
  chart: 'chart',
};

/** Two pages side by side from this window width on. */
const SPREAD_QUERY = '(min-width: 900px)';

/** What of the map tells where a source lies. */
type Whereabouts = Pick<MapView, 'tiles' | 'doors' | 'labels' | 'manuals'>;

/**
 * The room a source lies in: the label on the floor around it that no door
 * cuts through. Null where no label names that room, or the source is not
 * on the map.
 */
export function roomOf(map: Whereabouts, manualId: string): string | null {
  const source = map.manuals.find((manual) => manual.id === manualId);
  if (source === undefined) {
    return null;
  }
  const floor = roomFloor(map, source);
  const label = map.labels.find((l) => floor.some((tile) => tile.x === l.x && tile.y === l.y));
  return label?.text ?? null;
}

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
 * now, if it covers it. The last crew's note is a sticky label on its
 * bezel, there whichever screen is up.
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
      <div className="terminal-case">
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
            <span className="terminal-cursor" aria-hidden="true" />
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
        <span className="terminal-led" aria-hidden="true" />
      </div>
      <NoteSlip sections={sections} onAsk={onAskNote} />
    </div>
  );
}

function ChartSection({
  section,
  puzzle,
  current,
}: Pick<SourceProps, 'puzzle' | 'current'> & { section: ReadSection }) {
  return (
    <section className={`chart-section chart-${progressOf(section, current)}`}>
      <div className="chart-text">
        <h3 className="chart-heading">{stationTitle(section)}</h3>
        <SectionReader puzzle={puzzle} section={section} />
        <Manual sections={section.manual} />
      </div>
    </section>
  );
}

/**
 * A wall chart is one sheet pinned up: every station it covers at once. The
 * last crew's note is a label stuck on the board beside it.
 */
function Chart({ manual, puzzle, current, onAskNote }: SourceProps) {
  return (
    <div className="chart">
      <article className="chart-sheet">
        <h2 className="chart-title">{manual.label}</h2>
        {manual.sections.map((section) => (
          <ChartSection
            key={section.puzzleId}
            section={section}
            puzzle={puzzle}
            current={current}
          />
        ))}
      </article>
      <NoteSlip sections={manual.sections} onAsk={onAskNote} />
    </div>
  );
}

/**
 * A source read on the spot: the printed rules of every station it covers,
 * set as the source is made — paper, screen or chart — with whatever the
 * open puzzle shows a reader on top of them (the maze's wall plan) and,
 * beside the open station's rules, the notes of the last crew. Paper opens
 * on a cover naming the mission and the room the source lies in.
 */
export function ReadingOverlay({
  manual,
  puzzle,
  current,
  mission,
  map,
  edgework,
  onAskNote,
  onClose,
}: SourceProps & {
  /** the mission's title, for the seal on a cover */
  mission: string;
  map: Whereabouts;
  edgework: Edgework | null;
  onClose: () => void;
}) {
  const spread = useMedia(SPREAD_QUERY);
  const look = LOOKS[manual.kind];
  const source = { manual, puzzle, current, onAskNote };
  const imprint = { mission, room: roomOf(map, manual.id) };
  return (
    <WorldModal
      kind="reading"
      look={`reading-${look}`}
      label={manual.label}
      edgework={edgework}
      onClose={onClose}
    >
      {look === 'book' && <Book {...source} spread={spread} binding="bound" imprint={imprint} />}
      {look === 'clipboard' && (
        <Book {...source} spread={false} binding="clip" imprint={imprint} />
      )}
      {look === 'terminal' && <Terminal {...source} />}
      {look === 'chart' && <Chart {...source} />}
    </WorldModal>
  );
}
