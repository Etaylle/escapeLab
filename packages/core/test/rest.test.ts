import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  moduleFor,
  parseMission,
  puzzleDueAt,
  stationKey,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, GameState, Mission, PuzzleState, PuzzleView } from '../src/index.js';
import { EMERGENCY_MISSED } from '../src/actions.js';
import type { FirewallState } from '../src/puzzles/firewall.js';
import type { StartupState } from '../src/puzzles/startup.js';
import { lightsOut, standing, started, T0 } from './lab.js';

/**
 * An emergency no longer throws the open station's progress away: the station rests through it
 * (state.ts `resting`) — off every view, deaf to input, its clock standing still — and is back
 * on its consoles as the emergency ends, with what the crew had done there. Played through the
 * reducer on the harness's probes (tools/fixtures), each given an emergency at two valves. What
 * each module keeps and calls off is resume.test.ts.
 */

const fixtures = new URL('../../../tools/fixtures/', import.meta.url);

/** A probe of one station with two consoles, an emergency at two valves added to its map. */
function probe(file: string): Mission {
  const raw = JSON.parse(readFileSync(new URL(file, fixtures), 'utf8'));
  const sabotage = {
    label: 'KÜHLUNG AUSGEFALLEN',
    durationSec: 40,
    penaltySec: 60,
    afterSolved: 0,
    panels: [
      { id: 'links', x: 1, y: 5 },
      { id: 'rechts', x: 17, y: 5 },
    ],
  };
  return parseMission({ ...raw, map: { ...raw.map, sabotage } });
}

/** The probe's station switched on at T0 + 500, p1 at console a and p2 at console b. */
function manned(mission: Mission, seed: number): GameState {
  const [def] = mission.puzzles;
  if (def === undefined) {
    throw new Error('the probe has no station');
  }
  const consoles = { [def.id]: ['p1'], [stationKey({ puzzleId: def.id, console: 'b' })]: ['p2'] };
  const there = standing(lightsOut(started(mission, seed)), {
    stations: consoles,
    signSeen: ['p1', 'p2'],
  });
  return applyAction(there, { type: 'interact', playerId: 'p1', at: T0 + 500 });
}

/** The open station as `playerId` sees it; throws where they see none. */
function seenBy(state: GameState, playerId: string): PuzzleView {
  const view = viewFor(state, playerId).puzzle;
  if (view === null) {
    throw new Error(`${playerId} sees no open station`);
  }
  return view;
}

/**
 * One second of the crew at the open station at `at`: ticked as the room ticks it once its clock
 * is due, then the solver's moves on both consoles' views, through the reducer.
 */
function second(state: GameState, at: number): GameState {
  const due = puzzleDueAt(state);
  const now = due !== null && due <= at ? applyAction(state, { type: 'puzzle-tick', at }) : state;
  const def = now.mission.puzzles[now.currentPuzzleIndex];
  if (def === undefined || now.puzzleState === null) {
    return now;
  }
  const views = { operator: seenBy(now, 'p1'), partner: seenBy(now, 'p2') };
  const aid = { transcript: [], remainingSec: null, at };
  return moduleFor(def.type)
    .solve(def, { ...views, reader: views.operator }, now.edgework, aid)
    .reduce((next, { by, input }) => {
      const playerId = by === 'partner' ? 'p2' : 'p1';
      return applyAction(next, { type: 'puzzle-input', playerId, at, input });
    }, now);
}

/** The crew at the station a second at a time from `from` (s after T0) until `done` or the solve. */
function worked(
  state: GameState,
  from: number,
  done: (station: PuzzleState) => boolean = () => false,
): { state: GameState; sec: number } {
  let now = state;
  for (let sec = from; sec < from + 600; sec++) {
    if (now.puzzleState === null || done(now.puzzleState)) {
      return { state: now, sec };
    }
    now = second(now, T0 + sec * 1000);
  }
  throw new Error('the crew never got there in ten minutes');
}

const alarmsOf = (state: GameState): string[] =>
  state.events.filter((e) => e.kind === 'penalty').map((e) => e.label);

const start = (sec: number): Action => ({ type: 'sabotage-start', at: T0 + sec * 1000 });
const cleared = (sec: number): Action => ({ type: 'sabotage-cleared', at: T0 + sec * 1000 });

const filter = probe('firewall-probe.json');
const fw = (state: GameState): FirewallState => state.puzzleState as FirewallState;
/** The Paketfilter with a clean wave behind it and a packet of the next one dropped. */
function secondWaveInTheAir(seed: number): { state: GameState; sec: number } {
  const air = (s: PuzzleState): boolean =>
    s.type === 'firewall' && s.cleared === 1 && s.dropped.length > 0;
  return worked(manned(filter, seed), 1, air);
}

describe('a station resting through an emergency', () => {
  const { state: before, sec } = secondWaveInTheAir(3);
  const resting = applyAction(before, start(sec));

  it('is put by whole as the emergency starts, and off every view', () => {
    expect(resting.puzzleState).toBeNull();
    expect(resting.resting).toBe(before.puzzleState);
    for (const view of [viewFor(resting, 'p1'), viewFor(resting, 'p2')]) {
      expect(view.puzzle).toBeNull();
    }
    expect(viewForSpectator(resting).puzzle).toBeNull();
    // no view gives anything of the instance while it rests: no packet, no header
    const seen = JSON.stringify([
      viewFor(resting, 'p1'),
      viewFor(resting, 'p2'),
      viewForSpectator(resting),
    ]);
    for (const packet of fw(before).packets) {
      expect(seen).not.toContain(packet.header.source);
      expect(seen).not.toContain(`"${packet.id}"`);
    }
    expect(seen).not.toContain('"packets"');
  });

  it('takes no input and no switch-on, and its clock stands still', () => {
    const at = T0 + (sec + 5) * 1000;
    const trip = { type: 'puzzle-input' as const, playerId: 'p1', at, input: { trip: 0 } };
    expect(() => applyAction(resting, trip)).toThrow('Gerade ist keine Station in Betrieb.');
    const on = { type: 'interact' as const, playerId: 'p1', at };
    expect(() => applyAction(resting, on)).toThrow('Gesperrt, bis der Notfall behoben ist.');
    expect(puzzleDueAt(before)).not.toBeNull();
    expect(puzzleDueAt(resting)).toBeNull();
    // a tick that was under way as the emergency came changes nothing, however late
    const late = applyAction(resting, { type: 'puzzle-tick', at: at + 120_000 });
    expect(late).toBe(resting);
    expect(alarmsOf(late)).toEqual([]);
  });

  it('is back on its consoles as the emergency is cleared, its clean wave kept', () => {
    const back = applyAction(resting, cleared(sec + 30));
    expect(back.resting).toBeNull();
    expect(fw(back)).toMatchObject({ cleared: 1, waiting: true, dropped: [], vacant: [] });
    expect(fw(back).heldAt).toBe(T0 + (sec + 30) * 1000);
    expect(alarmsOf(back)).toEqual([]);
    expect(back.currentPuzzleIndex).toBe(0);
    expect(seenBy(back, 'p1')).toMatchObject({ kind: 'firewall', cleared: 1, waiting: true });
    // the wave waits: nothing is due until the Freigabe, then the clock is armed again
    expect(puzzleDueAt(back)).toBeNull();
    const freed = second(back, T0 + (sec + 31) * 1000);
    expect(fw(freed).waiting).toBe(false);
    expect(puzzleDueAt(freed)).toBeGreaterThan(T0 + (sec + 31) * 1000);
  });

  it('is back as well when the emergency runs out: the one alarm is the emergency’s', () => {
    const missed = applyAction(resting, { type: 'sabotage-expired', at: T0 + (sec + 40) * 1000 });
    expect(alarmsOf(missed)).toEqual([EMERGENCY_MISSED]);
    expect(missed.resting).toBeNull();
    expect(fw(missed)).toMatchObject({ cleared: 1, waiting: true });
  });

  it('is gone with a run that ends in the emergency', () => {
    const lost = applyAction(resting, { type: 'time-expired', at: T0 + 700_000 });
    expect(lost.phase).toBe('lost');
    expect([lost.puzzleState, lost.resting]).toEqual([null, null]);
  });

  it('leaves an emergency that met no station on as it was: the crew switches on after', () => {
    const idle = standing(lightsOut(started(filter, 3)), { stations: { filter: ['p1'] } });
    const over = [start(2), cleared(9)].reduce(applyAction, idle);
    expect([over.puzzleState, over.resting]).toEqual([null, null]);
    const on = applyAction(over, { type: 'interact', playerId: 'p1', at: T0 + 10_000 });
    expect(fw(on)).toMatchObject({ cleared: 0, waiting: true });
  });
});

describe('the Paketfilter after an emergency', () => {
  it('is solved from where it stood, without an alarm, for 20 seeds', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { state, sec } = secondWaveInTheAir(seed);
      const back = [start(sec), cleared(sec + 30)].reduce(applyAction, state);
      const dealt = fw(back).dealt;
      const end = worked(back, sec + 31).state;
      expect(end.currentPuzzleIndex, `seed ${seed}`).toBe(1);
      expect(alarmsOf(end), `seed ${seed}`).toEqual([]);
      // one clean wave was behind it: the one called off dealt anew, and no more
      expect(dealt, `seed ${seed}`).toBe(3);
    }
  });
});

describe('the Anlaufsteuerung after an emergency', () => {
  const anlauf = probe('startup-probe.json');
  const su = (state: GameState): StartupState => state.puzzleState as StartupState;
  /** Stage 1 run up, stage 2's gaps set and its pulse on the way. */
  const pulseOut = (seed: number) =>
    worked(manned(anlauf, seed), 1, (s) => s.type === 'startup' && s.stage === 1 && s.pulse !== null);

  it('keeps the stage run up and the gaps filled; the pulse lapses without an alarm', () => {
    const { state, sec } = pulseOut(5);
    const before = su(state);
    const resting = applyAction(state, start(sec));
    expect(puzzleDueAt(state)).not.toBeNull();
    expect(puzzleDueAt(resting)).toBeNull();
    const back = applyAction(resting, cleared(sec + 30));
    expect(su(back)).toMatchObject({
      stage: 1,
      closed: before.closed,
      values: before.values,
      pulse: null,
      last: 'verfallen',
    });
    expect(Object.keys(before.values)).toEqual(['sperre', 'abgang']);
    expect(alarmsOf(back)).toEqual([]);
    expect(puzzleDueAt(back)).toBeNull();
  });

  it('is solved from where it stood, without an alarm, for 20 seeds', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { state, sec } = pulseOut(seed);
      const back = [start(sec), cleared(sec + 30)].reduce(applyAction, state);
      const end = worked(back, sec + 31).state;
      expect(end.currentPuzzleIndex, `seed ${seed}`).toBe(1);
      expect(alarmsOf(end), `seed ${seed}`).toEqual([]);
    }
  });
});
