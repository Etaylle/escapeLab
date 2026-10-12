import { describe, expect, it } from 'vitest';
import {
  applyAction,
  generateEdgework,
  initialState,
  parseMission,
  viewFor,
} from '../src/index.js';
import type { Action, GameState, PuzzleContext } from '../src/index.js';
import { KEYPAD_COLUMNS, keypadModule } from '../src/puzzles/keypad.js';
import type { KeypadDef, KeypadState, KeypadView } from '../src/puzzles/keypad.js';
import { mulberry32 } from '../src/rng.js';

const SEEDS = 300;
const T0 = 1_000_000;
const GLYPHS = [...new Set(KEYPAD_COLUMNS.flat())];

/**
 * Where the table's glyphs come from. Each one was checked to render from
 * fonts that macOS, iOS, Windows and Android ship (SF, Helvetica, Arial,
 * Times New Roman; Roboto, Noto). A glyph from any other block — an APL sign,
 * a Cham letter, a dingbat — needs that check before it joins the table.
 */
const CHECKED_BLOCKS = [
  [0x00a0, 0x00ff], // Latin-1 Supplement
  [0x0180, 0x024f], // Latin Extended-B
  [0x0370, 0x03ff], // Greek and Coptic
  [0x0400, 0x04ff], // Cyrillic
  [0x20a0, 0x20cf], // Currency Symbols
  [0x2200, 0x22ff], // Mathematical Operators
  [0x2300, 0x23ff], // Miscellaneous Technical
  [0x2600, 0x26ff], // Miscellaneous Symbols
] as const;

/** Shapes a spoken description cannot tell apart: the table holds one of each family at most. */
const LOOK_ALIKES = [
  'ЖҖӁӜ', 'ΨѰ', 'ΩƱ℧', '☆★', '♪♫', 'ϾϿЄ', 'әǝə', 'ѲΘƟӨϴ',
  'ѦѨ', 'ƛλ', '∂δð', 'Ұ¥', 'ӬЭ', 'ξѮ', 'ҊЙӢ', 'ѢЂЋ',
];

const def: KeypadDef = keypadModule.defSchema.parse({
  type: 'keypad',
  id: 'code',
  title: 'Zugangscode',
  prompt: '',
  operatorRoleId: 'steuerpult',
  manualRoleId: 'anleitung',
  penaltySec: 15,
});

const mission = parseMission({
  id: 'keypadtest',
  title: 'Tastenfeld-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  roles: [
    { id: 'steuerpult', name: 'Steuerpult', description: '' },
    { id: 'anleitung', name: 'Anleitung', description: '' },
  ],
  puzzles: [def],
});

const edgework = generateEdgework(mulberry32(1));
const ctx: PuzzleContext = { edgework, alarms: 0, remainingSec: 600, at: T0 };

/** A fresh instance straight from the module. */
const deal = (seed: number): KeypadState => keypadModule.init(def, mulberry32(seed), ctx);

const viewAs = (state: KeypadState, roleId: string): KeypadView =>
  keypadModule.view(def, state, roleId, { edgework, alarms: 0 });

/** Every way to pick `size` of `items`, keeping their order. */
function subsets<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) {
    return [[]];
  }
  return items.flatMap((item, i) =>
    subsets(items.slice(i + 1), size - 1).map((rest) => [item, ...rest]),
  );
}

/** Anna works the keypad, Ben holds the manual. */
function started(seed = 7): GameState {
  const actions: Action[] = [
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
    { type: 'select-role', playerId: 'p1', roleId: 'steuerpult' },
    { type: 'select-role', playerId: 'p2', roleId: 'anleitung' },
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'start-mission', playerId: 'p1', at: T0, seed },
  ];
  return actions.reduce(applyAction, initialState(mission));
}

const press = (playerId: string, keyIndex: number): Action => ({
  type: 'puzzle-input',
  playerId,
  at: T0 + 1000,
  input: { keyIndex },
});

function keypadOf(state: GameState): KeypadState {
  if (state.puzzleState?.type !== 'keypad') {
    throw new Error('expected the keypad to be open');
  }
  return state.puzzleState;
}

function viewOf(state: GameState, playerId: string) {
  const puzzle = viewFor(state, playerId).puzzle;
  if (puzzle?.kind !== 'keypad') {
    throw new Error('expected a keypad view');
  }
  return puzzle;
}

/** Where the next glyph in column order sits on the pad. */
function nextKey(state: GameState): number {
  const { keys, order } = keypadOf(state);
  const lit = keys.filter((key) => key.lit).length;
  return keys.findIndex((key) => key.glyph === order[lit]);
}

describe('the keypad table', () => {
  it('has six columns of seven glyphs, 27 different ones', () => {
    expect(KEYPAD_COLUMNS).toHaveLength(6);
    expect(KEYPAD_COLUMNS.every((column) => new Set(column).size === 7)).toBe(true);
    expect(KEYPAD_COLUMNS.every((column) => column.length === 7)).toBe(true);
    expect(GLYPHS).toHaveLength(27);
  });

  it('never puts four glyphs of one column together in another column', () => {
    for (const [index, column] of KEYPAD_COLUMNS.entries()) {
      for (const four of subsets(column, 4)) {
        const holders = KEYPAD_COLUMNS.flatMap((other, o) =>
          four.every((glyph) => other.includes(glyph)) ? [o] : [],
        );
        expect(holders, four.join(' ')).toEqual([index]);
      }
    }
  });

  it('uses single code points that show as letters or symbols, never marks or emoji', () => {
    for (const glyph of GLYPHS) {
      expect([...glyph], glyph).toHaveLength(1);
      expect(glyph).toMatch(/^[\p{L}\p{P}\p{S}]$/u);
      expect(glyph).not.toMatch(/\p{Emoji}/u);
    }
  });

  it('draws only on blocks whose glyphs were checked on all four platforms', () => {
    for (const glyph of GLYPHS) {
      const code = glyph.codePointAt(0) ?? -1;
      expect(CHECKED_BLOCKS.some(([from, to]) => code >= from && code <= to), glyph).toBe(true);
    }
  });

  it('holds no two glyphs a description could mix up', () => {
    const folded = GLYPHS.map((glyph) => glyph.normalize('NFKC').toLowerCase());
    expect(new Set(folded).size).toBe(GLYPHS.length);
    for (const family of LOOK_ALIKES) {
      const members = GLYPHS.filter((glyph) => family.includes(glyph));
      expect(members.length, family).toBeLessThanOrEqual(1);
    }
  });
});

describe('keypad puzzle', () => {
  it('deals four glyphs of one column, shuffled, the same for a seed', () => {
    const columns = new Set<number>();
    let laidOutInPressOrder = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const { column, keys, order } = deal(seed);
      const glyphs = keys.map((key) => key.glyph);
      const printed = KEYPAD_COLUMNS[column] ?? [];
      expect(new Set(glyphs).size).toBe(4);
      expect(glyphs.every((glyph) => printed.includes(glyph))).toBe(true);
      expect(order).toEqual(printed.filter((glyph) => glyphs.includes(glyph)));
      expect(keys.some((key) => key.lit)).toBe(false);
      columns.add(column);
      laidOutInPressOrder += glyphs.join() === order.join() ? 1 : 0;
    }
    expect(columns.size).toBe(KEYPAD_COLUMNS.length);
    // A pad laid out in press order gives the answer away; by chance 1 in 24 is.
    expect(laidOutInPressOrder).toBeLessThan(SEEDS / 8);
    expect(deal(7)).toEqual(deal(7));
    expect(deal(7)).not.toEqual(deal(8));
  });

  it('shows the keys to the operator only; everyone sees how many are lit', () => {
    const state = started();
    const panel = viewOf(state, 'p1');
    const manual = viewOf(state, 'p2');
    expect(panel.keys).toEqual(keypadOf(state).keys);
    expect(manual.keys).toBeNull();
    expect([panel.litCount, manual.litCount]).toEqual([0, 0]);
    // Neither the column nor the press order leaves the server.
    for (const view of [panel, manual]) {
      expect(view).not.toHaveProperty('column');
      expect(view).not.toHaveProperty('order');
    }
  });

  it('tells the manual role nothing about the keys that were dealt', () => {
    const first = started(1);
    const other = [2, 3, 4, 5, 6, 7, 8]
      .map((seed) => started(seed))
      .find((state) => keypadOf(state).column !== keypadOf(first).column);
    expect(other).toBeDefined();
    expect(viewOf(other ?? first, 'p2')).toEqual(viewOf(first, 'p2'));
  });

  it('prints the six columns and the procedure, for the manual role only', () => {
    const state = started();
    const printed = keypadModule.manual(def);
    expect(viewOf(state, 'p2').manual).toEqual(printed);
    expect(viewOf(state, 'p1').manual).toBeNull();
    const blocks = printed.flatMap((section) => section.blocks);
    expect(blocks).toContainEqual({ kind: 'columns', columns: KEYPAD_COLUMNS });
    expect(JSON.stringify(blocks)).toContain('−15 s');
  });

  it('lights each key pressed in column order and opens on the fourth', () => {
    let state = started();
    for (let lit = 1; lit < 4; lit++) {
      const keyIndex = nextKey(state);
      state = applyAction(state, press('p1', keyIndex));
      expect(viewOf(state, 'p1').keys?.[keyIndex]?.lit).toBe(true);
      expect(viewOf(state, 'p2').litCount).toBe(lit);
    }
    state = applyAction(state, press('p1', nextKey(state)));
    expect(state.phase).toBe('won');
    expect(state.penaltySeq).toBe(0);
  });

  it('charges a wrong press, keeps the lit keys lit and lets the crew finish', () => {
    let state = started();
    state = applyAction(state, press('p1', nextKey(state)));
    const { keys } = keypadOf(state);
    const wrong = keys.findIndex((key, i) => !key.lit && i !== nextKey(state));
    const deadline = state.deadlineAt ?? 0;
    state = applyAction(state, press('p1', wrong));
    expect(state.penaltySeq).toBe(1);
    expect(state.deadlineAt).toBe(deadline - 15_000);
    expect(keypadOf(state).keys).toEqual(keys);
    for (let left = 3; left > 0 && state.phase === 'playing'; left--) {
      state = applyAction(state, press('p1', nextKey(state)));
    }
    expect(state.phase).toBe('won');
    expect(state.penaltySeq).toBe(1);
  });

  it('ignores a press on a key that is already lit', () => {
    let state = started();
    const keyIndex = nextKey(state);
    state = applyAction(state, press('p1', keyIndex));
    const again = applyAction(state, press('p1', keyIndex));
    expect(again.penaltySeq).toBe(0);
    expect(keypadOf(again)).toEqual(keypadOf(state));
  });

  it('takes presses from the operator only, and only on one of the four keys', () => {
    const state = started();
    expect(() => applyAction(state, press('p2', nextKey(state)))).toThrow(/Tastenfeld/);
    expect(() => applyAction(state, press('p1', 4))).toThrow('Ungültige Eingabe.');
    expect(() => applyAction(state, press('p1', -1))).toThrow('Ungültige Eingabe.');
  });

  it(`is solved from the views alone, and any other key is an alarm, for ${SEEDS} seeds`, () => {
    const crew = [def.operatorRoleId, def.manualRoleId];
    for (let seed = 0; seed < SEEDS; seed++) {
      let state = deal(seed);
      let presses = 0;
      let solved = false;
      while (!solved && presses < 4) {
        const views = Object.fromEntries(crew.map((roleId) => [roleId, viewAs(state, roleId)]));
        const moves = keypadModule.solve(def, views, null);
        const move = moves[0];
        if (moves.length !== 1 || move?.roleId !== def.operatorRoleId) {
          throw new Error(`seed ${seed}: expected one press, got ${JSON.stringify(moves)}`);
        }
        const input = keypadModule.inputSchema.parse(move.input);
        for (const [keyIndex, key] of state.keys.entries()) {
          if (!key.lit && keyIndex !== input.keyIndex) {
            const wrong = keypadModule.apply(def, state, { keyIndex }, def.operatorRoleId, ctx);
            expect(wrong.penalty, `seed ${seed}, key ${keyIndex}`).not.toBeNull();
          }
        }
        const result = keypadModule.apply(def, state, input, def.operatorRoleId, ctx);
        expect(result.penalty, `seed ${seed}`).toBeNull();
        state = result.state;
        solved = result.solved;
        presses += 1;
      }
      expect(solved, `seed ${seed}`).toBe(true);
      expect(presses).toBe(4);
    }
  });

  it("refuses to solve without the operator's keys or the manual role", () => {
    const state = deal(1);
    const operator = viewAs(state, def.operatorRoleId);
    const manual = viewAs(state, def.manualRoleId);
    expect(() => keypadModule.solve(def, { [def.operatorRoleId]: operator }, null)).toThrow(
      /manual role/,
    );
    expect(() => keypadModule.solve(def, { [def.manualRoleId]: manual }, null)).toThrow(
      /operator's keys/,
    );
  });
});
