import { describe, expect, it } from 'vitest';
import { MODULES, puzzleDefSchema } from '../src/index.js';
import type { ConsoleId, PuzzleContext, PuzzleDef } from '../src/index.js';
import {
  accessModule,
  tokenOf,
  type AccessDef,
  type AccessInput,
  type AccessState,
} from '../src/puzzles/access.js';
import { buttonModule, type ButtonDef, type ButtonState } from '../src/puzzles/button.js';
import {
  buttonSyncModule,
  type ButtonSyncDef,
  type ButtonSyncState,
} from '../src/puzzles/buttonSync.js';
import {
  firewallModule,
  type FirewallDef,
  type FirewallInput,
  type FirewallState,
} from '../src/puzzles/firewall.js';
import {
  startupModule,
  type StartupDef,
  type StartupInput,
  type StartupState,
} from '../src/puzzles/startup.js';
import { mulberry32 } from '../src/rng.js';
import { T0 } from './lab.js';
import { playInstance } from './solveModule.js';

/**
 * A station rests through an emergency and comes back with what the crew had done there
 * (module.ts `resume`): what each module keeps, what it calls off, and that the crew still
 * solves it from there. The reducer's side of it is rest.test.ts.
 */

const SEEDS = 100;
const EDGEWORK = { serial: 'K7G3B-4', indicators: [], cells: 1 };
const BOTH = { a: ['op'], b: ['pt'] };
/** An emergency later: when the station comes back. */
const BACK = T0 + 60_000;

/** A moment of a station of two consoles, both manned, the move from `console`. */
const ctx = (at: number, console: ConsoleId | null = null): PuzzleContext => ({
  edgework: EDGEWORK,
  alarms: 0,
  remainingSec: 600,
  at,
  crew: ['op', 'pt', 'rd'],
  console,
  atConsoles: BOTH,
  readers: [],
});

const defOf = <Def extends PuzzleDef>(type: Def['type'], over: object = {}): Def =>
  puzzleDefSchema.parse({ type, id: type, title: type, ...over }) as Def;

/** A station module's default def, by type: every module that stands at a station. */
const stationDefs = MODULES.filter((m) => m.type !== 'relay').map((m) => defOf(m.type));

describe('the registry', () => {
  it('has a way back from an emergency for every module with a clock', () => {
    const clocked = MODULES.filter((m) => 'dueAt' in m || 'elapse' in m).map((m) => m.type);
    expect(clocked.sort()).toEqual(['access', 'button-sync', 'firewall', 'startup']);
    for (const type of clocked) {
      const found = MODULES.find((m) => m.type === type);
      expect(found !== undefined && 'resume' in found, `${type} has no resume`).toBe(true);
    }
  });
});

describe.each(stationDefs)('$type, rested through two emergencies', (def) => {
  it(`is still solved from its views without an alarm, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      // one early, one later, at another moment of the station's course for every seed
      const rests = [2 + (seed % 7), 12 + (seed % 41)];
      expect(playInstance(def, seed, undefined, rests), `seed ${seed}`).toBeGreaterThan(0);
    }
  });
});

describe('the Paketfilter back from an emergency', () => {
  const def = defOf<FirewallDef>('firewall');
  const elapsed = (state: FirewallState, at: number) => {
    const result = firewallModule.elapse?.(def, state, ctx(at));
    if (result === undefined) {
      throw new Error('the Paketfilter has no elapse');
    }
    return result;
  };
  const move = (state: FirewallState, at: number, console: ConsoleId, input: FirewallInput) =>
    firewallModule.apply(def, elapsed(state, at).state, input, 'op', ctx(at, console)).state;
  /** The first wave started at T0, a hostile packet of it dropped as it falls: one in the air. */
  const inTheAir = (seed: number): FirewallState => {
    const running = move(firewallModule.init(def, mulberry32(seed), ctx(T0)), T0, 'a', {
      start: true,
    });
    const hostile = running.packets.find((p) => p.hostile);
    if (hostile === undefined) {
      throw new Error(`seed ${seed}: a wave without a hostile packet`);
    }
    const at = T0 + hostile.enterMs + 1000;
    const marked = move(running, at, 'b', { mark: hostile.id });
    return move(marked, at, 'a', { trip: hostile.line });
  };

  it('calls the wave in the air off for a fresh one that waits for the Freigabe', () => {
    const before = { ...inTheAir(1), cleared: 1 };
    expect(before.dropped).toHaveLength(1);
    const back = firewallModule.resume?.(def, before, BACK);
    expect(back).toMatchObject({
      cleared: 1,
      dealt: before.dealt + 1,
      waiting: true,
      heldAt: BACK,
      startedAt: BACK,
      entered: 0,
      marks: [],
      dropped: [],
    });
    expect(back?.packets.map((p) => p.id)).not.toEqual(before.packets.map((p) => p.id));
    // the device reports nothing of it: no fault, no clean wave
    expect(back?.event).toEqual(before.event);
  });

  it(`raises no alarm and solves nothing for it, however long after, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const back = firewallModule.resume?.(def, inTheAir(seed), BACK);
      if (back === undefined) {
        throw new Error('the Paketfilter has no resume');
      }
      expect(firewallModule.dueAt?.(def, back)).toBeNull();
      for (const later of [0, 1000, 60_000, 600_000]) {
        const result = elapsed(back, BACK + later);
        expect([result.penalty, result.solved], `seed ${seed}`).toEqual([null, false]);
        expect(result.state.waiting).toBe(true);
      }
    }
  });

  it('leaves a wave that waited for the Freigabe as it was', () => {
    const waiting = firewallModule.init(def, mulberry32(1), ctx(T0));
    expect(firewallModule.resume?.(def, waiting, BACK)).toBe(waiting);
  });
});

describe('the Anlaufsteuerung back from an emergency', () => {
  const def = defOf<StartupDef>('startup');
  const move = (state: StartupState, at: number, console: ConsoleId, input: StartupInput) =>
    startupModule.apply(def, state, input, console === 'a' ? 'op' : 'pt', ctx(at, console));
  /** Stage 1's gap set to its right value and the script started at T0: a pulse on its way. */
  const pulseOut = (seed: number): StartupState => {
    const fresh = startupModule.init(def, mulberry32(seed), ctx(T0));
    const starts = (value: number): boolean => {
      const set = move(fresh, T0, 'a', { cmd: 'setze', gap: 'abgang', value }).state;
      return move(set, T0, 'a', { cmd: 'start' }).penalty === null;
    };
    const right = [1, 2, 3, 4].find(starts);
    if (right === undefined) {
      throw new Error(`seed ${seed}: no feeder starts stage 1`);
    }
    const set = move(fresh, T0, 'a', { cmd: 'setze', gap: 'abgang', value: right }).state;
    return move(set, T0, 'a', { cmd: 'start' }).state;
  };

  it('lets the pulse lapse without an alarm, the gaps as they were filled', () => {
    const before = pulseOut(1);
    expect(before.pulse).not.toBeNull();
    const back = startupModule.resume?.(def, before, BACK);
    expect(back).toMatchObject({
      stage: 0,
      values: before.values,
      pulse: null,
      last: 'verfallen',
      closed: [],
    });
    expect(back?.log.at(-1)).toMatchObject({ tag: 'info', text: 'Impuls verfallen' });
    expect(startupModule.dueAt?.(def, back ?? before)).toBeNull();
  });

  it('keeps the stages run up, and takes the script started again', () => {
    const before = pulseOut(2);
    const feeder = before.values.abgang ?? 0;
    const arrived = T0 + def.travelSec * 1000;
    const second = move(before, arrived, 'b', { breaker: feeder }).state;
    expect(second).toMatchObject({ stage: 1, closed: [{ console: 'b', feeder }] });
    expect(startupModule.resume?.(def, second, BACK)).toBe(second);
    const back = startupModule.resume?.(def, before, BACK) ?? before;
    const again = move(back, BACK + 1000, 'a', { cmd: 'start' });
    expect(again.penalty).toBeNull();
    expect(again.state.pulse).toEqual({ sentAt: BACK + 1000, arrived: false });
  });
});

describe('the Synchrontaster back from an emergency', () => {
  const timed = defOf<ButtonSyncDef>('button-sync', { windowMs: 3000 });
  const untimed = defOf<ButtonSyncDef>('button-sync');
  const pressed = (def: ButtonSyncDef): ButtonSyncState => {
    const idle = buttonSyncModule.init(def, mulberry32(1), ctx(T0));
    return buttonSyncModule.apply(def, idle, { press: true }, 'op', ctx(T0)).state;
  };

  it('drops a press in its window, and tells nobody theirs ran out', () => {
    const before = pressed(timed);
    expect(buttonSyncModule.dueAt?.(timed, before)).toBe(T0 + 3001);
    const back = buttonSyncModule.resume?.(timed, before, BACK);
    expect(back).toEqual({ type: 'button-sync', pressed: {}, expired: [] });
    expect(buttonSyncModule.dueAt?.(timed, back ?? before)).toBeNull();
    // left alone, the room's next tick would have told the presser „verfallen"
    expect(buttonSyncModule.expire?.(timed, before, BACK).expired).toEqual(['op']);
  });

  it('keeps every press where none runs out, and a station nobody pressed as it was', () => {
    const before = pressed(untimed);
    expect(buttonSyncModule.resume?.(untimed, before, BACK)).toBe(before);
    const idle = buttonSyncModule.init(timed, mulberry32(1), ctx(T0));
    expect(buttonSyncModule.resume?.(timed, idle, BACK)).toBe(idle);
  });
});

describe('the Knopf back from an emergency', () => {
  const def = defOf<ButtonDef>('button');
  const idle = buttonModule.init(def, mulberry32(1), ctx(T0));

  it('springs back where it was held, no alarm for the release that comes after', () => {
    const held: ButtonState = { ...idle, holding: true };
    const back = buttonModule.resume?.(def, held, BACK) ?? held;
    expect(back).toEqual({ ...idle, holding: false });
    const after = buttonModule.apply(def, back, { kind: 'release' }, 'op', ctx(BACK + 1000, 'a'));
    expect([after.penalty, after.solved, after.state]).toEqual([null, false, back]);
    expect(buttonModule.resume?.(def, idle, BACK)).toBe(idle);
  });
});

describe('the Zugangskontrolle back from an emergency', () => {
  const def = defOf<AccessDef>('access');
  const fresh = accessModule.init(def, mulberry32(1), ctx(T0));
  const [account] = fresh.accounts;
  const typed = (state: AccessState, at: number, input: AccessInput) =>
    accessModule.apply(def, state, input, 'op', ctx(at, 'a'));

  it('keeps the login asked for and stands at the period of the moment', () => {
    const asked = typed(fresh, T0, { cmd: 'login', account: account?.name ?? '' }).state;
    const back = accessModule.resume?.(def, asked, BACK) ?? asked;
    expect(back).toMatchObject({ prompt: asked.prompt, released: [], period: 2, misses: {} });
    expect(back.log).toEqual(asked.log);
    // the token the device shows after the emergency opens the session: no miss counted
    const token = tokenOf(back.seed, account?.name ?? '', 2);
    const open = typed(back, BACK + 1000, { token });
    expect([open.penalty, open.state.session]).toEqual([null, account?.name]);
  });

  it('lifts a lock that ran out meanwhile, and keeps one that did not', () => {
    const name = account?.name ?? '';
    const locked: AccessState = { ...fresh, locks: { [name]: T0 + 45_000 } };
    expect(accessModule.resume?.(def, locked, BACK)?.locks).toEqual({});
    expect(accessModule.resume?.(def, locked, T0 + 30_000)?.locks).toEqual(locked.locks);
  });
});
