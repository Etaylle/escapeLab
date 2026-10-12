import { describe, expect, it } from 'vitest';
import {
  applyAction,
  GameError,
  generateEdgework,
  initialState,
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
  PuzzleContext,
} from '../src/index.js';
import { SIMON_COLORS, simonModule } from '../src/puzzles/simon.js';
import type { SimonColor, SimonDef, SimonState, SimonView } from '../src/puzzles/simon.js';
import { mulberry32 } from '../src/rng.js';

const T0 = 1_000_000;
const SEEDS = 300;
const OPERATOR = 'pult';
const MANUAL = 'handbuch';

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
    prompt: '',
    operatorRoleId: OPERATOR,
    manualRoleId: MANUAL,
    ...fields,
  });
}

const ctx = (edgework: Edgework, alarms: number): PuzzleContext => ({
  edgework,
  alarms,
  remainingSec: 600,
  at: T0,
});

const press = (color: SimonColor) => ({ kind: 'press', color }) as const;

function operatorView(def: SimonDef, state: SimonState, edgework: Edgework, alarms: number) {
  return simonModule.view(def, state, OPERATOR, { edgework, alarms });
}

type TableBlock = Extract<ManualBlock, { kind: 'table' }>;
const isTable = (block: ManualBlock): block is TableBlock => block.kind === 'table';

function printedTables(def: SimonDef): TableBlock[] {
  return simonModule.manual(def).flatMap((section) => section.blocks.filter(isTable));
}

/**
 * What a crew holding nothing but the printed page presses for `flashed`:
 * the table by the Laborkennung, the row by the alarms so far, the column by
 * the flashed color.
 */
function pressFromPage(
  def: SimonDef,
  flashed: SimonColor,
  edgework: Edgework,
  alarms: number,
): SimonColor {
  const label = serialHasVowel(edgework) ? 'Mit Vokal' : 'Ohne Vokal';
  const table = printedTables(def).find((t) => t.head[0] === label);
  const cell = table?.rows[Math.min(alarms, 2)]?.[table.head.indexOf(PRINTED[flashed])];
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
        const result = simonModule.apply(def, state, press(color), OPERATOR, ctx(WITH_VOWEL, 0));
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
    const slip = simonModule.apply(def, state, press(wrong), OPERATOR, ctx(WITHOUT_VOWEL, 0));
    expect(slip.penalty).not.toBeNull();
    expect(slip.solved).toBe(false);
    expect(slip.state).toMatchObject({ stage: 3, progress: 0, lastWrong: true });
    const afterAlarm = { edgework: WITHOUT_VOWEL, alarms: 1 };
    for (const roleId of [OPERATOR, MANUAL]) {
      const view = simonModule.view(def, slip.state, roleId, afterAlarm);
      expect(view).toMatchObject({ stage: 3, progress: 0, lastWrong: true, alarms: 1 });
    }
    // The alarm moved the crew to the next row; the stage starts over from its first color.
    const again = pressFromPage(def, 'gelb', WITHOUT_VOWEL, 1);
    const next = simonModule.apply(def, slip.state, press(again), OPERATOR, ctx(WITHOUT_VOWEL, 1));
    expect(next.penalty).toBeNull();
    expect(next.state).toMatchObject({ stage: 3, progress: 1, lastWrong: false });
  });
});

describe('simon translation', () => {
  it('accepts exactly the printed color for every table, row and flashed color', () => {
    const def = defOf();
    for (const edgework of [WITH_VOWEL, WITHOUT_VOWEL]) {
      for (const alarms of [0, 1, 2, 3, 7]) {
        for (const flashed of SIMON_COLORS) {
          const state = simonModule.init(def, mulberry32(1), ctx(edgework, alarms));
          const atStageOne = { ...state, sequence: [flashed, ...state.sequence.slice(1)] };
          const accepted = SIMON_COLORS.filter(
            (color) =>
              simonModule.apply(def, atStageOne, press(color), OPERATOR, ctx(edgework, alarms))
                .penalty === null,
          );
          expect(accepted).toEqual([pressFromPage(def, flashed, edgework, alarms)]);
        }
      }
    }
  });

  it('changes every translation with the Laborkennung and with the first two alarms', () => {
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

  it('is solved from the role views for both tables and every row, over 300 seeds', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      expect(playWithSlips(seed)).toBe(true);
    }
  });

  it('needs the edgework to solve', () => {
    const def = defOf();
    const state = simonModule.init(def, mulberry32(3), ctx(WITH_VOWEL, 0));
    const views = { [OPERATOR]: operatorView(def, state, WITH_VOWEL, 0) };
    expect(() => simonModule.solve(def, views, null)).toThrow(/Laborkennung/);
  });
});

/**
 * One instance with a perfect crew that slips now and then: the solver sees
 * only the views, every wrong color at every step must raise an alarm
 * without moving on, and after each real slip the alarm count goes up, so
 * the crew has to switch rows. Throws on anything else.
 */
function playWithSlips(seed: number): boolean {
  const def = defOf({ sequenceLength: 3 + (seed % 6) });
  const edgework = generateEdgework(mulberry32(seed + 1));
  const rng = mulberry32(seed);
  let alarms = seed % 3;
  let slipsLeft = 2;
  let state = simonModule.init(def, rng, ctx(edgework, alarms));
  for (let moves = 0; moves < 200; moves++) {
    const operator = operatorView(def, state, edgework, alarms);
    const views: Record<string, SimonView> = {
      [OPERATOR]: operator,
      [MANUAL]: simonModule.view(def, state, MANUAL, { edgework, alarms }),
    };
    const [move, ...more] = simonModule.solve(def, views, edgework);
    const flashed = operator.flashes?.[operator.progress];
    if (move === undefined || more.length > 0 || flashed === undefined) {
      throw new Error(`seed ${seed}: expected exactly one move for a flashed color`);
    }
    expect(move.input.color).toBe(pressFromPage(def, flashed, edgework, alarms));
    const slips = SIMON_COLORS.filter((c) => c !== move.input.color).map((color) =>
      simonModule.apply(def, state, press(color), OPERATOR, ctx(edgework, alarms)),
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
    const result = simonModule.apply(def, state, input, move.roleId, ctx(edgework, alarms));
    expect(result.penalty).toBeNull();
    if (result.solved) {
      return true;
    }
    state = result.state;
  }
  throw new Error(`seed ${seed}: not solved within 200 moves`);
}

describe('simon manual', () => {
  it('prints the stage rule and both translation tables', () => {
    const [section, ...more] = simonModule.manual(defOf({ sequenceLength: 6, penaltySec: 25 }));
    expect(more).toEqual([]);
    expect(section?.heading).toBe('Frequenz-Abgleich');
    expect(section?.blocks[0]).toMatchObject({
      kind: 'p',
      text: expect.stringMatching(/bis 6\..*Vokal.*−25 s/),
    });
    expect(section?.blocks.slice(1)).toEqual([
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

  it('prints permutations only, none of them the identity', () => {
    for (const table of printedTables(defOf())) {
      const colors = table.head.slice(1);
      for (const row of table.rows) {
        const cells = row.slice(1);
        expect([...cells].sort()).toEqual([...colors].sort());
        expect(cells).not.toEqual(colors);
      }
    }
  });
});

const mission: Mission = parseMission({
  id: 'simontest',
  title: 'Frequenz-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  roles: [
    { id: OPERATOR, name: 'Pult', description: '', seesEdgework: true },
    { id: MANUAL, name: 'Handbuch', description: '' },
  ],
  puzzles: [
    {
      type: 'simon',
      id: 'frequenz',
      title: 'Frequenz',
      prompt: '',
      operatorRoleId: OPERATOR,
      manualRoleId: MANUAL,
      sequenceLength: 4,
      penaltySec: 12,
    },
  ],
});

function started(seed = 11): GameState {
  const actions: Action[] = [
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
    { type: 'select-role', playerId: 'p1', roleId: OPERATOR },
    { type: 'select-role', playerId: 'p2', roleId: MANUAL },
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'start-mission', playerId: 'p1', at: T0, seed },
  ];
  return actions.reduce(applyAction, initialState(mission));
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
  it('shows the flashes to the operator only, over the wire', () => {
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

  it('only the operator may press', () => {
    expect(() =>
      applyAction(started(), pressAction('p2', press('rot'), T0 + 1000)),
    ).toThrow(GameError);
    expect(() =>
      applyAction(started(), pressAction('p2', press('rot'), T0 + 1000)),
    ).toThrow(/Frequenz-Panel/);
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

  it('cannot run in a mission where nobody sees the edgework', () => {
    const raw = JSON.parse(JSON.stringify(mission)) as { roles: object[] };
    expect(() =>
      parseMission({ ...raw, roles: raw.roles.map((role) => ({ ...role, seesEdgework: false })) }),
    ).toThrow(/read the edgework/);
  });
});
