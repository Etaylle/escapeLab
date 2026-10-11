/**
 * End-to-end smoke test: boots the real server in-process, then drives two
 * real WebSocket clients through the full Blackout mission on its tile map —
 * streaming client-authoritative positions along BFS paths (plates, doors),
 * activating each station, solving every puzzle type (with one deliberate
 * wrong cut and one wrong key), and surviving a mid-game reconnect.
 * Run with: pnpm --filter @escapelab/server smoke
 */
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import {
  parseMission,
  type DronePosition,
  type PlayerPosition,
  type PlayerView,
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
const KEYPAD = keypadDef;
const pairMatches = (w: { left: string; right: string }, [a, b]: readonly [string, string]) =>
  (w.left === a && w.right === b) || (w.left === b && w.right === a);

interface Clients {
  anleitung: TestClient;
  steuerpult: TestClient;
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

  const wires = benW.puzzle.kind === 'wiring' && benW.puzzle.wires !== null ? benW.puzzle.wires : [];
  const decoy = wires.find((w) => !WIRING.pairsToCut.some((t) => pairMatches(w, t)));
  const deadlineBefore = benW.deadlineAt ?? 0;
  clients.steuerpult.send({ kind: 'cut-wire', wireId: decoy?.id ?? '' });
  const afterPenalty = await clients.steuerpult.expectView('sees the alarm after a wrong cut',
    (v) => v.penaltySeq === 1);
  assert((afterPenalty.deadlineAt ?? 0) === deadlineBefore - WIRING.penaltySec * 1000,
    `wrong cut cost ${WIRING.penaltySec}s of deadline`);

  for (const target of WIRING.pairsToCut) {
    const wire = wires.find((w) => pairMatches(w, target));
    clients.steuerpult.send({ kind: 'cut-wire', wireId: wire?.id ?? '' });
  }
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

  const grid = benK.puzzle?.kind === 'keypad' && benK.puzzle.grid !== null ? benK.puzzle.grid : [];
  assert(grid.length === KEYPAD.gridSymbols.length, 'keypad grid arrived after resume');
  const wrongIdx = grid.findIndex((k) => k.symbol !== KEYPAD.code[0]);
  ben2.send({ kind: 'press-key', keyIndex: wrongIdx });
  await ben2.expectView('sees the keypad alarm', (v) => v.penaltySeq === 2);
  for (const symbol of KEYPAD.code) {
    ben2.send({ kind: 'press-key', keyIndex: grid.findIndex((k) => k.symbol === symbol) });
  }
  return ben2;
}

async function solveSwitches(clients: Clients): Promise<void> {
  const annaSw = await clients.anleitung.expectView('sees the switch targets', (v) =>
    v.puzzle?.kind === 'switches' && v.puzzle.target !== null);
  const benSw = await clients.steuerpult.expectView('sees the switch panel', (v) =>
    v.puzzle?.kind === 'switches' && v.puzzle.switches !== null);
  const target = annaSw.puzzle?.kind === 'switches' ? (annaSw.puzzle.target ?? []) : [];
  const bank = benSw.puzzle?.kind === 'switches' ? (benSw.puzzle.switches ?? []) : [];
  assert(!clients.steuerpult.raw.some((r) => r.includes(JSON.stringify(target))),
    'switch targets never reached the panel client');
  bank.forEach((sw, i) => {
    if (target.includes(sw.symbol)) {
      clients.steuerpult.send({ kind: 'toggle-switch', switchIndex: i });
    }
  });
  clients.steuerpult.send({ kind: 'commit-switches' });
}

async function solveSimon(clients: Clients): Promise<void> {
  const annaSi = await clients.anleitung.expectView('sees the simon legend', (v) =>
    v.puzzle?.kind === 'simon' && v.puzzle.legend !== null);
  const benSi = await clients.steuerpult.expectView('sees the simon display', (v) =>
    v.puzzle?.kind === 'simon' && v.puzzle.sequence !== null);
  const legend = annaSi.puzzle?.kind === 'simon' ? (annaSi.puzzle.legend ?? []) : [];
  const sequence = benSi.puzzle?.kind === 'simon' ? (benSi.puzzle.sequence ?? []) : [];
  const buttons = benSi.puzzle?.kind === 'simon' ? (benSi.puzzle.buttons ?? []) : [];
  for (const color of sequence) {
    const symbol = legend.find((l) => l.color === color)?.symbol;
    clients.steuerpult.send({ kind: 'press-simon', buttonIndex: buttons.findIndex((b) => b === symbol) });
  }
}

async function solveSync(clients: Clients): Promise<void> {
  await clients.anleitung.expectView('sees the sync finale', (v) => v.puzzle?.kind === 'button-sync');
  clients.anleitung.send({ kind: 'press-button' });
  clients.steuerpult.send({ kind: 'press-button' });
}

// --- run ---------------------------------------------------------------------

const anna = new TestClient('anna');
await anna.open();
anna.send({ kind: 'create-room', name: 'Anna', missionId: 'blackout' });
const annaJoined = await anna.expect('joined', isJoined);
anna.playerId = annaJoined.playerId;
await anna.expectView('sees the lobby', (v) => v.phase === 'lobby');

const ben = new TestClient('ben');
await ben.open();
ben.send({ kind: 'join-room', code: annaJoined.code, name: 'Ben' });
const benJoined = await ben.expect('joined', isJoined);
ben.playerId = benJoined.playerId;

anna.send({ kind: 'select-role', roleId: 'anleitung' });
ben.send({ kind: 'select-role', roleId: 'steuerpult' });
await anna.expectView('sees both roles taken', (v) => v.roles.every((r) => r.takenByName !== null));

anna.send({ kind: 'start-mission' });
const clients: Clients = { anleitung: anna, steuerpult: ben };
await anna.expectView('stands on the map, no puzzle active', (v) =>
  v.phase === 'playing' && v.map !== null && v.puzzle === null);
await ben.until('map ready', (v) => v.map !== null);

await anna.untilPositions('drone patrols are streamed', () => Object.keys(anna.drones).length > 0);
console.log('✓ drone patrols are streamed to the clients');

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
}

// --- escape finale: everyone to the hatch before the clock runs out --------
await clients.anleitung.expectView('exit hatch is open', (v) => v.map?.exit?.open === true);
await walkTo(clients.steuerpult, [17, 11]);
assert(
  clients.anleitung.view?.phase === 'playing',
  'one player at the hatch is not enough to escape',
);
await walkTo(clients.anleitung, [17, 11]);

const annaWon = await clients.anleitung.expectView('won the mission', (v) => v.phase === 'won');
await clients.steuerpult.expectView('won the mission', (v) => v.phase === 'won');
assert(/erwachen die Systeme/.test(annaWon.storyText), 'win story is shown');
// At least the wrong cut and the wrong key; patrolling drones may add more.
assert(annaWon.penaltySeq >= 2, 'both deliberate penalties were counted');

anna.close();
clients.steuerpult.close();
console.log('\nSmoke test passed: Blackout with streamed movement, plates, reconnect, penalties. 🎉');
process.exit(0);
