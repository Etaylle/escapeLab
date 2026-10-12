import { useEffect, useRef, useState } from 'react';
import type { Edgework } from '@escapelab/core';
import {
  appendLines,
  edgeworkLines,
  localStore,
  notesKey,
  readNotes,
  writeNotes,
} from '../notes.js';

export interface Notes {
  text: string;
  change: (text: string) => void;
  /** false while the browser keeps nothing: the text is gone on reload */
  saved: boolean;
}

/**
 * This player's notes in this room, kept as they are typed. Held here and
 * not in the notepad, so closing the pad loses nothing even where the
 * browser keeps nothing.
 */
export function useNotes(roomCode: string | null, playerId: string): Notes {
  const [store] = useState(localStore);
  const key = roomCode === null ? null : notesKey(roomCode, playerId);
  const [text, setText] = useState(() =>
    store === null || key === null ? '' : readNotes(store, key),
  );
  const [saved, setSaved] = useState(store !== null && key !== null);
  return {
    text,
    saved,
    change: (next) => {
      setText(next);
      setSaved(store !== null && key !== null && writeNotes(store, key, next));
    },
  };
}

/**
 * A pad in the corner for what the crew has to keep in mind: positions,
 * symbols, the Laborkennung. It locks nothing — the player walks on with it
 * open, and Esc hands the keys back to walking.
 */
export function Notepad({
  notes,
  edgework,
  onClose,
}: {
  notes: Notes;
  /** the Laborkennung once this player has read the sign; null before */
  edgework: Edgework | null;
  onClose: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.focus();
  }, []);
  return (
    <section className="notepad" aria-label="Notizblock">
      <div className="notepad-head">
        <span className="notepad-title">NOTIZEN</span>
        <button
          className="notepad-take"
          disabled={edgework === null}
          title={edgework === null ? 'Erst das Kennungsschild lesen' : undefined}
          onClick={() => {
            if (edgework !== null) {
              notes.change(appendLines(notes.text, edgeworkLines(edgework)));
            }
          }}
        >
          Laborkennung übernehmen
        </button>
        <button
          className="notepad-close"
          aria-label="Notizblock schließen"
          title="Schließen [N]"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <textarea
        ref={area}
        className="notepad-text"
        aria-label="Notizen"
        placeholder="Was ihr euch merken müsst …"
        spellCheck={false}
        value={notes.text}
        onChange={(e) => notes.change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
      />
      {!notes.saved && (
        <p className="notepad-warn">Wird nicht gespeichert — der Browser lässt es nicht zu.</p>
      )}
    </section>
  );
}
