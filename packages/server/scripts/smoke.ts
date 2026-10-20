/**
 * End-to-end smoke test: boots the real server in-process, then drives two
 * real WebSocket clients through the full Blackout mission on its tile map.
 * The server draws two of the three spawns and a spot for every source, so
 * the walkthrough plans as it goes, each client holding the other's plate
 * doors open on the way. The Notstrom-Kasten and the Signalkette are worked
 * at two consoles at once, Anna at console A and Ben at console B: Ben reads
 * the Handbuch and walks past the Laborkennung first, then lets Anna into
 * the Maschinenraum to the fuse box and measures at the meter in the Flur —
 * once the box is safe, the Maschinenraum door stays open for good. At a
 * station with one console whoever is fewer steps from it works it and the
 * other reads at the source that covers it. It streams client-authoritative
 * positions along BFS paths, searches the locker, carries the key from the
 * Serverraum to the cabinet and the spare fuse from the Archiv to the
 * reactor (across the Flur while the camera plate holds its drone), solves
 * every station with its module's solver on the views of whoever stands at
 * it — at either console — and whoever reads its rules (plus one deliberate
 * short and one wrong key), has an input turned away while the reader steps
 * off from the radio panel's rules, and survives a mid-game reconnect. The
 * won run leaves its report in a run log in a temporary folder. After the
 * rematch everybody stands on the spawn just drawn, and a position from the
 * run before is dropped. No answer is written down here.
 * Run with: pnpm --filter @escapelab/server smoke
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import {
  canSee,
  moduleFor,
  NO_CREDITS,
  parseMission,
  TOKENS,
  type ConsoleId,
  type Credits,
  type DronePosition,
  type Edgework,
  type Move,
  type Perspectives,
  type PlayerPosition,
  type PlayerView,
  type PuzzleInput,
  type PuzzleView,
  type RunReport,
  type ServerMessage,
  type SolveAid,
  type SpectatorView,
} from '@escapelab/core';

const PORT = 3102;
process.env['PORT'] = String(PORT);
// Finished runs go to a log in a folder of their own, which the server has to make first.
const runsDir = mkdtempSync(join(tmpdir(), 'escapelab-smoke-'));
const RUNS_LOG = join(runsDir, 'logs', 'runs.jsonl');
process.env['RUNS_LOG'] = RUNS_LOG;
await import('../src/index.js');

const mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

type Tile = [number, number];

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * Where each station is worked from: a floor tile within reach of it — of
 * console A, where it has two.
 */
const STAND: Tile[] = [
  [2, 9], // in front of the fuse box, console A of the Notstrom-Kasten, in the Maschinenraum
  [7, 5], // beside console A of the Signalkette, in the Flur
  [13, 6], // below the navigation panel
  [10, 11], // beside the radio panel, off the Labor drone's line
  [14, 9], // at the reactor, across from the fuse slot
];
/** Beside console B of the stations worked at two consoles, by station index. */
const CONSOLE_B = new Map<number, Tile>([
  [0, [5, 5]], // north of the meter, in the Flur by the Maschinenraum door
  [1, [3, 9]], // beside console B of the Signalkette, in the Maschinenraum
]);
/** Beside the Laborkennung, in the Archiv. */
const BY_THE_SIGN: Tile = [3, 3];
/** In front of the Labor's door: out of the Labor drone's sight. */
const OUT_OF_THE_LABOR: Tile = [10, 6];

const KEY_ID = 'schluessel';
const FUSE_ID = 'ersatzsicherung';

/** The plate of every plate door, by the door's tile. */
const PLATE_OF = new Map(
  mission.map.doors.flatMap((door): [string, Tile][] => {
    const { opensBy } = door;
    const plate =
      opensBy.kind === 'plate'
        ? mission.map.plates.find((p) => p.id === opensBy.plateId)
        : undefined;
    return plate === undefined ? [] : [[key(door.x, door.y), [plate.x, plate.y]]];
  }),
);

const flurDrone =
  mission.map.drones.find((d) => d.frozenByPlate !== undefined) ??
  fail('Blackout has no drone that a camera plate holds still');
const cameraPlate =
  mission.map.plates.find((p) => p.id === flurDrone.frozenByPlate) ??
  fail('Blackout has no camera plate');
const CAMERA: Tile = [cameraPlate.x, cameraPlate.y];
const exitAt = mission.map.exit ?? fail('Blackout has no exit');
const EXIT: Tile = [exitAt.x, exitAt.y];
const fuseSlot =
  mission.map.items.find((i) => i.id === FUSE_ID)?.deliverTo ?? fail('the fuse goes nowhere');
const FUSE_SLOT: Tile = [fuseSlot.x, fuseSlot.y];
/** The Maschinenraum door: its plate holds it until the first station is solved, then it stays. */
const lastingDoor =
  mission.map.doors.find(
    (d) => d.opensBy.kind === 'plate' && d.opensBy.untilSolved === mission.puzzles[0]?.id,
  ) ?? fail('Blackout has no plate door that the first station opens for good');
const lastingPlate =
  lastingDoor.opensBy.kind === 'plate' ? lastingDoor.opensBy.plateId : fail('no plate door');

/** The source holding the rules of station `index`. */
function sourceOf(index: number): { id: string; label: string } {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
  return (
    mission.map.manuals.find((m) => m.puzzleIds.includes(def.id)) ??
    fail(`nothing holds the rules of station ${index + 1}`)
  );
}

/**
 * What only the station shows, and a line only its printed rules hold, for
 * the stations one player works and another reads: 3 and 4. (The stations
 * worked at two consoles keep them apart in `runCircuit` and `runSignal`.)
 */
const SECRETS = [
  { index: 2, instance: '"pos":{', rules: 'Andernfalls bleibt der Marker stehen' },
  { index: 3, instance: '"pattern":"', rules: 'keine 2 Wörter der Frequenztabelle' },
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
  /** the run the latest positions belong to, by its `startedAt` */
  positionsRun: number | null = null;
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
        this.positionsRun = msg.run;
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

  /** Stream a position, stamped with the run this client plays. */
  sendPos(x: number, y: number, moving: boolean): void {
    this.self = { x, y };
    const run = this.view?.startedAt ?? fail(`${this.label}: no run to walk in`);
    this.send({ kind: 'pos', run, x, y, facing: 0, moving });
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

  /** Adopt the server-seeded position of this run for our own avatar. */
  async ensureSelf(): Promise<{ x: number; y: number }> {
    if (this.self !== null) {
      return this.self;
    }
    const id = this.playerId ?? fail(`${this.label}: no playerId yet`);
    await this.untilPositions(
      'own seeded position',
      (p) => this.positionsRun === this.view?.startedAt && p[id] !== undefined,
    );
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

/**
 * BFS path on the view's map; successive tiles excluding the start, null if
 * blocked. A closed door blocks, unless it is a plate door whose plate
 * `holdable` says somebody can stand on.
 */
function bfsPath(
  map: MapData,
  from: Tile,
  to: Tile,
  holdable: (plate: Tile) => boolean = () => false,
): Tile[] | null {
  const closed = new Set(map.doors.filter((d) => !d.open).map((d) => key(d.x, d.y)));
  const walkable = (x: number, y: number): boolean => {
    if (map.tiles[y]?.charAt(x) !== '.') {
      return false;
    }
    const plate = closed.has(key(x, y)) ? PLATE_OF.get(key(x, y)) : null;
    return plate === null || (plate !== undefined && holdable(plate));
  };
  const prev = new Map<string, string | null>([[key(...from), null]]);
  const queue: Tile[] = [from];
  while (queue.length > 0) {
    const [x, y] = queue.shift() ?? [0, 0];
    if (x === to[0] && y === to[1]) {
      const path: Tile[] = [];
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
      if (!prev.has(key(nx, ny)) && walkable(nx, ny)) {
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
async function walkTo(client: TestClient, to: Tile): Promise<void> {
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
    const fromTile: Tile = [Math.floor(self.x), Math.floor(self.y)];
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
async function crossFrozen(client: TestClient, to: Tile, droneId: string): Promise<void> {
  const frozen = (): boolean => client.drones[droneId]?.frozen === true;
  await client.untilPositions(`${droneId} frozen`, frozen);
  console.log(`✓ ${client.label}: ${droneId} stands frozen while the camera plate is held`);
  const alarms = client.view?.penaltySeq;
  await walkTo(client, to);
  assert(frozen() && client.view?.penaltySeq === alarms,
    `${client.label} crossed the Flur unseen while ${droneId} stood still`);
}

/** The tile a client's avatar stands on. */
function tileOf(client: TestClient): Tile {
  const self = client.self ?? fail(`${client.label}: no position yet`);
  return [Math.floor(self.x), Math.floor(self.y)];
}

/** Whether `client` can walk to `to` through the doors as they stand. */
function canReach(client: TestClient, to: Tile): boolean {
  const map = client.view?.map ?? fail(`${client.label}: no map`);
  return bfsPath(map, tileOf(client), to) !== null;
}

/**
 * Steps from `client` to `to`, through open doors and through closed plate
 * doors whose plate `helper` can get to; Infinity where there is no way.
 */
function stepsTo(client: TestClient, to: Tile, helper: TestClient): number {
  const map = client.view?.map ?? fail(`${client.label}: no map`);
  const path = bfsPath(map, tileOf(client), to, (plate) => canReach(helper, plate));
  return path?.length ?? Number.POSITIVE_INFINITY;
}

/** The crew, the one fewer steps from `to` first. */
function closerTo(to: Tile): [TestClient, TestClient] {
  const [a, b] = crew;
  return stepsTo(a, to, b) <= stepsTo(b, to, a) ? [a, b] : [b, a];
}

/** Whether the door on `tile` stands open with nobody on its plate: it stays open for good. */
function openForGood(map: MapData, tile: Tile): boolean {
  const plate = PLATE_OF.get(key(...tile));
  const held = map.plates.some((p) => p.pressed && p.x === plate?.[0] && p.y === plate[1]);
  return map.doors.some((d) => d.x === tile[0] && d.y === tile[1] && d.open) && !held;
}

/**
 * Walk `walker` to `to`. At every plate door on the way that does not stay
 * open by itself it waits in front until `helper` stands on that door's
 * plate, and the helper stays there until the walker is through.
 */
async function bring(walker: TestClient, to: Tile, helper: TestClient): Promise<void> {
  const map = walker.view?.map ?? fail(`${walker.label}: no map`);
  const from = tileOf(walker);
  const path =
    bfsPath(map, from, to, (plate) => canReach(helper, plate)) ??
    fail(`${walker.label}: no way to ${to.join(',')}, not even with ${helper.label} on a plate`);
  const steps = [from, ...path];
  for (const [i, tile] of steps.entries()) {
    const plate = openForGood(map, tile) ? undefined : PLATE_OF.get(key(...tile));
    const before = steps[i - 1];
    const after = steps[i + 1];
    if (plate !== undefined && before !== undefined && after !== undefined) {
      await walkTo(walker, before);
      await walkTo(helper, plate);
      await walkTo(walker, after);
    }
  }
  await walkTo(walker, to);
}

/** Where this run put a source; the audience sees every one. */
function placeOf(manualId: string): Tile {
  const source =
    zoe.spectatorView?.map?.manuals.find((m) => m.id === manualId) ??
    fail(`"${manualId}" lies nowhere`);
  return [source.x, source.y];
}

/** The tile an item lies on right now. */
function itemTile(itemId: string): Tile {
  const item = crew[0].view?.map?.items.find((i) => i.id === itemId) ?? fail(`no "${itemId}"`);
  return [Math.floor(item.x), Math.floor(item.y)];
}

/**
 * Station `index`: whoever is fewer steps from where it is worked works it
 * and the other walks to its source — unless the `reader` is named. Holding
 * a plate door for the reader may take the operator off its spot, so it
 * walks back last.
 */
async function takePlaces(
  index: number,
  reader?: TestClient,
): Promise<{ op: TestClient; rd: TestClient }> {
  const stand = STAND[index] ?? fail(`no spot to work station ${index + 1} from`);
  const [op, rd] =
    reader === undefined
      ? closerTo(stand)
      : [crew.find((client) => client !== reader) ?? fail('a crew of one'), reader];
  await bring(op, stand, rd);
  await bring(rd, placeOf(sourceOf(index).id), op);
  await bring(op, stand, rd);
  return { op, rd };
}

/**
 * Station `index` is worked at two consoles at once: `a` at console A, `b`
 * at console B. Holding a plate door for `a` may take `b` off its console,
 * so `b` takes its place first and walks back last.
 */
async function takeConsoles(index: number, a: TestClient, b: TestClient): Promise<void> {
  const atA = STAND[index] ?? fail(`no spot at console A of station ${index + 1}`);
  const atB = CONSOLE_B.get(index) ?? fail(`no spot at console B of station ${index + 1}`);
  await bring(b, atB, a);
  await bring(a, atA, b);
  await bring(b, atB, a);
}

/**
 * Before the Notstrom-Kasten opens, `reader` reads its rules in the
 * Handbuch and walks past the Laborkennung, whose serial the rules read.
 */
async function readUp(reader: TestClient, helper: TestClient): Promise<void> {
  const book = sourceOf(0);
  await bring(reader, placeOf(book.id), helper);
  const covers = (m: PlayerView['manualsHere'][number]): boolean =>
    m.id === book.id && m.sections.some((s) => s.puzzleId === CIRCUIT.id);
  await reader.expectView(`reads the rules of the ${CIRCUIT.title} in the ${book.label}`, (v) =>
    v.manualsHere.some(covers));
  await bring(reader, BY_THE_SIGN, helper);
  await reader.expectView('has the Laborkennung', (v) => v.edgework !== null);
}

// --- items and sources -------------------------------------------------------

/** E with an item at the client's feet picks it up. */
async function pickUp(client: TestClient, itemId: string): Promise<void> {
  client.send({ kind: 'interact' });
  await client.expectView(`picked up ${itemId}`, (v) =>
    v.map?.items.find((i) => i.id === itemId)?.carriedBy === client.playerId);
}

/** E with the item on its drop-off puts it in. */
async function install(client: TestClient, itemId: string): Promise<void> {
  client.send({ kind: 'interact' });
  await client.expectView(`put ${itemId} in`, (v) =>
    v.map?.items.find((i) => i.id === itemId)?.delivered === true);
}

/**
 * Search the locker or unlock the cabinet the client stands at; the run report logs the find.
 * Sources are found by sight, so whoever walked into the room up to it has found it for the crew.
 */
async function openSource(client: TestClient, manualId: string, find: string): Promise<void> {
  const before = await client.expectView(`stands at ${manualId}, still shut`, (v) =>
    v.sourcesHere.some((s) => s.id === manualId && !s.opened) &&
    !v.manualsHere.some((m) => m.id === manualId));
  assert(before.presence.manualId !== manualId, `${manualId} shows no rules before it is opened`);
  assert(before.map?.manuals.some((m) => m.id === manualId) === true,
    `${client.label} walked up to ${manualId} and found it for the crew`);
  client.send({ kind: 'open-source', manualId });
  await client.expectView(`opened ${manualId}, the rules in hand`, (v) =>
    v.manualsHere.some((m) => m.id === manualId));
  assert(client.view?.events.some((e) => e.kind === 'find' && e.label === find) === true,
    `the run report logs "${find}"`);
  credit(client, 'found');
}

/**
 * The cabinet's key lies in the Serverraum: whoever is fewer steps from it
 * fetches it while the other holds the Serverraum's plate, carries it to the
 * cabinet and unlocks it there.
 */
async function unlockCabinet(): Promise<void> {
  const cabinet = sourceOf(3);
  const keyAt = itemTile(KEY_ID);
  const [carrier, helper] = closerTo(keyAt);
  await bring(carrier, keyAt, helper);
  await pickUp(carrier, KEY_ID);
  await bring(carrier, placeOf(cabinet.id), helper);
  await openSource(carrier, cabinet.id, `Schrank aufgeschlossen: ${cabinet.label}`);
  assert(carrier.view?.map?.items.find((i) => i.id === KEY_ID)?.delivered === true,
    'the key stays in the cabinet\'s lock');
  credit(carrier, 'delivered');
}

/**
 * The reactor stays dead without the spare fuse from the Archiv: one fetches
 * it while the other holds the camera plate, so the Flur drone stands still
 * on the way out; then both meet at the reactor.
 */
async function fetchFuse(): Promise<void> {
  const fuseAt = itemTile(FUSE_ID);
  const [carrier, helper] = closerTo(fuseAt);
  await walkTo(carrier, OUT_OF_THE_LABOR);
  await walkTo(helper, CAMERA);
  await crossFrozen(carrier, fuseAt, flurDrone.id);
  await pickUp(carrier, FUSE_ID);
  await walkTo(carrier, FUSE_SLOT);
  await install(carrier, FUSE_ID);
  credit(carrier, 'delivered');
  await walkTo(helper, STAND[4] ?? fail('no spot at the reactor'));
}

// --- puzzle solvers ----------------------------------------------------------

const circuitDef = mission.puzzles[0];
const signalDef = mission.puzzles[1];
const mazeDef = mission.puzzles[2];
const morseDef = mission.puzzles[3];
if (
  circuitDef?.type !== 'circuit' ||
  signalDef?.type !== 'signal' ||
  !signalDef.legend ||
  mazeDef?.type !== 'maze' ||
  morseDef?.type !== 'morse'
) {
  fail('blackout.json should run circuit, signal with its legend, maze, morse, sync');
}
// Narrowed re-bindings: closures below keep the precise puzzle types.
const CIRCUIT = circuitDef;
const SIGNAL = signalDef;

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
 * stand: the operator at the station (at console a where it has two), the
 * partner at console b, the reader at a source that covers it — or, with
 * nobody there, whoever is not the operator. Where the whole crew presses,
 * everyone stands at the station.
 */
function sidesOf(index: number): {
  operator: TestClient;
  partner: TestClient | null;
  reader: TestClient;
} {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
  const consoleOf = (client: TestClient): ConsoleId | null =>
    client.view?.presence.stationId === def.id ? client.view.presence.console : null;
  const operator =
    crew.find((client) => consoleOf(client) === 'a') ??
    fail(`nobody stands at station ${index + 1}`);
  const partner = crew.find((client) => consoleOf(client) === 'b') ?? null;
  const reads = (client: TestClient): boolean =>
    client.view?.manualsHere.some((m) => m.sections.some((s) => s.puzzleId === def.id)) === true;
  const reader =
    crew.find((client) => client !== operator && reads(client)) ??
    crew.find((client) => client !== operator) ??
    fail(`nobody beside the operator at station ${index + 1}`);
  return { operator, partner, reader };
}

/**
 * What the clients show of station `index`: the view at the station (and at
 * its console b) and the view at the source, the edgework if one of them
 * has read the sign, and the seconds left on their clock.
 */
function crewSees(
  index: number,
): { views: Perspectives<PuzzleView>; edgework: Edgework | null; remainingSec: number | null } {
  const { operator, partner, reader } = sidesOf(index);
  const atStation = operator.view ?? fail(`${operator.label}: no view yet`);
  const atB = partner === null ? null : (partner.view ?? fail(`${partner.label}: no view yet`));
  const atSource = reader.view ?? fail(`${reader.label}: no view yet`);
  const open = (client: TestClient, view: PlayerView): PuzzleView =>
    view.puzzle ?? fail(`${client.label}: station ${index + 1} is not open`);
  const deadlineAt = atStation.deadlineAt;
  return {
    views: {
      operator: open(operator, atStation),
      ...(partner === null || atB === null ? {} : { partner: open(partner, atB) }),
      reader: open(reader, atSource),
    },
    edgework: atStation.edgework ?? atB?.edgework ?? atSource.edgework,
    remainingSec: deadlineAt === null ? null : Math.ceil((deadlineAt - Date.now()) / 1000),
  };
}

/**
 * What the station's module would have the crew do next, worked out from
 * nothing but the two clients' views — and the edgework, if one has read it.
 */
function nextMoves(index: number): Move<PuzzleInput>[] {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
  const { views, edgework } = crewSees(index);
  return moduleFor(def.type).solve(def, views, edgework);
}

/** Whether the operator holds a button down: the one wait a solver may ask for. */
function holdingDown(views: Perspectives<PuzzleView>): boolean {
  return views.operator.kind === 'button' && views.operator.holding;
}

/**
 * Send moves and wait for their effect everywhere: an operator move comes
 * from the client at the station, a partner move from the client at its
 * console b, an `everyone` move from both; every accepted input is one
 * broadcast to each client, and each acting client's station has changed or
 * closed.
 */
async function play(moves: Move<PuzzleInput>[], index: number): Promise<void> {
  const counts = crew.map((client) => client.viewCount);
  const { operator, partner } = sidesOf(index);
  const sendersOf = (by: Move<PuzzleInput>['by']): TestClient[] => {
    if (by === 'everyone') {
      return crew;
    }
    if (by === 'partner') {
      return [partner ?? fail(`nobody stands at console b of station ${index + 1}`)];
    }
    return [operator];
  };
  const sent = moves.flatMap((move) => sendersOf(move.by).map((client) => ({ client, move })));
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
async function solveStation(index: number): Promise<void> {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
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
    const { views, edgework, remainingSec } = crewSees(index);
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
    await play(moves, index);
  }
  fail(`station ${index + 1} is still open after 100 rounds`);
}

type CircuitView = Extract<PuzzleView, { kind: 'circuit' }>;

/** The Notstrom-Kasten as `view` shows it; null where it is not open. */
function circuitOf(view: PlayerView | null): CircuitView | null {
  return view?.puzzle?.kind === 'circuit' ? view.puzzle : null;
}

/** The solver's next moves at the Notstrom-Kasten, every one of them from the side `by`. */
async function playCircuit(by: Move<PuzzleInput>['by'], what: string): Promise<void> {
  const moves = nextMoves(0);
  assert(moves.length > 0 && moves.every((move) => move.by === by),
    `${what}: ${moves.length} move(s), all from the ${by === 'partner' ? 'meter' : 'box'}`);
  await play(moves, 0);
}

/**
 * The deliberate short, with every wire of the round measured and a wire
 * cut before: the box cuts a whole wire the rules do not name. It costs the
 * def's penaltySec, the box is rewired — every wire whole again — and the
 * meter's readings are gone.
 */
async function shortTheBox(box: TestClient, meter: TestClient): Promise<void> {
  const [right] = nextMoves(0);
  const named = right?.by === 'operator' && 'cut' in right.input ? right.input.cut : null;
  const wires = circuitOf(box.view)?.wires ?? fail(`${box.label}: the box shows no wires`);
  const wrong = wires.findIndex((wire, i) => !wire.cut && i !== named);
  if (named === null || wrong < 0) {
    fail('the rules name no wire, or no other whole wire is left to cut wrongly');
  }
  assert(wires.some((wire) => wire.cut), 'a wire is cut before the short');
  const deadlineBefore = box.view?.deadlineAt ?? 0;
  box.send({ kind: 'puzzle-input', input: { cut: wrong } });
  const shorted = await box.expectView('sees the alarm after a wrong cut', (v) =>
    v.penaltySeq === 1 && circuitOf(v)?.lastResult === 'short');
  assert((shorted.deadlineAt ?? 0) === deadlineBefore - CIRCUIT.penaltySec * 1000,
    `the short cost ${CIRCUIT.penaltySec}s of deadline`);
  assert(circuitOf(shorted)?.wires?.every((wire) => !wire.cut) === true,
    'the short rewired the box: every wire whole again');
  await meter.expectView('sees the readings cleared by the short', (v) => {
    const circuit = circuitOf(v);
    return v.penaltySeq === 1 && circuit?.readings?.every((r) => r === null) === true &&
      circuit.probed === null;
  });
  credit(box, 'alarms');
}

/**
 * The Notstrom-Kasten from the views alone: the solver's probes go from the
 * meter, its cuts from the box — after a cut at the meter is turned away,
 * and with the deliberate short in the second round, after which the box is
 * still made safe.
 */
async function solveCircuit(box: TestClient, meter: TestClient): Promise<void> {
  meter.send({ kind: 'puzzle-input', input: { cut: 0 } });
  const refused = await meter.expect('refusal at the meter', isError);
  assert(refused.message === 'Dieses Pult schneidet nicht.', 'a cut at the meter is turned away');
  await playCircuit('partner', 'the meter measures every wire');
  await playCircuit('operator', 'the box cuts the wire the rules name');
  await playCircuit('partner', 'the meter measures again after the cut');
  await shortTheBox(box, meter);
  await solveStation(0);
}

/**
 * What the consoles received since their logs ran to `from`, while the
 * Notstrom-Kasten was open: the meter never the box's wires, the box never
 * a reading, neither console its printed rules.
 */
function assertBoxAndMeterApart(
  { box, meter }: { box: TestClient; meter: TestClient },
  from: { box: number; meter: number },
): void {
  const atBox = box.raw.slice(from.box).join('\n');
  const atMeter = meter.raw.slice(from.meter).join('\n');
  assert(!atMeter.includes('"wires":[{'), 'the wires never reached the meter');
  assert(!atBox.includes('"readings":['), 'no reading ever reached the box');
  const rules = 'niedrigsten gemessenen Spannung';
  assert(!atBox.includes(rules) && !atMeter.includes(rules),
    'the printed rules never reached either console');
}

/**
 * Station 1, the Notstrom-Kasten, worked at two consoles at once: `box` at
 * the fuse box (console A), `meter` at the meter (console B), and the meter
 * switches it on. The box shows the wires and no voltage, the meter a
 * reading per wire and no colour, neither the rules; the audience sees all.
 */
async function runCircuit(box: TestClient, meter: TestClient): Promise<void> {
  const from = { box: box.raw.length, meter: meter.raw.length };
  await switchOn(meter, 0);
  const boxView = await box.expectView('console A shows the box: wires, no voltage, no rules',
    (v) => {
      const circuit = circuitOf(v);
      return circuit?.role === 'box' && circuit.wires !== null && circuit.readings === null &&
        circuit.voltages === null && v.puzzle?.manual === null;
    });
  const meterView = await meter.expectView('console B shows the meter: no colour, no rules',
    (v) => {
      const circuit = circuitOf(v);
      return circuit?.role === 'meter' && circuit.wires === null &&
        circuit.readings?.length === circuit.count && v.puzzle?.manual === null;
    });
  assert(circuitOf(meterView)?.count === circuitOf(boxView)?.wires?.length,
    'the meter counts the wires the box shows');
  const live = await zoe.untilSpectator('sees both consoles of the running puzzle', (v) =>
    v.puzzle?.kind === 'circuit');
  assert(
    live.puzzle?.kind === 'circuit' &&
      live.puzzle.wires !== null &&
      live.puzzle.voltages !== null &&
      live.puzzle.manual !== null,
    'spectator sees the wires, their voltages and the printed rules at the same time',
  );
  await solveCircuit(box, meter);
  assertBoxAndMeterApart({ box, meter }, from);
  // The Notstrom-Kasten counts for both consoles, whichever cut last.
  credit(box, 'operated');
  credit(meter, 'operated');
  await backOnTheMap(1);
}

type SignalView = Extract<PuzzleView, { kind: 'signal' }>;

/** The Signalkette as `view` shows it; null where it is not open. */
function signalOf(view: PlayerView): SignalView | null {
  return view.puzzle?.kind === 'signal' ? view.puzzle : null;
}

/** The key a solver's move presses at console B, which receives stage 1; null for any other. */
function keyAtB(move: Move<PuzzleInput> | undefined): { row: number; shape: string } | null {
  return move?.by === 'partner' && 'key' in move.input ? move.input.key : null;
}

/**
 * At the open Signalkette, stage 1: a key pressed at sending console A is
 * turned away without an alarm; at console B the key of the first sign,
 * then the deliberate wrong one — the second sign's shape in the next row,
 * which stands for another colour — which costs time and starts the stage
 * over.
 */
async function signalMissteps(a: TestClient, b: TestClient): Promise<void> {
  const [first, second] = nextMoves(1).map(keyAtB);
  if (first == null || second == null) {
    fail('the solver presses no two keys at console B in stage 1');
  }
  a.send({ kind: 'puzzle-input', input: { key: first } });
  const refused = await a.expect('refusal at the sending console', isError);
  assert(refused.message === 'Dieses Pult sendet — das andere gibt ein.',
    'a key pressed at the sending console is turned away');

  b.send({ kind: 'puzzle-input', input: { key: first } });
  await b.until('one sign taken', (v) => signalOf(v)?.done === 1);
  const wrong = { row: (second.row % 4) + 1, shape: second.shape };
  const deadlineBefore = b.view?.deadlineAt ?? 0;
  b.send({ kind: 'puzzle-input', input: { key: wrong } });
  const afterPenalty = await b.expectView('sees the alarm after a wrong key', (v) =>
    v.penaltySeq === 2 && signalOf(v)?.lastResult === 'wrong');
  assert(
    (afterPenalty.deadlineAt ?? 0) === deadlineBefore - SIGNAL.penaltySec * 1000 &&
      signalOf(afterPenalty)?.done === 0,
    `the wrong key cost ${SIGNAL.penaltySec}s of deadline and started the stage over`,
  );
  credit(b, 'alarms');
  await a.until('the alarm', (v) => v.penaltySeq === 2);
}

/** Every view `client` received since its log ran to `from`, as the wire carried it. */
function viewsSince(client: TestClient, from: number): { raw: string; view: PlayerView }[] {
  return client.raw.slice(from).flatMap((raw) => {
    const msg = JSON.parse(raw) as ServerMessage;
    return msg.kind === 'view' ? [{ raw, view: msg.view }] : [];
  });
}

/**
 * What console B received since its log ran to `from` while it took stage
 * 1: none of the sequence and no sign at all — its keys are rows of shapes,
 * which only the printed legend gives colours — and the same keys as A.
 */
function assertConsolesApart(
  b: TestClient,
  from: number,
  { sends, takes }: { sends: SignalView; takes: SignalView },
): void {
  const sequence = JSON.stringify(sends.sequence);
  const takenAtB = viewsSince(b, from).filter(({ view }) => signalOf(view)?.stage === 1);
  assert(
    takenAtB.length > 0 && takenAtB.every(({ raw }) => !raw.includes(sequence)),
    'the sequence of stage 1 never reached console B, which took it',
  );
  assert(
    takenAtB.every(({ raw }) => !TOKENS.some((token) => raw.includes(`"${token}"`))),
    'console B took stage 1 without a single coloured sign',
  );
  assert(
    takes.grid === null && JSON.stringify(takes.keys) === JSON.stringify(sends.keys),
    'both consoles show the same keys of shapes, in rows without a colour',
  );
}

/**
 * From stage `fleetingFrom` on the sending console shows the signs one at a
 * time, before that all at once: so say the views the consoles received
 * since their logs ran to `from`.
 */
function assertFleeting(consoles: { client: TestClient; from: number }[]): void {
  const fleetingFrom = SIGNAL.fleetingFrom ?? fail('the Signalkette shows every stage at once');
  const seen = consoles.flatMap(({ client, from }) =>
    viewsSince(client, from).flatMap(({ view }) => {
      const signal = signalOf(view);
      return signal === null ? [] : [signal];
    }),
  );
  assert(
    seen.some((signal) => signal.fleeting) &&
      seen.every((signal) => signal.fleeting === signal.stage >= fleetingFrom),
    `the signs come one at a time from stage ${fleetingFrom} on, all at once before`,
  );
}

/**
 * Station 2, the Signalkette, worked at two consoles at once: `a` stands at
 * console A, `b` at console B, and B switches it on. Console A sends stage 1
 * and B takes it, then the direction swaps with every stage. Nobody is left
 * to read the Klemmbrett; each console says whether it sends or takes.
 */
async function runSignal(a: TestClient, b: TestClient): Promise<void> {
  const from = { a: a.raw.length, b: b.raw.length };
  await switchOn(b, 1);
  const atA = await a.expectView('console A sends stage 1, all signs at once, no rules', (v) =>
    signalOf(v)?.role === 'sender' && signalOf(v)?.fleeting === false && v.puzzle?.manual === null);
  const atB = await b.expectView('console B takes it: twelve keys, no sequence, no rules', (v) =>
    signalOf(v)?.role === 'receiver' &&
    signalOf(v)?.sequence === null &&
    signalOf(v)?.keys?.length === TOKENS.length &&
    v.puzzle?.manual === null);
  const sends = signalOf(atA) ?? fail('console A lost the Signalkette');
  const takes = signalOf(atB) ?? fail('console B lost the Signalkette');
  assert(sends.console === 'a' && takes.console === 'b' && sends.sends === 'a',
    'each console knows which one it is, and console A sends first');
  await signalMissteps(a, b);

  // Stage 1 from the views alone, pressed at console B; then the direction swaps.
  await play(nextMoves(1), 1);
  await b.expectView('stage 2: console B sends now', (v) =>
    signalOf(v)?.stage === 2 && signalOf(v)?.role === 'sender');
  await a.expectView('stage 2: console A takes now', (v) =>
    signalOf(v)?.stage === 2 && signalOf(v)?.role === 'receiver');
  await solveStation(1);
  assertConsolesApart(b, from.b, { sends, takes });
  assertFleeting([
    { client: a, from: from.a },
    { client: b, from: from.b },
  ]);
  // The Signalkette counts for both consoles, whichever pressed last.
  credit(a, 'operated');
  credit(b, 'operated');
  await backOnTheMap(2);
}

/** The maze, with the mid-game reconnect of the reader, who takes the Laborkennung along. */
async function solveMaze(op: TestClient, rd: TestClient): Promise<void> {
  const locker = sourceOf(2).id;
  const joined = rd.joined ?? fail(`${rd.label}: never joined`);
  const name = rd.view?.you.name ?? fail(`${rd.label}: no view yet`);
  await rd.expectView('reads the plan with the walls, Laborkennung picked up', (v) =>
    v.puzzle?.kind === 'maze' && v.puzzle.cells !== null && v.edgework !== null);
  const before = rd.self;
  rd.close();
  await op.expectView(`sees ${name} disconnected`, (v) =>
    v.players.some((p) => p.name === name && !p.connected));

  const back = new TestClient(`${rd.label}2`, rd.raw);
  await back.open();
  back.send({ kind: 'resume', code: joined.code, playerId: joined.playerId, token: joined.token });
  await back.expect('re-joined', isJoined);
  back.playerId = joined.playerId;
  back.joined = joined;
  const reading = await back.expectView('resumed at the Spind, the plan in hand', (v) =>
    v.puzzle?.kind === 'maze' && v.map !== null && v.presence.manualId === locker);
  assert(reading.edgework !== null, 'the Laborkennung survived the reconnect');
  const seeded = await back.ensureSelf();
  assert(
    before !== null && Math.hypot(seeded.x - before.x, seeded.y - before.y) < 0.05,
    'avatar position survived the reconnect',
  );
  crew = crew[0] === rd ? [back, crew[1]] : [crew[0], back];

  const atPanel = await op.until('the crew back together', (v) =>
    v.pausedFor === null && v.puzzle?.kind === 'maze');
  const walls = reading.puzzle?.kind === 'maze' ? reading.puzzle.cells : null;
  assert(
    atPanel.puzzle?.kind === 'maze' &&
      atPanel.puzzle.pos !== null &&
      atPanel.puzzle.cells === null &&
      reading.puzzle?.kind === 'maze' &&
      reading.puzzle.pos === null &&
      reading.puzzle.manual !== null &&
      walls !== null,
    'the plan arrived after resume, the marker stays at the panel',
  );
  assert(!op.raw.some((r) => r.includes(JSON.stringify(walls))),
    'the walls never reached the panel');
  await solveStation(2);
}

async function solveMorse(op: TestClient, rd: TestClient): Promise<void> {
  await rd.expectView('reads the Morse tables but sees no lamp', (v) =>
    v.puzzle?.kind === 'morse' && v.puzzle.pattern === null && v.puzzle.manual !== null);
  await op.expectView('stands at the blinking lamp', (v) =>
    v.puzzle?.kind === 'morse' && v.puzzle.pattern !== null && v.puzzle.manual === null);
  await readerStepsAway(op, rd);
  await solveStation(3);
}

/**
 * The Labor's north-west corner, by every spot of the cabinet: from here the
 * way to the north-east corner runs along the north wall, far from the radio
 * panel, so the reader never comes close enough to see the lamp.
 */
const LABOR_CORNER: Tile = [7, 8];
/** The Labor's north-east corner: out of reach of every spot of the cabinet and of the panel. */
const AWAY_FROM_THE_CABINET: Tile = [11, 8];
const ALONE = 'Allein geht das nicht — jemand muss am anderen Pult oder bei den Regeln stehen.';

/**
 * Nobody works a station alone: the operator's panel names the reader at
 * the cabinet as backup; with the reader stepped away it names nobody and
 * the next input is turned away; back at the cabinet, the reader backs the
 * operator up again.
 */
async function readerStepsAway(op: TestClient, rd: TestClient): Promise<void> {
  const cabinet = sourceOf(3);
  const name = rd.view?.you.name ?? fail(`${rd.label}: no view yet`);
  const backedBy = (v: PlayerView): boolean =>
    v.puzzle?.backup?.name === name && v.puzzle.backup.where === cabinet.label;
  await op.expectView(`names ${name} at the ${cabinet.label} as backup`, backedBy);
  const [move] = nextMoves(3);
  if (move === undefined) {
    fail('the solver has no first move at the radio panel');
  }
  for (const to of [LABOR_CORNER, AWAY_FROM_THE_CABINET]) {
    await walkTo(rd, to);
  }
  await op.expectView('names no backup with the reader away', (v) =>
    v.puzzle?.kind === 'morse' && v.puzzle.backup === null);
  op.send({ kind: 'puzzle-input', input: move.input });
  const refused = await op.expect('refusal with nobody at the rules', isError);
  assert(refused.message === ALONE, 'an input with nobody at the rules is turned away');
  for (const to of [LABOR_CORNER, placeOf(cabinet.id)]) {
    await walkTo(rd, to);
  }
  await op.expectView(`names ${name} as backup again`, backedBy);
}

async function solveSync(): Promise<void> {
  for (const client of crew) {
    await client.expectView('stands at the reactor with the crew', (v) =>
      v.puzzle?.kind === 'button-sync' && v.presence.stationId === 'reaktorstart');
  }
  await solveStation(4);
}

/**
 * Switch on the armed station from where `client` stands, which has to be
 * within reach of it — of either console, where it has two.
 */
async function switchOn(client: TestClient, index: number): Promise<void> {
  const self = await client.ensureSelf();
  const armed = client.view?.map?.stations.filter((s) => s.status === 'armed') ?? [];
  assert(
    armed.some(
      (station) => Math.hypot(self.x - (station.x + 0.5), self.y - (station.y + 0.5)) <= 1.6,
    ),
    `${client.label} stands within interact range of station ${index + 1}`,
  );
  client.send({ kind: 'interact' });
  await client.until('puzzle active', (v) => v.puzzle !== null);
}

/** How far a client's message log ran when a station opened and when it was solved. */
interface LogWindow {
  log: string[];
  from: number;
  to: number;
}

/** What the station's operator and its reader received while it was open. */
interface OpenWindow {
  operator: LogWindow;
  reader: LogWindow;
}

/** By station index, for the stations one player works and another reads. */
const openWindows = new Map<number, OpenWindow>();

/**
 * Switch station `index` on from `op`'s spot, let `solve` finish it with
 * `rd` reading, and keep what both received meanwhile; then the station
 * counts for both, and the rooms it lights are lit.
 */
async function runStation(
  index: number,
  { op, rd }: { op: TestClient; rd: TestClient },
  solve: () => Promise<void>,
): Promise<void> {
  const operator = { log: op.raw, from: op.raw.length };
  const reader = { log: rd.raw, from: rd.raw.length };
  await switchOn(op, index);
  await solve();
  openWindows.set(index, {
    operator: { ...operator, to: operator.log.length },
    reader: { ...reader, to: reader.log.length },
  });
  credit(op, 'operated');
  credit(rd, 'read');
  await backOnTheMap(index + 1);
}

/**
 * While each station one player works and another reads was open, its
 * instance never reached its reader and its rules never reached its
 * operator. Outside that window a player may well have read them.
 */
function assertKeptApart(windows: ReadonlyMap<number, OpenWindow>): void {
  for (const { index, instance, rules } of SECRETS) {
    const open = windows.get(index) ?? fail(`station ${index + 1} was never opened`);
    const received = ({ log, from, to }: LogWindow): string => log.slice(from, to).join('\n');
    assert(!received(open.reader).includes(instance),
      `station ${index + 1}: the instance never reached the reader`);
    assert(!received(open.operator).includes(rules),
      `station ${index + 1}: the printed rules never reached the operator`);
  }
}

// --- credits -----------------------------------------------------------------

/** What the walkthrough did, by player id: what the end screen has to credit. */
const tally = new Map<string, Credits>();

function credit(client: TestClient, what: keyof Credits): void {
  const id = client.playerId ?? fail(`${client.label}: no playerId`);
  const theirs = tally.get(id) ?? NO_CREDITS;
  tally.set(id, { ...theirs, [what]: theirs[what] + 1 });
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
  openRoom !== undefined &&
    openRoom.code === annaJoined.code &&
    openRoom.free === mission.players.max - 1,
  'lobby browser shows the open room with its free seats',
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
/** The two clients in the run; a client that resumes a dropped one takes its place. */
let crew: [TestClient, TestClient] = [anna, ben];
const spawnOf = (client: TestClient): { x: number; y: number } =>
  client.view?.map?.yourSpawn ?? fail(`${client.label}: no spawn drawn`);
for (const client of crew) {
  await client.until('a run with a drawn spawn', (v) => v.phase === 'playing' && v.map !== null);
  await client.ensureSelf();
}
const spawns = mission.map.spawns.map((s) => key(s.x, s.y));
const drawn = crew.map((client) => key(spawnOf(client).x, spawnOf(client).y));
assert(
  drawn.every((at) => spawns.includes(at)) && new Set(drawn).size === crew.length,
  `the draw put Anna at ${drawn[0] ?? '?'} and Ben at ${drawn[1] ?? '?'}, two spawns of three`,
);
// The room plays on normal, where the fifth alarm ends the run; the walkthrough sets off two.
assert(
  crew.every((client) => client.view?.alarms.count === 0 && client.view?.alarms.limit === 5),
  'the run starts on normal with no alarm and a limit of five',
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
  'spectator sees every source, found or not',
);
assert(watched.view.puzzle === null, 'spectator sees no puzzle while the crew is still walking');
await zoe.untilSpectator('sees where everybody stands', (v) =>
  v.players.every((p) =>
    JSON.stringify(p.presence) ===
      JSON.stringify(crew.find((client) => client.playerId === p.id)?.view?.presence)));

// The sign and the sources go to whoever comes near them, the sources for the whole crew —
// and a source only to somebody who has it in sight: through a wall nobody finds anything.
const sign = mission.map.edgeworkSign ?? fail('Blackout has no sign');
const doorsAtStart = crew[0].view?.map?.doors ?? fail('anna: no doors at the start');
const shutAtStart = new Set(doorsAtStart.filter((d) => !d.open).map((d) => key(d.x, d.y)));
const middle = (x: number, y: number): { x: number; y: number } => ({ x: x + 0.5, y: y + 0.5 });
const inSight = (spot: Tile, radius: number): boolean =>
  crew.some((client) => {
    const at = spawnOf(client);
    return (
      Math.hypot(spot[0] - at.x, spot[1] - at.y) <= radius &&
      canSee(mission.map, middle(at.x, at.y), middle(...spot), shutAtStart)
    );
  });
const foundAtStart = mission.map.manuals
  .filter((m) => inSight(placeOf(m.id), 3.5))
  .map((m) => m.id)
  .join(',');
for (const client of crew) {
  const at = spawnOf(client);
  const atSign = Math.hypot(at.x - sign.x, at.y - sign.y) <= 1.6;
  await client.expectView(
    `${atSign ? 'has' : 'has not'} the Laborkennung and has found ${foundAtStart || 'nothing'}`,
    (v) =>
      (v.edgework !== null) === atSign &&
      v.presence.signSeen === atSign &&
      v.map?.manuals.map((m) => m.id).join(',') === foundAtStart,
  );
}

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

/**
 * After station `solved`: back on the map with one more room lit, and
 * security waking up in stages — the Flur drone after station 2, the Labor
 * drone after 3.
 */
async function backOnTheMap(solved: number): Promise<void> {
  const [watcher] = crew;
  if (solved < mission.puzzles.length) {
    const back = await watcher.expectView(`puzzle ${solved} solved, back on the map`, (v) =>
      v.currentPuzzleIndex === solved && v.puzzle === null);
    assert(
      back.map?.litRooms.join(',') === litAfter(solved) &&
        litAfter(solved).length > litAfter(solved - 1).length,
      `station ${solved} lit another room: ${litAfter(solved)}`,
    );
  }
  if (solved === 1) {
    // Any positions message arriving after the view above was sent after the solve.
    const stale = watcher.positions;
    await watcher.untilPositions('a fresh positions message', (p) => p !== stale);
    assert(streamedDrones(watcher) === '', 'no drone patrols before the second station');
  } else if (solved === 2) {
    await watcher.untilPositions('only the Flur drone patrols', () =>
      streamedDrones(watcher) === 'flurwache');
    console.log('✓ only the Flur drone patrols after the second station');
  } else if (solved === 3) {
    await watcher.untilPositions('both drones patrol', () =>
      streamedDrones(watcher) === 'flurwache,laborwache');
    console.log('✓ both drones patrol after the third station');
  }
}

// Station 1: the Notstrom-Kasten, the fuse box in the Maschinenraum and the meter in the Flur,
// its rules in the book in the Archiv. Ben reads them and the Laborkennung, then lets Anna in.
const [atBox, atMeter] = crew;
await readUp(atMeter, atBox);
await takeConsoles(0, atBox, atMeter);
await runCircuit(atBox, atMeter);
// Its plate held the Maschinenraum door so far; from now on the door stands open by itself.
await crew[0].expectView(`"${lastingDoor.id}" stays open with nobody on its plate`, (v) =>
  v.map?.doors.find((d) => d.id === lastingDoor.id)?.open === true &&
  v.map.plates.find((p) => p.id === lastingPlate)?.pressed === false);

// Station 2: the Signalkette, console A in the Flur and console B in the Maschinenraum.
const [atA, atB] = crew;
await takeConsoles(1, atA, atB);
await runSignal(atA, atB);

// Station 3: the maze's panel in the Flur, its plan in the locker, which has to be searched.
// Ben walked past the Laborkennung before the Notstrom-Kasten, and reads here.
const atMaze = await takePlaces(2, atMeter);
const locker = sourceOf(2);
await openSource(atMaze.rd, locker.id, `Spind durchsucht: ${locker.label}`);
await runStation(2, atMaze, () => solveMaze(atMaze.op, atMaze.rd));

// Station 4: the radio panel in the Labor, its tables in the cabinet the Serverraum key opens.
await unlockCabinet();
const atRadio = await takePlaces(3);
await runStation(3, atRadio, () => solveMorse(atRadio.op, atRadio.rd));

// Station 5: the reactor, dead until the spare fuse is in; the whole crew presses.
await fetchFuse();
await switchOn(crew[0], 4);
await solveSync();
await backOnTheMap(mission.puzzles.length);

// --- escape finale: everyone to the hatch before the clock runs out --------
const unlocked = await crew[0].expectView('exit hatch is open', (v) =>
  v.map?.exit?.open === true);
assert(unlocked.map?.manuals.length === mission.map.manuals.length,
  'the crew has found every source on the way');
assert(unlocked.map?.litRooms.join(',') === litAfter(mission.puzzles.length),
  `the reactor lit the last room: ${litAfter(mission.puzzles.length)}`);
const [first, last] = crew;
await walkTo(first, EXIT);
const halfwayOut = last.view?.phase;
assert(halfwayOut === 'playing', 'one player at the hatch is not enough to escape');
await walkTo(last, EXIT);

const won = await first.expectView('won the mission', (v) => v.phase === 'won');
await last.expectView('won the mission', (v) => v.phase === 'won');
assert(/erwachen die Systeme/.test(won.storyText), 'win story is shown');
// At least the wrong cut and the wrong sign; patrolling drones may add more.
assert(won.penaltySeq >= 2, 'both deliberate penalties were counted');
assert(
  won.events.filter((e) => e.kind === 'find').map((e) => e.label).join(' · ') ===
    `Spind durchsucht: ${locker.label} · Schrank aufgeschlossen: ${sourceOf(3).label}`,
  'the run report holds the searched locker and the unlocked cabinet',
);
assertKeptApart(openWindows);

// The end screen credits each player with what they did.
const creditOf = (client: TestClient): Credits =>
  won.credits[client.playerId ?? ''] ?? fail(`no credits for ${client.label}`);
const summed = (what: keyof Credits): number =>
  crew.reduce((sum, client) => sum + creditOf(client)[what], 0);
for (const client of crew) {
  const got = creditOf(client);
  const did = tally.get(client.playerId ?? '') ?? NO_CREDITS;
  assert(
    got.read === did.read && got.found === did.found && got.delivered === did.delivered,
    `${client.label} is credited with reading ${did.read}, finding ${did.found} and ` +
      `delivering ${did.delivered}`,
  );
  // The reactor counts for whichever press completed it.
  assert(got.operated - did.operated === 0 || got.operated - did.operated === 1,
    `${client.label} is credited with the ${did.operated} stations it worked, maybe the reactor`);
  assert(got.alarms >= did.alarms && got.hints === 0,
    `${client.label} carries its ${did.alarms} deliberate alarms and asked for no note`);
}
// A station counts once, one with two consoles once for each of its consoles.
const workedAt = (def: (typeof mission.puzzles)[number]): number =>
  moduleFor(def.type).consoles ?? 1;
assert(summed('operated') === mission.puzzles.reduce((sum, def) => sum + workedAt(def), 0),
  'every station is credited to whoever worked it, the Signalkette to both consoles');
assert(summed('alarms') === won.penaltySeq, 'every alarm is credited to whoever set it off');

// The won run left one line in the run log: its report, which names nobody.
const logged = readFileSync(RUNS_LOG, 'utf8').trimEnd().split('\n');
assert(logged.length === 1, `the won run left one line in ${RUNS_LOG}`);
const line = logged[0] ?? '';
const report = JSON.parse(line) as RunReport;
assert(
  report.version === 1 &&
    report.missionId === mission.id &&
    report.difficulty === 'normal' &&
    report.outcome === 'won' &&
    report.alarmLimit === 5 &&
    report.timeLimitSec === mission.timeLimitSec,
  'the run report names the mission as played on normal, and the win',
);
assert(
  report.startedAt === won.startedAt && report.finishedAt === won.finishedAt,
  'the run report has the start and the finish the end screen shows',
);
assert(
  report.crewSize === 2 &&
    Object.keys(report.spawns).join() === 'p1,p2' &&
    Object.keys(report.credits).join() === 'p1,p2' &&
    Object.values(report.spawns).every((at) =>
      mission.map.spawns.some((s) => s.x === at.x && s.y === at.y)),
  'the run report has the crew as p1 and p2, each on a spawn of the mission',
);
assert(
  report.stations.map((s) => s.puzzleId).join() === mission.puzzles.map((p) => p.id).join() &&
    report.stations.every((s, i) =>
      s.openedAt !== null &&
      s.solvedAt !== null &&
      s.solvedAt >= s.openedAt &&
      s.openedAt === (report.stations[i - 1]?.solvedAt ?? report.startedAt)),
  'the run report has every station, each up from the solve before it until its own',
);
assert(
  report.penalties.reduce((sum, p) => sum + p.count, 0) === won.penaltySeq &&
    report.stations.reduce((sum, s) => sum + s.alarms, 0) >= 2,
  'the run report has every alarm by its cause, the two deliberate ones at their stations',
);
assert(
  won.players.every((p) => !line.includes(p.name) && !line.includes(p.id)),
  'the run report holds no name and no player id',
);

// The next run starts by itself once the whole crew confirms on the end screen.
assert(
  (first.view?.players ?? []).every((p) => !p.ready),
  'finishing the run cleared the old confirmations',
);
const second = last.view?.you.name ?? fail('no view of the second player');
last.send({ kind: 'set-ready', ready: true });
await first.until('one confirmation in', (v) =>
  v.players.some((p) => p.name === second && p.ready));
const afterOneYes = first.view?.phase;
assert(afterOneYes === 'won', 'one confirmation alone does not restart the mission');
first.send({ kind: 'set-ready', ready: true });
const replay = await first.expectView('is playing again', (v) => v.phase === 'playing');
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

// Nobody starts the rematch where the run before left them: its positions put everybody on
// the spawn just drawn, and a position stamped with the run before is dropped.
const lastRun = won.startedAt ?? fail('the won run has no start');
const newRun = replay.startedAt ?? fail('the rematch has no start');
for (const client of crew) {
  await client.until('the rematch', (v) => v.phase === 'playing' && v.startedAt === newRun);
}
const onSpawn = (positions: Record<string, PlayerPosition>, member: TestClient): boolean => {
  const spawn = spawnOf(member);
  const at = positions[member.playerId ?? ''];
  return at !== undefined && at.x === spawn.x + 0.5 && at.y === spawn.y + 0.5;
};
for (const client of crew) {
  await client.untilPositions('the rematch with everybody on a fresh spawn', (p) =>
    client.positionsRun === newRun && crew.every((member) => onSpawn(p, member)));
}
console.log('✓ after the rematch, both clients see everybody on the spawn just drawn');
// One step south of the spawn, on floor for every spawn: the new run would take it.
const fresh = spawnOf(first);
const southward = { x: fresh.x + 0.5, y: fresh.y + 1, facing: 0, moving: true };
first.send({ kind: 'pos', run: lastRun, ...southward });
// The server answers in order: once the room list is back, it has handled the position.
first.send({ kind: 'list-rooms' });
await first.expect(
  'room list after the stale position',
  (m): m is Extract<ServerMessage, { kind: 'rooms' }> => m.kind === 'rooms',
);
const handled = first.positions;
await first.untilPositions('a broadcast after the stale position', (p) => p !== handled);
assert(onSpawn(first.positions, first), 'a position stamped with the run before is dropped');

for (const client of crew) {
  client.close();
}
rmSync(runsDir, { recursive: true, force: true });
console.log(
  '\nSmoke test passed: Blackout with drawn spawns and sources, streamed movement, plates, ' +
    'a door that stays open, the Notstrom-Kasten and the Signalkette at two consoles, the ' +
    'locker, the key, the camera plate, reconnect, penalties and credits. 🎉',
);
process.exit(0);
