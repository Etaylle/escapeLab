import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, drawPools, stationKey, stationsOfRun, viewFor } from '../src/index.js';
import type { Action, GameState, Move, PuzzleInput } from '../src/index.js';
import {
  BLACKOUT_POOL,
  blackoutMission,
  blackoutPlans,
  DRAW_SEEDS,
  PINNED_SEED,
  playBlackout,
  type BlackoutPlan,
  type BlackoutPlans,
} from './blackoutPlan.js';
import { lightsOut, standing, started, T0 } from './lab.js';

/**
 * tools/shots.mjs plays Blackout to the won card on a pinned seed, and to the reactor's doors
 * on a seed for each other station of its Wechselplatz, with the answers
 * tools/fixtures/blackout-plan.json carries; these tests keep that file the solvers' own and
 * prove its answers win, so that the harness can guard each instance in the browser against it.
 */

const fixture = JSON.parse(
  readFileSync(new URL('../../../tools/fixtures/blackout-plan.json', import.meta.url), 'utf8'),
) as BlackoutPlans;

/** The fixture's plan for the draw of `id`; throws where it has none. */
function planOf(id: keyof typeof DRAW_SEEDS): BlackoutPlan {
  const plan = fixture.runs.find((run) => run.drawn === id);
  if (plan === undefined) {
    throw new Error(`blackout-plan.json has no run drawing "${id}"`);
  }
  return plan;
}

const draws = Object.entries(DRAW_SEEDS) as [keyof typeof DRAW_SEEDS, number][];

/** Blackout on `seed`, both past the sign, the first `solved` stations of the run behind it. */
function arrivedAt(seed: number, solved: number): GameState {
  const state = standing(lightsOut(started(blackoutMission(), seed)), { signSeen: ['p1', 'p2'] });
  return { ...state, currentPuzzleIndex: solved };
}

/** Blackout on the pinned seed with the crew at the Serverraum's consoles, switched on. */
function serverraumOpen(): GameState {
  // The three stations before it, as the reducer has them solved: straight to the Serverraum.
  const here = standing(arrivedAt(PINNED_SEED, 3), {
    stations: {
      subsysteme: ['p1'],
      [stationKey({ puzzleId: 'subsysteme', console: 'b' })]: ['p2'],
    },
  });
  return applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 1000 });
}

const input = (move: Move<PuzzleInput>, at: number): Action => ({
  type: 'puzzle-input',
  playerId: move.by === 'partner' ? 'p2' : 'p1',
  at,
  input: move.input,
});

describe('Blackout on the harness’s seeds', () => {
  it('pins a seed to every station of the Wechselplatz, the Signalkette’s first', () => {
    const mission = blackoutMission();
    const members = mission.puzzles.filter((p) => p.pool === BLACKOUT_POOL).map((p) => p.id);
    expect(Object.keys(DRAW_SEEDS).sort()).toEqual([...members].sort());
    for (const [id, seed] of draws) {
      expect(drawPools(mission.puzzles, seed), id).toEqual({ [BLACKOUT_POOL]: id });
    }
    expect(PINNED_SEED).toBe(DRAW_SEEDS.signalkette);
  });

  it.each(draws)('%s (seed %i): won through the reducer by the solvers, alarm-free', (id, seed) => {
    const { state, played } = playBlackout(seed);
    expect(state.currentPuzzleIndex).toBe(stationsOfRun(state));
    expect(state.penaltySeq).toBe(0);
    expect(played.map((station) => station.def.id)).toEqual([
      'notlicht',
      'anlauf',
      'paketfilter',
      'subsysteme',
      id,
      'reaktorstart',
    ]);
  });

  it('carries the solvers’ own walkthroughs in tools/fixtures/blackout-plan.json', () => {
    // Write the file anew when Blackout or one of its modules changes (test/writeBlackout.ts).
    expect(fixture).toEqual(blackoutPlans());
    expect(fixture).toMatchObject({ mission: 'blackout', pinned: PINNED_SEED });
    expect(fixture.runs.map((run) => [run.drawn, run.seed])).toEqual(draws);
    expect(fixture.runs[0]?.seed).toBe(PINNED_SEED);
  });

  it('deals every seed the same start, so that one walk reaches the Wechselplatz in each', () => {
    const [first, ...others] = fixture.runs;
    const start = ({ spawns, places }: BlackoutPlan): unknown => ({
      spawns,
      book: places['buch-archiv'],
      policy: places['richtlinie'],
      locker: places['spind'],
    });
    for (const run of others) {
      expect(start(run), run.drawn).toEqual(first === undefined ? null : start(first));
    }
  });

  it('opens the Serverraum on the pinned table, the pinned moves solving it alarm-free', () => {
    let state = serverraumOpen();
    const pinned = planOf('signalkette');
    const terminal = viewFor(state, 'p1').puzzle;
    expect(terminal?.kind === 'servers' ? terminal.rows : null).toEqual(pinned.subsysteme.rows);
    pinned.subsysteme.moves.forEach((move, i) => {
      state = applyAction(state, input(move, T0 + 2000 + i * 500));
    });
    expect(state.penaltySeq).toBe(0);
    expect(state.currentPuzzleIndex).toBe(4);
  });

  it.each(fixture.runs)('seed $seed: the Anlaufsteuerung swaps sides, a breaker a stage', (run) => {
    expect(run.anlauf.stages.map((stage) => [stage.stage, stage.types])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
    for (const stage of run.anlauf.stages) {
      // The breaker closed is the feeder the script was given, and no faulty one.
      expect(stage.breaker).toBe(stage.values.abgang);
      expect(stage.feeders).toHaveLength(4);
      expect(stage.feeders[stage.breaker - 1]).not.toEqual(['rot', 'dunkel']);
    }
  });

  it.each(fixture.runs)('seed $seed: every wave of the Paketfilter drops two or three', (run) => {
    const mission = blackoutMission();
    const filter = mission.puzzles.find((p) => p.id === 'paketfilter');
    if (filter?.type !== 'firewall') {
      throw new Error('Blackout guards its Serverraum with a Paketfilter');
    }
    expect(run.paketfilter.waves.length).toBeGreaterThan(filter.waves);
    for (const wave of run.paketfilter.waves) {
      expect(wave).toHaveLength(filter.packets);
      expect([2, 3]).toContain(wave.filter((packet) => packet.hostile).length);
    }
  });

  it('pins the Wechselplatz’s answer to what its instance asks: keys, cut and dial', () => {
    const { signalkette } = planOf('signalkette');
    // Stage by stage the direction swaps, console a sending first.
    expect(signalkette?.stages.map((stage) => stage.sends)).toEqual(['a', 'b', 'a', 'b']);
    expect(signalkette?.stages.every((s) => s.keys.length === s.sequence.length)).toBe(true);
    const box = planOf('notstrom');
    // The serial ends odd: every round cuts the lowest voltage above 0 V the meter reads.
    expect(Number(box.serial.at(-1)) % 2).toBe(1);
    expect(box.notstrom?.rounds.length).toBeGreaterThan(0);
    for (const { readings, cut } of box.notstrom?.rounds ?? []) {
      const live = readings.map((volts) => (volts === null || volts === 0 ? Infinity : volts));
      expect(cut).toBe(live.indexOf(Math.min(...live)));
    }
    for (const run of fixture.runs) {
      expect(run.reaktorstart, run.drawn).toEqual({ presses: 2, windowMs: 3500 });
      const plans = [run.signalkette, run.frequenz, run.notstrom].filter((p) => p !== undefined);
      expect(plans, run.drawn).toHaveLength(1);
    }
  });

  it('lights the pinned pattern at the radio panel; the pinned turns and a send solve it', () => {
    const plan = planOf('frequenz');
    const pin = plan.frequenz;
    const mission = blackoutMission();
    const cabinet = mission.map.manuals.find((m) => m.puzzleIds.includes('frequenz'));
    if (cabinet === undefined || pin === undefined) {
      throw new Error('Blackout keeps the radio panel’s tables in a cabinet');
    }
    // The four stations before it, as the reducer has them solved, and the cabinet unlocked.
    const opened = { ...arrivedAt(plan.seed, 4), opened: [cabinet.id] };
    const here = standing(opened, {
      stations: { frequenz: ['p1'] },
      manuals: { [cabinet.id]: ['p2'] },
    });
    let state = applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 1000 });
    const lamp = viewFor(state, 'p1').puzzle;
    expect(lamp?.kind === 'morse' ? [lamp.pattern, lamp.dial] : null).toEqual([
      pin.pattern,
      pin.dial,
    ]);
    const tune = Math.sign(pin.turns);
    const moves: Move<PuzzleInput>[] = [
      ...Array.from({ length: Math.abs(pin.turns) }, () => ({
        by: 'operator' as const,
        input: { tune } as PuzzleInput,
      })),
      { by: 'operator', input: { transmit: true } },
    ];
    moves.forEach((move, i) => {
      state = applyAction(state, input(move, T0 + 2000 + i * 500));
    });
    expect(state.penaltySeq).toBe(0);
    expect(state.currentPuzzleIndex).toBe(5);
  });
});
