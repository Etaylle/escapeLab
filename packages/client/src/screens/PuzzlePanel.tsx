import type { ClientMessage, PuzzleView } from '@escapelab/core';
import { PANELS, READERS, type Panel, type Reader } from '../puzzles/index.js';

/** The open puzzle's panel; every input it makes goes out as a `puzzle-input`. */
export function PuzzlePanel({
  puzzle,
  send,
  deadlineAt,
}: {
  puzzle: PuzzleView;
  send: (msg: ClientMessage) => void;
  deadlineAt: number | null;
}) {
  // PANELS is keyed by kind, so the entry for this kind takes exactly this puzzle.
  const ModulePanel = PANELS[puzzle.kind] as Panel<PuzzleView['kind']>;
  return (
    <ModulePanel
      puzzle={puzzle}
      send={(input) => send({ kind: 'puzzle-input', input })}
      deadlineAt={deadlineAt}
    />
  );
}

/** What the open puzzle shows a reader beyond its printed rules; nothing for most modules. */
export function ReaderPanel({ puzzle }: { puzzle: PuzzleView }) {
  const ModuleReader = READERS[puzzle.kind] as Reader<PuzzleView['kind']> | undefined;
  return ModuleReader === undefined ? null : <ModuleReader puzzle={puzzle} />;
}
