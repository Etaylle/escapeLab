import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  GameError,
  parseMission,
  stationKey,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type {
  Action,
  ConsoleId,
  GameState,
  ManualBlock,
  Mission,
  Move,
  Perspectives,
  PuzzleContext,
  Viewer,
} from '../src/index.js';
import {
  CODE_MEANINGS,
  DEPENDS_ON,
  EXAMPLE,
  LOG_LINES,
  SERVER_CODES,
  SERVICES,
  serversModule,
} from '../src/puzzles/servers.js';
import type {
  ServerCode,
  ServerRow,
  ServersDef,
  ServersInput,
  ServersState,
  ServersView,
  Service,
  ServiceState,
} from '../src/puzzles/servers.js';
import { mulberry32 } from '../src/rng.js';
import {
  AT_BOOK,
  AT_CONSOLE_B,
  AT_STATION,
  AUDIENCE,
  ELSEWHERE,
  standing,
  started,
  T0,
} from './lab.js';
import { playInstance } from './solveModule.js';

const SEEDS = 300;
const CREW = ['op', 'pt', 'rd'];
const EDGEWORK = { serial: 'K7G3B-4', indicators: [], cells: 1 };

/** A def through the schema, as a mission file's would go; `fields` may be off on purpose. */
function defOf(fields: object = {}): ServersDef {
  return serversModule.defSchema.parse({
    type: 'servers',
    id: 'serverraum',
    title: 'Serverraum',
    ...fields,
  });
}

type AtConsoles = PuzzleContext['atConsoles'];

/** Both consoles manned: op at the terminal, pt at the rack. */
const MANNED: AtConsoles = { a: ['op'], b: ['pt'] };

/** What a move from console `from` gets to know, with who stands where; null for the setup. */
const ctx = (from: ConsoleId | null, atConsoles = MANNED): PuzzleContext => ({
  edgework: EDGEWORK,
  alarms: 0,
  remainingSec: 600,
  at: T0,
  crew: CREW,
  console: from,
  atConsoles: from === null ? { a: [], b: [] } : atConsoles,
  readers: [],
});

const deal = (def: ServersDef, seed: number): ServersState =>
  serversModule.init(def, mulberry32(seed), ctx(null));

/**
 * An input from console `from` — by op at the terminal, by pt at the rack —
 * through the schema, as a client's goes, with who stands where.
 */
function send(state: ServersState, input: ServersInput, from: ConsoleId, atConsoles = MANNED) {
  const parsed = serversModule.inputSchema.parse(input);
  const by = from === 'a' ? 'op' : 'pt';
  return serversModule.apply(defOf(), state, parsed, by, ctx(from, atConsoles));
}
const type = (state: ServersState, cmd: 'start' | 'restart', service: Service) =>
  send(state, { cmd, service }, 'a');
const flip = (state: ServersState, service: Service, on: boolean) =>
  send(state, { power: service, on }, 'b');

/** Inputs in a row, every one without an alarm; the state after the last. */
function played(state: ServersState, inputs: [ServersInput, ConsoleId][]): ServersState {
  return inputs.reduce((now, [input, from]) => {
    const result = send(now, input, from);
    expect(result.penalty, JSON.stringify(input)).toBeNull();
    return result.state;
  }, state);
}

const seenFrom = (state: ServersState, viewer: Viewer): ServersView =>
  serversModule.view(defOf(), state, viewer, {
    edgework: EDGEWORK,
    alarms: 0,
    crew: CREW,
    operators: ['op', 'pt'],
  });

/** The crew's screens: the terminal at console a, the rack at console b, the book. */
const views = (state: ServersState): Perspectives<ServersView> => ({
  operator: seenFrom(state, AT_STATION),
  partner: seenFrom(state, AT_CONSOLE_B),
  reader: seenFrom(state, AT_BOOK),
});

/** A service running since moment 0, with power. */
const UP: ServiceState = {
  running: true,
  code: null,
  power: true,
  bootedAt: 0,
  crashedAt: 0,
  poweredAt: 0,
};

/** A service down since moment 1 with `code`, with power or without. */
const DOWN = (code: ServerCode, power = true): Partial<ServiceState> => ({
  running: false,
  code,
  power,
  crashedAt: 1,
});

/** A Serverraum at moment 1: every service up but those given, an empty log. */
function lab(services: Partial<Record<Service, Partial<ServiceState>>> = {}): ServersState {
  const all = Object.fromEntries(SERVICES.map((s) => [s, { ...UP, ...services[s] }]));
  return {
    type: 'servers',
    services: all as Record<Service, ServiceState>,
    clock: 1,
    seed: 1234,
    infections: 0,
    log: [],
    logged: 0,
  };
}

/** The log's lines as the terminal prints them. */
const printed = (state: ServersState): string[] =>
  state.log.map((line) => `[${line.tag}] ${line.text}`);

/** The services down, by name. */
const downOf = (state: ServersState): Service[] =>
  SERVICES.filter((s) => !state.services[s].running);

/** The services nothing depends on: only these can be quarantined. */
const LEAVES = SERVICES.filter((s) => SERVICES.every((o) => !DEPENDS_ON[o].includes(s)));

describe('servers setup', () => {
  it('takes 4 services down, the trap and 20 s by default, and refuses what is off', () => {
    expect(defOf()).toMatchObject({ crashed: 4, trap: true, penaltySec: 20 });
    for (const fields of [
      { crashed: 2 },
      { crashed: 6 },
      { crashed: 3.5 },
      { trap: 'ja' },
      { penaltySec: 0 },
      { services: 6 },
    ]) {
      expect(() => defOf(fields), JSON.stringify(fields)).toThrow();
    }
    expect(defOf({ crashed: 5, trap: false })).toMatchObject({ crashed: 5, trap: false });
  });

  it('deals as many services down as the def says, the same for a seed, each reported', () => {
    for (const crashed of [3, 4, 5]) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const def = defOf({ crashed, trap: seed % 2 === 0 });
        const state = deal(def, seed);
        expect(deal(def, seed)).toEqual(state);
        expect(downOf(state)).toHaveLength(crashed);
        expect(state).toMatchObject({ clock: 1, infections: 0, logged: crashed });
        // The terminal opens on its monitor's report of every service down.
        expect(printed(state)).toEqual(
          downOf(state).map((s) => `[warn] ${s} abgestürzt: ${state.services[s].code ?? ''}`),
        );
        for (const s of SERVICES) {
          const it = state.services[s];
          expect(it.code === null, `seed ${seed} ${s}`).toBe(it.running);
          // Every running service has power.
          expect(!it.running || it.power, `seed ${seed} ${s}`).toBe(true);
        }
      }
    }
  });

  it('quarantines one service with the trap: one nothing depends on, its switch on', () => {
    expect(LEAVES).toEqual(['web', 'mail']);
    const quarantined = new Set<Service>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const trapped = deal(defOf({ crashed: 3 + (seed % 3) }), seed);
      const e50 = SERVICES.filter((s) => trapped.services[s].code === 'E50');
      expect(e50, `seed ${seed}`).toHaveLength(1);
      const [service] = e50 as [Service];
      expect(LEAVES).toContain(service);
      expect(trapped.services[service].power).toBe(true);
      quarantined.add(service);
      const plain = deal(defOf({ crashed: 3 + (seed % 3), trap: false }), seed);
      expect(SERVICES.some((s) => plain.services[s].code === 'E50'), `seed ${seed}`).toBe(false);
    }
    expect([...quarantined].sort()).toEqual(['mail', 'web']);
  });

  it('deals E23 and E42 in every run, E11 from three repairable ones on, no E42 on NETZ', () => {
    for (const trap of [true, false]) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const crashed = 3 + (seed % 3);
        const state = deal(defOf({ crashed, trap }), seed);
        const codes = downOf(state).map((s) => state.services[s].code);
        const repairable = codes.filter((code) => code !== 'E50');
        expect(repairable, `seed ${seed}`).toEqual(expect.arrayContaining(['E23', 'E42']));
        if (repairable.length >= 3) {
          expect(repairable, `seed ${seed}`).toContain('E11');
        }
        expect(state.services.netz.code, `seed ${seed}`).not.toBe('E42');
      }
    }
  });

  it('mixes the power of the services down: one without, one with where there are two', () => {
    const switchedOn = new Set<Service>();
    const switchedOff = new Set<Service>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const state = deal(defOf({ crashed: 3 + (seed % 3) }), seed);
      const repairable = downOf(state).filter((s) => state.services[s].code !== 'E50');
      const on = repairable.filter((s) => state.services[s].power);
      expect(on.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(on.length, `seed ${seed}`).toBeLessThan(repairable.length);
      on.forEach((s) => switchedOn.add(s));
      repairable.filter((s) => !state.services[s].power).forEach((s) => switchedOff.add(s));
    }
    // Every service is down with power in some run and without in another.
    expect([...switchedOn].sort()).toEqual([...SERVICES].sort());
    expect([...switchedOff].sort()).toEqual([...SERVICES].sort());
  });
});

describe('servers commands', () => {
  it('turns away a command at the rack, a switch at the terminal, and either from nowhere', () => {
    const state = lab({ db: DOWN('E11') });
    expect(() => send(state, { cmd: 'start', service: 'db' }, 'b')).toThrow(GameError);
    expect(() => send(state, { cmd: 'start', service: 'db' }, 'b')).toThrow(
      'Befehle nimmt nur das Terminal an.',
    );
    expect(() => send(state, { power: 'db', on: false }, 'a')).toThrow(
      'Strom schaltet nur das Rack.',
    );
    const nowhere = { ...ctx('a'), console: null };
    const start = { cmd: 'start', service: 'db' } as const;
    expect(() => serversModule.apply(defOf(), state, start, 'op', nowhere)).toThrow(
      'Eingabe nur am Pult.',
    );
  });

  it('turns away a command while nobody else is at the rack, a switch at the terminal', () => {
    const state = lab({ db: DOWN('E11') });
    // The solo walk: counted at both consoles at once is still nobody else there.
    for (const alone of [
      { a: ['op'], b: [] },
      { a: ['op'], b: ['op'] },
    ]) {
      for (const cmd of ['start', 'restart'] as const) {
        expect(() => send(state, { cmd, service: 'db' }, 'a', alone)).toThrow(
          'Am Rack steht niemand.',
        );
      }
    }
    for (const alone of [
      { a: [], b: ['pt'] },
      { a: ['pt'], b: ['pt'] },
    ]) {
      expect(() => send(state, { power: 'db', on: false }, 'b', alone)).toThrow(
        'Am Terminal steht niemand.',
      );
    }
    // A reader at the rules does not stand at the rack.
    const reading = { ...ctx('a', { a: ['op'], b: [] }), readers: ['rd'] };
    const start = { cmd: 'start', service: 'db' } as const;
    expect(() => serversModule.apply(defOf(), state, start, 'op', reading)).toThrow(
      'Am Rack steht niemand.',
    );
    expect(type(state, 'start', 'db').state.services.db.running).toBe(true);
  });

  it('takes status as a look at the table: nothing changes, nothing is logged, no alarm', () => {
    const state = lab({ db: DOWN('E23') });
    for (const atConsoles of [MANNED, { a: ['op'], b: [] }]) {
      const result = send(state, { cmd: 'status' }, 'a', atConsoles);
      expect(result).toEqual({ state, solved: false, penalty: null });
      expect(result.state).toBe(state);
    }
  });

  it('turns away a start of a running service, and takes nothing but its own inputs', () => {
    expect(() => type(lab(), 'start', 'dns')).toThrow('DNS läuft schon.');
    for (const input of [
      { cmd: 'start' },
      { cmd: 'stop', service: 'dns' },
      { cmd: 'start', service: 'ftp' },
      { cmd: 'status', service: 'dns' },
      { power: 'dns' },
      { power: 'dns', on: 'an' },
      { power: 'dns', on: true, cmd: 'start' },
      {},
    ]) {
      expect(serversModule.inputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
    expect(serversModule.inputSchema.parse({ cmd: 'status' })).toEqual({ cmd: 'status' });
  });

  it('fails a start without power: an alarm, a line in the log, the service down as it was', () => {
    const state = lab({ db: DOWN('E11', false) });
    const result = type(state, 'start', 'db');
    expect(result.penalty).toBe('Serverraum: kein Strom');
    expect(result.solved).toBe(false);
    expect(result.state.services.db).toEqual(state.services.db);
    expect(printed(result.state)).toEqual(['[fail] db: kein Strom']);
    expect(result.state.log[0]?.n).toBe(1);
  });

  it('fails a start while a dependency is down, naming the first one down', () => {
    const state = lab({ auth: DOWN('E11'), db: DOWN('E11'), web: DOWN('E11') });
    const result = type(state, 'start', 'web');
    expect(result.penalty).toBe('Serverraum: Abhängigkeit läuft nicht');
    expect(printed(result.state)).toEqual(['[fail] web: auth läuft nicht']);
    expect(result.state.services.web).toEqual(state.services.web);
    // A dependency of a dependency is no business of the start: AUTH runs here, NETZ is down.
    const deep = lab({ netz: DOWN('E11'), web: DOWN('E11') });
    expect(type(deep, 'start', 'web')).toMatchObject({ penalty: null, state: { logged: 1 } });
  });

  it('starts an E11 at once: [ OK ] in the log, its code gone, no alarm', () => {
    const result = type(lab({ dns: DOWN('E11') }), 'start', 'dns');
    expect(result.penalty).toBeNull();
    expect(result.state.services.dns).toMatchObject({ running: true, code: null, bootedAt: 2 });
    expect(printed(result.state)).toEqual(['[ok] dns läuft']);
  });

  it('keeps an E23 down until its switch went on since the crash: off and on, or on', () => {
    const powered = lab({ dns: DOWN('E23') });
    const stays = type(powered, 'start', 'dns');
    expect(stays.penalty).toBe('Serverraum: Fehler bleibt');
    expect(printed(stays.state)).toEqual(['[fail] dns: Fehler bleibt: E23']);
    // Off alone is no cycle.
    const off = flip(powered, 'dns', false).state;
    expect(type(off, 'start', 'dns').penalty).toBe('Serverraum: kein Strom');
    const cycled = flip(off, 'dns', true).state;
    expect(type(cycled, 'start', 'dns')).toMatchObject({ penalty: null, state: { logged: 3 } });
    const dark = lab({ dns: DOWN('E23', false) });
    expect(type(flip(dark, 'dns', true).state, 'start', 'dns').penalty).toBeNull();
  });

  it('keeps an E42 down until every dependency was started since the crash', () => {
    const state = lab({ auth: DOWN('E42') });
    const stays = type(state, 'start', 'auth');
    expect(stays.penalty).toBe('Serverraum: Fehler bleibt');
    expect(printed(stays.state)).toEqual(['[fail] auth: Fehler bleibt: E42']);
    // One dependency restarted is not every one.
    const half = type(state, 'restart', 'dns').state;
    expect(type(half, 'start', 'auth').penalty).toBe('Serverraum: Fehler bleibt');
    const both = played(state, [
      [{ cmd: 'restart', service: 'netz' }, 'a'],
      [{ cmd: 'restart', service: 'dns' }, 'a'],
    ]);
    expect(type(both, 'start', 'auth').penalty).toBeNull();
    // A dependency down at the crash and started after it counts as well.
    const later = lab({ dns: DOWN('E11'), auth: DOWN('E42') });
    const fresh = played(later, [
      [{ cmd: 'restart', service: 'netz' }, 'a'],
      [{ cmd: 'start', service: 'dns' }, 'a'],
    ]);
    expect(type(fresh, 'start', 'auth').penalty).toBeNull();
  });

  it('restarts a running service: whatever runs and depends on it goes down, no alarm', () => {
    const state = lab({ mail: DOWN('E11') });
    const result = type(state, 'restart', 'netz');
    expect(result.penalty).toBeNull();
    // The services that list NETZ go down; WEB, needing only AUTH and DB, runs on.
    expect(downOf(result.state)).toEqual(['dns', 'db', 'auth', 'mail']);
    for (const s of ['dns', 'db', 'auth'] as const) {
      expect(result.state.services[s].code).toBe('E11');
      expect(result.state.services[s].crashedAt).toBeLessThan(result.state.services.netz.bootedAt);
    }
    expect(printed(result.state)).toEqual([
      '[warn] dns abgestürzt: E11',
      '[warn] db abgestürzt: E11',
      '[warn] auth abgestürzt: E11',
      '[ok] netz neu gestartet',
    ]);
    const leaf = type(state, 'restart', 'web');
    expect(printed(leaf.state)).toEqual(['[ok] web neu gestartet']);
  });

  it('restarts a service that is down as a start: the same checks, the same alarms', () => {
    expect(type(lab({ db: DOWN('E11', false) }), 'restart', 'db').penalty).toBe(
      'Serverraum: kein Strom',
    );
    expect(type(lab({ dns: DOWN('E23') }), 'restart', 'dns').penalty).toBe(
      'Serverraum: Fehler bleibt',
    );
    const up = type(lab({ dns: DOWN('E11') }), 'restart', 'dns');
    expect(up.penalty).toBeNull();
    expect(printed(up.state)).toEqual(['[ok] dns läuft']);
    // Nothing ran on it, so nothing that depends on it goes down.
    expect(downOf(up.state)).toEqual([]);
  });
});

describe('servers rack', () => {
  it('takes a running service down (E11) as its switch goes off, without an alarm', () => {
    const result = flip(lab(), 'dns', false);
    expect(result.penalty).toBeNull();
    expect(result.state.services.dns).toMatchObject({ running: false, code: 'E11', power: false });
    expect(printed(result.state)).toEqual(['[info] dns: Strom aus', '[warn] dns abgestürzt: E11']);
    // What runs on DNS keeps running.
    expect(downOf(result.state)).toEqual(['dns']);
  });

  it('only switches a service that is down, and turned on, notes the moment', () => {
    const state = lab({ db: DOWN('E42', false) });
    const on = flip(state, 'db', true);
    expect(on.penalty).toBeNull();
    expect(on.state.services.db).toMatchObject({ running: false, code: 'E42', power: true });
    expect(on.state.services.db.poweredAt).toBeGreaterThan(state.services.db.crashedAt);
    const off = flip(on.state, 'db', false);
    expect(off.state.services.db).toMatchObject({ running: false, code: 'E42', power: false });
    expect(printed(off.state)).toEqual(['[info] db: Strom an', '[info] db: Strom aus']);
  });

  it('leaves everything as it was for a switch already where it is sent', () => {
    const state = lab({ db: DOWN('E11', false) });
    expect(flip(state, 'db', false)).toEqual({ state, solved: false, penalty: null });
    expect(flip(state, 'dns', true).state).toBe(state);
  });
});

describe('servers quarantine', () => {
  const trapped = (seed: number): ServersState => ({
    ...lab({ mail: DOWN('E50') }),
    seed,
  });

  it('infects a running service with a fresh code on a start, as the seed draws it', () => {
    const victims = new Set<Service>();
    const codes = new Set<ServerCode>();
    for (let seed = 0; seed < 200; seed++) {
      const state = trapped(seed);
      const result = type(state, 'start', 'mail');
      expect(result.penalty).toBe('Serverraum: Quarantäne verletzt');
      // The draw is the seed's: the same state, the same victim and code.
      expect(type(state, 'start', 'mail')).toEqual(result);
      const fallen = downOf(result.state).filter((s) => s !== 'mail');
      expect(fallen, `seed ${seed}`).toHaveLength(1);
      const [victim] = fallen as [Service];
      const code = result.state.services[victim].code;
      expect(['E11', 'E23', 'E42']).toContain(code);
      expect(result.state.services.mail).toEqual(state.services.mail);
      expect(result.state.infections).toBe(1);
      expect(printed(result.state)).toEqual([
        '[fail] mail: Quarantäne verletzt',
        `[fail] ${victim} infiziert: ${code}`,
      ]);
      victims.add(victim);
      codes.add(code ?? 'E11');
    }
    expect([...victims].sort()).toEqual(['auth', 'db', 'dns', 'netz', 'web']);
    expect([...codes].sort()).toEqual(['E11', 'E23', 'E42']);
  });

  it('draws every infection from a stream of its own', () => {
    let differs = 0;
    for (let seed = 0; seed < 50; seed++) {
      const once = type(trapped(seed), 'start', 'mail').state;
      const [first] = downOf(once).filter((s) => s !== 'mail');
      if (first === undefined) {
        throw new Error(`seed ${seed}: the first start infected nothing`);
      }
      // The victim back up, so that the second draw chooses from what the first did.
      const healed = { ...once, services: { ...once.services, [first]: UP } };
      const twice = type(healed, 'start', 'mail').state;
      expect(twice.infections).toBe(2);
      const [second] = downOf(twice).filter((s) => s !== 'mail');
      const same = second === first && twice.services[first].code === once.services[first].code;
      differs += Number(!same);
    }
    expect(differs).toBeGreaterThan(25);
  });

  it('infects nothing where nothing runs, nor without power or with a dependency down', () => {
    const alone = lab({
      netz: DOWN('E50'),
      dns: DOWN('E11'),
      db: DOWN('E11'),
      auth: DOWN('E11'),
      web: DOWN('E11'),
      mail: DOWN('E11'),
    });
    const lonely = type(alone, 'start', 'netz');
    expect(lonely.penalty).toBe('Serverraum: Quarantäne verletzt');
    expect(printed(lonely.state)).toEqual(['[fail] netz: Quarantäne verletzt']);
    expect(downOf(lonely.state)).toHaveLength(6);
    const dark = type(lab({ mail: DOWN('E50', false) }), 'start', 'mail');
    expect(dark.penalty).toBe('Serverraum: kein Strom');
    expect(dark.state.infections).toBe(0);
    const cut = type(lab({ auth: DOWN('E11'), mail: DOWN('E50') }), 'start', 'mail');
    expect(cut.penalty).toBe('Serverraum: Abhängigkeit läuft nicht');
    expect(downOf(cut.state)).toEqual(['auth', 'mail']);
  });

  it('is solved once every service runs but the quarantined one, standing without power', () => {
    const live = lab({ mail: DOWN('E50') });
    expect(type(live, 'restart', 'web').solved).toBe(false);
    expect(flip(live, 'mail', false).solved).toBe(true);
    const last = lab({ mail: DOWN('E50', false), db: DOWN('E11') });
    expect(type(last, 'start', 'db').solved).toBe(true);
    // Without the trap every service has to run.
    expect(type(lab({ db: DOWN('E11') }), 'start', 'db').solved).toBe(true);
    expect(flip(lab({ mail: DOWN('E11') }), 'mail', false).solved).toBe(false);
  });
});

describe('servers views', () => {
  const state = (seed: number) => {
    const dealt = deal(defOf(), seed);
    // A few lines in the log: a switch thrown, a start failed.
    const thrown = flip(dealt, 'netz', dealt.services.netz.power ? false : true).state;
    return { dealt, state: thrown };
  };

  it('show the terminal its table with codes and the log, never an LED', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { state: now } = state(seed);
      const atA = seenFrom(now, AT_STATION);
      expect(atA).toEqual({
        kind: 'servers',
        role: 'terminal',
        rows: SERVICES.map((service) => {
          const { running, code, power } = now.services[service];
          return { service, running, code, power };
        }),
        log: now.log,
        rack: null,
      });
      const wire = JSON.stringify(atA);
      expect(wire).not.toMatch(/"(led|rack)":\[|"led"|"green"|"red"|"bootedAt"|"seed"/);
    }
  });

  it('show the rack its switches and LEDs, never a code nor the log', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { state: now } = state(seed);
      const atB = seenFrom(now, AT_CONSOLE_B);
      expect(atB).toMatchObject({ kind: 'servers', role: 'rack', rows: null, log: null });
      expect(atB.rack).toEqual(
        SERVICES.map((service) => {
          const it = now.services[service];
          const led = !it.power ? 'off' : it.running ? 'green' : 'red';
          return { service, power: it.power, led };
        }),
      );
      const wire = JSON.stringify(atB);
      expect(wire).not.toMatch(/E(11|23|42|50)|"code"|"(rows|log)":\[|"running"|Strom|läuft/);
    }
  });

  it('light the rack green while a service runs, red while down with power, dark without', () => {
    const now = lab({ db: DOWN('E11'), web: DOWN('E23', false), mail: DOWN('E50') });
    const leds = seenFrom(now, AT_CONSOLE_B).rack?.map((unit) => unit.led);
    expect(leds).toEqual(['green', 'green', 'red', 'green', 'off', 'red']);
  });

  it('show the book and anybody away from the consoles nothing of the room', () => {
    const { state: now } = state(3);
    for (const away of [AT_BOOK, ELSEWHERE]) {
      expect(seenFrom(now, away)).toEqual({
        kind: 'servers',
        role: null,
        rows: null,
        log: null,
        rack: null,
      });
    }
  });

  it('show the audience everything: the table with its codes, the log and the rack', () => {
    const { state: now } = state(4);
    const watched = seenFrom(now, AUDIENCE);
    expect(watched).toMatchObject({ role: null, log: now.log });
    expect(watched.rows).toEqual(seenFrom(now, AT_STATION).rows);
    expect(watched.rack).toEqual(seenFrom(now, AT_CONSOLE_B).rack);
  });

  it(`keep the log's last ${LOG_LINES} lines, each numbered over the run`, () => {
    const thrown = Array.from({ length: 9 }, (_, k): [ServersInput, ConsoleId] => [
      { power: 'db', on: k % 2 === 0 },
      'b',
    ]);
    const long = played(lab({ db: DOWN('E11', false) }), thrown);
    expect(long.logged).toBe(9);
    expect(long.log).toHaveLength(LOG_LINES);
    expect(long.log.map((line) => line.n)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(seenFrom(long, AT_STATION).log).toEqual(long.log);
  });
});

/** A move as a line of a walkthrough: „B dns aus", „A restart netz". */
function said({ by, input }: Move<ServersInput>): string {
  if ('power' in input) {
    return `B ${input.power} ${input.on ? 'an' : 'aus'}`;
  }
  const command = input.cmd === 'status' ? 'status' : `${input.cmd} ${input.service}`;
  return `${by === 'partner' ? 'B' : 'A'} ${command}`;
}

/** The services the terminal shows down, as the views have them. */
const rowsDown = (rows: ServerRow[] | null): Service[] =>
  (rows ?? []).filter((row) => !row.running).map((row) => row.service);

describe('servers solver', () => {
  it(`solves ${SEEDS} instances of every size, with and without the trap, from both views`, () => {
    expect(serversModule.usesEdgework).toBe(false);
    for (const crashed of [3, 4, 5]) {
      for (const trap of [true, false]) {
        const taken = new Set<number>();
        for (let seed = 0; seed < SEEDS; seed++) {
          taken.add(playInstance(defOf({ crashed, trap }), seed));
        }
        // A start each at least, and never more than a procedure each with all it takes down.
        expect(Math.min(...taken)).toBeGreaterThanOrEqual(crashed + 1);
        expect(Math.max(...taken)).toBeLessThanOrEqual(20);
      }
    }
  });

  it('switches a quarantined service off first', () => {
    const state = lab({ db: DOWN('E11'), mail: DOWN('E50') });
    expect(serversModule.solve(defOf(), views(state), null)).toEqual([
      { by: 'partner', input: { power: 'mail', on: false } },
    ]);
    const off = flip(state, 'mail', false).state;
    expect(serversModule.solve(defOf(), views(off), null)).toEqual([
      { by: 'operator', input: { cmd: 'start', service: 'db' } },
    ]);
  });

  it('brings the first service down up by its code: power, cycle, restarts, start', () => {
    const plan = (services: Partial<Record<Service, Partial<ServiceState>>>) =>
      serversModule.solve(defOf(), views(lab(services)), null).map(said);
    expect(plan({ db: DOWN('E11', false), web: DOWN('E23') })).toEqual(['B db an', 'A start db']);
    expect(plan({ dns: DOWN('E23') })).toEqual(['B dns aus', 'B dns an', 'A start dns']);
    expect(plan({ dns: DOWN('E23', false) })).toEqual(['B dns an', 'A start dns']);
    expect(plan({ auth: DOWN('E42', false) })).toEqual([
      'B auth an',
      'A restart netz',
      'A restart dns',
      'A start auth',
    ]);
    // DNS before AUTH, though the table names AUTH first: a restart of DNS takes AUTH down.
    expect(DEPENDS_ON.mail).toEqual(['auth', 'dns']);
    expect(plan({ mail: DOWN('E42') })).toEqual([
      'A restart dns',
      'A restart auth',
      'A start mail',
    ]);
    expect(plan({})).toEqual([]);
    expect(plan({ mail: DOWN('E50', false) })).toEqual([]);
  });

  it('needs the terminal at console a and the rack at console b', () => {
    const state = lab({ db: DOWN('E11') });
    const book = seenFrom(state, AT_BOOK);
    expect(() => serversModule.solve(defOf(), { operator: book, reader: book }, null)).toThrow(
      'servers "serverraum": solving needs the terminal\'s view at console a and the rack\'s at ' +
        'console b',
    );
    const terminal = seenFrom(state, AT_STATION);
    expect(() =>
      serversModule.solve(defOf(), { operator: terminal, partner: book, reader: book }, null),
    ).toThrow(/solving needs/);
  });

  it('plans from what the views show, and nothing else', () => {
    const state = deal(defOf(), 17);
    const shown = views(state);
    // A state the views cannot tell apart from this one plans the same.
    const hidden = { ...state, seed: 99, clock: 40, infections: 3 };
    expect(serversModule.solve(defOf(), views(hidden), null)).toEqual(
      serversModule.solve(defOf(), shown, null),
    );
    expect(rowsDown(shown.operator.rows)).toEqual(downOf(state));
  });
});

type ExampleBlock = Extract<ManualBlock, { kind: 'example' }>;
type TableBlock = Extract<ManualBlock, { kind: 'table' }>;

const blocksOf = (def: ServersDef): ManualBlock[] =>
  serversModule.manual(def).flatMap((section) => section.blocks);

describe('servers manual', () => {
  it('prints the drawing, the device, three tables, the rules, the example and the penalty', () => {
    const [section, ...more] = serversModule.manual(defOf({ penaltySec: 25 }));
    expect(more).toEqual([]);
    expect(section?.heading).toBe('Serverraum');
    const blocks = section?.blocks ?? [];
    expect(blocks.map((block) => block.kind)).toEqual([
      'figure',
      'p',
      'table',
      'table',
      'table',
      'rules',
      'example',
      'p',
    ]);
    expect(blocks[0]).toEqual({
      kind: 'figure',
      of: 'servers',
      caption: 'Abb. 1 — Dienste und Rack',
    });
    const device = blocks[1]?.kind === 'p' ? blocks[1].text : '';
    expect(device).toMatch(/^Pult A ist ein Terminal: Es zeigt jeden der sechs Dienste mit /);
    expect(device).toMatch(/ Pult B ist ein Rack mit einem Stromschalter und einer LED je Dienst;/);
    expect(blocks.at(-1)).toEqual({
      kind: 'p',
      text: 'Fehlgriff: Alarm, −25 s. Ein Start mit E50 infiziert dazu einen laufenden Dienst.',
    });
  });

  it('prints the dependencies, the commands and the codes as the station knows them', () => {
    const tables = blocksOf(defOf()).filter((block): block is TableBlock => block.kind === 'table');
    const [dependencies, commands, codes] = tables;
    expect(dependencies).toEqual({
      kind: 'table',
      head: ['Dienst', 'hängt ab von'],
      rows: [
        ['NETZ', '—'],
        ['DNS', 'NETZ'],
        ['DB', 'NETZ'],
        ['AUTH', 'NETZ, DNS'],
        ['WEB', 'AUTH, DB'],
        ['MAIL', 'AUTH, DNS'],
      ],
    });
    expect(commands?.rows.map(([command]) => command)).toEqual([
      'start <dienst>',
      'restart <dienst>',
      'status',
    ]);
    expect(codes).toEqual({
      kind: 'table',
      head: ['Code', 'Bedeutung'],
      rows: [
        ['E11', 'Neustart genügt: start'],
        ['E23', 'Strom aus, dann an, dann start'],
        ['E42', 'Erst jede Abhängigkeit per restart, dann start'],
        ['E50', 'Quarantäne: Strom aus und nie starten — infiziert sonst einen weiteren Dienst'],
      ],
    });
    const meanings = codes?.rows.map((row) => row[1]);
    expect(SERVER_CODES.map((code) => CODE_MEANINGS[code])).toEqual(meanings);
  });

  it('sets out the order, the rack and the restart as rules, and when the room is online', () => {
    const rules = blocksOf(defOf()).find((block) => block.kind === 'rules');
    expect(rules).toEqual({
      kind: 'rules',
      items: [
        'Wenn ein Dienst keinen Strom hat, startet er nicht.',
        'Wenn nicht alle Abhängigkeiten eines Dienstes laufen, startet er nicht.',
        'Wenn ein Start nicht gelingt, bleibt der Dienst stehen, und sein Code bleibt.',
        'Wenn ein laufender Dienst den Strom verliert, stürzt er ab (E11).',
        'Wenn ein laufender Dienst per restart neu startet, stürzen die laufenden Dienste ab, ' +
          'die von ihm abhängen (E11).',
        'Wenn jeder Dienst läuft, außer denen mit E50, und jeder Dienst mit E50 ohne Strom ist, ' +
          'ist der Serverraum wieder online.',
      ],
    });
  });

  it('hangs on the def alone: the same pages for a copy, another price for another penalty', () => {
    const def = defOf();
    expect(serversModule.manual(structuredClone(def))).toEqual(serversModule.manual(def));
    expect(serversModule.manual(defOf({ crashed: 5, trap: false }))).toEqual(
      serversModule.manual(def),
    );
    const dearer = blocksOf(defOf({ penaltySec: 45 }));
    expect(dearer.slice(0, -1)).toEqual(blocksOf(def).slice(0, -1));
    expect(dearer.at(-1)).toMatchObject({
      text: expect.stringMatching(/^Fehlgriff: Alarm, −45 s\./),
    });
  });

  it('works its example the way the station does: a power cycle, then the restarts of E42', () => {
    const boxes = blocksOf(defOf()).filter(
      (block): block is ExampleBlock => block.kind === 'example',
    );
    expect(boxes.map((box) => box.lines)).toEqual([[...EXAMPLE]]);
    // What line 1 saw: NETZ running, DNS E23 and AUTH E42 with power, the rest without.
    const seen = lab({
      dns: DOWN('E23'),
      db: DOWN('E11', false),
      auth: DOWN('E42'),
      web: DOWN('E11', false),
      mail: DOWN('E11', false),
    });
    expect(EXAMPLE[0]).toBe(
      'Terminal: NETZ läuft; DNS FEHLER E23 und AUTH FEHLER E42, beide mit Strom; der Rest ohne ' +
        'Strom.',
    );
    // Line 2: the cycle at the rack, then the start — the solver plans the same.
    expect(serversModule.solve(defOf(), views(seen), null).map(said)).toEqual([
      'B dns aus',
      'B dns an',
      'A start dns',
    ]);
    const cycled = played(seen, [
      [{ power: 'dns', on: false }, 'b'],
      [{ power: 'dns', on: true }, 'b'],
      [{ cmd: 'start', service: 'dns' }, 'a'],
    ]);
    expect(printed(cycled).at(-1)).toBe('[ok] dns läuft');
    expect(EXAMPLE[1]).toContain('[ OK ] dns läuft');
    // Line 3: the restart of NETZ takes DNS down, and only DNS; the restart of DNS starts it.
    const restarted = type(cycled, 'restart', 'netz').state;
    expect(downOf(restarted)).toEqual(['dns', 'db', 'auth', 'web', 'mail']);
    expect(restarted.services.dns.code).toBe('E11');
    expect(printed(restarted).slice(-2)).toEqual([
      '[warn] dns abgestürzt: E11',
      '[ok] netz neu gestartet',
    ]);
    const again = type(restarted, 'restart', 'dns');
    expect(again.penalty).toBeNull();
    expect(printed(again.state).at(-1)).toBe('[ok] dns läuft');
    // Line 4: AUTH starts, both its dependencies up since its crash.
    const auth = type(again.state, 'start', 'auth');
    expect(auth.penalty).toBeNull();
    expect(printed(auth.state).at(-1)).toBe('[ok] auth läuft');
    expect(EXAMPLE[3]).toBe('Dann start auth: [ OK ] auth läuft.');
    // Without the restarts the start would have failed.
    expect(type(cycled, 'start', 'auth').penalty).toBe('Serverraum: Fehler bleibt');
  });
});

/**
 * A corridor lab for a crew of three around the Serverraum: the terminal at
 * (6,1), the rack at (13,1), the book between them.
 */
function serversLab(): Mission {
  return parseMission({
    id: 'serverlabor',
    title: 'Serverlabor',
    players: { min: 3, max: 3 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [{ type: 'servers', id: 'netzwerk', title: 'Leitnetz' }],
    map: {
      tiles: ['################', '#..............#', '#..............#', '################'],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
      ],
      stations: [
        { puzzleId: 'netzwerk', x: 6, y: 1, console: 'a' },
        { puzzleId: 'netzwerk', x: 13, y: 1, console: 'b' },
      ],
      manuals: [
        {
          id: 'buch',
          kind: 'book',
          label: 'HANDBUCH',
          puzzleIds: ['netzwerk'],
          spots: [{ x: 9, y: 2 }],
        },
      ],
      exit: { x: 14, y: 2 },
    },
  });
}

const CONSOLE_B = stationKey({ puzzleId: 'netzwerk', console: 'b' });

/** Anna (p1) at the terminal, Ben (p2) at the rack, Cleo (p3) at the book; Anna switches it on. */
function serversRun(seed = 11): GameState {
  const here = standing(started(serversLab(), seed), {
    stations: { netzwerk: ['p1'], [CONSOLE_B]: ['p2'] },
    manuals: { buch: ['p3'] },
  });
  return applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
}

function serversOf(state: GameState, playerId: string) {
  const puzzle = viewFor(state, playerId).puzzle;
  if (puzzle?.kind !== 'servers') {
    throw new Error('expected the Serverraum');
  }
  return puzzle;
}

const input = (playerId: string, move: ServersInput, at = T0 + 1000): Action => ({
  type: 'puzzle-input',
  playerId,
  at,
  input: move,
});

/** The first service the terminal shows down without power, and a service it shows running. */
function picks(state: GameState): { dark: Service; up: Service } {
  const rows = serversOf(state, 'p1').rows ?? [];
  const dark = rows.find((row) => !row.running && !row.power)?.service;
  const up = rows.find((row) => row.running)?.service;
  if (dark === undefined || up === undefined) {
    throw new Error('expected a service down without power and one running');
  }
  return { dark, up };
}

describe('servers in a run', () => {
  it('shows each console its own part over the wire, the book nothing of the room', () => {
    const state = serversRun();
    expect(serversOf(state, 'p1')).toMatchObject({ console: 'a', role: 'terminal', manual: null });
    expect(serversOf(state, 'p2')).toMatchObject({ console: 'b', role: 'rack', manual: null });
    expect(serversOf(state, 'p3')).toMatchObject({ console: null, role: null, rows: null });
    expect(serversOf(state, 'p3').manual).toEqual(serversModule.manual(defOf()));
    const wire = (playerId: string): string => JSON.stringify(viewFor(state, playerId).puzzle);
    expect(wire('p1')).toMatch(/E(11|23|42|50)/);
    expect(wire('p1')).not.toMatch(/"rack":\[|"led"/);
    expect(wire('p2')).toMatch(/"led":"(green|red|off)"/);
    expect(wire('p2')).not.toMatch(/E(11|23|42|50)|"code"|"(rows|log)":\[/);
    // The book prints tables of its own; nothing of the instance comes with them.
    expect(serversOf(state, 'p3')).toMatchObject({ rows: null, log: null, rack: null });
    expect(wire('p3')).not.toMatch(/"(led|running|power|tag)"/);
    const watched = viewForSpectator(state).puzzle;
    expect(watched).toMatchObject({ kind: 'servers', role: null });
    expect(watched?.kind === 'servers' ? [watched.rows, watched.rack] : []).toEqual([
      serversOf(state, 'p1').rows,
      serversOf(state, 'p2').rack,
    ]);
  });

  it('refuses the solo walk without an alarm, at the terminal and at the rack', () => {
    const state = serversRun();
    const { dark } = picks(state);
    // Ben leaves the rack for the book: Anna's start is turned away, the clock untouched.
    const noRack = standing(state, {
      stations: { netzwerk: ['p1'] },
      manuals: { buch: ['p2', 'p3'] },
    });
    expect(() => applyAction(noRack, input('p1', { cmd: 'start', service: dark }))).toThrow(
      'Am Rack steht niemand.',
    );
    // Anna leaves the terminal for the book: Ben's switch is turned away.
    const noTerminal = standing(state, {
      stations: { [CONSOLE_B]: ['p2'] },
      manuals: { buch: ['p1', 'p3'] },
    });
    expect(() => applyAction(noTerminal, input('p2', { power: dark, on: true }))).toThrow(
      'Am Terminal steht niemand.',
    );
    const thrown = applyAction(state, input('p2', { power: dark, on: true }));
    expect(serversOf(thrown, 'p2').rack?.find((unit) => unit.service === dark)?.power).toBe(true);
    expect(thrown.penaltySeq).toBe(0);
    expect(thrown.deadlineAt).toBe(state.deadlineAt);
  });

  it('charges a failed start once, at the def’s price, to whoever typed it', () => {
    const state = serversRun();
    const { dark } = picks(state);
    const failed = applyAction(state, input('p1', { cmd: 'start', service: dark }));
    expect(failed.penaltySeq).toBe(1);
    expect(failed.deadlineAt).toBe((state.deadlineAt ?? 0) - 20_000);
    expect(failed.credits['p1']?.alarms).toBe(1);
    expect(failed.credits['p2']?.alarms).toBe(0);
    expect(failed.events.at(-1)).toMatchObject({
      kind: 'penalty',
      label: 'Serverraum: kein Strom',
      seconds: 20,
    });
    expect(serversOf(failed, 'p1').log?.at(-1)).toMatchObject({
      tag: 'fail',
      text: `${dark}: kein Strom`,
    });
  });

  it('is solved by the solver from the clients’ views, with both consoles credited', () => {
    let state = serversRun();
    for (let round = 1; state.currentPuzzleIndex === 0 && round < 40; round++) {
      const seen = {
        operator: serversOf(state, 'p1'),
        partner: serversOf(state, 'p2'),
        reader: serversOf(state, 'p3'),
      };
      const moves = serversModule.solve(defOf(), seen, null);
      state = moves
        .map((move) => input(move.by === 'partner' ? 'p2' : 'p1', move.input, T0 + round * 1000))
        .reduce(applyAction, state);
    }
    expect(state.currentPuzzleIndex).toBe(1);
    expect(state.penaltySeq).toBe(0);
    expect(state.events.some((e) => e.label === 'Leitnetz gelöst')).toBe(true);
    expect(state.credits['p1']?.operated).toBe(1);
    expect(state.credits['p2']?.operated).toBe(1);
  });
});

const fixtures = new URL('../../../tools/fixtures/', import.meta.url);
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));

/** The harness's pinned walkthrough: the seed, the table the terminal opens on, the moves. */
interface PinnedPlan {
  seed: number;
  rows: ServerRow[];
  moves: Move<ServersInput>[];
}

describe('the harness’s scratch mission', () => {
  const mission = parseMission(read('servers-probe.json'));
  const plan = read('servers-plan.json') as PinnedPlan;

  it('is a Systemcheck-sized lab: two starts, the consoles apart, a locker, a way out', () => {
    expect(mission).toMatchObject({ id: 'custom-serverprobe', title: 'Serverprobe' });
    expect(mission.players).toEqual({ min: 2, max: 2 });
    expect(mission.map.spawns).toHaveLength(2);
    const [def] = mission.puzzles;
    expect(def).toMatchObject({ type: 'servers', crashed: 4, trap: true });
    const consoles = mission.map.stations.filter((s) => s.puzzleId === def?.id);
    const [a, b] = consoles;
    expect(consoles.map((s) => s.console)).toEqual(['a', 'b']);
    const apart = Math.abs((a?.x ?? 0) - (b?.x ?? 0)) + Math.abs((a?.y ?? 0) - (b?.y ?? 0));
    expect(apart).toBeGreaterThan(4);
    expect(mission.map.manuals).toMatchObject([{ kind: 'locker', puzzleIds: [def?.id] }]);
    expect(mission.map.exit).toBeDefined();
  });

  it('opens on the table the pinned plan names, and the plan solves it without an alarm', () => {
    const crew = ['p1', 'p2'];
    const here = standing(started(mission, plan.seed), {
      stations: {
        serverraum: ['p1'],
        [stationKey({ puzzleId: 'serverraum', console: 'b' })]: ['p2'],
      },
    });
    let state = applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
    const terminal = viewFor(state, 'p1').puzzle;
    expect(terminal?.kind === 'servers' ? terminal.rows : null).toEqual(plan.rows);
    for (const [i, move] of plan.moves.entries()) {
      const by = move.by === 'partner' ? crew[1] : crew[0];
      state = applyAction(state, input(by ?? 'p1', move.input, T0 + 1000 * (i + 1)));
    }
    expect(state.penaltySeq).toBe(0);
    expect(state.currentPuzzleIndex).toBe(1);
  });

  it('carries the solver’s own plan for that table', () => {
    const def = mission.puzzles[0] as ServersDef;
    let now = serversModule.init(def, mulberry32(plan.seed), ctx(null));
    expect(seenFrom(now, AT_STATION).rows).toEqual(plan.rows);
    const moves: Move<ServersInput>[] = [];
    let solved = false;
    for (let round = 0; !solved && round < 20; round++) {
      for (const move of serversModule.solve(defOf(), views(now), null)) {
        moves.push(move);
        const result = send(now, move.input, move.by === 'partner' ? 'b' : 'a');
        now = result.state;
        solved = result.solved;
      }
    }
    expect(solved).toBe(true);
    // Regenerate tools/fixtures/servers-plan.json from `moves` when the module changes.
    expect(plan.moves).toEqual(moves);
  });
});
