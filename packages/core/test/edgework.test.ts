import { describe, expect, it, vi } from 'vitest';
import {
  applyAction,
  generateEdgework,
  indicatorLit,
  indicatorPresent,
  INDICATOR_IDS,
  initialState,
  parseMission,
  serialHasVowel,
  serialLastDigit,
  serialLastDigitIsOdd,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, Edgework, GameState, Mission } from '../src/index.js';
import { wiringModule } from '../src/puzzles/wiring.js';
import { mulberry32 } from '../src/rng.js';
import { labMission, standing, started, T0 } from './lab.js';

const mission: Mission = labMission([
  { type: 'wiring', id: 'kabel', title: 'Kabel' },
  { type: 'keypad', id: 'code', title: 'Code' },
]);

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

/** Anna (p1) has walked past the sign, Ben (p2) has not. */
function playing(seed = 7): GameState {
  return standing(started(mission, seed), { signSeen: ['p1'] });
}

const rolled = (count: number): Edgework[] =>
  Array.from({ length: count }, (_, seed) => generateEdgework(mulberry32(seed)));

describe('edgework generator', () => {
  it('rolls a serial, three distinct lamps and up to four cells', () => {
    for (const edgework of rolled(2000)) {
      expect(edgework.serial).toMatch(/^[A-HJ-NP-Z0-9]{5}-[0-9]$/);
      const ids = edgework.indicators.map((i) => i.id);
      expect(new Set(ids).size).toBe(3);
      expect(ids.every((id) => INDICATOR_IDS.includes(id))).toBe(true);
      expect(Number.isInteger(edgework.cells)).toBe(true);
      expect(edgework.cells).toBeGreaterThanOrEqual(0);
      expect(edgework.cells).toBeLessThanOrEqual(4);
    }
  });

  it('is the same for a seed and covers every case over many seeds', () => {
    expect(generateEdgework(mulberry32(5))).toEqual(generateEdgework(mulberry32(5)));
    const all = rolled(2000);
    expect(new Set(all.map((e) => e.cells))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(new Set(all.flatMap((e) => e.indicators.map((i) => i.id)))).toEqual(
      new Set(INDICATOR_IDS),
    );
    expect(new Set(all.flatMap((e) => e.indicators.map((i) => i.lit)))).toEqual(
      new Set([true, false]),
    );
    expect(new Set(all.map(serialHasVowel))).toEqual(new Set([true, false]));
    expect(new Set(all.map(serialLastDigitIsOdd))).toEqual(new Set([true, false]));
  });
});

describe('edgework predicates', () => {
  const lab: Edgework = {
    serial: 'K7G3A-2',
    indicators: [
      { id: 'FRQ', lit: true },
      { id: 'SIG', lit: false },
      { id: 'CAR', lit: true },
    ],
    cells: 2,
  };

  it('read the digit after the dash', () => {
    expect(serialLastDigit(lab)).toBe(2);
    expect(serialLastDigitIsOdd(lab)).toBe(false);
    expect(serialLastDigitIsOdd({ ...lab, serial: 'K7G35-9' })).toBe(true);
  });

  it('find A, E and U, but never count digits or other letters', () => {
    expect(serialHasVowel(lab)).toBe(true);
    expect(serialHasVowel({ ...lab, serial: 'K7G3B-2' })).toBe(false);
    expect(serialHasVowel({ ...lab, serial: 'E1234-5' })).toBe(true);
    expect(serialHasVowel({ ...lab, serial: '1234U-5' })).toBe(true);
  });

  it('tell a lit lamp from a dark one and from a missing one', () => {
    expect(indicatorLit(lab, 'FRQ')).toBe(true);
    expect(indicatorLit(lab, 'SIG')).toBe(false);
    expect(indicatorLit(lab, 'NSA')).toBe(false);
    expect(indicatorPresent(lab, 'SIG')).toBe(true);
    expect(indicatorPresent(lab, 'NSA')).toBe(false);
  });
});

describe('edgework in a run', () => {
  it('is rolled from the seed at the start and again for a rematch', () => {
    expect(initialState(mission).edgework).toBeNull();
    expect(playing(7).edgework).toEqual(playing(7).edgework);
    expect(playing(7).edgework).not.toEqual(playing(8).edgework);

    const lost = applyAction(playing(7), { type: 'time-expired', at: T0 + 600_000 });
    const again = run(
      [
        { type: 'set-ready', playerId: 'p2', ready: true },
        { type: 'rematch', playerId: 'p1', at: T0 + 700_000, seed: 8 },
      ],
      lost,
    );
    expect(again.edgework).toEqual(playing(8).edgework);
    expect(applyAction(lost, { type: 'back-to-lobby', playerId: 'p1' }).edgework).toBeNull();
  });

  it('reaches only the players who have read the sign, and the audience always', () => {
    const state = playing();
    const serial = state.edgework?.serial ?? '';
    expect(viewFor(state, 'p1').edgework).toEqual(state.edgework);
    expect(viewFor(state, 'p2').edgework).toBeNull();
    expect(JSON.stringify(viewFor(state, 'p2'))).not.toContain(serial);
    expect(viewForSpectator(state).edgework).toEqual(state.edgework);
  });

  it('stays with whoever read it, wherever they walk afterwards', () => {
    const later = standing(playing(), { manuals: { buch: ['p1'] } });
    expect(later.presence.signSeen).toEqual(['p1']);
    expect(viewFor(later, 'p1').edgework).toEqual(later.edgework);
    expect(viewFor(later, 'p1').presence.signSeen).toBe(true);
  });

  it('hands a module the edgework, the alarms, the seconds left, the crew and the console', () => {
    const apply = vi.spyOn(wiringModule, 'apply');
    const open = applyAction(standing(playing(), { stations: { kabel: ['p1'] } }), {
      type: 'interact',
      playerId: 'p1',
      at: T0 + 500,
    });
    const state = applyAction(open, {
      type: 'drone-spotted',
      at: T0 + 1000,
      penaltySec: 15,
      playerId: 'p2',
    });
    applyAction(state, {
      type: 'puzzle-input',
      playerId: 'p1',
      at: T0 + 10_500,
      input: { wireId: 'w9' },
    });
    const ctx = apply.mock.calls[0]?.[4];
    expect(ctx).toEqual({
      edgework: state.edgework,
      alarms: 1,
      // 600 s minus the 15 s alarm minus 10.5 s played, rounded up like the clock shows it
      remainingSec: 575,
      at: T0 + 10_500,
      crew: ['p1', 'p2'],
      // the box has one console, which counts as console a
      console: 'a',
      atConsoles: { a: [], b: [] },
    });
    expect(apply.mock.calls[0]?.[3]).toBe('p1');
    apply.mockRestore();
  });
});

describe('edgework in the mission format', () => {
  it('needs the sign on the map as soon as a rule reads it', () => {
    const raw = JSON.parse(JSON.stringify(mission));
    delete raw.map.edgeworkSign;
    expect(() => parseMission(raw)).toThrow(
      /puzzles "kabel" read the edgework, but there is no edgeworkSign/,
    );
    const withoutReader = {
      ...raw,
      puzzles: raw.puzzles.filter((p: { type: string }) => p.type !== 'wiring'),
      map: {
        ...raw.map,
        stations: raw.map.stations.filter((s: { puzzleId: string }) => s.puzzleId !== 'kabel'),
        manuals: [{ ...raw.map.manuals[0], puzzleIds: ['code'] }],
      },
    };
    expect(() => parseMission(withoutReader)).not.toThrow();
  });

  it('puts the sign on a floor tile', () => {
    const raw = JSON.parse(JSON.stringify(mission));
    raw.map.edgeworkSign = { x: 0, y: 0 };
    expect(() => parseMission(raw)).toThrow(/edgework sign at 0,0 is not on a floor tile/);
  });
});
