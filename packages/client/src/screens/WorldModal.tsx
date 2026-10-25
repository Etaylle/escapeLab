import type { ReactNode } from 'react';
import type { Edgework } from '@escapelab/core';
import { EdgeworkChip } from './EdgeworkChip.js';

/**
 * The frame a station's device, a manual object's pages and a note of the
 * last shift open in, over the world: what you are reading — a station's
 * device carries its own label plate, so its name stays with the dialog —
 * and the Laborkennung once you have read it. No window's ✕: a sheet says at
 * its foot how it is put down (PutDown.tsx), a device on its chassis how to
 * step back (puzzles/Device.tsx).
 */
export function WorldModal({
  kind,
  look,
  label,
  edgework,
  leaving = false,
  foot = null,
  children,
}: {
  /** names the frame's class: `station-modal`, `reading-modal` or `note-modal` */
  kind: 'station' | 'reading' | 'note';
  /** further classes for what is inside: a book, a terminal, a wall chart */
  look?: string;
  /** the dialog's name; printed over a manual object's pages and a note */
  label: string;
  edgework: Edgework | null;
  /** put down and on its way out of view (PutDown.tsx `usePutDown`): it takes nothing more */
  leaving?: boolean;
  /** what stands at the frame's foot: the way a sheet is put down */
  foot?: ReactNode;
  children: ReactNode;
}) {
  const frame = `puzzle-modal ${kind}-modal`;
  const classes = [frame, look, leaving ? 'puzzle-modal--leaving' : null].filter(Boolean);
  const named = kind !== 'station';
  return (
    <div
      className={classes.join(' ')}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      inert={leaving}
    >
      <div className="panel">
        {(named || edgework !== null) && (
          <div className="modal-head">
            <div className="panel-head">
              {named && <div className="panel-label">// {label}</div>}
              {edgework !== null && <EdgeworkChip edgework={edgework} />}
            </div>
          </div>
        )}
        {children}
        {foot}
      </div>
    </div>
  );
}
