import { describe, expect, it } from 'vitest';
import {
  applyAction,
  generateEdgework,
  initialState,
  parseMission,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type {
  Action,
  GameState,
  ManualSection,
  Mission,
  PlayerView,
  PuzzleContext,
  RelayView,
} from '../src/index.js';
import { mulberry32 } from '../src/rng.js';
import {
  CONTROL_NAMES,
  RELAY_MAX_PLAYERS,
  relayDefFor,
  relayModule,
  type RelayDef,
  type RelayState,
} from '../src/puzzles/relay.js';

const SEEDS = 200;
const T0 = 1_000_000;
const ALARM_AT = T0 + 1000;
const NAMES = ['Anna', 'Ben', 'Cleo', 'Dana', 'Emil', 'Fritz', 'Gina'];

type Control = RelayView['controls'][number];
type PuzzleInput = Extract<Action, { type: 'puzzle-input' }>;

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${what}`);
  }
  return value;
}

/** A corridor lab whose emergencies run in relay mode, for up to `crew` players. */
function relayMission(crew: number, sabotage: Record<string, unknown> = {}): Mission {
  return parseMission({
    id: 'relaytest',
    title: 'Relais-Test',
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 900,
    players: { min: Math.min(crew, 4), max: crew },
    puzzles: [{ type: 'button-sync', id: 'first', title: 'Erstes' }],
    map: {
      tiles: ['##########', '#........#', '#........#', '##########'],
      spawns: Array.from({ length: crew }, (_, i) => ({ x: 1 + i, y: 1 })),
      stations: [{ puzzleId: 'first', x: 8, y: 2 }],
      sabotage: {
        mode: 'relay',
        label: 'STEUERUNG SPINNT',
        hint: 'Anweisungen laut vorlesen!',
        durationSec: 45,
        penaltySec: 60,
        ...sabotage,
      },
    },
  });
}

/** The largest crew a run of the mission starts with: p0, p1, … named Anna, Ben, … */
function crewOf(mission: Mission): { id: string; name: string }[] {
  return Array.from({ length: mission.players.max }, (_, i) => ({
    id: `p${i}`,
    name: NAMES[i] ?? `p${i}`,
  }));
}

function defOf(mission: Mission): RelayDef {
  return relayDefFor(crewOf(mission), must(mission.map?.sabotage, 'a sabotage block'));
}

// --- the module on its own ---------------------------------------------------------

const edgework = generateEdgework(mulberry32(99));
const ctx = (at: number): PuzzleContext => ({
  edgework,
  alarms: 0,
  remainingSec: 600,
  at,
  crew: [],
  console: null,
});

function viewsOf(def: RelayDef, state: RelayState): Record<string, RelayView> {
  const viewCtx = { edgework, alarms: 0, crew: [] };
  return Object.fromEntries(
    def.players.map((player) => [player.id, relayModule.view(def, state, player.id, viewCtx)]),
  );
}

/**
 * A perfect crew at the consoles: every round the solver reads the players'
 * views — never the state — and each of its moves goes through the input
 * schema and `apply`, a second after the round before.
 */
function drill(def: RelayDef, seed: number): { state: RelayState; moves: number } {
  let state = relayModule.init(def, mulberry32(seed), ctx(T0));
  let moves = 0;
  for (let round = 1; round <= def.required; round++) {
    for (const { playerId, input } of relayModule.solve(def, viewsOf(def, state), null)) {
      moves += 1;
      const parsed = relayModule.inputSchema.parse(input);
      const result = relayModule.apply(def, state, parsed, playerId, ctx(T0 + round * 1000));
      if (result.penalty !== null) {
        throw new Error(`seed ${seed}: alarm "${result.penalty}" on ${JSON.stringify(input)}`);
      }
      state = result.state;
      if (result.solved) {
        return { state, moves };
      }
    }
  }
  throw new Error(`seed ${seed}: not cleared within ${def.required} rounds`);
}

describe.each([2, 3, 4, RELAY_MAX_PLAYERS])('relay emergency for %i players', (crew) => {
  const def = defOf(relayMission(crew));

  it(`is cleared from the players' views in exactly "required" moves, ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { state, moves } = drill(def, seed);
      expect(moves, `seed ${seed}`).toBe(def.required);
      expect(state.missed, `seed ${seed}`).toBe(0);
    }
  });

  it('gives every player four controls and an instruction for a free control elsewhere', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const views = viewsOf(def, relayModule.init(def, mulberry32(seed), ctx(T0)));
      const owner = new Map<string, { playerId: string; control: Control }>();
      for (const player of def.players) {
        const controls = must(views[player.id], 'a view').controls;
        expect(controls).toHaveLength(4);
        expect(new Set(controls.map((c) => c.kind))).toEqual(new Set(['switch', 'dial', 'button']));
        controls.forEach((control) => owner.set(control.name, { playerId: player.id, control }));
      }
      expect(owner.size, 'every name once').toBe(4 * def.players.length);
      const targets = new Set<string>();
      for (const player of def.players) {
        const wanted = must(views[player.id]?.instruction, 'an instruction');
        const target = must(owner.get(wanted.control), `a console with ${wanted.control}`);
        expect(target.playerId, 'never your own console').not.toBe(player.id);
        expect(def.players.find((p) => p.id === target.playerId)?.name).toBe(wanted.playerName);
        expect(wanted.value, 'something the control does not show').not.toBe(target.control.value);
        expect(wanted.value === 'press').toBe(target.control.kind === 'button');
        targets.add(wanted.control);
      }
      expect(targets.size, 'no two instructions for one control').toBe(def.players.length);
    }
  });

  it('lets nobody see another console but the one control their instruction names', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const views = viewsOf(def, relayModule.init(def, mulberry32(seed), ctx(T0)));
      for (const player of def.players) {
        const view = must(views[player.id], 'a view');
        const wire = JSON.stringify(view);
        const foreign = def.players
          .filter((other) => other.id !== player.id)
          .flatMap((other) => must(views[other.id], 'a view').controls)
          .filter((control) => control.name !== view.instruction?.control);
        for (const control of foreign) {
          const seen = `seed ${seed}: ${player.id} sees ${control.name}`;
          expect(wire, seen).not.toContain(control.name);
        }
      }
    }
  });
});

describe('relay moves', () => {
  const def = defOf(relayMission(2));

  it('does not count the right control at the wrong level', () => {
    const found = Array.from({ length: SEEDS }, (_, seed) => {
      const state = relayModule.init(def, mulberry32(seed), ctx(T0));
      const views = viewsOf(def, state);
      const wanted = must(views['p0']?.instruction, 'an instruction');
      const target = views['p1']?.controls.find((c) => c.name === wanted.control);
      return { state, wanted, target };
    }).find(({ target }) => target?.kind === 'dial');
    const { state, wanted, target } = must(found, 'an instruction for a dial');
    const dial = must(target, 'a dial');
    const level = must(
      [1, 2, 3, 4, 5].find((l) => l !== wanted.value && l !== dial.value),
      'a wrong level',
    );
    const result = relayModule.apply(
      def,
      state,
      { kind: 'set', control: dial.id, value: level },
      'p1',
      ctx(T0 + 1000),
    );
    expect(result).toMatchObject({ solved: false, penalty: null });
    expect(result.state.completed).toBe(0);
    const after = viewsOf(def, result.state);
    expect(after['p0']?.instruction).toEqual(wanted);
    expect(after['p1']?.controls.find((c) => c.id === dial.id)?.value).toBe(level);
  });

  it('rolls the same consoles for the same stream and other ones otherwise', () => {
    const first = relayModule.init(def, mulberry32(7), ctx(T0));
    expect(relayModule.init(def, mulberry32(7), ctx(T0))).toEqual(first);
    expect(relayModule.init(def, mulberry32(8), ctx(T0)).controls).not.toEqual(first.controls);
  });
});

describe('the relay drill', () => {
  const def = defOf(relayMission(2));

  it('prints the same for every run, with numbered rules that end in a catch-all', () => {
    const manual = relayModule.manual(def);
    expect(relayModule.manual(structuredClone(def))).toEqual(manual);
    expect(manual.map((section) => section.heading)).toEqual(['Notfall-Relais']);
    const rules = manual[0]?.blocks.find((block) => block.kind === 'rules');
    expect(rules?.kind === 'rules' ? rules.items.at(-1) : null).toMatch(/^Andernfalls /);
    expect(JSON.stringify(manual)).toContain('12 Sekunden');
    expect(JSON.stringify(manual)).toContain('6 ausgeführte Anweisungen');
    expect(manual[0]?.blocks.at(-1)).toEqual({
      kind: 'p',
      text: 'Notfallzeit abgelaufen, bevor 6 Anweisungen ausgeführt sind: Alarm, −60 s.',
    });
  });

  it('prints an example that the consoles bear out', () => {
    const blocks = relayModule.manual(def)[0]?.blocks ?? [];
    const example = blocks.find((block) => block.kind === 'example');
    const rules = blocks.find((block) => block.kind === 'rules');
    const lines = example?.kind === 'example' ? example.lines : [];
    const [shown, sits, done] = [
      /^(\S+)s Pult zeigt: Pult (\S+), „(.+) auf (\d)“\.$/,
      /^Der (.+) sitzt an (\S+)s Pult: Für (\S+) gilt Regel (\d), für (\S+) Regel (\d)\.$/,
      /^(\S+) stellt den (.+) auf (\d); die Anweisung zählt, (\S+)s Pult zeigt die nächste\.$/,
    ].map((pattern, i) => pattern.exec(lines[i] ?? ''));
    const holder = def.players.find((player) => player.name === shown?.[1]);
    const owner = def.players.find((player) => player.name === shown?.[2]);
    if (!shown || !sits || !done || !holder || !owner || rules?.kind !== 'rules') {
      throw new Error(`unreadable example: ${JSON.stringify(lines)}`);
    }
    const [name, level] = [shown[3] ?? '', Number(shown[4])];
    // Line 2 names the dial, its owner and both players; line 3 the owner setting it.
    expect([...sits.slice(1, 4), sits[5]]).toEqual([name, owner.name, holder.name, owner.name]);
    expect(done.slice(1, 5)).toEqual([owner.name, name, String(level), holder.name]);
    // The holder's rule is the one for another console's element, the owner's for its own.
    expect(rules.items[Number(sits[4]) - 1]).toMatch(/ein Element eines anderen Pults nennt/);
    expect(rules.items[Number(sits[6]) - 1]).toMatch(/ein Element dieses Pults nennt/);
    // A dial of that name on the owner's console, set elsewhere; the holder asks for the level.
    const base = relayModule.init(def, mulberry32(1), ctx(T0));
    const setting = { kind: 'dial' as const, value: 1 };
    const dial = { id: 'kx', ownerId: owner.id, name, setting };
    const state: RelayState = {
      ...base,
      controls: [...base.controls.filter((c) => c.name !== name), dial],
      instructions: base.instructions.map((i) =>
        i.holderId === holder.id ? { ...i, controlId: dial.id, value: level } : i,
      ),
    };
    expect(level).not.toBe(dial.setting.value);
    const before = viewsOf(def, state);
    expect(before[holder.id]?.instruction).toMatchObject({ playerName: owner.name, control: name });
    expect(before[owner.id]?.controls.map((control) => control.name)).toContain(name);
    const set = { kind: 'set' as const, control: dial.id, value: level };
    expect(() => relayModule.apply(def, state, set, holder.id, ctx(T0 + 1000))).toThrow(
      /anderen Pult/,
    );
    const after = relayModule.apply(def, state, set, owner.id, ctx(T0 + 1000));
    expect(after).toMatchObject({ penalty: null, state: { completed: base.completed + 1 } });
    expect(viewsOf(def, after.state)[holder.id]?.instruction).not.toEqual(
      before[holder.id]?.instruction,
    );
  });

  it('draws the control names from a pool of sixteen or more, all different', () => {
    expect(CONTROL_NAMES.length).toBeGreaterThanOrEqual(16);
    expect(new Set(CONTROL_NAMES).size).toBe(CONTROL_NAMES.length);
  });
});

// --- the emergency in the game -------------------------------------------------------

function started(mission: Mission, seed = 1): GameState {
  const crew = crewOf(mission);
  const actions: Action[] = [
    ...crew.map(({ id, name }): Action => ({ type: 'player-join', playerId: id, name })),
    ...crew.slice(1).map(({ id }): Action => ({ type: 'set-ready', playerId: id, ready: true })),
    { type: 'start-mission', playerId: 'p0', at: T0, seed },
  ];
  return actions.reduce(applyAction, initialState(mission));
}

function alarmed(mission: Mission, seed = 1): GameState {
  return applyAction(started(mission, seed), { type: 'sabotage-start', at: ALARM_AT });
}

/** What a client holds: its relay view as it arrives over the wire. */
function relayOf(state: GameState, playerId: string): RelayView & { manual: ManualSection[] } {
  const view = JSON.parse(JSON.stringify(viewFor(state, playerId))) as PlayerView;
  return must(view.map?.sabotage?.relay, `a relay view for ${playerId}`);
}

function emergencyOf(state: GameState): RelayState {
  return must(state.sabotage?.emergency, 'a running relay emergency');
}

/** The crew's answers to what its views show right now, as puzzle-inputs at `at`. */
function answers(mission: Mission, state: GameState, at: number): PuzzleInput[] {
  const views = Object.fromEntries(crewOf(mission).map(({ id }) => [id, relayOf(state, id)]));
  return relayModule.solve(defOf(mission), views, null).map(({ playerId, input }) => ({
    type: 'puzzle-input',
    playerId,
    at,
    input,
  }));
}

function changeOf(control: Control): boolean | number | 'press' {
  switch (control.kind) {
    case 'switch':
      return !control.value;
    case 'dial':
      return (control.value % 5) + 1;
    case 'button':
      return 'press';
  }
}

describe('a relay emergency in the game', () => {
  const mission = relayMission(2);
  const def = defOf(mission);
  const input = (playerId: string, at: number, value: unknown): PuzzleInput => ({
    type: 'puzzle-input',
    playerId,
    at,
    input: value,
  });

  it('drops the station, uses no panels and hands every player a console and the drill', () => {
    const state = alarmed(mission);
    expect(state.puzzleState).toBeNull();
    expect(state.sabotage?.endsAt).toBe(ALARM_AT + 45_000);
    for (const { id: playerId } of crewOf(mission)) {
      const sabotage = viewFor(state, playerId).map?.sabotage;
      expect(sabotage?.panels).toEqual([]);
      const relay = relayOf(state, playerId);
      expect(relay.controls).toHaveLength(4);
      expect(relay.instruction?.expiresAt).toBe(ALARM_AT + 12_000);
      expect(relay).toMatchObject({ completed: 0, required: 6, windowSec: 12 });
      expect(relay.endsAt).toBe(ALARM_AT + 45_000);
      expect(relay.manual).toEqual(relayModule.manual(def));
    }
  });

  it(`is cleared by puzzle-inputs from the views alone, no alarm, ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      let state = alarmed(mission, seed);
      const deadline = state.deadlineAt;
      let inputs = 0;
      for (let round = 1; state.sabotage !== null && round <= def.required; round++) {
        for (const action of answers(mission, state, ALARM_AT + round * 1000)) {
          if (state.sabotage !== null) {
            inputs += 1;
            state = applyAction(state, action);
          }
        }
      }
      expect(state.sabotage, `seed ${seed}`).toBeNull();
      expect(inputs, `seed ${seed}`).toBe(def.required);
      expect(state.penaltySeq, `seed ${seed}`).toBe(0);
      expect(state.deadlineAt, `seed ${seed}`).toBe(deadline);
      expect(state.events.at(-1)?.label).toBe('Notfall behoben');
    }
  });

  it('replaces an instruction that ran out and counts it as a miss, without an alarm', () => {
    let state = alarmed(mission);
    // Anna does Ben's instruction at once, so only Anna's own is left to run out.
    const forBen = answers(mission, state, ALARM_AT + 4000).find((a) => a.playerId === 'p0');
    state = applyAction(state, must(forBen, 'an answer from p0'));
    expect(relayOf(state, 'p0').instruction?.expiresAt).toBe(ALARM_AT + 12_000);
    expect(applyAction(state, { type: 'sabotage-tick', at: ALARM_AT + 11_999 })).toBe(state);

    state = applyAction(state, { type: 'sabotage-tick', at: ALARM_AT + 12_000 });
    expect(relayOf(state, 'p0').instruction?.expiresAt).toBe(ALARM_AT + 24_000);
    expect(relayOf(state, 'p1').instruction?.expiresAt).toBe(ALARM_AT + 16_000);
    expect(emergencyOf(state)).toMatchObject({ completed: 1, missed: 1 });
    expect(state.penaltySeq).toBe(0);
  });

  it('still charges the expiry penalty when too few were done in time', () => {
    const state = alarmed(mission);
    const before = state.deadlineAt ?? 0;
    const expired = applyAction(state, { type: 'sabotage-expired', at: ALARM_AT + 45_000 });
    expect(expired.sabotage).toBeNull();
    expect(expired.deadlineAt).toBe(before - 60_000);
    expect(expired.penaltySeq).toBe(1);
    expect(expired.events.at(-1)?.label).toBe('Notfall nicht rechtzeitig behoben');
    expect(expired.phase).toBe('playing');
  });

  it('is not cleared by a valves signal, only by its instructions', () => {
    const state = alarmed(mission);
    expect(applyAction(state, { type: 'sabotage-cleared', at: ALARM_AT + 2000 })).toBe(state);
  });

  it('lets only the owner work a control; a move nobody asked for changes nothing else', () => {
    const state = alarmed(mission);
    const anna = relayOf(state, 'p0');
    const ben = relayOf(state, 'p1');
    const foreign = must(ben.controls[0], 'a control');
    const reach = { kind: 'set', control: foreign.id, value: changeOf(foreign) };
    expect(() => applyAction(state, input('p0', ALARM_AT + 2000, reach))).toThrow(/anderen Pult/);

    const idle = must(
      ben.controls.find((c) => c.name !== anna.instruction?.control),
      'a control nobody asked for',
    );
    const value = changeOf(idle);
    const moved = applyAction(
      state,
      input('p1', ALARM_AT + 2000, { kind: 'set', control: idle.id, value }),
    );
    expect(emergencyOf(moved)).toMatchObject({ completed: 0, missed: 0 });
    expect(moved.penaltySeq).toBe(0);
    expect(relayOf(moved, 'p0').instruction).toEqual(anna.instruction);
    const after = relayOf(moved, 'p1').controls.find((c) => c.id === idle.id);
    expect(after?.value).toBe(idle.kind === 'button' ? null : value);
  });

  it('turns away input that does not fit the control or the schema', () => {
    const state = alarmed(mission);
    const ben = relayOf(state, 'p1');
    const move = (value: unknown) => () => applyAction(state, input('p1', ALARM_AT + 2000, value));
    const control = must(ben.controls[0], 'a control');
    const misfit = control.kind === 'switch' ? 3 : control.kind === 'dial' ? true : 2;
    expect(move({ kind: 'set', control: control.id, value: misfit })).toThrow(/Ungültige Eingabe/);
    expect(move({ kind: 'set', control: control.id, value: 6 })).toThrow(/Ungültige Eingabe/);
    expect(move({ control: control.id, value: 'press' })).toThrow(/Ungültige Eingabe/);
    expect(move({ kind: 'set', control: control.id, value: 1, x: 1 })).toThrow(/Ungültige Eingabe/);
    expect(move({ kind: 'set', control: 'k99', value: 'press' })).toThrow(/gibt es nicht/);
  });

  it('stands still over a pause: every clock in it moves on by the time frozen', () => {
    let state = alarmed(mission);
    const before = emergencyOf(state);
    state = applyAction(state, { type: 'set-paused', paused: true, at: ALARM_AT + 2000 });
    expect(applyAction(state, { type: 'sabotage-tick', at: ALARM_AT + 20_000 })).toBe(state);
    const reach = answers(mission, state, ALARM_AT + 3000)[0];
    expect(() => applyAction(state, must(reach, 'an answer'))).toThrow(/pausiert/);

    state = applyAction(state, { type: 'set-paused', paused: false, at: ALARM_AT + 32_000 });
    const after = emergencyOf(state);
    expect(state.sabotage?.endsAt).toBe(ALARM_AT + 75_000);
    expect(after.endsAt).toBe(before.endsAt + 30_000);
    expect(after.instructions.map((i) => i.expiresAt)).toEqual(
      before.instructions.map((i) => i.expiresAt + 30_000),
    );
  });

  it('replays to the same emergency: the start and every replacement come from the seed', () => {
    const script: Action[] = [
      { type: 'sabotage-start', at: ALARM_AT },
      { type: 'sabotage-tick', at: ALARM_AT + 12_000 },
      { type: 'sabotage-tick', at: ALARM_AT + 24_000 },
    ];
    const replay = (seed: number): GameState => script.reduce(applyAction, started(mission, seed));
    expect(replay(5)).toEqual(replay(5));
    expect(emergencyOf(replay(5)).controls).not.toEqual(emergencyOf(replay(6)).controls);
  });

  it("shows the audience every player's console, and nobody's on the map", () => {
    const state = alarmed(mission);
    const audience = viewForSpectator(state);
    for (const [i, panel] of audience.panels.entries()) {
      expect({ ...panel.emergency, manual: relayModule.manual(def) }).toEqual(
        relayOf(state, `p${i}`),
      );
    }
    expect(audience.map?.sabotage?.relay).toMatchObject({ controls: [], instruction: null });
  });
});

describe('valves mode', () => {
  const valves = parseMission({
    ...JSON.parse(JSON.stringify(relayMission(2))),
    map: {
      ...JSON.parse(JSON.stringify(relayMission(2).map)),
      sabotage: {
        label: 'KÜHLUNG AUSGEFALLEN',
        durationSec: 40,
        panels: [
          { id: 'links', x: 1, y: 2 },
          { id: 'rechts', x: 7, y: 2 },
        ],
      },
    },
  });

  it('is the default and keeps its emergency as it was: no console, no ticking', () => {
    expect(valves.map?.sabotage?.mode).toBe('valves');
    const state = alarmed(valves);
    expect(state.sabotage).toEqual({ endsAt: ALARM_AT + 40_000 });
    expect(Object.keys(state.sabotage ?? {})).toEqual(['endsAt']);
    expect(Object.keys(viewFor(state, 'p0').map?.sabotage ?? {})).toEqual([
      'label',
      'hint',
      'endsAt',
      'panels',
    ]);
    expect(viewForSpectator(state).panels.some((panel) => 'emergency' in panel)).toBe(false);
    expect(applyAction(state, { type: 'sabotage-tick', at: ALARM_AT + 30_000 })).toBe(state);
    expect(() =>
      applyAction(state, { type: 'puzzle-input', playerId: 'p1', at: ALARM_AT + 2000, input: {} }),
    ).toThrow(/kein Rätsel/);
  });

  it('still needs two panels', () => {
    const lonely = JSON.parse(JSON.stringify(valves));
    lonely.map.sabotage.panels = [{ id: 'links', x: 1, y: 2 }];
    expect(() => parseMission(lonely)).toThrow(/two sabotage panels at least/);
  });
});

describe('relay missions', () => {
  it('ask three instructions per player in twelve-second windows unless told otherwise', () => {
    expect(defOf(relayMission(2))).toMatchObject({ required: 6, windowSec: 12 });
    expect(defOf(relayMission(4))).toMatchObject({ required: 12 });
    expect(defOf(relayMission(3, { required: 4, windowSec: 8 }))).toMatchObject({
      required: 4,
      windowSec: 8,
    });
  });

  it('need two players and one instruction at least', () => {
    expect(() => relayMission(1)).toThrow(/players/);
    expect(() => relayMission(2, { required: 0 })).toThrow(/map\.sabotage\.required/);
  });

  it('have no panels and names for six consoles at most', () => {
    const panels = [
      { id: 'a', x: 1, y: 2 },
      { id: 'b', x: 2, y: 2 },
    ];
    expect(() => relayMission(2, { panels })).toThrow(/relay emergency has no panels/);
    expect(RELAY_MAX_PLAYERS).toBe(6);
    expect(() => relayMission(RELAY_MAX_PLAYERS + 1)).toThrow(/players\.max/);
  });

  it('never put the relay at a station', () => {
    expect(() =>
      parseMission({
        id: 'stationrelay',
        title: 'Falsch',
        story: { intro: 'i', win: 'w', lose: 'l' },
        timeLimitSec: 300,
        players: { min: 2, max: 2 },
        puzzles: [
          {
            type: 'relay',
            id: 'notfall',
            title: 'Notfall',
            players: [
              { id: 'a', name: 'A' },
              { id: 'b', name: 'B' },
            ],
            required: 3,
            durationSec: 30,
          },
        ],
        map: {
          tiles: ['#####', '#...#', '#####'],
          spawns: [
            { x: 1, y: 1 },
            { x: 3, y: 1 },
          ],
          stations: [{ puzzleId: 'notfall', x: 2, y: 1 }],
        },
      }),
    ).toThrow(/relay is an emergency, not a station/);
  });
});
