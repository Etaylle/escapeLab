import type { Move } from '../input/bindings.js';

/**
 * The steering pad under the left thumb on a touch screen: three by three
 * cells, the eight round the middle walking the eight ways — the corners two
 * keys at once, as W and D held together — and the middle standing still.
 * One finger steers: wherever it slides over the pad, or past its edge, the
 * cell nearest under it says the way, so the walk turns without the finger
 * lifting. Pure; the pad's markup and pointer events are GameWorld's.
 */

/** The ways a cell walks, read from the top row down; the middle one walks nowhere. */
export const PAD_CELLS: readonly (readonly [name: string, moves: readonly Move[]])[] = [
  ['up-left', ['up', 'left']],
  ['up', ['up']],
  ['up-right', ['up', 'right']],
  ['left', ['left']],
  ['stop', []],
  ['right', ['right']],
  ['down-left', ['down', 'left']],
  ['down', ['down']],
  ['down-right', ['down', 'right']],
];

/**
 * The ways a finger `dx`, `dy` from the pad's middle walks, the pad's cells
 * `cell` wide: up or down past half a cell from the middle row, left or
 * right past half a cell from the middle column — the cell under the finger,
 * or the one nearest it outside the pad.
 */
export function padMoves(dx: number, dy: number, cell: number): Move[] {
  const half = cell / 2;
  const moves: Move[] = [];
  if (dy < -half) {
    moves.push('up');
  } else if (dy > half) {
    moves.push('down');
  }
  if (dx < -half) {
    moves.push('left');
  } else if (dx > half) {
    moves.push('right');
  }
  return moves;
}

/** Where a finger is on the pad: its offset from the middle, and the pad's cell size. */
export interface PadTouch {
  /** the pointer's id: the finger that steers until it lifts */
  id: number;
  dx: number;
  dy: number;
  cell: number;
}

/**
 * The pad's steering: the finger that touched it first holds the ways its
 * cell walks, takes them along as it slides — letting go of a way it left and
 * pressing one it came to — and lets go of all as it lifts; a second finger
 * on the pad meanwhile steers nothing. `press` holds a way down or lets it go.
 */
export class PadSteer {
  private finger: number | null = null;
  private moves: readonly Move[] = [];

  constructor(private readonly press: (move: Move, down: boolean) => void) {}

  /** The ways the steering finger holds now; none while no finger is on the pad. */
  get held(): readonly Move[] {
    return this.moves;
  }

  /** A finger touched the pad. */
  down(touch: PadTouch): void {
    if (this.finger === null) {
      this.finger = touch.id;
      this.steer(padMoves(touch.dx, touch.dy, touch.cell));
    }
  }

  /** A finger moved, on the pad or past its edge. */
  move(touch: PadTouch): void {
    if (touch.id === this.finger) {
      this.steer(padMoves(touch.dx, touch.dy, touch.cell));
    }
  }

  /** A finger lifted, or the browser took it away. */
  up(id: number): void {
    if (id === this.finger) {
      this.finger = null;
      this.steer([]);
    }
  }

  private steer(moves: readonly Move[]): void {
    for (const move of this.moves) {
      if (!moves.includes(move)) {
        this.press(move, false);
      }
    }
    for (const move of moves) {
      if (!this.moves.includes(move)) {
        this.press(move, true);
      }
    }
    this.moves = moves;
  }
}
