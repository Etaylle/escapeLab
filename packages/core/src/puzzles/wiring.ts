import { z } from 'zod';
import { indicatorLit, serialLastDigitIsOdd, type Edgework } from '../edgework.js';
import { commonDefShape, type ManualSection, type PuzzleModule } from './module.js';

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
 */
const RULE_LISTS: readonly { wireCount: number; rules: readonly Rule[] }[] = [
  {
    wireCount: 3,
    rules: [
      {
        text: 'Mehr als ein schwarzes Kabel: das erste schwarze Kabel.',
        applies: (c) => count(c, 'schwarz') > 1,
        cut: (c) => c.indexOf('schwarz'),
      },
      {
        text: 'Letztes Kabel gelb: das erste Kabel.',
        applies: (c) => c[lastPosition(c)] === 'gelb',
        cut: () => 0,
      },
      {
        text: 'Genau ein rotes Kabel: das zweite Kabel.',
        applies: (c) => count(c, 'rot') === 1,
        cut: () => 1,
      },
      {
        text: 'Erstes Kabel blau: das letzte blaue Kabel.',
        applies: (c) => c[0] === 'blau',
        cut: (c) => c.lastIndexOf('blau'),
      },
      { text: 'Sonst: das letzte Kabel.', applies: () => true, cut: lastPosition },
    ],
  },
  {
    wireCount: 4,
    rules: [
      {
        text: 'Laborkennung endet ungerade und kein gelbes Kabel: das zweite Kabel.',
        applies: (c, e) => serialLastDigitIsOdd(e) && count(c, 'gelb') === 0,
        cut: () => 1,
      },
      {
        text: 'Mehr als ein weißes Kabel: das erste weiße Kabel.',
        applies: (c) => count(c, 'weiß') > 1,
        cut: (c) => c.indexOf('weiß'),
      },
      {
        text: 'Genau ein rotes Kabel: das letzte Kabel.',
        applies: (c) => count(c, 'rot') === 1,
        cut: lastPosition,
      },
      {
        text: 'Kein schwarzes Kabel: das erste Kabel.',
        applies: (c) => count(c, 'schwarz') === 0,
        cut: () => 0,
      },
      { text: 'Sonst: das dritte Kabel.', applies: () => true, cut: () => 2 },
    ],
  },
  {
    wireCount: 5,
    rules: [
      {
        text: 'Kontrollleuchte FRQ leuchtet und genau ein blaues Kabel: das letzte Kabel.',
        applies: (c, e) => indicatorLit(e, 'FRQ') && count(c, 'blau') === 1,
        cut: lastPosition,
      },
      {
        text: 'Letztes Kabel rot: das dritte Kabel.',
        applies: (c) => c[lastPosition(c)] === 'rot',
        cut: () => 2,
      },
      {
        text: 'Kein gelbes Kabel: das erste Kabel.',
        applies: (c) => count(c, 'gelb') === 0,
        cut: () => 0,
      },
      {
        text: 'Mehr als ein weißes Kabel: das letzte weiße Kabel.',
        applies: (c) => count(c, 'weiß') > 1,
        cut: (c) => c.lastIndexOf('weiß'),
      },
      {
        text: 'Genau ein schwarzes Kabel: das vierte Kabel.',
        applies: (c) => count(c, 'schwarz') === 1,
        cut: () => 3,
      },
      { text: 'Sonst: das zweite Kabel.', applies: () => true, cut: () => 1 },
    ],
  },
  {
    wireCount: 6,
    rules: [
      {
        text: 'Mindestens zwei Notstromzellen und kein weißes Kabel: das zweite Kabel.',
        applies: (c, e) => e.cells >= 2 && count(c, 'weiß') === 0,
        cut: () => 1,
      },
      {
        text: 'Mehr als ein gelbes Kabel: das letzte gelbe Kabel.',
        applies: (c) => count(c, 'gelb') > 1,
        cut: (c) => c.lastIndexOf('gelb'),
      },
      {
        text: 'Genau ein schwarzes Kabel: das schwarze Kabel.',
        applies: (c) => count(c, 'schwarz') === 1,
        cut: (c) => c.indexOf('schwarz'),
      },
      {
        text: 'Erstes Kabel blau: das vierte Kabel.',
        applies: (c) => c[0] === 'blau',
        cut: () => 3,
      },
      {
        text: 'Genau ein rotes Kabel: das dritte Kabel.',
        applies: (c) => count(c, 'rot') === 1,
        cut: () => 2,
      },
      { text: 'Sonst: das erste Kabel.', applies: () => true, cut: () => 0 },
    ],
  },
];

/** Zero-based position of the one wire the printed rules say to cut. */
function wireToCut(colors: readonly WireColor[], edgework: Edgework): number {
  const list = RULE_LISTS.find((l) => l.wireCount === colors.length);
  const at = list?.rules.find((rule) => rule.applies(colors, edgework))?.cut(colors) ?? -1;
  if (at < 0 || at >= colors.length) {
    throw new Error(
      `wiring: the rules decide nothing for ${colors.length} wires (${colors.join(', ')})`,
    );
  }
  return at;
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
    const solved = at === wireToCut(state.wires.map((w) => w.color), ctx.edgework);
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
    return [
      {
        heading: 'Notstrom-Brücken',
        blocks: [
          {
            kind: 'p',
            text:
              'Zuerst alle Kabel von oben nach unten ansagen, jedes mit Farbe. Gezählt wird ' +
              'von oben; getrennte Kabel zählen mit. Es gilt nur die Liste zur Kabelzahl: ' +
              'Regeln der Reihe nach prüfen, die erste zutreffende entscheidet. ' +
              `Falsches Kabel: Alarm, −${def.penaltySec} s.`,
          },
        ],
      },
      ...RULE_LISTS.map(
        (list): ManualSection => ({
          heading: `${list.wireCount} Kabel`,
          blocks: [{ kind: 'rules', items: list.rules.map((rule) => rule.text) }],
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
    const wire = wires[wireToCut(wires.map((w) => w.color), edgework)];
    return wire === undefined || wire.cut ? [] : [{ by: 'operator', input: { wireId: wire.id } }];
  },
};
