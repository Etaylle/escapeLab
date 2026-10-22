import type { Edgework, NoteHere } from '@escapelab/core';
import { WorldModal } from './WorldModal.js';

/** What the slip is called, on its frame and to a screen reader. */
export const NOTE_LABEL = 'Notiz der letzten Crew';

/**
 * A note of the last crew, read where it hangs: a slip of ruled paper in
 * their hand, a pin at its head — the look of the notes in a source's margin
 * (Book.tsx NoteSlip, styles/notes.css), on a sheet of its own. Reading it
 * costs nothing; the way out is the frame's, or Escape.
 */
export function PinnedNote({
  note,
  edgework,
  onClose,
}: {
  note: NoteHere;
  edgework: Edgework | null;
  onClose: () => void;
}) {
  return (
    <WorldModal kind="note" label={NOTE_LABEL} edgework={edgework} onClose={onClose}>
      <aside className="note-slip pinned-note" aria-label={NOTE_LABEL}>
        <span className="pinned-note-pin" aria-hidden="true" />
        <p className="margin-note pinned-note-text">{note.text}</p>
      </aside>
    </WorldModal>
  );
}
