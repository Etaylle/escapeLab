import { play } from '../sounds.js';
import { Dots } from './Dots.js';
import type { PanelProps } from './index.js';

export function KeypadPanel({ puzzle, send }: PanelProps<'keypad'>) {
  if (puzzle.grid === null) {
    return (
      <div className="big-hint">
        <p className="muted">
          Das Tastenfeld ist auf der anderen Seite — hier zählt der Code aus deinen Unterlagen.
        </p>
        <Dots total={puzzle.codeLength} done={puzzle.progress} />
      </div>
    );
  }
  return (
    <div>
      <Dots total={puzzle.codeLength} done={puzzle.progress} />
      <div className="keypad">
        {puzzle.grid.map((key, i) => (
          <button
            key={i}
            className={`key ${key.done ? 'key-done' : ''} ${
              puzzle.lastWrongIndex === i ? 'key-wrong' : ''
            }`}
            disabled={key.done}
            onClick={() => {
              play('click');
              send({ keyIndex: i });
            }}
          >
            {key.symbol}
          </button>
        ))}
      </div>
    </div>
  );
}
