import { describe, expect, it } from 'vitest';
import {
  applyAction,
  parseMission,
  pickLine,
  radioLines,
  variantsOf,
  type GameState,
  type Mission,
} from '../src/index.js';
import { labMission, standing, started, T0 } from './lab.js';

/**
 * A line may give two or three texts: a run says one of them, picked from its seed and the
 * line's place in the mission, so that a run on the same seed hears the same and a rematch, on
 * another, most often other takes; a moment that comes again in a run — the next emergency —
 * takes the next text in turn. Every text is its own recording.
 */

const START = ['Erster Start.', 'Zweiter Start.', 'Dritter Start.'];
const NUDGE = ['Hier entlang.', 'Dort drüben.'];
const SOLVED = ['Eins läuft.', 'Eins steht.'];
const ANNOUNCE = ['Störung eins.', 'Störung zwei.', 'Störung drei.'];
const EMERGENCY = ['Notfall eins.', 'Notfall zwei.'];

/** Two stations the whole crew presses, every line of them in several texts, an emergency. */
function variantMission(): Mission {
  const lab = labMission(
    [
      { type: 'button-sync', id: 'eins', title: 'Eins', nudges: [NUDGE], onSolved: SOLVED },
      { type: 'button-sync', id: 'zwei', title: 'Zwei' },
    ],
    'varianten',
  );
  const json = JSON.parse(JSON.stringify(lab));
  return parseMission({
    ...json,
    radio: { start: START, emergency: { start: EMERGENCY } },
    map: {
      ...json.map,
      sabotage: {
        label: 'KÜHLUNG',
        afterSolved: 0,
        announce: ANNOUNCE,
        panels: [
          { id: 'links', x: 2, y: 1 },
          { id: 'rechts', x: 2, y: 2 },
        ],
      },
    },
  });
}

const mission = variantMission();

/** The texts said at `moment` in `state`'s run so far, in order. */
const said = (state: GameState, moment: string): string[] =>
  state.events.filter((e) => e.moment === moment).map((e) => e.label);

describe('a line of several texts', () => {
  it('is picked by the seed and the line’s place: the same seed and place, the same text', () => {
    for (const seed of [0, 1, 7, 123_456, 0xffffffff]) {
      const once = pickLine(START, seed, 'start');
      expect(pickLine(START, seed, 'start')).toBe(once);
      expect(START).toContain(once);
    }
    // One text is always itself, whatever the seed or the place.
    expect(pickLine('Los.', 42, 'start')).toBe('Los.');
    expect(variantsOf('Los.')).toEqual(['Los.']);
    expect(variantsOf(START)).toBe(START);
  });

  it('picks every text over enough seeds, and another text for most of them', () => {
    const picks = Array.from({ length: 300 }, (_, seed) => pickLine(START, seed, 'start'));
    for (const text of START) {
      // Each of three about a third of the time: well over a fifth.
      expect(picks.filter((pick) => pick === text).length, text).toBeGreaterThan(60);
    }
    const changed = picks.filter((pick, seed) => pick !== pickLine(START, seed + 1, 'start'));
    expect(changed.length).toBeGreaterThan(150);
    // Two places of one seed pick apart from each other: a run does not say every first text.
    const places = ['solved:eins', 'solved:zwei', 'start', 'escape', 'clock:twoMinutes'];
    const firsts = places.map((place) => pickLine(['a', 'b', 'c'], 99, place));
    expect(new Set(firsts).size).toBeGreaterThan(1);
  });

  it('takes the next text in turn each time its moment comes again in the run', () => {
    const first = pickLine(ANNOUNCE, 5, 'announce');
    const at = ANNOUNCE.indexOf(first);
    const turns = [0, 1, 2, 3].map((n) => pickLine(ANNOUNCE, 5, 'announce', n));
    expect(turns).toEqual([0, 1, 2, 3].map((n) => ANNOUNCE[(at + n) % ANNOUNCE.length]));
  });
});

describe('several texts in the mission file', () => {
  /** The mission with `line` as its start line. */
  const startingWith = (line: unknown) => () =>
    parseMission({ ...JSON.parse(JSON.stringify(mission)), radio: { start: line } });

  it('takes a line of two or three texts, none empty, and no list of one or four', () => {
    expect(startingWith(['a.', 'b.'])).not.toThrow();
    expect(startingWith(['a.', 'b.', 'c.'])).not.toThrow();
    expect(startingWith(['a.'])).toThrow(/radio\.start/);
    expect(startingWith(['a.', 'b.', 'c.', 'd.'])).toThrow(/radio\.start/);
    expect(startingWith(['a.', ''])).toThrow(/radio\.start/);
    expect(startingWith('')).toThrow(/radio\.start/);
  });

  it('lists every text on the lines a run can hear, each where its line stands', () => {
    const lines = radioLines(mission);
    expect(lines.filter((l) => l.when === 'start').map((l) => l.text)).toEqual(START);
    expect(lines.filter((l) => l.when === 'nudge').map((l) => l.text)).toEqual(NUDGE);
    expect(lines.filter((l) => l.when === 'solved').map((l) => l.text)).toEqual(SOLVED);
    expect(lines.filter((l) => l.when === 'announce').map((l) => l.text)).toEqual(ANNOUNCE);
    expect(lines.filter((l) => l.when === 'nudge').every((l) => l.puzzleId === 'eins')).toBe(true);
  });
});

describe('a run saying one text of each line', () => {
  it('opens with the start its seed picks: the same seed, the same; a rematch most often another', () => {
    const opening = (seed: number): string | undefined => started(mission, seed).events[0]?.label;
    for (const seed of [3, 4, 5]) {
      expect(opening(seed)).toBe(pickLine(START, seed, 'start'));
      expect(opening(seed)).toBe(opening(seed));
    }
    const heard = new Set(Array.from({ length: 40 }, (_, seed) => opening(seed)));
    expect([...heard].sort()).toEqual([...START].sort());
  });

  it('says a station’s nudge and its solve’s line in the texts the seed picks for them', () => {
    const quiet = applyAction(started(mission, 11), { type: 'nudge', at: T0 + 90_000 });
    expect(said(quiet, 'nudge')).toEqual([pickLine(NUDGE, 11, 'nudge:eins:0')]);
    const here = standing(quiet, { stations: { eins: ['p1', 'p2'] } });
    const on = applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 91_000 });
    const press = (s: GameState, playerId: string, at: number): GameState =>
      applyAction(s, { type: 'puzzle-input', playerId, at, input: { press: true } });
    const solved = press(press(on, 'p1', T0 + 92_000), 'p2', T0 + 93_000);
    expect(said(solved, 'solved')).toEqual([pickLine(SOLVED, 11, 'solved:eins')]);
  });

  it('gives the next emergency the next take, the plant’s message and the operator’s alike', () => {
    let state = started(mission, 21);
    for (const at of [T0 + 10_000, T0 + 200_000, T0 + 400_000]) {
      state = applyAction(state, { type: 'sabotage-start', at });
      state = applyAction(state, { type: 'sabotage-cleared', at: at + 5000 });
    }
    const turn = (texts: readonly string[], key: string) =>
      [0, 1, 2].map((n) => pickLine(texts, 21, key, n));
    expect(said(state, 'announce')).toEqual(turn(ANNOUNCE, 'announce'));
    expect(new Set(said(state, 'announce')).size).toBe(3);
    expect(said(state, 'emergency')).toEqual(turn(EMERGENCY, 'emergency'));
    expect(said(state, 'emergency')[0]).not.toBe(said(state, 'emergency')[1]);
  });
});
