/**
 * End-to-end smoke test: boots the real server in-process, then drives two
 * real WebSocket clients through the full Blackout mission on its tile map.
 * The server draws two of the three spawns and a spot for every source, so
 * the walkthrough plans as it goes: at every station whoever is fewer steps
 * from it works it and the other reads at the source that covers it, each
 * holding the other's plate doors open on the way. It streams client-
 * authoritative positions along BFS paths, searches the locker, carries the
 * key from the Serverraum to the cabinet and the spare fuse from the Archiv
 * to the reactor (across the Flur while the camera plate holds its drone),
 * solves every station with its module's solver on the views of whoever
 * stands at the station and whoever reads its rules (plus one deliberate
 * wrong cut and one wrong key), and survives a mid-game reconnect. No answer
 * is written down here.
 * Run with: pnpm --filter @escapelab/server smoke
 */
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import {
  moduleFor,
  NO_CREDITS,
  parseMission,
  type Credits,
  type DronePosition,
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

type Tile = [number, number];

const key = (x: number, y: number): string => `${x},${y}`;

/** Where each station is worked from: a floor tile within reach of it. */
const STAND: Tile[] = [
  [2, 9], // in front of the fuse box
  [7, 6], // on the Flur plate beside the keypad, so the Maschinenraum stays open meanwhile
  [13, 6], // below the switch bank
  [10, 11], // beside the frequency panel, off the Labor drone's line
  [14, 9], // at the reactor, across from the fuse slot
];
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

/** The source holding the rules of station `index`. */
function sourceOf(index: number): { id: string; label: string } {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
  return (
    mission.map.manuals.find((m) => m.puzzleIds.includes(def.id)) ??
    fail(`nothing holds the rules of station ${index + 1}`)
  );
}

/** What only the station shows, and a line only its printed rules hold, for stations 1–4. */
const SECRETS = [
  { instance: '"wires":[{', rules: 'mehr als ein schwarzes Kabel vorhanden ist' },
  { instance: '"keys":[{', rules: 'Genau eine Spalte' },
  { instance: '"switches":[{', rules: 'hoch, wenn die Kennung' },
  { instance: '"flashes":["', rules: '1 oder mehr Alarme' },
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

/**
 * Walk `walker` to `to`. At every plate door on the way it waits in front
 * until `helper` stands on that door's plate, and the helper stays there
 * until the walker is through.
 */
async function bring(walker: TestClient, to: Tile, helper: TestClient): Promise<void> {
  const map = walker.view?.map ?? fail(`${walker.label}: no map`);
  const from = tileOf(walker);
  const path =
    bfsPath(map, from, to, (plate) => canReach(helper, plate)) ??
    fail(`${walker.label}: no way to ${to.join(',')}, not even with ${helper.label} on a plate`);
  const steps = [from, ...path];
  for (const [i, tile] of steps.entries()) {
    const plate = PLATE_OF.get(key(...tile));
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
 * Station `index`: whoever is fewer steps from where it is worked works it,
 * the other walks to its source. Holding a plate door for the reader may
 * take the operator off its spot, so it walks back last.
 */
async function takePlaces(index: number): Promise<{ op: TestClient; rd: TestClient }> {
  const stand = STAND[index] ?? fail(`no spot to work station ${index + 1} from`);
  const [op, rd] = closerTo(stand);
  await bring(op, stand, rd);
  await bring(rd, placeOf(sourceOf(index).id), op);
  await bring(op, stand, rd);
  return { op, rd };
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

/** Search the locker or unlock the cabinet the client stands at; the run report logs the find. */
async function openSource(client: TestClient, manualId: string, find: string): Promise<void> {
  const before = await client.expectView(`stands at ${manualId}, still shut`, (v) =>
    v.sourcesHere.some((s) => s.id === manualId && !s.opened) &&
    !v.manualsHere.some((m) => m.id === manualId));
  assert(before.presence.manualId !== manualId, `${manualId} shows no rules before it is opened`);
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
 * stand: the operator at the station, the reader at a source that covers
 * it. Where the whole crew presses, everyone stands at the station.
 */
function sidesOf(index: number): { operator: TestClient; reader: TestClient } {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
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

/**
 * What the two clients show of station `index`: the view at the station and
 * the view at the source, the edgework if one of them has read the sign, and
 * the seconds left on their clock.
 */
function crewSees(
  index: number,
): { views: Perspectives<PuzzleView>; edgework: Edgework | null; remainingSec: number | null } {
  const { operator, reader } = sidesOf(index);
  const atStation = operator.view ?? fail(`${operator.label}: no view yet`);
  const atSource = reader.view ?? fail(`${reader.label}: no view yet`);
  const open = (client: TestClient, view: PlayerView): PuzzleView =>
    view.puzzle ?? fail(`${client.label}: station ${index + 1} is not open`);
  const deadlineAt = atStation.deadlineAt;
  return {
    views: { operator: open(operator, atStation), reader: open(reader, atSource) },
    edgework: atStation.edgework ?? atSource.edgework,
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
 * from the client at the station, an `everyone` move from both; every
 * accepted input is one broadcast to each client, and each acting client's
 * station has changed or closed.
 */
async function play(moves: Move<PuzzleInput>[], index: number): Promise<void> {
  const counts = crew.map((client) => client.viewCount);
  const { operator } = sidesOf(index);
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

async function solveWiring(op: TestClient, rd: TestClient): Promise<void> {
  const book = sourceOf(0).id;
  const atBook = await rd.expectView('reads the wiring rules at the book', (v) =>
    v.puzzle?.kind === 'wiring' && v.presence.manualId === book);
  const atBox = await op.expectView('stands at the wiring box', (v) =>
    v.puzzle?.kind === 'wiring' && v.presence.stationId === 'notstrom');
  assert(atBook.puzzle?.kind === 'wiring' && atBook.puzzle.wires === null,
    'the reader does not get the wire layout');
  assert(atBox.puzzle?.kind === 'wiring' && atBox.puzzle.wires !== null,
    'the operator gets the wire layout');
  assert(atBook.puzzle.manual !== null && atBox.puzzle.manual === null,
    'only the reader gets the printed rules');
  assert(atBook.edgework !== null && atBox.edgework === null,
    'the edgework went to whoever walked past the sign in the Archiv, not to the box');

  // The deliberate mistake: any wire but the one the solver would cut.
  const [right] = nextMoves(0);
  const rightId = right !== undefined && 'wireId' in right.input ? right.input.wireId : null;
  const wires =
    atBox.puzzle.kind === 'wiring' && atBox.puzzle.wires !== null ? atBox.puzzle.wires : [];
  const wrong = wires.find((w) => w.id !== rightId) ?? fail('no wire left to cut wrongly');
  const deadlineBefore = atBox.deadlineAt ?? 0;
  op.send({ kind: 'puzzle-input', input: { wireId: wrong.id } });
  const afterPenalty = await op.expectView('sees the alarm after a wrong cut',
    (v) => v.penaltySeq === 1);
  assert((afterPenalty.deadlineAt ?? 0) === deadlineBefore - WIRING.penaltySec * 1000,
    `wrong cut cost ${WIRING.penaltySec}s of deadline`);
  credit(op, 'alarms');
  await rd.until('the alarm', (v) => v.penaltySeq === 1);

  // The reader cannot cut from the book.
  rd.send({ kind: 'puzzle-input', input: { wireId: wrong.id } });
  const refused = await rd.expect('refusal away from the box', isError);
  assert(refused.message === 'Dafür musst du am Pult stehen.', 'a cut from the book is refused');

  await solveStation(0);
}

/** Keypad incl. the mid-game reconnect of the reader, who takes the Laborkennung along. */
async function solveKeypad(op: TestClient, rd: TestClient): Promise<void> {
  const clipboard = sourceOf(1).id;
  const joined = rd.joined ?? fail(`${rd.label}: never joined`);
  const name = rd.view?.you.name ?? fail(`${rd.label}: no view yet`);
  await rd.expectView('reads the keypad table, Laborkennung picked up', (v) =>
    v.puzzle?.kind === 'keypad' && v.puzzle.manual !== null && v.edgework !== null);
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
  const reading = await back.expectView('resumed at the clipboard, the table in hand', (v) =>
    v.puzzle?.kind === 'keypad' && v.map !== null && v.presence.manualId === clipboard);
  assert(reading.edgework !== null, 'the Laborkennung survived the reconnect');
  const seeded = await back.ensureSelf();
  assert(
    before !== null && Math.hypot(seeded.x - before.x, seeded.y - before.y) < 0.05,
    'avatar position survived the reconnect',
  );
  crew = crew[0] === rd ? [back, crew[1]] : [crew[0], back];

  const atKeys = await op.until('the crew back together', (v) =>
    v.pausedFor === null && v.puzzle?.kind === 'keypad');
  const keys =
    atKeys.puzzle?.kind === 'keypad' && atKeys.puzzle.keys !== null ? atKeys.puzzle.keys : [];
  assert(
    keys.length === 4 &&
      reading.puzzle?.kind === 'keypad' &&
      reading.puzzle.keys === null &&
      reading.puzzle.manual !== null,
    'the table arrived after resume, the keys stay at the keypad',
  );
  const [right] = nextMoves(1);
  const rightIdx = right !== undefined && 'keyIndex' in right.input ? right.input.keyIndex : null;
  const wrongIdx = keys.findIndex((_, i) => i !== rightIdx);
  op.send({ kind: 'puzzle-input', input: { keyIndex: wrongIdx } });
  await back.expectView('sees the keypad alarm', (v) => v.penaltySeq === 2);
  await op.until('the keypad alarm', (v) => v.penaltySeq === 2);
  credit(op, 'alarms');
  await solveStation(1);
}

async function solveSwitches(op: TestClient, rd: TestClient): Promise<void> {
  await rd.expectView('reads the switch rules but sees no bank', (v) =>
    v.puzzle?.kind === 'switches' && v.puzzle.switches === null && v.puzzle.manual !== null);
  const atBank = await op.expectView('stands at the switch bank', (v) =>
    v.puzzle?.kind === 'switches' && v.puzzle.switches !== null);
  const bank = atBank.puzzle?.kind === 'switches' ? (atBank.puzzle.switches ?? []) : [];
  assert(!rd.raw.some((r) => r.includes(JSON.stringify(bank))),
    'the switch bank never reached the reader');
  await solveStation(2);
}

async function solveSimon(op: TestClient, rd: TestClient): Promise<void> {
  await rd.expectView('reads the tables without the flashes', (v) =>
    v.puzzle?.kind === 'simon' && v.puzzle.flashes === null && v.puzzle.manual !== null);
  await op.expectView('stands at the flashing panel', (v) =>
    v.puzzle?.kind === 'simon' && v.puzzle.flashes !== null);
  await solveStation(3);
}

async function solveSync(): Promise<void> {
  for (const client of crew) {
    await client.expectView('stands at the reactor with the crew', (v) =>
      v.puzzle?.kind === 'button-sync' && v.presence.stationId === 'reaktorstart');
  }
  await solveStation(4);
}

/** Switch on the armed station from where `client` stands, which has to be within reach. */
async function switchOn(client: TestClient, index: number): Promise<void> {
  const self = await client.ensureSelf();
  const station = client.view?.map?.stations.find((s) => s.status === 'armed');
  assert(
    station !== undefined &&
      Math.hypot(self.x - (station.x + 0.5), self.y - (station.y + 0.5)) <= 1.6,
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

const openWindows: OpenWindow[] = [];

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
  openWindows.push({
    operator: { ...operator, to: operator.log.length },
    reader: { ...reader, to: reader.log.length },
  });
  credit(op, 'operated');
  credit(rd, 'read');
  await backOnTheMap(index + 1);
}

/**
 * While each of stations 1–4 was open, its instance never reached its reader
 * and its rules never reached its operator. Outside that window a player may
 * well have read them.
 */
function assertKeptApart(windows: OpenWindow[]): void {
  for (const [i, { instance, rules }] of SECRETS.entries()) {
    const open = windows[i] ?? fail(`station ${i + 1} was never opened`);
    const received = ({ log, from, to }: LogWindow): string => log.slice(from, to).join('\n');
    assert(!received(open.reader).includes(instance),
      `station ${i + 1}: the instance never reached the reader`);
    assert(!received(open.operator).includes(rules),
      `station ${i + 1}: the printed rules never reached the operator`);
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

// The sign and the sources go to whoever comes near them, the sources for the whole crew.
const sign = mission.map.edgeworkSign ?? fail('Blackout has no sign');
const near = (spot: Tile, radius: number): boolean =>
  crew.some((client) => {
    const at = spawnOf(client);
    return Math.hypot(spot[0] - at.x, spot[1] - at.y) <= radius;
  });
const foundAtStart = mission.map.manuals
  .filter((m) => near(placeOf(m.id), 3.5))
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

// Station 1: the fuse box in the Maschinenraum, its rules in the book in the Archiv.
const atFuseBox = await takePlaces(0);
await runStation(0, atFuseBox, async () => {
  const live = await zoe.untilSpectator('sees both sides of the running puzzle', (v) =>
    v.puzzle?.kind === 'wiring');
  assert(
    live.puzzle?.kind === 'wiring' && live.puzzle.wires !== null && live.puzzle.manual !== null,
    'spectator sees the wires and the printed rules at the same time',
  );
  await solveWiring(atFuseBox.op, atFuseBox.rd);
});

// Station 2: the keypad in the Flur, its table on the clipboard.
const atKeypad = await takePlaces(1);
await runStation(1, atKeypad, () => solveKeypad(atKeypad.op, atKeypad.rd));

// Station 3: the switch bank in the Flur, its rules in the locker, which has to be searched.
const atBank = await takePlaces(2);
const locker = sourceOf(2);
await openSource(atBank.rd, locker.id, `Spind durchsucht: ${locker.label}`);
await runStation(2, atBank, () => solveSwitches(atBank.op, atBank.rd));

// Station 4: the panel in the Labor, its tables in the cabinet the key from the Serverraum opens.
await unlockCabinet();
const atPanel = await takePlaces(3);
await runStation(3, atPanel, () => solveSimon(atPanel.op, atPanel.rd));

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
// At least the wrong cut and the wrong key; patrolling drones may add more.
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
assert(summed('operated') === mission.puzzles.length,
  'every station is credited to the player whose input solved it');
assert(summed('alarms') === won.penaltySeq, 'every alarm is credited to whoever set it off');

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

for (const client of crew) {
  client.close();
}
console.log(
  '\nSmoke test passed: Blackout with drawn spawns and sources, streamed movement, plates, ' +
    'the locker, the key, the camera plate, reconnect, penalties and credits. 🎉',
);
process.exit(0);
