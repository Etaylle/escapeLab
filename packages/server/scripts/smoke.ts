/**
 * End-to-end smoke test: boots the real server in-process, then drives two
 * real WebSocket clients through the full Blackout mission on its tile map —
 * streaming client-authoritative positions along BFS paths (plates, doors),
 * activating each station, solving every station with its module's solver
 * on the two clients' views (plus one deliberate wrong cut and one wrong
 * key), and surviving a mid-game reconnect. No answer is written down here.
 * Run with: pnpm --filter @escapelab/server smoke
 */
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import {
  moduleFor,
  parseMission,
  type DronePosition,
  type Edgework,
  type PlayerPosition,
  type PlayerView,
  type PuzzleInput,
  type PuzzleView,
  type ServerMessage,
  type SpectatorView,
} from '@escapelab/core';

const PORT = 3102;
process.env['PORT'] = String(PORT);
await import('../src/index.js');

const mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

type Role = 'anleitung' | 'steuerpult';

/** Scripted completion of the blackout map (validated against the layout). */
const BLACKOUT_WALKTHROUGH: ({ role: Role; goTo: [number, number] } | { role: Role; do: 'interact' })[] = [
  { role: 'steuerpult', goTo: [2, 9] },
  { role: 'steuerpult', do: 'interact' }, // notstrom
  { role: 'anleitung', goTo: [7, 6] }, // holds flurplatte
  { role: 'steuerpult', goTo: [8, 6] },
  { role: 'steuerpult', do: 'interact' }, // zugangscode
  { role: 'steuerpult', goTo: [16, 6] }, // holds serverplatte
  { role: 'anleitung', goTo: [16, 3] },
  { role: 'anleitung', do: 'interact' }, // subsysteme
  { role: 'anleitung', goTo: [12, 5] }, // leaves while serverplatte is still held
  { role: 'steuerpult', goTo: [9, 10] },
  { role: 'steuerpult', do: 'interact' }, // frequenz
  // The last station stays dead until the spare fuse arrives from the archive.
  { role: 'anleitung', goTo: [1, 1] },
  { role: 'anleitung', do: 'interact' }, // pick up the fuse
  { role: 'anleitung', goTo: [16, 9] },
  { role: 'anleitung', do: 'interact' }, // deliver it
  { role: 'steuerpult', goTo: [14, 9] },
  { role: 'steuerpult', do: 'interact' }, // reaktorstart
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

/** WebSocket client tracking the latest view, positions and its own avatar. */
class TestClient {
  private readonly socket: WebSocket;
  private readonly queue: ServerMessage[] = [];
  private waiter: (() => void) | null = null;
  readonly raw: string[] = [];
  view: PlayerView | null = null;
  /** view messages received so far; every dispatch on the server sends one to everyone */
  viewCount = 0;
  spectatorView: SpectatorView | null = null;
  positions: Record<string, PlayerPosition> = {};
  drones: Record<string, DronePosition> = {};
  playerId: string | null = null;
  /** client-authoritative avatar position (tile units) */
  self: { x: number; y: number } | null = null;

  constructor(readonly label: string) {
    this.socket = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.socket.on('message', (data) => {
      this.raw.push(String(data));
      const msg = JSON.parse(String(data)) as ServerMessage;
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

interface Clients {
  anleitung: TestClient;
  steuerpult: TestClient;
}

type Move = { roleId: string; input: PuzzleInput };

function clientFor(clients: Clients, roleId: string): TestClient {
  return roleId === 'anleitung' || roleId === 'steuerpult'
    ? clients[roleId]
    : fail(`no client plays the role "${roleId}"`);
}

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
 * What the station's module would have the crew do next, worked out from
 * nothing but the two clients' views — and the edgework, if a role sees it.
 */
function nextMoves(clients: Clients, index: number): Move[] {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
  const views: Record<string, PuzzleView> = {};
  let edgework: Edgework | null = null;
  for (const [roleId, client] of Object.entries(clients)) {
    const view = client.view ?? fail(`${client.label}: no view yet`);
    views[roleId] = view.puzzle ?? fail(`${client.label}: station ${index + 1} is not open`);
    edgework ??= view.edgework;
  }
  return moduleFor(def.type).solve(def, views, edgework);
}

/**
 * Send moves and wait for their effect everywhere: every accepted move is one
 * broadcast to each client, and each acting client's station has changed or
 * closed.
 */
async function play(clients: Clients, moves: Move[], index: number): Promise<void> {
  const crew = Object.values(clients);
  const counts = crew.map((client) => client.viewCount);
  const acting = moves.map((move) => clientFor(clients, move.roleId));
  const before = acting.map((client) => JSON.stringify(client.view?.puzzle));
  for (const [i, move] of moves.entries()) {
    acting[i]?.send({ kind: 'puzzle-input', input: move.input });
  }
  await waitFor(`station ${index + 1} to take ${JSON.stringify(moves)}`, () =>
    crew.every((client, i) => client.viewCount >= (counts[i] ?? 0) + moves.length) &&
    acting.every(
      (client, i) =>
        client.view?.currentPuzzleIndex !== index ||
        JSON.stringify(client.view.puzzle) !== before[i],
    ),
  );
}

/** Feed the solver the two clients' views until the station is done. */
async function solveStation(clients: Clients, index: number): Promise<void> {
  const crew = Object.values(clients);
  await waitFor(`both clients at station ${index + 1}`, () =>
    crew.every((client) => client.view?.puzzle?.index === index),
  );
  for (let round = 0; round < 100; round++) {
    if (crew.every((client) => (client.view?.currentPuzzleIndex ?? 0) > index)) {
      console.log(`✓ the solver cleared station ${index + 1} from the views alone`);
      return;
    }
    const moves = nextMoves(clients, index);
    if (moves.length === 0) {
      fail(`the solver has no move for station ${index + 1}`);
    }
    await play(clients, moves, index);
  }
  fail(`station ${index + 1} is still open after 100 rounds`);
}

async function solveWiring(clients: Clients): Promise<void> {
  const annaW = await clients.anleitung.expectView('sees the wiring puzzle', (v) =>
    v.puzzle?.kind === 'wiring');
  const benW = await clients.steuerpult.expectView('sees the wiring puzzle', (v) =>
    v.puzzle?.kind === 'wiring');
  assert(annaW.puzzle?.kind === 'wiring' && annaW.puzzle.wires === null,
    'manual role does not get the wire layout');
  assert(benW.puzzle?.kind === 'wiring' && benW.puzzle.wires !== null,
    'cutter role gets the wire layout');
  assert(annaW.puzzle.info !== null && /§4/.test(annaW.puzzle.info),
    'manual role has the handbook text');
  assert(!clients.steuerpult.raw.some((r) => r.includes('§4')),
    'handbook text never reached the cutter');
  assert(annaW.puzzle.manual !== null && benW.puzzle.manual === null,
    'only the manual role gets the printed rules');

  // The deliberate mistake: any wire but the one the solver would cut.
  const [right] = nextMoves(clients, 0);
  const rightId = right !== undefined && 'wireId' in right.input ? right.input.wireId : null;
  const wires = benW.puzzle.kind === 'wiring' && benW.puzzle.wires !== null ? benW.puzzle.wires : [];
  const wrong = wires.find((w) => w.id !== rightId) ?? fail('no wire left to cut wrongly');
  const deadlineBefore = benW.deadlineAt ?? 0;
  clients.steuerpult.send({ kind: 'puzzle-input', input: { wireId: wrong.id } });
  const afterPenalty = await clients.steuerpult.expectView('sees the alarm after a wrong cut',
    (v) => v.penaltySeq === 1);
  assert((afterPenalty.deadlineAt ?? 0) === deadlineBefore - WIRING.penaltySec * 1000,
    `wrong cut cost ${WIRING.penaltySec}s of deadline`);
  await clients.anleitung.until('the alarm', (v) => v.penaltySeq === 1);

  await solveStation(clients, 0);
}

/** Keypad incl. the mid-game reconnect; returns the replacement steuerpult client. */
async function solveKeypad(clients: Clients, benJoined: { code: string; playerId: string; token: string }): Promise<TestClient> {
  await clients.steuerpult.expectView('sees the keypad', (v) => v.puzzle?.kind === 'keypad');
  const benSelf = clients.steuerpult.self;
  clients.steuerpult.close();
  await clients.anleitung.expectView('sees Ben disconnected', (v) =>
    v.players.some((p) => p.name === 'Ben' && !p.connected));

  const ben2 = new TestClient('ben2');
  await ben2.open();
  ben2.send({ kind: 'resume', code: benJoined.code, playerId: benJoined.playerId,
    token: benJoined.token });
  await ben2.expect('re-joined', isJoined);
  ben2.playerId = benJoined.playerId;
  const benK = await ben2.expectView('resumed into the keypad', (v) =>
    v.puzzle?.kind === 'keypad' && v.map !== null);
  const seeded = await ben2.ensureSelf();
  assert(
    benSelf !== null && Math.hypot(seeded.x - benSelf.x, seeded.y - benSelf.y) < 0.05,
    'avatar position survived the reconnect',
  );

  const keys = benK.puzzle?.kind === 'keypad' && benK.puzzle.keys !== null ? benK.puzzle.keys : [];
  assert(keys.length === 4, 'keypad keys arrived after resume');
  const crew: Clients = { ...clients, steuerpult: ben2 };
  await clients.anleitung.until('the crew back together', (v) =>
    v.pausedFor === null && v.puzzle?.kind === 'keypad');
  const [right] = nextMoves(crew, 1);
  const rightIdx = right !== undefined && 'keyIndex' in right.input ? right.input.keyIndex : null;
  const wrongIdx = keys.findIndex((_, i) => i !== rightIdx);
  ben2.send({ kind: 'puzzle-input', input: { keyIndex: wrongIdx } });
  await ben2.expectView('sees the keypad alarm', (v) => v.penaltySeq === 2);
  await clients.anleitung.until('the keypad alarm', (v) => v.penaltySeq === 2);
  await solveStation(crew, 1);
  return ben2;
}

async function solveSwitches(clients: Clients): Promise<void> {
  await clients.anleitung.expectView('sees the switch rules but not the bank', (v) =>
    v.puzzle?.kind === 'switches' && v.puzzle.switches === null && v.puzzle.manual !== null);
  const benSw = await clients.steuerpult.expectView('sees the switch bank', (v) =>
    v.puzzle?.kind === 'switches' && v.puzzle.switches !== null);
  const bank = benSw.puzzle?.kind === 'switches' ? (benSw.puzzle.switches ?? []) : [];
  assert(!clients.anleitung.raw.some((r) => r.includes(JSON.stringify(bank))),
    'the switch bank never reached the manual client');
  await solveStation(clients, 2);
}

async function solveSimon(clients: Clients): Promise<void> {
  await clients.anleitung.expectView('sees the simon legend', (v) =>
    v.puzzle?.kind === 'simon' && v.puzzle.legend !== null);
  await clients.steuerpult.expectView('sees the simon display', (v) =>
    v.puzzle?.kind === 'simon' && v.puzzle.sequence !== null);
  await solveStation(clients, 3);
}

async function solveSync(clients: Clients): Promise<void> {
  await clients.anleitung.expectView('sees the sync finale', (v) => v.puzzle?.kind === 'button-sync');
  await solveStation(clients, 4);
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

anna.send({ kind: 'select-role', roleId: 'anleitung' });
ben.send({ kind: 'select-role', roleId: 'steuerpult' });
await anna.expectView('sees both roles taken', (v) => v.roles.every((r) => r.takenByName !== null));

// The host cannot start until everyone else has confirmed.
anna.send({ kind: 'start-mission' });
const tooEarly = await anna.expect('not-ready error', isError);
assert(/Noch nicht bereit: Ben/.test(tooEarly.message), 'starting before Ben confirms is refused');
ben.send({ kind: 'set-ready', ready: true });
await anna.expectView('sees Ben confirm', (v) =>
  v.players.some((p) => p.name === 'Ben' && p.ready));

anna.send({ kind: 'start-mission' });
const clients: Clients = { anleitung: anna, steuerpult: ben };
await anna.expectView('stands on the map, no puzzle active', (v) =>
  v.phase === 'playing' && v.map !== null && v.puzzle === null);
await ben.until('map ready', (v) => v.map !== null);

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

// An audience connection sees the whole lab and both private panels.
const zoe = new TestClient('zoe');
await zoe.open();
zoe.send({ kind: 'spectate', code: annaJoined.code });
const watched = await zoe.expect(
  'spectator view',
  (m): m is Extract<ServerMessage, { kind: 'spectator-view' }> => m.kind === 'spectator-view',
);
assert(watched.view.panels.length === 2, 'spectator gets one panel per role');
assert(
  watched.view.players.length === 2 && watched.view.map !== null,
  'spectator sees the crew and the map',
);
assert(
  watched.view.panels.every((p) => p.puzzle === null),
  'spectator sees no panel while the crew is still walking',
);

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

let solved = 0;
for (const step of BLACKOUT_WALKTHROUGH) {
  const client = clients[step.role];
  if ('goTo' in step) {
    await walkTo(client, step.goTo);
    continue;
  }
  const self = await client.ensureSelf();
  const item = client.view?.map?.items.find((i) => !i.delivered);
  const atItem =
    item !== undefined &&
    (item.carriedBy === client.playerId
      ? Math.hypot(self.x - (item.deliverTo.x + 0.5), self.y - (item.deliverTo.y + 0.5)) <= 0.95
      : Math.hypot(self.x - item.x, self.y - item.y) <= 0.95);

  if (atItem && item !== undefined) {
    // Context action: this press either picks the fuse up or installs it.
    const carrying = item.carriedBy === client.playerId;
    client.send({ kind: 'interact' });
    await client.until('item handled', (v) => {
      const live = v.map?.items.find((i) => i.id === item.id);
      return carrying ? live?.delivered === true : live?.carriedBy === client.playerId;
    });
    console.log(`✓ ${step.role}: ${carrying ? 'delivered' : 'picked up'} ${item.label}`);
    continue;
  }

  const station = client.view?.map?.stations.find((s) => s.status === 'armed');
  assert(
    station !== undefined &&
      Math.hypot(self.x - (station.x + 0.5), self.y - (station.y + 0.5)) <= 1.6,
    `${step.role} stands within interact range of station ${solved + 1}`,
  );
  client.send({ kind: 'interact' });
  await client.until('puzzle active', (v) => v.puzzle !== null);
  if (solved === 0) {
    const live = await zoe.untilSpectator('sees both sides of the running puzzle', (v) =>
      v.panels.every((p) => p.puzzle?.kind === 'wiring'));
    const cutter = live.panels.find((p) => p.puzzle?.kind === 'wiring' && p.puzzle.wires !== null);
    const manual = live.panels.find((p) => p.puzzle?.info !== null);
    assert(
      cutter !== undefined && manual !== undefined && cutter.roleId !== manual.roleId,
      'spectator sees the wires and the handbook at the same time',
    );
    await solveWiring(clients);
  } else if (solved === 1) {
    clients.steuerpult = await solveKeypad(clients, benJoined);
  } else if (solved === 2) {
    await solveSwitches(clients);
  } else if (solved === 3) {
    await solveSimon(clients);
  } else {
    await solveSync(clients);
  }
  solved += 1;
  if (solved < mission.puzzles.length) {
    await clients.anleitung.expectView(`puzzle ${solved} solved, back on the map`, (v) =>
      v.currentPuzzleIndex === solved && v.puzzle === null);
  }
  // Security wakes up in stages: the Flur drone after station 2, the Labor drone after 3.
  if (solved === 1) {
    // Any positions message arriving after the view above was sent after the solve.
    const stale = clients.anleitung.positions;
    await clients.anleitung.untilPositions('a fresh positions message', (p) => p !== stale);
    assert(streamedDrones(clients.anleitung) === '',
      'no drone patrols before the second station');
  } else if (solved === 2) {
    await clients.anleitung.untilPositions('only the Flur drone patrols', () =>
      streamedDrones(clients.anleitung) === 'flurwache');
    console.log('✓ only the Flur drone patrols after the second station');
  } else if (solved === 3) {
    await clients.anleitung.untilPositions('both drones patrol', () =>
      streamedDrones(clients.anleitung) === 'flurwache,laborwache');
    console.log('✓ both drones patrol after the third station');
  }
}

// --- escape finale: everyone to the hatch before the clock runs out --------
await clients.anleitung.expectView('exit hatch is open', (v) => v.map?.exit?.open === true);
await walkTo(clients.steuerpult, [17, 11]);
const halfwayOut = clients.anleitung.view?.phase;
assert(halfwayOut === 'playing', 'one player at the hatch is not enough to escape');
await walkTo(clients.anleitung, [17, 11]);

const annaWon = await clients.anleitung.expectView('won the mission', (v) => v.phase === 'won');
await clients.steuerpult.expectView('won the mission', (v) => v.phase === 'won');
assert(/erwachen die Systeme/.test(annaWon.storyText), 'win story is shown');
// At least the wrong cut and the wrong key; patrolling drones may add more.
assert(annaWon.penaltySeq >= 2, 'both deliberate penalties were counted');

// The next run starts by itself once the whole crew confirms on the end screen.
assert(
  (clients.anleitung.view?.players ?? []).every((p) => !p.ready),
  'finishing the run cleared the old confirmations',
);
clients.steuerpult.send({ kind: 'set-ready', ready: true });
await clients.anleitung.until('one confirmation in', (v) =>
  v.players.some((p) => p.name === 'Ben' && p.ready));
const afterOneYes = clients.anleitung.view?.phase;
assert(afterOneYes === 'won', 'one confirmation alone does not restart the mission');
clients.anleitung.send({ kind: 'set-ready', ready: true });
const replay = await clients.anleitung.expectView('is playing again', (v) => v.phase === 'playing');
// The fresh report holds nothing but mission control's opener.
assert(
  replay.currentPuzzleIndex === 0 &&
    replay.penaltySeq === 0 &&
    replay.events.length === 1 &&
    replay.events[0]?.label === mission.radio.start,
  'the rematch starts from a clean slate',
);
assert(
  replay.players.every((p) => p.roleName !== null),
  'the rematch keeps everyone in their role',
);

anna.close();
clients.steuerpult.close();
console.log('\nSmoke test passed: Blackout with streamed movement, plates, reconnect, penalties. 🎉');
process.exit(0);
