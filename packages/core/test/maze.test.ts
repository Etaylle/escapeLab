import { describe, expect, it } from 'vitest';
import {
  applyAction,
  generateEdgework,
  parseMission,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import { MAZE_DIRS, mazeModule, type MazeDef, type MazeState } from '../src/puzzles/maze.js';
import type { Action, GameState, Mission, PuzzleContext } from '../src/index.js';
import { mulberry32 } from '../src/rng.js';
import { labMission, openLab, started as startedLab, T0 } from './lab.js';

const mission: Mission = labMission(
  [{ type: 'maze', id: 'netz', title: 'Netz', size: 6, penaltySec: 12 }],
  'mazetest',
);

/** Anna (p1) at the navigation desk, Ben (p2) at the wiring plan. */
function started(seed = 7): GameState {
  return openLab(startedLab(mission, seed));
}

/** One step of the marker; `dir` indexes MAZE_DIRS. */
function move(playerId: string, dir: number, at: number): Action {
  return { type: 'puzzle-input', playerId, at, input: { dir } };
}

function mazeState(state: GameState) {
  if (state.puzzleState?.type !== 'maze') {
    throw new Error('expected a maze puzzle state');
  }
  return state.puzzleState;
}

/** The directions that are open from the marker's current cell. */
function openDirs(state: GameState): number[] {
  const maze = mazeState(state);
  const mask = maze.cells[maze.pos.y * maze.size + maze.pos.x] ?? 0;
  return MAZE_DIRS.map((dir, i) => ({ dir, i }))
    .filter(({ dir }) => (mask & dir.bit) !== 0)
    .map(({ i }) => i);
}

describe('maze puzzle', () => {
  it('splits marker and walls between the station and the plan', () => {
    const state = started();
    const nav = viewFor(state, 'p1').puzzle;
    const guide = viewFor(state, 'p2').puzzle;
    if (nav?.kind !== 'maze' || guide?.kind !== 'maze') {
      throw new Error('expected maze views');
    }
    expect(nav.pos).not.toBeNull();
    expect(nav.cells).toBeNull();
    expect(guide.cells).toHaveLength(36);
    expect(guide.pos).toBeNull();
    // Both need the goal to talk about it.
    expect(nav.goal).toEqual(guide.goal);
    expect(JSON.stringify(nav)).not.toContain('"cells":[');
    expect(JSON.stringify(viewFor(state, 'p2'))).not.toContain('"pos":{');
    // The audience sees both halves at once.
    expect(viewForSpectator(state).puzzle).toMatchObject({ pos: nav.pos, cells: guide.cells });
  });

  it('generates the same maze for the same seed and a different one otherwise', () => {
    expect(mazeState(started(7)).cells).toEqual(mazeState(started(7)).cells);
    expect(mazeState(started(7)).cells).not.toEqual(mazeState(started(8)).cells);
  });

  it('carves a perfect maze where every cell is reachable', () => {
    const maze = mazeState(started());
    const seen = new Set([0]);
    const queue = [0];
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head] ?? 0;
      const x = cell % maze.size;
      const y = Math.floor(cell / maze.size);
      for (const dir of MAZE_DIRS) {
        if (((maze.cells[cell] ?? 0) & dir.bit) === 0) {
          continue;
        }
        const next = (y + dir.dy) * maze.size + (x + dir.dx);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(maze.size * maze.size);
  });

  it('starts the marker away from the goal', () => {
    const maze = mazeState(started());
    expect(maze.pos).not.toEqual(maze.goal);
  });

  it('moves through openings and solves on reaching the goal', () => {
    let state = started();
    const dir = openDirs(state)[0] ?? 0;
    const before = mazeState(state).pos;
    state = applyAction(state, move('p1', dir, T0 + 1000));
    expect(mazeState(state).pos).not.toEqual(before);
    expect(state.penaltySeq).toBe(0);

    // Walk the whole maze to the goal: at most size² steps via a simple BFS path.
    for (let guard = 0; guard < 200 && state.phase === 'playing'; guard++) {
      const maze = mazeState(state);
      const path = shortestPath(maze.cells, maze.size, maze.pos, maze.goal);
      const next = path[0];
      if (next === undefined) {
        break;
      }
      state = applyAction(state, move('p1', next, T0 + 2000 + guard));
    }
    expect(state.phase).toBe('won');
  });

  it('bumping a wall costs time and keeps the marker in place', () => {
    const state = started();
    const open = new Set(openDirs(state));
    const blocked = [0, 1, 2, 3].find((d) => !open.has(d));
    if (blocked === undefined) {
      throw new Error('expected at least one wall next to the start');
    }
    const before = state.deadlineAt ?? 0;
    const bumped = applyAction(state, move('p1', blocked, T0 + 1000));
    expect(mazeState(bumped).pos).toEqual(mazeState(state).pos);
    expect(mazeState(bumped).lastResult).toBe('wall');
    expect(bumped.deadlineAt).toBe(before - 12_000);
    expect(viewFor(bumped, 'p2').puzzle).toMatchObject({ lastResult: null });
  });

  it('only a player at the navigation desk may move the marker', () => {
    expect(() =>
      applyAction(started(), move('p2', 0, T0 + 1000)),
    ).toThrow('Eingabe nur am Pult.');
  });

  it('needs a manual object somewhere that holds the plan', () => {
    const raw = JSON.parse(JSON.stringify(mission));
    raw.map.manuals = [];
    expect(() => parseMission(raw)).toThrow(/no manual object covers puzzle "netz"/);
  });
});

describe('the printed maze rules', () => {
  const COLUMNS = 'ABCDEFGH';
  /** The printed directions, as indices into MAZE_DIRS. */
  const DIRECTIONS: Record<string, number> = { oben: 0, rechts: 1, unten: 2, links: 3 };
  const cellOf = (name = ''): { x: number; y: number } => ({
    x: COLUMNS.indexOf(name.charAt(0)),
    y: Number(name.slice(1)) - 1,
  });
  const ctx: PuzzleContext = {
    edgework: generateEdgework(mulberry32(1)),
    alarms: 0,
    remainingSec: 600,
    at: T0,
    crew: ['op', 'rd'],
    console: 'a',
    atConsoles: { a: [], b: [] },
    readers: [],
  };
  const defOf = (size: number): MazeDef =>
    mazeModule.defSchema.parse({ type: 'maze', id: 'netz', title: 'Netz', size, penaltySec: 12 });
  const blocksOf = (size: number) =>
    mazeModule.manual(defOf(size)).flatMap((section) => section.blocks);

  it.each([4, 6, 8])('name the columns and rows of a grid of %i, and what a wall costs', (size) => {
    const manual = mazeModule.manual(defOf(size));
    expect(manual.map(({ heading }) => heading)).toEqual([
      'Leitungsnetz mit Navigationspult, Typ LN-8 (Baujahr 1993)',
      'Aufbau',
      'Betrieb',
      'Aus der Werkstatt',
    ]);
    const grid =
      `${size} × ${size} Zellen, Spalten A bis ${COLUMNS.charAt(size - 1)} von links, ` +
      `Zeilen 1 bis ${size} von oben`;
    expect(manual[1]?.blocks[1]).toMatchObject({ kind: 'p', text: expect.stringContaining(grid) });
    expect(manual[2]?.blocks[0]).toMatchObject({
      kind: 'p',
      text: expect.stringMatching(/eine Wand, .* zieht 12 Sekunden Einsatzzeit ab\.$/),
    });
  });

  it.each([4, 6, 8])('print a log that the walls and the probe bear out, size %i', (size) => {
    const log = blocksOf(size).find((block) => block.kind === 'example');
    const lines = log?.kind === 'example' ? log.lines : [];
    const [seen, plan, step] = [
      /^\d\d:\d\d Prüfkopf auf ([A-H]\d), Ziel auf ([A-H]\d)\.$/,
      /^\d\d:\d\d Schaltplan: von ([A-H]\d) nach (\S+) eine Wand, nach (\S+) frei\.$/,
      /^\d\d:\d\d Ein Schritt nach (\S+): Prüfkopf auf ([A-H]\d)\.$/,
    ].map((pattern, i) => pattern.exec(lines[i] ?? ''));
    const wall = DIRECTIONS[plan?.[2] ?? ''];
    const open = DIRECTIONS[plan?.[3] ?? ''];
    if (!seen || !plan || !step || wall === undefined || open === undefined) {
      throw new Error(`unreadable log: ${JSON.stringify(lines)}`);
    }
    expect([plan[1], DIRECTIONS[step[1] ?? '']]).toEqual([seen[1], open]);
    // A grid whose one opening is the one the plan names, between the marker and its neighbour.
    const pos = cellOf(seen[1]);
    const goal = cellOf(seen[2]);
    const there = { x: pos.x + (MAZE_DIRS[open]?.dx ?? 0), y: pos.y + (MAZE_DIRS[open]?.dy ?? 0) };
    for (const cell of [pos, goal, there]) {
      expect(cell.x >= 0 && cell.y >= 0 && cell.x < size && cell.y < size, JSON.stringify(cell))
        .toBe(true);
    }
    const cells = new Array<number>(size * size).fill(0);
    cells[pos.y * size + pos.x] = MAZE_DIRS[open]?.bit ?? 0;
    cells[there.y * size + there.x] = MAZE_DIRS[(open + 2) % 4]?.bit ?? 0;
    const state: MazeState = { type: 'maze', size, cells, pos, goal, lastResult: null };
    const bumped = mazeModule.apply(defOf(size), state, { dir: wall }, 'op', ctx);
    expect(bumped.penalty).toBe('Gegen eine Wand gelaufen');
    expect(bumped.state.pos).toEqual(pos);
    const moved = mazeModule.apply(defOf(size), state, { dir: open }, 'op', ctx);
    expect(moved).toMatchObject({ solved: false, penalty: null });
    expect(moved.state.pos).toEqual(cellOf(step[2]));
  });
});

/** Directions to walk from `from` to `to`, shortest first. */
function shortestPath(
  cells: number[],
  size: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
): number[] {
  const start = from.y * size + from.x;
  const target = to.y * size + to.x;
  const prev = new Map<number, { cell: number; dir: number }>();
  const queue = [start];
  const seen = new Set([start]);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head] ?? 0;
    if (cell === target) {
      break;
    }
    const x = cell % size;
    const y = Math.floor(cell / size);
    for (const [i, dir] of MAZE_DIRS.entries()) {
      if (((cells[cell] ?? 0) & dir.bit) === 0) {
        continue;
      }
      const next = (y + dir.dy) * size + (x + dir.dx);
      if (!seen.has(next)) {
        seen.add(next);
        prev.set(next, { cell, dir: i });
        queue.push(next);
      }
    }
  }
  const dirs: number[] = [];
  let cursor = target;
  while (cursor !== start) {
    const step = prev.get(cursor);
    if (step === undefined) {
      return [];
    }
    dirs.unshift(step.dir);
    cursor = step.cell;
  }
  return dirs;
}
