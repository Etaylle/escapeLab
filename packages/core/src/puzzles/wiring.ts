import { z } from 'zod';
import { fail } from '../errors.js';
import { shuffle } from '../rng.js';
import { commonDefShape, type PuzzleModule } from './module.js';

const WIRE_COLORS = ['#f87171', '#60a5fa', '#fbbf24', '#34d399', '#c084fc', '#f472b6'];

const symbolPairSchema = z.tuple([z.string().min(1), z.string().min(1)]);
const pairKey = ([a, b]: readonly [string, string]): string => [a, b].sort().join('\u0000');

/**
 * wiring puzzle: the operator sees wires whose ends carry symbols (layout
 * shuffled per game). `pairsToCut` must be cut in order; decoys and
 * out-of-order cuts trigger an alarm (time penalty), the wire stays intact.
 */
const defSchema = z
  .object({
    type: z.literal('wiring'),
    ...commonDefShape,
    operatorRoleId: z.string().min(1),
    manualRoleId: z.string().min(1),
    pairsToCut: z.array(symbolPairSchema).min(1),
    decoyPairs: z.array(symbolPairSchema).min(1),
    penaltySec: z.number().int().positive().default(30),
  })
  .superRefine((def, ctx) => {
    const targets = new Set(def.pairsToCut.map(pairKey));
    if (targets.size !== def.pairsToCut.length) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${def.id}": duplicate target pair` });
    }
    if (def.decoyPairs.some((d) => targets.has(pairKey(d)))) {
      ctx.addIssue({
        code: 'custom',
        message: `puzzle "${def.id}": a decoy pair duplicates a target pair`,
      });
    }
  });
export type WiringDef = z.infer<typeof defSchema>;

export interface Wire {
  id: string;
  color: string;
  left: string;
  right: string;
  cut: boolean;
}

export interface WiringState {
  type: 'wiring';
  wires: Wire[];
  /** how many of def.pairsToCut are already cut, in order */
  cutsDone: number;
  lastWrongWireId: string | null;
}

const inputSchema = z.strictObject({ wireId: z.string().min(1) });
export type WiringInput = z.infer<typeof inputSchema>;

export interface WiringView {
  kind: 'wiring';
  /** wire layout — only the operator gets it, everyone else sees null */
  wires: Wire[] | null;
  cutsDone: number;
  cutsNeeded: number;
  lastWrongWireId: string | null;
}

const samePair = (wire: Wire, [a, b]: readonly [string, string]): boolean =>
  (wire.left === a && wire.right === b) || (wire.left === b && wire.right === a);

export const wiringModule: PuzzleModule<WiringDef, WiringState, WiringInput, WiringView> = {
  type: 'wiring',
  usesEdgework: false,
  defSchema,
  inputSchema,

  /** Lay out target and decoy pairs in a shuffled order with random end-swap and colors. */
  init(def, rng) {
    const pairs = shuffle([...def.pairsToCut, ...def.decoyPairs], rng);
    const wires = pairs.map(([a, b], idx): Wire => {
      const swapped = rng() < 0.5;
      return {
        id: `w${idx}`,
        color: WIRE_COLORS[Math.floor(rng() * WIRE_COLORS.length)] ?? '#8b98a5',
        left: swapped ? b : a,
        right: swapped ? a : b,
        cut: false,
      };
    });
    return { type: 'wiring', wires, cutsDone: 0, lastWrongWireId: null };
  },

  apply(def, state, input, roleId) {
    if (roleId !== def.operatorRoleId) {
      fail('Nur die Rolle am Schaltschrank kann Kabel trennen.');
    }
    const wire = state.wires.find((w) => w.id === input.wireId);
    if (wire === undefined || wire.cut) {
      // Stale click (already cut / unknown id): ignore without penalty.
      return { state, solved: false, penalty: null };
    }
    const expected = def.pairsToCut[state.cutsDone];
    if (expected === undefined || !samePair(wire, expected)) {
      return {
        state: { ...state, lastWrongWireId: wire.id },
        solved: false,
        penalty: 'Falsches Kabel getrennt',
      };
    }
    const wires = state.wires.map((w) => (w.id === wire.id ? { ...w, cut: true } : w));
    const cutsDone = state.cutsDone + 1;
    return {
      state: { type: 'wiring', wires, cutsDone, lastWrongWireId: null },
      solved: cutsDone >= def.pairsToCut.length,
      penalty: null,
    };
  },

  view(def, state, roleId) {
    const isCutter = roleId === def.operatorRoleId;
    return {
      kind: 'wiring',
      wires: isCutter ? state.wires : null,
      cutsDone: state.cutsDone,
      cutsNeeded: def.pairsToCut.length,
      lastWrongWireId: isCutter ? state.lastWrongWireId : null,
    };
  },

  manual(def) {
    const wires = def.pairsToCut.length + def.decoyPairs.length;
    return [
      {
        heading: 'Sicherungskasten',
        blocks: [
          {
            kind: 'p',
            text:
              `${wires} Kabel, jedes Ende trägt ein Zeichen. ${def.pairsToCut.length} davon ` +
              'sind in fester Reihenfolge zu trennen.',
          },
          {
            kind: 'rules',
            items: [
              'Welche Kabel in welcher Reihenfolge fallen, steht in den Unterlagen der Crew.',
              'Ein Kabel wird über die Zeichen an seinen beiden Enden benannt.',
              `Falsches Kabel oder falsche Reihenfolge: Alarm, −${def.penaltySec} s. ` +
                'Das Kabel bleibt ganz.',
            ],
          },
        ],
      },
    ];
  },

  /** The cut order is the mission's own text (the manual role's info), so it comes from the def. */
  solve(def, views) {
    const cutter = views[def.operatorRoleId];
    if (cutter?.wires == null) {
      throw new Error(`wiring "${def.id}": solving needs the operator's view of the wires`);
    }
    const target = def.pairsToCut[cutter.cutsDone];
    const wire = cutter.wires.find((w) => !w.cut && target !== undefined && samePair(w, target));
    return wire === undefined ? [] : [{ roleId: def.operatorRoleId, input: { wireId: wire.id } }];
  },
};
