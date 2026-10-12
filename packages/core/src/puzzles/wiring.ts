import { z } from 'zod';
import { indicatorLit, serialLastDigitIsOdd, type Edgework } from '../edgework.js';
import {
  commonDefShape,
  type ManualBlock,
  type ManualSection,
  type PuzzleModule,
} from './module.js';
import { deviceFigure, penaltyLine, workedExample } from './printed.js';

/**
 * Emergency-power bridges, after Keep Talking's wires: the operator sees three
 * to six coloured wires, the manual holds one numbered rule list per wire
 * count. The rules read the colours by count and position, and the lab's
 * edgework, so exactly one wire is right — a different one every run, while
 * the printed lists never change. A wrong cut costs time, and that wire stays
 * cut.
 */

export const WIRE_COLORS = ['rot', 'blau', 'gelb', 'weiß', 'schwarz'] as const;
export type WireColor = (typeof WIRE_COLORS)[number];

const MIN_WIRES = 3;
const MAX_WIRES = 6;
const wireCountSchema = z.number().int().min(MIN_WIRES).max(MAX_WIRES);

const defSchema = z
  .strictObject({
    type: z.literal('wiring'),
    ...commonDefShape,
    /** how many wires a run may draw, both ends included */
    wires: z
      .object({ min: wireCountSchema, max: wireCountSchema })
      .default({ min: MIN_WIRES, max: MAX_WIRES }),
    penaltySec: z.number().int().positive().default(30),
  })
  .superRefine((def, ctx) => {
    if (def.wires.min > def.wires.max) {
      ctx.addIssue({
        code: 'custom',
        path: ['wires'],
        message:
          `puzzle "${def.id}": wires.min (${def.wires.min}) is above wires.max ` +
          `(${def.wires.max}) — swap them or make them equal`,
      });
    }
  });
export type WiringDef = z.infer<typeof defSchema>;

export interface Wire {
  id: string;
  color: WireColor;
  cut: boolean;
}

export interface WiringState {
  type: 'wiring';
  /** top to bottom, as the operator sees them; cut wires stay in place */
  wires: Wire[];
}

const inputSchema = z.strictObject({ wireId: z.string().min(1) });
export type WiringInput = z.infer<typeof inputSchema>;

export interface WiringView {
  kind: 'wiring';
  /** top to bottom — only operators see the wires, everyone else gets null */
  wires: Wire[] | null;
  wireCount: number;
  cutsDone: number;
}

interface Rule {
  /** the printed line */
  text: string;
  applies(colors: readonly WireColor[], edgework: Edgework): boolean;
  /** zero-based position of the wire to cut; only asked once the rule applies */
  cut(colors: readonly WireColor[]): number;
}

const count = (colors: readonly WireColor[], color: WireColor): number =>
  colors.filter((c) => c === color).length;
const lastPosition = (colors: readonly WireColor[]): number => colors.length - 1;

/**
 * The printed lists, one per wire count. The first rule that applies decides,
 * every list ends in a catch-all, and a rule that names a colour's wire only
 * applies when such a wire exists — so every colouring has exactly one answer.
 * Each list carries the worked example a manual prints when the def's fewest
 * wires are that list's count.
 */
const RULE_LISTS: readonly {
  wireCount: number;
  rules: readonly Rule[];
  example: readonly string[];
}[] = [
  {
    wireCount: 3,
    rules: [
      {
        text: 'Wenn mehr als ein schwarzes Kabel vorhanden ist, trenne das erste schwarze Kabel.',
        applies: (c) => count(c, 'schwarz') > 1,
        cut: (c) => c.indexOf('schwarz'),
      },
      {
        text: 'Wenn das letzte Kabel gelb ist, trenne das erste Kabel.',
        applies: (c) => c[lastPosition(c)] === 'gelb',
        cut: () => 0,
      },
      {
        text: 'Wenn genau ein rotes Kabel vorhanden ist, trenne das zweite Kabel.',
        applies: (c) => count(c, 'rot') === 1,
        cut: () => 1,
      },
      {
        text: 'Wenn das erste Kabel blau ist, trenne das letzte blaue Kabel.',
        applies: (c) => c[0] === 'blau',
        cut: (c) => c.lastIndexOf('blau'),
      },
      { text: 'Andernfalls trenne das letzte Kabel.', applies: () => true, cut: lastPosition },
    ],
    example: [
      'Gesehen: rot, schwarz, gelb.',
      'Liste 3 Kabel: Regel 2 trifft als erste zu (letztes Kabel gelb).',
      'Getrennt: das erste Kabel, Nr. 1.',
    ],
  },
  {
    wireCount: 4,
    rules: [
      {
        text:
          'Wenn die Laborkennung ungerade endet und kein gelbes Kabel vorhanden ist, ' +
          'trenne das zweite Kabel.',
        applies: (c, e) => serialLastDigitIsOdd(e) && count(c, 'gelb') === 0,
        cut: () => 1,
      },
      {
        text: 'Wenn mehr als ein weißes Kabel vorhanden ist, trenne das erste weiße Kabel.',
        applies: (c) => count(c, 'weiß') > 1,
        cut: (c) => c.indexOf('weiß'),
      },
      {
        text: 'Wenn genau ein rotes Kabel vorhanden ist, trenne das letzte Kabel.',
        applies: (c) => count(c, 'rot') === 1,
        cut: lastPosition,
      },
      {
        text: 'Wenn kein schwarzes Kabel vorhanden ist, trenne das erste Kabel.',
        applies: (c) => count(c, 'schwarz') === 0,
        cut: () => 0,
      },
      { text: 'Andernfalls trenne das dritte Kabel.', applies: () => true, cut: () => 2 },
    ],
    example: [
      'Gesehen: rot, weiß, blau, schwarz. Kennung endet auf 4.',
      'Liste 4 Kabel: Regel 3 trifft als erste zu (genau ein rotes Kabel).',
      'Getrennt: das letzte Kabel, Nr. 4.',
    ],
  },
  {
    wireCount: 5,
    rules: [
      {
        text:
          'Wenn die Kontrollleuchte FRQ leuchtet und genau ein blaues Kabel vorhanden ist, ' +
          'trenne das letzte Kabel.',
        applies: (c, e) => indicatorLit(e, 'FRQ') && count(c, 'blau') === 1,
        cut: lastPosition,
      },
      {
        text: 'Wenn das letzte Kabel rot ist, trenne das dritte Kabel.',
        applies: (c) => c[lastPosition(c)] === 'rot',
        cut: () => 2,
      },
      {
        text: 'Wenn kein gelbes Kabel vorhanden ist, trenne das erste Kabel.',
        applies: (c) => count(c, 'gelb') === 0,
        cut: () => 0,
      },
      {
        text: 'Wenn mehr als ein weißes Kabel vorhanden ist, trenne das letzte weiße Kabel.',
        applies: (c) => count(c, 'weiß') > 1,
        cut: (c) => c.lastIndexOf('weiß'),
      },
      {
        text: 'Wenn genau ein schwarzes Kabel vorhanden ist, trenne das vierte Kabel.',
        applies: (c) => count(c, 'schwarz') === 1,
        cut: () => 3,
      },
      { text: 'Andernfalls trenne das zweite Kabel.', applies: () => true, cut: () => 1 },
    ],
    example: [
      'Gesehen: blau, gelb, weiß, schwarz, rot. FRQ leuchtet nicht.',
      'Liste 5 Kabel: Regel 2 trifft als erste zu (letztes Kabel rot).',
      'Getrennt: das dritte Kabel, Nr. 3.',
    ],
  },
  {
    wireCount: 6,
    rules: [
      {
        text:
          'Wenn mindestens 2 Notstromzellen eingesetzt sind und kein weißes Kabel vorhanden ' +
          'ist, trenne das zweite Kabel.',
        applies: (c, e) => e.cells >= 2 && count(c, 'weiß') === 0,
        cut: () => 1,
      },
      {
        text: 'Wenn mehr als ein gelbes Kabel vorhanden ist, trenne das letzte gelbe Kabel.',
        applies: (c) => count(c, 'gelb') > 1,
        cut: (c) => c.lastIndexOf('gelb'),
      },
      {
        text: 'Wenn genau ein schwarzes Kabel vorhanden ist, trenne das schwarze Kabel.',
        applies: (c) => count(c, 'schwarz') === 1,
        cut: (c) => c.indexOf('schwarz'),
      },
      {
        text: 'Wenn das erste Kabel blau ist, trenne das vierte Kabel.',
        applies: (c) => c[0] === 'blau',
        cut: () => 3,
      },
      {
        text: 'Wenn genau ein rotes Kabel vorhanden ist, trenne das dritte Kabel.',
        applies: (c) => count(c, 'rot') === 1,
        cut: () => 2,
      },
      { text: 'Andernfalls trenne das erste Kabel.', applies: () => true, cut: () => 0 },
    ],
    example: [
      'Gesehen: gelb, rot, gelb, blau, rot, gelb. 1 Notstromzelle eingesetzt.',
      'Liste 6 Kabel: Regel 2 trifft als erste zu (3 gelbe Kabel).',
      'Getrennt: das letzte gelbe Kabel, Nr. 6.',
    ],
  },
];

/**
 * What the printed rules decide for these wires in this lab: the rule that
 * applies first, numbered from 1 as its list prints it, and the zero-based
 * position of the one wire it says to cut.
 */
export function decide(
  colors: readonly WireColor[],
  edgework: Edgework,
): { rule: number; wire: number } {
  const rules = RULE_LISTS.find((l) => l.wireCount === colors.length)?.rules ?? [];
  const index = rules.findIndex((rule) => rule.applies(colors, edgework));
  const wire = rules[index]?.cut(colors) ?? -1;
  if (wire < 0 || wire >= colors.length) {
    throw new Error(
      `wiring: the rules decide nothing for ${colors.length} wires (${colors.join(', ')})`,
    );
  }
  return { rule: index + 1, wire };
}

/** The example the manual prints: the one for the fewest wires the def draws. */
function exampleFor(def: WiringDef): ManualBlock {
  const lines = RULE_LISTS.find((l) => l.wireCount === def.wires.min)?.example;
  if (lines === undefined) {
    throw new Error(`wiring "${def.id}": no worked example for ${def.wires.min} wires`);
  }
  return workedExample(lines);
}

export const wiringModule: PuzzleModule<WiringDef, WiringState, WiringInput, WiringView> = {
  type: 'wiring',
  usesEdgework: true,
  wholeCrew: false,
  defSchema,
  inputSchema,

  init(def, rng) {
    const { min, max } = def.wires;
    const wireCount = min + Math.floor(rng() * (max - min + 1));
    const wires = Array.from({ length: wireCount }, (_, i): Wire => ({
      id: `w${i}`,
      color: WIRE_COLORS[Math.floor(rng() * WIRE_COLORS.length)] ?? 'rot',
      cut: false,
    }));
    return { type: 'wiring', wires };
  },

  apply(_def, state, input, _playerId, ctx) {
    const wire = state.wires.find((w) => w.id === input.wireId);
    if (wire === undefined || wire.cut) {
      // A stale click — that wire is already cut, or was never on this panel.
      return { state, solved: false, penalty: null };
    }
    const at = state.wires.indexOf(wire);
    const solved = at === decide(state.wires.map((w) => w.color), ctx.edgework).wire;
    return {
      state: { ...state, wires: state.wires.map((w, i) => (i === at ? { ...w, cut: true } : w)) },
      solved,
      penalty: solved ? null : 'Falsches Kabel getrennt',
    };
  },

  view(_def, state, viewer) {
    return {
      kind: 'wiring',
      wires: viewer.operating ? state.wires.map((w) => ({ ...w })) : null,
      wireCount: state.wires.length,
      cutsDone: state.wires.filter((w) => w.cut).length,
    };
  },

  manual(def) {
    const closing = [exampleFor(def), penaltyLine(def.penaltySec, 'Das Kabel bleibt getrennt.')];
    return [
      {
        heading: 'Notstrom-Brücken',
        blocks: [
          deviceFigure('wiring', 'Sicherungskasten mit Kabeln'),
          {
            kind: 'p',
            text:
              'Ein Sicherungskasten mit 3 bis 6 Kabeln, von oben nach unten gezählt; getrennte ' +
              'Kabel zählen mit. Genau ein Kabel ist zu trennen. Es gilt die Liste zur ' +
              'Kabelzahl; die erste zutreffende Regel entscheidet.',
          },
        ],
      },
      ...RULE_LISTS.map(
        (list, i): ManualSection => ({
          heading: `${list.wireCount} Kabel`,
          blocks: [
            { kind: 'rules', items: list.rules.map((rule) => rule.text) },
            // The example and the penalty close the manual, under the last list.
            ...(i === RULE_LISTS.length - 1 ? closing : []),
          ],
        }),
      ),
    ];
  },

  solve(def, { operator }, edgework) {
    const wires = operator.wires;
    if (wires === null) {
      throw new Error(`wiring "${def.id}": solving needs the operator's view of the wires`);
    }
    if (edgework === null) {
      throw new Error(
        `wiring "${def.id}": the rules read the edgework, but nobody has read the sign yet`,
      );
    }
    const wire = wires[decide(wires.map((w) => w.color), edgework).wire];
    return wire === undefined || wire.cut ? [] : [{ by: 'operator', input: { wireId: wire.id } }];
  },
};
