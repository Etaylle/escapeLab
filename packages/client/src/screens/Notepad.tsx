import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Edgework } from '@escapelab/core';
import {
  EMPTY_NOTEPAD,
  localStore,
  notesKey,
  readNotes,
  withBody,
  withCapture,
  withoutEmpty,
  writeNotes,
  type NoteCapture,
  type NotepadContent,
} from '../notes.js';
import { captureAt, edgeworkTaken, SIGN } from '../noting.js';
import { useGlyph } from '../input/glyphs.js';

export interface Notes {
  content: NotepadContent;
  change: (content: NotepadContent) => void;
  /** false while the browser keeps nothing: the notepad is empty again on reload */
  saved: boolean;
}

/**
 * This player's notepad in this room, kept as it is written. Held here and not in the
 * notepad, so closing the pad loses nothing even where the browser keeps nothing.
 */
export function useNotes(roomCode: string | null, playerId: string): Notes {
  const [store] = useState(localStore);
  const key = roomCode === null ? null : notesKey(roomCode, playerId);
  const [content, setContent] = useState(() =>
    store === null || key === null ? EMPTY_NOTEPAD : readNotes(store, key),
  );
  const [saved, setSaved] = useState(store !== null && key !== null);
  return {
    content,
    saved,
    change: (next) => {
      setContent(next);
      setSaved(store !== null && key !== null && writeNotes(store, key, next));
    },
  };
}

/** Esc in the notepad's writing hands the keys back to the world, and goes no further. */
function letGo(e: KeyboardEvent<HTMLTextAreaElement>): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    e.currentTarget.blur();
  }
}

/**
 * A capture on the pad: the line naming where it came from and what, „aktualisiert" where it
 * was taken again over an earlier one, and its lines under it — a table's columns aligned and
 * never wrapped, running text wrapped — editable as any writing; wiped, it is gone once the
 * pen leaves it.
 */
function CaptureOnPad({
  capture,
  onChange,
  onDone,
}: {
  capture: NoteCapture;
  onChange: (body: string) => void;
  onDone: () => void;
}) {
  return (
    <article className={`notepad-capture notepad-capture--${capture.form}`}>
      <h3 className="notepad-capture-head">
        {capture.head}
        {capture.updated && <span className="notepad-capture-updated"> · aktualisiert</span>}
      </h3>
      <textarea
        className="notepad-capture-text"
        aria-label={capture.head}
        value={capture.body}
        rows={capture.body.split('\n').length}
        wrap={capture.form === 'table' ? 'off' : 'soft'}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onDone}
        onKeyDown={letGo}
      />
    </article>
  );
}

/**
 * A pad for what the crew has to keep in mind: the player's own writing at the top, and under
 * it what was taken down at sources, at the terminal, at the sign and from the notes of the last
 * shift — each under the line that names it, newest at the bottom (noting.ts). In the corner of
 * the world it locks nothing — the player walks on with it open, and Esc hands the keys back to
 * walking; beside a source or a device it stands as a strip of its own (styles/putdown.css).
 * Opened by N it takes the keys (`focus`); opened by a „Notieren" control it leaves them to the
 * page, and scrolls down to what came in (`jump`, a count of the captures taken) — as it does
 * to the Laborkennung taken over at its head.
 */
export function Notepad({
  notes,
  edgework,
  focus = true,
  jump = 0,
  onClose,
}: {
  notes: Notes;
  /** the Laborkennung once this player has read the sign; null before */
  edgework: Edgework | null;
  focus?: boolean;
  jump?: number;
  onClose: () => void;
}) {
  const writing = useRef<HTMLTextAreaElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const takesKeys = useRef(focus);
  const closeKey = useGlyph('notes');
  /** the times the Laborkennung was taken over here: the sheet goes down to it as to a capture */
  const [signed, setSigned] = useState(0);
  useEffect(() => {
    if (takesKeys.current) {
      writing.current?.focus();
    }
  }, []);
  useEffect(() => {
    const paper = sheet.current;
    if (jump + signed > 0 && paper !== null) {
      paper.scrollTop = paper.scrollHeight;
    }
  }, [jump, signed]);
  const { content, change } = notes;
  const done = (): void => {
    const kept = withoutEmpty(content);
    if (kept !== content) {
      change(kept);
    }
  };
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
              change(withCapture(content, captureAt(SIGN, edgeworkTaken(edgework))).content);
              setSigned((n) => n + 1);
            }
          }}
        >
          Laborkennung übernehmen
        </button>
        <button className="notepad-close" title={`Weglegen [${closeKey}]`} onClick={onClose}>
          Weglegen
        </button>
      </div>
      <div className="notepad-sheet" ref={sheet}>
        <textarea
          ref={writing}
          className="notepad-text"
          aria-label="Notizen"
          placeholder="Kennung, Werte, Folgen …"
          spellCheck={false}
          value={content.text}
          onChange={(e) => change({ ...content, text: e.target.value })}
          onKeyDown={letGo}
        />
        {content.captures.map((capture) => (
          <CaptureOnPad
            key={capture.key}
            capture={capture}
            onChange={(body) => change(withBody(content, capture.key, body))}
            onDone={done}
          />
        ))}
      </div>
      {!notes.saved && (
        <p className="notepad-warn">Wird nicht gespeichert — der Browser lässt es nicht zu.</p>
      )}
    </section>
  );
}
