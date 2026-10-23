import { z } from 'zod';
import { fail } from '../errors.js';
import { mulberry32, shuffle, type Rng } from '../rng.js';
import {
  commonDefShape,
  type ManualBlock,
  type Move,
  type PuzzleContext,
  type PuzzleModule,
} from './module.js';
import { costOf, labDocument, type TypePlate } from './printed.js';

/**
 * Serverraum: a station with two consoles in different places. Console a is
 * a terminal that lists the six services of the lab's network with their
 * state, error code and power, keeps a log and takes the commands `start`,
 * `restart` and `status`; console b is a rack with a power switch and an LED
 * for every service — green running, red down, dark without power — and no
 * code anywhere. The crew brings every service back in the order of the
 * printed dependencies, each by the procedure its code names: E11 a start,
 * E23 a power cycle at the rack first, E42 a restart of every dependency
 * first. E50 is quarantine: it stays powered off and is never started — a
 * start infects another running service with a fresh code. A start that
 * fails costs time and leaves the service down; a restart of a running
 * service takes down the running services that depend on it, and switching
 * a running service off takes it down, neither with an alarm. A command is
 * turned away, without an alarm, while nobody else stands at the rack, and a
 * switch while nobody else stands at the terminal: reading the codes here
 * and switching there takes two people.
 */

/** The services, every dependency listed before whatever needs it. */
export const SERVICES = ['netz', 'dns', 'db', 'auth', 'web', 'mail'] as const;
export type Service = (typeof SERVICES)[number];

/** What each service needs running before it starts, as the printed figure draws it. */
export const DEPENDS_ON: Readonly<Record<Service, readonly Service[]>> = {
  netz: [],
  dns: ['netz'],
  db: ['netz'],
  auth: ['netz', 'dns'],
  web: ['auth', 'db'],
  mail: ['auth', 'dns'],
};

export const SERVER_CODES = ['E11', 'E23', 'E42', 'E50'] as const;
export type ServerCode = (typeof SERVER_CODES)[number];

/** The printed code table: the procedure each code calls for. */
export const CODE_MEANINGS: Readonly<Record<ServerCode, string>> = {
  E11: 'Neustart genügt: start',
  E23: 'Strom aus, dann an, dann start',
  E42: 'Erst jede Abhängigkeit per restart, dann start',
  E50: 'Quarantäne: Strom aus und nie starten — infiziert sonst einen weiteren Dienst',
};

/** The codes a crash or an infection leaves behind; quarantine is only ever dealt at the start. */
const REPAIRABLE = ['E11', 'E23', 'E42'] as const satisfies readonly ServerCode[];

/**
 * The services nothing depends on. Only one of these can be in quarantine:
 * a quarantined dependency would keep what needs it down for good.
 */
const LEAVES: readonly Service[] = SERVICES.filter((service) =>
  SERVICES.every((other) => !DEPENDS_ON[other].includes(service)),
);

/** How many of the log's last lines the terminal shows, and the state keeps. */
export const LOG_LINES = 8;

/** A service as the terminal's table, the rack's plates and the printed rules name it. */
export const serviceName = (service: Service): string => service.toUpperCase();

const serviceSchema = z.enum(SERVICES);

const defSchema = z.strictObject({
  type: z.literal('servers'),
  ...commonDefShape,
  /** services down at the start, each with a code of the printed table */
  crashed: z.number().int().min(3).max(5).default(4),
  /** one of them in quarantine (E50), to be powered off and never started */
  trap: z.boolean().default(true),
  penaltySec: z.number().int().positive().default(20),
});
export type ServersDef = z.infer<typeof defSchema>;

export interface ServiceState {
  running: boolean;
  /** what its crash left behind; null while it runs */
  code: ServerCode | null;
  /** its switch at the rack */
  power: boolean;
  /** moments on the state's clock: its last start, its last crash, its switch last turned on */
  bootedAt: number;
  crashedAt: number;
  poweredAt: number;
}

/** One line of the terminal's log: `[ OK ] dns läuft`, `[FEHL] web: auth läuft nicht`. */
export interface ServerLogLine {
  /** counted from 1 over the whole run, so that a new line is told from an old one */
  n: number;
  /** ok a start, fail an alarm, warn a crash without one, info the rack's switches */
  tag: 'ok' | 'fail' | 'warn' | 'info';
  text: string;
}

export interface ServersState {
  type: 'servers';
  services: Record<Service, ServiceState>;
  /**
   * the last moment taken: every start, crash and switch turned on takes the
   * next, so that „since the crash" is a comparison of two of them
   */
  clock: number;
  /** what infections draw from, one stream each */
  seed: number;
  infections: number;
  /** the log's last LOG_LINES lines */
  log: ServerLogLine[];
  /** lines logged so far */
  logged: number;
}

const commandSchema = z.union([
  z.strictObject({ cmd: z.enum(['start', 'restart']), service: serviceSchema }),
  z.strictObject({ cmd: z.literal('status') }),
]);
const switchSchema = z.strictObject({ power: serviceSchema, on: z.boolean() });
const inputSchema = z.union([commandSchema, switchSchema]);
export type ServersInput = z.infer<typeof inputSchema>;
type Command = z.infer<typeof commandSchema>;
type Switch = z.infer<typeof switchSchema>;

/** A row of the terminal's status table: the service, whether it runs, its code, its power. */
export interface ServerRow {
  service: Service;
  running: boolean;
  code: ServerCode | null;
  power: boolean;
}

/** A rack's LED: green while the service runs, red while it is down with power, dark without. */
export type ServerLed = 'green' | 'red' | 'off';

/** A unit of the rack: the service's plate, its switch and its LED. */
export interface RackUnit {
  service: Service;
  power: boolean;
  led: ServerLed;
}

/**
 * The open Serverraum as one player sees it. The terminal shows no LED and
 * the rack no code; the book and everybody away from the consoles get
 * nothing of the instance, the audience all of it.
 */
export interface ServersView {
  kind: 'servers';
  /** the viewer's console: the terminal at a, the rack at b; null elsewhere and for the audience */
  role: 'terminal' | 'rack' | null;
  /**
   * the status table, every service in the order of SERVICES — at the
   * terminal, and for the audience
   */
  rows: ServerRow[] | null;
  /** the log's last lines — at the terminal, and for the audience */
  log: ServerLogLine[] | null;
  /** the rack's units, in the order of SERVICES — at the rack, and for the audience */
  rack: RackUnit[] | null;
}

/** What a move did: the state after it, and the alarm it raised, if any. */
interface Outcome {
  state: ServersState;
  penalty: string | null;
}

const pick = <T>(items: readonly T[], rng: Rng): T => {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) {
    throw new Error('servers: nothing to draw from');
  }
  return item;
};

/**
 * The codes of the services down at the start but out of quarantine: E23,
 * E42 and E11 once each as far as there are services for them, the rest at
 * random — so that the rack's cycle and the restarts come up in every run.
 * NETZ never draws E42: without a dependency it would ask for nothing.
 */
function dealCodes(crashed: readonly Service[], rng: Rng): Map<Service, ServerCode> {
  const pool: ServerCode[] = ['E23', 'E42', 'E11'];
  while (pool.length < crashed.length) {
    pool.push(pick(REPAIRABLE, rng));
  }
  const codes = shuffle(pool.slice(0, crashed.length), rng);
  const netz = crashed.indexOf('netz');
  const swap = codes.findIndex((code, i) => i !== netz && code !== 'E42');
  if (netz >= 0 && codes[netz] === 'E42' && swap >= 0) {
    codes[netz] = codes[swap] ?? 'E11';
    codes[swap] = 'E42';
  }
  return new Map(crashed.map((service, i) => [service, codes[i] ?? 'E11']));
}

/**
 * Which of the services down at the start (quarantine aside) have power:
 * one has none, one has it where there are two or more, the rest at random.
 */
function dealPower(crashed: readonly Service[], rng: Rng): Set<Service> {
  const order = shuffle(crashed, rng);
  return new Set(order.filter((_, i) => i === 1 || (i > 1 && rng() < 0.5)));
}

/** A service at the start: up since moment 0, or down since moment 1 with its code. */
function dealt(code: ServerCode | null, power: boolean): ServiceState {
  return {
    running: code === null,
    code,
    power,
    bootedAt: 0,
    crashedAt: code === null ? 0 : 1,
    poweredAt: 0,
  };
}

/** `state` with `lines` logged at its end, the log cut to its last LOG_LINES. */
function logged(state: ServersState, lines: readonly Omit<ServerLogLine, 'n'>[]): ServersState {
  const added = lines.map((line, i) => ({ n: state.logged + i + 1, ...line }));
  return {
    ...state,
    log: [...state.log, ...added].slice(-LOG_LINES),
    logged: state.logged + lines.length,
  };
}

/** `state` with `service` changed by `patch`, at the next moment of its clock. */
function tick(
  state: ServersState,
  service: Service,
  patch: (now: number) => Partial<ServiceState>,
): ServersState {
  const now = state.clock + 1;
  const services = { ...state.services, [service]: { ...state.services[service], ...patch(now) } };
  return { ...state, clock: now, services };
}

/** `service` goes down with `code`, and the log says so. */
function crash(state: ServersState, service: Service, code: ServerCode): ServersState {
  const down = tick(state, service, (now) => ({ running: false, code, crashedAt: now }));
  return logged(down, [{ tag: 'warn', text: `${service} abgestürzt: ${code}` }]);
}

/** `service` comes up, its code cleared, and the log says so. */
function boot(state: ServersState, service: Service, text: string): ServersState {
  const up = tick(state, service, (now) => ({ running: true, code: null, bootedAt: now }));
  return logged(up, [{ tag: 'ok', text }]);
}

/** A failed start: the log's line, the alarm, the state otherwise as it was. */
function failed(state: ServersState, text: string, penalty: string): Outcome {
  return { state: logged(state, [{ tag: 'fail', text }]), penalty };
}

/**
 * A quarantined service started: the alarm, and another running service
 * infected — which one, and with which code, drawn from the state's seed, a
 * stream for each infection. With nothing running there is nothing to infect.
 */
function infect(state: ServersState, source: Service): Outcome {
  const draw = mulberry32((state.seed + state.infections * 7919) >>> 0);
  const victims = SERVICES.filter((s) => s !== source && state.services[s].running);
  const counted = logged(
    { ...state, infections: state.infections + 1 },
    [{ tag: 'fail', text: `${source}: Quarantäne verletzt` }],
  );
  const victim = victims[Math.floor(draw() * victims.length)];
  if (victim === undefined) {
    return { state: counted, penalty: 'Serverraum: Quarantäne verletzt' };
  }
  const code = pick(REPAIRABLE, draw);
  const down = tick(counted, victim, (now) => ({ running: false, code, crashedAt: now }));
  return {
    state: logged(down, [{ tag: 'fail', text: `${victim} infiziert: ${code}` }]),
    penalty: 'Serverraum: Quarantäne verletzt',
  };
}

/**
 * Whether the procedure of `service`'s code is not done yet: E23 wants its
 * switch turned on since the crash, E42 every dependency started since.
 */
function codeStays(state: ServersState, service: Service): boolean {
  const { code, crashedAt, poweredAt } = state.services[service];
  if (code === 'E23') {
    return poweredAt <= crashedAt;
  }
  const stale = (dep: Service): boolean => state.services[dep].bootedAt <= crashedAt;
  return code === 'E42' && DEPENDS_ON[service].some(stale);
}

/**
 * A start of `service`, which is down: it needs power and every dependency
 * running; quarantine infects; E23 needs its switch turned on since the
 * crash, E42 every dependency started since — each failure an alarm, the
 * service left down. Otherwise it comes up.
 */
function attempt(state: ServersState, service: Service): Outcome {
  const it = state.services[service];
  if (!it.power) {
    return failed(state, `${service}: kein Strom`, 'Serverraum: kein Strom');
  }
  const missing = DEPENDS_ON[service].find((dep) => !state.services[dep].running);
  if (missing !== undefined) {
    const said = `${service}: ${missing} läuft nicht`;
    return failed(state, said, 'Serverraum: Abhängigkeit läuft nicht');
  }
  if (it.code === 'E50') {
    return infect(state, service);
  }
  if (codeStays(state, service)) {
    return failed(state, `${service}: Fehler bleibt: ${it.code}`, 'Serverraum: Fehler bleibt');
  }
  return { state: boot(state, service, `${service} läuft`), penalty: null };
}

/** A restart of a running service: whatever runs and depends on it goes down, then it comes up. */
function restarted(state: ServersState, service: Service): ServersState {
  const dependents = SERVICES.filter(
    (other) => DEPENDS_ON[other].includes(service) && state.services[other].running,
  );
  const fallen = dependents.reduce((next, other) => crash(next, other, 'E11'), state);
  return boot(fallen, service, `${service} neu gestartet`);
}

/** Whether somebody besides `playerId` stands at console `side`. */
const manned = (ctx: PuzzleContext, side: 'a' | 'b', playerId: string): boolean =>
  ctx.atConsoles[side].some((id) => id !== playerId);

/** A command typed at the terminal: `status` changes nothing; a start or restart needs the rack. */
function commanded(
  state: ServersState,
  input: Command,
  playerId: string,
  ctx: PuzzleContext,
): Outcome {
  if (ctx.console !== 'a') {
    fail('Befehle nimmt nur das Terminal an.');
  }
  if (input.cmd === 'status') {
    return { state, penalty: null };
  }
  // Reading the codes here and switching there takes two people.
  if (!manned(ctx, 'b', playerId)) {
    fail('Am Rack steht niemand.');
  }
  const { service } = input;
  if (state.services[service].running) {
    if (input.cmd === 'restart') {
      return { state: restarted(state, service), penalty: null };
    }
    fail(`${serviceName(service)} läuft schon.`);
  }
  return attempt(state, service);
}

/**
 * A switch thrown at the rack, never an alarm: turned on, it takes the next
 * moment; turned off under a running service, that service goes down (E11).
 * A switch already where it is sent leaves everything as it was.
 */
function switched(
  state: ServersState,
  input: Switch,
  playerId: string,
  ctx: PuzzleContext,
): Outcome {
  if (ctx.console !== 'b') {
    fail('Strom schaltet nur das Rack.');
  }
  if (!manned(ctx, 'a', playerId)) {
    fail('Am Terminal steht niemand.');
  }
  const { power: service, on } = input;
  const it = state.services[service];
  if (it.power === on) {
    return { state, penalty: null };
  }
  const thrown = on
    ? tick(state, service, (now) => ({ power: true, poweredAt: now }))
    : tick(state, service, () => ({ power: false }));
  const told = logged(thrown, [{ tag: 'info', text: `${service}: Strom ${on ? 'an' : 'aus'}` }]);
  return { state: !on && it.running ? crash(told, service, 'E11') : told, penalty: null };
}

/** Solved: every service runs, but a quarantined one, which stands without power. */
function solvedNow(state: ServersState): boolean {
  return SERVICES.every((service) => {
    const it = state.services[service];
    return it.code === 'E50' ? !it.power : it.running;
  });
}

/** A unit's LED: green while its service runs, red while down with power, dark without. */
function ledOf(it: ServiceState): ServerLed {
  if (!it.power) {
    return 'off';
  }
  return it.running ? 'green' : 'red';
}

// --- the printed document ------------------------------------------------------------------

const PLATE: TypePlate = { name: 'Rechnernetz', type: 'RN-6', year: 1998 };

const PURPOSE =
  'Das Rechnernetz kam mit dem Umbau: Türsteuerung, Messdaten und Post laufen seither über ' +
  'sechs Dienste im Serverraum. Steht es still, bleiben die Türen, die es steuert, zu, bis ' +
  'jeder Dienst wieder läuft.';

const BUILD =
  'Pult A ist das Terminal: Es zeigt jeden Dienst mit Zustand, Fehlercode und Strom, führt ein ' +
  'Protokoll und nimmt Befehle an. Pult B ist das Rack mit einem Stromschalter und einer LED ' +
  'je Dienst: grün läuft, rot Fehler, dunkel kein Strom.';

/** Betrieb: the order and the procedures, a failed start and what it costs, quarantine. */
function operationText(def: ServersDef): string {
  return (
    'Ein Dienst startet erst, wenn alles läuft, wovon er abhängt (Abb. 1: der Pfeil führt von ' +
    'der Abhängigkeit zum Dienst), und nach dem Verfahren seines Codes. Gelingt ein Start ' +
    `nicht, meldet die Überwachung Alarm und zieht ${costOf(def.penaltySec)} ab; der Dienst ` +
    'bleibt stehen. Ein Start mit E50 infiziert dazu einen laufenden Dienst.'
  );
}

/** Aus der Werkstatt: quarantine first, where the def deals it, then the plan's order. */
function workshopNotes(def: ServersDef): string[] {
  const order =
    'Der Netzplan listet die Dienste in einer Reihenfolge, in der sie starten können: von oben ' +
    'nach unten hochfahren.';
  return def.trap
    ? [
        'Vor allem anderen den Dienst mit E50 vom Strom nehmen: Ein Start steckt einen zweiten ' +
          'Dienst an.',
        order,
      ]
    : [order];
}

/** The dependency table beside the figure: each service and what it needs. */
function dependencyTable(): ManualBlock {
  return {
    kind: 'table',
    head: ['Dienst', 'hängt ab von'],
    rows: SERVICES.map((service) => [
      serviceName(service),
      DEPENDS_ON[service].length === 0 ? '—' : DEPENDS_ON[service].map(serviceName).join(', '),
    ]),
  };
}

const COMMANDS: ManualBlock = {
  kind: 'table',
  head: ['Befehl am Terminal', 'Wirkung'],
  rows: [
    ['start <dienst>', 'startet einen Dienst, der nicht läuft'],
    [
      'restart <dienst>',
      'stoppt einen laufenden Dienst und startet ihn neu; einer, der nicht läuft, startet ' +
        'wie mit start',
    ],
    ['status', 'zeigt die Tabelle; ändert nichts'],
  ],
};

const CODES: ManualBlock = {
  kind: 'table',
  head: ['Code', 'Verfahren'],
  rows: SERVER_CODES.map((code) => [code, CODE_MEANINGS[code]]),
};

const RULES: ManualBlock = {
  kind: 'rules',
  items: [
    'Wenn ein Dienst keinen Strom hat, startet er nicht.',
    'Wenn nicht alle Abhängigkeiten eines Dienstes laufen, startet er nicht.',
    'Wenn ein Start nicht gelingt, bleibt der Dienst stehen, und sein Code bleibt.',
    'Wenn ein laufender Dienst den Strom verliert, stürzt er ab (E11).',
    'Wenn ein laufender Dienst per restart neu startet, stürzen die laufenden Dienste ab, die ' +
      'von ihm abhängen (E11).',
    'Wenn jeder Dienst läuft, außer denen mit E50, und jeder Dienst mit E50 ohne Strom ist, ist ' +
      'der Serverraum wieder online.',
  ],
};

/** The printed log: a power cycle for E23, then the restarts E42 calls for. */
export const LOG: readonly string[] = [
  '01:02 status: NETZ RUNNING; DNS FEHLER E23 und AUTH FEHLER E42, beide mit Strom; der Rest ' +
    'ohne Strom.',
  '01:03 Rack: DNS aus und wieder an; start dns: [ OK ] dns läuft.',
  '01:04 restart netz: [WARN] dns abgestürzt: E11; [ OK ] netz neu gestartet.',
  '01:04 restart dns: [ OK ] dns läuft.',
  '01:05 start auth: [ OK ] auth läuft.',
];

// --- the solver ----------------------------------------------------------------------------

const start = (service: Service): Move<ServersInput> => ({
  by: 'operator',
  input: { cmd: 'start', service },
});

const power = (service: Service, on: boolean): Move<ServersInput> => ({
  by: 'partner',
  input: { power: service, on },
});

/**
 * The procedure that brings `row`'s service up, every dependency of it
 * running: power on where it has none, then as its code says — E23 its
 * switch off (if on) and on, E42 a restart of every dependency, those
 * further down the dependencies first, so that none of them goes down
 * again under the next — and the start.
 */
function procedure(row: ServerRow): Move<ServersInput>[] {
  const { service, code } = row;
  if (code === 'E23') {
    return [...(row.power ? [power(service, false)] : []), power(service, true), start(service)];
  }
  const on = row.power ? [] : [power(service, true)];
  if (code === 'E42') {
    const deps = SERVICES.filter((dep) => DEPENDS_ON[service].includes(dep));
    const restarts = deps.map(
      (dep): Move<ServersInput> => ({ by: 'operator', input: { cmd: 'restart', service: dep } }),
    );
    return [...on, ...restarts, start(service)];
  }
  return [...on, start(service)];
}

export const serversModule: PuzzleModule<ServersDef, ServersState, ServersInput, ServersView> = {
  type: 'servers',
  usesEdgework: false,
  wholeCrew: false,
  consoles: 2,
  fields: [
    {
      key: 'crashed',
      label: 'Abgestürzte Dienste',
      help: 'So viele der sechs Dienste stehen zu Beginn still, jeder mit einem Fehlercode.',
      kind: 'int',
      min: 3,
      max: 5,
      default: 4,
    },
    {
      key: 'trap',
      label: 'Quarantäne',
      help: 'Einer der abgestürzten Dienste trägt E50: Strom aus, nie starten.',
      kind: 'bool',
      default: true,
    },
  ],
  defSchema,
  inputSchema,

  /**
   * `crashed` services down, each with a code: with the trap one of the
   * services nothing depends on in quarantine, its switch on — ready to be
   * started by mistake —, the others with power or without, at least one
   * each way where there are two. Every running service has power. The log
   * opens on a line for every service down, with its code.
   */
  init(def, rng) {
    const quarantined = def.trap ? pick(LEAVES, rng) : null;
    const down = def.crashed - (quarantined === null ? 0 : 1);
    const others = shuffle(
      SERVICES.filter((service) => service !== quarantined),
      rng,
    ).slice(0, down);
    const codes = dealCodes(others, rng);
    const powered = dealPower(others, rng);
    const services = Object.fromEntries(
      SERVICES.map((service) => {
        const code = service === quarantined ? 'E50' : (codes.get(service) ?? null);
        return [service, dealt(code, code === null || code === 'E50' || powered.has(service))];
      }),
    ) as Record<Service, ServiceState>;
    const fresh: ServersState = {
      type: 'servers',
      services,
      clock: 1,
      seed: Math.floor(rng() * 2 ** 32),
      infections: 0,
      log: [],
      logged: 0,
    };
    // The terminal comes up on its monitor's report: every service down, with its code.
    const report = SERVICES.flatMap((s) => {
      const { code } = services[s];
      return code === null ? [] : [{ tag: 'warn' as const, text: `${s} abgestürzt: ${code}` }];
    });
    return logged(fresh, report);
  },

  apply(_def, state, input, playerId, ctx) {
    if (ctx.console === null) {
      fail('Eingabe nur am Pult.');
    }
    const outcome =
      'power' in input
        ? switched(state, input, playerId, ctx)
        : commanded(state, input, playerId, ctx);
    return { ...outcome, solved: solvedNow(outcome.state) };
  },

  view(_def, state, viewer) {
    const audience = viewer.playerId === null;
    const at = viewer.operating ? viewer.console : null;
    const role = at === 'a' ? 'terminal' : at === 'b' ? 'rack' : null;
    const terminal = role === 'terminal' || audience;
    const rack = role === 'rack' || audience;
    return {
      kind: 'servers',
      role,
      rows: terminal
        ? SERVICES.map((service) => {
            const { running, code, power: on } = state.services[service];
            return { service, running, code, power: on };
          })
        : null,
      log: terminal ? state.log.slice(-LOG_LINES).map((line) => ({ ...line })) : null,
      rack: rack
        ? SERVICES.map((service) => {
            const it = state.services[service];
            return { service, power: it.power, led: ledOf(it) };
          })
        : null,
    };
  },

  manual(def) {
    return labDocument({
      plate: PLATE,
      purpose: PURPOSE,
      figure: { of: 'servers', device: 'Dienste und Rack' },
      build: BUILD,
      operation: operationText(def),
      law: [
        { heading: 'Netzplan', blocks: [dependencyTable()] },
        { heading: 'Befehle und Codes', blocks: [COMMANDS, CODES, RULES] },
      ],
      log: LOG,
      workshop: workshopNotes(def),
    });
  },

  /**
   * The terminal's table holds the codes, the rack its switches. A
   * quarantined service with power is switched off first. Then the first
   * service down in the order of SERVICES — every dependency of it running
   * by then — is brought up by its code's procedure, all of it at once;
   * whatever a restart took down along the way comes next.
   */
  solve(def, { operator, partner }) {
    const rows = operator.rows;
    const rack = partner?.rack ?? null;
    if (rows === null || rack === null) {
      throw new Error(
        `servers "${def.id}": solving needs the terminal's view at console a and the rack's at ` +
          'console b',
      );
    }
    const powered = new Map(rack.map((unit) => [unit.service, unit.power]));
    const loose = rows.find((row) => row.code === 'E50' && powered.get(row.service) === true);
    if (loose !== undefined) {
      return [power(loose.service, false)];
    }
    const down = rows.find((row) => row.code !== null && row.code !== 'E50');
    return down === undefined
      ? []
      : procedure({ ...down, power: powered.get(down.service) === true });
  },
};
