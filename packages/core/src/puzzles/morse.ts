import { z } from 'zod';
import { fail } from '../errors.js';
import { commonDefShape, type ManualBlock, type PuzzleModule } from './module.js';

/**
 * morse puzzle („Funkfeuer"): the operator's lamp blinks one word in Morse
 * code on a loop, next to a frequency dial and a send button; the manual
 * holds the Morse alphabet and a table word → frequency. Decoding the first
 * three letters is enough to know the word. Sending on any other frequency
 * costs time.
 */
const defSchema = z.object({
  type: z.literal('morse'),
  ...commonDefShape,
  operatorRoleId: z.string().min(1),
  manualRoleId: z.string().min(1),
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
  /** dial position, 0 (3.505 MHz) … 15 (3.580 MHz) */
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
   * letters — which repeats after a long pause. Only the operator gets it;
   * the word itself goes to nobody.
   */
  pattern: string | null;
  /** dial position, 0 … steps − 1 */
  dial: number;
  steps: number;
  /** the dial's reading as the frequency table prints it, e.g. "3.545 MHz" */
  frequency: string;
}

const dialKhz = (dial: number): number => BASE_KHZ + STEP_KHZ * dial;

function megahertz(khz: number): string {
  return `${Math.floor(khz / 1000)}.${String(khz % 1000).padStart(3, '0')} MHz`;
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
  defSchema,
  inputSchema,

  init(_def, rng) {
    const { word } = WORDS[Math.floor(rng() * WORDS.length)] ?? WORDS[0];
    return { type: 'morse', word, dial: 0 };
  },

  apply(def, state, input, roleId) {
    const transmit = 'transmit' in input;
    if (roleId !== def.operatorRoleId) {
      fail(
        transmit
          ? 'Nur die Rolle am Funkpult kann senden.'
          : 'Nur die Rolle am Funkpult kann die Frequenz einstellen.',
      );
    }
    if (!transmit) {
      const dial = Math.min(DIAL_STEPS - 1, Math.max(0, state.dial + input.tune));
      return { state: { ...state, dial }, solved: false, penalty: null };
    }
    return dialKhz(state.dial) === wordKhz(state.word)
      ? { state, solved: true, penalty: null }
      : { state, solved: false, penalty: 'Falsche Frequenz gesendet' };
  },

  view(def, state, roleId) {
    return {
      kind: 'morse',
      pattern: roleId === def.operatorRoleId ? encode(state.word) : null,
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
          {
            kind: 'p',
            text:
              'Die Signallampe am Funkpult morst ein Wort in Dauerschleife. Kurzes ' +
              'Aufleuchten: „kurz" (·). Langes Aufleuchten: „lang" (−). Innerhalb eines ' +
              'Buchstabens bleibt sie nur kurz dunkel, zwischen zwei Buchstaben deutlich ' +
              'länger, vor jeder Wiederholung lange.',
          },
          {
            kind: 'rules',
            items: [
              'Funkpult sagt die Zeichen an, Buchstabe für Buchstabe: „kurz, kurz, lang — ' +
                'Pause — …". Begonnen wird nach der langen Pause.',
              'Jeden Buchstaben in der Morsetafel nachschlagen. Keine zwei Wörter beginnen ' +
                'mit denselben drei Buchstaben: Nach drei Buchstaben steht das Wort fest.',
              'Frequenz des Wortes in der Frequenztabelle ablesen. Funkpult stellt sie mit ' +
                '◀ ▶ ein und drückt SENDEN.',
              `Falsche Frequenz gesendet: Alarm, −${def.penaltySec}\u00a0s. ` +
                'Die Lampe morst weiter.',
              'Sonst — kein Wort der Tabelle passt: verlesen. Ab der nächsten langen Pause ' +
                'neu ansagen.',
            ],
          },
          alphabetTable(),
          {
            kind: 'table',
            head: ['Wort', 'Frequenz'],
            rows: WORDS.map(({ word, khz }) => [word, megahertz(khz)]),
          },
        ],
      },
    ];
  },

  /** Decodes the operator's lamp with the printed tables, then tunes and sends. */
  solve(def, views) {
    const panel = views[def.operatorRoleId];
    if (panel?.pattern == null) {
      throw new Error(`morse "${def.id}": solving needs the operator's view of the lamp`);
    }
    const word = decode(panel.pattern);
    const entry = WORDS.find((e) => e.word === word);
    if (entry === undefined) {
      throw new Error(`morse "${def.id}": the lamp spells "${word}", which no table row has`);
    }
    const turns = (entry.khz - dialKhz(panel.dial)) / STEP_KHZ;
    const tune: -1 | 1 = turns < 0 ? -1 : 1;
    return [
      ...Array.from({ length: Math.abs(turns) }, () => ({
        roleId: def.operatorRoleId,
        input: { tune },
      })),
      { roleId: def.operatorRoleId, input: { transmit: true } },
    ];
  },
};
