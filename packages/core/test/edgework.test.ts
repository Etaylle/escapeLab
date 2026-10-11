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
import type * as Registry from '../src/puzzles/index.js';
import { wiringModule } from '../src/puzzles/wiring.js';
import { mulberry32 } from '../src/rng.js';

// No shipped module reads the edgework yet, so the mission check runs with
// the keypad pretending to.
vi.mock('../src/puzzles/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Registry>();
  return {
    ...actual,
    moduleFor: (type: Registry.PuzzleDef['type']) => {
      const found = actual.moduleFor(type);
      return type === 'keypad' ? { ...found, usesEdgework: true } : found;
    },
  };
});

const T0 = 1_000_000;

const raw = {
  id: 'edgetest',
  title: 'Kennungs-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  roles: [
    { id: 'anleitung', name: 'Anleitung', description: '' },
    { id: 'steuerpult', name: 'Steuerpult', description: '', seesEdgework: true },
  ],
  puzzles: [
    {
      type: 'wiring',
      id: 'kabel',
      title: 'Kabel',
      prompt: '',
      operatorRoleId: 'steuerpult',
      manualRoleId: 'anleitung',
      pairsToCut: [['A', 'B']],
      decoyPairs: [['C', 'D']],
    },
    {
      type: 'keypad',
      id: 'code',
      title: 'Code',
      prompt: '',
      operatorRoleId: 'steuerpult',
      manualRoleId: 'anleitung',
      gridSymbols: ['a', 'b', 'c', 'd'],
      code: ['a', 'b'],
    },
  ],
};
const mission: Mission = parseMission(raw);

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

function playing(seed = 7): GameState {
  return run(
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
      { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed },
    ],
    initialState(mission),
  );
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

  it('reaches only the roles that see it, and the audience on exactly their panels', () => {
    const state = playing();
    const serial = state.edgework?.serial ?? '';
    expect(viewFor(state, 'p2').edgework).toEqual(state.edgework);
    expect(viewFor(state, 'p1').edgework).toBeNull();
    expect(JSON.stringify(viewFor(state, 'p1'))).not.toContain(serial);
    expect(viewForSpectator(state).panels.map((p) => [p.roleId, p.edgework])).toEqual([
      ['anleitung', null],
      ['steuerpult', state.edgework],
    ]);
  });

  it('hands a module the edgework, the alarms so far and the seconds left', () => {
    const apply = vi.spyOn(wiringModule, 'apply');
    const state = applyAction(playing(), { type: 'drone-spotted', at: T0 + 1000, penaltySec: 15 });
    applyAction(state, {
      type: 'puzzle-input',
      playerId: 'p2',
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
    });
    apply.mockRestore();
  });
});

describe('edgework in the mission format', () => {
  it('nobody sees it unless the role says so', () => {
    expect(mission.roles.map((r) => r.seesEdgework)).toEqual([false, true]);
  });

  it('rejects a puzzle that reads it when no role sees it', () => {
    const blind = {
      ...raw,
      roles: raw.roles.map((role) => ({ ...role, seesEdgework: false })),
    };
    expect(() => parseMission(blind)).toThrow(/"code" read the edgework, but no role sees it/);
    const withoutReader = { ...blind, puzzles: raw.puzzles.filter((p) => p.type !== 'keypad') };
    expect(() => parseMission(withoutReader)).not.toThrow();
  });
});
