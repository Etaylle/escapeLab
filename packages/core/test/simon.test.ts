import { describe, expect, it } from 'vitest';
import {
  applyAction,
  GameError,
  generateEdgework,
  parseMission,
  serialHasVowel,
  viewFor,
} from '../src/index.js';
import type {
  Action,
  Edgework,
  GameState,
  ManualBlock,
  Mission,
  Perspectives,
  PuzzleContext,
} from '../src/index.js';
import { SIMON_COLORS, simonModule } from '../src/puzzles/simon.js';
import type { SimonColor, SimonDef, SimonState, SimonView } from '../src/puzzles/simon.js';
import { mulberry32 } from '../src/rng.js';
import {
  AT_BOOK,
  AT_STATION,
  labMission,
  openLab,
  started as startedLab,
  T0,
} from './lab.js';

const SEEDS = 300;
const CREW = ['op', 'rd'];
const LEGENDS = ['kennung', 'einfach'] as const;

/** The colors as the printed page names them. */
const PRINTED: Record<SimonColor, string> = {
  rot: 'rot',
  blau: 'blau',
  gruen: 'grün',
  gelb: 'gelb',
};

const WITH_VOWEL: Edgework = { serial: 'K7E3B-2', indicators: [], cells: 0 };
const WITHOUT_VOWEL: Edgework = { serial: 'K7G3B-2', indicators: [], cells: 0 };

function defOf(fields: Partial<SimonDef> = {}): SimonDef {
  return simonModule.defSchema.parse({
    type: 'simon',
    id: 'frequenz',
    title: 'Frequenz',
    ...fields,
  });
}

const ctx = (edgework: Edgework, alarms: number): PuzzleContext => ({
  edgework,
  alarms,
  remainingSec: 600,
  at: T0,
  crew: CREW,
  console: 'a',
});

const press = (color: SimonColor) => ({ kind: 'press', color }) as const;

function operatorView(def: SimonDef, state: SimonState, edgework: Edgework, alarms: number) {
  return simonModule.view(def, state, AT_STATION, { edgework, alarms, crew: CREW });
}

type TableBlock = Extract<ManualBlock, { kind: 'table' }>;
const isTable = (block: ManualBlock): block is TableBlock => block.kind === 'table';

function printedTables(def: SimonDef): TableBlock[] {
  return simonModule.manual(def).flatMap((section) => section.blocks.filter(isTable));
}

/**
 * What a crew holding nothing but the printed page presses for `flashed`:
 * the table by the Laborkennung where the page prints more than one, the row
 * by the alarms so far (the last row holds for any more), the column by the
 * flashed color.
 */
function pressFromPage(
  def: SimonDef,
  flashed: SimonColor,
  edgework: Edgework,
  alarms: number,
): SimonColor {
  const tables = printedTables(def);
  const label = serialHasVowel(edgework) ? 'Mit Vokal' : 'Ohne Vokal';
  const table = tables.length === 1 ? tables[0] : tables.find((t) => t.head[0] === label);
  const row = table?.rows[Math.min(alarms, table.rows.length - 1)];
  const cell = row?.[table?.head.indexOf(PRINTED[flashed]) ?? -1];
  const color = SIMON_COLORS.find((c) => PRINTED[c] === cell);
  if (color === undefined) {
    throw new Error(`the page has no cell for ${flashed} at ${alarms} alarms (${label})`);
  }
  return color;
}

describe('simon stages', () => {
  it('flashes one color more per stage and solves only with the last stage', () => {
    const def = defOf({ sequenceLength: 4 });
    let state = simonModule.init(def, mulberry32(7), ctx(WITH_VOWEL, 0));
    let previous: SimonColor[] = [];
    for (let stage = 1; stage <= 4; stage++) {
      const view = operatorView(def, state, WITH_VOWEL, 0);
      expect(view).toMatchObject({ stage, stages: 4, progress: 0, lastWrong: false });
      expect(view.flashes).toHaveLength(stage);
      expect(view.flashes?.slice(0, -1)).toEqual(previous);
      previous = view.flashes ?? [];
      for (const [i, flashed] of previous.entries()) {
        const color = pressFromPage(def, flashed, WITH_VOWEL, 0);
        const result = simonModule.apply(def, state, press(color), 'op', ctx(WITH_VOWEL, 0));
        expect(result.penalty).toBeNull();
        expect(result.solved).toBe(stage === 4 && i === stage - 1);
        state = result.state;
      }
    }
  });

  it('keeps the seeded sequence: reproducible, five long by default, no direct repeats', () => {
    const def = defOf();
    const seen = new Set<string>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { sequence } = simonModule.init(def, mulberry32(seed), ctx(WITH_VOWEL, 0));
      const again = simonModule.init(def, mulberry32(seed), ctx(WITH_VOWEL, 0));
      expect(again.sequence).toEqual(sequence);
      expect(sequence).toHaveLength(5);
      expect(sequence.every((color, i) => color !== sequence[i - 1])).toBe(true);
      seen.add(sequence.join(' '));
    }
    expect(seen.size).toBeGreaterThan(SEEDS / 2);
  });

  it('a wrong press raises an alarm and restarts the stage input, keeping the stage', () => {
    const def = defOf();
    const sequence: SimonColor[] = ['gelb', 'rot', 'blau', 'gruen', 'rot'];
    const state: SimonState = { type: 'simon', sequence, stage: 3, progress: 1, lastWrong: false };
    const right = pressFromPage(def, 'rot', WITHOUT_VOWEL, 0);
    const wrong = SIMON_COLORS.find((c) => c !== right) ?? 'rot';
    const slip = simonModule.apply(def, state, press(wrong), 'op', ctx(WITHOUT_VOWEL, 0));
    expect(slip.penalty).not.toBeNull();
    expect(slip.solved).toBe(false);
    expect(slip.state).toMatchObject({ stage: 3, progress: 0, lastWrong: true });
    const afterAlarm = { edgework: WITHOUT_VOWEL, alarms: 1, crew: CREW };
    for (const viewer of [AT_STATION, AT_BOOK]) {
      const view = simonModule.view(def, slip.state, viewer, afterAlarm);
      expect(view).toMatchObject({ stage: 3, progress: 0, lastWrong: true, alarms: 1 });
    }
    // The alarm moved the crew to the next row; the stage starts over from its first color.
    const again = pressFromPage(def, 'gelb', WITHOUT_VOWEL, 1);
    const next = simonModule.apply(def, slip.state, press(again), 'op', ctx(WITHOUT_VOWEL, 1));
    expect(next.penalty).toBeNull();
    expect(next.state).toMatchObject({ stage: 3, progress: 1, lastWrong: false });
  });
});

describe.each(LEGENDS)('simon translation, legend %s', (legend) => {
  it('accepts exactly the printed color for every table, row and flashed color', () => {
    const def = defOf({ legend });
    for (const edgework of [WITH_VOWEL, WITHOUT_VOWEL]) {
      for (const alarms of [0, 1, 2, 3, 7]) {
        for (const flashed of SIMON_COLORS) {
          const state = simonModule.init(def, mulberry32(1), ctx(edgework, alarms));
          const atStageOne = { ...state, sequence: [flashed, ...state.sequence.slice(1)] };
          const accepted = SIMON_COLORS.filter(
            (color) =>
              simonModule.apply(def, atStageOne, press(color), 'op', ctx(edgework, alarms))
                .penalty === null,
          );
          expect(accepted).toEqual([pressFromPage(def, flashed, edgework, alarms)]);
        }
      }
    }
  });

  it(`is solved from the station's view for every table and row, over ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      expect(playWithSlips(seed, legend)).toBe(true);
    }
  });
});

describe('simon translation by legend', () => {
  it('kennung: changes every translation with the Laborkennung and the first two alarms', () => {
    const def = defOf();
    for (const flashed of SIMON_COLORS) {
      const rows = [WITH_VOWEL, WITHOUT_VOWEL].map((edgework) =>
        [0, 1, 2].map((alarms) => pressFromPage(def, flashed, edgework, alarms)),
      );
      for (const row of rows) {
        expect(new Set(row).size).toBe(3);
      }
      expect(rows[0]?.every((color, alarms) => color !== rows[1]?.[alarms])).toBe(true);
    }
  });

  it('einfach: changes every translation with the first alarm, never with the Kennung', () => {
    const def = defOf({ legend: 'einfach' });
    for (const flashed of SIMON_COLORS) {
      const rows = [WITH_VOWEL, WITHOUT_VOWEL].map((edgework) =>
        [0, 1, 2, 7].map((alarms) => pressFromPage(def, flashed, edgework, alarms)),
      );
      expect(rows[0]).toEqual(rows[1]);
      const [calm, first, ...more] = rows[0] ?? [];
      expect(more).toEqual([first, first]);
      // No color stays itself, and the first alarm moves it on.
      expect(new Set([flashed, calm, first]).size).toBe(3);
    }
  });

  it('kennung needs the edgework to solve', () => {
    const def = defOf();
    const state = simonModule.init(def, mulberry32(3), ctx(WITH_VOWEL, 0));
    const operator = operatorView(def, state, WITH_VOWEL, 0);
    expect(() => simonModule.solve(def, { operator, reader: operator }, null)).toThrow(
      /Laborkennung/,
    );
  });

  it('einfach is solved without the edgework', () => {
    const def = defOf({ legend: 'einfach' });
    const state = simonModule.init(def, mulberry32(3), ctx(WITH_VOWEL, 0));
    const operator = operatorView(def, state, WITH_VOWEL, 0);
    const flashed = operator.flashes?.[0];
    if (flashed === undefined) {
      throw new Error('the operator should see a flash');
    }
    expect(simonModule.solve(def, { operator, reader: operator }, null)).toEqual([
      { by: 'operator', input: press(pressFromPage(def, flashed, WITH_VOWEL, 0)) },
    ]);
  });
});

/**
 * One instance with a perfect crew that slips now and then: the solver sees
 * only the views, every wrong color at every step must raise an alarm
 * without moving on, and after each real slip the alarm count goes up, so
 * the crew has to switch rows. Throws on anything else.
 */
function playWithSlips(seed: number, legend: SimonDef['legend']): boolean {
  const def = defOf({ sequenceLength: 3 + (seed % 6), legend });
  const edgework = generateEdgework(mulberry32(seed + 1));
  const rng = mulberry32(seed);
  let alarms = seed % 3;
  let slipsLeft = 2;
  let state = simonModule.init(def, rng, ctx(edgework, alarms));
  for (let moves = 0; moves < 200; moves++) {
    const operator = operatorView(def, state, edgework, alarms);
    const views: Perspectives<SimonView> = {
      operator,
      reader: simonModule.view(def, state, AT_BOOK, { edgework, alarms, crew: CREW }),
    };
    const [move, ...more] = simonModule.solve(def, views, edgework);
    const flashed = operator.flashes?.[operator.progress];
    if (move === undefined || more.length > 0 || flashed === undefined) {
      throw new Error(`seed ${seed}: expected exactly one move for a flashed color`);
    }
    expect(move.input.color).toBe(pressFromPage(def, flashed, edgework, alarms));
    const slips = SIMON_COLORS.filter((c) => c !== move.input.color).map((color) =>
      simonModule.apply(def, state, press(color), 'op', ctx(edgework, alarms)),
    );
    for (const slip of slips) {
      expect(slip.penalty).not.toBeNull();
      expect(slip.state).toMatchObject({ stage: state.stage, progress: 0, lastWrong: true });
    }
    const slip = slips[0];
    if (slip !== undefined && slipsLeft > 0 && rng() < 0.1) {
      slipsLeft -= 1;
      alarms += 1;
      state = slip.state;
      continue;
    }
    const input = simonModule.inputSchema.parse(move.input);
    expect(move.by).toBe('operator');
    const result = simonModule.apply(def, state, input, 'op', ctx(edgework, alarms));
    expect(result.penalty).toBeNull();
    if (result.solved) {
      return true;
    }
    state = result.state;
  }
  throw new Error(`seed ${seed}: not solved within 200 moves`);
}

describe('simon manual', () => {
  it('prints the stages, the choice of table and both translation tables', () => {
    const [section, ...more] = simonModule.manual(defOf({ sequenceLength: 6, penaltySec: 25 }));
    expect(more).toEqual([]);
    expect(section?.heading).toBe('Frequenz-Abgleich');
    const blocks = section?.blocks ?? [];
    expect(blocks.map((block) => block.kind)).toEqual([
      'figure',
      'p',
      'rules',
      'table',
      'table',
      'example',
      'p',
    ]);
    expect(blocks[1]).toMatchObject({
      kind: 'p',
      text: expect.stringMatching(/bis Stufe 6\..*Alarmstand am Panel die Zeile/),
    });
    expect(blocks[2]).toEqual({
      kind: 'rules',
      items: [
        'Wenn die Laborkennung ein A, E oder U enthält, gilt die Tabelle „Mit Vokal“.',
        'Andernfalls gilt die Tabelle „Ohne Vokal“.',
      ],
    });
    expect(blocks.at(-1)).toEqual({
      kind: 'p',
      text:
        'Fehlgriff: Alarm, −25 s. Die Stufe beginnt von vorn, mit der Zeile für den neuen ' +
        'Alarmstand.',
    });
    expect(blocks.slice(3, 5)).toEqual([
      {
        kind: 'table',
        head: ['Mit Vokal', 'rot', 'blau', 'grün', 'gelb'],
        rows: [
          ['0 Alarme', 'rot', 'gelb', 'blau', 'grün'],
          ['1 Alarm', 'blau', 'grün', 'gelb', 'rot'],
          ['≥ 2 Alarme', 'gelb', 'rot', 'grün', 'blau'],
        ],
      },
      {
        kind: 'table',
        head: ['Ohne Vokal', 'rot', 'blau', 'grün', 'gelb'],
        rows: [
          ['0 Alarme', 'blau', 'grün', 'rot', 'gelb'],
          ['1 Alarm', 'gelb', 'rot', 'blau', 'grün'],
          ['≥ 2 Alarme', 'grün', 'blau', 'gelb', 'rot'],
        ],
      },
    ]);
  });

  it('prints one table of two rows and nothing of the Kennung for the einfach legend', () => {
    const def = defOf({ legend: 'einfach', sequenceLength: 4, penaltySec: 25 });
    const [section, ...more] = simonModule.manual(def);
    expect(more).toEqual([]);
    expect(section?.heading).toBe('Frequenz-Abgleich');
    const blocks = section?.blocks ?? [];
    expect(blocks.map((block) => block.kind)).toEqual(['figure', 'p', 'table', 'example', 'p']);
    expect(JSON.stringify(blocks)).not.toMatch(/Vokal|Kennung/);
    expect(blocks[1]).toMatchObject({
      kind: 'p',
      text: expect.stringMatching(/bis Stufe 4\..*Alarmstand am Panel die Zeile/),
    });
    expect(blocks.at(-1)).toMatchObject({
      text: expect.stringMatching(/^Fehlgriff: Alarm, −25 s\./),
    });
    expect(blocks[2]).toEqual({
      kind: 'table',
      head: ['Blinkt', 'rot', 'blau', 'grün', 'gelb'],
      rows: [
        ['0 Alarme', 'blau', 'rot', 'gelb', 'grün'],
        ['1 oder mehr Alarme', 'grün', 'gelb', 'rot', 'blau'],
      ],
    });
  });

  /** The lab and alarm count an example may state; a legend that ignores the Kennung, any lab. */
  const STATED: Record<string, { labs: Edgework[]; alarms: number }> = {
    'Kennung ohne A, E und U; 1 Alarm am Panel.': { labs: [WITHOUT_VOWEL], alarms: 1 },
    '0 Alarme am Panel.': { labs: [WITH_VOWEL, WITHOUT_VOWEL], alarms: 0 },
  };

  it.each(LEGENDS)('prints an example that the page and the panel bear out: %s', (legend) => {
    const def = defOf({ legend });
    const example = simonModule
      .manual(def)
      .flatMap((section) => section.blocks)
      .find((block) => block.kind === 'example');
    const [seen = '', read = '', pressed = ''] = example?.kind === 'example' ? example.lines : [];
    const flashed = /^Gesehen: Stufe 2 blinkt (\S+), dann (\S+?)[.;] (.+)$/.exec(seen);
    const answered = /^Gedrückt: (\S+), dann (\S+)\.$/.exec(pressed);
    const stated = STATED[flashed?.[3] ?? ''];
    const colour = (name = ''): SimonColor => {
      const found = SIMON_COLORS.find((c) => PRINTED[c] === name);
      if (found === undefined) {
        throw new Error(`"${name}" is no printed colour`);
      }
      return found;
    };
    if (flashed === null || answered === null || stated === undefined) {
      throw new Error(`unreadable example: ${JSON.stringify([seen, read, pressed])}`);
    }
    const flashes = [colour(flashed[1]), colour(flashed[2])];
    const presses = [colour(answered[1]), colour(answered[2])];
    for (const edgework of stated.labs) {
      // Line 2 names the table the Kennung picks, if the page prints two, and the alarm row.
      const tables = printedTables(def);
      const label = serialHasVowel(edgework) ? 'Mit Vokal' : 'Ohne Vokal';
      const table = tables.length === 1 ? tables[0] : tables.find((t) => t.head[0] === label);
      const row = table?.rows[Math.min(stated.alarms, table.rows.length - 1)]?.[0];
      const named = tables.length === 1 ? `Zeile „${row}“` : `Tabelle „${label}“, Zeile „${row}“`;
      expect(read.startsWith(`${named}: `), read).toBe(true);
      for (const [i, flash] of flashes.entries()) {
        const answer = presses[i] ?? flash;
        expect(pressFromPage(def, flash, edgework, stated.alarms)).toBe(answer);
        expect(read).toContain(`${PRINTED[flash]} ergibt ${PRINTED[answer]}`);
      }
      // Stage 2 with these flashes takes the two presses and moves on to stage 3.
      const sequence: SimonColor[] = [...flashes, 'gelb', 'rot', 'blau'];
      let state: SimonState = { type: 'simon', sequence, stage: 2, progress: 0, lastWrong: false };
      const lab = ctx(edgework, stated.alarms);
      for (const color of presses) {
        const result = simonModule.apply(def, state, press(color), 'op', lab);
        expect(result.penalty).toBeNull();
        state = result.state;
      }
      expect(state).toMatchObject({ stage: 3, progress: 0 });
    }
  });

  it.each(LEGENDS)('prints permutations only, none of them the identity: %s', (legend) => {
    for (const table of printedTables(defOf({ legend }))) {
      const colors = table.head.slice(1);
      for (const row of table.rows) {
        const cells = row.slice(1);
        expect([...cells].sort()).toEqual([...colors].sort());
        expect(cells).not.toEqual(colors);
      }
    }
  });

  it('takes the kennung legend by default, einfach on request, nothing else', () => {
    expect(defOf().legend).toBe('kennung');
    expect(defOf({ legend: 'einfach' }).legend).toBe('einfach');
    for (const legend of ['vokal', 'Einfach', '', 2]) {
      expect(() => simonModule.defSchema.parse({ ...defOf(), legend }), String(legend)).toThrow(
        /legend/,
      );
    }
  });
});

const mission: Mission = labMission(
  [{ type: 'simon', id: 'frequenz', title: 'Frequenz', sequenceLength: 4, penaltySec: 12 }],
  'simontest',
);

/** Anna (p1) at the panel, Ben (p2) at the book; both have read the sign. */
function started(seed = 11): GameState {
  return openLab(startedLab(mission, seed));
}

function pressAction(playerId: string, input: unknown, at: number): Action {
  return { type: 'puzzle-input', playerId, at, input };
}

function simonView(state: GameState, playerId: string) {
  const puzzle = viewFor(state, playerId).puzzle;
  if (puzzle?.kind !== 'simon') {
    throw new Error('expected a simon view');
  }
  return puzzle;
}

function simonDef(): SimonDef {
  const def = mission.puzzles[0];
  if (def?.type !== 'simon') {
    throw new Error('expected the simon puzzle');
  }
  return def;
}

/** Plays the open stage through the reducer, the way the manual holder translates it. */
function clearStage(state: GameState, at: number): GameState {
  const { flashes, alarms } = simonView(state, 'p1');
  const edgework = viewFor(state, 'p1').edgework;
  if (flashes === null || edgework === null) {
    throw new Error('the operator should see the flashes and the edgework');
  }
  const def = simonDef();
  return flashes.reduce((s, flashed) => {
    const color = pressFromPage(def, flashed, edgework, alarms);
    return applyAction(s, pressAction('p1', press(color), at));
  }, state);
}

describe('simon in a run', () => {
  it('shows the flashes at the panel only, over the wire', () => {
    const state = clearStage(clearStage(started(), T0 + 1000), T0 + 2000);
    const operator = simonView(state, 'p1');
    const manual = simonView(state, 'p2');
    expect(operator.flashes).toHaveLength(3);
    expect(operator.buttons).toEqual(['rot', 'blau', 'gruen', 'gelb']);
    expect(operator.manual).toBeNull();
    expect(manual).toMatchObject({ flashes: null, buttons: null, stage: 3, stages: 4, alarms: 0 });
    expect(manual.manual).toEqual(simonModule.manual(simonDef()));
    const wire = JSON.stringify(viewFor(state, 'p2'));
    expect(wire).not.toContain('"flashes":[');
    expect(wire).not.toContain(JSON.stringify(operator.flashes));
  });

  it('an alarm switches the row: the old translation is wrong from then on', () => {
    let state = started();
    const edgework = viewFor(state, 'p1').edgework;
    const flashed = simonView(state, 'p1').flashes?.[0];
    if (edgework === null || flashed === undefined) {
      throw new Error('the operator should see the edgework and a flash');
    }
    const row = (alarms: number) => pressFromPage(simonDef(), flashed, edgework, alarms);
    const neither = SIMON_COLORS.find((c) => c !== row(0) && c !== row(1)) ?? 'rot';
    const before = state.deadlineAt ?? 0;
    state = applyAction(state, pressAction('p1', press(neither), T0 + 1000));
    expect(simonView(state, 'p2')).toMatchObject({ alarms: 1, lastWrong: true, stage: 1 });
    state = applyAction(state, pressAction('p1', press(row(0)), T0 + 2000));
    expect(state.penaltySeq).toBe(2);
    expect(state.deadlineAt).toBe(before - 2 * 12_000);
    state = applyAction(state, pressAction('p1', press(row(2)), T0 + 3000));
    expect(state.penaltySeq).toBe(2);
    expect(simonView(state, 'p1')).toMatchObject({ stage: 2, progress: 0, lastWrong: false });
  });

  it('is won by entering the last stage completely', () => {
    let state = started();
    for (let stage = 1; stage <= 4; stage++) {
      expect(state.phase).toBe('playing');
      state = clearStage(state, T0 + stage * 1000);
    }
    expect(state.phase).toBe('won');
    expect(state.penaltySeq).toBe(0);
  });

  it('only a player at the panel may press', () => {
    expect(() =>
      applyAction(started(), pressAction('p2', press('rot'), T0 + 1000)),
    ).toThrow(GameError);
    expect(() =>
      applyAction(started(), pressAction('p2', press('rot'), T0 + 1000)),
    ).toThrow('Dafür musst du am Pult stehen.');
  });

  it('takes nothing but one press of one of the four colors', () => {
    for (const input of [
      { kind: 'press', color: 'lila' },
      { kind: 'press', color: 'grün' },
      { color: 'rot' },
      { kind: 'press', color: 'rot', times: 2 },
      { buttonIndex: 0 },
    ]) {
      expect(() => applyAction(started(), pressAction('p1', input, T0 + 1000))).toThrow(
        /Ungültige Eingabe/,
      );
    }
  });

  it('cannot run on a map without the edgework sign', () => {
    const raw = JSON.parse(JSON.stringify(mission));
    delete raw.map.edgeworkSign;
    expect(() => parseMission(raw)).toThrow(/read the edgework/);
  });
});
