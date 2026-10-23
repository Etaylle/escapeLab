import { useContext, useEffect, useState, type ReactNode } from 'react';
import { NotepadContext } from '../noting.js';
import { Icon } from './Icon.js';

/** How long a „Notieren" control says it took the block down, ms. */
export const NOTED_MS = 1400;

/**
 * The small „Notieren" control beside a rules list or a table: it hands the block to the
 * notepad as plain text (`text`, noting.ts) and says „Notiert" for a moment. Nothing where no
 * notepad is within reach — the printed handbook, the audience's column.
 */
export function NoteButton({ text }: { text: string }) {
  const hand = useContext(NotepadContext);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) {
      return undefined;
    }
    const timer = setTimeout(() => setDone(false), NOTED_MS);
    return () => clearTimeout(timer);
  }, [done]);
  if (hand === null) {
    return null;
  }
  return (
    <button
      type="button"
      className={done ? 'note-down note-down--done' : 'note-down'}
      title="In den Notizblock"
      onClick={() => {
        hand.noteDown(text);
        setDone(true);
      }}
    >
      <Icon name={done ? 'check' : 'pencil'} />
      <span className="note-down-word">{done ? 'Notiert' : 'Notieren'}</span>
    </button>
  );
}

/**
 * A printed block the notepad can take down (`noted`, its text): the „Notieren" control in
 * front of it, where a notepad is within reach; the block alone everywhere else.
 */
export function Notable({ noted, children }: { noted: string | null; children: ReactNode }) {
  const hand = useContext(NotepadContext);
  if (noted === null || hand === null) {
    return <>{children}</>;
  }
  return (
    <div className="noted">
      <NoteButton text={noted} />
      {children}
    </div>
  );
}
