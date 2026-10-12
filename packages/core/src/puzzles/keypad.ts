import { z } from 'zod';
import { fail } from '../errors.js';
import { shuffle } from '../rng.js';
import { commonDefShape, type PuzzleModule } from './module.js';

/**
 * Symbol keypad: four glyphs on a 2×2 keypad, all from one column of a fixed
 * table that only the manual prints. The operator describes the glyphs; the
 * manual role finds the one column that holds all four and reads their order
 * from top to bottom. A correct press lights its key for good; a wrong press
 * costs time but keeps the lit keys.
 */

/**
 * The printed table: six columns of seven glyphs, 27 different ones. A glyph
 * may stand in two columns, but no four glyphs of one column stand together
 * in another, so the four keys always point at exactly one column. Every
 * glyph is a single code point that the default fonts of macOS, iOS, Windows
 * and Android carry, and no two are easy to mix up when described.
 */
export const KEYPAD_COLUMNS: readonly (readonly string[])[] = [
  ['Ѳ', 'ƛ', 'Ψ', '☆', '∞', 'Ѣ', 'Ӭ'],
  ['Ӭ', '¶', 'ƛ', 'Ю', '☆', 'Ж', 'ә'],
  ['♪', 'Ѧ', 'Ͼ', 'Ψ', '¤', '⌘', '¶'],
  ['⌘', 'Я', 'ә', 'Ω', 'Ͼ', 'Ұ', 'æ'],
  ['∂', 'Ω', 'Ҋ', 'Ѣ', '¿', 'Ӄ', '₪'],
  ['¿', 'Ж', '₪', 'Ƨ', 'Ѧ', 'Ҋ', 'ξ'],
];

const KEY_COUNT = 4;

const defSchema = z.object({
  type: z.literal('keypad'),
  ...commonDefShape,
  operatorRoleId: z.string().min(1),
  manualRoleId: z.string().min(1),
  penaltySec: z.number().int().positive().default(20),
});
export type KeypadDef = z.infer<typeof defSchema>;

export interface KeypadState {
  type: 'keypad';
  /** the column the keys come from, an index into KEYPAD_COLUMNS */
  column: number;
  /** the four keys in grid order: top left, top right, bottom left, bottom right */
  keys: { glyph: string; lit: boolean }[];
  /** the keys' glyphs in their column's top-to-bottom order — the order to press them in */
  order: string[];
}

const inputSchema = z.strictObject({ keyIndex: z.number().int().min(0).max(KEY_COUNT - 1) });
export type KeypadInput = z.infer<typeof inputSchema>;

export interface KeypadView {
  kind: 'keypad';
  /** the keys in grid order — only the operator sees them */
  keys: { glyph: string; lit: boolean }[] | null;
  /** how many keys are lit — everyone sees how far the code is */
  litCount: number;
}

const litCountOf = (keys: { lit: boolean }[]): number => keys.filter((key) => key.lit).length;

export const keypadModule: PuzzleModule<KeypadDef, KeypadState, KeypadInput, KeypadView> = {
  type: 'keypad',
  usesEdgework: false,
  defSchema,
  inputSchema,

  init(def, rng) {
    const column = Math.floor(rng() * KEYPAD_COLUMNS.length);
    const glyphs = KEYPAD_COLUMNS[column];
    if (glyphs === undefined) {
      throw new Error(`keypad "${def.id}": rolled column ${column} of ${KEYPAD_COLUMNS.length}`);
    }
    const dealt = shuffle(glyphs, rng).slice(0, KEY_COUNT);
    return {
      type: 'keypad',
      column,
      keys: dealt.map((glyph) => ({ glyph, lit: false })),
      order: glyphs.filter((glyph) => dealt.includes(glyph)),
    };
  },

  apply(def, state, input, roleId) {
    if (roleId !== def.operatorRoleId) {
      fail('Nur die Rolle am Tastenfeld kann Tasten drücken.');
    }
    const key = state.keys[input.keyIndex];
    if (key === undefined || key.lit) {
      return { state, solved: false, penalty: null };
    }
    const lit = litCountOf(state.keys);
    if (key.glyph !== state.order[lit]) {
      return { state, solved: false, penalty: 'Falsche Taste am Tastenfeld' };
    }
    const keys = state.keys.map((k, i) => (i === input.keyIndex ? { ...k, lit: true } : k));
    return { state: { ...state, keys }, solved: lit + 1 === state.order.length, penalty: null };
  },

  view(def, state, roleId) {
    return {
      kind: 'keypad',
      keys: roleId === def.operatorRoleId ? state.keys.map((key) => ({ ...key })) : null,
      litCount: litCountOf(state.keys),
    };
  },

  manual(def) {
    return [
      {
        heading: 'Tastenfeld',
        blocks: [
          {
            kind: 'p',
            text:
              'Vier Tasten mit je einem Zeichen, sichtbar nur am Tastenfeld. Genau eine Spalte ' +
              'der Tabelle enthält alle vier Zeichen. Die Tasten in der Reihenfolge drücken, in ' +
              'der ihre Zeichen in dieser Spalte stehen, von oben nach unten. Falsche Taste: ' +
              `Alarm, −${def.penaltySec} s. Bereits leuchtende Tasten bleiben an.`,
          },
          { kind: 'columns', columns: KEYPAD_COLUMNS.map((column) => [...column]) },
        ],
      },
    ];
  },

  /** The manual role's printed table is this module's own, so the solver reads that. */
  solve(def, views) {
    const keys = views[def.operatorRoleId]?.keys;
    if (keys == null || views[def.manualRoleId] === undefined) {
      throw new Error(`keypad "${def.id}": solving needs the operator's keys and the manual role`);
    }
    const glyphs = keys.map((key) => key.glyph);
    const column = KEYPAD_COLUMNS.find((c) => glyphs.every((glyph) => c.includes(glyph)));
    if (column === undefined) {
      throw new Error(`keypad "${def.id}": no column holds all of ${glyphs.join(' ')}`);
    }
    const next = column.find((glyph) => keys.some((key) => key.glyph === glyph && !key.lit));
    const keyIndex = keys.findIndex((key) => key.glyph === next);
    return keyIndex < 0 ? [] : [{ roleId: def.operatorRoleId, input: { keyIndex } }];
  },
};
