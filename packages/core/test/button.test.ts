import { describe, expect, it } from 'vitest';
import {
  applyAction,
  GameError,
  generateEdgework,
  indicatorLit,
  initialState,
  parseMission,
  viewFor,
} from '../src/index.js';
import type {
  Action,
  Edgework,
  GameState,
  IndicatorId,
  Mission,
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

const SEEDS = 300;
const T0 = 1_000_000;
const OPERATOR = 'steuerpult';
const MANUAL = 'anleitung';

const raw = {
  id: 'knopftest',
  title: 'Knopf-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  roles: [
    { id: OPERATOR, name: 'Steuerpult', description: '', seesEdgework: true },
    { id: MANUAL, name: 'Anleitung', description: '' },
  ],
  puzzles: [
    {
      type: 'button',
      id: 'knopf',
      title: 'Knopf',
      prompt: '',
      operatorRoleId: OPERATOR,
      manualRoleId: MANUAL,
      penaltySec: 25,
    },
  ],
};
const mission: Mission = parseMission(raw);
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
});

function apply(state: ButtonState, kind: ButtonInput['kind'], lab: Edgework, remainingSec = 600) {
  const input = buttonModule.inputSchema.parse({ kind });
  return buttonModule.apply(def, state, input, OPERATOR, ctx(lab, remainingSec));
}

function viewsOf(state: ButtonState, edgework: Edgework): Record<string, ButtonView> {
  return {
    [OPERATOR]: buttonModule.view(def, state, OPERATOR, { edgework, alarms: 0 }),
    [MANUAL]: buttonModule.view(def, state, MANUAL, { edgework, alarms: 0 }),
  };
}

/** One rolled instance, the way a run sets it up: puzzle and edgework from their own streams. */
function rolled(seed: number): { edgework: Edgework; state: ButtonState } {
  const edgework = generateEdgework(mulberry32(seed + 1));
  return { edgework, state: buttonModule.init(def, mulberry32(seed), ctx(edgework)) };
}

/** The operator's view, which the solver and the oracle read. */
function operatorView(state: ButtonState, edgework: Edgework) {
  const panel = viewsOf(state, edgework)[OPERATOR];
  if (panel?.colour == null || panel.label == null) {
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
      expect(moves, `seed ${seed}`).toEqual([{ roleId: OPERATOR, input: { kind: expected.move } }]);

      const first = apply(state, expected.move, edgework);
      expect(first.penalty, `seed ${seed}`).toBeNull();
      expect(first.solved, `seed ${seed}`).toBe(expected.move === 'press');
      if (first.solved) {
        continue;
      }
      // Held: the views cannot time the release, so the solver waits and the clock decides.
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
      { roleId: OPERATOR, input: { kind: move } },
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

describe('button: inputs, views and solver', () => {
  it('lets only the operator work the button', () => {
    const work = () =>
      buttonModule.apply(def, button('rot', 'HALTEN'), { kind: 'press' }, MANUAL, ctx(lab(0)));
    expect(work).toThrow(GameError);
    expect(work).toThrow(/Rolle am Knopf/);
  });

  it('accepts the three moves and nothing else', () => {
    const ok = (input: unknown) => buttonModule.inputSchema.safeParse(input).success;
    expect(['press', 'hold', 'release'].map((kind) => ok({ kind }))).toEqual([true, true, true]);
    expect(ok({ kind: 'tap' })).toBe(false);
    expect(ok({ kind: 'release', at: 5 })).toBe(false);
    expect(ok({})).toBe(false);
  });

  it('shows the button to the operator alone, and the strip only while it is held', () => {
    const edgework = lab(0);
    const idle = button('gelb', 'START', 'weiß');
    const hidden = { colour: null, label: null, strip: null, lastResult: null };
    const ctxView = { edgework, alarms: 0 };
    expect(viewsOf(idle, edgework)).toEqual({
      [OPERATOR]: { kind: 'button', holding: false, ...hidden, colour: 'gelb', label: 'START' },
      [MANUAL]: { kind: 'button', holding: false, ...hidden },
    });
    const held = viewsOf(apply(idle, 'hold', edgework).state, edgework);
    expect(held[OPERATOR]).toMatchObject({ holding: true, strip: 'weiß' });
    expect(held[MANUAL]).toEqual({ kind: 'button', holding: true, ...hidden });
    expect(buttonModule.view(def, idle, null, ctxView)).toMatchObject(hidden);
    const wrong = viewsOf(apply(idle, 'press', edgework).state, edgework);
    expect(wrong[OPERATOR]).toMatchObject({ holding: false, strip: null, lastResult: 'early' });
    expect(wrong[MANUAL]).toMatchObject({ lastResult: null });
  });

  it('refuses to solve without the edgework or without the operator\'s view', () => {
    const state = button('rot', 'HALTEN');
    expect(() => buttonModule.solve(def, viewsOf(state, lab(0)), null)).toThrow(/no role sees it/);
    const guideOnly = {
      [MANUAL]: buttonModule.view(def, state, MANUAL, { edgework: lab(0), alarms: 0 }),
    };
    expect(() => buttonModule.solve(def, guideOnly, lab(0))).toThrow(/operator's view/);
  });
});

describe('button: manual', () => {
  it('prints both rule lists, each ending in „Sonst"', () => {
    const sections = buttonModule.manual(def);
    expect(sections.map((section) => section.heading)).toEqual(['Der Knopf']);
    const lists = sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === 'rules' ? [block.items] : [])),
    );
    expect(lists).toEqual([
      [
        'Blauer Knopf mit Aufschrift ABBRUCH: halten.',
        'Mehr als eine Notstromzelle und Aufschrift DRÜCKEN: kurz drücken.',
        'Weißer Knopf und Kontrollleuchte CAR leuchtet: halten.',
        'Mehr als zwei Notstromzellen und Kontrollleuchte FRQ leuchtet: kurz drücken.',
        'Gelber Knopf: halten.',
        'Roter Knopf mit Aufschrift HALTEN: kurz drücken.',
        'Sonst: halten.',
      ],
      [
        'Blauer Streifen: loslassen, wenn die Missionsuhr eine 4 zeigt.',
        'Weißer Streifen: loslassen, wenn die Missionsuhr eine 1 zeigt.',
        'Gelber Streifen: loslassen, wenn die Missionsuhr eine 5 zeigt.',
        'Sonst: loslassen, wenn die Missionsuhr eine 1 zeigt.',
      ],
    ]);
    expect(JSON.stringify(sections)).toContain('Alarm, −25 s.');
  });
});

describe('button: in a run', () => {
  function started(seed: number): GameState {
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

  const move = (kind: ButtonInput['kind'], at: number): Action => ({
    type: 'puzzle-input',
    playerId: 'p1',
    at,
    input: { kind },
  });

  /** A moment, three tenths into the second, at which the clock reads `sec`. */
  const momentShowing = (state: GameState, sec: number): number =>
    (state.deadlineAt ?? 0) - sec * 1000 + 300;

  /** Both consoles' button views and the edgework, as they arrive over the wire. */
  function onTheWire(state: GameState) {
    const wire = (playerId: string) =>
      JSON.parse(JSON.stringify(viewFor(state, playerId))) as PlayerView;
    const operator = wire('p1');
    const guide = wire('p2');
    if (operator.puzzle?.kind !== 'button' || guide.puzzle?.kind !== 'button') {
      throw new Error('expected the button on both consoles');
    }
    const views: Record<string, ButtonView> = { [OPERATOR]: operator.puzzle, [MANUAL]: guide.puzzle };
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
    expect(onTheWire(late).views[OPERATOR]).toMatchObject({
      holding: false,
      lastResult: 'wrong-time',
    });
  });

  it('never sends the button or the strip to the manual role', () => {
    const held = heldRun();
    expect(onTheWire(held).strip).not.toBeNull();
    for (const snapshot of [started(0), held]) {
      expect(JSON.stringify(viewFor(snapshot, 'p2').puzzle)).not.toMatch(/"(colour|label|strip)":"/);
    }
  });

  it('cannot be in a mission where nobody sees the edgework', () => {
    const blind = { ...raw, roles: raw.roles.map((role) => ({ ...role, seesEdgework: false })) };
    expect(() => parseMission(blind)).toThrow(/"knopf" read the edgework, but no role sees it/);
  });
});
