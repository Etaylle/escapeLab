import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission, viewFor } from '../src/index.js';
import { MAZE_DIRS } from '../src/puzzles/maze.js';
import type { Action, GameState, Mission } from '../src/index.js';

const mission: Mission = parseMission({
  id: 'mazetest',
  title: 'Labyrinth-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  roles: [
    { id: 'navigator', name: 'Navigator', description: '' },
    { id: 'lotse', name: 'Lotse', description: '' },
  ],
  puzzles: [
    {
      type: 'maze',
      id: 'netz',
      title: 'Netz',
      prompt: '',
      operatorRoleId: 'navigator',
      manualRoleId: 'lotse',
      size: 6,
      penaltySec: 12,
    },
  ],
});

const T0 = 1_000_000;

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

function started(seed = 7): GameState {
  return run(
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'select-role', playerId: 'p1', roleId: 'navigator' },
      { type: 'select-role', playerId: 'p2', roleId: 'lotse' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed },
    ],
    initialState(mission),
  );
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
  it('splits marker and walls between the two roles', () => {
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

  it('only the navigator may move the marker', () => {
    expect(() =>
      applyAction(started(), move('p2', 0, T0 + 1000)),
    ).toThrow(/Navigationspult/);
  });

  it('rejects a maze whose two roles are the same', () => {
    expect(() =>
      parseMission({
        ...JSON.parse(JSON.stringify(mission)),
        puzzles: [
          {
            ...JSON.parse(JSON.stringify(mission.puzzles[0])),
            manualRoleId: 'navigator',
          },
        ],
      }),
    ).toThrow(/operatorRoleId and manualRoleId must be different roles/);
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
