import { z } from 'zod';
import { shuffle } from '../rng.js';
import { commonDefShape, type PuzzleModule } from './module.js';
import { costOf, labDocument, type TypePlate } from './printed.js';

/**
 * Symbol keypad: four glyphs on a 2×2 keypad, all from one column of a fixed
 * table that only the manual prints. The operator describes the glyphs; the
 * reader finds the one column that holds all four and reads their order
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

// --- the printed document --------------------------------------------------------------

const PLATE: TypePlate = { name: 'Zeichentastenfeld', type: 'ZT-4', year: 1991 };

const PURPOSE =
  'Das Tastenfeld gibt Türen und Schränke frei, ohne dass ein Code auf Papier steht: Die ' +
  'Zeichen wechseln mit jeder Neubelegung, die Reihenfolge ergibt allein die Zeichentafel ' +
  'unten.';

const BUILD =
  'Vier Tasten, zwei über zwei, jede mit einem Zeichen der Tafel. Die Tafel hat sechs ' +
  'Spalten; genau eine enthält alle vier Zeichen eines Feldes.';

/** Betrieb: the order the pad takes its keys in, the lit keys, the wrong key and its cost. */
function operationText(def: KeypadDef): string {
  return (
    'Das Feld nimmt die Tasten in der Reihenfolge an, in der ihre Zeichen in dieser Spalte ' +
    'von oben nach unten stehen; jede richtige leuchtet und bleibt an. Bei einer falschen ' +
    `meldet die Überwachung Alarm und zieht ${costOf(def.penaltySec)} ab; leuchtende Tasten ` +
    'bleiben an.'
  );
}

/**
 * The printed log: four keys from the third column, in grid order, and the
 * order that column gives them. No other column holds all four.
 */
const LOG: readonly string[] = [
  '10:05 Feld zeigt, oben links bis unten rechts: ¶, Ψ, ♪, ⌘.',
  '10:05 Alle vier stehen nur in Spalte 3.',
  '10:06 Angenommen in der Folge dieser Spalte: ♪, Ψ, ⌘, ¶.',
];

const WORKSHOP: readonly string[] = [
  'Im Labor heißen die Zeichen nach ihrer Form: Dreizack, Hufeisen, Note, liegende Acht.',
  'Die Tafel gilt nur spaltenweise, von oben nach unten; ihre Zeilen bedeuten nichts.',
];

const defSchema = z.strictObject({
  type: z.literal('keypad'),
  ...commonDefShape,
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
  /** the keys in grid order — only operators see them */
  keys: { glyph: string; lit: boolean }[] | null;
  /** how many keys are lit — everyone sees how far the code is */
  litCount: number;
}

const litCountOf = (keys: { lit: boolean }[]): number => keys.filter((key) => key.lit).length;

export const keypadModule: PuzzleModule<KeypadDef, KeypadState, KeypadInput, KeypadView> = {
  type: 'keypad',
  usesEdgework: false,
  wholeCrew: false,
  fields: [],
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

  apply(_def, state, input) {
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

  view(_def, state, viewer) {
    return {
      kind: 'keypad',
      keys: viewer.operating ? state.keys.map((key) => ({ ...key })) : null,
      litCount: litCountOf(state.keys),
    };
  },

  manual(def) {
    return labDocument({
      plate: PLATE,
      purpose: PURPOSE,
      figure: { of: 'keypad', device: 'Tastenfeld mit Zeichen' },
      build: BUILD,
      operation: operationText(def),
      law: [
        {
          heading: 'Zeichentafel',
          blocks: [{ kind: 'columns', columns: KEYPAD_COLUMNS.map((column) => [...column]) }],
        },
      ],
      log: LOG,
      workshop: WORKSHOP,
    });
  },

  /** The reader's printed table is this module's own, so the solver reads that. */
  solve(def, { operator }) {
    const keys = operator.keys;
    if (keys === null) {
      throw new Error(`keypad "${def.id}": solving needs the operator's view of the keys`);
    }
    const glyphs = keys.map((key) => key.glyph);
    const column = KEYPAD_COLUMNS.find((c) => glyphs.every((glyph) => c.includes(glyph)));
    if (column === undefined) {
      throw new Error(`keypad "${def.id}": no column holds all of ${glyphs.join(' ')}`);
    }
    const next = column.find((glyph) => keys.some((key) => key.glyph === glyph && !key.lit));
    const keyIndex = keys.findIndex((key) => key.glyph === next);
    return keyIndex < 0 ? [] : [{ by: 'operator', input: { keyIndex } }];
  },
};
