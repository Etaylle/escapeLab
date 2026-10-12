import type { Edgework, ManualHere, PuzzleView } from '@escapelab/core';
import { Manual } from './Manual.js';
import { ReaderPanel } from './PuzzlePanel.js';
import { WorldModal } from './WorldModal.js';

/**
 * A manual object read on the spot: the printed rules of every station it
 * covers, by paragraph, and for the open one whatever its module shows a
 * reader on top — the maze's wall plan.
 */
export function ReadingOverlay({
  manual,
  puzzle,
  current,
  edgework,
  onClose,
}: {
  manual: ManualHere;
  /** the open puzzle as seen from here; null while no station is open */
  puzzle: PuzzleView | null;
  /** index of the station that is up now; earlier ones are done */
  current: number;
  edgework: Edgework | null;
  onClose: () => void;
}) {
  return (
    <WorldModal kind="reading" label={manual.label} edgework={edgework} onClose={onClose}>
      {manual.sections.map((section) => (
        <section
          key={section.puzzleId}
          className={`reading-section ${
            section.index < current
              ? 'reading-done'
              : section.index === current
                ? 'reading-now'
                : ''
          }`}
        >
          <h3 className="reading-title">{`§${section.index + 1} — ${section.title}`}</h3>
          <Manual sections={section.manual} />
          {puzzle !== null && puzzle.index === section.index && <ReaderPanel puzzle={puzzle} />}
        </section>
      ))}
    </WorldModal>
  );
}
