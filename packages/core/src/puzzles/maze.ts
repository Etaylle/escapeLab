import { z } from 'zod';
import type { Rng } from '../rng.js';
import { commonDefShape, type PuzzleModule } from './module.js';
import { deviceFigure, penaltyLine, workedExample } from './printed.js';

/**
 * Invisible maze: the operator (navigator) at the station sees the marker
 * and the goal but no walls, the reader (guide) at the wiring plan sees the
 * walls but not the marker. Only talking to each other gets the marker out.
 * Bumping a wall costs time.
 */
const defSchema = z.strictObject({
  type: z.literal('maze'),
  ...commonDefShape,
  size: z.number().int().min(4).max(8).default(6),
  penaltySec: z.number().int().positive().default(15),
});
export type MazeDef = z.infer<typeof defSchema>;

/** Movement directions, with the bit each one sets in a cell's open-sides mask. */
export const MAZE_DIRS = [
  { dx: 0, dy: -1, bit: 1 }, // north
  { dx: 1, dy: 0, bit: 2 }, // east
  { dx: 0, dy: 1, bit: 4 }, // south
  { dx: -1, dy: 0, bit: 8 }, // west
] as const;

const OPPOSITE = [2, 3, 0, 1] as const;

/** The worked example: one step, on cells that every grid from 4 × 4 up has. */
const EXAMPLE: readonly string[] = [
  'Gesehen am Navigationspult: Marker auf B2, Ziel auf D4.',
  'Schaltplan: von B2 nach rechts eine Wand, nach unten frei.',
  'Ein Schritt nach unten: Marker auf B3.',
];

export interface MazeState {
  type: 'maze';
  size: number;
  /** per cell, row-major: bitmask of sides that are open */
  cells: number[];
  pos: { x: number; y: number };
  goal: { x: number; y: number };
  lastResult: 'wall' | null;
}

const inputSchema = z.strictObject({ dir: z.number().int().min(0).max(3) });
export type MazeInput = z.infer<typeof inputSchema>;

export interface MazeView {
  kind: 'maze';
  size: number;
  /** the marker — only operators see it */
  pos: { x: number; y: number } | null;
  goal: { x: number; y: number };
  /** per-cell open-side bitmasks — only readers see them */
  cells: number[] | null;
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

/**
 * Breadth-first search over the open sides from `from`: the cells in visiting
 * order, the distance to each and the direction of the first step on a
 * shortest way there.
 */
function explore(
  size: number,
  cells: number[],
  from: { x: number; y: number },
): { order: number[]; dist: number[]; firstDir: number[] } {
  const start = idx(size, from.x, from.y);
  const dist = new Array<number>(size * size).fill(-1);
  const firstDir = new Array<number>(size * size).fill(-1);
  dist[start] = 0;
  const order = [start];
  for (let head = 0; head < order.length; head++) {
    const here = order[head] ?? start;
    const x = here % size;
    const y = Math.floor(here / size);
    for (const [i, dir] of MAZE_DIRS.entries()) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (((cells[here] ?? 0) & dir.bit) === 0 || !inside(size, nx, ny)) {
        continue;
      }
      const there = idx(size, nx, ny);
      if (dist[there] === -1) {
        dist[there] = (dist[here] ?? 0) + 1;
        firstDir[there] = here === start ? i : (firstDir[here] ?? -1);
        order.push(there);
      }
    }
  }
  return { order, dist, firstDir };
}

/** The cell that is hardest to reach from `from`; on a tie, the one visited first. */
function farthestFrom(
  size: number,
  cells: number[],
  from: { x: number; y: number },
): { x: number; y: number } {
  const { order, dist } = explore(size, cells, from);
  let best = idx(size, from.x, from.y);
  for (const cell of order) {
    if ((dist[cell] ?? 0) > (dist[best] ?? 0)) {
      best = cell;
    }
  }
  return { x: best % size, y: Math.floor(best / size) };
}

export const mazeModule: PuzzleModule<MazeDef, MazeState, MazeInput, MazeView> = {
  type: 'maze',
  usesEdgework: false,
  wholeCrew: false,
  fields: [
    {
      key: 'size',
      label: 'Größe',
      help: 'Felder je Seite des Labyrinths; je größer, desto länger der Weg.',
      kind: 'int',
      min: 4,
      max: 8,
      default: 6,
    },
  ],
  defSchema,
  inputSchema,

  init(def, rng) {
    const size = def.size;
    const cells = carve(size, rng);
    const pos = { x: Math.floor(rng() * size), y: Math.floor(rng() * size) };
    const goal = farthestFrom(size, cells, pos);
    return { type: 'maze', size, cells, pos, goal, lastResult: null };
  },

  apply(_def, state, input) {
    const dir = MAZE_DIRS[input.dir];
    if (dir === undefined) {
      return { state, solved: false, penalty: null };
    }
    const here = idx(state.size, state.pos.x, state.pos.y);
    if (((state.cells[here] ?? 0) & dir.bit) === 0) {
      return {
        state: { ...state, lastResult: 'wall' },
        solved: false,
        penalty: 'Gegen eine Wand gelaufen',
      };
    }
    const pos = { x: state.pos.x + dir.dx, y: state.pos.y + dir.dy };
    return {
      state: { ...state, pos, lastResult: null },
      solved: pos.x === state.goal.x && pos.y === state.goal.y,
      penalty: null,
    };
  },

  view(_def, state, viewer) {
    return {
      kind: 'maze',
      size: state.size,
      pos: viewer.operating ? { ...state.pos } : null,
      goal: { ...state.goal },
      cells: viewer.reading ? [...state.cells] : null,
      lastResult: viewer.operating ? state.lastResult : null,
    };
  },

  manual(def) {
    const lastColumn = 'ABCDEFGH'.charAt(def.size - 1);
    return [
      {
        heading: 'Leitungsnetz',
        blocks: [
          deviceFigure('maze', 'Navigationspult mit Raster'),
          {
            kind: 'p',
            text:
              `Ein Raster aus ${def.size} × ${def.size} Zellen, Spalten A bis ${lastColumn} ` +
              `von links, Zeilen 1 bis ${def.size} von oben; eine Zelle heißt nach Spalte und ` +
              'Zeile, etwa C4. Das Navigationspult zeigt den Marker und das Ziel, der ' +
              'Schaltplan die Wände und das Ziel. Der Marker muss ins Ziel, Schritt für ' +
              'Schritt nach oben, unten, links oder rechts.',
          },
          {
            kind: 'rules',
            items: [
              'Wenn zwischen Marker und Nachbarzelle keine Wand steht, rückt der Marker mit ' +
                'einem Schritt dorthin.',
              'Andernfalls bleibt der Marker stehen; der Schritt ist ein Fehlgriff.',
            ],
          },
          workedExample(EXAMPLE),
          penaltyLine(def.penaltySec),
        ],
      },
    ];
  },

  solve(def, { operator, reader }) {
    if (operator.pos === null || reader.cells === null) {
      throw new Error(`maze "${def.id}": solving needs the navigator and the guide views`);
    }
    const { firstDir } = explore(operator.size, reader.cells, operator.pos);
    const dir = firstDir[idx(operator.size, operator.goal.x, operator.goal.y)] ?? -1;
    return dir < 0 ? [] : [{ by: 'operator', input: { dir } }];
  },
};
