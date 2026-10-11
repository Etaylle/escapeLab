import { play } from '../sounds.js';
import type { PanelProps } from './index.js';

export function WiringPanel({ puzzle, send }: PanelProps<'wiring'>) {
  if (puzzle.wires === null) {
    return (
      <div className="big-hint">
        <p className="muted">
          Du siehst den Sicherungskasten nicht — hier zählt dein Wissen. Frag, welche Zeichen auf
          den Kabeln stehen!
        </p>
        <div className="progress-line">
          Getrennt: {puzzle.cutsDone}/{puzzle.cutsNeeded}
        </div>
      </div>
    );
  }
  const n = puzzle.wires.length;
  const rowH = 46;
  return (
    <div>
      <svg
        className="wirebox"
        viewBox={`0 0 420 ${n * rowH + 20}`}
        role="group"
        aria-label="Sicherungskasten"
      >
        {puzzle.wires.map((wire, i) => {
          const y = 34 + i * rowH;
          const wrong = puzzle.lastWrongWireId === wire.id;
          return (
            <g
              key={wire.id}
              className={`wire ${wire.cut ? 'wire-cut' : ''} ${wrong ? 'wire-wrong' : ''}`}
              onClick={() => {
                if (!wire.cut) {
                  play('click');
                  send({ wireId: wire.id });
                }
              }}
            >
              <text x={18} y={y + 6} className="wire-symbol" textAnchor="middle">
                {wire.left}
              </text>
              {wire.cut ? (
                <>
                  <path d={`M 40 ${y} C 110 ${y}, 150 ${y + 14}, 185 ${y + 18}`}
                    stroke={wire.color} />
                  <path d={`M 235 ${y + 18} C 270 ${y + 14}, 310 ${y}, 380 ${y}`}
                    stroke={wire.color} />
                  <text x={210} y={y + 16} className="wire-scissors" textAnchor="middle">
                    ✂
                  </text>
                </>
              ) : (
                <>
                  <path d={`M 40 ${y} C 150 ${y - 8}, 270 ${y + 8}, 380 ${y}`}
                    stroke={wire.color} />
                  <path
                    className="wire-hit"
                    d={`M 40 ${y} C 150 ${y - 8}, 270 ${y + 8}, 380 ${y}`}
                  />
                </>
              )}
              <text x={402} y={y + 6} className="wire-symbol" textAnchor="middle">
                {wire.right}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="muted">
        Kabel anklicken trennt es sofort — getrennt: {puzzle.cutsDone}/{puzzle.cutsNeeded}
      </p>
    </div>
  );
}
