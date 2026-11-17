import { describe, expect, it } from 'vitest';
import {
  applyAction,
  checkMission,
  LOAD_PICTURES,
  stationKey,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { GameState } from '../src/index.js';
import { lightsOut, standing, started, T0 } from './lab.js';
import { startupProbe } from './startupPlan.js';

/**
 * The cable ducts in the floor (map.conduits): what the validation takes and turns away, and the
 * pulse every view of the map carries while one runs.
 */

const probe = startupProbe();

/** The probe's mission file with its first duct changed by `change`. */
function withDuct(change: Record<string, unknown>): unknown {
  const data = structuredClone(probe) as unknown as { map: { conduits: object[] } };
  const [duct] = data.map.conduits;
  data.map.conduits = [{ ...duct, ...change }];
  return data;
}

/** The issues the validation finds with a mission file. */
function issuesOf(data: unknown): string[] {
  const checked = checkMission(data);
  return checked.ok ? [] : checked.issues;
}

/** The row of tiles from (x0, y) to (x1, y), both ends taken. */
const row = (y: number, x0: number, x1: number): [number, number][] =>
  Array.from({ length: Math.abs(x1 - x0) + 1 }, (_, i): [number, number] => [
    x0 + Math.sign(x1 - x0) * i,
    y,
  ]);

describe('the validation of a duct', () => {
  it('takes the probe’s, under the wall between the rooms, and either way round', () => {
    expect(issuesOf(probe)).toEqual([]);
    expect(issuesOf(withDuct({ tiles: row(2, 13, 4) }))).toEqual([]);
  });

  it('wants an Anlaufsteuerung of the mission at its puzzle', () => {
    expect(issuesOf(withDuct({ puzzleId: 'nirgends' }))).toEqual([
      'map.conduits.0.puzzleId: map: conduit 0: "nirgends" is no puzzle of the mission — a ' +
        'duct joins the consoles of an Anlaufsteuerung (startup)',
    ]);
  });

  it('turns away a duct at a station of another module', () => {
    const data = withDuct({ puzzleId: 'kette' }) as {
      puzzles: object[];
      map: { stations: object[] };
    };
    data.puzzles.push({ type: 'signal', id: 'kette', title: 'Kette' });
    data.map.stations.push(
      { puzzleId: 'kette', x: 2, y: 4, console: 'a' },
      { puzzleId: 'kette', x: 15, y: 4, console: 'b' },
    );
    expect(issuesOf(data)).toContainEqual(
      expect.stringMatching(/^map\.conduits\.0\.puzzleId: .*"kette" is a signal — a duct/),
    );
  });

  it('turns away a gap, a tile twice and a tile over the void or off the map', () => {
    const gap = issuesOf(withDuct({ tiles: [...row(2, 4, 7), ...row(2, 9, 13)] }));
    expect(gap).toEqual([expect.stringMatching(/tiles 7,2 and 9,2 share no side/)]);
    const back = issuesOf(withDuct({ tiles: [...row(2, 4, 8), [8, 3], [8, 2], ...row(2, 9, 13)] }));
    expect(back).toEqual([expect.stringMatching(/a tile comes twice/)]);
    const off = issuesOf(withDuct({ tiles: [...row(2, 4, 18), [19, 2]] }));
    expect(off).toEqual([expect.stringMatching(/tile 19,2 lies off the map/)]);
  });

  it('wants an end beside each console', () => {
    const short = issuesOf(withDuct({ tiles: row(2, 4, 11) }));
    expect(short).toEqual([
      'map.conduits.0.tiles: map: conduit 0: the duct ends at 4,2 and 11,2 — put one end ' +
        'beside console a (4,1) and the other beside console b (13,1)',
    ]);
  });

  it('gives a station one duct', () => {
    const data = withDuct({}) as { map: { conduits: object[] } };
    data.map.conduits = [...data.map.conduits, ...data.map.conduits];
    expect(issuesOf(data)).toEqual([
      'map.conduits.1.puzzleId: map: conduit 1: station "anlauf" has a duct already',
    ]);
  });
});

/** The probe on, Anna at console a and Ben at console b, the station switched on. */
function manned(): GameState {
  const consoleB = stationKey({ puzzleId: 'anlauf', console: 'b' });
  const here = standing(lightsOut(started(probe, 5)), {
    stations: { anlauf: ['p1'], [consoleB]: ['p2'] },
  });
  return applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
}

/** The open station's right value for each gap, from its state. */
function rightGaps(state: GameState): [string, number][] {
  const open = state.puzzleState;
  if (open?.type !== 'startup') {
    throw new Error('no Anlaufsteuerung open');
  }
  const deal = open.stages[open.stage];
  const picture = (lamps: readonly string[]) => lamps.join('/');
  const feeder = (wanted: string): number =>
    (deal?.feeders.findIndex((lamps) => picture(lamps) === wanted) ?? -1) + 1;
  const load = LOAD_PICTURES[deal?.load ?? 'netz'].join('/');
  const gaps: [string, number][] = [['abgang', feeder(load)]];
  return open.stage === 0 ? gaps : [['sperre', feeder('rot/aus')], ...gaps];
}

/** The open stage's script set right and started by `playerId` at `at`. */
function sent(state: GameState, playerId: string, at: number): GameState {
  const sets = rightGaps(state).map(([gap, value]) => ({ cmd: 'setze', gap, value }));
  return [...sets, { cmd: 'start' }].reduce(
    (now, input) => applyAction(now, { type: 'puzzle-input', playerId, at, input }),
    state,
  );
}

describe('the pulse in the duct', () => {
  it('is in nobody’s view while none runs', () => {
    const state = manned();
    expect(viewFor(state, 'p1').map?.conduits).toEqual([
      { puzzleId: 'anlauf', tiles: expect.any(Array), pulse: null },
    ]);
  });

  it('runs from console a’s end in stage 1, in every view and the audience’s alike', () => {
    const at = T0 + 2000;
    const state = sent(manned(), 'p1', at);
    const pulse = { sentAt: at, arrivesAt: at + 6000, diesAt: at + 9000, reversed: false };
    expect(viewFor(state, 'p1').map?.conduits[0]?.pulse).toEqual(pulse);
    expect(viewFor(state, 'p2').map?.conduits[0]?.pulse).toEqual(pulse);
    expect(viewForSpectator(state).map?.conduits[0]?.pulse).toEqual(pulse);
  });

  it('runs back from console b’s end in stage 2, and is gone once the stage runs up', () => {
    const first = sent(manned(), 'p1', T0 + 2000);
    const [[, feeder = 1] = []] = rightGaps(first);
    const up = applyAction(first, {
      type: 'puzzle-input',
      playerId: 'p2',
      at: T0 + 8000,
      input: { breaker: feeder },
    });
    expect(viewFor(up, 'p1').map?.conduits[0]?.pulse).toBeNull();
    const second = sent(up, 'p2', T0 + 20_000);
    expect(viewFor(second, 'p1').map?.conduits[0]?.pulse).toMatchObject({ reversed: true });
  });

  it('dies on the clock as the window closes, the station ticked', () => {
    const state = sent(manned(), 'p1', T0 + 2000);
    const ticked = applyAction(state, { type: 'puzzle-tick', at: T0 + 11_000 });
    expect(viewFor(ticked, 'p1').map?.conduits[0]?.pulse).toBeNull();
  });
});
