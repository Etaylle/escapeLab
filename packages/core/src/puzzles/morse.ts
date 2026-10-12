import { z } from 'zod';
import { commonDefShape, type ManualBlock, type Move, type PuzzleModule } from './module.js';
import { deviceFigure, penaltyLine, workedExample } from './printed.js';

/**
 * morse puzzle („Funkfeuer"): the operator's lamp blinks one word in Morse
 * code on a loop, next to a frequency dial and a send button; the manual
 * holds the Morse alphabet and a table word → frequency. Decoding the first
 * three letters is enough to know the word. Sending on any other frequency
 * costs time.
 */
const defSchema = z.strictObject({
  type: z.literal('morse'),
  ...commonDefShape,
  penaltySec: z.number().int().positive().default(20),
});
export type MorseDef = z.infer<typeof defSchema>;

/** International Morse code: `.` short, `-` long. */
const MORSE: Readonly<Record<string, string>> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.',
  H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.',
  O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-',
  V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
};

const LETTER_BY_CODE = new Map(Object.entries(MORSE).map(([letter, code]) => [code, letter]));

/** The dial: 16 steps from 3.505 to 3.580 MHz, 5 kHz apart. */
const DIAL_STEPS = 16;
const BASE_KHZ = 3505;
const STEP_KHZ = 5;

/**
 * The printed frequency table, in alphabetical order: every word the lamp can
 * spell and the frequency it is answered on. No two words share their first
 * three letters, and every dial step belongs to exactly one word.
 */
const WORDS = [
  { word: 'DIODE', khz: 3545 },
  { word: 'DRAHT', khz: 3515 },
  { word: 'FUNKE', khz: 3570 },
  { word: 'KABEL', khz: 3530 },
  { word: 'KANAL', khz: 3505 },
  { word: 'KETTE', khz: 3560 },
  { word: 'LABOR', khz: 3520 },
  { word: 'LAMPE', khz: 3575 },
  { word: 'MODEM', khz: 3540 },
  { word: 'MOTOR', khz: 3510 },
  { word: 'PUMPE', khz: 3555 },
  { word: 'QUARZ', khz: 3580 },
  { word: 'SONDE', khz: 3535 },
  { word: 'SPULE', khz: 3565 },
  { word: 'STROM', khz: 3525 },
  { word: 'WELLE', khz: 3550 },
] as const;

export interface MorseState {
  type: 'morse';
  /** the word the lamp spells, one of the frequency table's */
  word: string;
  /** dial position, 0 (3.505 MHz) … 15 (3.580 MHz); never starts on the answer */
  dial: number;
}

const inputSchema = z.union([
  z.strictObject({ tune: z.union([z.literal(-1), z.literal(1)]) }),
  z.strictObject({ transmit: z.literal(true) }),
]);
export type MorseInput = z.infer<typeof inputSchema>;

export interface MorseView {
  kind: 'morse';
  /**
   * the lamp's word in Morse — `.` short, `-` long, one space between
   * letters — which repeats after a long pause. Only operators get it;
   * the word itself goes to nobody.
   */
  pattern: string | null;
  /** dial position, 0 … steps − 1 */
  dial: number;
  steps: number;
  /** the dial's reading as the frequency table prints it, e.g. "3,545 MHz" */
  frequency: string;
}

const dialKhz = (dial: number): number => BASE_KHZ + STEP_KHZ * dial;
const stepOf = (khz: number): number => (khz - BASE_KHZ) / STEP_KHZ;

/** "3,545 MHz": German notation, the same on the dial and in the printed table. */
function megahertz(khz: number): string {
  return `${Math.floor(khz / 1000)},${String(khz % 1000).padStart(3, '0')} MHz`;
}

function encode(word: string): string {
  return [...word]
    .map((letter) => {
      const code = MORSE[letter];
      if (code === undefined) {
        throw new Error(`morse: "${word}" has a letter without a Morse code`);
      }
      return code;
    })
    .join(' ');
}

/** What the crew reads off the lamp; a code that means nothing becomes "?". */
function decode(pattern: string): string {
  return pattern
    .split(' ')
    .map((code) => LETTER_BY_CODE.get(code) ?? '?')
    .join('');
}

function wordKhz(word: string): number {
  const entry = WORDS.find((e) => e.word === word);
  if (entry === undefined) {
    throw new Error(`morse: "${word}" is not in the frequency table`);
  }
  return entry.khz;
}

/** "· − · ·" as a printed Morse table writes it, kept on one line. */
const printed = (code: string): string =>
  [...code].map((signal) => (signal === '.' ? '·' : '−')).join('\u00a0');

/**
 * The worked example: KABEL's first three letters as the lamp shows them —
 * two letters leave KABEL and KANAL, the third settles it.
 */
const EXAMPLE: readonly string[] = [
  `Gesehen nach der langen Pause: ${['-.-', '.-', '-...'].map(printed).join(', ')}.`,
  'Morsetafel: K, A, B. KA passt auf KABEL und KANAL, KAB nur auf KABEL.',
  'Frequenztabelle: KABEL, 3,530 MHz. Mit ◀ ▶ eingestellt, dann SENDEN.',
];

/** A–M on the left, N–Z on the right. */
function alphabetTable(): ManualBlock {
  const cells = Object.entries(MORSE).map(([letter, code]) => [letter, printed(code)]);
  const half = Math.ceil(cells.length / 2);
  return {
    kind: 'table',
    head: ['Buchstabe', 'Morse', 'Buchstabe', 'Morse'],
    rows: cells.slice(0, half).map((left, i) => [...left, ...(cells[half + i] ?? [])]),
  };
}

export const morseModule: PuzzleModule<MorseDef, MorseState, MorseInput, MorseView> = {
  type: 'morse',
  usesEdgework: false,
  wholeCrew: false,
  defSchema,
  inputSchema,

  init(_def, rng) {
    const { word, khz } = WORDS[Math.floor(rng() * WORDS.length)] ?? WORDS[0];
    // One of the fifteen other steps, so every run needs tuning and a read-out.
    const offset = Math.floor(rng() * (DIAL_STEPS - 1));
    const dial = offset < stepOf(khz) ? offset : offset + 1;
    return { type: 'morse', word, dial };
  },

  apply(_def, state, input) {
    if (!('transmit' in input)) {
      const dial = Math.min(DIAL_STEPS - 1, Math.max(0, state.dial + input.tune));
      return { state: { ...state, dial }, solved: false, penalty: null };
    }
    return dialKhz(state.dial) === wordKhz(state.word)
      ? { state, solved: true, penalty: null }
      : { state, solved: false, penalty: 'Falsche Frequenz gesendet' };
  },

  view(_def, state, viewer) {
    return {
      kind: 'morse',
      pattern: viewer.operating ? encode(state.word) : null,
      dial: state.dial,
      steps: DIAL_STEPS,
      frequency: megahertz(dialKhz(state.dial)),
    };
  },

  manual(def) {
    return [
      {
        heading: 'Funkfeuer',
        blocks: [
          deviceFigure('morse', 'Funkpult mit Signallampe'),
          {
            kind: 'p',
            text:
              'Die Signallampe am Funkpult morst in Dauerschleife ein Wort der ' +
              'Frequenztabelle. Kurzes Aufleuchten ist ·, langes −; zwischen 2 Buchstaben ' +
              'bleibt die Lampe länger dunkel, vor jeder Wiederholung lange. Das Funkpult ' +
              'wird mit ◀ ▶ auf die Frequenz des Wortes gestellt, dann wird SENDEN gedrückt.',
          },
          {
            kind: 'rules',
            items: [
              'Wenn die ersten 3 Buchstaben entziffert sind, steht das Wort fest; keine 2 ' +
                'Wörter der Frequenztabelle beginnen mit denselben 3 Buchstaben.',
              'Wenn kein Wort der Frequenztabelle so beginnt, ist ein Zeichen verlesen; nach ' +
                'der nächsten langen Pause beginnt das Wort von vorn.',
            ],
          },
        ],
      },
      { heading: 'Morsetafel', blocks: [alphabetTable()] },
      {
        heading: 'Frequenztabelle',
        blocks: [
          {
            kind: 'table',
            head: ['Wort', 'Frequenz'],
            rows: WORDS.map(({ word, khz }) => [word, megahertz(khz)]),
          },
          workedExample(EXAMPLE),
          penaltyLine(def.penaltySec, 'Die Lampe morst weiter.'),
        ],
      },
    ];
  },

  /** Decodes the operator's lamp with the printed tables, then tunes and sends. */
  solve(def, { operator }) {
    if (operator.pattern === null) {
      throw new Error(`morse "${def.id}": solving needs the operator's view of the lamp`);
    }
    const word = decode(operator.pattern);
    const entry = WORDS.find((e) => e.word === word);
    if (entry === undefined) {
      throw new Error(`morse "${def.id}": the lamp spells "${word}", which no table row has`);
    }
    const turns = stepOf(entry.khz) - operator.dial;
    const tune: Move<MorseInput> = { by: 'operator', input: { tune: turns < 0 ? -1 : 1 } };
    return [
      ...Array.from({ length: Math.abs(turns) }, () => tune),
      { by: 'operator', input: { transmit: true } },
    ];
  },
};
