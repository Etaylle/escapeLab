import { describe, expect, it } from 'vitest';
import { applyAction, GameError, generateEdgework, viewFor } from '../src/index.js';
import type { Action, GameState, ManualBlock, Mission, PuzzleContext } from '../src/index.js';
import {
  morseModule,
  type MorseDef,
  type MorseInput,
  type MorseState,
} from '../src/puzzles/morse.js';
import { mulberry32 } from '../src/rng.js';
import { AT_STATION, labMission, openLab, started as startedLab, T0 } from './lab.js';
import { playInstance } from './solveModule.js';

const SEEDS = 200;

const mission: Mission = labMission(
  [{ type: 'morse', id: 'bake', title: 'Funkfeuer', penaltySec: 25 }],
  'morsetest',
);

function morseDef(): MorseDef {
  const def = mission.puzzles[0];
  if (def?.type !== 'morse') {
    throw new Error('expected the morse puzzle');
  }
  return def;
}

const def = morseDef();
const edgework = generateEdgework(mulberry32(1));
const crew = ['op', 'rd'];
const ctx: PuzzleContext = {
  edgework,
  alarms: 0,
  remainingSec: 600,
  at: T0,
  crew,
  console: 'a',
  atConsoles: { a: [], b: [] },
  readers: [],
};

const fresh = (seed: number): MorseState => morseModule.init(def, mulberry32(seed), ctx);
/** The radio desk as the player standing at it sees it. */
const panelOf = (state: MorseState) =>
  morseModule.view(def, state, AT_STATION, { edgework, alarms: 0, crew, operators: ['op'] });
const press = (state: MorseState, input: MorseInput) =>
  morseModule.apply(def, state, input, 'op', ctx);

/** International Morse code as code → letter, written down independently of the module. */
const INTERNATIONAL = new Map(
  (
    'A.- B-... C-.-. D-.. E. F..-. G--. H.... I.. J.--- K-.- L.-.. M-- N-. O--- P.--. ' +
    'Q--.- R.-. S... T- U..- V...- W.-- X-..- Y-.-- Z--..'
  )
    .split(' ')
    .map((entry) => [entry.slice(1), entry.charAt(0)] as const),
);

/** Every reading the dial can show, bottom to top. */
const DIAL = Array.from({ length: 16 }, (_, i) => `3,${505 + 5 * i} MHz`);

type Table = Extract<ManualBlock, { kind: 'table' }>;
const blocks = morseModule.manual(def).flatMap((section) => section.blocks);

function tableWith(column: string): Table {
  const table = blocks.find((b): b is Table => b.kind === 'table' && b.head.includes(column));
  if (table === undefined) {
    throw new Error(`the manual has no table with a "${column}" column`);
  }
  return table;
}

const alphabet = tableWith('Morse');
const frequencies = tableWith('Frequenz');

/** The printed Morse table as letter → code in `.` and `-`, as the manual holder reads it. */
function printedCodes(): Map<string, string> {
  const codes = new Map<string, string>();
  for (const row of alphabet.rows) {
    for (let i = 0; i + 1 < row.length; i += 2) {
      const code = (row[i + 1] ?? '').replace(/·/g, '.').replace(/−/g, '-').replace(/\s/g, '');
      codes.set(row[i] ?? '', code);
    }
  }
  return codes;
}

function printedFrequency(word: string): string {
  const frequency = frequencies.rows.find(([w]) => w === word)?.[1];
  if (frequency === undefined) {
    throw new Error(`the frequency table has no row for "${word}"`);
  }
  return frequency;
}

/** Anna (p1) at the radio desk, Ben (p2) at the book with the tables. */
function started(seed = 3): GameState {
  return openLab(startedLab(mission, seed));
}

function morseState(state: GameState): MorseState {
  if (state.puzzleState?.type !== 'morse') {
    throw new Error('expected a morse puzzle state');
  }
  return state.puzzleState;
}

const send = (playerId: string, input: unknown): Action => ({
  type: 'puzzle-input',
  playerId,
  at: T0 + 1000,
  input,
});

describe('morse puzzle', () => {
  it(`starts off the answer and is solved from the views, alarm-free, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const start = fresh(seed);
      const reading = panelOf(start).frequency;
      expect(reading, `seed ${seed}`).not.toBe(printedFrequency(start.word));
      // At least one turn of the dial before the send.
      expect(playInstance(def, seed)).toBeGreaterThan(1);
    }
  });

  it('accepts only the frequency the table prints for the word, alarms on every other', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = fresh(seed);
      const answer = printedFrequency(state.word);
      let accepted = 0;
      for (let dial = 0; dial < DIAL.length; dial++) {
        const tuned = { ...state, dial };
        const right = panelOf(tuned).frequency === answer;
        expect(press(tuned, { transmit: true })).toEqual({
          state: tuned,
          solved: right,
          penalty: right ? null : 'Falsche Frequenz gesendet',
        });
        accepted += right ? 1 : 0;
      }
      expect(accepted, `seed ${seed}`).toBe(1);
    }
  });

  it('seeds every word and every dial start, the same ones for the same seed', () => {
    const runs = Array.from({ length: SEEDS }, (_, seed) => fresh(seed));
    const words = [...new Set(runs.map((run) => run.word))].sort();
    expect(words).toEqual(frequencies.rows.map(([word]) => word).sort());
    const starts = [...new Set(runs.map((run) => run.dial))].sort((a, b) => a - b);
    expect(starts).toEqual([...DIAL.keys()]);
    expect(fresh(11)).toEqual(fresh(11));
  });

  it('shows the lamp at the desk only and the word to nobody', () => {
    const state = started();
    const { word } = morseState(state);
    const operator = viewFor(state, 'p1');
    const archive = viewFor(state, 'p2');
    if (operator.puzzle?.kind !== 'morse' || archive.puzzle?.kind !== 'morse') {
      throw new Error('expected morse views');
    }
    const pattern = operator.puzzle.pattern ?? '';
    expect(pattern).toMatch(/^[.-]+( [.-]+){4}$/);
    expect(archive.puzzle.pattern).toBeNull();
    expect(JSON.stringify(operator)).not.toContain(word);
    expect(JSON.stringify(archive)).not.toContain(pattern);
    // The printed table lists every word, this one too; nothing else may name it.
    const { manual, ...panel } = archive.puzzle;
    expect(manual).not.toBeNull();
    expect(JSON.stringify(panel)).not.toContain(word);
    expect(archive.puzzle.frequency).toBe(operator.puzzle.frequency);
  });

  it('blinks the word in international Morse code', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = fresh(seed);
      const pattern = panelOf(state).pattern ?? '';
      const spelled = pattern.split(' ').map((code) => INTERNATIONAL.get(code) ?? '?');
      expect(spelled.join('')).toBe(state.word);
    }
  });

  it('leads from the lamp to one table row with the printed manual, after three letters', () => {
    const letterOf = new Map([...printedCodes()].map(([letter, code]) => [code, letter]));
    for (let seed = 0; seed < SEEDS; seed++) {
      const pattern = panelOf(fresh(seed)).pattern ?? '';
      const codes = pattern.split(' ').slice(0, 3);
      const start = codes.map((code) => letterOf.get(code) ?? '?').join('');
      const rows = frequencies.rows.filter(([word]) => word?.startsWith(start) === true);
      expect(rows, `seed ${seed}: "${start}"`).toHaveLength(1);
    }
  });

  it('prints international Morse code for A to Z', () => {
    const international = [...INTERNATIONAL].map(([code, letter]) => [letter, code] as const);
    expect(Object.fromEntries(printedCodes())).toEqual(Object.fromEntries(international));
  });

  it('prints sixteen five-letter words, one per dial step, apart in three letters', () => {
    const words = frequencies.rows.map(([word]) => word ?? '');
    expect(words).toHaveLength(16);
    expect(words.filter((w) => !/^[A-Z]{5}$/.test(w))).toEqual([]);
    expect([...words].sort()).toEqual(words);
    expect(new Set(words.map((w) => w.slice(0, 3))).size).toBe(16);
    expect(frequencies.rows.map(([, frequency]) => frequency).sort()).toEqual(DIAL);
  });

  it('turns the dial a step at a time, free of charge, and stops at both ends', () => {
    let state: MorseState = { ...fresh(5), dial: 0 };
    expect(press(state, { tune: -1 })).toEqual({ state, solved: false, penalty: null });
    const readings = [panelOf(state).frequency];
    for (let i = 0; i < 20; i++) {
      const result = press(state, { tune: 1 });
      expect(result.solved).toBe(false);
      expect(result.penalty).toBeNull();
      state = result.state;
      readings.push(panelOf(state).frequency);
    }
    expect(state.dial).toBe(15);
    expect(readings.slice(0, 16)).toEqual(DIAL);
    expect(new Set(readings.slice(15))).toEqual(new Set(['3,580 MHz']));
    expect(press(state, { tune: -1 }).state.dial).toBe(14);
  });

  it('accepts its two inputs and nothing else', () => {
    const accepts = (input: unknown): boolean => morseModule.inputSchema.safeParse(input).success;
    expect([{ tune: 1 }, { tune: -1 }, { transmit: true }].filter((i) => !accepts(i))).toEqual([]);
    const malformed = [
      {},
      { tune: 0 },
      { tune: 2 },
      { tune: '1' },
      { transmit: false },
      { tune: 1, transmit: true },
      { dir: 1 },
      null,
      'transmit',
    ];
    expect(malformed.filter(accepts)).toEqual([]);
  });

  it('prints the desk, how it runs, both tables, the log and the workshop, for every run', () => {
    const manual = morseModule.manual(def);
    expect(manual.map((section) => section.heading)).toEqual([
      'Funkfeuer, Typ FF-16 (Baujahr 1974)',
      'Aufbau',
      'Betrieb',
      'Morsetafel',
      'Frequenztabelle',
      'Aus der Werkstatt',
    ]);
    const text = JSON.stringify(manual);
    expect(text).toContain('ein Regler mit ◀ ▶ für 16 Frequenzen von 3,505 MHz bis 3,580 MHz');
    expect(text).toContain('Die ersten drei Buchstaben bestimmen das Wort');
    expect(text).toContain('zieht 25 Sekunden Einsatzzeit ab; die Lampe morst weiter.');
    expect(text).toContain('Passt kein Wort der Tabelle, ist ein Zeichen verlesen');
    expect(morseModule.manual(structuredClone(def))).toEqual(manual);
  });

  it('prints a log that the lamp and both tables bear out', () => {
    const log = blocks.find((b) => b.kind === 'example');
    const lines = log?.kind === 'example' ? log.lines : [];
    const [seen, read, sent] = [
      /^\d\d:\d\d Nach der langen Pause: (.+)\.$/,
      new RegExp(
        '^\\d\\d:\\d\\d Morsetafel: ([A-Z]), ([A-Z]), ([A-Z])\\. ([A-Z]+) passt auf ([A-Z]+) ' +
          'und ([A-Z]+), ([A-Z]+) nur auf ([A-Z]+)\\.$',
      ),
      /^\d\d:\d\d Frequenztabelle: ([A-Z]+), (\d,\d{3} MHz); eingestellt und gesendet/,
    ].map((pattern, i) => pattern.exec(lines[i] ?? ''));
    if (!seen || !read || !sent) {
      throw new Error(`unreadable log: ${JSON.stringify(lines)}`);
    }
    // The signals spell the letters named, by international Morse code and by the printed table.
    const codes = (seen[1] ?? '')
      .split(', ')
      .map((code) => code.replace(/·/g, '.').replace(/−/g, '-').replace(/\s/g, ''));
    const letters = codes.map((code) => INTERNATIONAL.get(code));
    const letterOf = new Map([...printedCodes()].map(([letter, code]) => [code, letter]));
    expect(letters).toEqual(read.slice(1, 4));
    expect(codes.map((code) => letterOf.get(code))).toEqual(letters);
    // Two letters leave the two words named, three leave one: the word sent.
    const words = frequencies.rows.map(([word]) => word ?? '');
    const startingWith = (start = '') => words.filter((word) => word.startsWith(start));
    expect([read[4], read[7]]).toEqual([letters.slice(0, 2).join(''), letters.join('')]);
    expect(startingWith(read[4])).toEqual([read[5], read[6]]);
    expect(startingWith(read[7])).toEqual([read[8]]);
    expect(sent[1]).toBe(read[8]);
    expect(printedFrequency(sent[1] ?? '')).toBe(sent[2]);
    // The lamp blinks that word so, and the desk takes the frequency named.
    const word = sent[1] ?? '';
    const state: MorseState = { type: 'morse', word, dial: DIAL.indexOf(sent[2] ?? '') };
    expect(panelOf(state).pattern?.startsWith(`${codes.join(' ')} `)).toBe(true);
    expect(press(state, { transmit: true })).toMatchObject({ solved: true, penalty: null });
  });

  it('is won through the reducer after a wrong frequency has cost its penalty', () => {
    let state = started();
    const answer = DIAL.indexOf(printedFrequency(morseState(state).word));
    // Off the dial, the tuning loop below would never end.
    expect(answer).toBeGreaterThanOrEqual(0);
    const deadline = state.deadlineAt ?? 0;
    // The dial never starts on the answer, so sending at once is wrong.
    state = applyAction(state, send('p1', { transmit: true }));
    expect(state.phase).toBe('playing');
    expect(state.penaltySeq).toBe(1);
    expect(state.deadlineAt).toBe(deadline - 25_000);
    expect(state.events.at(-1)?.label).toBe('Falsche Frequenz gesendet');
    while (morseState(state).dial !== answer) {
      const step = morseState(state).dial < answer ? 1 : -1;
      state = applyAction(state, send('p1', { tune: step }));
    }
    state = applyAction(state, send('p1', { transmit: true }));
    expect(state.phase).toBe('won');
    expect(state.penaltySeq).toBe(1);
  });

  it('turns away input from away from the desk or meant for another station', () => {
    const away = () => applyAction(started(), send('p2', { transmit: true }));
    expect(away).toThrow(GameError);
    expect(away).toThrow('Dafür musst du am Pult stehen.');
    expect(() => applyAction(started(), send('p1', { dir: 1 }))).toThrow(/Ungültige Eingabe/);
  });
});
