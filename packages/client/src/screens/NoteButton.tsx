import { useContext, useEffect, useState, type ReactNode } from 'react';
import { captureAt, NotepadContext, NotingPlace, type Place, type Taken } from '../noting.js';
import { Icon } from './Icon.js';

/** How long a „Notieren" control says it took the block down, ms. */
export const NOTED_MS = 1400;

/**
 * The small „Notieren" control beside a rules list, a table or a note: it hands what it stands
 * by to the notepad as a capture (`taken`, noting.ts) of the place it is taken at — `place`, or
 * the open source's (`NotingPlace`) — and says for a moment that it did: „Notiert", or
 * „Aktualisiert" where the pad held one of the same, which it replaced. Nothing where no
 * notepad is within reach — the printed handbook, the audience's column.
 */
export function NoteButton({ taken, place = null }: { taken: Taken; place?: Place | null }) {
  const hand = useContext(NotepadContext);
  const here = useContext(NotingPlace);
  const [said, setSaid] = useState<'Notiert' | 'Aktualisiert' | null>(null);
  useEffect(() => {
    if (said === null) {
      return undefined;
    }
    const timer = setTimeout(() => setSaid(null), NOTED_MS);
    return () => clearTimeout(timer);
  }, [said]);
  if (hand === null) {
    return null;
  }
  return (
    <button
      type="button"
      className={said === null ? 'note-down' : 'note-down note-down--done'}
      title="In den Notizblock"
      onClick={() => {
        const replaced = hand.noteDown(captureAt(place ?? here, taken));
        setSaid(replaced ? 'Aktualisiert' : 'Notiert');
      }}
    >
      <Icon name={said === null ? 'pencil' : 'check'} />
      <span className="note-down-word">{said ?? 'Notieren'}</span>
    </button>
  );
}

/**
 * A printed block the notepad can take down (`noted`, its capture): the „Notieren" control in
 * front of it, where a notepad is within reach; the block alone everywhere else.
 */
export function Notable({ noted, children }: { noted: Taken | null; children: ReactNode }) {
  const hand = useContext(NotepadContext);
  if (noted === null || hand === null) {
    return <>{children}</>;
  }
  return (
    <div className="noted">
      <NoteButton taken={noted} />
      {children}
    </div>
  );
}
