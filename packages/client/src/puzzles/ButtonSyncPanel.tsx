import type { PanelProps } from './index.js';

export function ButtonSyncPanel({ puzzle, send }: PanelProps<'button-sync'>) {
  return (
    <div>
      {puzzle.buttonLabel !== null ? (
        <button
          className="big-button"
          disabled={puzzle.youPressed}
          onClick={() => send({ press: true })}
        >
          {puzzle.youPressed ? '✓ GEDRÜCKT — WARTE AUFS TEAM' : `⏻ ${puzzle.buttonLabel}`}
        </button>
      ) : (
        <p className="muted">Du hast hier keinen Knopf — deine Aufgabe ist reden, nicht drücken.</p>
      )}
      <div className="puzzle-status">
        <span>
          {puzzle.pressedCount}/{puzzle.requiredCount} bestätigt
        </span>
        {puzzle.lastResult === 'missed-window' && (
          <span className="warn">
            ⚠ Zeitfenster verpasst (Versuch {puzzle.attempts}) — nochmal, diesmal gleichzeitig!
          </span>
        )}
      </div>
    </div>
  );
}
