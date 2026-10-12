import { describe, expect, it } from 'vitest';
import { applyAction, moduleFor, NO_CREDITS, viewFor, viewForSpectator } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { labMission, openLab, standing, started, T0 } from './lab.js';

/** Two wiring stations in the corridor lab, one book for both; p1 works, p2 reads. */
const mission = labMission([
  { type: 'wiring', id: 'erst', title: 'Erst', hints: ['Von oben zählen.'] },
  { type: 'wiring', id: 'dann', title: 'Dann' },
]);

/** The cut the open station's rules name, worked out from the two views alone. */
function rightCut(state: GameState, at: number): Action {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  const operator = viewFor(state, 'p1');
  const reader = viewFor(state, 'p2');
  if (def === undefined || operator.puzzle === null || reader.puzzle === null) {
    throw new Error('expected an open station with a reader');
  }
  const views = { operator: operator.puzzle, reader: reader.puzzle };
  const [move] = moduleFor(def.type).solve(def, views, operator.edgework);
  return { type: 'puzzle-input', playerId: 'p1', at, input: move?.input };
}

/** Any wire but the one the rules name. */
function wrongCut(state: GameState, at: number): Action {
  const right = rightCut(state, at);
  const wires = viewFor(state, 'p1').puzzle;
  const rightId = (right.type === 'puzzle-input' ? right.input : null) as { wireId: string };
  const wrong = wires?.kind === 'wiring' ? wires.wires?.find((w) => w.id !== rightId.wireId) : null;
  return { type: 'puzzle-input', playerId: 'p1', at, input: { wireId: wrong?.id } };
}

describe('credits', () => {
  it('start every run with a clean sheet for the crew, and the lobby with none', () => {
    const state = started(mission);
    expect(state.credits).toEqual({ p1: NO_CREDITS, p2: NO_CREDITS });
    expect(viewFor(state, 'p2').credits).toEqual(state.credits);
    expect(viewForSpectator(state).credits).toEqual(state.credits);
    const over = applyAction(state, { type: 'time-expired', at: T0 + 600_000 });
    expect(applyAction(over, { type: 'back-to-lobby', playerId: 'p1' }).credits).toEqual({});
  });

  it('go to whoever solved a station, and the alarm to whoever set it off', () => {
    let state = openLab(started(mission));
    state = applyAction(state, wrongCut(state, T0 + 1000));
    expect(state.credits['p1']).toMatchObject({ alarms: 1, operated: 0 });
    state = applyAction(state, rightCut(state, T0 + 2000));
    expect(state.currentPuzzleIndex).toBe(1);
    expect(state.credits['p1']).toMatchObject({ alarms: 1, operated: 1 });
    expect(state.credits['p2']).toMatchObject({ alarms: 0, operated: 0 });
  });

  it('count reading once per station, however often the reader comes and goes', () => {
    let state = openLab(started(mission));
    expect(state.credits['p2']?.read).toBe(1);
    state = standing(state, { stations: { erst: ['p1'] } });
    state = standing(state, { stations: { erst: ['p1'] }, manuals: { buch: ['p2'] } });
    expect(state.credits['p2']?.read).toBe(1);
    expect(state.credits['p1']?.read).toBe(0);
    state = openLab(applyAction(state, rightCut(state, T0 + 2000)), { at: T0 + 3000 });
    expect(state.credits['p2']?.read).toBe(2);
  });

  it('count nothing read while no station is open', () => {
    const state = standing(started(mission), { manuals: { buch: ['p2'] } });
    expect(state.credits['p2']?.read).toBe(0);
  });

  it('put a drone sighting on the player it caught, a note on whoever asked for it', () => {
    let state = openLab(started(mission));
    const spotted: Action = { type: 'drone-spotted', at: T0 + 1000, penaltySec: 5, playerId: 'p2' };
    state = applyAction(state, spotted);
    expect(state.credits['p2']?.alarms).toBe(1);
    state = applyAction(state, {
      type: 'request-hint',
      playerId: 'p2',
      at: T0 + 100 + mission.hintDelaySec * 1000,
    });
    expect(state.credits['p2']).toMatchObject({ alarms: 1, hints: 1 });
    expect(state.credits['p1']).toEqual(NO_CREDITS);
  });
});
