import { noteSpot, type Edgework, type MapView, type NoteHere } from '@escapelab/core';
import { pinnedNoteTaken, type Place } from '../noting.js';
import { roomFloor } from '../world/rooms.js';
import { NoteButton } from './NoteButton.js';
import { PutDown } from './PutDown.js';
import { WorldModal } from './WorldModal.js';

/** What the slip is called, on its frame and to a screen reader. */
export const NOTE_LABEL = 'Notiz der letzten Schicht';

/** Where the notepad takes a pinned note down: from its slip. */
const SLIP: Place = { id: 'zettel', name: 'Zettel' };

/**
 * The room a note of the last shift is read in: of the labels on the floor round the spot it is
 * read from — the floor no door cuts through, which may run on through an opening into the next
 * room — the nearest. Null where no label names the room, or the note is not on the map.
 */
export function noteRoom(
  map: Pick<MapView, 'tiles' | 'doors' | 'labels' | 'notes'>,
  index: number,
): string | null {
  const note = map.notes.find((each) => each.index === index);
  const spot = note === undefined ? null : noteSpot(map, note);
  if (spot === null) {
    return null;
  }
  const floor = roomFloor(map, spot);
  const inRoom = map.labels.filter((l) => floor.some((tile) => tile.x === l.x && tile.y === l.y));
  const away = (label: { x: number; y: number }): number =>
    Math.hypot(label.x - spot.x, label.y - spot.y);
  const [nearest] = [...inRoom].sort((a, b) => away(a) - away(b));
  return nearest?.text ?? null;
}

/**
 * A note of the last shift, read where it hangs: a slip of ruled paper in
 * their hand, a pin at its head — the look of the notes in a source's margin
 * (Book.tsx NoteSlip, styles/notes.css), on a sheet of its own — and under it
 * „Notieren", which takes it down word for word under the room it hangs in
 * („Zettel · Flur"). Reading it costs nothing; it is put down like a sheet
 * (PutDown.tsx), and slides out of view once it is (`leaving`).
 */
export function PinnedNote({
  note,
  room,
  edgework,
  onPutDown,
  leaving = false,
}: {
  note: NoteHere;
  /** the room it hangs in, as its label names it (`noteRoom`); null where none does */
  room: string | null;
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
      <div className="pinned-note-take">
        <NoteButton taken={pinnedNoteTaken(note, room)} place={SLIP} />
      </div>
    </WorldModal>
  );
}
