import { useState } from 'react';
import { play } from '../sounds.js';
import { Dots } from './Dots.js';
import type { PanelProps } from './index.js';
import './memory.css';

const STAGES = 5;

type MemoryPuzzle = PanelProps<'memory'>['puzzle'];

/**
 * How often the bank fell back to stage 1 while this panel was up. Once the
 * bank runs, only a wrong press lands on stage 1, so every change that
 * arrives there counts — at stage 1 itself the operator sees it as a fresh
 * layout. A new puzzle is a fresh start, not a fall.
 */
function useResets(puzzle: MemoryPuzzle): number {
  const shown = [puzzle.index, puzzle.stage, puzzle.display, puzzle.labels?.join('')].join('/');
  const [seen, setSeen] = useState({ index: puzzle.index, shown, resets: 0 });
  if (seen.shown === shown) {
    return seen.resets;
  }
  const fell = seen.index === puzzle.index && puzzle.stage === 1;
  const resets = fell ? seen.resets + 1 : seen.resets;
  setSeen({ index: puzzle.index, shown, resets });
  return resets;
}

/** The display digit over the four buttons, as the operator reads them out. */
function Bank({
  display,
  labels,
  send,
}: {
  display: number;
  labels: number[];
  send: PanelProps<'memory'>['send'];
}) {
  return (
    <>
      <div className="memory-display" role="img" aria-label={`Display zeigt ${display}`}>
        {display}
      </div>
      <div className="memory-keys">
        {labels.map((label, position) => (
          <button
            key={position}
            className="memory-key"
            aria-label={`Taste ${position + 1} von links, Beschriftung ${label}`}
            onClick={() => {
              play('click');
              send({ position });
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

export function MemoryPanel({ puzzle, send }: PanelProps<'memory'>) {
  const resets = useResets(puzzle);
  return (
    <div className="memory">
      <div className="memory-stage">
        <span>
          Stufe {puzzle.stage}/{STAGES}
        </span>
        <Dots total={STAGES} done={puzzle.stage - 1} />
      </div>
      {puzzle.display !== null && puzzle.labels !== null && (
        <Bank display={puzzle.display} labels={puzzle.labels} send={send} />
      )}
      {resets > 0 && (
        <p key={resets} className="memory-reset" role="status">
          Zurück auf Stufe 1
        </p>
      )}
    </div>
  );
}
