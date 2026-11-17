import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FAULT_PICTURE,
  FEEDERS,
  generateEdgework,
  LOAD_PICTURES,
  PULSE_GRACE_MS,
  puzzleDefSchema,
  STARTUP_LOADS,
} from '../src/index.js';
import type { ConsoleId, PuzzleContext, Viewer } from '../src/index.js';
import {
  gapsOf,
  rightValues,
  scriptOf,
  startupModule,
  type StartupDef,
  type StartupInput,
  type StartupState,
  type StartupView,
} from '../src/puzzles/startup.js';
import { GameError } from '../src/errors.js';
import { mulberry32 } from '../src/rng.js';
import { AT_BOOK, AT_CONSOLE_B, AT_STATION, AUDIENCE, ELSEWHERE, T0 } from './lab.js';
import { playInstance } from './solveModule.js';
import { playStartupProbe, STARTUP_SEED, startupPlan, type StartupPlan } from './startupPlan.js';

const SEEDS = 200;

const defOf = (over: Record<string, unknown> = {}): StartupDef =>
  puzzleDefSchema.parse({ type: 'startup', id: 'as', title: 'AS', ...over }) as StartupDef;

const DEF = defOf();
const TRAVEL_MS = DEF.travelSec * 1000;
const WINDOW_MS = DEF.windowSec * 1000;
const EDGEWORK = generateEdgework(mulberry32(3));

/** A move's moment: at `at`, from `console`, with `atConsoles` standing where they stand. */
function ctx(
  at: number,
  console: ConsoleId | null,
  atConsoles: PuzzleContext['atConsoles'] = { a: ['op'], b: ['pt'] },
): PuzzleContext {
  return {
    edgework: EDGEWORK,
    alarms: 0,
    remainingSec: 600,
    at,
    crew: ['op', 'pt', 'rd'],
    console,
    atConsoles: console === null ? { a: [], b: [] } : atConsoles,
    readers: [],
  };
}

const fresh = (def: StartupDef = DEF, seed = 1): StartupState =>
  startupModule.init(def, mulberry32(seed), ctx(T0, null));

const seen = (state: StartupState, viewer: Viewer, def: StartupDef = DEF): StartupView =>
  startupModule.view(def, state, viewer, {
    edgework: EDGEWORK,
    alarms: 0,
    crew: ['op', 'pt', 'rd'],
    operators: ['op', 'pt'],
  });

/** Who works console `side` in these tests: op at a, pt at b. */
const playerAt = (side: ConsoleId): string => (side === 'a' ? 'op' : 'pt');

/** A move from console `side` at `at`. */
function send(state: StartupState, input: StartupInput, side: ConsoleId, at: number, def = DEF) {
  return startupModule.apply(def, state, input, playerAt(side), ctx(at, side));
}

/** The console typing this stage, and the one taking the pulse. */
function sides(state: StartupState): { types: ConsoleId; board: ConsoleId } {
  const types: ConsoleId = state.stage % 2 === 0 ? 'a' : 'b';
  return { types, board: types === 'a' ? 'b' : 'a' };
}

/** Every gap of the stage set to its right value at `at`, from the typing console. */
function setRight(state: StartupState, at: number, def = DEF): StartupState {
  const deal = state.stages[state.stage];
  if (deal === undefined) {
    throw new Error('no stage left');
  }
  const right = rightValues(deal);
  const { types } = sides(state);
  return gapsOf(state.stage).reduce(
    (now, gap) => send(now, { cmd: 'setze', gap, value: right[gap] }, types, at, def).state,
    state,
  );
}

/** The stage's script set right and started at `at`: the pulse is off. */
function sentAt(state: StartupState, at: number, def = DEF): StartupState {
  const set = setRight(state, at, def);
  const result = send(set, { cmd: 'start' }, sides(set).types, at, def);
  expect(result.penalty).toBeNull();
  return result.state;
}

/** The feeder the script of `state`'s stage sends its pulse to. */
const target = (state: StartupState): number => state.values.abgang ?? 0;

/** A feeder other than `feeder`. */
const otherThan = (feeder: number): number => (feeder % FEEDERS) + 1;

const thrown = (run: () => unknown): string => {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(GameError);
    return (err as Error).message;
  }
  throw new Error('the move was not turned away');
};

describe('the deal', () => {
  it('gives every stage a load of its own and a Schaltfeld of four distinct pictures', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      for (const stages of [2, 3]) {
        const state = fresh(defOf({ stages }), seed);
        expect(new Set(state.stages.map((s) => s.load)).size).toBe(stages);
        for (const { load, feeders } of state.stages) {
          expect(feeders).toHaveLength(FEEDERS);
          expect(new Set(feeders.map((lamps) => lamps.join('/'))).size).toBe(FEEDERS);
          expect(feeders.filter((lamps) => lamps.join() === FAULT_PICTURE.join())).toHaveLength(1);
          expect(feeders.some((lamps) => lamps.join() === LOAD_PICTURES[load].join())).toBe(true);
        }
      }
    }
  });

  it('puts the load’s feeder at every place over the seeds', () => {
    const places = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const [first] = fresh(DEF, seed).stages;
      places.add(first === undefined ? 0 : rightValues(first).abgang);
    }
    expect([...places].sort()).toEqual([1, 2, 3, 4]);
  });

  it('draws every load of the table now and then', () => {
    const loads = new Set(
      Array.from({ length: SEEDS }, (_, seed) => fresh(DEF, seed).stages[0]?.load),
    );
    expect([...loads].sort()).toEqual([...STARTUP_LOADS].sort());
  });
});

describe('the script', () => {
  it('has the feeder’s gap in stage 1, the faulty feeder’s before it from stage 2 on', () => {
    expect(gapsOf(0)).toEqual(['abgang']);
    expect(gapsOf(1)).toEqual(['sperre', 'abgang']);
    expect(gapsOf(2)).toEqual(['sperre', 'abgang']);
  });

  it('reads as the lab’s shell, its comments pointing at the table and the Schaltfeld', () => {
    expect(scriptOf(defOf({ stages: 3 }), 1, 'kuehlung')).toEqual([
      { kind: 'comment', text: 'AS-86 Anlaufskript, Stufe 2 von 3' },
      { kind: 'code', text: 'lade anlauf.cfg', comment: null },
      {
        kind: 'gap',
        gap: 'sperre',
        comment: 'gestört: rote Leuchte an Schaltfeld A',
      },
      {
        kind: 'gap',
        gap: 'abgang',
        comment: 'Kühlkreis: Leuchtbild in Tabelle 2, Betriebsbuch',
      },
      {
        kind: 'code',
        text: 'impuls abgang -> A',
        comment: 'Schalter im Fenster der Leiter',
      },
    ]);
  });
});

describe('the views', () => {
  it('show the script at the typing console and the lamps at the other, never both', () => {
    const state = fresh();
    const atA = seen(state, AT_STATION);
    const atB = seen(state, AT_CONSOLE_B);
    expect(atA.role).toBe('terminal');
    expect(atA.board).toBeNull();
    expect(atA.terminal?.gaps).toEqual(['abgang']);
    expect(JSON.stringify(atA)).not.toContain('"lamps"');
    expect(atB.role).toBe('board');
    expect(atB.terminal).toBeNull();
    expect(atB.board?.feeders).toHaveLength(FEEDERS);
    expect(JSON.stringify(atB)).not.toContain('"script"');
    expect(JSON.stringify(atB)).not.toContain('"load"');
  });

  it('swap the sides with the stage', () => {
    const state = sentAt(fresh(), T0);
    const up = send(state, { breaker: target(state) }, 'b', T0 + TRAVEL_MS).state;
    expect(up.stage).toBe(1);
    expect(seen(up, AT_STATION).role).toBe('board');
    expect(seen(up, AT_CONSOLE_B).role).toBe('terminal');
    expect(seen(up, AT_CONSOLE_B).terminal?.gaps).toEqual(['sperre', 'abgang']);
  });

  it('give the book and everybody away from the consoles nothing of the instance', () => {
    const state = sentAt(fresh(), T0);
    for (const viewer of [AT_BOOK, ELSEWHERE]) {
      const view = seen(state, viewer);
      expect(view.terminal).toBeNull();
      expect(view.board).toBeNull();
      expect(view.closed).toBeNull();
      expect(JSON.stringify(view)).not.toContain('sentAt');
    }
  });

  it('show the audience both sides at once', () => {
    const view = seen(fresh(), AUDIENCE);
    expect(view.terminal).not.toBeNull();
    expect(view.board).not.toBeNull();
  });

  it('tell the typing side that a pulse is off, and the Schaltfeld also when it was sent', () => {
    const state = sentAt(fresh(), T0);
    const terminal = seen(state, AT_STATION).terminal;
    expect(terminal?.sent).toBe(true);
    expect(JSON.stringify(terminal)).not.toContain(String(T0));
    expect(seen(state, AT_CONSOLE_B).board?.pulse).toEqual({ sentAt: T0, arrived: false });
  });

  it('give the ladder a step a second, the window’s marked at its top', () => {
    const def = defOf({ travelSec: 8, windowSec: 4 });
    const view = seen(fresh(def), AT_CONSOLE_B, def);
    expect(view.ladder).toEqual({ steps: 12, marked: 4 });
  });
});

describe('the terminal', () => {
  it('takes zeige, setze and start only at the typing console', () => {
    const state = fresh();
    expect(thrown(() => send(state, { cmd: 'zeige' }, 'b', T0))).toBe(
      'Dieses Terminal hat in dieser Stufe kein Skript.',
    );
    expect(send(state, { cmd: 'zeige' }, 'a', T0).state.log.at(-1)?.text).toBe(
      'zeige: Stufe 1, offen: abgang',
    );
  });

  it('refuses a gap the stage’s script does not have', () => {
    expect(thrown(() => send(fresh(), { cmd: 'setze', gap: 'sperre', value: 1 }, 'a', T0))).toBe(
      'Das Skript dieser Stufe hat keine Lücke sperre.',
    );
  });

  it('refuses start with a gap open, without an alarm', () => {
    expect(thrown(() => send(fresh(), { cmd: 'start' }, 'a', T0))).toBe('Lücke abgang ist offen.');
  });

  it('refuses start while nobody stands at the other console’s Schaltfeld', () => {
    const set = setRight(fresh(), T0);
    const alone = () =>
      startupModule.apply(DEF, set, { cmd: 'start' }, 'op', ctx(T0, 'a', { a: ['op'], b: [] }));
    expect(thrown(alone)).toBe('Am Schaltfeld der Gegenseite steht niemand.');
    const self = () =>
      startupModule.apply(DEF, set, { cmd: 'start' }, 'op', ctx(T0, 'a', { a: ['op'], b: ['op'] }));
    expect(thrown(self)).toBe('Am Schaltfeld der Gegenseite steht niemand.');
  });

  it('answers a start with a wrong value with an alarm, no pulse and the values kept', () => {
    const state = fresh();
    const right = target(setRight(state, T0));
    const value = otherThan(right);
    const wrong = send(state, { cmd: 'setze', gap: 'abgang', value }, 'a', T0).state;
    const result = send(wrong, { cmd: 'start' }, 'a', T0);
    expect(result.penalty).toBe('Anlaufsteuerung: Skript passt nicht');
    expect(result.state.pulse).toBeNull();
    expect(result.state.values.abgang).toBe(otherThan(right));
    expect(result.state.log.at(-1)).toEqual(
      expect.objectContaining({
        tag: 'fail',
        text: 'Anlauf verweigert: ein Wert passt nicht zu Schaltfeld B',
      }),
    );
  });

  it('takes no input from away from the consoles', () => {
    const away = () => startupModule.apply(DEF, fresh(), { cmd: 'zeige' }, 'rd', ctx(T0, null));
    expect(thrown(away)).toBe('Eingabe nur am Pult.');
  });

  it('counts a wrong sperre as a wrong value too', () => {
    const state = sentAt(fresh(), T0);
    const up = send(state, { breaker: target(state) }, 'b', T0 + TRAVEL_MS).state;
    const set = setRight(up, T0 + 10_000);
    const value = otherThan(set.values.sperre ?? 1);
    const wrong = send(set, { cmd: 'setze', gap: 'sperre', value }, 'b', T0 + 10_000);
    expect(send(wrong.state, { cmd: 'start' }, 'b', T0 + 10_000).penalty).toBe(
      'Anlaufsteuerung: Skript passt nicht',
    );
  });

  it('locks the script while a pulse is on its way, zeige aside', () => {
    const state = sentAt(fresh(), T0);
    expect(thrown(() => send(state, { cmd: 'setze', gap: 'abgang', value: 1 }, 'a', T0 + 1))).toBe(
      'Ein Impuls ist unterwegs; das Skript ist gesperrt.',
    );
    expect(thrown(() => send(state, { cmd: 'start' }, 'a', T0 + 1))).toBe(
      'Ein Impuls ist unterwegs; das Skript ist gesperrt.',
    );
    expect(send(state, { cmd: 'zeige' }, 'a', T0 + 1).penalty).toBeNull();
  });
});

describe('a start refused', () => {
  it('turns the same refused values away without another alarm, takes new ones', () => {
    const state = fresh();
    const right = target(setRight(state, T0));
    const set = (s: StartupState, value: number) =>
      send(s, { cmd: 'setze', gap: 'abgang', value }, 'a', T0).state;
    const first = send(set(state, otherThan(right)), { cmd: 'start' }, 'a', T0);
    expect(first.penalty).not.toBeNull();
    expect(thrown(() => send(first.state, { cmd: 'start' }, 'a', T0 + 1000))).toBe(
      'Werte unverändert: Das Skript passt nicht zum Schaltfeld der Gegenseite.',
    );
    // Another wrong value is another try: an alarm again.
    const other = [1, 2, 3, 4].find((v) => v !== right && v !== otherThan(right)) ?? 1;
    const second = send(set(first.state, other), { cmd: 'start' }, 'a', T0 + 2000);
    expect(second.penalty).toBe('Anlaufsteuerung: Skript passt nicht');
    const fixed = send(set(first.state, right), { cmd: 'start' }, 'a', T0 + 2000);
    expect(fixed.penalty).toBeNull();
    expect(fixed.state.refused).toBeNull();
  });

  it('takes a change of one value of two as a new try, an alarm again', () => {
    // Stage 2: sperre and abgang, both wrong, refused; then sperre right, abgang still wrong.
    const first = sentAt(fresh(), T0);
    const up = send(first, { breaker: target(first) }, 'b', T0 + TRAVEL_MS).state;
    const right = rightValues(up.stages[1] ?? fail());
    const set = (s: StartupState, gap: 'sperre' | 'abgang', value: number) =>
      send(s, { cmd: 'setze', gap, value }, 'b', T0 + 10_000).state;
    const halfWrong = set(up, 'sperre', otherThan(right.sperre));
    const wrong = set(halfWrong, 'abgang', otherThan(right.abgang));
    const refused = send(wrong, { cmd: 'start' }, 'b', T0 + 10_000);
    expect(refused.penalty).not.toBeNull();
    const half = set(refused.state, 'sperre', right.sperre);
    expect(send(half, { cmd: 'start' }, 'b', T0 + 11_000).penalty).toBe(
      'Anlaufsteuerung: Skript passt nicht',
    );
  });
});

describe('the window', () => {
  // Sent before each test, not as the file is collected: a broken deal fails a test, not the file.
  let state: StartupState;
  let feeder: number;
  beforeEach(() => {
    state = sentAt(fresh(), T0);
    feeder = target(state);
  });
  const arrives = T0 + TRAVEL_MS;
  const dies = arrives + WINDOW_MS;

  it('drops the pulse for the right breaker a millisecond early, without an alarm', () => {
    const result = send(state, { breaker: feeder }, 'b', arrives - 1);
    expect(result.penalty).toBeNull();
    expect(result.state.pulse).toBeNull();
    expect(result.state.stage).toBe(0);
    expect(result.state.last).toBe('verworfen');
  });

  it('runs the stage up on the window’s first and last millisecond', () => {
    for (const at of [arrives, dies - 1]) {
      const result = send(state, { breaker: feeder }, 'b', at);
      expect(result.penalty, String(at - arrives)).toBeNull();
      expect(result.state.stage).toBe(1);
      expect(result.state.closed).toEqual([{ console: 'b', feeder }]);
      expect(result.state.last).toBe('angelaufen');
    }
  });

  it('still takes the right breaker in the grace after the window, a wrong one as a fault', () => {
    for (const at of [dies, dies + PULSE_GRACE_MS - 1]) {
      expect(send(state, { breaker: feeder }, 'b', at).state.stage, String(at - dies)).toBe(1);
    }
    const wrong = send(state, { breaker: otherThan(feeder) }, 'b', dies + 100);
    expect(wrong.penalty).toBe('Anlaufsteuerung: falscher Leistungsschalter');
  });

  it('lets the pulse die once the grace is over: no alarm, and nothing left to close on', () => {
    const late = () => send(state, { breaker: feeder }, 'b', dies + PULSE_GRACE_MS);
    expect(thrown(late)).toBe('Kein Impuls auf der Leitung.');
    expect(startupModule.expire?.(DEF, state, dies + PULSE_GRACE_MS - 1)?.pulse).not.toBeNull();
    const aged = startupModule.expire?.(DEF, state, dies + PULSE_GRACE_MS);
    expect(aged?.pulse).toBeNull();
    expect(aged?.last).toBe('verfallen');
    expect(aged?.log.at(-1)?.text).toBe('Impuls verfallen');
  });

  it('kills the pulse with an alarm for a wrong breaker, early or in time', () => {
    for (const at of [T0 + 1, arrives]) {
      const result = send(state, { breaker: otherThan(feeder) }, 'b', at);
      expect(result.penalty).toBe('Anlaufsteuerung: falscher Leistungsschalter');
      expect(result.state.pulse).toBeNull();
      expect(result.state.last).toBe('falsch');
    }
  });

  it('takes a breaker only at the Schaltfeld taking the pulse, with a pulse on the way', () => {
    expect(thrown(() => send(state, { breaker: feeder }, 'a', arrives))).toBe(
      'Dieses Schaltfeld ist in dieser Stufe nicht aufgeschaltet.',
    );
    const none = () => send(fresh(), { breaker: 1 }, 'b', T0);
    expect(thrown(none)).toBe('Kein Impuls auf der Leitung.');
  });

  it('is due as the pulse arrives, then as it dies, and marks its arrival on the clock', () => {
    expect(startupModule.dueAt?.(DEF, fresh())).toBeNull();
    expect(startupModule.dueAt?.(DEF, state)).toBe(arrives);
    expect(startupModule.expire?.(DEF, state, arrives - 1)).toBe(state);
    const arrived = startupModule.expire?.(DEF, state, arrives);
    expect(arrived?.pulse).toEqual({ sentAt: T0, arrived: true });
    const due = arrived === undefined ? null : startupModule.dueAt?.(DEF, arrived);
    expect(due).toBe(dies + PULSE_GRACE_MS);
  });

  it('is solved once the last stage runs up', () => {
    let now = state;
    let at = arrives;
    for (let stage = 0; stage < DEF.stages; stage++) {
      const result = send(now, { breaker: target(now) }, sides(now).board, at);
      expect(result.solved).toBe(stage === DEF.stages - 1);
      now = result.state;
      at += 20_000;
      if (!result.solved) {
        now = sentAt(now, at);
        at += TRAVEL_MS;
      }
    }
  });
});

describe('solving', () => {
  const variants = [
    {},
    { stages: 3 },
    { travelSec: 4, windowSec: 2 },
    { travelSec: 10, windowSec: 5 },
  ];

  it.each(variants)('solves %o from both consoles’ views alarm-free, for 200 seeds', (over) => {
    const def = defOf(over);
    for (let seed = 0; seed < SEEDS; seed++) {
      expect(playInstance(def, seed)).toBe(def.stages === 3 ? 11 : 7);
    }
  });

  it('earns a crew that ignores the book an alarm in most seeds', () => {
    // A crew without Tabelle 2 sets the first feeder that is not red, the faulty one right.
    let alarms = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      let state = fresh(DEF, seed);
      for (let stage = 0; stage < DEF.stages && state.closed.length === stage; stage++) {
        const deal = state.stages[state.stage];
        const guess = (deal?.feeders.findIndex((lamps) => lamps[0] !== 'rot') ?? 0) + 1;
        const { types, board } = sides(state);
        const at = T0 + stage * 60_000;
        const right = deal === undefined ? null : rightValues(deal);
        const valueOf = (gap: string): number => (gap === 'sperre' ? (right?.sperre ?? 1) : guess);
        state = gapsOf(state.stage).reduce(
          (now, gap) => send(now, { cmd: 'setze', gap, value: valueOf(gap) }, types, at).state,
          state,
        );
        const result = send(state, { cmd: 'start' }, types, at);
        if (result.penalty !== null) {
          alarms += 1;
          break;
        }
        state = send(result.state, { breaker: guess }, board, at + TRAVEL_MS).state;
      }
    }
    expect(alarms / SEEDS).toBeGreaterThan(0.6);
  });
});

describe('the probe', () => {
  const file = new URL('../../../tools/fixtures/startup-plan.json', import.meta.url);

  it('is the plan the harness carries, the solver’s own', () => {
    const carried = JSON.parse(readFileSync(file, 'utf8')) as StartupPlan;
    expect(carried).toEqual(startupPlan());
    expect(carried.seed).toBe(STARTUP_SEED);
    expect(carried.stages.map((stage) => stage.types)).toEqual(['a', 'b']);
  });

  it('is won through the reducer without an alarm, a pulse in the duct on the way', () => {
    const { state } = playStartupProbe();
    expect(state.currentPuzzleIndex).toBe(1);
    expect(state.penaltySeq).toBe(0);
  });
});

function fail(): never {
  throw new Error('no such stage');
}
