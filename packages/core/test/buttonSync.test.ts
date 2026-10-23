import { describe, expect, it } from 'vitest';
import { generateEdgework } from '../src/index.js';
import type { PuzzleContext, Viewer, ViewContext } from '../src/index.js';
import {
  buttonSyncModule,
  type ButtonSyncDef,
  type ButtonSyncState,
} from '../src/puzzles/buttonSync.js';
import { mulberry32 } from '../src/rng.js';
import { T0 } from './lab.js';

const edgework = generateEdgework(mulberry32(1));

type Look = ButtonSyncDef['style'];

function defOf(windowMs?: number, style: Look = 'button'): ButtonSyncDef {
  const raw = { type: 'button-sync', id: 'sync', title: 'Synchron', style };
  return buttonSyncModule.defSchema.parse(windowMs === undefined ? raw : { ...raw, windowMs });
}

/** The printed blocks of a def: its rules and its example, line by line. */
function printed(def: ButtonSyncDef): { rules: string[]; example: string[] } {
  const blocks = buttonSyncModule.manual(def).flatMap((section) => section.blocks);
  const rules = blocks.find((block) => block.kind === 'rules');
  const example = blocks.find((block) => block.kind === 'example');
  return {
    rules: rules?.kind === 'rules' ? rules.items : [],
    example: example?.kind === 'example' ? example.lines : [],
  };
}

/** „2,5" as printed, in milliseconds. */
const ms = (seconds = ''): number => Number(seconds.replace(',', '.')) * 1000;

function ctx(crew: readonly string[], at: number): PuzzleContext {
  return {
    edgework,
    alarms: 0,
    remainingSec: 600,
    at,
    crew: [...crew],
    console: 'a',
    atConsoles: { a: [], b: [] },
    readers: [],
  };
}

type Result = { state: ButtonSyncState; solved: boolean; penalty: string | null };

/** Presses through `apply`, one after another: by whom and when, with this crew at the panel. */
function play(def: ButtonSyncDef, crew: string[], presses: { by: string; at: number }[]): Result[] {
  let state = buttonSyncModule.init(def, mulberry32(1), ctx(crew, T0));
  return presses.map(({ by, at }) => {
    const result = buttonSyncModule.apply(def, state, { press: true }, by, ctx(crew, at));
    state = result.state;
    return result;
  });
}

/** Matches the lines of a log against their patterns, or fails naming the lines. */
function read(lines: string[], patterns: RegExp[]): RegExpExecArray[] {
  const found = patterns.map((pattern, i) => pattern.exec(lines[i] ?? ''));
  if (found.some((match) => match === null)) {
    throw new Error(`unreadable log: ${JSON.stringify(lines)}`);
  }
  return found as RegExpExecArray[];
}

/** A count of minutes as the log writes it: „einer Minute", „2 Minuten". */
const minutes = (said = ''): number => (said === 'einer' ? 1 : Number(said));

/** What each look's logs say, line by line: without a window, and with one. */
const PATTERNS: Record<Look, { anyPace: RegExp[]; window: RegExp[] }> = {
  button: {
    anyPace: [
      /^00:31 Angemeldet: (\d) Ausweise\.$/,
      new RegExp(
        '^00:31 Druck von Ausweis 1; Ausweis 2 nach (\\d+) Sekunden, Ausweis 3 nach ' +
          '(\\d+|einer) Minuten?\\.$',
      ),
      /^00:32 Alle (\d) Ausweise gedrückt: Schaltung geschlossen\.$/,
    ],
    window: [
      /^00:31 Angemeldet: (\d) Ausweise\.$/,
      /^00:31 Druck von Ausweis 2, ([\d,]+) Sekunden? nach Ausweis 1: Druck 1 verfallen\.$/,
      new RegExp(
        '^00:31 Druck von Ausweis 1, ([\\d,]+) Sekunden? später: beide gelten zugleich, ' +
          'Schaltung geschlossen\\.$',
      ),
    ],
  },
  lever: {
    anyPace: [
      /^00:31 Angemeldet: (\d) Ausweise, \1 Hebel\.$/,
      new RegExp(
        '^00:31 Hebel 1 umgelegt; Hebel 2 nach (\\d+) Sekunden, Hebel 3 nach (\\d+|einer) ' +
          'Minuten?\\.$',
      ),
      /^00:32 Alle (\d) Hebel umgelegt: Hauptschalter geschlossen\.$/,
    ],
    window: [
      /^00:31 Angemeldet: (\d) Ausweise, \1 Hebel\.$/,
      /^00:31 Hebel 2 umgelegt, ([\d,]+) Sekunden? nach Hebel 1: Hebel 1 zurückgesprungen\.$/,
      new RegExp(
        '^00:31 Hebel 1 erneut umgelegt, ([\\d,]+) Sekunden? später: beide liegen zugleich, ' +
          'Hauptschalter geschlossen\\.$',
      ),
    ],
  },
};

const LOOKS = ['button', 'lever'] as const;

describe.each(LOOKS)('button-sync drawn as a %s: the printed log', (look) => {
  it('without a window: every badge once, at any pace, closes the switch', () => {
    const def = defOf(undefined, look);
    const [size, paced, closed] = read(printed(def).example, PATTERNS[look].anyPace);
    expect([Number(size?.[1]), Number(closed?.[1])]).toEqual([3, 3]);
    const results = play(def, ['a', 'b', 'c'], [
      { by: 'a', at: T0 },
      { by: 'b', at: T0 + Number(paced?.[1]) * 1000 },
      { by: 'c', at: T0 + minutes(paced?.[2]) * 60_000 },
    ]);
    expect(results.map((result) => result.solved)).toEqual([false, false, true]);
    expect(results.every((result) => result.penalty === null)).toBe(true);
  });

  const SPANS = [500, 1000, 2000, 2500, 3000];

  it.each(SPANS)('with a %i ms window: a late press opens another one', (span) => {
    const def = defOf(span, look);
    const { rules, example } = printed(def);
    const [size, late, again] = read(example, PATTERNS[look].window);
    expect(Number(size?.[1])).toBe(2);
    const said = String(span / 1000).replace('.', ',');
    expect(rules[0]).toContain(`innerhalb von ${said} ${said === '1' ? 'Sekunde' : 'Sekunden'}`);
    const lateAt = T0 + ms(late?.[1]);
    const [first, second, third] = play(def, ['a', 'b'], [
      { by: 'a', at: T0 },
      { by: 'b', at: lateAt },
      { by: 'a', at: lateAt + ms(again?.[1]) },
    ]);
    // The first press ran out before the second came: only b's is left, a hears of it.
    expect(first?.solved).toBe(false);
    expect(second?.state).toEqual({ type: 'button-sync', pressed: { b: lateAt }, expired: ['a'] });
    expect(third?.solved).toBe(true);
    expect([first, second, third].every((result) => result?.penalty === null)).toBe(true);
  });
});

describe('button-sync: the printed rules', () => {
  it('say „innerhalb von 3 Sekunden" for the tutorial\'s main switch', () => {
    expect(printed(defOf(3000, 'lever')).rules).toEqual([
      'Wenn alle Hebel innerhalb von 3 Sekunden umgelegt sind, schließt der Hauptschalter.',
      'Andernfalls springt jeder Hebel 3 Sekunden nach dem Umlegen zurück und zählt nicht mehr.',
    ]);
  });

  it('count the badges logged into the lab, and say that nothing here costs time', () => {
    for (const look of LOOKS) {
      for (const span of [undefined, 2000]) {
        const text = JSON.stringify(buttonSyncModule.manual(defOf(span, look)));
        expect(text).toContain('im Labor angemeldeten Dienstausweis');
        expect(text).toContain('Die Überwachung meldet hier nichts');
      }
    }
    expect(buttonSyncModule.manual(defOf(undefined, 'lever'))[0]?.heading).toBe(
      'Hauptschalter, Typ HS-3 (Baujahr 1976)',
    );
    expect(buttonSyncModule.manual(defOf())[0]?.heading).toBe(
      'Synchrontaster, Typ ST-2 (Baujahr 1981)',
    );
  });

  it('follow the look and the window, the same for every copy of a def', () => {
    const pages = [undefined, 2000].flatMap((span) =>
      LOOKS.map((look) => JSON.stringify(printed(defOf(span, look)))),
    );
    expect(new Set(pages).size).toBe(4);
    const def = defOf(2000, 'lever');
    expect(buttonSyncModule.manual(structuredClone(def))).toEqual(buttonSyncModule.manual(def));
  });
});

// --- properties ----------------------------------------------------------------

/**
 * The rule as the manual prints it, kept plainly: a player's last press lives
 * `windowMs` — for good without a window — and is dropped the first moment it
 * is older; its owner hears of that until they press again; the station closes
 * once every member of the crew has a live press at the moment one comes in.
 */
interface Model {
  live: Map<string, number>;
  told: Set<string>;
}

function modelAge(model: Model, windowMs: number | undefined, at: number): Model {
  const live = new Map(model.live);
  const told = new Set(model.told);
  for (const [player, time] of model.live) {
    if (windowMs !== undefined && at - time > windowMs) {
      live.delete(player);
      told.add(player);
    }
  }
  return { live, told };
}

function modelPress(model: Model, windowMs: number | undefined, by: string, at: number): Model {
  const aged = modelAge(model, windowMs, at);
  aged.live.set(by, at);
  aged.told.delete(by);
  return aged;
}

/** One step of a run: a press by a member of the crew, or the room's tick. */
type Press = { kind: 'press'; by: string; at: number };
type Step = Press | { kind: 'tick'; at: number };

const isPress = (step: Step): step is Press => step.kind === 'press';

/**
 * A random run at a station: two to four players, and steps apart by nothing,
 * by a moment, by the window give or take a millisecond, or by a long pause.
 */
function scenario(seed: number, windowMs: number | undefined): { crew: string[]; steps: Step[] } {
  const rng = mulberry32(seed);
  const crew = ['a', 'b', 'c', 'd'].slice(0, 2 + Math.floor(rng() * 3));
  const span = windowMs ?? 3000;
  const gaps = [0, 1, 250, span - 1, span, span + 1, 2 * span, 60_000];
  let at = T0;
  const steps: Step[] = [];
  for (let i = 0; i < 4 + Math.floor(rng() * 12); i++) {
    at += gaps[Math.floor(rng() * gaps.length)] ?? 0;
    const by = crew[Math.floor(rng() * crew.length)] ?? 'a';
    steps.push(rng() < 0.75 ? { kind: 'press', by, at } : { kind: 'tick', at });
  }
  return { crew, steps };
}

const viewer = (playerId: string | null): Viewer => ({
  playerId,
  operating: true,
  reading: playerId === null,
  console: playerId === null ? null : 'a',
});

/** What every member of the crew and the audience see, as the model says it. */
function expectViews(def: ButtonSyncDef, state: ButtonSyncState, model: Model, crew: string[]) {
  const viewCtx: ViewContext = { edgework, alarms: 0, crew, operators: crew };
  for (const id of [...crew, null]) {
    const view = buttonSyncModule.view(def, state, viewer(id), viewCtx);
    const own = id === null ? undefined : model.live.get(id);
    const expiresAt = (at: number): number | null =>
      def.windowMs === undefined ? null : at + def.windowMs;
    expect(view).toMatchObject({
      windowMs: def.windowMs ?? null,
      press: own === undefined ? null : { at: own, expiresAt: expiresAt(own) },
      youPressed: own !== undefined,
      partnerPressed: [...model.live.keys()].some((player) => player !== id),
      pressedCount: model.live.size,
      lastResult: id !== null && model.told.has(id) ? 'expired' : null,
    });
  }
}

/** When the model says the next press runs out; null without a window or a press. */
function dueIn(model: Model, windowMs: number | undefined): number | null {
  return model.live.size === 0 || windowMs === undefined
    ? null
    : Math.min(...model.live.values()) + windowMs + 1;
}

/** Where a run through the module and the model side by side stands. */
interface Run {
  state: ButtonSyncState;
  model: Model;
}

/** One step of a run through the module and the model side by side; whether it solved. */
function step(def: ButtonSyncDef, crew: string[], next: Step, run: Run): boolean {
  const { windowMs } = def;
  if (next.kind === 'tick') {
    const aged = buttonSyncModule.expire?.(def, run.state, next.at) ?? run.state;
    const model = modelAge(run.model, windowMs, next.at);
    // Nothing ran out, nothing changed: the very same state comes back.
    expect(aged === run.state).toBe(model.live.size === run.model.live.size);
    Object.assign(run, { state: aged, model });
    return false;
  }
  const at = ctx(crew, next.at);
  const result = buttonSyncModule.apply(def, run.state, { press: true }, next.by, at);
  const model = modelPress(run.model, windowMs, next.by, next.at);
  expect(result.penalty).toBeNull();
  expect(result.solved).toBe(crew.every((member) => model.live.has(member)));
  // The press that came opened the window every live press lies in.
  const oldest = Math.min(...model.live.values());
  expect(windowMs === undefined || next.at - oldest <= windowMs).toBe(true);
  Object.assign(run, { state: result.state, model });
  return result.solved;
}

const SEEDS = 300;

describe.each([
  ['with a window', [500, 1000, 2000, 3000]],
  ['without a window', [undefined]],
] as const)('button-sync %s, over random runs', (_label, windows) => {
  it('keeps to the printed rule at every press and every tick, and never charges a thing', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const windowMs = windows[seed % windows.length];
      const def = defOf(windowMs, LOOKS[seed % 2]);
      const { crew, steps } = scenario(seed, windowMs);
      const run = {
        state: buttonSyncModule.init(def, mulberry32(seed), ctx(crew, T0)),
        model: { live: new Map<string, number>(), told: new Set<string>() },
      };
      for (const next of steps) {
        if (step(def, crew, next, run)) {
          break;
        }
        expect(run.state.pressed).toEqual(Object.fromEntries(run.model.live));
        expect(run.state.expired).toEqual([...run.model.told].sort());
        expectViews(def, run.state, run.model, crew);
        expect(buttonSyncModule.dueAt?.(def, run.state)).toBe(dueIn(run.model, windowMs));
      }
    }
  });

  it('runs a press out exactly at the moment it is due, not a millisecond before', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const windowMs = windows[seed % windows.length];
      const def = defOf(windowMs);
      const { crew, steps } = scenario(seed, windowMs);
      // Fewer presses than the crew has members: the station stays open.
      const state = play(def, crew, steps.filter(isPress).slice(0, crew.length - 1)).at(-1)?.state;
      if (state === undefined) {
        continue;
      }
      const due = buttonSyncModule.dueAt?.(def, state) ?? null;
      expect(due === null).toBe(windowMs === undefined);
      if (due !== null) {
        expect(buttonSyncModule.expire?.(def, state, due - 1)).toBe(state);
        const ran = buttonSyncModule.expire?.(def, state, due);
        expect(Object.keys(ran?.pressed ?? {}).length).toBeLessThan(
          Object.keys(state.pressed).length,
        );
      }
    }
  });
});
