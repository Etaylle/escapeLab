import { Icon } from '../screens/Icon.js';
import type { Change } from './feel.js';
import type { PanelProps, ReaderProps } from './index.js';
import { stepTick, wallThud } from './sounds.js';

type MazePuzzle = PanelProps<'maze'>['puzzle'];
type MazeChange = Change<MazePuzzle>;

const COLS = 'ABCDEFGH';
const CELL = 34;

/** Whether a change moved the marker a field on. */
export function steppedWith(change: MazeChange | null): boolean {
  const before = change?.before.pos ?? null;
  const after = change?.after.pos ?? null;
  return before !== null && after !== null && (before.x !== after.x || before.y !== after.y);
}

/**
 * Whether a change ran the marker into a wall: an alarm with the marker against one. Two
 * bumps in a row change nothing on the grid, so it is the alarm that tells them apart.
 */
export function bumpedWith(change: MazeChange | null): boolean {
  return change !== null && change.alarm && change.after.lastResult === 'wall';
}

/** What a change sounds like: a tick for every step, a dull thud against a wall. */
export function mazeSounds(change: MazeChange): void {
  if (bumpedWith(change)) {
    wallThud();
  } else if (steppedWith(change)) {
    stepTick();
  }
}

/**
 * The marker's classes: flashing red and shaking with a bump — every other bump named
 * apart (`bump`, the change's number), so that each starts it over.
 */
function markerClass(bump: number | null): string {
  return bump === null
    ? 'maze-marker'
    : `maze-marker maze-marker--bump maze-marker--bump-${bump % 2 === 1 ? 'odd' : 'even'}`;
}

/**
 * Shared grid chrome for both maze views: labels, goal flag, optional walls; the marker
 * where the operator sees it, gliding a field on with every step.
 */
function MazeGrid({ puzzle, bump }: { puzzle: MazePuzzle; bump: number | null }) {
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
          className={markerClass(bump)}
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
  return puzzle.cells === null ? null : <MazeGrid puzzle={puzzle} bump={null} />;
}

export function MazePanel({ puzzle, change, send }: PanelProps<'maze'>) {
  if (puzzle.pos === null) {
    return <MazePlan puzzle={puzzle} />;
  }
  const goalName = `${COLS[puzzle.goal.x] ?? '?'}${puzzle.goal.y + 1}`;
  const here = `${COLS[puzzle.pos.x] ?? '?'}${puzzle.pos.y + 1}`;
  return (
    <div>
      <p className="maze-readout">
        <span className="device-engraving">POSITION</span>
        <span className="maze-lcd">{here}</span>
        <span className="device-engraving">ZIEL</span>
        <span className="maze-lcd">{goalName}</span>
      </p>
      <MazeGrid puzzle={puzzle} bump={change !== null && bumpedWith(change) ? change.seq : null} />
      {puzzle.lastResult === 'wall' && (
        <p className="warn">
          <Icon name="warning" /> Wand — der Prüfkopf bleibt stehen.
        </p>
      )}
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
            onClick={() => send({ dir })}
            aria-label={area}
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
