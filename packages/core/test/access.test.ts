import { describe, expect, it } from 'vitest';
import {
  ACCESS_DOORS,
  ACCESS_ROLES,
  applyAction,
  DOOR_ROLE,
  generateEdgework,
  parseMission,
  puzzleDefSchema,
  puzzleDueAt,
  ROLE_NAMES,
  stationKey,
  viewFor,
} from '../src/index.js';
import type { ConsoleId, GameState, PuzzleContext, Viewer } from '../src/index.js';
import {
  ACCOUNT_NAMES,
  accessModule,
  boundIn,
  periodAt,
  tokenOf,
  type AccessDef,
  type AccessInput,
  type AccessState,
  type AccessView,
} from '../src/puzzles/access.js';
import { GameError } from '../src/errors.js';
import { mulberry32 } from '../src/rng.js';
import { AT_BOOK, AT_CONSOLE_B, AT_STATION, AUDIENCE, ELSEWHERE, lightsOut, started } from './lab.js';
import { standing, T0 } from './lab.js';
import { playInstance } from './solveModule.js';

const SEEDS = 200;

const defOf = (over: Record<string, unknown> = {}): AccessDef =>
  puzzleDefSchema.parse({ type: 'access', id: 'zk', title: 'Zugangskontrolle', ...over }) as AccessDef;

const DEF = defOf();
const PERIOD_MS = DEF.tokenSec * 1000;
const EDGEWORK = generateEdgework(mulberry32(3));

/** A move's moment: at `at`, from `console`, the mission clock at `left` seconds. */
function ctx(at: number, console: ConsoleId | null = 'a', left = 600): PuzzleContext {
  return {
    edgework: EDGEWORK,
    alarms: 0,
    remainingSec: left,
    at,
    crew: ['op', 'pt', 'rd'],
    console,
    atConsoles: console === null ? { a: [], b: [] } : { a: ['op'], b: ['pt'] },
    readers: console === null ? [] : ['rd'],
  };
}

const fresh = (def: AccessDef = DEF, seed = 1): AccessState =>
  accessModule.init(def, mulberry32(seed), ctx(T0, null));

const seen = (state: AccessState, viewer: Viewer, def: AccessDef = DEF): AccessView =>
  accessModule.view(def, state, viewer, {
    edgework: EDGEWORK,
    alarms: 0,
    crew: ['op', 'pt', 'rd'],
    operators: ['op', 'pt'],
  });

/** A move at the terminal at `at`; `left` the mission clock. */
function send(
  state: AccessState,
  input: AccessInput,
  at: number,
  def: AccessDef = DEF,
  left = 600,
): { state: AccessState; penalty: string | null; solved: boolean } {
  return accessModule.apply(def, state, input, 'op', ctx(at, 'a', left));
}

/** The account the list gives the role that may release `door`. */
function accountFor(state: AccessState, door: AccessState['needed'][number]): string {
  const account = state.accounts.find((entry) => entry.role === DOOR_ROLE[door])?.name;
  if (account === undefined) {
    throw new Error(`nobody on the list may release ${door}`);
  }
  return account;
}

/** The first period from `from` on in which the device is bound to `account`. */
function periodOf(state: AccessState, account: string, from = 0): number {
  for (let period = from; period < from + 10; period++) {
    if (boundIn(state, period) === account) {
      return period;
    }
  }
  throw new Error(`the device never comes round to ${account}`);
}

/** Half a second into `period`. */
const inPeriod = (state: AccessState, period: number, def: AccessDef = DEF): number =>
  state.epoch + period * def.tokenSec * 1000 + 500;

/** `account` logged in and its session opened at the first period the device shows it. */
function loggedInAs(state: AccessState, account: string, def: AccessDef = DEF): AccessState {
  const period = periodOf(state, account, state.period);
  const at = inPeriod(state, period, def);
  const asked = send(state, { cmd: 'login', account }, at, def).state;
  const opened = send(asked, { token: tokenOf(state.seed, account, period) }, at, def);
  expect(opened.penalty).toBeNull();
  return opened.state;
}

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof GameError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('the move went through');
};

describe('the token', () => {
  it('is six digits, the same for the same seed, account and period', () => {
    for (let period = 0; period < 50; period++) {
      const token = tokenOf(12345, 'huber', period);
      expect(token).toMatch(/^\d{6}$/);
      expect(tokenOf(12345, 'huber', period)).toBe(token);
    }
  });

  it('is drawn anew for every period, every account and every run', () => {
    const tokens = (draw: (i: number) => string): number =>
      new Set(Array.from({ length: 300 }, (_, i) => draw(i))).size;
    expect(tokens((i) => tokenOf(7, 'huber', i))).toBeGreaterThan(295);
    expect(tokens((i) => tokenOf(i, 'huber', 4))).toBeGreaterThan(295);
    const names = ACCOUNT_NAMES.map((name) => tokenOf(7, name, 4));
    expect(new Set(names).size).toBe(ACCOUNT_NAMES.length);
  });

  it('stands on the device for exactly its period, on the server’s clock', () => {
    const state = fresh();
    const token = (at: number): string =>
      seen(accessModule.expire?.(DEF, state, at) ?? state, AT_CONSOLE_B).device?.token ?? '';
    const first = token(T0);
    expect(token(T0 + PERIOD_MS - 1)).toBe(first);
    expect(accessModule.dueAt?.(DEF, state)).toBe(T0 + PERIOD_MS);
    const next = accessModule.expire?.(DEF, state, T0 + PERIOD_MS) ?? state;
    expect(next.period).toBe(1);
    expect(token(T0 + PERIOD_MS)).toBe(tokenOf(state.seed, boundIn(state, 1), 1));
    expect(token(T0 + PERIOD_MS)).not.toBe(first);
    expect(accessModule.dueAt?.(DEF, next)).toBe(T0 + 2 * PERIOD_MS);
    // Nothing comes due before its moment, and no period goes back.
    expect(accessModule.expire?.(DEF, state, T0 + PERIOD_MS - 1)).toBe(state);
    expect(accessModule.expire?.(DEF, next, T0)).toBe(next);
  });

  it('counts its periods from the moment the station came on', () => {
    const state = fresh();
    expect(state.epoch).toBe(T0);
    expect(periodAt(DEF, state, T0 + 3 * PERIOD_MS + 999)).toBe(3);
    expect(periodAt(defOf({ tokenSec: 15 }), state, T0 + 3 * PERIOD_MS)).toBe(6);
  });
});

describe('an instance', () => {
  it(`deals a list of three accounts, the device's turn and the doors, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const def = defOf({ doors: 1 + (seed % 3) });
      const state = fresh(def, seed);
      const names = state.accounts.map((entry) => entry.name);
      const roles = state.accounts.map((entry) => entry.role);
      expect(names.every((name) => (ACCOUNT_NAMES as readonly string[]).includes(name))).toBe(true);
      expect([...names].sort()).toEqual(names);
      expect(new Set(names).size).toBe(3);
      expect(new Set(roles).size).toBe(3);
      expect([...state.rotation].sort()).toEqual(names);
      expect(state.needed).toHaveLength(def.doors);
      const neededRoles = state.needed.map((door) => DOOR_ROLE[door]);
      expect(new Set(neededRoles).size).toBe(def.doors);
      expect(neededRoles.every((role) => roles.includes(role))).toBe(true);
    }
  });

  it('opens with the doors it asks for in its log, nobody logged in', () => {
    const state = fresh();
    expect(state.log).toEqual([
      { n: 1, tag: 'info', text: `Angefordert: ${state.needed.map((d) => d.toUpperCase()).join(', ')}` },
    ]);
    expect(state).toMatchObject({ session: null, prompt: null, released: [], period: 0 });
  });
});

describe('the views', () => {
  const state = fresh();
  const device = seen(state, AT_CONSOLE_B).device;
  const quoted = (text: string): string => JSON.stringify(text);

  it('show the terminal its doors and its log, never the token or the list', () => {
    const view = seen(state, AT_STATION);
    expect(view).toMatchObject({ role: 'terminal', device: null, roster: null });
    expect(view.terminal?.doors).toEqual(state.needed.map((door) => ({ door, released: false })));
    const json = JSON.stringify(view);
    expect(json).not.toContain(quoted(device?.token ?? '?'));
    for (const { name, role } of state.accounts) {
      expect(json).not.toContain(name);
      expect(json).not.toContain(quoted(role));
    }
  });

  it('show the token device its account, that account’s token and the period’s end alone', () => {
    const view = seen(state, AT_CONSOLE_B);
    const account = boundIn(state, 0);
    expect(view).toMatchObject({ role: 'token', terminal: null, roster: null });
    expect(view.device).toEqual({
      account,
      token: tokenOf(state.seed, account, 0),
      endsAt: T0 + PERIOD_MS,
      periodSec: 30,
    });
    const json = JSON.stringify(view);
    for (const door of ACCESS_DOORS) {
      expect(json).not.toContain(quoted(door));
      expect(json).not.toContain(door.toUpperCase());
    }
    for (const role of ACCESS_ROLES) {
      expect(json).not.toContain(quoted(role));
    }
    const others = state.accounts.filter((entry) => entry.name !== account);
    expect(others.filter((entry) => json.includes(entry.name))).toEqual([]);
  });

  it('show the list at a source, never a door or a token', () => {
    const view = seen(state, AT_BOOK);
    expect(view).toMatchObject({ role: null, terminal: null, device: null });
    expect(view.roster).toEqual(state.accounts);
    const json = JSON.stringify(view);
    expect(json).not.toContain(quoted(device?.token ?? '?'));
    for (const door of ACCESS_DOORS) {
      expect(json).not.toContain(quoted(door));
      expect(json).not.toContain(door.toUpperCase());
    }
  });

  it('show nothing away from them, and the audience all of it', () => {
    expect(seen(state, ELSEWHERE)).toEqual({
      kind: 'access',
      role: null,
      terminal: null,
      device: null,
      roster: null,
    });
    const audience = seen(state, AUDIENCE);
    expect(audience.terminal).not.toBeNull();
    expect(audience.device).toEqual(device);
    expect(audience.roster).toEqual(state.accounts);
  });
});

describe('the login', () => {
  const state = fresh();
  const [door] = state.needed;
  if (door === undefined) {
    throw new Error('the instance asks for no door');
  }
  const account = accountFor(state, door);
  const period = periodOf(state, account);
  const at = inPeriod(state, period);
  const asked = send(state, { cmd: 'login', account }, at).state;

  it('asks for the account’s token, and opens the session with the one the device shows', () => {
    expect(asked.prompt).toBe(account);
    expect(asked.log.at(-1)).toMatchObject({ tag: 'info', text: `login ${account}: Token angefordert` });
    const shown = seen(asked, AT_CONSOLE_B).device;
    expect(shown?.account).toBe(account);
    const opened = send(asked, { token: shown?.token ?? '' }, at);
    expect(opened.penalty).toBeNull();
    expect(opened.state).toMatchObject({ session: account, prompt: null });
    expect(opened.state.log.at(-1)).toMatchObject({ tag: 'ok', text: `Sitzung ${account} offen` });
  });

  it('turns away an account the list does not have, and a token nobody asked for', () => {
    expect(refusal(() => send(state, { cmd: 'login', account: 'meier' }, at))).toBe(
      'Kein Konto meier.',
    );
    expect(refusal(() => send(state, { token: '123456' }, at))).toBe('Keine Anmeldung offen.');
  });

  it('turns back a token of the period just gone without an alarm, and asks on', () => {
    const late = inPeriod(state, period + 1);
    const result = send(asked, { token: tokenOf(state.seed, account, period) }, late);
    expect(result.penalty).toBeNull();
    expect(result.state).toMatchObject({ prompt: account, session: null, misses: {} });
    expect(result.state.log.at(-1)).toMatchObject({
      tag: 'info',
      text: 'Periode gewechselt: Token abgelaufen',
    });
  });

  it('counts a wrong token as a Fehlquittierung, the prompt asking on', () => {
    const wrong = tokenOf(state.seed, account, period + 7);
    const result = send(asked, { token: wrong }, at);
    expect(result.penalty).toBe('Zugangskontrolle: falscher Token');
    expect(result.state).toMatchObject({ prompt: account, misses: { [account]: 1 } });
    expect(result.state.log.at(-1)).toMatchObject({ tag: 'fail', text: 'Token falsch (1/3)' });
  });

  it('locks the account at the third wrong token in a row, until the mission clock moves on', () => {
    const wrong = { token: tokenOf(state.seed, account, period + 7) };
    const first = send(asked, wrong, at, DEF, 500).state;
    const second = send(first, wrong, at, DEF, 500).state;
    const third = send(second, wrong, at, DEF, 500);
    expect(third.penalty).toBe('Zugangskontrolle: Konto gesperrt');
    expect(third.state).toMatchObject({
      prompt: null,
      misses: { [account]: 0 },
      locks: { [account]: 455 },
    });
    expect(third.state.log.at(-1)?.text).toBe(`Token falsch: ${account} für 45 s gesperrt`);
    expect(seen(third.state, AT_STATION).terminal?.locks).toEqual([{ account, liftsAtSec: 455 }]);
    // The mission clock, not the wall's: a pause stops the lock with the clock.
    const later = at + 10 * PERIOD_MS;
    const stillLocked = () => send(third.state, { cmd: 'login', account }, later, DEF, 456);
    expect(refusal(stillLocked)).toBe(`Konto ${account} gesperrt.`);
    const lifted = send(third.state, { cmd: 'login', account }, at, DEF, 455);
    expect(lifted.state).toMatchObject({ prompt: account, locks: {} });
  });

  it('locks only at three in a row: a session opened in between starts the count over', () => {
    const wrong = { token: tokenOf(state.seed, account, period + 7) };
    const twice = send(send(asked, wrong, at).state, wrong, at).state;
    const right = send(twice, { token: tokenOf(state.seed, account, period) }, at).state;
    expect(right.misses).toEqual({ [account]: 0 });
    const again = send(right, { cmd: 'login', account }, at).state;
    const once = send(again, wrong, at);
    expect(once.penalty).toBe('Zugangskontrolle: falscher Token');
    expect(once.state.locks).toEqual({});
  });

  it('takes nothing at the token device', () => {
    const atB = () => accessModule.apply(DEF, state, { cmd: 'status' }, 'pt', ctx(at, 'b'));
    expect(refusal(atB)).toBe('Befehle nimmt nur das Terminal an.');
  });
});

describe('a release', () => {
  const state = fresh(DEF, 4);
  const [door, second] = state.needed;
  if (door === undefined || second === undefined) {
    throw new Error('the instance asks for fewer than two doors');
  }
  const account = accountFor(state, door);
  const session = loggedInAs(state, account);
  const at = session.epoch + session.period * PERIOD_MS + 900;

  it('releases a door of the session’s role, standing open for openSec seconds', () => {
    const result = send(session, { cmd: 'freigeben', door }, at);
    expect(result.penalty).toBeNull();
    expect(result.solved).toBe(false);
    expect(result.state).toMatchObject({ released: [door], open: { door, until: at + 5000 } });
    const name = door.toUpperCase();
    expect(result.state.log.at(-1)).toMatchObject({ tag: 'ok', text: `${name} offen für 5 s` });
    expect(seen(result.state, AT_STATION).terminal?.doors[0]).toEqual({ door, released: true });
    expect(refusal(() => send(result.state, { cmd: 'freigeben', door }, at))).toBe(
      `${name} ist schon freigegeben.`,
    );
  });

  it('raises an alarm for a door the session’s role may not release', () => {
    const result = send(session, { cmd: 'freigeben', door: second }, at);
    expect(result.penalty).toBe('Zugangskontrolle: Freigabe verweigert');
    expect(result.state.released).toEqual([]);
  });

  it('turns away a door the terminal does not ask for, and any door without a session', () => {
    const other = ACCESS_DOORS.find((d) => !state.needed.includes(d)) ?? 'lager';
    expect(refusal(() => send(session, { cmd: 'freigeben', door: other }, at))).toBe(
      `${other.toUpperCase()} fordert das Terminal nicht an.`,
    );
    expect(refusal(() => send(state, { cmd: 'freigeben', door }, at))).toBe(
      'Keine Sitzung offen.',
    );
  });

  it('solves the station once every door asked for is released', () => {
    const one = send(session, { cmd: 'freigeben', door }, at).state;
    const other = loggedInAs(one, accountFor(one, second));
    const last = send(other, { cmd: 'freigeben', door: second }, inPeriod(other, other.period));
    expect(last).toMatchObject({ penalty: null, solved: true });
  });
});

describe('Sicherheitsstufe 2', () => {
  const state = fresh(DEF, 9);
  const [door, second] = state.needed;
  if (door === undefined || second === undefined) {
    throw new Error('the instance asks for fewer than two doors');
  }
  const role = DOOR_ROLE[door];
  const account = accountFor(state, door);

  it('names the session by its account before strictFrom, its doors with it', () => {
    const session = loggedInAs(state, account);
    expect(seen(session, AT_STATION).terminal).toMatchObject({ session: { account }, strict: false });
    const shown = send(session, { cmd: 'status' }, inPeriod(session, session.period)).state;
    const doors = ACCESS_DOORS.filter((d) => DOOR_ROLE[d] === role).map((d) => d.toUpperCase());
    expect(shown.log.at(-1)?.text).toBe(`Sitzung ${account}: gibt ${doors.join(', ')} frei`);
  });

  it('names the session by its role alone from strictFrom on, in the log and at status', () => {
    const one = send(loggedInAs(state, account), { cmd: 'freigeben', door }, T0 + 1).state;
    const next = accountFor(one, second);
    const nextRole = DOOR_ROLE[second];
    const session = loggedInAs(one, next);
    const terminal = seen(session, AT_STATION).terminal;
    expect(terminal).toMatchObject({ session: { role: nextRole }, strict: true });
    expect(JSON.stringify(terminal?.session)).not.toContain(next);
    const roleWord = ROLE_NAMES[nextRole].toUpperCase();
    expect(session.log.at(-1)?.text).toBe(`Sitzung ${roleWord} offen`);
    const shown = send(session, { cmd: 'status' }, inPeriod(session, session.period)).state;
    expect(shown.log.at(-1)?.text).toBe(`Sitzung ${roleWord}`);
  });

  it('holds from the first release with strictFrom 1, and never past the last door', () => {
    const strict = defOf({ strictFrom: 1 });
    const first = loggedInAs(fresh(strict, 9), account, strict);
    expect(seen(first, AT_STATION, strict).terminal).toMatchObject({ strict: true });
    const never = defOf({ doors: 1, strictFrom: 2 });
    const single = fresh(never, 9);
    const [only] = single.needed;
    const opened = loggedInAs(single, accountFor(single, only ?? door), never);
    expect(seen(opened, AT_STATION, never).terminal).toMatchObject({ strict: false });
  });
});

describe('the backup rule, through the reducer', () => {
  const mission = parseMission({
    id: 'zugang',
    title: 'Zugang',
    players: { min: 3, max: 3 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [{ type: 'access', id: 'zk', title: 'Zugangskontrolle' }],
    map: {
      tiles: ['################', '#..............#', '#..............#', '################'],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
      ],
      stations: [
        { puzzleId: 'zk', x: 4, y: 1, console: 'a' },
        { puzzleId: 'zk', x: 12, y: 1, console: 'b' },
      ],
      manuals: [
        { id: 'liste', kind: 'clipboard', label: 'BENUTZERLISTE', puzzleIds: ['zk'], spots: [{ x: 8, y: 2 }] },
      ],
      exit: { x: 14, y: 2 },
    },
  });
  const consoleB = stationKey({ puzzleId: 'zk', console: 'b' });
  /** The station on, p1 at the terminal, and whoever `where` names elsewhere. */
  const open = (where: Parameters<typeof standing>[1]): GameState => {
    const on = standing(lightsOut(started(mission, 3)), { stations: { zk: ['p1'] } });
    const running = applyAction(on, { type: 'interact', playerId: 'p1', at: T0 + 100 });
    return standing(running, { ...where, stations: { zk: ['p1'], ...where.stations } });
  };
  const login = (state: GameState): GameState =>
    applyAction(state, {
      type: 'puzzle-input',
      playerId: 'p1',
      at: T0 + 200,
      input: { cmd: 'status' },
    });

  it('turns a command away while nobody stands at the token device or the list', () => {
    expect(() => login(open({}))).toThrow(/Eingabe gesperrt: Am anderen Pult/);
  });

  it('takes it with somebody at the token device, or at the list', () => {
    const atDevice = login(open({ stations: { [consoleB]: ['p2'] } }));
    const atList = login(open({ manuals: { liste: ['p3'] } }));
    for (const state of [atDevice, atList]) {
      const terminal = viewFor(state, 'p1').puzzle;
      expect(terminal?.kind === 'access' ? terminal.terminal?.log.at(-1)?.text : null).toBe(
        'Keine Sitzung offen',
      );
    }
  });

  /** The open Zugangskontrolle as `playerId` sees it in `state`. */
  const accessOf = (state: GameState, playerId: string): AccessView => {
    const view = viewFor(state, playerId).puzzle;
    if (view?.kind !== 'access') {
      throw new Error(`${playerId} sees no open Zugangskontrolle`);
    }
    return view;
  };

  it('is ticked by the room as each period ends: the device moves on to its next account', () => {
    const state = open({ stations: { [consoleB]: ['p2'] }, manuals: { liste: ['p3'] } });
    const due = T0 + 100 + PERIOD_MS;
    expect(puzzleDueAt(state)).toBe(due);
    const early = applyAction(state, { type: 'puzzle-tick', at: due - 1 });
    expect(accessOf(early, 'p2').device).toEqual(accessOf(state, 'p2').device);
    const ticked = applyAction(state, { type: 'puzzle-tick', at: due });
    const device = accessOf(ticked, 'p2').device;
    expect(device?.endsAt).toBe(due + PERIOD_MS);
    expect(device?.token).not.toBe(accessOf(state, 'p2').device?.token);
    const names = accessOf(ticked, 'p3').roster?.map((entry) => entry.name);
    expect(names).toContain(device?.account);
  });
});

describe('the solver', () => {
  const variants = [
    {},
    { doors: 1 },
    { doors: 3, strictFrom: 1 },
    { tokenSec: 15, strictFrom: 3 },
    { tokenSec: 60 },
  ];

  it.each(variants)(`solves %o from the three views, alarm-free, for ${SEEDS} seeds`, (over) => {
    const def = defOf(over);
    const moves = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      moves.add(playInstance(def, seed));
    }
    // A login, its token and the release for every door.
    expect([...moves]).toEqual([3 * def.doors]);
  });

  it('needs the terminal, the token device and the list', () => {
    const state = fresh();
    const views = { operator: seen(state, AT_STATION), reader: seen(state, AT_BOOK) };
    expect(() => accessModule.solve(DEF, views, null)).toThrow(/token device's at console b/);
    const blind = { ...views, partner: seen(state, AT_CONSOLE_B), reader: seen(state, ELSEWHERE) };
    expect(() => accessModule.solve(DEF, blind, null)).toThrow(/the list's at a source/);
  });

  it('logs in, waits while the device shows another account, then types the token', () => {
    const firstAccount = (s: AccessState): string => accountFor(s, s.needed[0] ?? 'lager');
    const seed = [...Array(50).keys()].find((s) => {
      const dealt = fresh(DEF, s);
      return boundIn(dealt, 0) !== firstAccount(dealt);
    });
    const state = fresh(DEF, seed ?? 0);
    const account = firstAccount(state);
    const views = (s: AccessState) => ({
      operator: seen(s, AT_STATION),
      partner: seen(s, AT_CONSOLE_B),
      reader: seen(s, AT_BOOK),
    });
    expect(accessModule.solve(DEF, views(state), null)).toEqual([
      { by: 'operator', input: { cmd: 'login', account } },
    ]);
    const asked = send(state, { cmd: 'login', account }, T0 + 1).state;
    expect(accessModule.solve(DEF, views(asked), null)).toEqual([]);
    const showing = periodOf(asked, account);
    expect(showing).toBeGreaterThan(0);
    const there = accessModule.expire?.(DEF, asked, inPeriod(asked, showing)) ?? asked;
    expect(accessModule.solve(DEF, views(there), null)).toEqual([
      { by: 'operator', input: { token: tokenOf(asked.seed, account, showing) } },
    ]);
  });
});
