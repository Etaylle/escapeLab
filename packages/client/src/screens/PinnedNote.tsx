import type { Edgework, NoteHere } from '@escapelab/core';
import { PutDown } from './PutDown.js';
import { WorldModal } from './WorldModal.js';

/** What the slip is called, on its frame and to a screen reader. */
export const NOTE_LABEL = 'Notiz der letzten Schicht';

/**
 * A note of the last shift, read where it hangs: a slip of ruled paper in
 * their hand, a pin at its head — the look of the notes in a source's margin
 * (Book.tsx NoteSlip, styles/notes.css), on a sheet of its own. Reading it
 * costs nothing; it is put down like a sheet (PutDown.tsx), and slides out of
 * view once it is (`leaving`).
 */
export function PinnedNote({
  note,
  edgework,
  onPutDown,
  leaving = false,
}: {
  note: NoteHere;
  edgework: Edgework | null;
  onPutDown: () => void;
  leaving?: boolean;
}) {
  return (
    <WorldModal
      kind="note"
      label={NOTE_LABEL}
      edgework={edgework}
      leaving={leaving}
      foot={<PutDown verb="Weglegen" onPutDown={onPutDown} />}
    >
      <aside className="note-slip pinned-note" aria-label={NOTE_LABEL}>
        <span className="pinned-note-pin" aria-hidden="true" />
        <p className="margin-note pinned-note-text">{note.text}</p>
      </aside>
    </WorldModal>
  );
}
