import { z } from 'zod';
import { mulberry32, shuffle, type Rng } from '../rng.js';
import {
  commonDefShape,
  type ManualSection,
  type Perspectives,
  type PuzzleModule,
  type SolveAid,
} from './module.js';
import { deviceFigure, penaltyLine, workedExample } from './printed.js';

/**
 * Memory bank: five stages, each a display digit 1–4 over four buttons
 * labelled 1–4 in a random order. The manual's rule for the stage and the
 * digit names the button to press — by position, by label or, from stage 2
 * on, by what was pressed in an earlier stage. The bank never shows an
 * earlier stage, so the crew has to note every press itself. A wrong press
 * costs time and drops the bank back to stage 1, every stage laid out afresh.
 */
const defSchema = z.strictObject({
  type: z.literal('memory'),
  ...commonDefShape,
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
  /** the display digit — only operators get it */
  display: number | null;
  /** the button labels in position order — only operators get them */
  labels: number[] | null;
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

/**
 * The crew's notes, read off the transcript: each press with the label its
 * button showed the operator just before. A press after which the bank
 * stands at stage 1 again voids everything noted up to it.
 */
function notesFrom(
  def: MemoryDef,
  transcript: SolveAid<MemoryInput, MemoryView>['transcript'],
  views: Perspectives<MemoryView>,
): MemoryPress[] {
  let notes: MemoryPress[] = [];
  for (const [i, { input, before }] of transcript.entries()) {
    const label = before.operator.labels?.[input.position];
    const after = (transcript[i + 1]?.before ?? views).operator;
    if (label === undefined) {
      throw new Error(
        `memory "${def.id}": transcript entry ${i + 1} lacks the operator's view of the bank`,
      );
    }
    notes = after.stage === 1 ? [] : [...notes, { position: input.position, label }];
  }
  return notes;
}

/** What a rule line tells the crew to press, as the manual prints it. */
function pressText(target: Target): string {
  switch (target.by) {
    case 'position':
      return `drücke die ${ORDINALS[target.nth]} Taste`;
    case 'label':
      return `drücke die Taste mit der Beschriftung ${target.label}`;
    case 'samePosition':
      return `drücke die Taste an derselben Position wie in Stufe ${target.stage}`;
    case 'sameLabel':
      return `drücke die Taste mit derselben Beschriftung wie in Stufe ${target.stage}`;
  }
}

/**
 * The worked example: stage 1 by position, then stage 2 by the label noted
 * in stage 1, on a layout that has moved that label to another key.
 */
const EXAMPLE: readonly string[] = [
  'Stufe 1: Display 3; gedrückt die erste Taste, Beschriftung 4.',
  'Stufe 2: Display 1; Tasten von links 2, 4, 1, 3.',
  'Stufe 2, Display 1: die Taste mit derselben Beschriftung wie in Stufe 1, also die 4.',
  'Gedrückt: die zweite Taste.',
];

/** A fresh layout for one stage, and the seed the next one is drawn from. */
function drawStage(rng: Rng): Pick<MemoryState, 'display' | 'labels' | 'seed'> {
  return {
    display: 1 + Math.floor(rng() * DIGITS.length),
    labels: shuffle(DIGITS, rng),
    seed: Math.floor(rng() * 2 ** 32),
  };
}

export const memoryModule: PuzzleModule<MemoryDef, MemoryState, MemoryInput, MemoryView> = {
  type: 'memory',
  usesEdgework: false,
  wholeCrew: false,
  defSchema,
  inputSchema,

  init: (_def, rng) => ({ type: 'memory', stage: 1, history: [], ...drawStage(rng) }),

  apply(_def, state, input) {
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

  view(_def, state, viewer) {
    return {
      kind: 'memory',
      stage: state.stage,
      display: viewer.operating ? state.display : null,
      labels: viewer.operating ? [...state.labels] : null,
    };
  },

  manual(def) {
    const closing = [
      workedExample(EXAMPLE),
      penaltyLine(
        def.penaltySec,
        'Die Bank fällt auf Stufe 1 zurück und belegt alle Stufen neu; was davor gedrückt ' +
          'wurde, zählt nicht mehr.',
      ),
    ];
    return [
      {
        heading: 'Speicherbank',
        blocks: [
          deviceFigure('memory', 'Display über Tasten'),
          {
            kind: 'p',
            text:
              'Ein Display zeigt eine Ziffer von 1 bis 4; darunter liegen 4 Tasten, ' +
              'beschriftet mit 1 bis 4 in wechselnder Reihenfolge. Die Position zählt von ' +
              'links (erste bis vierte Taste), die Beschriftung ist die Ziffer auf der Taste; ' +
              '„wie in Stufe k“ meint die in Stufe k gedrückte Taste. Die Bank hat 5 Stufen: ' +
              'Jede richtige Taste schaltet eine weiter, frühere zeigt sie nicht mehr an.',
          },
        ],
      },
      ...RULES.map(
        (row, i): ManualSection => ({
          heading: `Stufe ${i + 1}`,
          blocks: [
            {
              kind: 'rules',
              items: row.map(
                (target, j) => `Wenn das Display ${j + 1} zeigt, ${pressText(target)}.`,
              ),
            },
            // The example and the penalty close the manual, under the last stage.
            ...(i === RULES.length - 1 ? closing : []),
          ],
        }),
      ),
    ];
  },

  /**
   * The bank never shows an earlier stage, so past stage 1 the solver needs
   * what the crew wrote down, and reads it off the aid's transcript: the
   * press of every stage cleared since the last fall back to stage 1. Without
   * a transcript only stage 1 is solvable; a later stage whose presses the
   * transcript does not cover throws.
   */
  solve(def, views, _edgework, aid) {
    const bank = views.operator;
    if (bank.display === null || bank.labels === null) {
      throw new Error(`memory "${def.id}": solving needs the operator's view of the bank`);
    }
    const notes = notesFrom(def, aid?.transcript ?? [], views);
    if (notes.length !== bank.stage - 1) {
      throw new Error(
        `memory "${def.id}": stage ${bank.stage} needs the crew's notes of the ` +
          `${bank.stage - 1} stage(s) before it from the aid's transcript, got ${notes.length}`,
      );
    }
    const position = targetPosition(bank.stage, bank.display, bank.labels, notes);
    return [{ by: 'operator', input: { position } }];
  },
};
