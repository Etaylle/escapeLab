import { z } from 'zod';
import { indicatorLit, type Edgework } from '../edgework.js';
import type { Rng } from '../rng.js';
import { commonDefShape, type ApplyResult, type PuzzleModule } from './module.js';
import { deviceFigure, penaltyLine, workedExample } from './printed.js';

/**
 * button puzzle (Keep Talking's button): the operator sees one big button
 * with a colour and a label, the manual holds two rule lists. The first,
 * read against the edgework, says whether the button is pressed briefly or
 * held. While it is held a coloured strip lights beside it, and the second
 * list names the digit the mission clock must show when it is let go.
 */
const defSchema = z.strictObject({
  type: z.literal('button'),
  ...commonDefShape,
  penaltySec: z.number().int().positive().default(20),
});
export type ButtonDef = z.infer<typeof defSchema>;

const COLOURS = ['rot', 'blau', 'gelb', 'weiß'] as const;
const LABELS = ['ABBRUCH', 'HALTEN', 'DRÜCKEN', 'START'] as const;
/** Red is the strip no release rule names: it falls under „Andernfalls". */
const STRIPS = ['blau', 'weiß', 'gelb', 'rot'] as const;
export type ButtonColour = (typeof COLOURS)[number];
export type ButtonLabel = (typeof LABELS)[number];
export type StripColour = (typeof STRIPS)[number];

export interface ButtonState {
  type: 'button';
  colour: ButtonColour;
  label: ButtonLabel;
  /** lights beside the button while it is held */
  strip: StripColour;
  holding: boolean;
  /**
   * The last wrong move: pressed briefly where the rules say hold (`early`),
   * held where they say press (`held`), let go at a moment the strip does not
   * allow (`wrong-time`).
   */
  lastResult: 'early' | 'held' | 'wrong-time' | null;
}

const inputSchema = z.strictObject({ kind: z.enum(['press', 'hold', 'release']) });
export type ButtonInput = z.infer<typeof inputSchema>;

export interface ButtonView {
  kind: 'button';
  /** colour and label of the button — only operators see them */
  colour: ButtonColour | null;
  label: ButtonLabel | null;
  /** whether the button is held down right now; no secret, everyone gets it */
  holding: boolean;
  /** the lit strip — only operators, and only while the button is held */
  strip: StripColour | null;
  lastResult: ButtonState['lastResult'];
}

/** What the first list decides: press and let go at once, or hold. */
type Move = 'press' | 'hold';
type Face = Pick<ButtonState, 'colour' | 'label'>;

const MOVE_WORDS: Record<Move, string> = {
  press: 'drücke den Knopf kurz',
  hold: 'halte den Knopf',
};

/** One line of the first list. Its printed condition sits next to its test. */
interface MoveRule {
  when: string;
  test: (face: Face, edgework: Edgework) => boolean;
  move: Move;
}

/** The first list in printed order: the first rule that applies decides, „Andernfalls" holds. */
const MOVE_RULES: MoveRule[] = [
  {
    when: 'der Knopf blau ist und die Aufschrift ABBRUCH trägt',
    test: (face) => face.colour === 'blau' && face.label === 'ABBRUCH',
    move: 'hold',
  },
  {
    when: 'mehr als 1 Notstromzelle eingesetzt ist und der Knopf die Aufschrift DRÜCKEN trägt',
    test: (face, edgework) => edgework.cells > 1 && face.label === 'DRÜCKEN',
    move: 'press',
  },
  {
    when: 'der Knopf weiß ist und die Kontrollleuchte CAR leuchtet',
    test: (face, edgework) => face.colour === 'weiß' && indicatorLit(edgework, 'CAR'),
    move: 'hold',
  },
  {
    when: 'mehr als 2 Notstromzellen eingesetzt sind und die Kontrollleuchte FRQ leuchtet',
    test: (_face, edgework) => edgework.cells > 2 && indicatorLit(edgework, 'FRQ'),
    move: 'press',
  },
  { when: 'der Knopf gelb ist', test: (face) => face.colour === 'gelb', move: 'hold' },
  {
    when: 'der Knopf rot ist und die Aufschrift HALTEN trägt',
    test: (face) => face.colour === 'rot' && face.label === 'HALTEN',
    move: 'press',
  },
];
const MOVE_OTHERWISE: Move = 'hold';

function moveFor(face: Face, edgework: Edgework): Move {
  return MOVE_RULES.find((rule) => rule.test(face, edgework))?.move ?? MOVE_OTHERWISE;
}

/** One line of the second list: the digit the mission clock must show to let go. */
interface ReleaseRule {
  when: string;
  strip: StripColour;
  digit: number;
}

const RELEASE_RULES: ReleaseRule[] = [
  { when: 'der Streifen blau leuchtet', strip: 'blau', digit: 4 },
  { when: 'der Streifen weiß leuchtet', strip: 'weiß', digit: 1 },
  { when: 'der Streifen gelb leuchtet', strip: 'gelb', digit: 5 },
];
const RELEASE_OTHERWISE = 1;

const releaseDigit = (strip: StripColour): number =>
  RELEASE_RULES.find((rule) => rule.strip === strip)?.digit ?? RELEASE_OTHERWISE;

const releaseWords = (digit: number): string =>
  `lass den Knopf los, sobald die Missionsuhr eine ${digit} zeigt`;

/** A button held under rule 5, its strip blue, let go on a second that shows a 4. */
const EXAMPLE: readonly string[] = [
  'Gesehen: gelber Knopf, Aufschrift START; 1 Notstromzelle eingesetzt.',
  '„Der Knopf“, Regel 5 trifft als erste zu: halten. Der Streifen leuchtet blau.',
  '„Loslassen“, Regel 1: losgelassen bei 03:41, die Uhr zeigt eine 4.',
];

/** The mission clock as every screen shows it: mm:ss, minutes padded to two digits. */
function clockText(remainingSec: number): string {
  const min = Math.floor(remainingSec / 60);
  const sec = remainingSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Whether letting go with `remainingSec` on the clock counts for `digit`.
 * The operator lets go on what their screen shows, and the release reaches
 * the server up to a second later (network latency), when the clock may
 * already read one second less. So the digit counts if the clock shows it
 * now or showed it one second ago.
 */
function releaseInTime(digit: number, remainingSec: number): boolean {
  return [remainingSec, remainingSec + 1].some((sec) => clockText(sec).includes(String(digit)));
}

/**
 * The solver's half of the release: whether letting go now counts, judged
 * the way `release` judges it. Never without a lit strip or a clock to read.
 */
const timeToLetGo = (strip: StripColour | null, remainingSec: number | null): boolean =>
  strip !== null && remainingSec !== null && releaseInTime(releaseDigit(strip), remainingSec);

function pick<T>(items: readonly [T, ...T[]], rng: Rng): T {
  return items[Math.floor(rng() * items.length)] ?? items[0];
}

const unchanged = (state: ButtonState): ApplyResult<ButtonState> => ({
  state,
  solved: false,
  penalty: null,
});

/** A wrong move: the alarm named `penalty` fires and the button springs back. */
const wrong = (
  state: ButtonState,
  lastResult: NonNullable<ButtonState['lastResult']>,
  penalty: string,
): ApplyResult<ButtonState> => ({
  state: { ...state, holding: false, lastResult },
  solved: false,
  penalty,
});

function press(state: ButtonState, move: Move): ApplyResult<ButtonState> {
  if (state.holding) {
    // A second finger on a held button changes nothing.
    return unchanged(state);
  }
  return move === 'press'
    ? { state: { ...state, lastResult: null }, solved: true, penalty: null }
    : wrong(state, 'early', 'Knopf kurz gedrückt statt gehalten');
}

function hold(state: ButtonState, move: Move): ApplyResult<ButtonState> {
  if (state.holding) {
    return unchanged(state);
  }
  return move === 'hold'
    ? { state: { ...state, holding: true, lastResult: null }, solved: false, penalty: null }
    : wrong(state, 'held', 'Knopf gehalten statt kurz gedrückt');
}

function release(state: ButtonState, remainingSec: number): ApplyResult<ButtonState> {
  if (!state.holding) {
    // Late: an alarm already let the button go, or it was never held.
    return unchanged(state);
  }
  return releaseInTime(releaseDigit(state.strip), remainingSec)
    ? { state: { ...state, holding: false }, solved: true, penalty: null }
    : wrong(state, 'wrong-time', 'Knopf zur falschen Zeit losgelassen');
}

export const buttonModule: PuzzleModule<ButtonDef, ButtonState, ButtonInput, ButtonView> = {
  type: 'button',
  usesEdgework: true,
  wholeCrew: false,
  fields: [],
  defSchema,
  inputSchema,

  init: (_def, rng) => ({
    type: 'button',
    colour: pick(COLOURS, rng),
    label: pick(LABELS, rng),
    strip: pick(STRIPS, rng),
    holding: false,
    lastResult: null,
  }),

  apply(_def, state, input, _playerId, ctx) {
    switch (input.kind) {
      case 'press':
        return press(state, moveFor(state, ctx.edgework));
      case 'hold':
        return hold(state, moveFor(state, ctx.edgework));
      case 'release':
        return release(state, ctx.remainingSec);
    }
  },

  view(_def, state, viewer) {
    return {
      kind: 'button',
      colour: viewer.operating ? state.colour : null,
      label: viewer.operating ? state.label : null,
      holding: state.holding,
      strip: viewer.operating && state.holding ? state.strip : null,
      lastResult: viewer.operating ? state.lastResult : null,
    };
  },

  manual(def) {
    return [
      {
        heading: 'Der Knopf',
        blocks: [
          deviceFigure('button', 'Knopf mit Leuchtstreifen'),
          {
            kind: 'p',
            text:
              'Ein Knopf mit Farbe und Aufschrift; daneben ein Streifen, der nur leuchtet, ' +
              'solange der Knopf gehalten wird. Kurz drücken heißt drücken und sofort ' +
              'loslassen, halten heißt gedrückt lassen. Die erste zutreffende Regel entscheidet.',
          },
          {
            kind: 'rules',
            items: [
              ...MOVE_RULES.map((rule) => `Wenn ${rule.when}, ${MOVE_WORDS[rule.move]}.`),
              `Andernfalls ${MOVE_WORDS[MOVE_OTHERWISE]}.`,
            ],
          },
        ],
      },
      {
        heading: 'Loslassen',
        blocks: [
          {
            kind: 'p',
            text:
              'Ein gehaltener Knopf wird nach der Farbe des Streifens losgelassen. Die Ziffer ' +
              'darf an jeder Stelle der Missionsuhr (mm:ss) stehen.',
          },
          {
            kind: 'rules',
            items: [
              ...RELEASE_RULES.map((rule) => `Wenn ${rule.when}, ${releaseWords(rule.digit)}.`),
              `Andernfalls ${releaseWords(RELEASE_OTHERWISE)}.`,
            ],
          },
          workedExample(EXAMPLE),
          penaltyLine(def.penaltySec, 'Der Knopf springt zurück.'),
        ],
      },
    ];
  },

  /**
   * Press or hold, from the button on the operator's view and the edgework.
   * The release is the one move the views cannot time — they carry no clock —
   * so while the button is held this lets go only on a second the aid's clock
   * allows for the strip, and otherwise returns nothing: without a clock the
   * crew waits for good.
   */
  solve(def, { operator }, edgework, aid) {
    if (edgework === null) {
      throw new Error(
        `button "${def.id}": the rules read the edgework, but nobody has read the sign yet`,
      );
    }
    if (operator.colour === null || operator.label === null) {
      throw new Error(`button "${def.id}": solving needs the operator's view of the button`);
    }
    if (operator.holding) {
      return timeToLetGo(operator.strip, aid?.remainingSec ?? null)
        ? [{ by: 'operator', input: { kind: 'release' } }]
        : [];
    }
    const kind = moveFor({ colour: operator.colour, label: operator.label }, edgework);
    return [{ by: 'operator', input: { kind } }];
  },
};
