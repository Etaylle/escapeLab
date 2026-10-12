import { z } from 'zod';
import type { Edgework } from '../edgework.js';
import { fail } from '../errors.js';
import { mulberry32, shuffle, type Rng } from '../rng.js';
import { commonDefShape, type ManualBlock, type PuzzleModule } from './module.js';

/**
 * Memory bank: five stages, each a display digit 1–4 over four buttons
 * labelled 1–4 in a random order. The manual's rule for the stage and the
 * digit names the button to press — by position, by label or, from stage 2
 * on, by what was pressed in an earlier stage. The bank never shows an
 * earlier stage, so the crew has to note every press itself. A wrong press
 * costs time and drops the bank back to stage 1, every stage laid out afresh.
 */
const defSchema = z.object({
  type: z.literal('memory'),
  ...commonDefShape,
  operatorRoleId: z.string().min(1),
  manualRoleId: z.string().min(1),
  penaltySec: z.number().int().positive().default(15),
});
export type MemoryDef = z.infer<typeof defSchema>;

/** One press as the crew notes it: where the button sat and what it said. */
export interface MemoryPress {
  /** 0–3, counted from the left */
  position: number;
  /** 1–4 */
  label: number;
}

export interface MemoryState {
  type: 'memory';
  /** 1–5 */
  stage: number;
  /** the digit on the display, 1–4 */
  display: number;
  /** the button labels in position order, a permutation of 1–4 */
  labels: number[];
  /** the presses of the stages cleared since the last fall back to stage 1 — never in a view */
  history: MemoryPress[];
  /** what the next layout is drawn from: `apply` gets no rng of its own */
  seed: number;
}

const inputSchema = z.strictObject({ position: z.number().int().min(0).max(3) });
export type MemoryInput = z.infer<typeof inputSchema>;

export interface MemoryView {
  kind: 'memory';
  /** 1–5, for everyone at the puzzle */
  stage: number;
  /** the display digit — only the operator gets it */
  display: number | null;
  /** the button labels in position order — only the operator gets them */
  labels: number[] | null;
}

/** The contract, with the crew's notes as an extra argument to the solver. */
export interface MemoryModule
  extends PuzzleModule<MemoryDef, MemoryState, MemoryInput, MemoryView> {
  solve(
    def: MemoryDef,
    views: Record<string, MemoryView>,
    edgework: Edgework | null,
    log?: readonly MemoryPress[],
  ): { roleId: string; input: MemoryInput }[];
}

/** The button labels, and the digits the display can show. */
const DIGITS = [1, 2, 3, 4] as const;
type Digit = (typeof DIGITS)[number];

/** What a rule line points at. */
type Target =
  | { by: 'position'; nth: Digit }
  | { by: 'label'; label: Digit }
  | { by: 'samePosition'; stage: number }
  | { by: 'sameLabel'; stage: number };
type Row = readonly [Target, Target, Target, Target];

const nth = (n: Digit): Target => ({ by: 'position', nth: n });
const labelled = (label: Digit): Target => ({ by: 'label', label });
const samePosition = (stage: number): Target => ({ by: 'samePosition', stage });
const sameLabel = (stage: number): Target => ({ by: 'sameLabel', stage });

/**
 * The button to press, by stage (rows) and display digit (columns). Rules
 * only look back, and between them they ask for the position and the label
 * of each of stages 1–4, so the crew has to note both every time.
 */
const RULES: readonly [Row, Row, Row, Row, Row] = [
  [nth(2), labelled(4), nth(1), labelled(3)],
  [sameLabel(1), nth(4), samePosition(1), labelled(2)],
  [samePosition(2), labelled(1), sameLabel(1), sameLabel(2)],
  [sameLabel(3), samePosition(1), nth(3), samePosition(3)],
  [samePosition(4), sameLabel(2), sameLabel(4), samePosition(3)],
];
const STAGES = RULES.length;

const ORDINALS: Record<Digit, string> = { 1: 'erste', 2: 'zweite', 3: 'dritte', 4: 'vierte' };

function pressIn(presses: readonly MemoryPress[], stage: number): MemoryPress {
  const press = presses[stage - 1];
  if (press === undefined) {
    throw new Error(
      `memory: a rule needs the press of stage ${stage}, but only ${presses.length} are known`,
    );
  }
  return press;
}

/** The position the rule for this stage and display points at. */
function targetPosition(
  stage: number,
  display: number,
  labels: readonly number[],
  presses: readonly MemoryPress[],
): number {
  const target = RULES[stage - 1]?.[display - 1];
  if (target === undefined) {
    throw new Error(`memory: no rule for stage ${stage} and display ${display}`);
  }
  switch (target.by) {
    case 'position':
      return target.nth - 1;
    case 'label':
      return labels.indexOf(target.label);
    case 'samePosition':
      return pressIn(presses, target.stage).position;
    case 'sameLabel':
      return labels.indexOf(pressIn(presses, target.stage).label);
  }
}

/** A rule as the manual prints it. */
function ruleText(target: Target): string {
  switch (target.by) {
    case 'position':
      return `die ${ORDINALS[target.nth]} Taste`;
    case 'label':
      return `die Taste mit der ${target.label}`;
    case 'samePosition':
      return `dieselbe Position wie in Stufe ${target.stage}`;
    case 'sameLabel':
      return `dieselbe Beschriftung wie in Stufe ${target.stage}`;
  }
}

/** The display shows nothing but 1–4, so the line for the last digit is the catch-all. */
const lineHead = (display: number): string =>
  display < DIGITS.length ? `Zeigt das Display ${display}` : `Sonst (Display ${display})`;

/** A fresh layout for one stage, and the seed the next one is drawn from. */
function drawStage(rng: Rng): Pick<MemoryState, 'display' | 'labels' | 'seed'> {
  return {
    display: 1 + Math.floor(rng() * DIGITS.length),
    labels: shuffle(DIGITS, rng),
    seed: Math.floor(rng() * 2 ** 32),
  };
}

export const memoryModule: MemoryModule = {
  type: 'memory',
  usesEdgework: false,
  defSchema,
  inputSchema,

  init: (_def, rng) => ({ type: 'memory', stage: 1, history: [], ...drawStage(rng) }),

  apply(def, state, input, roleId) {
    if (roleId !== def.operatorRoleId) {
      fail('Nur die Rolle an der Speicherbank kann Tasten drücken.');
    }
    const label = state.labels[input.position];
    if (label === undefined) {
      return { state, solved: false, penalty: null };
    }
    const next = drawStage(mulberry32(state.seed));
    const target = targetPosition(state.stage, state.display, state.labels, state.history);
    if (input.position !== target) {
      return {
        state: { ...state, stage: 1, history: [], ...next },
        solved: false,
        penalty: 'Falsche Taste an der Speicherbank',
      };
    }
    const history = [...state.history, { position: input.position, label }];
    if (state.stage >= STAGES) {
      return { state: { ...state, history }, solved: true, penalty: null };
    }
    return {
      state: { ...state, stage: state.stage + 1, history, ...next },
      solved: false,
      penalty: null,
    };
  },

  view(def, state, roleId) {
    const isOperator = roleId === def.operatorRoleId;
    return {
      kind: 'memory',
      stage: state.stage,
      display: isOperator ? state.display : null,
      labels: isOperator ? [...state.labels] : null,
    };
  },

  manual(def) {
    return [
      {
        heading: 'Speicherbank',
        blocks: [
          {
            kind: 'p',
            text:
              'Display mit einer Ziffer 1–4, darunter vier Tasten mit den Ziffern 1–4 in ' +
              'wechselnder Reihenfolge. Fünf Stufen: Jede richtige Taste schaltet eine Stufe ' +
              'weiter, nach Stufe 5 ist die Bank frei.',
          },
          {
            kind: 'p',
            text:
              'Position: von links gezählt, erste bis vierte Taste. Beschriftung: die Ziffer ' +
              'auf der Taste. „Wie in Stufe k“ meint die Taste, die in Stufe k gedrückt wurde.',
          },
          {
            kind: 'p',
            text:
              'Die Bank zeigt nur die laufende Stufe. Nach jedem Druck Position und ' +
              'Beschriftung notieren.',
          },
          {
            kind: 'p',
            text:
              `Falsche Taste: Alarm, −${def.penaltySec} s. Zurück auf Stufe 1, alle Stufen ` +
              'neu belegt, die Notizen verfallen.',
          },
          ...RULES.flatMap((row, i): ManualBlock[] => [
            { kind: 'p', text: `Stufe ${i + 1}:` },
            {
              kind: 'rules',
              items: row.map((target, j) => `${lineHead(j + 1)}: ${ruleText(target)}.`),
            },
          ]),
        ],
      },
    ];
  },

  /**
   * The bank never shows an earlier stage, so past stage 1 the solver needs
   * what the crew wrote down: `log` holds the press of every stage cleared
   * since the last fall back to stage 1, oldest first — the position pressed
   * and the label that button showed in the operator's view. Without a log
   * only stage 1 is solvable; a later stage throws, as does a log that does
   * not match the stage.
   */
  solve(def, views, _edgework, log = []) {
    const bank = views[def.operatorRoleId];
    if (bank?.display == null || bank.labels === null) {
      throw new Error(`memory "${def.id}": solving needs the operator's view of the bank`);
    }
    if (log.length !== bank.stage - 1) {
      throw new Error(
        `memory "${def.id}": stage ${bank.stage} needs the crew's notes of the ` +
          `${bank.stage - 1} stage(s) before it as the log argument, got ${log.length}`,
      );
    }
    const position = targetPosition(bank.stage, bank.display, bank.labels, log);
    return [{ roleId: def.operatorRoleId, input: { position } }];
  },
};
