import { tokenLabel } from '@escapelab/core';
import type { PanelProps } from './index.js';

type SignalPuzzle = PanelProps<'signal'>['puzzle'];

/** The stage, what this console does in it, and the signs pressed so far. */
function StageLine({ puzzle, task }: { puzzle: SignalPuzzle; task: string }) {
  return (
    <div className="puzzle-status">
      <span>{`Stufe ${puzzle.stage} von ${puzzle.stages} — dieses Pult ${task}`}</span>
      <span>{`${puzzle.done}/${puzzle.length}`}</span>
    </div>
  );
}

/**
 * The Signalkette in plain words and buttons: the sending console reads its
 * sequence out, the receiving console presses its twelve keys.
 */
export function SignalPanel({ puzzle, send }: PanelProps<'signal'>) {
  const wrong = puzzle.lastResult === 'wrong' && (
    <p className="warn">Falsches Zeichen — Stufe von vorn.</p>
  );
  if (puzzle.role === 'sender' && puzzle.sequence !== null) {
    return (
      <div>
        <StageLine puzzle={puzzle} task="sendet" />
        <p>{`Ansage: ${puzzle.sequence.map(tokenLabel).join(', ')}`}</p>
        {wrong}
      </div>
    );
  }
  if (puzzle.role === 'receiver' && puzzle.grid !== null) {
    return (
      <div>
        <StageLine puzzle={puzzle} task="gibt ein" />
        {wrong}
        <div>
          {puzzle.grid.map((token) => (
            <button key={token} data-token={token} onClick={() => send({ press: token })}>
              {tokenLabel(token)}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
}
