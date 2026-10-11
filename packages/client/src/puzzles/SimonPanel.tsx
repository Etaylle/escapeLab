import { useEffect, useRef, useState } from 'react';
import { play, simonTone } from '../sounds.js';
import { Dots } from './Dots.js';
import type { PanelProps } from './index.js';

const SIMON_COLOR_MAP: Record<string, { hex: string; label: string }> = {
  rot: { hex: '#ef4444', label: 'ROT' },
  gruen: { hex: '#22c55e', label: 'GRÜN' },
  blau: { hex: '#3b82f6', label: 'BLAU' },
  gelb: { hex: '#eab308', label: 'GELB' },
};

export function SimonPanel({ puzzle, send }: PanelProps<'simon'>) {
  const [flashing, setFlashing] = useState<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (puzzle.legend !== null) {
    return (
      <div className="big-hint">
        <p>Deine Übersetzungslegende — Farbe → Steuerimpuls:</p>
        <div className="legend">
          {puzzle.legend.map((entry) => {
            const color = SIMON_COLOR_MAP[entry.color] ?? { hex: '#999', label: entry.color };
            return (
              <div key={entry.color} className="legend-row">
                <span className="legend-color" style={{ background: color.hex }}>
                  {color.label}
                </span>
                <span className="legend-arrow">→</span>
                <span className="legend-symbol">{entry.symbol}</span>
              </div>
            );
          })}
        </div>
        <Dots total={puzzle.seqLength} done={puzzle.progress} />
      </div>
    );
  }
  if (puzzle.sequence === null || puzzle.buttons === null) {
    return (
      <div className="big-hint">
        <p className="muted">Die Frequenzanzeige läuft an einer anderen Station.</p>
        <Dots total={puzzle.seqLength} done={puzzle.progress} />
      </div>
    );
  }

  const sequence = puzzle.sequence;
  function playSequence(): void {
    timers.current.forEach(clearTimeout);
    timers.current = sequence.map((color, i) => {
      const colorIdx = Object.keys(SIMON_COLOR_MAP).indexOf(color);
      return setTimeout(() => {
        setFlashing(i);
        simonTone(colorIdx);
        timers.current.push(setTimeout(() => setFlashing(null), 620));
      }, i * 800);
    });
  }

  const current = flashing !== null ? sequence[flashing] : undefined;
  const lamp = current !== undefined ? SIMON_COLOR_MAP[current] : undefined;
  return (
    <div>
      <div className="simon-lamp" style={lamp !== undefined ? { background: lamp.hex } : {}}>
        {lamp !== undefined ? (
          <span>
            {lamp.label} ({(flashing ?? 0) + 1}/{sequence.length})
          </span>
        ) : (
          <span className="muted">Signal bereit</span>
        )}
      </div>
      <div className="simon-controls">
        <button onClick={playSequence}>▶ FOLGE ABSPIELEN</button>
        <Dots total={puzzle.seqLength} done={puzzle.progress} />
      </div>
      <div className="simon-buttons">
        {puzzle.buttons.map((symbol, i) => (
          <button
            key={i}
            className={`key ${puzzle.lastWrongIndex === i ? 'key-wrong' : ''}`}
            onClick={() => {
              play('click');
              send({ buttonIndex: i });
            }}
          >
            {symbol}
          </button>
        ))}
      </div>
    </div>
  );
}
