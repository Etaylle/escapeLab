import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  NUDGE_QUIET_MS,
  NUDGED,
  nudgeDueAt,
  parseClientMessage,
  parseMission,
  scaleMission,
  viewFor,
  viewForSpectator,
  type GameState,
  type Mission,
} from '../src/index.js';
import { labMission, standing, started, T0 } from './lab.js';

/**
 * Mission control watches the station that is up: once nobody has worked it for
 * NUDGE_QUIET_MS — from when it came up, was switched on or last took a move — it names the
 * next place to go, one line of the mission's `nudges` at a time, never more than those.
 */

const FIRST = ['Das Buch liegt am Ostende des Flurs.', 'Die Station steht an der Nordwand.'];
const SECOND = ['Die zweite Station steht weiter im Osten.'];

/** Two stations where the whole crew presses, the first with two lines, the second with one. */
const mission: Mission = labMission(
  [
    { type: 'button-sync', id: 'eins', title: 'Eins', nudges: FIRST },
    { type: 'button-sync', id: 'zwei', title: 'Zwei', nudges: SECOND },
  ],
  'leitstelle',
);

/** A station somebody has to read for first: alone at it, a move is turned away. */
const readFirst: Mission = labMission(
  [{ type: 'keypad', id: 'tasten', title: 'Tasten', nudges: ['Das Buch liegt im Osten.'] }],
  'lesen',
);

const nudge = (state: GameState, at: number): GameState =>
  applyAction(state, { type: 'nudge', at });

/** Both players at the station that is up, switched on by p1 at `at`. */
function switchedOn(state: GameState, at: number): GameState {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  const here = standing(state, { stations: { [def?.id ?? '']: ['p1', 'p2'] } });
  return applyAction(here, { type: 'interact', playerId: 'p1', at });
}

const press = (state: GameState, playerId: string, at: number): GameState =>
  applyAction(state, { type: 'puzzle-input', playerId, at, input: { press: true } });

describe('mission control watching a quiet station', () => {
  it('names the next place once the station up has been quiet for 90 s, not before', () => {
    const state = started(mission);
    expect(NUDGE_QUIET_MS).toBe(90_000);
    expect(nudgeDueAt(state)).toBe(T0 + 90_000);
    expect(nudge(state, T0 + 89_999)).toBe(state);
    const spoken = nudge(state, T0 + 90_000);
    expect(spoken.events.at(-1)).toEqual({
      at: T0 + 90_000,
      kind: 'nudge',
      label: FIRST[0],
      seconds: null,
    });
    expect(spoken.nudgesGiven).toBe(1);
  });

  it('sends the second line only after another quiet spell, and none past the last', () => {
    const once = nudge(started(mission), T0 + 90_000);
    expect(nudgeDueAt(once)).toBe(T0 + 180_000);
    expect(nudge(once, T0 + 179_999)).toBe(once);
    const twice = nudge(once, T0 + 180_000);
    expect(twice.events.filter((e) => e.kind === 'nudge').map((e) => e.label)).toEqual(FIRST);
    expect(nudgeDueAt(twice)).toBeNull();
    expect(nudge(twice, T0 + 900_000)).toBe(twice);
  });

  it('starts the quiet over with any input the station takes: its switch-on, every move', () => {
    const on = switchedOn(started(mission), T0 + 30_000);
    expect(nudgeDueAt(on)).toBe(T0 + 120_000);
    const pressed = press(on, 'p1', T0 + 60_000);
    expect(pressed.currentPuzzleIndex).toBe(0);
    expect(nudgeDueAt(pressed)).toBe(T0 + 150_000);
    expect(nudge(pressed, T0 + 120_000)).toBe(pressed);
  });

  it('counts no move the station turned away: alone at it, the quiet goes on', () => {
    const state = started(readFirst);
    const alone = applyAction(standing(state, { stations: { tasten: ['p1'] } }), {
      type: 'interact',
      playerId: 'p1',
      at: T0 + 10_000,
    });
    expect(() =>
      applyAction(alone, {
        type: 'puzzle-input',
        playerId: 'p1',
        at: T0 + 50_000,
        input: { press: 0 },
      }),
    ).toThrow(/Allein geht das nicht/);
    expect(nudgeDueAt(alone)).toBe(T0 + 100_000);
  });

  it('stands still while the run is paused, and moves on by the time it was', () => {
    let state = started(mission);
    state = applyAction(state, { type: 'set-paused', paused: true, at: T0 + 30_000 });
    expect(nudgeDueAt(state)).toBeNull();
    expect(nudge(state, T0 + 95_000)).toBe(state);
    state = applyAction(state, { type: 'set-paused', paused: false, at: T0 + 70_000 });
    expect(nudgeDueAt(state)).toBe(T0 + 130_000);
  });

  it('keeps quiet through an emergency and counts the quiet from its end', () => {
    const state: GameState = { ...started(mission), sabotage: { endsAt: T0 + 200_000 } };
    expect(nudgeDueAt(state)).toBeNull();
    const over = applyAction(state, { type: 'sabotage-cleared', at: T0 + 100_000 });
    expect(nudgeDueAt(over)).toBe(T0 + 190_000);
  });

  it('gives the next station a quiet of its own and its own lines, and none after the last', () => {
    /** The station up switched on at `at`, pressed by both players a second and two later. */
    const solve = (state: GameState, at: number): GameState =>
      press(press(switchedOn(state, at), 'p1', at + 1000), 'p2', at + 2000);
    const solved = solve(started(mission), T0 + 8000);
    expect(solved.currentPuzzleIndex).toBe(1);
    expect(nudgeDueAt(solved)).toBe(T0 + 100_000);
    expect(nudge(solved, T0 + 100_000).events.at(-1)?.label).toBe(SECOND[0]);
    const done = solve(solved, T0 + 20_000);
    expect(done.phase).toBe('won');
    expect(nudgeDueAt(done)).toBeNull();
  });

});

describe('what mission control says unasked', () => {
  it('says nothing on „hart", whose scaled mission has no lines left; the others keep them', () => {
    const hard = scaleMission(mission, 'hart');
    expect(hard.puzzles.map((p) => p.nudges)).toEqual([[], []]);
    expect(nudgeDueAt(started(hard))).toBeNull();
    for (const level of ['entspannt', 'normal'] as const) {
      expect(scaleMission(mission, level).puzzles.map((p) => p.nudges)).toEqual([FIRST, SECOND]);
    }
  });

  it('puts the line on the air for everyone as a run event, and nothing else in the view', () => {
    const quiet = started(mission);
    const spoken = nudge(quiet, T0 + 90_000);
    const line = { at: T0 + 90_000, kind: 'nudge', label: FIRST[0], seconds: null };
    expect(viewFor(spoken, 'p1').events.at(-1)).toEqual(line);
    expect(viewForSpectator(spoken).events.at(-1)).toEqual(line);
    const { events: before, ...restBefore } = viewFor(quiet, 'p2');
    const { events: after, ...restAfter } = viewFor(spoken, 'p2');
    expect(after).toEqual([...before, line]);
    expect(restAfter).toEqual(restBefore);
    expect(NUDGED).toBe('Leitstelle meldet sich');
  });

  it('takes two lines for a station at most', () => {
    const lines = (nudges: string[]): unknown => ({
      ...JSON.parse(JSON.stringify(mission)),
      puzzles: mission.puzzles.map((p, i) => (i === 0 ? { ...p, nudges } : p)),
    });
    expect(() => parseMission(lines(['1', '2']))).not.toThrow();
    expect(() => parseMission(lines(['1', '2', '3']))).toThrow(/puzzles\.0\.nudges/);
    expect(() => parseMission(lines(['']))).toThrow(/puzzles\.0\.nudges/);
  });
});

describe('a first crew in the shipped missions', () => {
  const shipped = (name: string): Mission =>
    parseMission(
      JSON.parse(readFileSync(new URL(`../../../missions/${name}`, import.meta.url), 'utf8')),
    );

  it('gives Blackout fifteen minutes', () => {
    expect(shipped('blackout.json').timeLimitSec).toBe(900);
  });
});

describe('a room opened for a first crew', () => {
  it('may ask for its difficulty, one of the three', () => {
    const create = (extra: object): string =>
      JSON.stringify({ kind: 'create-room', name: 'Anna', ...extra });
    expect(parseClientMessage(create({ difficulty: 'entspannt' }))).toEqual({
      kind: 'create-room',
      name: 'Anna',
      difficulty: 'entspannt',
    });
    expect(parseClientMessage(create({}))).toEqual({ kind: 'create-room', name: 'Anna' });
    expect(() => parseClientMessage(create({ difficulty: 'leicht' }))).toThrow();
  });
});
