import type { ReactNode } from 'react';
import type { Edgework } from '@escapelab/core';
import { EdgeworkChip } from './EdgeworkChip.js';

/**
 * The frame a station's device, a manual object's pages and a note of the
 * last crew open in, over the world: what you are reading — a station's
 * device carries its own label plate, so its name stays with the dialog —
 * the Laborkennung once you have read it, and the way out.
 */
export function WorldModal({
  kind,
  look,
  label,
  edgework,
  onClose,
  children,
}: {
  /** names the frame's class: `station-modal`, `reading-modal` or `note-modal` */
  kind: 'station' | 'reading' | 'note';
  /** further classes for what is inside: a book, a terminal, a wall chart */
  look?: string;
  /** the dialog's name; printed over a manual object's pages and a note */
  label: string;
  edgework: Edgework | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const frame = `puzzle-modal ${kind}-modal`;
  return (
    <div
      className={look === undefined ? frame : `${frame} ${look}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className="panel">
        <div className="modal-head">
          <div className="panel-head">
            {kind !== 'station' && <div className="panel-label">// {label}</div>}
            {edgework !== null && <EdgeworkChip edgework={edgework} />}
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Schließen"
            title="Schließen [Esc]"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
