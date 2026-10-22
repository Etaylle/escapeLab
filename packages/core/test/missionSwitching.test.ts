import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission, viewFor } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';

const blackout: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);
const tutorial: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);
const kettenreaktion: Mission = parseMission(
  JSON.parse(
    readFileSync(new URL('../../../missions/kettenreaktion.json', import.meta.url), 'utf8'),
  ),
);

const T0 = 1_000_000;

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

function started(seed = 42): GameState {
  return run(
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed },
    ],
    initialState(blackout),
  );
}

describe('mission switching & stats', () => {
  it('lets the host switch the lobby mission, keeping the crew', () => {
    let state = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
      ],
      initialState(blackout),
    );
    state = applyAction(state, { type: 'switch-mission', playerId: 'p1', mission: tutorial, difficulty: 'normal' });
    expect(state.mission.id).toBe('systemcheck');
    expect(state.players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    expect(() =>
      applyAction(state, { type: 'switch-mission', playerId: 'p2', mission: blackout, difficulty: 'normal' }),
    ).toThrow(/Host/);
  });

  it('refuses switching to a mission that takes fewer players than are in the room', () => {
    const three = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'player-join', playerId: 'p3', name: 'Cleo' },
      ],
      initialState(kettenreaktion),
    );
    // The tutorial is for exactly two.
    expect(() =>
      applyAction(three, {
        type: 'switch-mission',
        playerId: 'p1',
        mission: tutorial,
        difficulty: 'normal',
      }),
    ).toThrow(/zu viele Spieler/);
  });

  it('records start and finish times for the end-screen stats', () => {
    const end = T0 + blackout.timeLimitSec * 1000;
    const lost = applyAction(started(), { type: 'time-expired', at: end });
    expect(lost.finishedAt).toBe(end);
    const view = viewFor(lost, 'p1');
    expect(view.startedAt).toBe(T0);
    expect(view.finishedAt).toBe(end);
    expect(view.timeLimitSec).toBe(blackout.timeLimitSec);
  });

  it('validates the three shipped missions', () => {
    expect(blackout.puzzles).toHaveLength(6);
    expect(tutorial.players).toEqual({ min: 2, max: 2 });
    expect(kettenreaktion.players).toEqual({ min: 3, max: 3 });
    expect(kettenreaktion.puzzles.some((p) => p.type === 'simon')).toBe(true);
    // Every shipped mission carries an escape hatch.
    for (const mission of [blackout, kettenreaktion, tutorial]) {
      expect(mission.map.exit).toBeDefined();
    }
  });
});
