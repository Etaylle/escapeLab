import type { PanelProps } from './index.js';

export function ButtonSyncPanel({ puzzle, send }: PanelProps<'button-sync'>) {
  return (
    <div>
      <button
        className="big-button"
        disabled={puzzle.youPressed}
        onClick={() => send({ press: true })}
      >
        {puzzle.youPressed ? '✓ GEDRÜCKT' : '⏻ DRÜCKEN'}
      </button>
      <div className="puzzle-status">
        <span>
          {puzzle.pressedCount}/{puzzle.requiredCount} bestätigt
        </span>
        {puzzle.lastResult === 'missed-window' && (
          <span className="warn">⚠ Zeitfenster verpasst (Versuch {puzzle.attempts})</span>
        )}
      </div>
    </div>
  );
}
