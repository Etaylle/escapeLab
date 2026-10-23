import { z } from 'zod';
import { indicatorLit, serialLastDigitIsOdd, type Edgework } from '../edgework.js';
import { commonDefShape, type ManualSection, type PuzzleModule } from './module.js';
import { costOf, labDocument, spelled, type TypePlate } from './printed.js';

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
  /** the printed condition, after „Wenn"; null for the catch-all that ends a list */
  when: string | null;
  /** the wire the rule names as the bridge, as printed: „das erste schwarze Kabel" */
  bridge: string;
  applies(colors: readonly WireColor[], edgework: Edgework): boolean;
  /** zero-based position of the wire to cut; only asked once the rule applies */
  cut(colors: readonly WireColor[]): number;
}

const count = (colors: readonly WireColor[], color: WireColor): number =>
  colors.filter((c) => c === color).length;
const lastPosition = (colors: readonly WireColor[]): number => colors.length - 1;

/** A rule as its list prints it: the condition and the bridge it names. */
const ruleText = ({ when, bridge }: Rule): string =>
  when === null
    ? `Andernfalls ist ${bridge} die Brücke.`
    : `Wenn ${when}, ist ${bridge} die Brücke.`;

/**
 * The printed lists, one per wire count. The first rule that applies decides,
 * every list ends in a catch-all, and a rule that names a colour's wire only
 * applies when such a wire exists — so every colouring has exactly one answer.
 * Each list carries the log a manual prints when the def's fewest wires are
 * that list's count.
 */
const RULE_LISTS: readonly {
  wireCount: number;
  rules: readonly Rule[];
  log: readonly string[];
}[] = [
  {
    wireCount: 3,
    rules: [
      {
        when: 'mehr als ein schwarzes Kabel vorhanden ist',
        bridge: 'das erste schwarze Kabel',
        applies: (c) => count(c, 'schwarz') > 1,
        cut: (c) => c.indexOf('schwarz'),
      },
      {
        when: 'das letzte Kabel gelb ist',
        bridge: 'das erste Kabel',
        applies: (c) => c[lastPosition(c)] === 'gelb',
        cut: () => 0,
      },
      {
        when: 'genau ein rotes Kabel vorhanden ist',
        bridge: 'das zweite Kabel',
        applies: (c) => count(c, 'rot') === 1,
        cut: () => 1,
      },
      {
        when: 'das erste Kabel blau ist',
        bridge: 'das letzte blaue Kabel',
        applies: (c) => c[0] === 'blau',
        cut: (c) => c.lastIndexOf('blau'),
      },
      { when: null, bridge: 'das letzte Kabel', applies: () => true, cut: lastPosition },
    ],
    log: [
      '03:15 Kasten offen: rot, schwarz, gelb.',
      '03:16 Liste 3 Kabel, Regel 2 trifft als erste zu (letztes Kabel gelb): Brücke ist das ' +
        'erste Kabel.',
      '03:16 Kabel 1 getrennt, die Notversorgung übernimmt.',
    ],
  },
  {
    wireCount: 4,
    rules: [
      {
        when: 'die Laborkennung ungerade endet und kein gelbes Kabel vorhanden ist',
        bridge: 'das zweite Kabel',
        applies: (c, e) => serialLastDigitIsOdd(e) && count(c, 'gelb') === 0,
        cut: () => 1,
      },
      {
        when: 'mehr als ein weißes Kabel vorhanden ist',
        bridge: 'das erste weiße Kabel',
        applies: (c) => count(c, 'weiß') > 1,
        cut: (c) => c.indexOf('weiß'),
      },
      {
        when: 'genau ein rotes Kabel vorhanden ist',
        bridge: 'das letzte Kabel',
        applies: (c) => count(c, 'rot') === 1,
        cut: lastPosition,
      },
      {
        when: 'kein schwarzes Kabel vorhanden ist',
        bridge: 'das erste Kabel',
        applies: (c) => count(c, 'schwarz') === 0,
        cut: () => 0,
      },
      { when: null, bridge: 'das dritte Kabel', applies: () => true, cut: () => 2 },
    ],
    log: [
      '03:15 Kasten offen: rot, weiß, blau, schwarz; Kennung endet auf 4.',
      '03:16 Liste 4 Kabel, Regel 3 trifft als erste zu (genau ein rotes Kabel): Brücke ist ' +
        'das letzte Kabel.',
      '03:16 Kabel 4 getrennt, die Notversorgung übernimmt.',
    ],
  },
  {
    wireCount: 5,
    rules: [
      {
        when: 'die Kontrollleuchte FRQ leuchtet und genau ein blaues Kabel vorhanden ist',
        bridge: 'das letzte Kabel',
        applies: (c, e) => indicatorLit(e, 'FRQ') && count(c, 'blau') === 1,
        cut: lastPosition,
      },
      {
        when: 'das letzte Kabel rot ist',
        bridge: 'das dritte Kabel',
        applies: (c) => c[lastPosition(c)] === 'rot',
        cut: () => 2,
      },
      {
        when: 'kein gelbes Kabel vorhanden ist',
        bridge: 'das erste Kabel',
        applies: (c) => count(c, 'gelb') === 0,
        cut: () => 0,
      },
      {
        when: 'mehr als ein weißes Kabel vorhanden ist',
        bridge: 'das letzte weiße Kabel',
        applies: (c) => count(c, 'weiß') > 1,
        cut: (c) => c.lastIndexOf('weiß'),
      },
      {
        when: 'genau ein schwarzes Kabel vorhanden ist',
        bridge: 'das vierte Kabel',
        applies: (c) => count(c, 'schwarz') === 1,
        cut: () => 3,
      },
      { when: null, bridge: 'das zweite Kabel', applies: () => true, cut: () => 1 },
    ],
    log: [
      '03:15 Kasten offen: blau, gelb, weiß, schwarz, rot; FRQ leuchtet nicht.',
      '03:16 Liste 5 Kabel, Regel 2 trifft als erste zu (letztes Kabel rot): Brücke ist das ' +
        'dritte Kabel.',
      '03:16 Kabel 3 getrennt, die Notversorgung übernimmt.',
    ],
  },
  {
    wireCount: 6,
    rules: [
      {
        when: 'mindestens 2 Notstromzellen eingesetzt sind und kein weißes Kabel vorhanden ist',
        bridge: 'das zweite Kabel',
        applies: (c, e) => e.cells >= 2 && count(c, 'weiß') === 0,
        cut: () => 1,
      },
      {
        when: 'mehr als ein gelbes Kabel vorhanden ist',
        bridge: 'das letzte gelbe Kabel',
        applies: (c) => count(c, 'gelb') > 1,
        cut: (c) => c.lastIndexOf('gelb'),
      },
      {
        when: 'genau ein schwarzes Kabel vorhanden ist',
        bridge: 'das schwarze Kabel',
        applies: (c) => count(c, 'schwarz') === 1,
        cut: (c) => c.indexOf('schwarz'),
      },
      {
        when: 'das erste Kabel blau ist',
        bridge: 'das vierte Kabel',
        applies: (c) => c[0] === 'blau',
        cut: () => 3,
      },
      {
        when: 'genau ein rotes Kabel vorhanden ist',
        bridge: 'das dritte Kabel',
        applies: (c) => count(c, 'rot') === 1,
        cut: () => 2,
      },
      { when: null, bridge: 'das erste Kabel', applies: () => true, cut: () => 0 },
    ],
    log: [
      '03:15 Kasten offen: gelb, rot, gelb, blau, rot, gelb; 1 Notstromzelle eingesetzt.',
      '03:16 Liste 6 Kabel, Regel 2 trifft als erste zu (3 gelbe Kabel): Brücke ist das ' +
        'letzte gelbe Kabel.',
      '03:16 Kabel 6 getrennt, die Notversorgung übernimmt.',
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

// --- the printed document --------------------------------------------------------------

const PLATE: TypePlate = { name: 'Brückenkasten', type: 'NB-6', year: 1978 };

const PURPOSE =
  'Der Brückenkasten legt das Labor bei Netzausfall auf Notstrom: Erst wenn die Brücke ' +
  'getrennt ist, übernimmt die Notversorgung. Welches Kabel die Brücke ist, verraten nur die ' +
  'Listen unten; so wollte es die Sicherheitsabteilung.';

/** Whether a list the def can draw reads the lab's sign: every list from four wires on does. */
const readsTheSign = (def: WiringDef): boolean => def.wires.max >= 4;

/** Aufbau: the wires the def draws, how they are counted, and the sign where a list reads it. */
function buildText(def: WiringDef): string {
  const { min, max } = def.wires;
  const wires = min === max ? spelled(min) : `${spelled(min)} bis ${spelled(max)}`;
  const box =
    `Ein Kasten mit ${wires} Kabeln in Rot, Blau, Gelb, Weiß und Schwarz, von oben nach unten ` +
    'gezählt; getrennte Kabel zählen mit.';
  return readsTheSign(def)
    ? `${box} Manche Regeln fragen nach dem Kennungsschild des Labors: Laborkennung, ` +
        'Kontrollleuchten und eingesetzte Notstromzellen.'
    : box;
}

/** Betrieb: one wire is the bridge; any other is a wrong cut, and what that costs. */
function operationText(def: WiringDef): string {
  return (
    'Getrennt wird genau ein Kabel, die Brücke: Es gilt die Liste zur Kabelzahl und darin die ' +
    'erste Regel, die zutrifft. Ein anderes Kabel ist ein Fehlschnitt; es bleibt getrennt, und ' +
    `die Überwachung meldet Alarm und zieht ${costOf(def.penaltySec)} ab. Der Kasten bleibt ` +
    'danach in Betrieb.'
  );
}

/** Aus der Werkstatt: where the sign is read, and that a wrong cut leaves the bridge as it is. */
function workshopNotes(def: WiringDef): string[] {
  const same =
    'Nach einem Fehlschnitt bleibt die Brücke dieselbe: Das getrennte Kabel zählt weiter mit, ' +
    'die Liste gilt unverändert.';
  return readsTheSign(def)
    ? [
        'Kennung, Leuchten und Zellen stehen auf dem Kennungsschild, nicht am Kasten: vor dem ' +
          'Schnitt nachsehen.',
        same,
      ]
    : [
        'Die erste Regel, die zutrifft, entscheidet, auch wenn eine spätere ebenfalls zutrifft.',
        same,
      ];
}

/** The lists of the wire counts the def can draw, each under its count. */
function ruleSections(def: WiringDef): ManualSection[] {
  return RULE_LISTS.filter(
    ({ wireCount }) => wireCount >= def.wires.min && wireCount <= def.wires.max,
  ).map(({ wireCount, rules }) => ({
    heading: `${wireCount} Kabel`,
    blocks: [{ kind: 'rules', items: rules.map(ruleText) }],
  }));
}

/** The log the manual prints: the one of the list for the fewest wires the def draws. */
function logFor(def: WiringDef): readonly string[] {
  const log = RULE_LISTS.find((l) => l.wireCount === def.wires.min)?.log;
  if (log === undefined) {
    throw new Error(`wiring "${def.id}": no printed log for ${def.wires.min} wires`);
  }
  return log;
}

export const wiringModule: PuzzleModule<WiringDef, WiringState, WiringInput, WiringView> = {
  type: 'wiring',
  usesEdgework: true,
  wholeCrew: false,
  fields: [
    {
      key: 'wires',
      label: 'Drähte',
      help:
        'So viele Drähte kann ein Lauf ziehen, von–bis; jede Anzahl hat ihre eigene ' +
        'Regelliste.',
      kind: 'range',
      min: MIN_WIRES,
      max: MAX_WIRES,
      default: { min: MIN_WIRES, max: MAX_WIRES },
    },
  ],
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
    return labDocument({
      plate: PLATE,
      purpose: PURPOSE,
      figure: { of: 'wiring', device: 'Brückenkasten mit Kabeln' },
      build: buildText(def),
      operation: operationText(def),
      law: ruleSections(def),
      log: logFor(def),
      workshop: workshopNotes(def),
    });
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
