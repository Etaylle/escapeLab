import { describe, expect, it } from 'vitest';
import {
  applyAction,
  GameError,
  generateEdgework,
  initialState,
  parseMission,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, GameState, ManualSection, Mission, PuzzleContext } from '../src/index.js';
import {
  memoryModule,
  type MemoryDef,
  type MemoryPress,
  type MemoryState,
  type MemoryView,
} from '../src/puzzles/memory.js';
import { mulberry32 } from '../src/rng.js';

const SEEDS = 200;
const STAGES = 5;
const T0 = 1_000_000;

const mission: Mission = parseMission({
  id: 'memorytest',
  title: 'Speicher-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  roles: [
    { id: 'pult', name: 'Pult', description: '' },
    { id: 'handbuch', name: 'Handbuch', description: '' },
    { id: 'funk', name: 'Funk', description: '' },
  ],
  puzzles: [
    {
      type: 'memory',
      id: 'bank',
      title: 'Speicherbank',
      prompt: '',
      operatorRoleId: 'pult',
      manualRoleId: 'handbuch',
      penaltySec: 12,
    },
  ],
});

function memoryDef(from: Mission): MemoryDef {
  const def = from.puzzles[0];
  if (def?.type !== 'memory') {
    throw new Error('expected a memory puzzle');
  }
  return def;
}

const def = memoryDef(mission);
const ROLE_IDS = mission.roles.map((role) => role.id);
const ctx: PuzzleContext = {
  edgework: generateEdgework(mulberry32(1)),
  alarms: 0,
  remainingSec: 600,
  at: T0,
};

const init = (seed: number): MemoryState => memoryModule.init(def, mulberry32(seed), ctx);

/** Every role's view of the bank as it would arrive over the wire — never the state. */
function viewsOf(state: MemoryState): Record<string, MemoryView> {
  return Object.fromEntries(
    ROLE_IDS.map((roleId) => [
      roleId,
      JSON.parse(JSON.stringify(memoryModule.view(def, state, roleId, ctx))) as MemoryView,
    ]),
  );
}

/** What the operator reads off the bank. */
function bankOf(views: Record<string, MemoryView>): {
  stage: number;
  display: number;
  labels: number[];
} {
  const bank = views.pult;
  if (bank?.display == null || bank.labels === null) {
    throw new Error('expected the operator to see the bank');
  }
  return { stage: bank.stage, display: bank.display, labels: bank.labels };
}

const layoutOf = (views: Record<string, MemoryView>): string => {
  const bank = bankOf(views);
  return `${bank.display}:${bank.labels.join('')}`;
};

/** A press by the operator, through the input schema as a client's would go. */
const press = (state: MemoryState, position: number) =>
  memoryModule.apply(def, state, memoryModule.inputSchema.parse({ position }), 'pult', ctx);

/** What a careful crew writes down after a press: the position and the label it read there. */
function note(views: Record<string, MemoryView>, position: number): MemoryPress {
  const label = bankOf(views).labels[position];
  if (label === undefined) {
    throw new Error(`no button at position ${position}`);
  }
  return { position, label };
}

/** The solver's move for the crew: exactly one press, by the operator. */
function solverMove(views: Record<string, MemoryView>, log: MemoryPress[]): number {
  const moves = memoryModule.solve(def, views, null, log);
  expect(moves).toHaveLength(1);
  expect(moves[0]?.roleId).toBe('pult');
  return moves[0]?.input.position ?? -1;
}

/** One stage cleared the way a careful crew does it: the right press, then a note. */
function clearStage(state: MemoryState, log: MemoryPress[]): MemoryState {
  const views = viewsOf(state);
  const position = solverMove(views, log);
  const result = press(state, position);
  expect(result.penalty).toBeNull();
  log.push(note(views, position));
  return result.state;
}

const ORDINALS = ['erste', 'zweite', 'dritte', 'vierte'];

/** One printed rule, carried out with the bank in view and the crew's notes at hand. */
function carryOut(rule: string, labels: number[], notes: MemoryPress[]): number {
  const noted = (stage: string | undefined): MemoryPress => {
    const entry = notes[Number(stage) - 1];
    if (entry === undefined) {
      throw new Error(`the rule "${rule}" asks for stage ${stage}, which is not noted`);
    }
    return entry;
  };
  const byPosition = /^die (erste|zweite|dritte|vierte) Taste\.$/.exec(rule);
  if (byPosition !== null) {
    return ORDINALS.indexOf(byPosition[1] ?? '');
  }
  const byLabel = /^die Taste mit der ([1-4])\.$/.exec(rule);
  if (byLabel !== null) {
    return labels.indexOf(Number(byLabel[1]));
  }
  const samePosition = /^dieselbe Position wie in Stufe ([1-5])\.$/.exec(rule);
  if (samePosition !== null) {
    return noted(samePosition[1]).position;
  }
  const sameLabel = /^dieselbe Beschriftung wie in Stufe ([1-5])\.$/.exec(rule);
  if (sameLabel !== null) {
    return labels.indexOf(noted(sameLabel[1]).label);
  }
  throw new Error(`unreadable rule: "${rule}"`);
}

/**
 * A crew with the printed page and nothing else: the list under „Stufe k:",
 * the line for the display digit or else the catch-all, and what it says.
 */
function readManual(
  manual: ManualSection[],
  bank: ReturnType<typeof bankOf>,
  notes: MemoryPress[],
): number {
  const blocks = manual.flatMap((section) => section.blocks);
  const heading = blocks.findIndex((b) => b.kind === 'p' && b.text === `Stufe ${bank.stage}:`);
  const list = blocks[heading + 1];
  if (heading < 0 || list?.kind !== 'rules') {
    throw new Error(`the manual has no rule list for stage ${bank.stage}`);
  }
  const line =
    list.items.find((item) => item.startsWith(`Zeigt das Display ${bank.display}: `)) ??
    list.items.find((item) => item.startsWith('Sonst'));
  if (line === undefined) {
    throw new Error(`stage ${bank.stage} has no line for display ${bank.display}`);
  }
  return carryOut(line.slice(line.indexOf(': ') + 2), bank.labels, notes);
}

describe('memory module', () => {
  it(`is solved from the views and the crew's notes, without an alarm, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      let state = init(seed);
      const log: MemoryPress[] = [];
      for (let stage = 1; stage <= STAGES; stage++) {
        const views = viewsOf(state);
        expect(bankOf(views).stage, `seed ${seed}`).toBe(stage);
        const position = solverMove(views, log);
        for (const wrong of [0, 1, 2, 3].filter((p) => p !== position)) {
          expect(press(state, wrong).penalty, `seed ${seed}, stage ${stage}`).not.toBeNull();
        }
        const result = press(state, position);
        expect(result.penalty, `seed ${seed}, stage ${stage}`).toBeNull();
        expect(result.solved).toBe(stage === STAGES);
        log.push(note(views, position));
        state = result.state;
      }
    }
  });

  it(`is solved by a crew that reads nothing but the printed manual, for ${SEEDS} seeds`, () => {
    const manual = memoryModule.manual(def);
    for (let seed = 0; seed < SEEDS; seed++) {
      let state = init(seed);
      const notes: MemoryPress[] = [];
      for (let stage = 1; stage <= STAGES; stage++) {
        const views = viewsOf(state);
        const position = readManual(manual, bankOf(views), notes);
        const result = press(state, position);
        expect(result.penalty, `seed ${seed}, stage ${stage}`).toBeNull();
        expect(result.solved).toBe(stage === STAGES);
        notes.push(note(views, position));
        state = result.state;
      }
    }
  });

  it('solves stage 1 without notes and refuses any stage the notes do not cover', () => {
    const state = init(3);
    const position = memoryModule.solve(def, viewsOf(state), null)[0]?.input.position ?? -1;
    const result = press(state, position);
    expect(result.penalty).toBeNull();
    expect(() => memoryModule.solve(def, viewsOf(result.state), null)).toThrow(
      /stage 2 needs the crew's notes of the 1 stage\(s\) before it/,
    );
    // Notes left over from before a fall back to stage 1 do not fit either.
    expect(() =>
      memoryModule.solve(def, viewsOf(state), null, [{ position: 0, label: 1 }]),
    ).toThrow(/stage 1 needs/);
    const manualOnly = { handbuch: memoryModule.view(def, state, 'handbuch', ctx) };
    expect(() => memoryModule.solve(def, manualOnly, null)).toThrow(/operator's view/);
  });

  it('falls back to stage 1 on a wrong press, every stage laid out afresh, old notes void', () => {
    // Layouts that came back unchanged: the one pressed wrong, and stages 1–3 on the second run.
    let repeatedAtFall = 0;
    const repeated = [0, 0, 0];
    for (let seed = 0; seed < SEEDS; seed++) {
      let state = init(seed);
      const log: MemoryPress[] = [];
      const before: string[] = [];
      for (let stage = 1; stage < 3; stage++) {
        before.push(layoutOf(viewsOf(state)));
        state = clearStage(state, log);
      }
      const views = viewsOf(state);
      before.push(layoutOf(views));
      const fall = press(state, (solverMove(views, log) + 1) % 4);
      expect(fall.penalty).toBe('Falsche Taste an der Speicherbank');
      expect(fall.solved).toBe(false);
      state = fall.state;
      if (layoutOf(viewsOf(state)) === before[2]) {
        repeatedAtFall += 1;
      }

      const fresh: MemoryPress[] = [];
      for (let stage = 1; stage <= STAGES; stage++) {
        const again = viewsOf(state);
        expect(bankOf(again).stage, `seed ${seed}`).toBe(stage);
        if (stage <= 3 && layoutOf(again) === before[stage - 1]) {
          repeated[stage - 1] = (repeated[stage - 1] ?? 0) + 1;
        }
        const position = solverMove(again, fresh);
        const result = press(state, position);
        expect(result.penalty, `seed ${seed}, stage ${stage} after the fall`).toBeNull();
        expect(result.solved).toBe(stage === STAGES);
        fresh.push(note(again, position));
        state = result.state;
      }
    }
    // 96 layouts per stage: a repeat now and then, never as a rule.
    for (const count of [repeatedAtFall, ...repeated]) {
      expect(count).toBeLessThan(SEEDS / 10);
    }
  });

  it('shows display and buttons to the operator only, and the presses to nobody', () => {
    const log: MemoryPress[] = [];
    const state = clearStage(clearStage(init(5), log), log);
    const views = viewsOf(state);
    const blind = { kind: 'memory', stage: 3, display: null, labels: null };
    expect(views.pult).toEqual({
      kind: 'memory',
      stage: 3,
      display: expect.any(Number),
      labels: expect.any(Array),
    });
    expect([...(views.pult?.labels ?? [])].sort()).toEqual([1, 2, 3, 4]);
    expect(views.handbuch).toEqual(blind);
    expect(views.funk).toEqual(blind);
    expect(memoryModule.view(def, state, null, ctx)).toEqual(blind);
    for (const view of Object.values(views)) {
      const wire = JSON.stringify(view);
      expect(wire).not.toContain('history');
      expect(wire).not.toContain('"position"');
      expect(wire).not.toContain('seed');
    }
  });

  it('lays out every run from its seed: the same seed, the same bank, and no constant', () => {
    expect(init(7)).toEqual(init(7));
    const layouts = new Set<string>();
    const displays = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const views = viewsOf(init(seed));
      layouts.add(layoutOf(views));
      displays.add(bankOf(views).display);
    }
    expect([...displays].sort()).toEqual([1, 2, 3, 4]);
    expect(layouts.size).toBeGreaterThan(60);
  });

  it('takes presses from the operator only', () => {
    const state = init(1);
    expect(() => memoryModule.apply(def, state, { position: 0 }, 'handbuch', ctx)).toThrow(
      GameError,
    );
    expect(() => memoryModule.apply(def, state, { position: 0 }, 'funk', ctx)).toThrow(
      /Speicherbank/,
    );
  });

  it('accepts nothing but a button position', () => {
    expect(memoryModule.inputSchema.safeParse({ position: 0 }).success).toBe(true);
    expect(memoryModule.inputSchema.safeParse({ position: 3 }).success).toBe(true);
    const wrong = [
      { position: 4 },
      { position: -1 },
      { position: 1.5 },
      { position: '1' },
      { position: 1, kind: 'press' },
      {},
      null,
    ];
    for (const input of wrong) {
      expect(memoryModule.inputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });
});

describe('the printed memory manual', () => {
  const manual = memoryModule.manual(def);
  const blocks = manual.flatMap((section) => section.blocks);
  const lists = blocks.flatMap((block) => (block.kind === 'rules' ? [block.items] : []));

  it('has a list per stage, headed „Stufe k:", of four lines ending in the catch-all', () => {
    expect(manual).toHaveLength(1);
    expect(manual[0]?.heading).toBe('Speicherbank');
    expect(lists).toHaveLength(STAGES);
    for (const [i, items] of lists.entries()) {
      const at = blocks.findIndex((block) => block.kind === 'rules' && block.items === items);
      expect(blocks[at - 1]).toEqual({ kind: 'p', text: `Stufe ${i + 1}:` });
      expect(items).toHaveLength(4);
      for (const [d, item] of items.slice(0, 3).entries()) {
        expect(item.startsWith(`Zeigt das Display ${d + 1}: `), item).toBe(true);
      }
      expect(items[3]).toMatch(/^Sonst \(Display 4\): /);
    }
  });

  it('only looks back, and asks for both the position and the label of stages 1–4', () => {
    for (const [i, items] of lists.entries()) {
      for (const item of items) {
        const ref = /Stufe (\d)/.exec(item);
        if (ref !== null) {
          expect(Number(ref[1]), item).toBeLessThan(i + 1);
        }
      }
    }
    const rules = lists.flat().join('\n');
    for (let stage = 1; stage < STAGES; stage++) {
      expect(rules).toContain(`dieselbe Position wie in Stufe ${stage}.`);
      expect(rules).toContain(`dieselbe Beschriftung wie in Stufe ${stage}.`);
    }
  });

  it('prints the same rules for every def; only the penalty is the def’s own', () => {
    expect(memoryModule.manual(structuredClone(def))).toEqual(manual);
    const dearer = memoryModule.manual({ ...def, id: 'andere', penaltySec: 30 });
    expect(JSON.stringify(dearer)).toContain('−30 s');
    expect(dearer.flatMap((s) => s.blocks).filter((b) => b.kind === 'rules')).toEqual(
      blocks.filter((b) => b.kind === 'rules'),
    );
  });
});

describe('the memory bank in a mission', () => {
  const crew = [
    { playerId: 'p1', roleId: 'pult' },
    { playerId: 'p2', roleId: 'handbuch' },
    { playerId: 'p3', roleId: 'funk' },
  ];

  function started(seed = 11): GameState {
    const actions: Action[] = [
      ...crew.map(({ playerId }): Action => ({ type: 'player-join', playerId, name: playerId })),
      ...crew.map(({ playerId, roleId }): Action => ({ type: 'select-role', playerId, roleId })),
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'set-ready', playerId: 'p3', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed },
    ];
    return actions.reduce(applyAction, initialState(mission));
  }

  /** Each role's puzzle view as its client holds it. */
  function wireViews(state: GameState): Record<string, MemoryView> {
    const views: Record<string, MemoryView> = {};
    for (const { playerId, roleId } of crew) {
      const puzzle = viewFor(state, playerId).puzzle;
      if (puzzle?.kind !== 'memory') {
        throw new Error(`expected a memory view for ${playerId}`);
      }
      views[roleId] = JSON.parse(JSON.stringify(puzzle)) as MemoryView;
    }
    return views;
  }

  const pressBy = (playerId: string, position: number, at: number): Action => ({
    type: 'puzzle-input',
    playerId,
    at,
    input: { position },
  });

  /** The crew's next press through the reducer; the note goes into `log`. */
  function crewPress(state: GameState, log: MemoryPress[], at: number): GameState {
    const views = wireViews(state);
    const position = solverMove(views, log);
    log.push(note(views, position));
    return applyAction(state, pressBy('p1', position, at));
  }

  it('is won by a crew that keeps notes; a wrong press costs time and drops all to stage 1', () => {
    let state = started();
    const first: MemoryPress[] = [];
    state = crewPress(crewPress(state, first, T0 + 1000), first, T0 + 2000);
    expect(wireViews(state).handbuch).toMatchObject({
      kind: 'memory',
      stage: 3,
      display: null,
      labels: null,
    });

    const deadline = state.deadlineAt ?? 0;
    const position = solverMove(wireViews(state), first);
    state = applyAction(state, pressBy('p1', (position + 1) % 4, T0 + 3000));
    expect(state.penaltySeq).toBe(1);
    expect(state.deadlineAt).toBe(deadline - 12_000);
    expect(state.events.at(-1)).toMatchObject({
      kind: 'penalty',
      label: 'Falsche Taste an der Speicherbank',
    });
    expect(Object.values(wireViews(state)).map((view) => view.stage)).toEqual([1, 1, 1]);

    const fresh: MemoryPress[] = [];
    for (let stage = 1; stage <= STAGES; stage++) {
      state = crewPress(state, fresh, T0 + 4000 + stage * 1000);
    }
    expect(state.phase).toBe('won');
    expect(state.penaltySeq).toBe(1);
  });

  it('gives the manual to the manual role only and never sends a press out', () => {
    const state = crewPress(started(), [], T0 + 1000);
    expect(viewFor(state, 'p2').puzzle?.manual).toEqual(memoryModule.manual(def));
    expect(viewFor(state, 'p1').puzzle?.manual).toBeNull();
    expect(viewFor(state, 'p3').puzzle?.manual).toBeNull();
    const wire = [
      ...crew.map(({ playerId }) => JSON.stringify(viewFor(state, playerId))),
      JSON.stringify(viewForSpectator(state)),
    ];
    for (const message of wire) {
      expect(message).not.toContain('history');
      expect(message).not.toContain('"position"');
    }
  });

  it('lets only the operator press, and only a button that exists', () => {
    expect(() => applyAction(started(), pressBy('p2', 0, T0 + 1000))).toThrow(/Speicherbank/);
    expect(() => applyAction(started(), pressBy('p1', 4, T0 + 1000))).toThrow(
      /Ungültige Eingabe/,
    );
  });
});
