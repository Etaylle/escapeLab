import { play } from '../sounds.js';
import type { PanelProps } from './index.js';
import './keypad.css';

/** Keys on the pad; a view without the keys only learns how many are lit. */
const KEY_COUNT = 4;

export function KeypadPanel({ puzzle, send }: PanelProps<'keypad'>) {
  const status = (
    <p className="progress-line">
      Freigeschaltet: {puzzle.litCount}/{KEY_COUNT}
    </p>
  );
  if (puzzle.keys === null) {
    return status;
  }
  return (
    <div>
      <div className="keypad-grid">
        {puzzle.keys.map((key, i) => (
          <button
            key={i}
            className={key.lit ? 'keypad-key keypad-key--lit' : 'keypad-key'}
            disabled={key.lit}
            onClick={() => {
              play('click');
              send({ keyIndex: i });
            }}
          >
            {key.glyph}
          </button>
        ))}
      </div>
      {status}
    </div>
  );
}
