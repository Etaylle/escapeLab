import type { ReactNode } from 'react';
import type { Edgework } from '@escapelab/core';
import { EdgeworkChip } from './EdgeworkChip.js';

/**
 * The frame a station's panel and a manual object's pages open in, over the
 * world: what you are looking at, the Laborkennung once you have read it,
 * and the way out.
 */
export function WorldModal({
  kind,
  look,
  label,
  edgework,
  onClose,
  children,
}: {
  /** names the frame's class: `station-modal` or `reading-modal` */
  kind: 'station' | 'reading';
  /** further classes for what is inside: a book, a terminal, a wall chart */
  look?: string;
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
            <div className="panel-label">// {label}</div>
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
