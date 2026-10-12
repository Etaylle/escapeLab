import { z } from 'zod';
import { indicatorLit, serialLastDigitIsOdd, type Edgework } from '../edgework.js';
import type { Rng } from '../rng.js';
import { commonDefShape, type PuzzleModule } from './module.js';

/**
 * Switch bank (Keep Talking's complicated wires as toggles): the operator
 * sees six switches, each with an LED, a colour marking and maybe a star.
 * The manual maps every combination of those features to a letter; some
 * letters ask the edgework. All switches start down, toggling is free, and
 * PRÜFEN with any switch in the wrong position costs time.
 */
const defSchema = z.strictObject({
  type: z.literal('switches'),
  ...commonDefShape,
  penaltySec: z.number().int().positive().default(20),
});
export type SwitchesDef = z.infer<typeof defSchema>;

const SWITCH_COUNT = 6;

/** One switch of the bank: its features, rolled per run, and its lever. */
export interface Switch {
  led: boolean;
  red: boolean;
  blue: boolean;
  star: boolean;
  up: boolean;
}

export interface SwitchesState {
  type: 'switches';
  /** left to right */
  switches: Switch[];
  /** PRÜFEN presses that failed so far */
  attempts: number;
}

const inputSchema = z.union([
  z.strictObject({ switchIndex: z.number().int().min(0).max(SWITCH_COUNT - 1) }),
  z.strictObject({ check: z.literal(true) }),
]);
export type SwitchesInput = z.infer<typeof inputSchema>;

export interface SwitchesView {
  kind: 'switches';
  /** the bank, left to right — only operators get it */
  switches: Switch[] | null;
  attempts: number;
}

type Letter = 'U' | 'N' | 'G' | 'Z' | 'L';
type Marking = 'keine' | 'rot' | 'blau' | 'beides';
type Row = readonly [led: boolean, marking: Marking, star: boolean, letter: Letter];

/** Whether a switch with this letter has to end up, in this run's lab. */
const MUST_BE_UP: Record<Letter, (edgework: Edgework) => boolean> = {
  U: () => true,
  N: () => false,
  G: (edgework) => !serialLastDigitIsOdd(edgework),
  Z: (edgework) => edgework.cells >= 2,
  L: (edgework) => indicatorLit(edgework, 'SIG'),
};

/** The printed table, row for row: every combination of the features exactly once. */
const TABLE: readonly Row[] = [
  [false, 'keine', false, 'N'],
  [false, 'keine', true, 'U'],
  [false, 'rot', false, 'U'],
  [false, 'rot', true, 'G'],
  [false, 'blau', false, 'Z'],
  [false, 'blau', true, 'N'],
  [false, 'beides', false, 'L'],
  [false, 'beides', true, 'Z'],
  [true, 'keine', false, 'G'],
  [true, 'keine', true, 'L'],
  [true, 'rot', false, 'Z'],
  [true, 'rot', true, 'U'],
  [true, 'blau', false, 'L'],
  [true, 'blau', true, 'G'],
  [true, 'beides', false, 'N'],
  [true, 'beides', true, 'U'],
];

function markingOf(sw: Switch): Marking {
  if (sw.red && sw.blue) {
    return 'beides';
  }
  if (sw.red) {
    return 'rot';
  }
  return sw.blue ? 'blau' : 'keine';
}

function mustBeUp(sw: Switch, edgework: Edgework): boolean {
  const marking = markingOf(sw);
  const row = TABLE.find(([led, m, star]) => led === sw.led && m === marking && star === sw.star);
  if (row === undefined) {
    throw new Error(`switches: the table has no row for ${JSON.stringify(sw)}`);
  }
  return MUST_BE_UP[row[3]](edgework);
}

/** A switch in the down position with the features of a random row out of `rows`. */
function rollSwitch(rows: readonly Row[], rng: Rng): Switch {
  const row = rows[Math.floor(rng() * rows.length)];
  if (row === undefined) {
    throw new Error('switches: no table row to roll a switch from');
  }
  const [led, marking, star] = row;
  return {
    led,
    red: marking === 'rot' || marking === 'beides',
    blue: marking === 'blau' || marking === 'beides',
    star,
    up: false,
  };
}

export const switchesModule: PuzzleModule<
  SwitchesDef,
  SwitchesState,
  SwitchesInput,
  SwitchesView
> = {
  type: 'switches',
  usesEdgework: true,
  wholeCrew: false,
  defSchema,
  inputSchema,

  init(_def, rng, { edgework }) {
    const switches = Array.from({ length: SWITCH_COUNT }, () => rollSwitch(TABLE, rng));
    // All down or all up could be guessed without the manual. The table has
    // U and N rows, so a switch with the other outcome always exists.
    const ups = switches.filter((sw) => mustBeUp(sw, edgework)).length;
    if (ups === 0 || ups === SWITCH_COUNT) {
      const other = TABLE.filter(([, , , letter]) => MUST_BE_UP[letter](edgework) === (ups === 0));
      switches[Math.floor(rng() * SWITCH_COUNT)] = rollSwitch(other, rng);
    }
    return { type: 'switches', switches, attempts: 0 };
  },

  apply(_def, state, input, _playerId, { edgework }) {
    if (!('check' in input)) {
      const switches = state.switches.map((sw, i) =>
        i === input.switchIndex ? { ...sw, up: !sw.up } : sw,
      );
      return { state: { ...state, switches }, solved: false, penalty: null };
    }
    if (state.switches.every((sw) => sw.up === mustBeUp(sw, edgework))) {
      return { state, solved: true, penalty: null };
    }
    return {
      state: { ...state, attempts: state.attempts + 1 },
      solved: false,
      penalty: 'Falsche Schalterstellung',
    };
  },

  view(_def, state, viewer) {
    return {
      kind: 'switches',
      switches: viewer.operating ? state.switches.map((sw) => ({ ...sw })) : null,
      attempts: state.attempts,
    };
  },

  manual(def) {
    return [
      {
        heading: 'Subsysteme',
        blocks: [
          {
            kind: 'p',
            text:
              'Sechs Kippschalter, von links nach rechts 1 bis 6, stehen anfangs alle UNTEN. ' +
              'Jeder hat drei Merkmale: LED (an oder aus), Markierung (rot, blau, beides oder ' +
              'keine), Stern (ja oder nein). Die Tabelle gibt zu jeder Kombination einen ' +
              'Buchstaben.',
          },
          {
            kind: 'table',
            head: ['LED', 'Markierung', 'Stern', 'Buchstabe'],
            rows: TABLE.map(([led, marking, star, letter]) => [
              led ? 'an' : 'aus',
              marking,
              star ? 'ja' : 'nein',
              letter,
            ]),
          },
          {
            kind: 'rules',
            items: [
              'U: umlegen.',
              'N: nicht umlegen.',
              'G: umlegen, wenn die Laborkennung auf eine gerade Ziffer endet (0, 2, 4, 6, 8).',
              'Z: umlegen, wenn mindestens zwei Notstromzellen vorhanden sind.',
              'L: umlegen, wenn die Kontrollleuchte SIG vorhanden ist und leuchtet.',
              'Sonst: nicht umlegen.',
            ],
          },
          {
            kind: 'p',
            text:
              'Endstellung: umlegen = OBEN, nicht umlegen = UNTEN. Erst alle sechs Schalter ' +
              'ansagen und stellen, dann einmal PRÜFEN. Umlegen ist gefahrlos. PRÜFEN mit ' +
              `falscher Stellung: Alarm, −${def.penaltySec} s; die Schalter bleiben, wie sie ` +
              'stehen.',
          },
        ],
      },
    ];
  },

  solve(def, { operator }, edgework) {
    if (edgework === null) {
      throw new Error(
        `switches "${def.id}": the rules read the edgework, but nobody has read the sign yet`,
      );
    }
    const bank = operator.switches;
    if (bank === null) {
      throw new Error(`switches "${def.id}": solving needs the operator's view of the bank`);
    }
    const switchIndex = bank.findIndex((sw) => sw.up !== mustBeUp(sw, edgework));
    return [{ by: 'operator', input: switchIndex < 0 ? { check: true } : { switchIndex } }];
  },
};
