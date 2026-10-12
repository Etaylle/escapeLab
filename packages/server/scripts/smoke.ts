/**
 * End-to-end smoke test: boots the real server in-process, then drives two
 * real WebSocket clients through the full Blackout mission on its tile map —
 * the server draws who starts in the Archiv and who in the Maschinenraum, and
 * the walkthrough follows the draw — streaming client-authoritative positions
 * along BFS paths (plates, doors, the camera plate that freezes the Flur
 * drone), sending one client to each station and the other to the book or
 * terminal that covers it, solving every station with its module's solver on
 * the views of whoever stands at the station and whoever reads its rules
 * (plus one deliberate wrong cut and one wrong key), and surviving a mid-game
 * reconnect. No answer is written down here.
 * Run with: pnpm --filter @escapelab/server smoke
 */
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import {
  moduleFor,
  parseMission,
  type DronePosition,
  type Credits,
  type Edgework,
  type Move,
  type Perspectives,
  type PlayerPosition,
  type PlayerView,
  type PuzzleInput,
  type PuzzleView,
  type ServerMessage,
  type SolveAid,
  type SpectatorView,
} from '@escapelab/core';

const PORT = 3102;
process.env['PORT'] = String(PORT);
await import('../src/index.js');

const mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

/** Where a client starts: the server draws it from Blackout's two spawns. */
type Start = 'archiv' | 'maschinenraum';

/** Blackout's spawns, in the mission's order: the Archiv's first, the Maschinenraum's second. */
const SPAWNS: Record<Start, { x: number; y: number }> = {
  archiv: mission.map.spawns[0] ?? { x: 3, y: 2 },
  maschinenraum: mission.map.spawns[1] ?? { x: 3, y: 10 },
};

/**
 * Scripted completion of the Blackout map (validated against the layout),
 * by where each client started. The one from the Archiv starts at the book
 * (stations 1 and 2) beside the sign, the one from the Maschinenraum at the
 * fuse box; the terminal in the Serverraum holds the rules of stations 3
 * and 4. A walk with `frozen` crosses the Flur while the other client stands
 * on the camera plate that holds that drone still.
 */
const BLACKOUT_WALKTHROUGH: (
  | { who: Start; goTo: [number, number]; frozen?: string }
  | { who: Start; do: 'interact' }
)[] = [
  { who: 'maschinenraum', goTo: [2, 9] },
  { who: 'maschinenraum', do: 'interact' }, // notstrom: at the box; the Archiv reads
  { who: 'archiv', goTo: [7, 6] }, // out of the Archiv, holds flurplatte
  { who: 'maschinenraum', goTo: [3, 2] }, // out of the Maschinenraum, past the sign, to the book
  { who: 'archiv', goTo: [7, 5] }, // off the plate, at the keypad
  { who: 'archiv', do: 'interact' }, // zugangscode: at the keys; the other reads the book
  { who: 'archiv', goTo: [11, 5] }, // onto the camera plate in front of the Serverraum
  // across the Flur while the camera plate is held, onto serverplatte
  { who: 'maschinenraum', goTo: [16, 6], frozen: 'flurwache' },
  { who: 'archiv', goTo: [17, 2] }, // through the open door to the terminal
  { who: 'maschinenraum', goTo: [13, 6] }, // to the switch bank; the Serverraum closes behind
  { who: 'maschinenraum', do: 'interact' }, // subsysteme: at the bank; the terminal is read
  { who: 'maschinenraum', goTo: [9, 10] },
  { who: 'maschinenraum', do: 'interact' }, // frequenz: at the panel; the terminal is read
  { who: 'maschinenraum', goTo: [16, 6] }, // holds serverplatte to let the reader out
  { who: 'archiv', goTo: [11, 5] }, // out, and onto the camera plate again
  // The last station stays dead until the spare fuse arrives from the archive.
  { who: 'maschinenraum', goTo: [1, 1], frozen: 'flurwache' },
  { who: 'maschinenraum', do: 'interact' }, // pick up the fuse
  { who: 'maschinenraum', goTo: [16, 9] },
  { who: 'maschinenraum', do: 'interact' }, // deliver it, and stay at the reactor
  { who: 'archiv', goTo: [14, 9] },
  { who: 'archiv', do: 'interact' }, // reaktorstart: both at the reactor
];

/** What only the station shows, and a line only its printed rules hold, for stations 1–4. */
const SECRETS = [
  { instance: '"wires":[{', rules: 'Mehr als ein schwarzes Kabel' },
  { instance: '"keys":[{', rules: 'Genau eine Spalte' },
  { instance: '"switches":[{', rules: 'umlegen, wenn die Laborkennung' },
  { instance: '"flashes":["', rules: 'Ohne Vokal' },
];

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function assert(cond: boolean, message: string): asserts cond {
  if (!cond) {
    fail(message);
  }
  console.log(`✓ ${message}`);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * WebSocket client tracking the latest view, positions and its own avatar.
 * `raw` logs every message received; a client resuming a dropped one keeps
 * writing to the same log.
 */
class TestClient {
  private readonly socket: WebSocket;
  private readonly queue: ServerMessage[] = [];
  private waiter: (() => void) | null = null;
  view: PlayerView | null = null;
  /** view messages received so far; every dispatch on the server sends one to everyone */
  viewCount = 0;
  spectatorView: SpectatorView | null = null;
  positions: Record<string, PlayerPosition> = {};
  drones: Record<string, DronePosition> = {};
  playerId: string | null = null;
  /** what the server handed out on joining, for resuming after a drop */
  joined: { code: string; playerId: string; token: string } | null = null;
  /** client-authoritative avatar position (tile units) */
  self: { x: number; y: number } | null = null;

  constructor(
    readonly label: string,
    readonly raw: string[] = [],
  ) {
    this.socket = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.socket.on('message', (data) => {
      this.raw.push(String(data));
      const msg = JSON.parse(String(data)) as ServerMessage;
      if (msg.kind === 'error') {
        console.log(`  [${this.label}] server error: ${msg.message}`);
      }
      if (msg.kind === 'view') {
        this.view = msg.view;
        this.viewCount += 1;
      }
      if (msg.kind === 'spectator-view') {
        this.spectatorView = msg.view;
      }
      if (msg.kind === 'positions') {
        this.positions = msg.players;
        this.drones = msg.drones;
      }
      this.queue.push(msg);
      this.waiter?.();
    });
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(msg: object): void {
    this.socket.send(JSON.stringify(msg));
  }

  sendPos(x: number, y: number, moving: boolean): void {
    this.self = { x, y };
    this.send({ kind: 'pos', x, y, facing: 0, moving });
  }

  close(): void {
    this.socket.close();
  }

  /** Wait until a queued message matches; drops it and everything before it. */
  async expect<T extends ServerMessage>(
    desc: string,
    match: (msg: ServerMessage) => msg is T,
  ): Promise<T> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const idx = this.queue.findIndex(match);
      const found = idx >= 0 ? this.queue[idx] : undefined;
      if (found !== undefined && match(found)) {
        this.queue.splice(0, idx + 1);
        return found;
      }
      if (Date.now() > deadline) {
        fail(`${this.label}: timeout waiting for "${desc}"`);
      }
      await this.tick();
    }
  }

  /** Wait until the latest spectator view satisfies the predicate. */
  async untilSpectator(
    desc: string,
    pred: (view: SpectatorView) => boolean,
  ): Promise<SpectatorView> {
    const deadline = Date.now() + 5000;
    for (;;) {
      if (this.spectatorView !== null && pred(this.spectatorView)) {
        console.log(`✓ ${this.label}: ${desc}`);
        return this.spectatorView;
      }
      if (Date.now() > deadline) {
        fail(`${this.label}: timeout waiting for "${desc}"`);
      }
      await this.tick();
    }
  }

  /** True when a message matching the predicate is still queued. */
  hasQueued(match: (msg: ServerMessage) => boolean): boolean {
    return this.queue.some(match);
  }

  /** Wait until the LATEST view satisfies the predicate (state-based). */
  async until(desc: string, pred: (view: PlayerView) => boolean): Promise<PlayerView> {
    const deadline = Date.now() + 5000;
    for (;;) {
      if (this.view !== null && pred(this.view)) {
        return this.view;
      }
      if (Date.now() > deadline) {
        fail(`${this.label}: timeout waiting for "${desc}"`);
      }
      await this.tick();
    }
  }

  async untilPositions(
    desc: string,
    pred: (p: Record<string, PlayerPosition>) => boolean,
  ): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!pred(this.positions)) {
      if (Date.now() > deadline) {
        fail(`${this.label}: timeout waiting for "${desc}"`);
      }
      await this.tick();
    }
  }

  /** `until` with a logged checkmark. */
  async expectView(desc: string, pred: (view: PlayerView) => boolean): Promise<PlayerView> {
    const view = await this.until(desc, pred);
    console.log(`✓ ${this.label}: ${desc}`);
    return view;
  }

  /** Adopt the server-seeded position for our own avatar. */
  async ensureSelf(): Promise<{ x: number; y: number }> {
    if (this.self !== null) {
      return this.self;
    }
    const id = this.playerId ?? fail(`${this.label}: no playerId yet`);
    await this.untilPositions('own seeded position', (p) => p[id] !== undefined);
    const pos = this.positions[id] ?? fail(`${this.label}: missing own position`);
    this.self = { x: pos.x, y: pos.y };
    return this.self;
  }

  private tick(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiter = resolve;
      setTimeout(resolve, 100);
    });
  }
}

const isError = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'error' }> =>
  m.kind === 'error';
const isJoined = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'joined' }> =>
  m.kind === 'joined';

// --- map walking -----------------------------------------------------------

type MapData = NonNullable<PlayerView['map']>;

/** BFS path on the view's map; successive tiles excluding the start, null if blocked. */
function bfsPath(
  map: MapData,
  from: [number, number],
  to: [number, number],
): [number, number][] | null {
  const key = (x: number, y: number): string => `${x},${y}`;
  const closed = new Set(map.doors.filter((d) => !d.open).map((d) => key(d.x, d.y)));
  const walkable = (x: number, y: number): boolean =>
    map.tiles[y]?.charAt(x) === '.' && !closed.has(key(x, y));
  const prev = new Map<string, string | null>([[key(...from), null]]);
  const queue: [number, number][] = [from];
  while (queue.length > 0) {
    const [x, y] = queue.shift() ?? [0, 0];
    if (x === to[0] && y === to[1]) {
      const path: [number, number][] = [];
      let cursor: string | null = key(x, y);
      while (cursor !== null && cursor !== key(...from)) {
        const [cx = 0, cy = 0] = cursor.split(',').map(Number);
        path.unshift([cx, cy]);
        cursor = prev.get(cursor) ?? null;
      }
      return path;
    }
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (walkable(nx, ny) && !prev.has(key(nx, ny))) {
        prev.set(key(nx, ny), key(x, y));
        queue.push([nx, ny]);
      }
    }
  }
  return null;
}

/**
 * Stream positions along a BFS path to the target tile, then wait for the
 * server's positions echo (which also proves plate evaluation has run).
 * A transiently missing path means a door update is still in flight — retry.
 */
async function walkTo(client: TestClient, to: [number, number]): Promise<void> {
  const self = await client.ensureSelf();
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (client.view !== null && client.view.phase !== 'playing') {
      // The mission ended mid-walk (e.g. the last player reached the hatch).
      console.log(`✓ ${client.label}: mission ended while walking to ${to.join(',')}`);
      return;
    }
    const map = client.view?.map;
    if (map == null) {
      fail(
        `${client.label}: no map view while trying to walk ` +
          `(phase=${client.view?.phase ?? 'none'}, puzzle=${client.view?.puzzle?.kind ?? '-'})`,
      );
    }
    const fromTile: [number, number] = [Math.floor(self.x), Math.floor(self.y)];
    if (fromTile[0] === to[0] && fromTile[1] === to[1]) {
      break;
    }
    if (Date.now() > deadline) {
      fail(`${client.label}: no path from ${fromTile.join(',')} to ${to.join(',')}`);
    }
    const path = bfsPath(map, fromTile, to);
    if (path === null) {
      await sleep(100);
      continue;
    }
    for (const [x, y] of path) {
      client.sendPos(x + 0.5, y + 0.5, true);
      self.x = x + 0.5;
      self.y = y + 0.5;
      await sleep(8);
    }
  }
  client.sendPos(to[0] + 0.5, to[1] + 0.5, false);
  const id = client.playerId ?? '';
  await client.untilPositions(`echo at ${to.join(',')}`, (p) => {
    const mine = p[id];
    return mine !== undefined && Math.hypot(mine.x - (to[0] + 0.5), mine.y - (to[1] + 0.5)) < 0.05;
  });
  console.log(`✓ ${client.label}: walked to ${to.join(',')}`);
}

/**
 * Walk while the other client holds the camera plate: the drone it freezes
 * stands still in this client's positions stream before and after the walk,
 * and nobody was spotted on the way.
 */
async function crossFrozen(
  client: TestClient,
  to: [number, number],
  droneId: string,
): Promise<void> {
  const frozen = (): boolean => client.drones[droneId]?.frozen === true;
  await client.untilPositions(`${droneId} frozen`, frozen);
  console.log(`✓ ${client.label}: ${droneId} stands frozen while the camera plate is held`);
  const alarms = client.view?.penaltySeq;
  await walkTo(client, to);
  assert(frozen() && client.view?.penaltySeq === alarms,
    `${client.label} crossed the Flur unseen while ${droneId} stood still`);
}

// --- puzzle solvers ----------------------------------------------------------

const wiringDef = mission.puzzles[0];
const keypadDef = mission.puzzles[1];
const switchesDef = mission.puzzles[2];
const simonDef = mission.puzzles[3];
if (
  wiringDef?.type !== 'wiring' ||
  keypadDef?.type !== 'keypad' ||
  switchesDef?.type !== 'switches' ||
  simonDef?.type !== 'simon'
) {
  fail('blackout.json should run wiring, keypad, switches, simon, sync');
}
// Narrowed re-bindings: closures below keep the precise puzzle types.
const WIRING = wiringDef;

type Clients = Record<Start, TestClient>;

type Transcript = SolveAid<PuzzleInput, PuzzleView>['transcript'];

/** How long the solver may keep a held button waiting for the clock. */
const MAX_WAIT_SEC = 15;

async function waitFor(desc: string, cond: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!cond()) {
    if (Date.now() > deadline) {
      fail(`timeout waiting for "${desc}"`);
    }
    await sleep(10);
  }
}

/**
 * Who works station `index` and who reads its rules, by where the clients
 * stand: the operator at the station, the reader at a manual object that
 * covers it. Where the whole crew presses, everyone stands at the station.
 */
function sidesOf(clients: Clients, index: number): { operator: TestClient; reader: TestClient } {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
  const crew = Object.values(clients);
  const operator =
    crew.find((client) => client.view?.presence.stationId === def.id) ??
    fail(`nobody stands at station ${index + 1}`);
  const reads = (client: TestClient): boolean =>
    client.view?.manualsHere.some((m) => m.sections.some((s) => s.puzzleId === def.id)) === true;
  const reader =
    crew.find((client) => client !== operator && reads(client)) ??
    crew.find((client) => client !== operator) ??
    fail(`nobody beside the operator at station ${index + 1}`);
  return { operator, reader };
}

/** The start slot a client was drawn to. */
function startOf(clients: Clients, client: TestClient): Start {
  return clients.archiv === client ? 'archiv' : 'maschinenraum';
}

/**
 * What the two clients show of station `index`: the view at the station and
 * the view at the book, the edgework if one of them has read the sign, and
 * the seconds left on their clock.
 */
function crewSees(
  clients: Clients,
  index: number,
): { views: Perspectives<PuzzleView>; edgework: Edgework | null; remainingSec: number | null } {
  const { operator, reader } = sidesOf(clients, index);
  const atStation = operator.view ?? fail(`${operator.label}: no view yet`);
  const atBook = reader.view ?? fail(`${reader.label}: no view yet`);
  const open = (client: TestClient, view: PlayerView): PuzzleView =>
    view.puzzle ?? fail(`${client.label}: station ${index + 1} is not open`);
  const deadlineAt = atStation.deadlineAt;
  return {
    views: { operator: open(operator, atStation), reader: open(reader, atBook) },
    edgework: atStation.edgework ?? atBook.edgework,
    remainingSec: deadlineAt === null ? null : Math.ceil((deadlineAt - Date.now()) / 1000),
  };
}

/**
 * What the station's module would have the crew do next, worked out from
 * nothing but the two clients' views — and the edgework, if one has read it.
 */
function nextMoves(clients: Clients, index: number): Move<PuzzleInput>[] {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
  const { views, edgework } = crewSees(clients, index);
  return moduleFor(def.type).solve(def, views, edgework);
}

/** Whether the operator holds a button down: the one wait a solver may ask for. */
function holdingDown(views: Perspectives<PuzzleView>): boolean {
  return views.operator.kind === 'button' && views.operator.holding;
}

/**
 * Send moves and wait for their effect everywhere: an operator move comes
 * from the client at the station, an `everyone` move from both; every
 * accepted input is one broadcast to each client, and each acting client's
 * station has changed or closed.
 */
async function play(clients: Clients, moves: Move<PuzzleInput>[], index: number): Promise<void> {
  const crew = Object.values(clients);
  const counts = crew.map((client) => client.viewCount);
  const { operator } = sidesOf(clients, index);
  const sent = moves.flatMap((move) =>
    (move.by === 'everyone' ? crew : [operator]).map((client) => ({ client, move })),
  );
  const before = sent.map(({ client }) => JSON.stringify(client.view?.puzzle));
  for (const { client, move } of sent) {
    client.send({ kind: 'puzzle-input', input: move.input });
  }
  await waitFor(`station ${index + 1} to take ${JSON.stringify(moves)}`, () =>
    crew.every((client, i) => client.viewCount >= (counts[i] ?? 0) + sent.length) &&
    sent.every(
      ({ client }, i) =>
        client.view?.currentPuzzleIndex !== index ||
        JSON.stringify(client.view.puzzle) !== before[i],
    ),
  );
}

/**
 * Feed the solver the operator's and the reader's views, and the moves it
 * played here so far, until the station is done. A held button may wait for
 * the clock: the solver is asked again every second, for up to MAX_WAIT_SEC.
 */
async function solveStation(clients: Clients, index: number): Promise<void> {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
  const crew = Object.values(clients);
  await waitFor(`both clients at station ${index + 1}`, () =>
    crew.every((client) => client.view?.puzzle?.index === index),
  );
  const transcript: Transcript = [];
  let waited = 0;
  for (let round = 0; round < 100; round++) {
    if (crew.every((client) => (client.view?.currentPuzzleIndex ?? 0) > index)) {
      console.log(`✓ the solver cleared station ${index + 1} from the views alone`);
      return;
    }
    const { views, edgework, remainingSec } = crewSees(clients, index);
    const moves = moduleFor(def.type).solve(def, views, edgework, { transcript, remainingSec });
    if (moves.length === 0) {
      if (!holdingDown(views)) {
        fail(`the solver has no move for station ${index + 1}`);
      }
      if (waited === MAX_WAIT_SEC) {
        fail(`the solver kept the button at station ${index + 1} held for ${waited} s`);
      }
      waited += 1;
      await sleep(1000);
      continue;
    }
    waited = 0;
    transcript.push(...moves.map((move) => ({ ...move, before: views })));
    await play(clients, moves, index);
  }
  fail(`station ${index + 1} is still open after 100 rounds`);
}

async function solveWiring(clients: Clients): Promise<void> {
  const atBook = await clients.archiv.expectView('reads the wiring rules at the book', (v) =>
    v.puzzle?.kind === 'wiring' && v.presence.manualId === 'buch-archiv');
  const atBox = await clients.maschinenraum.expectView('stands at the wiring box', (v) =>
    v.puzzle?.kind === 'wiring' && v.presence.stationId === 'notstrom');
  assert(atBook.puzzle?.kind === 'wiring' && atBook.puzzle.wires === null,
    'the reader does not get the wire layout');
  assert(atBox.puzzle?.kind === 'wiring' && atBox.puzzle.wires !== null,
    'the operator gets the wire layout');
  assert(atBook.puzzle.manual !== null && atBox.puzzle.manual === null,
    'only the reader gets the printed rules');
  assert(atBook.edgework !== null && atBox.edgework === null,
    'the edgework went to whoever started at the sign in the Archiv, and to nobody else');

  // The deliberate mistake: any wire but the one the solver would cut.
  const [right] = nextMoves(clients, 0);
  const rightId = right !== undefined && 'wireId' in right.input ? right.input.wireId : null;
  const wires =
    atBox.puzzle.kind === 'wiring' && atBox.puzzle.wires !== null ? atBox.puzzle.wires : [];
  const wrong = wires.find((w) => w.id !== rightId) ?? fail('no wire left to cut wrongly');
  const deadlineBefore = atBox.deadlineAt ?? 0;
  clients.maschinenraum.send({ kind: 'puzzle-input', input: { wireId: wrong.id } });
  const afterPenalty = await clients.maschinenraum.expectView('sees the alarm after a wrong cut',
    (v) => v.penaltySeq === 1);
  assert((afterPenalty.deadlineAt ?? 0) === deadlineBefore - WIRING.penaltySec * 1000,
    `wrong cut cost ${WIRING.penaltySec}s of deadline`);
  await clients.archiv.until('the alarm', (v) => v.penaltySeq === 1);

  // The reader cannot cut from the book.
  clients.archiv.send({ kind: 'puzzle-input', input: { wireId: wrong.id } });
  const refused = await clients.archiv.expect('refusal away from the box', isError);
  assert(refused.message === 'Dafür musst du am Pult stehen.', 'a cut from the book is refused');

  await solveStation(clients, 0);
}

/** Keypad incl. the mid-game reconnect of the reader; returns the client that took over. */
async function solveKeypad(clients: Clients): Promise<TestClient> {
  const dropped = clients.maschinenraum;
  const joined = dropped.joined ?? fail(`${dropped.label}: never joined`);
  const name = dropped.view?.you.name ?? fail(`${dropped.label}: no view yet`);
  await dropped.expectView('reads the keypad table, Laborkennung picked up', (v) =>
    v.puzzle?.kind === 'keypad' && v.puzzle.manual !== null && v.edgework !== null);
  const before = dropped.self;
  dropped.close();
  await clients.archiv.expectView(`sees ${name} disconnected`, (v) =>
    v.players.some((p) => p.name === name && !p.connected));

  const back = new TestClient(`${dropped.label}2`, dropped.raw);
  await back.open();
  back.send({ kind: 'resume', code: joined.code, playerId: joined.playerId, token: joined.token });
  await back.expect('re-joined', isJoined);
  back.playerId = joined.playerId;
  back.joined = joined;
  const reading = await back.expectView('resumed at the book, the table in hand', (v) =>
    v.puzzle?.kind === 'keypad' && v.map !== null && v.presence.manualId === 'buch-archiv');
  assert(reading.edgework !== null, 'the Laborkennung survived the reconnect');
  const seeded = await back.ensureSelf();
  assert(
    before !== null && Math.hypot(seeded.x - before.x, seeded.y - before.y) < 0.05,
    'avatar position survived the reconnect',
  );

  const crew: Clients = { ...clients, maschinenraum: back };
  const atKeys = await clients.archiv.until('the crew back together', (v) =>
    v.pausedFor === null && v.puzzle?.kind === 'keypad');
  // Here the one from the Archiv stands at the keys and the other reads the glyph table.
  const keys =
    atKeys.puzzle?.kind === 'keypad' && atKeys.puzzle.keys !== null ? atKeys.puzzle.keys : [];
  assert(
    keys.length === 4 &&
      reading.puzzle?.kind === 'keypad' &&
      reading.puzzle.keys === null &&
      reading.puzzle.manual !== null,
    'the table arrived after resume, the keys stay at the keypad',
  );
  const [right] = nextMoves(crew, 1);
  const rightIdx = right !== undefined && 'keyIndex' in right.input ? right.input.keyIndex : null;
  const wrongIdx = keys.findIndex((_, i) => i !== rightIdx);
  clients.archiv.send({ kind: 'puzzle-input', input: { keyIndex: wrongIdx } });
  await back.expectView('sees the keypad alarm', (v) => v.penaltySeq === 2);
  await clients.archiv.until('the keypad alarm', (v) => v.penaltySeq === 2);
  await solveStation(crew, 1);
  return back;
}

async function solveSwitches(clients: Clients): Promise<void> {
  await clients.archiv.expectView('reads the switch rules but sees no bank', (v) =>
    v.puzzle?.kind === 'switches' && v.puzzle.switches === null && v.puzzle.manual !== null);
  const atBank = await clients.maschinenraum.expectView('stands at the switch bank', (v) =>
    v.puzzle?.kind === 'switches' && v.puzzle.switches !== null);
  const bank = atBank.puzzle?.kind === 'switches' ? (atBank.puzzle.switches ?? []) : [];
  assert(!clients.archiv.raw.some((r) => r.includes(JSON.stringify(bank))),
    'the switch bank never reached the reader');
  await solveStation(clients, 2);
}

async function solveSimon(clients: Clients): Promise<void> {
  await clients.archiv.expectView('reads the tables without the flashes', (v) =>
    v.puzzle?.kind === 'simon' && v.puzzle.flashes === null && v.puzzle.manual !== null);
  await clients.maschinenraum.expectView('stands at the flashing panel', (v) =>
    v.puzzle?.kind === 'simon' && v.puzzle.flashes !== null);
  await solveStation(clients, 3);
}

async function solveSync(clients: Clients): Promise<void> {
  await clients.archiv.expectView('stands at the reactor with the crew', (v) =>
    v.puzzle?.kind === 'button-sync' && v.presence.stationId === 'reaktorstart');
  await clients.maschinenraum.until('at the reactor too', (v) =>
    v.presence.stationId === 'reaktorstart');
  await solveStation(clients, 4);
}

/**
 * How far each client's message log ran when a station opened and when it
 * was solved, and from which start the operator and the reader came.
 */
interface OpenWindow {
  from: Record<Start, number>;
  to: Record<Start, number>;
  operator: Start;
  reader: Start;
}

/**
 * While each of stations 1–4 was open, its instance never reached its reader
 * and its rules never reached its operator. Outside that window a player may
 * well have read them: one book covers two stations, worked by turns.
 */
function assertKeptApart(clients: Clients, windows: OpenWindow[]): void {
  for (const [i, { instance, rules }] of SECRETS.entries()) {
    const open = windows[i] ?? fail(`station ${i + 1} was never opened`);
    const received = (start: Start): string =>
      clients[start].raw.slice(open.from[start], open.to[start]).join('\n');
    assert(!received(open.reader).includes(instance),
      `station ${i + 1}: the instance never reached the reader`);
    assert(!received(open.operator).includes(rules),
      `station ${i + 1}: the printed rules never reached the operator`);
  }
}

// --- run ---------------------------------------------------------------------

const anna = new TestClient('anna');
await anna.open();
// Nothing is running yet, so the lobby browser starts out empty.
anna.send({ kind: 'list-rooms' });
const empty = await anna.expect(
  'room list',
  (m): m is Extract<ServerMessage, { kind: 'rooms' }> => m.kind === 'rooms',
);
assert(empty.rooms.length === 0, 'lobby browser is empty before any room exists');

anna.send({ kind: 'create-room', name: 'Anna', missionId: 'blackout' });
const annaJoined = await anna.expect('joined', isJoined);
anna.playerId = annaJoined.playerId;
anna.joined = annaJoined;
await anna.expectView('sees the lobby', (v) => v.phase === 'lobby');

const ben = new TestClient('ben');
await ben.open();
// Ben finds the room in the browser instead of being told the code.
ben.send({ kind: 'list-rooms' });
const listed = await ben.expect(
  'room list',
  (m): m is Extract<ServerMessage, { kind: 'rooms' }> => m.kind === 'rooms',
);
const openRoom = listed.rooms[0];
assert(
  openRoom !== undefined && openRoom.code === annaJoined.code && openRoom.free === 1,
  'lobby browser shows the open room with a free seat',
);
assert(
  openRoom.players.length === 1 && openRoom.players[0]?.name === 'Anna',
  'lobby browser shows who is already waiting',
);
ben.send({ kind: 'join-room', code: openRoom.code, name: 'Ben' });
const benJoined = await ben.expect('joined', isJoined);
ben.playerId = benJoined.playerId;
ben.joined = benJoined;
await anna.expectView('sees a crew the mission takes', (v) =>
  v.players.length === 2 && v.crewSize.min <= 2 && v.crewSize.max >= 2);

// The host cannot start until everyone else has confirmed.
anna.send({ kind: 'start-mission' });
const tooEarly = await anna.expect('not-ready error', isError);
assert(/Noch nicht bereit: Ben/.test(tooEarly.message), 'starting before Ben confirms is refused');
ben.send({ kind: 'set-ready', ready: true });
await anna.expectView('sees Ben confirm', (v) =>
  v.players.some((p) => p.name === 'Ben' && p.ready));

anna.send({ kind: 'start-mission' });
/** Where the server drew a client's start. */
const drawnStart = async (client: TestClient): Promise<Start> => {
  const view = await client.until('a run with a drawn spawn', (v) =>
    v.phase === 'playing' && v.map !== null);
  const at = view.map?.yourSpawn;
  return at?.x === SPAWNS.archiv.x && at.y === SPAWNS.archiv.y ? 'archiv' : 'maschinenraum';
};
const annaStart = await drawnStart(anna);
const benStart = await drawnStart(ben);
assert(annaStart !== benStart, `the draw put Anna in the ${annaStart}, Ben in the ${benStart}`);
const clients: Clients =
  annaStart === 'archiv'
    ? { archiv: anna, maschinenraum: ben }
    : { archiv: ben, maschinenraum: anna };
await clients.archiv.expectView('stands at the book with the Laborkennung, no puzzle on', (v) =>
  v.phase === 'playing' && v.map !== null && v.puzzle === null &&
  v.presence.manualId === 'buch-archiv' && v.manualsHere.length === 1 &&
  v.presence.signSeen && v.edgework !== null);
const fromBox = await clients.maschinenraum.expectView(
  'starts at the fuse box in the Maschinenraum',
  (v) => v.map !== null && v.presence.manualId === null,
);
assert(fromBox.edgework === null && !fromBox.presence.signSeen,
  'the one from the Maschinenraum has not seen the sign');
assert(fromBox.map?.manuals.map((m) => m.id).join(',') === 'buch-archiv',
  'the crew has found the book in the Archiv, and not yet the terminal');

// Map pings fan out to the whole crew and are rate limited per player.
anna.send({ kind: 'ping', x: 9, y: 6 });
anna.send({ kind: 'ping', x: 3, y: 3 }); // swallowed by the cooldown
const pinged = await ben.expect(
  'ping arrives',
  (m): m is Extract<ServerMessage, { kind: 'ping' }> => m.kind === 'ping',
);
assert(
  pinged.playerId === annaJoined.playerId && pinged.x === 9 && pinged.y === 6,
  'ping is broadcast to the other player with its origin',
);
await sleep(200);
assert(
  !ben.hasQueued((m) => m.kind === 'ping'),
  'a second ping within the cooldown is dropped',
);

// An audience connection sees the whole lab, every side of a puzzle and who stands where.
const zoe = new TestClient('zoe');
await zoe.open();
zoe.send({ kind: 'spectate', code: annaJoined.code });
const watched = await zoe.expect(
  'spectator view',
  (m): m is Extract<ServerMessage, { kind: 'spectator-view' }> => m.kind === 'spectator-view',
);
assert(watched.view.panels.length === 2, 'spectator gets one panel per player');
assert(
  watched.view.players.length === 2 && watched.view.map !== null,
  'spectator sees the crew and the map',
);
assert(
  watched.view.map.manuals.length === mission.map.manuals.length,
  'spectator sees every manual object, found or not',
);
assert(
  watched.view.players.some((p) => p.presence.manualId === 'buch-archiv'),
  'spectator sees who stands at a book',
);
assert(watched.view.puzzle === null, 'spectator sees no puzzle while the crew is still walking');

// Quick chat reaches the whole crew with the phrase intact.
anna.send({ kind: 'chat', phrase: 'drohne' });
const said = await ben.expect(
  'chat arrives',
  (m): m is Extract<ServerMessage, { kind: 'chat' }> => m.kind === 'chat',
);
assert(
  said.playerId === annaJoined.playerId && said.phrase === 'drohne',
  'quick chat is broadcast with its sender and phrase',
);

/** Ids of the drones in the client's latest positions message, sorted and comma-joined. */
const streamedDrones = (client: TestClient): string =>
  Object.keys(client.drones).sort().join(',');

/** The rooms the mission's solved stations light, each once, as the views must list them. */
const litAfter = (solvedCount: number): string =>
  [...new Set(mission.puzzles.slice(0, solvedCount).flatMap((p) => p.lights))].join(',');

const logSizes = (): Record<Start, number> => ({
  archiv: clients.archiv.raw.length,
  maschinenraum: clients.maschinenraum.raw.length,
});
const openWindows: OpenWindow[] = [];

let solved = 0;
for (const step of BLACKOUT_WALKTHROUGH) {
  const client = clients[step.who];
  if ('goTo' in step) {
    await (step.frozen === undefined
      ? walkTo(client, step.goTo)
      : crossFrozen(client, step.goTo, step.frozen));
    continue;
  }
  const self = await client.ensureSelf();
  const item = client.view?.map?.items.find((i) => !i.delivered);
  const goal = item?.deliverTo ?? null;
  const atItem =
    item !== undefined &&
    (item.carriedBy === client.playerId
      ? goal !== null && Math.hypot(self.x - (goal.x + 0.5), self.y - (goal.y + 0.5)) <= 0.95
      : Math.hypot(self.x - item.x, self.y - item.y) <= 0.95);

  if (atItem && item !== undefined) {
    // Context action: this press either picks the fuse up or installs it.
    const carrying = item.carriedBy === client.playerId;
    client.send({ kind: 'interact' });
    await client.until('item handled', (v) => {
      const live = v.map?.items.find((i) => i.id === item.id);
      return carrying ? live?.delivered === true : live?.carriedBy === client.playerId;
    });
    console.log(`✓ ${step.who}: ${carrying ? 'delivered' : 'picked up'} ${item.label}`);
    continue;
  }

  const station = client.view?.map?.stations.find((s) => s.status === 'armed');
  assert(
    station !== undefined &&
      Math.hypot(self.x - (station.x + 0.5), self.y - (station.y + 0.5)) <= 1.6,
    `${step.who} stands within interact range of station ${solved + 1}`,
  );
  const opened = logSizes();
  client.send({ kind: 'interact' });
  await client.until('puzzle active', (v) => v.puzzle !== null);
  const sides = sidesOf(clients, solved);
  const operator = startOf(clients, sides.operator);
  const reader = startOf(clients, sides.reader);
  if (solved === 0) {
    const live = await zoe.untilSpectator('sees both sides of the running puzzle', (v) =>
      v.puzzle?.kind === 'wiring');
    assert(
      live.puzzle?.kind === 'wiring' && live.puzzle.wires !== null && live.puzzle.manual !== null,
      'spectator sees the wires and the printed rules at the same time',
    );
    await solveWiring(clients);
  } else if (solved === 1) {
    clients.maschinenraum = await solveKeypad(clients);
  } else if (solved === 2) {
    await solveSwitches(clients);
  } else if (solved === 3) {
    await solveSimon(clients);
  } else {
    await solveSync(clients);
  }
  openWindows.push({ from: opened, to: logSizes(), operator, reader });
  solved += 1;
  if (solved < mission.puzzles.length) {
    const back = await clients.archiv.expectView(`puzzle ${solved} solved, back on the map`, (v) =>
      v.currentPuzzleIndex === solved && v.puzzle === null);
    assert(back.map?.litRooms.join(',') === litAfter(solved),
      `the rooms lit after station ${solved} are the ones its stations light`);
  }
  // Security wakes up in stages: the Flur drone after station 2, the Labor drone after 3.
  if (solved === 1) {
    // Any positions message arriving after the view above was sent after the solve.
    const stale = clients.archiv.positions;
    await clients.archiv.untilPositions('a fresh positions message', (p) => p !== stale);
    assert(streamedDrones(clients.archiv) === '',
      'no drone patrols before the second station');
  } else if (solved === 2) {
    await clients.archiv.untilPositions('only the Flur drone patrols', () =>
      streamedDrones(clients.archiv) === 'flurwache');
    console.log('✓ only the Flur drone patrols after the second station');
  } else if (solved === 3) {
    await clients.archiv.untilPositions('both drones patrol', () =>
      streamedDrones(clients.archiv) === 'flurwache,laborwache');
    console.log('✓ both drones patrol after the third station');
  }
}

// --- escape finale: everyone to the hatch before the clock runs out --------
const unlocked = await clients.archiv.expectView('exit hatch is open', (v) =>
  v.map?.exit?.open === true);
assert(unlocked.map?.manuals.length === mission.map.manuals.length,
  'the crew has found every manual object on the way');
await walkTo(clients.maschinenraum, [17, 11]);
const halfwayOut = clients.archiv.view?.phase;
assert(halfwayOut === 'playing', 'one player at the hatch is not enough to escape');
await walkTo(clients.archiv, [17, 11]);

const won = await clients.archiv.expectView('won the mission', (v) => v.phase === 'won');
await clients.maschinenraum.expectView('won the mission', (v) => v.phase === 'won');
assert(/erwachen die Systeme/.test(won.storyText), 'win story is shown');
// At least the wrong cut and the wrong key; patrolling drones may add more.
assert(won.penaltySeq >= 2, 'both deliberate penalties were counted');
assertKeptApart(clients, openWindows);

// The end screen credits each player with what they did.
const creditOf = (start: Start): Credits =>
  won.credits[clients[start].playerId ?? ''] ?? fail(`no credits for the ${start}`);
const [fromArchiv, fromMaschine] = [creditOf('archiv'), creditOf('maschinenraum')];
const summed = (key: keyof Credits): number => fromArchiv[key] + fromMaschine[key];
assert(summed('operated') === mission.puzzles.length && fromArchiv.operated >= 1,
  'every station is credited to the player whose input solved it');
assert(fromArchiv.read === 3 && fromMaschine.read === 1,
  'reading is credited once per station to whoever read its rules while it was open');
assert(fromArchiv.alarms >= 1 && fromMaschine.alarms >= 1 && summed('alarms') === won.penaltySeq,
  'every alarm is credited to whoever set it off');
assert(fromMaschine.delivered === 1 && summed('found') === 0 && summed('hints') === 0,
  'the fuse is credited to its carrier; nothing was searched and no note asked for');

// The next run starts by itself once the whole crew confirms on the end screen.
assert(
  (clients.archiv.view?.players ?? []).every((p) => !p.ready),
  'finishing the run cleared the old confirmations',
);
const second = clients.maschinenraum.view?.you.name ?? fail('no view of the second player');
clients.maschinenraum.send({ kind: 'set-ready', ready: true });
await clients.archiv.until('one confirmation in', (v) =>
  v.players.some((p) => p.name === second && p.ready));
const afterOneYes = clients.archiv.view?.phase;
assert(afterOneYes === 'won', 'one confirmation alone does not restart the mission');
clients.archiv.send({ kind: 'set-ready', ready: true });
const replay = await clients.archiv.expectView('is playing again', (v) => v.phase === 'playing');
// The fresh report holds nothing but mission control's opener.
assert(
  replay.currentPuzzleIndex === 0 &&
    replay.penaltySeq === 0 &&
    replay.events.length === 1 &&
    replay.events[0]?.label === mission.radio.start,
  'the rematch starts from a clean slate',
);
const redrawn = replay.map?.yourSpawn;
assert(
  mission.map.spawns.some((s) => s.x === redrawn?.x && s.y === redrawn.y),
  'the rematch draws the spawns again',
);

for (const client of Object.values(clients)) {
  client.close();
}
console.log(
  '\nSmoke test passed: Blackout with drawn spawns, streamed movement, plates, books, the ' +
    'camera plate, reconnect, penalties and credits. 🎉',
);
process.exit(0);
