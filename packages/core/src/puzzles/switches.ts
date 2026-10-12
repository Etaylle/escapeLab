import { z } from 'zod';
import { indicatorLit, serialLastDigitIsOdd, type Edgework } from '../edgework.js';
import type { Rng } from '../rng.js';
import { commonDefShape, type PuzzleModule } from './module.js';

/**
 * Switch bank (Keep Talking's complicated wires as toggles): the operator
 * sees six switches, each with an LED, a colour marking and, on a bank of
 * three features, maybe a star. The printed table gives every combination
 * of those features the switch's end position in words; some rows ask the
 * edgework. All switches start down, toggling is free, and PRÜFEN with any
 * switch in the wrong position costs time.
 */
const defSchema = z.strictObject({
  type: z.literal('switches'),
  ...commonDefShape,
  /** 3: LED, Markierung and Stern, three conditions; 2: no Stern, one condition */
  features: z.union([z.literal(2), z.literal(3)]).default(3),
  penaltySec: z.number().int().positive().default(20),
});
export type SwitchesDef = z.infer<typeof defSchema>;

const SWITCH_COUNT = 6;

/** One switch of the bank: its features, rolled per run, and its lever. */
export interface Switch {
  led: boolean;
  red: boolean;
  blue: boolean;
  /** always false on a bank of two features */
  star: boolean;
  up: boolean;
}

/** A switch as the station shows it: a bank of two features shows no star. */
export type SwitchView = Omit<Switch, 'star'> & { star?: boolean };

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
  /** how many features the bank shows; with 2 its switches carry no star */
  features: SwitchesDef['features'];
  /** the bank, left to right — only operators get it */
  switches: SwitchView[] | null;
  attempts: number;
}

type Marking = 'keine' | 'rot' | 'blau' | 'beides';

/** Where a row's switch has to end: the words in its last cell, and what they mean in a lab. */
interface Rule {
  text: string;
  up(edgework: Edgework): boolean;
}

const UP: Rule = { text: 'hoch', up: () => true };
const DOWN: Rule = { text: 'runter', up: () => false };
const UP_IF_EVEN: Rule = {
  text: 'hoch, wenn die Kennung gerade endet',
  up: (edgework) => !serialLastDigitIsOdd(edgework),
};
const UP_IF_CELLS: Rule = {
  text: 'hoch, wenn mindestens zwei Zellen',
  up: (edgework) => edgework.cells >= 2,
};
const UP_IF_SIG: Rule = {
  text: 'hoch, wenn SIG leuchtet',
  up: (edgework) => indicatorLit(edgework, 'SIG'),
};

type Row = readonly [led: boolean, marking: Marking, star: boolean, rule: Rule];

/**
 * The printed tables by feature count, row for row: every combination of the
 * features exactly once. A bank of two features rolls no stars, so its rows
 * all read `star: false` and its table prints no Stern column.
 */
const TABLES: Record<SwitchesDef['features'], readonly Row[]> = {
  2: [
    [false, 'keine', false, DOWN],
    [false, 'rot', false, UP],
    [false, 'blau', false, UP_IF_EVEN],
    [false, 'beides', false, DOWN],
    [true, 'keine', false, UP],
    [true, 'rot', false, DOWN],
    [true, 'blau', false, DOWN],
    [true, 'beides', false, UP],
  ],
  3: [
    [false, 'keine', false, DOWN],
    [false, 'keine', true, UP],
    [false, 'rot', false, UP],
    [false, 'rot', true, UP_IF_EVEN],
    [false, 'blau', false, UP_IF_CELLS],
    [false, 'blau', true, DOWN],
    [false, 'beides', false, UP_IF_SIG],
    [false, 'beides', true, UP_IF_CELLS],
    [true, 'keine', false, UP_IF_EVEN],
    [true, 'keine', true, UP_IF_SIG],
    [true, 'rot', false, UP_IF_CELLS],
    [true, 'rot', true, UP],
    [true, 'blau', false, UP_IF_SIG],
    [true, 'blau', true, UP_IF_EVEN],
    [true, 'beides', false, DOWN],
    [true, 'beides', true, UP],
  ],
};

function markingOf(sw: SwitchView): Marking {
  if (sw.red && sw.blue) {
    return 'beides';
  }
  if (sw.red) {
    return 'rot';
  }
  return sw.blue ? 'blau' : 'keine';
}

/** Whether the def's table wants this switch up, in this run's lab. */
function mustBeUp(def: SwitchesDef, sw: SwitchView, edgework: Edgework): boolean {
  const marking = markingOf(sw);
  // A bank of two features shows no star, and its rows read none.
  const star = sw.star ?? false;
  const row = TABLES[def.features].find(
    ([led, m, s]) => led === sw.led && m === marking && s === star,
  );
  if (row === undefined) {
    throw new Error(`switches "${def.id}": the table has no row for ${JSON.stringify(sw)}`);
  }
  return row[3].up(edgework);
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

  init(def, rng, { edgework }) {
    const table = TABLES[def.features];
    const switches = Array.from({ length: SWITCH_COUNT }, () => rollSwitch(table, rng));
    // All down or all up could be guessed without the manual. Both tables have
    // hoch and runter rows, so a switch with the other outcome always exists.
    const ups = switches.filter((sw) => mustBeUp(def, sw, edgework)).length;
    if (ups === 0 || ups === SWITCH_COUNT) {
      const other = table.filter(([, , , rule]) => rule.up(edgework) === (ups === 0));
      switches[Math.floor(rng() * SWITCH_COUNT)] = rollSwitch(other, rng);
    }
    return { type: 'switches', switches, attempts: 0 };
  },

  apply(def, state, input, _playerId, { edgework }) {
    if (!('check' in input)) {
      const switches = state.switches.map((sw, i) =>
        i === input.switchIndex ? { ...sw, up: !sw.up } : sw,
      );
      return { state: { ...state, switches }, solved: false, penalty: null };
    }
    if (state.switches.every((sw) => sw.up === mustBeUp(def, sw, edgework))) {
      return { state, solved: true, penalty: null };
    }
    return {
      state: { ...state, attempts: state.attempts + 1 },
      solved: false,
      penalty: 'Falsche Schalterstellung',
    };
  },

  view(def, state, viewer) {
    return {
      kind: 'switches',
      features: def.features,
      switches: viewer.operating
        ? state.switches.map(({ star, ...sw }) => (def.features === 3 ? { ...sw, star } : sw))
        : null,
      attempts: state.attempts,
    };
  },

  manual(def) {
    const stars = def.features === 3;
    return [
      {
        heading: 'Subsysteme',
        blocks: [
          {
            kind: 'p',
            text:
              `Jeden Schalter von links ansagen: LED, Markierung${stars ? ', Stern' : ''}. ` +
              'Die Zeile sagt, ob er hoch oder runter muss.',
          },
          {
            kind: 'table',
            head: ['LED', 'Markierung', ...(stars ? ['Stern'] : []), 'Stellung'],
            rows: TABLES[def.features].map(([led, marking, star, rule]) => [
              led ? 'an' : 'aus',
              marking,
              ...(stars ? [star ? 'ja' : 'nein'] : []),
              rule.text,
            ]),
          },
          {
            kind: 'p',
            text:
              'Erst alle sechs stellen, dann einmal PRÜFEN – falsche Stellung: Alarm, ' +
              `−${def.penaltySec} s.`,
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
    const switchIndex = bank.findIndex((sw) => sw.up !== mustBeUp(def, sw, edgework));
    return [{ by: 'operator', input: switchIndex < 0 ? { check: true } : { switchIndex } }];
  },
};
