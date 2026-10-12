import { z } from 'zod';
import { indicatorLit, type Edgework } from '../edgework.js';
import { fail } from '../errors.js';
import type { Rng } from '../rng.js';
import { commonDefShape, type ApplyResult, type PuzzleModule } from './module.js';

/**
 * button puzzle (Keep Talking's button): the operator sees one big button
 * with a colour and a label, the manual role holds two rule lists. The first,
 * read against the edgework, says whether the button is pressed briefly or
 * held. While it is held a coloured strip lights beside it, and the second
 * list names the digit the mission clock must show when it is let go.
 */
const defSchema = z.object({
  type: z.literal('button'),
  ...commonDefShape,
  operatorRoleId: z.string().min(1),
  manualRoleId: z.string().min(1),
  penaltySec: z.number().int().positive().default(20),
});
export type ButtonDef = z.infer<typeof defSchema>;

const COLOURS = ['rot', 'blau', 'gelb', 'weiß'] as const;
const LABELS = ['ABBRUCH', 'HALTEN', 'DRÜCKEN', 'START'] as const;
/** Red is the strip no release rule names: it falls under „Sonst". */
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
  /** colour and label of the button — only the operator sees them */
  colour: ButtonColour | null;
  label: ButtonLabel | null;
  /** whether the button is held down right now; no secret, every role gets it */
  holding: boolean;
  /** the lit strip — only the operator, and only while the button is held */
  strip: StripColour | null;
  lastResult: ButtonState['lastResult'];
}

/** What the first list decides: press and let go at once, or hold. */
type Move = 'press' | 'hold';
type Face = Pick<ButtonState, 'colour' | 'label'>;

const MOVE_WORDS: Record<Move, string> = { press: 'kurz drücken', hold: 'halten' };

/** One line of the first list. Its printed condition sits next to its test. */
interface MoveRule {
  when: string;
  test: (face: Face, edgework: Edgework) => boolean;
  move: Move;
}

/** The first list in printed order: the first rule that applies decides, „Sonst" holds. */
const MOVE_RULES: MoveRule[] = [
  {
    when: 'Blauer Knopf mit Aufschrift ABBRUCH',
    test: (face) => face.colour === 'blau' && face.label === 'ABBRUCH',
    move: 'hold',
  },
  {
    when: 'Mehr als eine Notstromzelle und Aufschrift DRÜCKEN',
    test: (face, edgework) => edgework.cells > 1 && face.label === 'DRÜCKEN',
    move: 'press',
  },
  {
    when: 'Weißer Knopf und Kontrollleuchte CAR leuchtet',
    test: (face, edgework) => face.colour === 'weiß' && indicatorLit(edgework, 'CAR'),
    move: 'hold',
  },
  {
    when: 'Mehr als zwei Notstromzellen und Kontrollleuchte FRQ leuchtet',
    test: (_face, edgework) => edgework.cells > 2 && indicatorLit(edgework, 'FRQ'),
    move: 'press',
  },
  { when: 'Gelber Knopf', test: (face) => face.colour === 'gelb', move: 'hold' },
  {
    when: 'Roter Knopf mit Aufschrift HALTEN',
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
  { when: 'Blauer Streifen', strip: 'blau', digit: 4 },
  { when: 'Weißer Streifen', strip: 'weiß', digit: 1 },
  { when: 'Gelber Streifen', strip: 'gelb', digit: 5 },
];
const RELEASE_OTHERWISE = 1;

const releaseDigit = (strip: StripColour): number =>
  RELEASE_RULES.find((rule) => rule.strip === strip)?.digit ?? RELEASE_OTHERWISE;

const releaseText = (when: string, digit: number): string =>
  `${when}: loslassen, wenn die Missionsuhr eine ${digit} zeigt.`;

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

  apply(def, state, input, roleId, ctx) {
    if (roleId !== def.operatorRoleId) {
      fail('Nur die Rolle am Knopf kann ihn bedienen.');
    }
    switch (input.kind) {
      case 'press':
        return press(state, moveFor(state, ctx.edgework));
      case 'hold':
        return hold(state, moveFor(state, ctx.edgework));
      case 'release':
        return release(state, ctx.remainingSec);
    }
  },

  view(def, state, roleId) {
    const isOperator = roleId === def.operatorRoleId;
    return {
      kind: 'button',
      colour: isOperator ? state.colour : null,
      label: isOperator ? state.label : null,
      holding: state.holding,
      strip: isOperator && state.holding ? state.strip : null,
      lastResult: isOperator ? state.lastResult : null,
    };
  },

  manual(def) {
    return [
      {
        heading: 'Der Knopf',
        blocks: [
          {
            kind: 'p',
            text:
              'Ein Knopf mit Farbe und Aufschrift. Regeln von oben prüfen; die erste ' +
              'zutreffende gilt.',
          },
          {
            kind: 'rules',
            items: [
              ...MOVE_RULES.map((rule) => `${rule.when}: ${MOVE_WORDS[rule.move]}.`),
              `Sonst: ${MOVE_WORDS[MOVE_OTHERWISE]}.`,
            ],
          },
          {
            kind: 'p',
            text:
              'Kurz drücken: drücken und sofort loslassen. Halten: gedrückt lassen — neben ' +
              'dem Knopf leuchtet ein Streifen. Seine Farbe bestimmt den Moment zum Loslassen:',
          },
          {
            kind: 'rules',
            items: [
              ...RELEASE_RULES.map((rule) => releaseText(rule.when, rule.digit)),
              releaseText('Sonst', RELEASE_OTHERWISE),
            ],
          },
          {
            kind: 'p',
            text:
              'Die Ziffer darf an jeder Stelle der Missionsuhr (mm:ss) stehen. Falsch ' +
              `gedrückt, gehalten oder losgelassen: Alarm, −${def.penaltySec} s. ` +
              'Der Knopf springt zurück.',
          },
        ],
      },
    ];
  },

  /**
   * Press or hold, from the button on the operator's view and the edgework.
   * The release is the one move the views cannot time — they carry no clock —
   * so while the button is held this returns nothing: letting go once the
   * mission clock shows the strip's digit is the crew's job (or the smoke
   * run's, or a test's).
   */
  solve(def, views, edgework) {
    if (edgework === null) {
      throw new Error(
        `button "${def.id}": the rules read the edgework, but no role sees it — ` +
          'give the operator\'s role "seesEdgework": true',
      );
    }
    const panel = views[def.operatorRoleId];
    if (panel?.colour == null || panel.label == null) {
      throw new Error(`button "${def.id}": solving needs the operator's view of the button`);
    }
    if (panel.holding) {
      return [];
    }
    const kind = moveFor({ colour: panel.colour, label: panel.label }, edgework);
    return [{ roleId: def.operatorRoleId, input: { kind } }];
  },
};
