import { play } from '../sounds.js';
import type { PanelProps } from './index.js';

export function SwitchesPanel({ puzzle, send }: PanelProps<'switches'>) {
  if (puzzle.switches === null) {
    return (
      <div className="big-hint">
        {puzzle.target !== null ? (
          <>
            <p>Diese Schalter müssen nach <strong>OBEN</strong> — alle anderen nach unten:</p>
            <div className="target-symbols">
              {puzzle.target.map((s) => (
                <span key={s} className="target-symbol">
                  {s}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">
            Die Sollwerte stehen auf einer anderen Station — koordiniere, statt zu raten.
          </p>
        )}
        <p className="muted">Es müssen genau {puzzle.targetCount} Schalter oben sein.</p>
      </div>
    );
  }
  const upCount = puzzle.switches.filter((s) => s.on).length;
  return (
    <div>
      <div className="switchbank">
        {puzzle.switches.map((sw, i) => (
          <button
            key={i}
            className={`switch ${sw.on ? 'switch-on' : ''}`}
            onClick={() => {
              play('click');
              send({ switchIndex: i });
            }}
          >
            <span className="switch-state">{sw.on ? 'OBEN' : 'unten'}</span>
            <span className="switch-lever" aria-hidden="true">
              <span className="switch-knob" />
            </span>
            <span className="switch-symbol">{sw.symbol}</span>
          </button>
        ))}
      </div>
      <div className="commit-row">
        <span className="muted">
          {upCount}/{puzzle.targetCount} oben
        </span>
        <button className="primary" onClick={() => send({ commit: true })}>
          ⏻ PRÜFEN
        </button>
      </div>
    </div>
  );
}
