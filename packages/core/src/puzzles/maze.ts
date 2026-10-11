import type { MazePuzzleDef } from '../mission.js';
import type { Rng } from '../rng.js';

/**
 * Invisible maze: the navigator sees their own marker and the goal but no
 * walls, the guide sees the walls but not the marker. Only talking to each
 * other gets the marker out.
 */

/** Movement directions, with the bit each one sets in a cell's open-sides mask. */
export const MAZE_DIRS = [
  { dx: 0, dy: -1, bit: 1 }, // north
  { dx: 1, dy: 0, bit: 2 }, // east
  { dx: 0, dy: 1, bit: 4 }, // south
  { dx: -1, dy: 0, bit: 8 }, // west
] as const;

const OPPOSITE = [2, 3, 0, 1] as const;

export interface MazeState {
  type: 'maze';
  size: number;
  /** per cell, row-major: bitmask of sides that are open */
  cells: number[];
  pos: { x: number; y: number };
  goal: { x: number; y: number };
  lastResult: 'wall' | null;
}

const idx = (size: number, x: number, y: number): number => y * size + x;
const inside = (size: number, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < size && y < size;

/** Recursive backtracker: produces a perfect maze, so every cell is reachable. */
function carve(size: number, rng: Rng): number[] {
  const cells = new Array<number>(size * size).fill(0);
  const visited = new Array<boolean>(size * size).fill(false);
  const start = { x: Math.floor(rng() * size), y: Math.floor(rng() * size) };
  const stack: { x: number; y: number }[] = [start];
  visited[idx(size, start.x, start.y)] = true;

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    if (current === undefined) {
      break;
    }
    const options = MAZE_DIRS.map((dir, i) => ({ dir, i }))
      .filter(({ dir }) => {
        const nx = current.x + dir.dx;
        const ny = current.y + dir.dy;
        return inside(size, nx, ny) && visited[idx(size, nx, ny)] !== true;
      });
    const pick = options[Math.floor(rng() * options.length)];
    if (pick === undefined) {
      stack.pop();
      continue;
    }
    const nx = current.x + pick.dir.dx;
    const ny = current.y + pick.dir.dy;
    const here = idx(size, current.x, current.y);
    const there = idx(size, nx, ny);
    const back = MAZE_DIRS[OPPOSITE[pick.i] ?? 0]?.bit ?? 0;
    cells[here] = (cells[here] ?? 0) | pick.dir.bit;
    cells[there] = (cells[there] ?? 0) | back;
    visited[there] = true;
    stack.push({ x: nx, y: ny });
  }
  return cells;
}

/** Breadth-first search from `from`, returning the cell that is hardest to reach. */
function farthestFrom(
  size: number,
  cells: number[],
  from: { x: number; y: number },
): { x: number; y: number } {
  const dist = new Array<number>(size * size).fill(-1);
  dist[idx(size, from.x, from.y)] = 0;
  const queue = [from];
  let best = from;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    if (cell === undefined) {
      break;
    }
    const here = idx(size, cell.x, cell.y);
    if ((dist[here] ?? 0) > (dist[idx(size, best.x, best.y)] ?? 0)) {
      best = cell;
    }
    for (const dir of MAZE_DIRS) {
      if (((cells[here] ?? 0) & dir.bit) === 0) {
        continue;
      }
      const nx = cell.x + dir.dx;
      const ny = cell.y + dir.dy;
      if (inside(size, nx, ny) && dist[idx(size, nx, ny)] === -1) {
        dist[idx(size, nx, ny)] = (dist[here] ?? 0) + 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return best;
}

export function initMaze(def: MazePuzzleDef, rng: Rng): MazeState {
  const size = def.size;
  const cells = carve(size, rng);
  const pos = { x: Math.floor(rng() * size), y: Math.floor(rng() * size) };
  return { type: 'maze', size, cells, pos, goal: farthestFrom(size, cells, pos), lastResult: null };
}

export interface MazeResult {
  state: MazeState;
  solved: boolean;
  /** true when the marker ran into a wall — it stays put and time is lost */
  penalty: boolean;
}

export function moveMaze(state: MazeState, dirIndex: number): MazeResult {
  const dir = MAZE_DIRS[dirIndex];
  if (dir === undefined) {
    return { state, solved: false, penalty: false };
  }
  const here = idx(state.size, state.pos.x, state.pos.y);
  if (((state.cells[here] ?? 0) & dir.bit) === 0) {
    return { state: { ...state, lastResult: 'wall' }, solved: false, penalty: true };
  }
  const pos = { x: state.pos.x + dir.dx, y: state.pos.y + dir.dy };
  return {
    state: { ...state, pos, lastResult: null },
    solved: pos.x === state.goal.x && pos.y === state.goal.y,
    penalty: false,
  };
}
