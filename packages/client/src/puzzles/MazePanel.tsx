import { play } from '../sounds.js';
import type { PanelProps, ReaderProps } from './index.js';

const COLS = 'ABCDEFGH';
const CELL = 34;

/** Shared grid chrome for both maze views: labels, goal flag, optional walls. */
function MazeGrid({ puzzle }: { puzzle: PanelProps<'maze'>['puzzle'] }) {
  const n = puzzle.size;
  const pad = 18;
  const span = n * CELL;
  return (
    <svg
      className="maze"
      viewBox={`0 0 ${span + pad * 2} ${span + pad * 2}`}
      role="img"
      aria-label="Labyrinth"
    >
      {Array.from({ length: n }, (_, i) => (
        <g key={`label-${i}`} className="maze-label">
          <text x={pad + i * CELL + CELL / 2} y={pad - 5} textAnchor="middle">
            {COLS[i]}
          </text>
          <text x={pad - 6} y={pad + i * CELL + CELL / 2 + 4} textAnchor="end">
            {i + 1}
          </text>
        </g>
      ))}
      <rect x={pad} y={pad} width={span} height={span} className="maze-frame" />
      {puzzle.cells !== null &&
        Array.from({ length: n * n }, (_, i) => {
          const x = pad + (i % n) * CELL;
          const y = pad + Math.floor(i / n) * CELL;
          const open = puzzle.cells?.[i] ?? 0;
          return (
            <g key={`cell-${i}`} className="maze-wall">
              {(open & 1) === 0 && <line x1={x} y1={y} x2={x + CELL} y2={y} />}
              {(open & 2) === 0 && <line x1={x + CELL} y1={y} x2={x + CELL} y2={y + CELL} />}
              {(open & 4) === 0 && <line x1={x} y1={y + CELL} x2={x + CELL} y2={y + CELL} />}
              {(open & 8) === 0 && <line x1={x} y1={y} x2={x} y2={y + CELL} />}
            </g>
          );
        })}
      <g className="maze-goal">
        <rect
          x={pad + puzzle.goal.x * CELL + 7}
          y={pad + puzzle.goal.y * CELL + 7}
          width={CELL - 14}
          height={CELL - 14}
          rx={3}
        />
      </g>
      {puzzle.pos !== null && (
        <circle
          className={`maze-marker ${puzzle.lastResult === 'wall' ? 'maze-marker-bump' : ''}`}
          cx={pad + puzzle.pos.x * CELL + CELL / 2}
          cy={pad + puzzle.pos.y * CELL + CELL / 2}
          r={9}
        />
      )}
    </svg>
  );
}

/** The wiring plan at a manual object: the walls and the goal, never the marker. */
export function MazePlan({ puzzle }: ReaderProps<'maze'>) {
  return puzzle.cells === null ? null : <MazeGrid puzzle={puzzle} />;
}

export function MazePanel({ puzzle, send }: PanelProps<'maze'>) {
  if (puzzle.pos === null) {
    return <MazePlan puzzle={puzzle} />;
  }
  const goalName = `${COLS[puzzle.goal.x] ?? '?'}${puzzle.goal.y + 1}`;
  const here = `${COLS[puzzle.pos.x] ?? '?'}${puzzle.pos.y + 1}`;
  return (
    <div>
      <p className="muted">
        Du stehst auf <strong>{here}</strong>, das Ziel ist <strong>{goalName}</strong>. Die
        Wände sieht nur dein Team — frag nach jeder Richtung!
      </p>
      <MazeGrid puzzle={puzzle} />
      {puzzle.lastResult === 'wall' && <p className="warn">⚠ Gegen die Wand gelaufen!</p>}
      <div className="maze-pad">
        {(
          [
            [0, '↑', 'up'],
            [3, '←', 'left'],
            [1, '→', 'right'],
            [2, '↓', 'down'],
          ] as const
        ).map(([dir, glyph, area]) => (
          <button
            key={area}
            className={`maze-btn maze-btn--${area}`}
            onClick={() => {
              play('click');
              send({ dir });
            }}
            aria-label={area}
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
