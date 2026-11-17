import { describe, expect, it } from 'vitest';
import {
  applyAction,
  armedPuzzleIds,
  checkMission,
  outOfService,
  parseMission,
  puzzleDueAt,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { GameState, Mission } from '../src/index.js';
import { standing, started, T0 } from './lab.js';
import { seedDrawing } from './rotationPlan.js';

/**
 * A lab in a chain of three places whose middle one is a pool of a button the whole crew
 * presses (xb), a Paketfilter (fw) and an Anlaufsteuerung (st) with its duct: the two stations
 * whose clock runs by itself, so that a run with one of them out of service shows whether
 * anything of it is ever armed, ticked or brought forward.
 *
 *   0         1         2
 *   0123456789012345678901234
 * 0 #########################
 * 1 #..1..b..F..S........3..#   eins (3,1), xb (6,1), fw a (9,1), st a (12,1), drei (21,1)
 * 2 #...........d............#   the duct from (12,2) …
 * 3 #...........dddddddd.....#   … along row 3 …
 * 4 #..................d.....#   … to (19,4)
 * 5 #S.B.B.........F...S.....#   sign (1,5), books (3,5) (5,5), fw b (15,5), st b (19,5)
 * 6 #########################
 */
function clockLabData(conduits: unknown[] = [DUCT]): Record<string, unknown> {
  const floor = `#${'.'.repeat(23)}#`;
  return {
    id: 'uhren',
    title: 'Uhren',
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 900,
    puzzles: [
      { type: 'button-sync', id: 'eins', title: 'Eins' },
      { type: 'button-sync', id: 'xb', title: 'Taster', pool: 'mitte' },
      { type: 'firewall', id: 'fw', title: 'Paketfilter', pool: 'mitte' },
      { type: 'startup', id: 'st', title: 'Anlaufsteuerung', pool: 'mitte' },
      { type: 'button-sync', id: 'drei', title: 'Drei' },
    ],
    map: {
      tiles: ['#'.repeat(25), floor, floor, floor, floor, floor, '#'.repeat(25)],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
      stations: [
        { puzzleId: 'eins', x: 3, y: 1 },
        { puzzleId: 'xb', x: 6, y: 1 },
        { puzzleId: 'fw', x: 9, y: 1, console: 'a' },
        { puzzleId: 'fw', x: 15, y: 5, console: 'b' },
        { puzzleId: 'st', x: 12, y: 1, console: 'a' },
        { puzzleId: 'st', x: 19, y: 5, console: 'b' },
        { puzzleId: 'drei', x: 21, y: 1 },
      ],
      manuals: [
        book('buch-fw', 'RICHTLINIE', 'fw', 3),
        book('buch-st', 'BETRIEBSBUCH', 'st', 5),
      ],
      edgeworkSign: { x: 1, y: 5 },
      // A hatch, so that the run goes on past its last station: the way out is a stage too.
      exit: { x: 23, y: 3 },
      conduits,
    },
  };
}

/** A book for the station `puzzleId` at (x,5). */
const book = (id: string, label: string, puzzleId: string, x: number): object => ({
  id,
  kind: 'book',
  label,
  puzzleIds: [puzzleId],
  spots: [{ x, y: 5 }],
});

const DUCT = {
  puzzleId: 'st',
  tiles: [
    [12, 2],
    [12, 3],
    ...[13, 14, 15, 16, 17, 18, 19].map((x) => [x, 3]),
    [19, 4],
  ],
};

const clockLab = (): Mission => parseMission(clockLabData());

const drawing = (puzzleId: string): GameState =>
  started(clockLab(), seedDrawing(clockLab(), puzzleId));

/** Both at the station `id` (a whole-crew button), E pressed and both pressing at `at`. */
function take(state: GameState, id: string, at: number): GameState {
  const here = standing(state, { stations: { [id]: ['p1', 'p2'] } });
  const open = applyAction(here, { type: 'interact', playerId: 'p1', at });
  return ['p1', 'p2'].reduce(
    (next, playerId) =>
      applyAction(next, { type: 'puzzle-input', playerId, at, input: { press: true } }),
    open,
  );
}

/** The crew at both consoles of both stations with a clock, as the server would report it. */
const atTheClocks = (state: GameState, at: number): GameState =>
  standing(state, {
    stations: { fw: ['p1'], 'fw/b': ['p2'], st: ['p1'], 'st/b': ['p2'] },
    signSeen: ['p1', 'p2'],
    at,
  });

/** A run that draws the button, at every stage from its start to the way out to the hatch. */
function stagesOfButtonRun(): GameState[] {
  const fresh = drawing('xb');
  const first = take(fresh, 'eins', T0 + 1000);
  const second = take(first, 'xb', T0 + 2000);
  return [fresh, first, second, take(second, 'drei', T0 + 3000)];
}

describe('rotation: a station with a clock, out of service', () => {
  it('takes the lab, and wants the duct of its Anlaufsteuerung whichever station is drawn', () => {
    expect(checkMission(clockLabData())).toMatchObject({ ok: true });
    const bare = checkMission(clockLabData([]));
    const issues = bare.ok ? '' : bare.issues.join('\n');
    expect(issues).toMatch(/station "st" \(startup\) has no cable duct/);
  });

  it('is never armed, never open and never due, the crew at its consoles or not', () => {
    for (const stage of stagesOfButtonRun()) {
      for (const state of [stage, atTheClocks(stage, T0 + 4000)]) {
        expect([...outOfService(state)].sort()).toEqual(['fw', 'st']);
        expect(armedPuzzleIds(state)).not.toContain('fw');
        expect(armedPuzzleIds(state)).not.toContain('st');
        expect(state.puzzleState).toBeNull();
        expect(puzzleDueAt(state)).toBeNull();
      }
    }
  });

  it('is not brought forward by the clock: a tick a minute on changes nothing', () => {
    for (const stage of stagesOfButtonRun().slice(0, 3)) {
      const there = atTheClocks(stage, T0 + 4000);
      const ticked = applyAction(there, { type: 'puzzle-tick', at: T0 + 60_000 });
      expect(ticked.puzzleState).toBeNull();
      expect([ticked.penaltySeq, ticked.events.length]).toEqual([0, there.events.length]);
      // E there is the server's to refuse; let through, it switches on the run's own station.
      const pressed = applyAction(there, { type: 'interact', playerId: 'p1', at: T0 + 5000 });
      expect(pressed.puzzleState?.type).toBe('button-sync');
    }
  });

  it('sends no pulse down the duct of an Anlaufsteuerung out of service, in any view', () => {
    for (const stage of stagesOfButtonRun().slice(0, 3)) {
      const there = atTheClocks(stage, T0 + 4000);
      const audience = viewForSpectator(there);
      expect(audience.map?.conduits.map((duct) => duct.pulse)).toEqual([null]);
      expect(viewFor(there, 'p1').map?.conduits.map((duct) => duct.pulse)).toEqual([null]);
      const spots = audience.map?.stations.filter((s) => s.puzzleId === 'st') ?? [];
      expect(spots.map((s) => (s.known ? s.status : 'glimpsed'))).toEqual(['out', 'out']);
      expect(JSON.stringify(audience.puzzle ?? {})).not.toMatch(/"kind":"(firewall|startup)"/);
    }
  });

  it('runs the clock of the one in service as on any other run', () => {
    const state = take(drawing('fw'), 'eins', T0 + 1000);
    expect(armedPuzzleIds(state)).toEqual(['fw']);
    const open = applyAction(atTheClocks(state, T0 + 2000), {
      type: 'interact',
      playerId: 'p1',
      at: T0 + 2000,
    });
    expect(open.puzzleState?.type).toBe('firewall');
    expect([...outOfService(open)].sort()).toEqual(['st', 'xb']);
    expect(viewForSpectator(open).map?.conduits.map((duct) => duct.pulse)).toEqual([null]);
  });
});
