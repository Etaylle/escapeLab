import { describe, expect, it } from 'vitest';
import {
  applyAction,
  GameError,
  generateEdgework,
  indicatorLit,
  parseMission,
  viewFor,
} from '../src/index.js';
import type {
  Action,
  Edgework,
  GameState,
  IndicatorId,
  Mission,
  Perspectives,
  PlayerView,
  PuzzleContext,
} from '../src/index.js';
import { buttonModule } from '../src/puzzles/button.js';
import type {
  ButtonColour,
  ButtonInput,
  ButtonLabel,
  ButtonState,
  ButtonView,
  StripColour,
} from '../src/puzzles/button.js';
import { mulberry32 } from '../src/rng.js';
import {
  AT_BOOK,
  AT_STATION,
  AUDIENCE,
  ELSEWHERE,
  labMission,
  openLab,
  started as startedLab,
  T0,
} from './lab.js';

const SEEDS = 300;
const CREW = ['op', 'rd'];

const mission: Mission = labMission(
  [{ type: 'button', id: 'knopf', title: 'Knopf', penaltySec: 25 }],
  'knopftest',
);
const def = (() => {
  const puzzle = mission.puzzles[0];
  if (puzzle?.type !== 'button') {
    throw new Error('expected the button puzzle');
  }
  return puzzle;
})();

type Move = 'press' | 'hold';

/** The first printed list, written out by hand: the number of the deciding rule and its move. */
function byTheManual(colour: ButtonColour, label: ButtonLabel, lab: Edgework) {
  const rules: [boolean, Move][] = [
    [colour === 'blau' && label === 'ABBRUCH', 'hold'],
    [lab.cells > 1 && label === 'DRÜCKEN', 'press'],
    [colour === 'weiß' && indicatorLit(lab, 'CAR'), 'hold'],
    [lab.cells > 2 && indicatorLit(lab, 'FRQ'), 'press'],
    [colour === 'gelb', 'hold'],
    [colour === 'rot' && label === 'HALTEN', 'press'],
    [true, 'hold'],
  ];
  const index = rules.findIndex(([applies]) => applies);
  return { rule: index + 1, move: rules[index]?.[1] ?? 'hold' };
}

/** The second printed list: the digit to let go on, by strip. */
const RELEASE_DIGIT: Record<StripColour, number> = { blau: 4, weiß: 1, gelb: 5, rot: 1 };

/** The mission clock as the HUD prints it. */
const clock = (sec: number): string =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const shows = (sec: number, digit: number): boolean => clock(sec).includes(String(digit));

/** Counting down from `from`: the first second that satisfies `ok`. */
function countDown(from: number, ok: (sec: number) => boolean): number {
  for (let sec = from; sec > 0; sec--) {
    if (ok(sec)) {
      return sec;
    }
  }
  throw new Error(`no second at or below ${from} fits`);
}
/** A second whose clock shows the digit. */
const showing = (digit: number, from: number): number =>
  countDown(from, (sec) => shows(sec, digit));
/** A second whose clock shows the digit neither now nor one second earlier (the grace). */
const missing = (digit: number, from: number): number =>
  countDown(from, (sec) => !shows(sec, digit) && !shows(sec + 1, digit));

const ctx = (edgework: Edgework, remainingSec = 600): PuzzleContext => ({
  edgework,
  alarms: 0,
  remainingSec,
  at: T0,
  crew: CREW,
  console: 'a',
  atConsoles: { a: [], b: [] },
  readers: [],
});

function apply(state: ButtonState, kind: ButtonInput['kind'], lab: Edgework, remainingSec = 600) {
  const input = buttonModule.inputSchema.parse({ kind });
  return buttonModule.apply(def, state, input, 'op', ctx(lab, remainingSec));
}

/** The button seen from the station and from the book. */
function viewsOf(state: ButtonState, edgework: Edgework): Perspectives<ButtonView> {
  return {
    operator: buttonModule.view(def, state, AT_STATION, { edgework, alarms: 0, crew: CREW }),
    reader: buttonModule.view(def, state, AT_BOOK, { edgework, alarms: 0, crew: CREW }),
  };
}

/** One rolled instance, the way a run sets it up: puzzle and edgework from their own streams. */
function rolled(seed: number): { edgework: Edgework; state: ButtonState } {
  const edgework = generateEdgework(mulberry32(seed + 1));
  return { edgework, state: buttonModule.init(def, mulberry32(seed), ctx(edgework)) };
}

/** The operator's view, which the solver and the oracle read. */
function operatorView(state: ButtonState, edgework: Edgework) {
  const panel = viewsOf(state, edgework).operator;
  if (panel.colour === null || panel.label === null) {
    throw new Error('expected the operator to see the button');
  }
  return { ...panel, colour: panel.colour, label: panel.label };
}

function button(colour: ButtonColour, label: ButtonLabel, strip: StripColour = 'blau') {
  const state: ButtonState = {
    type: 'button',
    colour,
    label,
    strip,
    holding: false,
    lastResult: null,
  };
  return state;
}

/** A lab with the given cells and lamps; the rules never read the serial. */
const lab = (cells: number, lamps: [IndicatorId, boolean][] = []): Edgework => ({
  serial: 'K7G3B-2',
  indicators: lamps.map(([id, lit]) => ({ id, lit })),
  cells,
});

describe('button: every instance', () => {
  it(`is solved from the views, the manual and the clock, without an alarm, for ${SEEDS} seeds`, () => {
    const decidedBy = new Set<number>();
    const stripsLetGo = new Set<StripColour>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { edgework, state } = rolled(seed);
      const panel = operatorView(state, edgework);
      const expected = byTheManual(panel.colour, panel.label, edgework);
      decidedBy.add(expected.rule);
      const moves = buttonModule.solve(def, viewsOf(state, edgework), edgework);
      expect(moves, `seed ${seed}`).toEqual([{ by: 'operator', input: { kind: expected.move } }]);

      const first = apply(state, expected.move, edgework);
      expect(first.penalty, `seed ${seed}`).toBeNull();
      expect(first.solved, `seed ${seed}`).toBe(expected.move === 'press');
      if (first.solved) {
        continue;
      }
      // Held: the views cannot time the release, so without a clock the solver waits.
      expect(buttonModule.solve(def, viewsOf(first.state, edgework), edgework)).toEqual([]);
      const strip = operatorView(first.state, edgework).strip;
      if (strip === null) {
        throw new Error(`seed ${seed}: no strip on a held button`);
      }
      stripsLetGo.add(strip);
      const sec = showing(RELEASE_DIGIT[strip], 60 + ((seed * 37) % 540));
      expect(apply(first.state, 'release', edgework, sec), `seed ${seed} at ${clock(sec)}`)
        .toMatchObject({ solved: true, penalty: null });
    }
    // Every printed rule decides some instance, and every strip is met at a release.
    expect([...decidedBy].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect([...stripsLetGo].sort()).toEqual(['blau', 'gelb', 'rot', 'weiß']);
  });

  it(`raises the alarm on every wrong move and lets the crew retry, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { edgework, state } = rolled(seed);
      const { move } = byTheManual(state.colour, state.label, edgework);
      const wrongFirst = apply(state, move === 'press' ? 'hold' : 'press', edgework);
      expect(wrongFirst.penalty, `seed ${seed}`).not.toBeNull();
      expect(wrongFirst.solved).toBe(false);
      expect(wrongFirst.state).toMatchObject({
        holding: false,
        lastResult: move === 'press' ? 'held' : 'early',
      });
      if (move === 'press') {
        expect(apply(wrongFirst.state, 'press', edgework)).toMatchObject({ solved: true });
        continue;
      }
      const digit = RELEASE_DIGIT[state.strip];
      const from = 60 + ((seed * 37) % 540);
      const held = apply(wrongFirst.state, 'hold', edgework);
      expect(held.penalty).toBeNull();
      const late = apply(held.state, 'release', edgework, missing(digit, from));
      expect(late).toMatchObject({ solved: false, penalty: 'Knopf zur falschen Zeit losgelassen' });
      expect(late.state).toMatchObject({ holding: false, lastResult: 'wrong-time' });
      const again = apply(late.state, 'hold', edgework);
      expect(apply(again.state, 'release', edgework, showing(digit, from))).toMatchObject({
        solved: true,
        penalty: null,
      });
    }
  });

  it('rolls every colour, label and strip, the same for a seed', () => {
    const states = Array.from({ length: SEEDS }, (_, seed) => rolled(seed).state);
    const seen = (key: 'colour' | 'label' | 'strip') =>
      [...new Set(states.map((state) => state[key]))].sort();
    expect(seen('colour')).toEqual(['blau', 'gelb', 'rot', 'weiß']);
    expect(seen('label')).toEqual(['ABBRUCH', 'DRÜCKEN', 'HALTEN', 'START']);
    expect(seen('strip')).toEqual(['blau', 'gelb', 'rot', 'weiß']);
    expect(rolled(7)).toEqual(rolled(7));
  });
});

describe('button: the first list', () => {
  it.each<[string, ButtonColour, ButtonLabel, Edgework, Move]>([
    ['rule 1 comes before rule 4', 'blau', 'ABBRUCH', lab(4, [['FRQ', true]]), 'hold'],
    ['rule 2 with two cells', 'blau', 'DRÜCKEN', lab(2), 'press'],
    ['rule 2 not with one cell', 'blau', 'DRÜCKEN', lab(1), 'hold'],
    ['rule 2 comes before rule 3', 'weiß', 'DRÜCKEN', lab(2, [['CAR', true]]), 'press'],
    ['rule 2 comes before rule 5', 'gelb', 'DRÜCKEN', lab(3), 'press'],
    ['rule 3 comes before rule 4', 'weiß', 'START', lab(3, [['CAR', true], ['FRQ', true]]), 'hold'],
    ['rule 3 not with CAR dark', 'weiß', 'START', lab(3, [['CAR', false], ['FRQ', true]]), 'press'],
    ['rule 4 comes before rule 5', 'gelb', 'HALTEN', lab(3, [['FRQ', true]]), 'press'],
    ['rule 4 not with two cells', 'gelb', 'HALTEN', lab(2, [['FRQ', true]]), 'hold'],
    ['rule 4 not with FRQ dark', 'rot', 'START', lab(4, [['FRQ', false]]), 'hold'],
    ['rule 6', 'rot', 'HALTEN', lab(0), 'press'],
    ['rule 6 not with another label', 'rot', 'ABBRUCH', lab(0), 'hold'],
    ['otherwise hold', 'blau', 'START', lab(4, [['CAR', true]]), 'hold'],
  ])('%s', (_case, colour, label, edgework, move) => {
    const state = button(colour, label);
    expect(buttonModule.solve(def, viewsOf(state, edgework), edgework)).toEqual([
      { by: 'operator', input: { kind: move } },
    ]);
    expect(apply(state, move, edgework).penalty).toBeNull();
    expect(apply(state, move === 'press' ? 'hold' : 'press', edgework).penalty).not.toBeNull();
  });
});

describe('button: letting go', () => {
  it.each<[StripColour, number, string, boolean]>([
    ['blau', 124, '02:04', true],
    ['blau', 123, '02:03, a second after 02:04', true],
    ['blau', 122, '02:02, two seconds after 02:04', false],
    ['blau', 240, '04:00 — the digit may stand anywhere', true],
    ['weiß', 600, '10:00', true],
    ['weiß', 59, '00:59, a second after 01:00', true],
    ['weiß', 125, '02:05', false],
    ['gelb', 125, '02:05', true],
    ['gelb', 126, '02:06', false],
    ['rot', 71, '01:11 — every other strip on a 1', true],
    ['rot', 122, '02:02', false],
  ])('a %s strip with %i s left (%s): solved %s', (strip, sec, _clock, solved) => {
    const edgework = lab(0);
    const held = apply(button('blau', 'ABBRUCH', strip), 'hold', edgework);
    expect(held).toMatchObject({ solved: false, penalty: null });
    const result = apply(held.state, 'release', edgework, sec);
    expect(result.solved).toBe(solved);
    expect(result.penalty).toBe(solved ? null : 'Knopf zur falschen Zeit losgelassen');
  });

  it('ignores a release after the button sprang back, and a second hold or press', () => {
    const edgework = lab(0);
    const idle = button('blau', 'ABBRUCH');
    const nothing = { solved: false, penalty: null };
    expect(apply(idle, 'release', edgework, 124)).toEqual({ state: idle, ...nothing });
    const held = apply(idle, 'hold', edgework).state;
    expect(apply(held, 'hold', edgework)).toEqual({ state: held, ...nothing });
    expect(apply(held, 'press', edgework)).toEqual({ state: held, ...nothing });
  });

  it('names each wrong move in the run report', () => {
    const edgework = lab(0);
    expect(apply(button('blau', 'ABBRUCH'), 'press', edgework).penalty).toBe(
      'Knopf kurz gedrückt statt gehalten',
    );
    expect(apply(button('rot', 'HALTEN'), 'hold', edgework).penalty).toBe(
      'Knopf gehalten statt kurz gedrückt',
    );
  });
});

describe('button: the solver on the clock', () => {
  const letGo = [{ by: 'operator', input: { kind: 'release' } }];
  /** The aid of a caller that keeps no transcript, reading `remainingSec` off its clock. */
  const clockAt = (remainingSec: number | null) => ({ transcript: [], remainingSec });

  it('lets go on exactly the seconds a release counts, for every strip over a whole run', () => {
    const edgework = lab(0);
    for (const strip of ['blau', 'weiß', 'gelb', 'rot'] as const) {
      const held = apply(button('blau', 'ABBRUCH', strip), 'hold', edgework).state;
      const digit = RELEASE_DIGIT[strip];
      for (let sec = 600; sec > 0; sec--) {
        const counts = shows(sec, digit) || shows(sec + 1, digit);
        const moment = `${strip} at ${clock(sec)}`;
        const moves = buttonModule.solve(def, viewsOf(held, edgework), edgework, clockAt(sec));
        expect(moves, moment).toEqual(counts ? letGo : []);
        expect(apply(held, 'release', edgework, sec).solved, moment).toBe(counts);
      }
    }
  });

  it('waits on a held button without a clock, and presses or holds whatever the clock says', () => {
    const edgework = lab(2);
    const held = apply(button('blau', 'ABBRUCH', 'weiß'), 'hold', edgework).state;
    expect(buttonModule.solve(def, viewsOf(held, edgework), edgework, clockAt(null))).toEqual([]);
    for (const [state, kind] of [
      [button('blau', 'ABBRUCH'), 'hold'],
      [button('gelb', 'DRÜCKEN'), 'press'],
    ] as const) {
      for (const sec of [null, 600, 124, 1]) {
        expect(buttonModule.solve(def, viewsOf(state, edgework), edgework, clockAt(sec))).toEqual([
          { by: 'operator', input: { kind } },
        ]);
      }
    }
  });
});

describe('button: inputs, views and solver', () => {
  it('accepts the three moves and nothing else', () => {
    const ok = (input: unknown) => buttonModule.inputSchema.safeParse(input).success;
    expect(['press', 'hold', 'release'].map((kind) => ok({ kind }))).toEqual([true, true, true]);
    expect(ok({ kind: 'tap' })).toBe(false);
    expect(ok({ kind: 'release', at: 5 })).toBe(false);
    expect(ok({})).toBe(false);
  });

  it('shows the button at the station alone, and the strip only while it is held', () => {
    const edgework = lab(0);
    const idle = button('gelb', 'START', 'weiß');
    const hidden = { colour: null, label: null, strip: null, lastResult: null };
    const ctxView = { edgework, alarms: 0, crew: CREW };
    expect(viewsOf(idle, edgework)).toEqual({
      operator: { kind: 'button', holding: false, ...hidden, colour: 'gelb', label: 'START' },
      reader: { kind: 'button', holding: false, ...hidden },
    });
    const held = viewsOf(apply(idle, 'hold', edgework).state, edgework);
    expect(held.operator).toMatchObject({ holding: true, strip: 'weiß' });
    expect(held.reader).toEqual({ kind: 'button', holding: true, ...hidden });
    expect(buttonModule.view(def, idle, ELSEWHERE, ctxView)).toMatchObject(hidden);
    expect(buttonModule.view(def, idle, AUDIENCE, ctxView)).toMatchObject({ colour: 'gelb' });
    const wrong = viewsOf(apply(idle, 'press', edgework).state, edgework);
    expect(wrong.operator).toMatchObject({ holding: false, strip: null, lastResult: 'early' });
    expect(wrong.reader).toMatchObject({ lastResult: null });
  });

  it('refuses to solve without the edgework or without the view at the station', () => {
    const state = button('rot', 'HALTEN');
    expect(() => buttonModule.solve(def, viewsOf(state, lab(0)), null)).toThrow(
      /nobody has read the sign/,
    );
    const { reader } = viewsOf(state, lab(0));
    expect(() => buttonModule.solve(def, { operator: reader, reader }, lab(0))).toThrow(
      /operator's view/,
    );
  });
});

describe('button: manual', () => {
  const sections = buttonModule.manual(def);
  const lists = sections.flatMap((section) =>
    section.blocks.flatMap((block) => (block.kind === 'rules' ? [block.items] : [])),
  );

  it('prints both rule lists, each under its heading and ending in „Andernfalls"', () => {
    expect(sections.map((section) => section.heading)).toEqual(['Der Knopf', 'Loslassen']);
    expect(lists).toEqual([
      [
        'Wenn der Knopf blau ist und die Aufschrift ABBRUCH trägt, halte den Knopf.',
        'Wenn mehr als 1 Notstromzelle eingesetzt ist und der Knopf die Aufschrift DRÜCKEN ' +
          'trägt, drücke den Knopf kurz.',
        'Wenn der Knopf weiß ist und die Kontrollleuchte CAR leuchtet, halte den Knopf.',
        'Wenn mehr als 2 Notstromzellen eingesetzt sind und die Kontrollleuchte FRQ leuchtet, ' +
          'drücke den Knopf kurz.',
        'Wenn der Knopf gelb ist, halte den Knopf.',
        'Wenn der Knopf rot ist und die Aufschrift HALTEN trägt, drücke den Knopf kurz.',
        'Andernfalls halte den Knopf.',
      ],
      [
        'Wenn der Streifen blau leuchtet, lass den Knopf los, sobald die Missionsuhr eine 4 zeigt.',
        'Wenn der Streifen weiß leuchtet, lass den Knopf los, sobald die Missionsuhr eine 1 zeigt.',
        'Wenn der Streifen gelb leuchtet, lass den Knopf los, sobald die Missionsuhr eine 5 zeigt.',
        'Andernfalls lass den Knopf los, sobald die Missionsuhr eine 1 zeigt.',
      ],
    ]);
    expect(sections.flatMap((section) => section.blocks).at(-1)).toEqual({
      kind: 'p',
      text: 'Fehlgriff: Alarm, −25 s. Der Knopf springt zurück.',
    });
  });

  /** The example's lines as the patterns they follow: the button, the hold, the release. */
  const EXAMPLE_LINES = [
    /^Gesehen: (\S+) Knopf, Aufschrift (\S+); (\d) Notstromzellen? eingesetzt\.$/,
    /^„Der Knopf“, Regel (\d) trifft als erste zu: (\S+)\. Der Streifen leuchtet (\S+)\.$/,
    new RegExp('^„Loslassen“, Regel (\\d): losgelassen bei (\\d\\d):(\\d\\d), die Uhr zeigt ' +
      'eine (\\d)\\.$'),
  ];
  const COLOURS: Record<string, ButtonColour> = {
    blauer: 'blau',
    gelber: 'gelb',
    roter: 'rot',
    weißer: 'weiß',
  };
  const LABELS: ButtonLabel[] = ['ABBRUCH', 'HALTEN', 'DRÜCKEN', 'START'];
  /** CAR and FRQ, each lit or dark. */
  const LAMPS: [boolean, boolean][] = [[false, false], [false, true], [true, false], [true, true]];

  it('prints an example that both lists, the strip and the clock bear out', () => {
    const example = sections
      .flatMap((section) => section.blocks)
      .find((block) => block.kind === 'example');
    const lines = example?.kind === 'example' ? example.lines : [];
    const [face, held, letGo] = EXAMPLE_LINES.map((pattern, i) => pattern.exec(lines[i] ?? ''));
    const colour = COLOURS[face?.[1] ?? ''];
    const label = LABELS.find((l) => l === face?.[2]);
    const strip = Object.keys(RELEASE_DIGIT).find((s): s is StripColour => s === held?.[3]);
    if (!face || !held || !letGo || colour === undefined || !label || !strip) {
      throw new Error(`unreadable example: ${JSON.stringify(lines)}`);
    }
    expect(held[2]).toBe('halten');
    // Only the cells are stated, so the lamps may be anything.
    for (const [car, frq] of LAMPS) {
      const edgework = lab(Number(face[3]), [['CAR', car], ['FRQ', frq]]);
      expect(byTheManual(colour, label, edgework)).toEqual({ rule: Number(held[1]), move: 'hold' });
      const holding = apply(button(colour, label, strip), 'hold', edgework);
      expect(holding.penalty).toBeNull();
      expect(viewsOf(holding.state, edgework).operator.strip).toBe(strip);
      const sec = Number(letGo[2]) * 60 + Number(letGo[3]);
      expect(apply(holding.state, 'release', edgework, sec)).toMatchObject({ solved: true });
    }
    // The release line named is the strip's, and the clock showed its digit.
    expect(lists[1]?.[Number(letGo[1]) - 1]).toBe(
      `Wenn der Streifen ${strip} leuchtet, lass den Knopf los, sobald die Missionsuhr eine ` +
        `${RELEASE_DIGIT[strip]} zeigt.`,
    );
    expect(Number(letGo[4])).toBe(RELEASE_DIGIT[strip]);
    expect(`${letGo[2]}:${letGo[3]}`).toContain(letGo[4]);
  });
});

describe('button: in a run', () => {
  /** Anna (p1) at the button, Ben (p2) at the book. */
  function started(seed: number): GameState {
    return openLab(startedLab(mission, seed));
  }

  const move = (kind: ButtonInput['kind'], at: number): Action => ({
    type: 'puzzle-input',
    playerId: 'p1',
    at,
    input: { kind },
  });

  /** A moment, three tenths into the second, at which the clock reads `sec`. */
  const momentShowing = (state: GameState, sec: number): number =>
    (state.deadlineAt ?? 0) - sec * 1000 + 300;

  /** The button views at the station and at the book, and the edgework, over the wire. */
  function onTheWire(state: GameState) {
    const wire = (playerId: string) =>
      JSON.parse(JSON.stringify(viewFor(state, playerId))) as PlayerView;
    const operator = wire('p1');
    const guide = wire('p2');
    if (operator.puzzle?.kind !== 'button' || guide.puzzle?.kind !== 'button') {
      throw new Error('expected the button in both views');
    }
    const views: Perspectives<ButtonView> = { operator: operator.puzzle, reader: guide.puzzle };
    return { views, edgework: operator.edgework, strip: operator.puzzle.strip };
  }

  /** The first seed whose button the rules say to hold, held at T0 + 2 s. */
  function heldRun(): GameState {
    for (let seed = 0; seed < 50; seed++) {
      const state = started(seed);
      const { views, edgework } = onTheWire(state);
      if (buttonModule.solve(def, views, edgework)[0]?.input.kind === 'hold') {
        return applyAction(state, move('hold', T0 + 2000));
      }
    }
    throw new Error('no seed below 50 holds the button');
  }

  it('is won through the reducer for 100 seeds, letting go on the clock', () => {
    for (let seed = 0; seed < 100; seed++) {
      let state = started(seed);
      const { views, edgework } = onTheWire(state);
      for (const { input } of buttonModule.solve(def, views, edgework)) {
        state = applyAction(state, move(input.kind, T0 + 2000));
      }
      if (state.phase === 'playing') {
        const strip = onTheWire(state).strip ?? 'blau';
        const sec = showing(RELEASE_DIGIT[strip], 590);
        state = applyAction(state, move('release', momentShowing(state, sec)));
      }
      expect(state.phase, `seed ${seed}`).toBe('won');
      expect(state.penaltySeq, `seed ${seed}`).toBe(0);
    }
  });

  it('charges the penalty and springs back on a release at the wrong moment', () => {
    const held = heldRun();
    expect(held.puzzleState).toMatchObject({ type: 'button', holding: true });
    const sec = missing(RELEASE_DIGIT[onTheWire(held).strip ?? 'blau'], 590);
    const late = applyAction(held, move('release', momentShowing(held, sec)));
    expect(late.deadlineAt).toBe((held.deadlineAt ?? 0) - 25_000);
    expect(late.penaltySeq).toBe(1);
    expect(late.events.at(-1)).toMatchObject({
      kind: 'penalty',
      label: 'Knopf zur falschen Zeit losgelassen',
    });
    expect(onTheWire(late).views.operator).toMatchObject({
      holding: false,
      lastResult: 'wrong-time',
    });
  });

  it('never sends the button or the strip to the reader', () => {
    const held = heldRun();
    expect(onTheWire(held).strip).not.toBeNull();
    for (const snapshot of [started(0), held]) {
      expect(JSON.stringify(viewFor(snapshot, 'p2').puzzle)).not.toMatch(/"(colour|label|strip)":"/);
    }
  });

  it('takes the button only from a player standing at it', () => {
    const press: Action = {
      type: 'puzzle-input',
      playerId: 'p2',
      at: T0 + 2000,
      input: { kind: 'press' },
    };
    const away = () => applyAction(started(0), press);
    expect(away).toThrow(GameError);
    expect(away).toThrow('Dafür musst du am Pult stehen.');
  });

  it('cannot be on a map without the edgework sign', () => {
    const blind = JSON.parse(JSON.stringify(mission));
    delete blind.map.edgeworkSign;
    expect(() => parseMission(blind)).toThrow(/"knopf" read the edgework, but there is no edgeworkSign/);
  });
});
