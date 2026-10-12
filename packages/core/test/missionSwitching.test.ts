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
      { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
      { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed },
    ],
    initialState(blackout),
  );
}

describe('mission switching & stats', () => {
  it('lets the host switch the lobby mission and resets roles', () => {
    let state = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
      ],
      initialState(blackout),
    );
    state = applyAction(state, { type: 'switch-mission', playerId: 'p1', mission: tutorial, difficulty: 'normal' });
    expect(state.mission.id).toBe('systemcheck');
    expect(state.players.map((p) => p.roleId)).toEqual([null, null]);
    expect(() =>
      applyAction(state, { type: 'switch-mission', playerId: 'p2', mission: blackout, difficulty: 'normal' }),
    ).toThrow(/Host/);
  });

  it('refuses switching to a mission with fewer roles than players', () => {
    const three = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'player-join', playerId: 'p3', name: 'Cleo' },
      ],
      initialState(kettenreaktion),
    );
    expect(() =>
      applyAction(three, { type: 'switch-mission', playerId: 'p1', mission: blackout, difficulty: 'normal' }),
    ).toThrow(/zu viele Spieler/);
  });

  it('records start and finish times for the end-screen stats', () => {
    const lost = applyAction(started(), { type: 'time-expired', at: T0 + 540_000 });
    expect(lost.finishedAt).toBe(T0 + 540_000);
    const view = viewFor(lost, 'p1');
    expect(view.startedAt).toBe(T0);
    expect(view.finishedAt).toBe(T0 + 540_000);
    expect(view.timeLimitSec).toBe(540);
  });

  it('validates the three shipped missions', () => {
    expect(blackout.puzzles).toHaveLength(5);
    expect(tutorial.roles).toHaveLength(2);
    expect(kettenreaktion.roles).toHaveLength(3);
    expect(kettenreaktion.puzzles.some((p) => p.type === 'simon')).toBe(true);
    // Every shipped mission carries an escape hatch.
    for (const mission of [blackout, kettenreaktion, tutorial]) {
      expect(mission.map.exit).toBeDefined();
    }
  });
});
