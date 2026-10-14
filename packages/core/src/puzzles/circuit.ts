import { z } from 'zod';
import { serialLastDigitIsOdd, type Edgework } from '../edgework.js';
import { fail } from '../errors.js';
import { shuffle, type Rng } from '../rng.js';
import { commonDefShape, type Move, type PuzzleModule } from './module.js';
import { deviceFigure, penaltyLine, workedExample } from './printed.js';
import { WIRE_COLORS, type WireColor } from './wiring.js';

/**
 * Sicherungskasten + Prüfpult: a station with two consoles in different
 * places. Console a is a fuse box of four to six coloured wires, numbered
 * from the top, with a cutter; console b is a voltmeter that reads one wire
 * at a time by its number. Live wires carry distinct voltages, a dead one
 * reads 0 V. The crew cuts the live wires one after another — the highest
 * voltage first, or the lowest above 0 V where the lab's serial ends odd —
 * and after every cut the remaining voltages are drawn anew, so the order
 * only emerges from measuring again. Any other cut shorts the box: an alarm,
 * and the box is rewired (every wire whole, a dead wire and voltages of a
 * fresh wiring). From the def's `shorts`-th short on, the box burns out
 * instead, which costs `burnoutSec`. A key pressed at the wrong console is
 * turned away without an alarm, and so is a cut while nobody else stands at
 * the meter: a single player cannot measure there and cut here.
 */

const MIN_WIRES = 4;
const MAX_WIRES = 6;
const wireCountSchema = z.number().int().min(MIN_WIRES).max(MAX_WIRES);

/** What a live wire may carry; in any one round, no two live wires carry the same. */
export const VOLTAGES = [12, 24, 48, 110, 230] as const;

const defSchema = z
  .strictObject({
    type: z.literal('circuit'),
    ...commonDefShape,
    /** how many wires a run may draw, both ends included */
    wires: z
      .object({ min: wireCountSchema, max: wireCountSchema })
      .default({ min: MIN_WIRES, max: MAX_WIRES }),
    /** the short from which on the box burns out: that one and every later one cost burnoutSec */
    shorts: z.number().int().min(2).max(5).default(3),
    penaltySec: z.number().int().positive().default(30),
    /** what a short costs once the box burns out, in place of penaltySec */
    burnoutSec: z.number().int().positive().default(60),
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
export type CircuitDef = z.infer<typeof defSchema>;

/** One wiring of the box: how it looks, which wire is dead, and its voltages round by round. */
export interface CircuitBoard {
  /** top to bottom */
  colours: WireColor[];
  /** a dead wire carries nothing: it reads 0 V in every round and is never the one to cut */
  dead: boolean[];
  /**
   * every wire's voltage in each round — round r is the one after r cuts —
   * 0 for a dead wire, distinct among the live ones; a round for each live wire
   */
  rounds: number[][];
}

/** What the last wrong cut did: shorted the box, or from the def's `shorts`-th on burnt it out. */
export type CircuitResult = 'short' | 'burnout';

export interface CircuitState {
  type: 'circuit';
  /**
   * the box's wirings, one more than the def's `shorts`: a short moves on to
   * the next one, and past the last one they come round again
   */
  boards: CircuitBoard[];
  /** the wiring in place */
  board: number;
  /** which wires are cut, top to bottom */
  cuts: boolean[];
  /** what console b measured in this round, by wire; null where it has not probed yet */
  readings: (number | null)[];
  /** the wire console b measured last in this round, as its display shows it; null before */
  probed: number | null;
  /** shorts so far */
  shorts: number;
  /** the last cut shorted the box; the next right one clears it */
  lastResult: CircuitResult | null;
}

/** A wire's place, counted from 0 at the top; the box decides whether it has one there. */
const wireIndex = z
  .number()
  .int()
  .min(0)
  .max(MAX_WIRES - 1);
const inputSchema = z.union([
  z.strictObject({ cut: wireIndex }),
  z.strictObject({ probe: wireIndex }),
]);
export type CircuitInput = z.infer<typeof inputSchema>;

/** A wire as the box shows it. */
export interface CircuitWire {
  colour: WireColor;
  cut: boolean;
}

/**
 * The open box as one player sees it. The box shows no voltage and the
 * meter no colour; the book and everybody away from the consoles get
 * nothing of the instance, the audience all of it.
 */
export interface CircuitView {
  kind: 'circuit';
  /** the viewer's console: the box at a, the meter at b; null elsewhere and for the audience */
  role: 'box' | 'meter' | null;
  /** the wires top to bottom — at the box, and for the audience */
  wires: CircuitWire[] | null;
  /** how many wires the box has — at the meter, and for the audience */
  count: number | null;
  /**
   * this round's measurements by wire, null where none was taken — at the
   * meter, and for the audience
   */
  readings: (number | null)[] | null;
  /** the wire measured last in this round, null before — at the meter, and for the audience */
  probed: number | null;
  /** live wires not cut yet — at either console, and for the audience */
  liveLeft: number | null;
  /** shorts so far — at either console, and for the audience */
  shorts: number | null;
  /** what the last wrong cut did — at either console, and for the audience */
  lastResult: CircuitResult | null;
  /** what a burnt-out box costs, as the printed rules say */
  burnoutSec: number;
  /** every wire's voltage now, 0 for dead and cut ones — only for the audience */
  voltages: number[] | null;
  /** which wires are dead — only for the audience */
  dead: boolean[] | null;
}

/** One wiring of a box of `count` wires: its colours, a dead wire from five on, and its rounds. */
function wiringOf(count: number, rng: Rng): CircuitBoard {
  const places = Array.from({ length: count }, (_, i) => i);
  const colours = places.map(
    (): WireColor => WIRE_COLORS[Math.floor(rng() * WIRE_COLORS.length)] ?? 'rot',
  );
  const deadAt = new Set(shuffle(places, rng).slice(0, count >= 5 ? 1 : 0));
  const dead = places.map((i) => deadAt.has(i));
  const live = count - deadAt.size;
  if (live > VOLTAGES.length) {
    throw new Error(`circuit: ${live} live wires, but only ${VOLTAGES.length} voltages to share`);
  }
  const rounds = Array.from({ length: live }, () => {
    const drawn = shuffle(VOLTAGES, rng).slice(0, live);
    let next = 0;
    // `drawn` holds a voltage for every live wire, so `next` never runs past it.
    return dead.map((isDead) => (isDead ? 0 : (drawn[next++] ?? 0)));
  });
  return { colours, dead, rounds };
}

/** The wiring in place. */
function boardNow(state: CircuitState): CircuitBoard {
  const board = state.boards[state.board];
  if (board === undefined) {
    throw new Error(`circuit: no wiring ${state.board + 1} of ${state.boards.length}`);
  }
  return board;
}

/** Live wires not cut yet. */
function liveLeft(state: CircuitState): number {
  const { dead } = boardNow(state);
  return state.cuts.filter((cut, i) => !cut && dead[i] === false).length;
}

/**
 * Every wire's voltage in this round: 0 for a dead or a cut wire. Once every
 * live wire is cut there is no round left, and every wire reads 0 V.
 */
function voltagesNow(state: CircuitState): number[] {
  const round = state.cuts.filter(Boolean).length;
  const table = boardNow(state).rounds[round];
  return state.cuts.map((cut, i) => (cut || table === undefined ? 0 : (table[i] ?? 0)));
}

/**
 * The wire the printed rules name among `volts` (by wire, 0 for a dead or
 * cut one): the highest voltage, or — where the serial ends odd — the
 * lowest above 0 V. Null when no wire carries any.
 */
function ruleNames(volts: readonly number[], edgework: Edgework): number | null {
  const odd = serialLastDigitIsOdd(edgework);
  let named: number | null = null;
  for (const [i, v] of volts.entries()) {
    const best = named === null ? undefined : volts[named];
    if (v > 0 && (best === undefined || (odd ? v < best : v > best))) {
      named = i;
    }
  }
  return named;
}

/** The place `index` on this box; a place the box has no wire at is turned away. */
function placeOn(state: CircuitState, index: number): number {
  if (index >= state.cuts.length) {
    fail(`Der Kasten hat nur ${state.cuts.length} Kabel.`);
  }
  return index;
}

/** The first round of a wiring: nothing cut, nothing measured. */
const untouched = (count: number): Pick<CircuitState, 'cuts' | 'readings' | 'probed'> => ({
  cuts: new Array<boolean>(count).fill(false),
  readings: new Array<number | null>(count).fill(null),
  probed: null,
});

/** The printed example: a box of five, the serial ending even, two rounds. */
const EXAMPLE: readonly string[] = [
  'Kennung endet auf 4. Kabel 1 bis 5 zeigen 48, 0, 230, 12 und 110 V.',
  'Kennung gerade, höchste Spannung: Kabel 3 getrennt; Kabel 2 bleibt mit 0 V ganz.',
  'Neu gemessen: Kabel 1, 2, 4 und 5 zeigen 24, 0, 110 und 48 V.',
  'Höchste Spannung nun 110 V: Kabel 4 getrennt.',
];

export const circuitModule: PuzzleModule<CircuitDef, CircuitState, CircuitInput, CircuitView> = {
  type: 'circuit',
  usesEdgework: true,
  wholeCrew: false,
  consoles: 2,
  defSchema,
  inputSchema,

  init(def, rng) {
    const { min, max } = def.wires;
    const count = min + Math.floor(rng() * (max - min + 1));
    return {
      type: 'circuit',
      boards: Array.from({ length: def.shorts + 1 }, () => wiringOf(count, rng)),
      board: 0,
      ...untouched(count),
      shorts: 0,
      lastResult: null,
    };
  },

  apply(def, state, input, playerId, ctx) {
    if (ctx.console === null) {
      fail('Eingabe nur am Pult.');
    }
    if ('probe' in input) {
      if (ctx.console !== 'b') {
        fail('Dieses Pult misst nicht.');
      }
      const at = placeOn(state, input.probe);
      const reading = voltagesNow(state)[at] ?? 0;
      return {
        state: {
          ...state,
          readings: state.readings.map((r, i) => (i === at ? reading : r)),
          probed: at,
        },
        solved: false,
        penalty: null,
      };
    }
    if (ctx.console !== 'a') {
      fail('Dieses Pult schneidet nicht.');
    }
    // Measuring at the meter and cutting at the box takes two people.
    if (!ctx.atConsoles.b.some((id) => id !== playerId)) {
      fail('Am Prüfpult steht niemand.');
    }
    const at = placeOn(state, input.cut);
    const named = ruleNames(voltagesNow(state), ctx.edgework);
    if (named === null) {
      throw new Error('circuit: every live wire is cut — the box is safe, nothing is left to cut');
    }
    if (at !== named) {
      // A short: the box is rewired, and from the def's `shorts`-th on it burns out,
      // which costs burnoutSec in place of the def's penaltySec.
      const shorts = state.shorts + 1;
      const burnout = shorts >= def.shorts;
      return {
        state: {
          ...state,
          board: (state.board + 1) % state.boards.length,
          ...untouched(state.cuts.length),
          shorts,
          lastResult: burnout ? 'burnout' : 'short',
        },
        solved: false,
        penalty: burnout ? 'Kasten durchgebrannt' : 'Kurzschluss',
        ...(burnout ? { penaltySec: def.burnoutSec } : {}),
      };
    }
    const cut: CircuitState = {
      ...state,
      cuts: state.cuts.map((c, i) => c || i === at),
      readings: state.readings.map(() => null),
      probed: null,
      lastResult: null,
    };
    return { state: cut, solved: liveLeft(cut) === 0, penalty: null };
  },

  view(def, state, viewer) {
    const audience = viewer.playerId === null;
    const at = viewer.operating ? viewer.console : null;
    const role = at === 'a' ? 'box' : at === 'b' ? 'meter' : null;
    const box = role === 'box' || audience;
    const meter = role === 'meter' || audience;
    const board = boardNow(state);
    const wires = board.colours.map((colour, i) => ({ colour, cut: state.cuts[i] === true }));
    return {
      kind: 'circuit',
      role,
      wires: box ? wires : null,
      count: meter ? state.cuts.length : null,
      readings: meter ? [...state.readings] : null,
      probed: meter ? state.probed : null,
      liveLeft: box || meter ? liveLeft(state) : null,
      shorts: box || meter ? state.shorts : null,
      lastResult: box || meter ? state.lastResult : null,
      burnoutSec: def.burnoutSec,
      voltages: audience ? voltagesNow(state) : null,
      dead: audience ? [...board.dead] : null,
    };
  },

  manual(def) {
    const { min, max } = def.wires;
    const wires = min === max ? `${min}` : `${min} bis ${max}`;
    return [
      {
        heading: 'Sicherungskasten und Prüfpult',
        blocks: [
          deviceFigure('circuit', 'Sicherungskasten und Prüfpult'),
          {
            kind: 'p',
            text:
              `Pult A ist ein Sicherungskasten mit ${wires} Kabeln, von oben nach unten ` +
              'gezählt; Pult B ist ein Prüfpult, das die Spannung eines Kabels nach seiner ' +
              'Nummer misst. Alle Kabel unter Spannung sind zu trennen, eines nach dem ' +
              'anderen. Nach jedem Schnitt verteilen sich die Spannungen neu.',
          },
          {
            kind: 'rules',
            items: [
              'Wenn die Laborkennung gerade endet, trenne jeweils das Kabel mit der höchsten ' +
                'gemessenen Spannung.',
              'Wenn die Laborkennung ungerade endet, trenne jeweils das Kabel mit der ' +
                'niedrigsten gemessenen Spannung über 0 V.',
              'Wenn ein Kabel 0 V zeigt, bleibt es ganz.',
              'Wenn ein Kabel getrennt wurde, gelten nur neue Messungen.',
              'Wenn kein Kabel mehr Spannung zeigt, ist der Kasten gesichert.',
            ],
          },
          workedExample(EXAMPLE),
          penaltyLine(
            def.penaltySec,
            'Jeder Fehlgriff ist ein Kurzschluss: Der Kasten wird neu verdrahtet, alle Kabel ' +
              `sind wieder ganz, die Spannungen neu. Ab dem ${def.shorts}. Kurzschluss ist der ` +
              `Kasten durchgebrannt: −${def.burnoutSec} s je Fehlgriff.`,
          ),
        ],
      },
    ];
  },

  /**
   * The rules read the serial, so nothing happens before somebody has read
   * the sign. Then console b measures every wire the box shows uncut and
   * has no reading for in this round, all together; once each is read,
   * console a cuts the one the rules name.
   */
  solve(def, { operator, partner }, edgework) {
    if (edgework === null) {
      return [];
    }
    const wires = operator.wires;
    const readings = partner?.readings ?? null;
    if (wires === null || readings === null) {
      throw new Error(
        `circuit "${def.id}": solving needs the box's view at console a and the meter's at ` +
          'console b',
      );
    }
    const unread = wires.flatMap((wire, i) => (wire.cut || readings[i] !== null ? [] : [i]));
    if (unread.length > 0) {
      return unread.map((probe): Move<CircuitInput> => ({ by: 'partner', input: { probe } }));
    }
    const volts = wires.map((wire, i) => (wire.cut ? 0 : (readings[i] ?? 0)));
    const named = ruleNames(volts, edgework);
    return named === null ? [] : [{ by: 'operator', input: { cut: named } }];
  },
};
