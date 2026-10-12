import { play } from '../sounds.js';
import type { PanelProps } from './index.js';
import './keypad.css';

/** Keys on the pad; roles without the keys only learn how many are lit. */
const KEY_COUNT = 4;

export function KeypadPanel({ puzzle, send }: PanelProps<'keypad'>) {
  const status = (
    <p className="progress-line">
      Freigeschaltet: {puzzle.litCount}/{KEY_COUNT}
    </p>
  );
  if (puzzle.keys === null) {
    return (
      <div className="big-hint">
        <p className="muted">
          Die Zeichen sieht nur, wer am Tastenfeld steht — lass sie dir beschreiben. Im Handbuch
          enthält genau eine Spalte alle vier; ihre Reihenfolge dort, von oben nach unten, ist der
          Code.
        </p>
        {status}
      </div>
    );
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
