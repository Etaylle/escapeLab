/**
 * End-to-end smoke test: boots the real server in-process, then drives two
 * real WebSocket clients through the full Blackout mission on its tile map.
 * The server draws two of the three spawns and a spot for every source, so
 * the walkthrough plans as it goes, each client holding the other's plate
 * doors open on the way. The run opens with the power on — no clock, no
 * station armed — until both have seen enough of its opening and skip it,
 * one after the other: the lights go out at the second skip; then both
 * throw the Notlicht's main switch in the Flur together: every spawn has an
 * open way to it. The room is pinned to a seed (SMOKE_SEED, 12 unless set), which
 * says which station the run has at its Wechselplatz: 12 the Signalkette, 56 the
 * Funkpult, 93 the Notstromkasten — the smoke plays whichever the seed draws. The
 * Anlaufsteuerung and the Paketfilter are worked at two consoles at once, Anna at
 * console A and Ben at console B: Ben reads the Betriebsbuch and walks past the
 * Laborkennung first, then lets Anna into the Maschinenraum to console A and takes
 * console B in the Flur — a start with the faulty feeder costs an alarm, each
 * pulse's breaker closes on the server's clock, and once the generator runs the
 * Maschinenraum door stays open for good; at the Paketfilter Ben reads the policy,
 * the wave holds while he steps off the Analysepult, and is cleared on the clock —
 * no drone is out before the Serverraum is solved. At a
 * station with one console whoever is fewer steps from it works it and the
 * other reads at the source that covers it. It streams client-authoritative
 * positions along BFS paths, each walk once no drone watches its way, as a
 * crew times its run past a patrol; searches the locker, carries the key from
 * the Serverraum round to the cabinet in the Labor and the spare fuse from the
 * Archiv to the reactor (across the Flur while the camera plate holds its
 * drone, taken while that drone patrols the Ost-Flur), solves every station
 * with its module's solver on the views of whoever stands at it — at either
 * console — and whoever reads its rules (plus a deliberate wrong start, and at
 * the Wechselplatz a wrong key at the Signalkette or a short at the
 * Notstromkasten), has an input turned away while the reader steps off from the
 * radio panel's rules where the Funkpult has the place, and survives a mid-game
 * reconnect. On the way out —
 * by the Labor's way across the lab to the hatch in the Archiv — the hatch
 * says when it opened, and the views of the crew and the audience tick off
 * whoever stands on it; the one still on the way drops there, and the run
 * stands still instead of ending; the log then says how far each of the crew walked. A fake
 * voice offer, answer and candidate go between Anna and Ben through the
 * server, and one for a player in another room goes nowhere. The
 * won run leaves its report in a run log in a temporary folder, and
 * GET /stats ranks it with the crew's names. After the rematch everybody
 * stands on the spawn just drawn, and a position from the run before is
 * dropped. Then a second crew plays the tutorial to its end: a lever thrown
 * alone springs back on the room's clock, its owner told and nothing
 * charged, before both throw theirs within the window; on the end screen a
 * guest's or an unknown choice of the next mission is refused, and the
 * host's yes naming Blackout opens it, with the power on. A third crew plays
 * the Ruheprobe, the Paketfilter's scratch mission with an emergency of its own:
 * the emergency falls into the open station's second wave, the station rests
 * through it — off both views, nothing of it in any message — and is back
 * without a switch-on, its clean wave kept, the wave in the air replaced by one
 * waiting for the Freigabe, no alarm counted; the run is won. Last a crew of
 * three plays Blackout: Finn's line drops for 70 s and the run goes on, the
 * others going on without him once the minute is over, and he is back on his
 * pass, counted in at once; Gus's line drops and a phone asks for his seat by
 * his name: Eva lets it in, his old pass refused; Finn goes to the main menu and comes
 * back, his seat kept all along; Gus gives his seat up and the two go on,
 * then Finn gives his up and the run ends, called off. Where TEST_DATABASE_URL
 * names a Postgres, the start script brings a server up on a schema of its own,
 * which it migrates itself first, and a crew winning the tutorial there leaves the
 * run in the database with a seat for each by account and the Erfolge it
 * earned; a Kennwort set there mints the account's Ausweisnummer, a phone signs
 * in with both and finds the run, and signs out again. No answer is written down here.
 * Run with: pnpm --filter @escapelab/server smoke
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import WebSocket from 'ws';
import {
  canSee,
  drawPools,
  FIND_REACH,
  FIRST_WAIT_MS,
  inCone,
  LATER_WAIT_MS,
  MAX_STEP,
  moduleFor,
  NO_CREDITS,
  NOTE_READ,
  noteSpot,
  parseMission,
  POWER_OUT,
  SNAPSHOT_EVERY_MS,
  SNAPSHOT_LIVE_MS,
  runOrder,
  SPRINT_FACTOR,
  stationCount,
  STEP_MARGIN,
  TOKENS,
  UPDATES_PER_SECOND,
  variantsOf,
  WALK_SPEED,
  walkable as floorFree,
  type ConsoleId,
  type CrewPass,
  type Credits,
  type DronePosition,
  type Edgework,
  type Mission,
  type MissionStanding,
  type MissionStats,
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
import { HANDOVER_MS } from '../src/roomManager.js';

/** 3102 unless SMOKE_PORT says otherwise, so two smokes (or a smoke next to a server) can run. */
const PORT = Number(process.env['SMOKE_PORT'] ?? 3102);
process.env['PORT'] = String(PORT);
// The smoke talks ws://, even where packages/server/cert/ would make the server speak https.
process.env['TLS'] = 'off';
// The first room is pinned to a seed, which the server takes only where it is allowed to.
process.env['ALLOW_SEED'] = '1';
/**
 * The seed of the first room: it says which station the run has at Blackout's Wechselplatz —
 * 12 the Signalkette (core test/blackoutPlan.ts `DRAW_SEEDS`), 56 the Funkpult, 93 the
 * Notstromkasten.
 */
const SEED = Number(process.env['SMOKE_SEED'] ?? 12);
// Finished runs go to a log in a folder of their own, which the server has to make first.
const runsDir = mkdtempSync(join(tmpdir(), 'escapelab-smoke-'));
const RUNS_LOG = join(runsDir, 'logs', 'runs.jsonl');
process.env['RUNS_LOG'] = RUNS_LOG;

/** The Paketfilter of the Ruheprobe: the fewest packets and the shortest fall, two waves. */
const REST_PACKETS = 5;
const REST_FALL_SEC = 8;
/** The Ruheprobe's emergencies: the first this long after its start, then one every so long. */
const REST_FIRST_SEC = 40;
const REST_EVERY_SEC = 60;
/** How many instructions carried out clear an emergency of the Ruheprobe. */
const REST_ORDERS = 2;
/**
 * The Ruheprobe: the Paketfilter's scratch mission (tools/fixtures/firewall-probe.json) with a
 * relay emergency that comes while its one station is open — in Blackout none comes before the
 * Serverraum. A station rests through it and comes back with what was done (`restProbe`). The
 * server reads it as a custom mission, from a folder that goes with the run log's.
 */
const restFile = (() => {
  const url = new URL('../../../tools/fixtures/firewall-probe.json', import.meta.url);
  const probe = JSON.parse(readFileSync(url, 'utf8'));
  const [filter] = probe.puzzles;
  const sabotage = {
    mode: 'relay',
    label: 'KÜHLKREISLAUF — RELAIS VON HAND',
    firstAfterSec: REST_FIRST_SEC,
    everySec: REST_EVERY_SEC,
    required: REST_ORDERS,
    afterSolved: 0,
  };
  return {
    ...probe,
    id: 'custom-ruheprobe',
    title: 'Ruheprobe',
    puzzles: [{ ...filter, waves: 2, packets: REST_PACKETS, fallSec: REST_FALL_SEC }],
    map: { ...probe.map, sabotage },
  };
})();
const customDir = join(runsDir, 'custom');
mkdirSync(customDir);
writeFileSync(join(customDir, `${restFile.id}.json`), JSON.stringify(restFile));
process.env['CUSTOM_MISSIONS_DIR'] = customDir;
await import('../src/index.js');

const missionFile = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);
/** What the pinned seed draws: the station the run has at each Wechselplatz, by its pool. */
const DRAW = drawPools(missionFile.puzzles, SEED);
/**
 * Blackout as the pinned run plays it: its stations in the run's order, the one its seed draws
 * at the Wechselplatz among them, the two out of service left out.
 */
const mission: Mission = {
  ...missionFile,
  puzzles: runOrder(missionFile.puzzles, DRAW).slice(0, stationCount(missionFile.puzzles)),
};

type Tile = [number, number];

const key = (x: number, y: number): string => `${x},${y}`;

/** Blackout's stations, by their index in the run. */
const NOTLICHT = 0;
const ANLAUF = 1;
const PAKETFILTER = 2;
const SUBSYSTEME = 3;
/** The Wechselplatz: the Signalkette, the Funkpult or the Notstromkasten, by the seed. */
const WECHSEL = 4;
const REAKTOR = 5;
/** The module of the station the run has at the Wechselplatz. */
const DRAWN = mission.puzzles[WECHSEL]?.type ?? 'none';

/** A tile of Blackout's map `dx`, `dy` from `spot`, which has to be floor no furniture takes. */
function besides(spot: { x: number; y: number }, dx: number, dy: number, what: string): Tile {
  const tile: Tile = [spot.x + dx, spot.y + dy];
  const furnished = mission.map.decor.some((d) => d.x === tile[0] && d.y === tile[1]);
  if (mission.map.tiles[tile[1]]?.charAt(tile[0]) !== '.' || furnished) {
    fail(`Blackout has no free floor ${what}, at ${tile.join(',')}`);
  }
  return tile;
}

/** Console `side` of the station with index `index`, or its only console. */
function consoleOf(index: number, side?: 'a' | 'b'): { x: number; y: number } {
  const id = mission.puzzles[index]?.id ?? fail(`blackout has no station ${index + 1}`);
  const at = (s: (typeof mission.map.stations)[number]): boolean =>
    s.puzzleId === id && (side === undefined || s.console === side);
  return mission.map.stations.find(at) ?? fail(`no console ${side ?? ''} of station ${index + 1}`);
}

/**
 * Where each station is worked from, read from the mission: a floor tile within reach of it —
 * of console A, where it has two — out of the drones' eye where they patrol by then.
 */
/**
 * Where the station at the Wechselplatz is worked from, by its module: beside its console —
 * console A, where it has two — and beside its console B, out of both drones' eye.
 */
const AT_THE_WECHSELPLATZ: Readonly<Record<string, () => { a: Tile; b: Tile | null }>> = {
  // below console A of the Signalkette, in the Flur's east corner, where the Flur drone never
  // looks; above its console B, in the Maschinenraum
  signal: () => ({
    a: besides(consoleOf(WECHSEL, 'a'), 0, 1, 'below console A of the Signalkette'),
    b: besides(consoleOf(WECHSEL, 'b'), 0, -1, 'above console B of the Signalkette'),
  }),
  // east of the radio panel, off the Labor drone's line
  morse: () => ({ a: besides(consoleOf(WECHSEL), 1, 0, 'beside the radio panel'), b: null }),
  // below the fuse box inside the Maschinenraum's door; above the meter in the Labor
  circuit: () => ({
    a: besides(consoleOf(WECHSEL, 'a'), 0, 1, 'below the fuse box'),
    b: besides(consoleOf(WECHSEL, 'b'), 0, -1, 'above the meter'),
  }),
};
const wechselSpots = (AT_THE_WECHSELPLATZ[DRAWN] ?? fail(`no spots for a ${DRAWN}`))();
const STAND: Tile[] = [
  // on the Notlicht's lever, in the middle of the Flur
  besides(consoleOf(NOTLICHT), 0, 0, 'at the lever'),
  // east of console A of the Anlaufsteuerung, in the Maschinenraum
  besides(consoleOf(ANLAUF, 'a'), 1, 0, 'beside console A of the Anlaufsteuerung'),
  // below the Sperrpult, console A of the Paketfilter, east of the Serverschott
  besides(consoleOf(PAKETFILTER, 'a'), 0, 1, 'below the Sperrpult'),
  // below the terminal, console A of the Serverraum
  besides(consoleOf(SUBSYSTEME, 'a'), 0, 1, 'below the terminal'),
  wechselSpots.a,
  // below the reactor's switch
  besides(consoleOf(REAKTOR), 0, 1, 'below the reactor'),
];
/** Beside console B of the stations worked at two consoles, by station index. */
const CONSOLE_B = new Map<number, Tile>([
  // east of console B of the Anlaufsteuerung, at the Flur's west end
  [ANLAUF, besides(consoleOf(ANLAUF, 'b'), 1, 0, 'beside console B of the Anlaufsteuerung')],
  // below the Analysepult, beside the Serverschott
  [PAKETFILTER, besides(consoleOf(PAKETFILTER, 'b'), 0, 1, 'below the Analysepult')],
  // above the rack
  [SUBSYSTEME, besides(consoleOf(SUBSYSTEME, 'b'), 0, -1, 'above the rack')],
  ...(wechselSpots.b === null ? [] : ([[WECHSEL, wechselSpots.b]] as [number, Tile][])),
]);
/** The Laborkennung, in the Archiv. */
const sign = mission.map.edgeworkSign ?? fail('Blackout has no sign');
/** Beside the Laborkennung: west of it. */
const BY_THE_SIGN: Tile = besides(sign, -1, 0, 'beside the sign');
const maschinentuer =
  mission.map.doors.find((d) => d.id === 'maschinentuer') ??
  fail('Blackout has no Maschinenraum door');
/** In the Maschinenraum below its door to the Flur: out of the drones' eye. */
const OUT_OF_THE_LABOR: Tile = besides(maschinentuer, 0, 1, 'below the Maschinenraum door');

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
/** The Maschinenraum door: held by its plate until the Anlaufsteuerung is solved, then open. */
const lastingDoor =
  mission.map.doors.find(
    (d) => d.opensBy.kind === 'plate' && d.opensBy.untilSolved === mission.puzzles[ANLAUF]?.id,
  ) ?? fail('Blackout has no plate door that the Anlaufsteuerung opens for good');
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
 * the station one player works and another reads: the Funkpult, where the run has it. (The
 * stations worked at two consoles keep them apart in `runStartup`, `runFirewall`, `runCircuit`,
 * `runSignal` and `runServers`.)
 */
const SECRETS =
  DRAWN === 'morse'
    ? [{ index: WECHSEL, instance: '"pattern":"', rules: 'keine 2 Wörter der Frequenztabelle' }]
    : [];

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
  /** the room the server seated this client in, for resuming there after a drop */
  joined: { code: string } | null = null;
  /** client-authoritative avatar position (tile units) */
  self: { x: number; y: number } | null = null;
  /** the newest snapshot of its room this client was handed, as the page keeps it */
  kept: Kept | null = null;
  /** the room's last snapshot as the server went down for a restart; null before */
  restartedWith: Kept | null = null;
  /** the code the socket closed with; null while it is open */
  closedWith: number | null = null;

  constructor(
    readonly label: string,
    readonly raw: string[] = [],
    /** the pass of the browser this client plays for; one resuming a dropped client shows it */
    readonly pass: CrewPass = mintPass(),
    /** the port of the server it talks to */
    port: number = PORT,
  ) {
    this.socket = new WebSocket(`ws://localhost:${port}/ws`);
    this.socket.on('close', (code) => {
      this.closedWith = code;
    });
    this.socket.on('message', (data) => {
      this.raw.push(String(data));
      const msg = JSON.parse(String(data)) as ServerMessage;
      // The server's beat, answered at once as a page answers it (client line.ts): a client
      // that says nothing for 20 s is cut as a dead page is (server heartbeat.ts).
      if (msg.kind === 'tick') {
        this.send({ kind: 'tock' });
        return;
      }
      if (msg.kind === 'error') {
        console.log(`  [${this.label}] server error: ${msg.message}`);
      }
      if (msg.kind === 'view') {
        this.view = msg.view;
        this.viewCount += 1;
      }
      this.keep(msg);
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

  /** Keeps the room's newest snapshot `msg` hands this client, as its page keeps it. */
  private keep(msg: ServerMessage): void {
    if (msg.kind !== 'snapshot' && msg.kind !== 'restart') {
      return;
    }
    this.kept = { blob: msg.blob, seq: msg.seq, at: msg.at };
    if (msg.kind === 'restart') {
      this.restartedWith = this.kept;
    }
  }

  /** Resolves once the socket is open: at once where it opened before anybody asked. */
  async open(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(msg: object): void {
    this.socket.send(JSON.stringify(msg));
  }

  /**
   * Seated once the server says so, `within` ms at the latest: the room this client sits in,
   * and its own id as its first view of it names it.
   */
  async seated(within = 5000): Promise<{ code: string; playerId: string }> {
    const { code } = await this.expect('joined', isJoined, within);
    const view = await this.until('a view of the room it sits in', () => true);
    this.joined = { code };
    this.playerId = view.you.id;
    return { code, playerId: view.you.id };
  }

  /** Stream a position, stamped with the run this client plays. */
  sendPos(x: number, y: number, moving: boolean): void {
    this.self = { x, y };
    const run = this.view?.startedAt ?? fail(`${this.label}: no run to walk in`);
    this.send({ kind: 'pos', run, x, y, facing: 0, moving, t: Date.now() });
  }

  /** E where this client stands, its spot sent with the press as the page sends it. */
  pressE(): void {
    const at = this.self ?? fail(`${this.label}: pressed E before it stood anywhere`);
    this.send({ kind: 'interact', x: at.x, y: at.y, t: Date.now() });
  }

  close(): void {
    this.socket.close();
  }

  /** Wait until a queued message matches, `within` ms; drops it and everything before it. */
  async expect<T extends ServerMessage>(
    desc: string,
    match: (msg: ServerMessage) => msg is T,
    within = 5000,
  ): Promise<T> {
    const deadline = Date.now() + within;
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

/** A room's snapshot as a client keeps it: the sealed blob, its seq, and when it was taken. */
interface Kept {
  blob: string;
  seq: number;
  at: number;
}

/** A crew pass as a browser mints it (client pass.ts): 16 bytes of id, 32 of secret, hex. */
function mintPass(): CrewPass {
  return { id: randomBytes(16).toString('hex'), secret: randomBytes(32).toString('hex') };
}

const isError = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'error' }> =>
  m.kind === 'error';
const isJoined = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'joined' }> =>
  m.kind === 'joined';
const isLeft = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'left' }> =>
  m.kind === 'left';
const isSeated = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'seated' }> =>
  m.kind === 'seated';
const isPending = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'takeover-pending' }> =>
  m.kind === 'takeover-pending';
const isAllowed = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'takeover-allowed' }> =>
  m.kind === 'takeover-allowed';
const isRestoring = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'restoring' }> =>
  m.kind === 'restoring';
const isAtMenu = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'at-menu' }> =>
  m.kind === 'at-menu';

// --- map walking -----------------------------------------------------------

type MapData = NonNullable<PlayerView['map']>;

/**
 * BFS path on the view's map, round its furniture; successive tiles
 * excluding the start, null if blocked. A closed door blocks, unless it is a
 * plate door whose plate `holdable` says somebody can stand on.
 */
function bfsPath(
  map: MapData,
  from: Tile,
  to: Tile,
  holdable: (plate: Tile) => boolean = () => false,
): Tile[] | null {
  const closed = new Set(map.doors.filter((d) => !d.open).map((d) => key(d.x, d.y)));
  const walkable = (x: number, y: number): boolean => {
    if (!floorFree(map, x, y)) {
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

/** Tiles each player has walked so far, by player id, as `walkTo` streamed them. */
const walked = new Map<string, number>();

/**
 * How far each of the crew walked in Blackout, and how long that takes at the
 * avatar's pace: what the map's size asks of a crew, for its time limit.
 */
function reportWalks(): void {
  const walks = crew.map((client) => {
    const tiles = walked.get(client.playerId ?? '') ?? 0;
    const name = client.view?.you.name ?? client.label;
    return `${name} ${tiles} tiles (${Math.round(tiles / WALK_SPEED)} s)`;
  });
  console.log(`  walked: ${walks.join(', ')} at ${WALK_SPEED} tiles a second`);
}

/**
 * How long the scripted crew took to win Blackout, from the lights going out,
 * and what was left on its clock: the run a time limit is weighed against.
 */
function reportWin(won: PlayerView, outAt: number): void {
  const took = Math.round(((won.finishedAt ?? outAt) - outAt) / 1000);
  const left = Math.round(((won.deadlineAt ?? outAt) - (won.finishedAt ?? outAt)) / 1000);
  console.log(
    `  won ${took} s after the lights went out, ${left} s left on the clock ` +
      `(limit ${mission.timeLimitSec} s, ${won.penaltySeq} alarms)`,
  );
}

/** How near a waypoint a drone counts as turning there: it may face any way a moment later. */
const TURNING_TILES = 0.75;

/**
 * Whether drone `id`, as the positions stream shows it, could catch somebody
 * at `spot` in the next moment: awake and not frozen, within its range and the
 * half-angle of its cone — a tile and 15° more of each, for the way it moves
 * on meanwhile, and any way at all where it is about to turn at a waypoint —
 * and in its line of sight.
 */
function watches(
  id: string,
  drone: DronePosition,
  spot: { x: number; y: number },
  map: MapData,
): boolean {
  const dx = spot.x - drone.x;
  const dy = spot.y - drone.y;
  if (drone.frozen || Math.hypot(dx, dy) > drone.range + 1) {
    return false;
  }
  const turning = mission.map.drones.some((d) => d.id === id && d.waypoints.some((w) =>
    Math.hypot(w.x + 0.5 - drone.x, w.y + 0.5 - drone.y) < TURNING_TILES));
  const turn = Math.atan2(dy, dx) - drone.facing;
  const off = Math.abs(((turn + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  const shut = new Set(map.doors.filter((d) => !d.open).map((d) => key(d.x, d.y)));
  const inCone = turning || off <= ((drone.halfAngleDeg + 15) * Math.PI) / 180;
  return inCone && canSee(map, drone, spot, shut);
}

/**
 * Waits until no drone watches the way `path` takes, as a crew times its run
 * past a patrol: the walk itself then takes a fraction of a second, in which a
 * drone moves a fraction of a tile. Gives up after a minute.
 */
async function pastTheDrones(client: TestClient, map: MapData, path: Tile[]): Promise<void> {
  const spots = path.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
  const [atX, atY] = tileOf(client);
  const underfoot = map.plates.find((plate) => plate.x === atX && plate.y === atY)?.id;
  // A drone the walker holds still from its plate wakes as the walker steps off it.
  const wakes = (id: string): boolean =>
    underfoot !== undefined &&
    mission.map.drones.some((d) => d.id === id && d.frozenByPlate === underfoot);
  const watched = (): boolean =>
    Object.entries(client.drones).some(([id, drone]) => {
      const looking = wakes(id) ? { ...drone, frozen: false } : drone;
      return spots.some((spot) => watches(id, looking, spot, map));
    });
  const deadline = Date.now() + 60_000;
  while (watched()) {
    if (Date.now() > deadline) {
      fail(`${client.label}: a drone watched the way to ${path.at(-1)?.join(',')} for a minute`);
    }
    await sleep(50);
  }
}

/**
 * Stream positions along a BFS path to the target tile once no drone watches
 * it, then wait for the server's positions echo (which also proves plate
 * evaluation has run). A transiently missing path means a door update is
 * still in flight — retry.
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
    await pastTheDrones(client, map, path);
    for (const [x, y] of path) {
      client.sendPos(x + 0.5, y + 0.5, true);
      self.x = x + 0.5;
      self.y = y + 0.5;
      await sleep(8);
    }
    const walker = client.playerId ?? '';
    walked.set(walker, (walked.get(walker) ?? 0) + path.length);
  }
  client.sendPos(to[0] + 0.5, to[1] + 0.5, false);
  const id = client.playerId ?? '';
  await client.untilPositions(`echo at ${to.join(',')}`, (p) => {
    const mine = p[id];
    return mine !== undefined && Math.hypot(mine.x - (to[0] + 0.5), mine.y - (to[1] + 0.5)) < 0.05;
  });
  console.log(`✓ ${client.label}: walked to ${to.join(',')}`);
}

/** How often a client sends its position, ms (client world/stream.ts). */
const UPDATE_MS = 80;
/** How far a sprinting avatar runs between two of those updates, in tiles. */
const SPRINT_STEP = (WALK_SPEED * SPRINT_FACTOR * UPDATE_MS) / 1000;
/** A burst after some lag at a sprint: its step at 12 updates a second and the guard's margin. */
const SPRINT_BURST = (WALK_SPEED * SPRINT_FACTOR) / UPDATES_PER_SECOND + STEP_MARGIN;

/** Waits until the positions stream has `client` at (x, y): the server took the step. */
async function echoedAt(client: TestClient, x: number, y: number): Promise<void> {
  const id = client.playerId ?? '';
  await client.untilPositions(`echo at ${x.toFixed(2)},${y.toFixed(2)}`, (p) => {
    const mine = p[id];
    return mine !== undefined && Math.hypot(mine.x - x, mine.y - y) < 0.01;
  });
}

/** How far the sprint runs down the Flur from the lever, tiles. */
const SPRINT_TILES = 9;

/**
 * A sprinted stretch down the Flur, open floor from the lever SPRINT_TILES east along its row,
 * as a client streams it: an update every 80 ms, each 1.3 times a walk's step, then one burst
 * after lag on the way back — longer than a walk's burst may be (1.5 tiles), within the
 * sprint's (MAX_STEP). The server has to take every one: its echo lands where each ended.
 */
async function sprintTheFlur(client: TestClient): Promise<void> {
  const [leverX, leverY] = STAND[NOTLICHT] ?? fail('no spot at the lever');
  for (let dx = 1; dx <= SPRINT_TILES; dx++) {
    besides({ x: leverX, y: leverY }, dx, 0, 'down the Flur from the lever');
  }
  await walkTo(client, [leverX, leverY]);
  const from = { x: leverX + 0.5, y: leverY + 0.5 };
  const to = { x: from.x + SPRINT_TILES, y: from.y };
  const legs = Math.ceil((to.x - from.x) / SPRINT_STEP);
  for (let i = 1; i <= legs; i++) {
    client.sendPos(from.x + ((to.x - from.x) * i) / legs, from.y, true);
    await sleep(UPDATE_MS);
  }
  await echoedAt(client, to.x, to.y);
  console.log(
    `✓ ${client.label} sprinted the Flur: ${legs} updates of ${SPRINT_STEP.toFixed(3)} tiles, ` +
      'every one taken',
  );
  const burst = Math.min(1.6, SPRINT_BURST);
  assert(burst > 1.5 && burst <= MAX_STEP,
    `a sprint's burst of ${burst.toFixed(2)} tiles lies past the walk's 1.5, within ${MAX_STEP}`);
  client.sendPos(to.x - burst, to.y, true);
  await echoedAt(client, to.x - burst, to.y);
  console.log(`✓ ${client.label}: a sprint's burst after lag, ${burst.toFixed(2)} tiles, taken`);
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

/**
 * The tile an item lies on right now; the audience sees every one. A crew member's view holds a
 * part nobody has found only while it is in their sight, and whether a lamp rested on it long
 * enough on the way past depends on how fast the positions came in.
 */
function itemTile(itemId: string): Tile {
  const item =
    zoe.spectatorView?.map?.items.find((i) => i.id === itemId) ?? fail(`no "${itemId}"`);
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
 * Before station `index` opens, `reader` reads its rules at the source that holds them, where
 * the run laid it.
 */
async function readUp(index: number, reader: TestClient, helper: TestClient): Promise<void> {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
  const book = sourceOf(index);
  await bring(reader, placeOf(book.id), helper);
  const covers = (m: PlayerView['manualsHere'][number]): boolean =>
    m.id === book.id && m.sections.some((s) => s.puzzleId === def.id);
  await reader.expectView(`reads the rules of the ${def.title} in the ${book.label}`, (v) =>
    v.manualsHere.some(covers));
}

/** `reader` walks past the Laborkennung, whose serial the Paketfilter's policy reads. */
async function pastTheSign(reader: TestClient, helper: TestClient): Promise<void> {
  await bring(reader, BY_THE_SIGN, helper);
  await reader.expectView('has the Laborkennung', (v) => v.edgework !== null);
}

// --- items and sources -------------------------------------------------------

/** E with an item at the client's feet picks it up. */
async function pickUp(client: TestClient, itemId: string): Promise<void> {
  client.pressE();
  await client.expectView(`picked up ${itemId}`, (v) => {
    const item = v.map?.items.find((i) => i.id === itemId);
    return item?.known === true && item.carriedBy === client.playerId;
  });
}

/** E with the item on its drop-off puts it in. */
async function install(client: TestClient, itemId: string): Promise<void> {
  client.pressE();
  await client.expectView(`put ${itemId} in`, (v) => {
    const item = v.map?.items.find((i) => i.id === itemId);
    return item?.known === true && item.delivered;
  });
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
  assert(before.map?.manuals.some((m) => m.id === manualId && m.found && m.known) === true,
    `${client.label} walked up to ${manualId} and found it, the crew knowing of it`);
  client.send({ kind: 'open-source', manualId });
  await client.expectView(`opened ${manualId}, the rules in hand`, (v) =>
    v.manualsHere.some((m) => m.id === manualId));
  assert(client.view?.events.some((e) => e.kind === 'find' && e.label === find) === true,
    `the run report logs "${find}"`);
  credit(client, 'found');
}

/**
 * The cabinet's key lies in the Serverraum: whoever is fewer steps from it
 * fetches it, carries it round to the cabinet in the Labor and unlocks it
 * there.
 */
async function unlockCabinet(): Promise<void> {
  const cabinet = sourceOf(WECHSEL);
  const keyAt = itemTile(KEY_ID);
  const [carrier, helper] = closerTo(keyAt);
  await bring(carrier, keyAt, helper);
  await pickUp(carrier, KEY_ID);
  await bring(carrier, placeOf(cabinet.id), helper);
  await openSource(carrier, cabinet.id, `Schrank aufgeschlossen: ${cabinet.label}`);
  const key = carrier.view?.map?.items.find((i) => i.id === KEY_ID);
  assert(key?.known === true && key.delivered, 'the key stays in the cabinet\'s lock');
  credit(carrier, 'delivered');
}

/**
 * The reactor stays dead without the spare fuse from the Archiv: whoever is nearer fetches it by
 * the Flur's west end, which the Flur drone never watches, and carries it to its slot past the
 * patrols; then both meet at the reactor.
 */
async function fetchFuse(): Promise<void> {
  const fuseAt = itemTile(FUSE_ID);
  const [carrier, helper] = closerTo(fuseAt);
  await walkTo(carrier, fuseAt);
  await pickUp(carrier, FUSE_ID);
  await walkTo(carrier, FUSE_SLOT);
  await install(carrier, FUSE_ID);
  credit(carrier, 'delivered');
  const atReactor = STAND[REAKTOR] ?? fail('no spot at the reactor');
  for (const client of [carrier, helper]) {
    await walkTo(client, atReactor);
  }
}

// --- emergencies -------------------------------------------------------------

const emergencies = mission.map.sabotage ?? fail('Blackout has no emergencies');

/** Whether an emergency has the lab: every station stands locked until it is over. */
const emergencyOn = (): boolean => crew.some((client) => client.view?.map?.sabotage != null);

/**
 * How long until the room's schedule has its next emergency, ms: `firstAfterSec` after the
 * lights went out, then every `everySec` (server room.ts `reconcileSabotage`).
 */
function nextEmergencyIn(): number {
  const since = Date.now() - lightsOutAt;
  const first = emergencies.firstAfterSec * 1000;
  const every = emergencies.everySec * 1000;
  const next = since < first ? first : Math.ceil((since - first) / every) * every + first;
  return next - since;
}

/** How long an instruction carried out may take to give way to the next on its holder's view. */
const ORDER_TAKEN_MS = 2 * 1000;

/** The relay console and the instruction `client`'s view carries now; null without an emergency. */
const relayOf = (client: TestClient) => client.view?.map?.sabotage?.relay ?? null;

/** What `client` reads out right now, as text; 'null' where it has no instruction. */
const orderOf = (client: TestClient): string =>
  JSON.stringify(relayOf(client)?.instruction ?? null);

/**
 * The instruction `holder` reads out is carried out at the console of the player it names;
 * whether one was — it is waited for until the holder reads another, two seconds at most.
 */
async function carryOut(holder: TestClient, team: readonly TestClient[]): Promise<boolean> {
  const order = relayOf(holder)?.instruction ?? null;
  const named = order === null ? null : consoleNamed(order, team);
  if (order === null || named === null) {
    return false;
  }
  const before = orderOf(holder);
  const input = { kind: 'set', control: named.control, value: order.value } as const;
  named.owner.send({ kind: 'puzzle-input', input });
  for (let waited = 0; orderOf(holder) === before && waited < ORDER_TAKEN_MS; waited += 10) {
    await sleep(10);
  }
  return true;
}

/** Whose relay console an instruction names, and the id of the control there; null for none. */
function consoleNamed(
  order: { playerName: string; control: string },
  team: readonly TestClient[],
): { owner: TestClient; control: string } | null {
  for (const owner of team) {
    const control = relayOf(owner)?.controls.find((each) => each.name === order.control);
    if (owner.view?.you.name === order.playerName && control !== undefined) {
      return { owner, control: control.id };
    }
  }
  return null;
}

/** Whether an emergency has `team`'s lab. */
const emergencyIn = (team: readonly TestClient[]): boolean =>
  team.some((client) => client.view?.map?.sabotage != null);

/**
 * A relay emergency weathered by the crew of `lab`: each instruction a console reads out is
 * carried out at the console of the player it names, until the relays hold — cleared, at no cost.
 */
async function weather(lab: Lab): Promise<void> {
  const { crew } = lab;
  const { durationSec } = lab.mission.map.sabotage ?? fail(`${lab.mission.id}: no emergencies`);
  const label = crew.map((client) => client.view?.map?.sabotage?.label).find(Boolean) ?? '?';
  const alarmsBefore = alarmsOf(crew[0]);
  const deadline = Date.now() + durationSec * 1000;
  let done = 0;
  while (emergencyIn(crew)) {
    if (Date.now() > deadline) {
      fail(`the emergency "${label}" is not cleared after ${durationSec} s`);
    }
    for (const holder of crew) {
      done += (await carryOut(holder, crew)) ? 1 : 0;
    }
    await sleep(20);
  }
  assert(
    alarmsOf(crew[0]) === alarmsBefore,
    `the emergency „${label}" weathered: ${done} instructions carried out at the consoles ` +
      'they named, cleared without an alarm',
  );
}

/** How many alarms `client`'s view counts so far. */
const alarmsOf = (client: TestClient): number => client.view?.penaltySeq ?? 0;

/** How many stations `client`'s view has solved. */
const solvedOf = (client: TestClient): number => client.view?.currentPuzzleIndex ?? 0;

/** The longest a station from the Serverraum on takes the walkthrough, walks included, s. */
const STRETCH_SEC = 75;

/**
 * Before a stretch of the run that an emergency must not cut short — a station open, a client
 * off the line — which takes `seconds` at most: an emergency that is on is weathered, and one
 * the schedule has within the stretch is waited for and weathered first. Emergencies come only
 * once `afterSolved` stations are solved.
 */
async function quietFor(seconds: number): Promise<void> {
  const solved = solvedOf(crew[0]);
  const due = solved >= emergencies.afterSolved && solved < mission.puzzles.length;
  if (!due || (!emergencyOn() && nextEmergencyIn() > seconds * 1000)) {
    return;
  }
  const comes = Date.now() + Math.max(0, nextEmergencyIn()) + 3000;
  while (!emergencyOn() && Date.now() < comes) {
    await sleep(100);
  }
  if (emergencyOn()) {
    await weather(blackoutLab());
  }
}

const serverschott =
  mission.map.doors.find((d) => d.id === 'serverschott') ?? fail('Blackout has no Serverschott');
/** Just inside the Serverschott: out of the Flur drone's eye, three steps from the camera plate. */
const INSIDE_THE_SCHOTT: Tile = besides(serverschott, 0, -1, 'inside the Serverschott');
/** How far past the camera plate the Flur drone has to have flown before it is held from behind. */
const PAST_THE_PLATE_TILES = 0.6;

/**
 * `holder` takes the camera plate from inside the Serverschott once the Flur drone has just flown
 * past it eastward, short of its turn: held there it looks away from the whole Flur west of it,
 * and still does as the holder steps off the plate and walks west — so one of the crew crosses
 * the Flur's whole length to its east end meanwhile, and the holder gets away after.
 */
async function holdTheCameraPlateFromBehind(holder: TestClient): Promise<void> {
  await walkTo(holder, INSIDE_THE_SCHOTT);
  const eastEnd = Math.max(...flurDrone.waypoints.map((w) => w.x)) + 0.5;
  const justPast = (): boolean => {
    const drone = holder.drones[flurDrone.id];
    return (
      drone !== undefined &&
      Math.cos(drone.facing) > 0.9 &&
      drone.x > CAMERA[0] + 0.5 + PAST_THE_PLATE_TILES &&
      drone.x < eastEnd - 2 * TURNING_TILES
    );
  };
  const deadline = Date.now() + 60_000;
  while (!justPast()) {
    if (Date.now() > deadline) {
      fail(`${holder.label}: the Flur drone never flew east past the camera plate in a minute`);
    }
    await sleep(20);
  }
  await walkTo(holder, CAMERA);
}

// --- puzzle solvers ----------------------------------------------------------

const leverDef = mission.puzzles[NOTLICHT];
const startupDef = mission.puzzles[ANLAUF];
const firewallDef = mission.puzzles[PAKETFILTER];
const serversDef = mission.puzzles[SUBSYSTEME];
const wechselDef = mission.puzzles[WECHSEL];
if (
  leverDef?.type !== 'button-sync' ||
  leverDef.style !== 'lever' ||
  startupDef?.type !== 'startup' ||
  firewallDef?.type !== 'firewall' ||
  serversDef?.type !== 'servers' ||
  wechselDef?.pool === undefined ||
  mission.puzzles.length !== REAKTOR + 1
) {
  fail('blackout.json should run the lever, startup, firewall, servers, its Wechselplatz, sync');
}
/** Each station of the file's that the Wechselplatz can have, by its module. */
const poolDef = <T extends Mission['puzzles'][number]['type']>(
  type: T,
): Extract<Mission['puzzles'][number], { type: T }> =>
  (missionFile.puzzles.find((def) => def.type === type && def.pool === wechselDef.pool) as
    | Extract<Mission['puzzles'][number], { type: T }>
    | undefined) ?? fail(`Blackout's Wechselplatz has no ${type}`);
// Narrowed re-bindings: closures below keep the precise puzzle types. The Notstromkasten and the
// Signalkette are the file's, whichever of the pool this run has in service.
const STARTUP = startupDef;
const FIREWALL = firewallDef;
const CIRCUIT = poolDef('circuit');
const SIGNAL = poolDef('signal');
const SERVERS = serversDef;
if (!SIGNAL.legend || missionFile.puzzles.every((def) => def.type !== 'morse')) {
  fail('Blackout’s Wechselplatz should hold the Signalkette with its legend and the Funkpult');
}

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

/** A mission the walkthrough plays and the two clients playing it. */
interface Lab {
  mission: Mission;
  crew: [TestClient, TestClient];
}

/** Blackout and the crew playing it right now: whoever resumed a dropped client included. */
const blackoutLab = (): Lab => ({ mission, crew });

/**
 * Who works station `index` and who reads its rules, by where the clients
 * stand: the operator at the station (at console a where it has two), the
 * partner at console b, the reader at a source that covers it — or, with
 * nobody there, whoever is not the operator. Where the whole crew presses,
 * everyone stands at the station.
 */
function sidesOf(
  index: number,
  lab: Lab = blackoutLab(),
): {
  operator: TestClient;
  partner: TestClient | null;
  reader: TestClient;
} {
  const { crew } = lab;
  const def = lab.mission.puzzles[index] ?? fail(`${lab.mission.id} has no station ${index + 1}`);
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
  lab: Lab = blackoutLab(),
): { views: Perspectives<PuzzleView>; edgework: Edgework | null; remainingSec: number | null } {
  const { operator, partner, reader } = sidesOf(index, lab);
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
async function play(
  moves: Move<PuzzleInput>[],
  index: number,
  lab: Lab = blackoutLab(),
): Promise<void> {
  const { crew } = lab;
  const counts = crew.map((client) => client.viewCount);
  const { operator, partner } = sidesOf(index, lab);
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
async function solveStation(index: number, lab: Lab = blackoutLab()): Promise<void> {
  const { crew } = lab;
  const def = lab.mission.puzzles[index] ?? fail(`${lab.mission.id} has no station ${index + 1}`);
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
    const { views, edgework, remainingSec } = crewSees(index, lab);
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
    await play(moves, index, lab);
  }
  fail(`station ${index + 1} is still open after 100 rounds`);
}

/**
 * Station 1, the Notlicht: the main switch in the Flur, where the whole crew
 * throws a lever at once — nothing to read, so nobody needs a partner at a
 * source. Nobody starts behind a door: both walk up to it on their own. Each
 * sees a lever lit for everybody who stands there; then both throw theirs
 * together, and the Flur lights up.
 */
async function runLever(): Promise<void> {
  const lever = STAND[NOTLICHT] ?? fail('no spot at the lever');
  for (const client of crew) {
    assert(canReach(client, lever), `${client.label} walks to the lever without a plate held`);
  }
  for (const client of crew) {
    await walkTo(client, lever);
  }
  await switchOn(crew[0], NOTLICHT);
  for (const client of crew) {
    await client.expectView('sees the main switch, a lever lit for each of the crew at it', (v) =>
      v.puzzle?.kind === 'button-sync' &&
      v.puzzle.style === 'lever' &&
      v.puzzle.here === crew.length &&
      v.puzzle.requiredCount === crew.length);
  }
  await solveStation(NOTLICHT);
  await backOnTheMap(NOTLICHT + 1);
}

/**
 * The note of the last shift pinned by the lever: the crew found it standing
 * there, the audience sees every note from the start, and its words reach
 * only who stands at it. Anna reads it for nothing — no time, no alarm, no
 * hint — and the run report says so once; Ben's read of it adds nothing.
 */
async function readTheLeverNote(): Promise<void> {
  const lever = STAND[NOTLICHT] ?? fail('no spot at the lever');
  const index = mission.map.notes.findIndex((note) => {
    const spot = noteSpot(mission.map, note);
    return spot !== null && Math.hypot(spot.x - lever[0], spot.y - lever[1]) <= 1.5;
  });
  const note = mission.map.notes[index] ?? fail('Blackout pins no note by the lever');
  const [anna, ben] = crew;
  const at = await anna.expectView('finds the note by the lever and stands at it', (v) =>
    v.map?.notes.some((n) => n.index === index && n.found) === true && v.noteHere?.index === index);
  assert(at.noteHere?.text === note.text, 'the note’s words reach whoever stands at it');
  const { deadlineAt, penaltySeq, hintsUsed } = at;
  anna.send({ kind: 'read-note', note: index });
  const read = await anna.expectView(`reads it: "${NOTE_READ}" in the run report`, (v) =>
    v.events.some((e) => e.kind === 'note' && e.label === NOTE_READ));
  assert(
    read.deadlineAt === deadlineAt && read.penaltySeq === penaltySeq && read.hintsUsed === hintsUsed,
    'the note cost no time, no alarm and no hint',
  );
  ben.send({ kind: 'read-note', note: index });
  ben.send({ kind: 'list-rooms' });
  await ben.expect('the room list after the second read', isRooms);
  assert(ben.view?.events.filter((e) => e.kind === 'note').length === 1,
    'a note read again is logged once');
  assert(zoe.spectatorView?.map?.notes.length === mission.map.notes.length,
    'the audience sees every note of the last shift as an object');
}

/** How much of what the crew sees a station left open says of itself, in characters. */
const STILL_OPEN_CHARS = 1500;
/** Longer than this between two looks of the loop, ms, and the machine was not running it. */
const LOOK_GAP_MS = 5 * 1000;
/** How long a station that runs on the server's clock may take here, in seconds. */
const ON_THE_CLOCK_SEC = 240;

/**
 * A station whose moves wait for the server's clock — the Anlaufsteuerung's pulse, the
 * Paketfilter's packets — from the views alone: the solver is asked four times a second with
 * the moment, and every move it makes is sent from the console it names; a moment without a
 * move is waited out. The Paketfilter's last wave is clean on the clock, with no move at all.
 */
async function solveOnTheClock(index: number): Promise<void> {
  const def = mission.puzzles[index] ?? fail(`blackout has no station ${index + 1}`);
  const deadline = Date.now() + ON_THE_CLOCK_SEC * 1000;
  const [watcher] = crew;
  const alarmsBefore = alarmsOf(watcher);
  // What the loop did, for the line that says why a station stayed open.
  const rounds = { played: 0, waited: 0, unseen: 0, gaps: 0 };
  let looked = Date.now();
  const solved = (): boolean =>
    crew.every((client) => (client.view?.currentPuzzleIndex ?? 0) > index);
  while (!solved()) {
    // A look long after the last: the machine slept or stood still, not the station.
    rounds.gaps += Date.now() - looked > LOOK_GAP_MS ? 1 : 0;
    looked = Date.now();
    if (Date.now() > deadline) {
      fail(stillOpen(index, rounds, alarmsOf(watcher) - alarmsBefore));
    }
    // A view of the solve may be on its way to one of the two: no station to look at then.
    if (crew.some((client) => client.view?.puzzle?.index !== index)) {
      rounds.unseen += 1;
      await sleep(50);
      continue;
    }
    const { views, edgework, remainingSec } = crewSees(index);
    const aid = { transcript: [], remainingSec, at: Date.now() };
    const moves = moduleFor(def.type).solve(def, views, edgework, aid);
    if (moves.length > 0) {
      rounds.played += 1;
      await play(moves, index);
    } else {
      rounds.waited += 1;
      await sleep(250);
    }
  }
  // The solver plays by the rules at the sources: a fault here is the smoke's own, or the clock's.
  assert(alarmsOf(watcher) === alarmsBefore,
    `the solver cleared station ${index + 1} on the clock without an alarm`);
  console.log(`✓ the solver cleared station ${index + 1} from the views alone, on the clock`);
}

/**
 * Why a station on the clock stayed open, as far as the smoke can tell: whether the loop itself
 * stood still (a laptop asleep on battery failed two runs this way, 17. and 18.11.2026); how
 * often it played moves, waited for the clock, or found a console without the station on its
 * view; the alarms it took meanwhile — every fault calls a wave or a pulse off —; and what the
 * crew sees.
 */
function stillOpen(
  index: number,
  rounds: { played: number; waited: number; unseen: number; gaps: number },
  alarms: number,
): string {
  const seen = JSON.stringify(crew.map((client) => client.view?.puzzle ?? null));
  const slept =
    rounds.gaps === 0
      ? ''
      : ` — ${rounds.gaps} time(s) the loop stood over ${LOOK_GAP_MS / 1000} s between two ` +
        'looks: the machine slept or stalled (pmset -g log), the station is not at fault';
  return (
    `station ${index + 1} is still open after ${ON_THE_CLOCK_SEC} s on the clock${slept}: ` +
    `${rounds.played} rounds with moves, ${rounds.waited} waiting, ${rounds.unseen} with a ` +
    `console not showing it, ${alarms} alarm(s); the crew sees ${seen.slice(0, STILL_OPEN_CHARS)}`
  );
}

type StartupView = Extract<PuzzleView, { kind: 'startup' }>;

/** The Anlaufsteuerung as `view` shows it; null where it is not open. */
function startupOf(view: PlayerView | null): StartupView | null {
  return view?.puzzle?.kind === 'startup' ? view.puzzle : null;
}

/**
 * The deliberate wrong start, in stage 1: console A's script is given the feeder whose lamps
 * say it is faulty — red over dark at console B's Schaltfeld — and started. No pulse goes off:
 * it costs the def's penaltySec, and the value stays in the script.
 */
async function wrongStart(typer: TestClient, board: TestClient): Promise<void> {
  const faulty = faultyFeeder(board);
  const deadlineBefore = typer.view?.deadlineAt ?? 0;
  const alarmsBefore = alarmsOf(typer);
  typer.send({ kind: 'puzzle-input', input: { cmd: 'setze', gap: 'abgang', value: faulty } });
  await typer.until('the gap set', (v) => terminalOf(v)?.values.abgang === faulty);
  typer.send({ kind: 'puzzle-input', input: { cmd: 'start' } });
  const refused = await typer.expectView('sees the alarm after a start with the faulty feeder',
    (v) => v.penaltySeq === alarmsBefore + 1);
  assert(refused.deadlineAt === deadlineBefore - STARTUP.penaltySec * 1000,
    `the wrong start cost ${STARTUP.penaltySec}s of deadline`);
  assert(
    terminalOf(refused)?.sent === false && boardOf(board.view)?.pulse === null,
    'no pulse went off: the script stands as it was, the ladder dark',
  );
  credit(typer, 'alarms');
  deliberate += 1;
  await board.until('the alarm', (v) => v.penaltySeq === alarmsBefore + 1);
}

/** The live terminal of the open Anlaufsteuerung as `view` shows it; null where it shows none. */
const terminalOf = (view: PlayerView | null) => startupOf(view)?.terminal ?? null;

/** The live Schaltfeld of the open Anlaufsteuerung as `view` shows it; null where it shows none. */
const boardOf = (view: PlayerView | null) => startupOf(view)?.board ?? null;

/** The feeder whose lamps at `board`'s Schaltfeld say it is faulty: red over dark. */
function faultyFeeder(board: TestClient): number {
  const feeders = boardOf(board.view)?.feeders ?? fail('console B shows no Schaltfeld');
  const faulty = feeders.find((entry) => entry.lamps[0] === 'rot');
  return faulty === undefined ? fail('no feeder shows a fault') : faulty.feeder;
}

/**
 * Station 2, the Anlaufsteuerung, worked at two consoles at once: `a` at console A in the
 * Maschinenraum, `b` at console B in the Flur, which switches it on. In stage 1 console A's
 * terminal runs the script and shows no lamp, console B's Schaltfeld the lamps and no script,
 * neither the rules; the audience sees all. After the deliberate wrong start the solver sets
 * the feeder the book's table names, starts, and closes its breaker once the pulse stands on
 * the ladder's marked steps, on the server's clock; then the sides swap for stage 2.
 */
async function runStartup(a: TestClient, b: TestClient): Promise<void> {
  const from = { a: a.raw.length, b: b.raw.length };
  await switchOn(b, ANLAUF);
  await a.expectView('console A types stage 1: the script, no lamp, no rules', (v) => {
    const startup = startupOf(v);
    return startup?.role === 'terminal' && startup.types === 'a' && startup.terminal !== null &&
      startup.board === null && v.puzzle?.manual === null;
  });
  const takesPulse = 'console B takes the pulse: four feeders’ lamps, no script, no rules';
  await b.expectView(takesPulse, (v) => {
    const startup = startupOf(v);
    return startup?.role === 'board' && startup.board?.feeders.length === 4 &&
      startup.board.pulse === null && startup.terminal === null && v.puzzle?.manual === null;
  });
  const live = await zoe.untilSpectator('sees the script, the lamps and the rules at once', (v) =>
    v.puzzle?.kind === 'startup' && v.puzzle.terminal !== null && v.puzzle.board !== null &&
      v.puzzle.manual !== null);
  assert(live.puzzle?.kind === 'startup', 'the audience watches the Anlaufsteuerung');
  await wrongStart(a, b);
  await solveOnTheClock(ANLAUF);
  // Stage 1 never showed console A a lamp nor console B the script; stage 2 swapped them.
  const stageOne = (client: TestClient, since: number): string =>
    viewsSince(client, since)
      .filter(({ view }) => startupOf(view)?.stage === 1)
      .map(({ raw }) => raw)
      .join('\n');
  assert(!stageOne(a, from.a).includes('"feeders":['), 'in stage 1 no lamp ever reached console A');
  assert(
    !stageOne(b, from.b).includes('"script":['),
    'in stage 1 the script never reached console B',
  );
  const swapped = viewsSince(b, from.b).some(({ view }) =>
    startupOf(view)?.stage === 2 && startupOf(view)?.role === 'terminal');
  assert(swapped, 'in stage 2 console B typed and console A took the pulse');
  const rules = 'Leuchtbild';
  const sawRules = [a.raw.slice(from.a), b.raw.slice(from.b)].some((log) =>
    log.some((line) => line.includes('"manual":[') && line.includes(rules)));
  assert(!sawRules, 'the printed table never reached either console');
  // The Anlaufsteuerung counts for both consoles, whichever closed the last breaker.
  credit(a, 'operated');
  credit(b, 'operated');
  await backOnTheMap(ANLAUF + 1);
}

type FirewallView = Extract<PuzzleView, { kind: 'firewall' }>;

/** The Paketfilter as `view` shows it; null where it is not open. */
function firewallOf(view: PlayerView | null): FirewallView | null {
  return view?.puzzle?.kind === 'firewall' ? view.puzzle : null;
}

/**
 * The wave holds while a console stands empty: `analysis` steps off the Analysepult right after
 * the Freigabe, both views say the wave stands still and which console is empty, and it runs on
 * once the console is manned again — no packet lost meanwhile, no alarm.
 */
async function waveHolds(gate: TestClient, analysis: TestClient): Promise<void> {
  const atB = CONSOLE_B.get(PAKETFILTER) ?? fail('no spot at the Analysepult');
  const alarmsBefore = alarmsOf(gate);
  gate.send({ kind: 'puzzle-input', input: { start: true } });
  const released = await gate.until('the first wave released', (v) =>
    firewallOf(v)?.waiting === false);
  const startedAt = waveClock(released).startedAt;
  // Two tiles down the Flur: out of the console's reach.
  await walkTo(analysis, [atB[0], atB[1] + 2]);
  await gate.expectView('the wave holds while the Analysepult stands empty', (v) =>
    waveClock(v).heldAt !== null && firewallOf(v)?.vacant.includes('b') === true);
  gate.send({ kind: 'puzzle-input', input: { trip: 0 } });
  const refused = await gate.expect('refusal at the Sperrpult', isError);
  assert(refused.message === 'Am Analysepult steht niemand.',
    'a trip while the Analysepult stands empty is turned away');
  await sleep(600);
  await walkTo(analysis, atB);
  const on = await gate.expectView('the wave runs on once both consoles are manned', (v) =>
    waveClock(v).heldAt === null && firewallOf(v)?.vacant.length === 0);
  assert(
    waveClock(on).startedAt >= startedAt + 600 && on.penaltySeq === alarmsBefore,
    'the hold moved the wave’s clock on by the time it stood, and cost nothing',
  );
}

/** The clock of the wave under way as `view`'s console shows it; fails where it shows none. */
function waveClock(view: PlayerView): { startedAt: number; heldAt: number | null } {
  return firewallOf(view)?.clock ?? fail('the Paketfilter shows no wave’s clock');
}

/**
 * Station 3, the Paketfilter, worked at two consoles at once: `gate` at the Sperrpult (console
 * A), `analysis` at the Analysepult (console B), once it has read the policy and walked past
 * the Laborkennung. The Sperrpult shows the packets as points and no header, the Analysepult
 * their headers, neither the policy; the audience sees all, and nobody which packet is
 * hostile. The first wave waits for the Freigabe; the wave holds while a console stands empty;
 * then the solver marks at the Analysepult what the policy drops and trips the gate under
 * every ring, wave after wave on the server's clock, until the Schott opens.
 */
async function runFirewall(gate: TestClient, analysis: TestClient): Promise<void> {
  const from = { gate: gate.raw.length, analysis: analysis.raw.length };
  await switchOn(gate, PAKETFILTER);
  await gate.expectView('console A is the Sperrpult: the wave waiting, no rules', (v) =>
    firewallOf(v)?.role === 'gate' && firewallOf(v)?.waiting === true &&
      firewallOf(v)?.waves === FIREWALL.waves && v.puzzle?.manual === null);
  await analysis.expectView('console B is the Analysepult: no rules', (v) =>
    firewallOf(v)?.role === 'analysis' && v.puzzle?.manual === null);
  const live = await zoe.untilSpectator('sees the Paketfilter and its policy at once', (v) =>
    v.puzzle?.kind === 'firewall' && v.puzzle.manual !== null);
  assert(live.puzzle?.kind === 'firewall', 'the audience watches the Paketfilter');
  await waveHolds(gate, analysis);
  await solveOnTheClock(PAKETFILTER);
  const atGate = gate.raw.slice(from.gate).join('\n');
  const atAnalysis = analysis.raw.slice(from.analysis).join('\n');
  assert(atAnalysis.includes('"protocol":"'), 'the Analysepult showed the packets’ headers');
  assert(!atGate.includes('"protocol":"'), 'no header ever reached the Sperrpult');
  const everyLog = [atGate, atAnalysis, zoe.raw.join('\n')];
  assert(everyLog.every((log) => !log.includes('"hostile"')),
    'which packet is hostile reached nobody, the audience neither');
  assert(
    !atGate.includes('"manual":[{') && !atAnalysis.includes('"manual":[{'),
    'the policy never reached either console while the station was open',
  );
  // The Paketfilter counts for both consoles, whichever move came last.
  credit(gate, 'operated');
  credit(analysis, 'operated');
  await backOnTheMap(PAKETFILTER + 1);
}

type CircuitView = Extract<PuzzleView, { kind: 'circuit' }>;

/** The Notstrom-Kasten as `view` shows it; null where it is not open. */
function circuitOf(view: PlayerView | null): CircuitView | null {
  return view?.puzzle?.kind === 'circuit' ? view.puzzle : null;
}

/** The solver's next moves at the Notstrom-Kasten, every one of them from the side `by`. */
async function playCircuit(by: Move<PuzzleInput>['by'], what: string): Promise<void> {
  const moves = nextMoves(WECHSEL);
  assert(moves.length > 0 && moves.every((move) => move.by === by),
    `${what}: ${moves.length} move(s), all from the ${by === 'partner' ? 'meter' : 'box'}`);
  await play(moves, WECHSEL);
}

/**
 * The deliberate short, with every wire of the round measured and a wire
 * cut before: the box cuts a whole wire the rules do not name. It costs the
 * def's penaltySec, the box is rewired — every wire whole again — and the
 * meter's readings are gone.
 */
async function shortTheBox(box: TestClient, meter: TestClient): Promise<void> {
  const wrong = wholeWireUnnamed(box);
  const deadlineBefore = box.view?.deadlineAt ?? 0;
  // Both patrols are out by now: an alarm of theirs may come between, and costs time as well.
  const alarmsBefore = alarmsOf(box);
  box.send({ kind: 'puzzle-input', input: { cut: wrong } });
  const shorted = await box.expectView('sees the alarm after a wrong cut', (v) =>
    v.penaltySeq > alarmsBefore && circuitOf(v)?.lastResult === 'short');
  assert((shorted.deadlineAt ?? 0) <= deadlineBefore - CIRCUIT.penaltySec * 1000,
    `the short cost ${CIRCUIT.penaltySec}s of deadline`);
  assert(circuitOf(shorted)?.wires?.every((wire) => !wire.cut) === true,
    'the short rewired the box: every wire whole again');
  await meter.expectView('sees the readings cleared by the short', (v) =>
    v.penaltySeq > alarmsBefore && readingsCleared(v));
  credit(box, 'alarms');
  deliberate += 1;
}

/** A whole wire of `box` the rules do not name next, one wire cut already: the wrong one to cut. */
function wholeWireUnnamed(box: TestClient): number {
  const [right] = nextMoves(WECHSEL);
  const named = right?.by === 'operator' && 'cut' in right.input ? right.input.cut : null;
  const wires = circuitOf(box.view)?.wires ?? fail(`${box.label}: the box shows no wires`);
  const wrong = wires.findIndex((wire, i) => !wire.cut && i !== named);
  if (named === null || wrong < 0) {
    fail('the rules name no wire, or no other whole wire is left to cut wrongly');
  }
  assert(wires.some((wire) => wire.cut), 'a wire is cut before the short');
  return wrong;
}

/** Whether the meter on `view` has no reading left and no wire under its probe. */
function readingsCleared(view: PlayerView): boolean {
  const circuit = circuitOf(view);
  return circuit?.readings?.every((r) => r === null) === true && circuit.probed === null;
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
  await solveStation(WECHSEL);
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
 * The Notstrom-Kasten, where the run has it at its Wechselplatz, worked at two consoles at
 * once: `box` at the fuse box (console A), `meter` at the meter (console B), and the meter
 * switches it on. The box shows the wires and no voltage, the meter a
 * reading per wire and no colour, neither the rules; the audience sees all.
 */
async function runCircuit(box: TestClient, meter: TestClient): Promise<void> {
  const from = { box: box.raw.length, meter: meter.raw.length };
  await switchOn(meter, WECHSEL);
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
  await backOnTheMap(WECHSEL + 1);
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
  const [first, second] = nextMoves(WECHSEL).map(keyAtB);
  if (first == null || second == null) {
    fail('the solver presses no two keys at console B in stage 1');
  }
  a.send({ kind: 'puzzle-input', input: { key: first } });
  const refused = await a.expect('refusal at the sending console', isError);
  assert(refused.message === 'Dieses Pult sendet — das andere gibt ein.',
    'a key pressed at the sending console is turned away');

  b.send({ kind: 'puzzle-input', input: { key: first } });
  await b.until('one sign taken', (v) => signalOf(v)?.done === 1);
  await wrongKeyAtB(a, b, { row: (second.row % 4) + 1, shape: second.shape });
}

/** The deliberate wrong key at console B: it costs the def's penaltySec and the stage's signs. */
async function wrongKeyAtB(
  a: TestClient,
  b: TestClient,
  wrong: { row: number; shape: string },
): Promise<void> {
  const deadlineBefore = b.view?.deadlineAt ?? 0;
  // Both patrols are out by now: an alarm of theirs may come between, and costs time as well.
  const alarmsBefore = alarmsOf(b);
  b.send({ kind: 'puzzle-input', input: { key: wrong } });
  const afterPenalty = await b.expectView('sees the alarm after a wrong key', (v) =>
    v.penaltySeq > alarmsBefore && signalOf(v)?.lastResult === 'wrong');
  const cost = (afterPenalty.deadlineAt ?? 0) <= deadlineBefore - SIGNAL.penaltySec * 1000;
  assert(cost && signalOf(afterPenalty)?.done === 0,
    `the wrong key cost ${SIGNAL.penaltySec}s of deadline and started the stage over`);
  credit(b, 'alarms');
  deliberate += 1;
  await a.until('the alarm', (v) => v.penaltySeq > alarmsBefore);
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
 * From stage `greyFrom` on the display has lost its colour: so say the views the consoles
 * received since their logs ran to `from`, and not one of those views carried a sign in colour
 * to either console — the legend's patterns alone tell the colours then.
 */
function assertGrey(consoles: { client: TestClient; from: number }[]): void {
  const greyFrom = SIGNAL.greyFrom ?? SIGNAL.stages;
  const seen = consoles.flatMap(({ client, from }) =>
    viewsSince(client, from).flatMap(({ raw, view }) => {
      const signal = signalOf(view);
      return signal === null ? [] : [{ raw, signal }];
    }),
  );
  const grey = seen.filter(({ signal }) => signal.grey);
  assert(
    grey.length > 0 && seen.every(({ signal }) => signal.grey === signal.stage >= greyFrom),
    `the display shows its signs without colour from stage ${greyFrom} on, in colour before`,
  );
  assert(
    grey.every(({ raw }) => !TOKENS.some((token) => raw.includes(`"${token}"`))),
    'no view of a stage without colour carried a sign in colour to either console',
  );
}

/**
 * The Signalkette, where the run has it at its Wechselplatz, worked at two consoles at once:
 * `a` stands at
 * console A, `b` at console B, and B switches it on. Console A sends stage 1
 * and B takes it, then the direction swaps with every stage. Nobody is left
 * to read the Klemmbrett; each console says whether it sends or takes.
 */
async function runSignal(a: TestClient, b: TestClient): Promise<void> {
  const from = { a: a.raw.length, b: b.raw.length };
  await switchOn(b, WECHSEL);
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
  await play(nextMoves(WECHSEL), WECHSEL);
  await b.expectView('stage 2: console B sends now', (v) =>
    signalOf(v)?.stage === 2 && signalOf(v)?.role === 'sender');
  await a.expectView('stage 2: console A takes now', (v) =>
    signalOf(v)?.stage === 2 && signalOf(v)?.role === 'receiver');
  await solveStation(WECHSEL);
  assertConsolesApart(b, from.b, { sends, takes });
  assertFleeting([
    { client: a, from: from.a },
    { client: b, from: from.b },
  ]);
  assertGrey([
    { client: a, from: from.a },
    { client: b, from: from.b },
  ]);
  // The Signalkette counts for both consoles, whichever pressed last.
  credit(a, 'operated');
  credit(b, 'operated');
  await backOnTheMap(WECHSEL + 1);
}

type ServersView = Extract<PuzzleView, { kind: 'servers' }>;

/** The Serverraum as `view` shows it; null where it is not open. */
function serversOf(view: PlayerView | null): ServersView | null {
  return view?.puzzle?.kind === 'servers' ? view.puzzle : null;
}

/**
 * The mid-game reconnect of `client`: its socket drops, the crew sees it
 * gone — and, `whileAway`, whatever the other does meanwhile — and a fresh
 * client resumes on its pass — the same log, the Laborkennung and the avatar
 * where it stood — and takes its place in the crew. Returns the new client and
 * the view it resumed on.
 */
async function reconnect(
  client: TestClient,
  resumed: (view: PlayerView) => boolean,
  whileAway: (other: TestClient) => Promise<void> = () => Promise.resolve(),
): Promise<{ back: TestClient; view: PlayerView }> {
  const joined = client.joined ?? fail(`${client.label}: never joined`);
  const name = client.view?.you.name ?? fail(`${client.label}: no view yet`);
  const before = client.self;
  const other = crew.find((member) => member !== client) ?? fail('a crew of one');
  client.close();
  await other.expectView(`sees ${name} disconnected`, (v) =>
    v.players.some((p) => p.name === name && !p.connected));
  await whileAway(other);
  const back = new TestClient(`${client.label}2`, client.raw, client.pass);
  await back.open();
  back.send({ kind: 'resume', code: joined.code, pass: back.pass });
  await back.seated();
  assert(back.playerId === client.playerId, `${back.label}: back on the seat its pass holds`);
  const view = await back.expectView('resumed where it stood', resumed);
  assert(view.edgework !== null, 'the Laborkennung survived the reconnect');
  const seeded = await back.ensureSelf();
  assert(
    before !== null && Math.hypot(seeded.x - before.x, seeded.y - before.y) < 0.05,
    'avatar position survived the reconnect',
  );
  crew = crew[0] === client ? [back, crew[1]] : [crew[0], back];
  await other.until('the crew back together', (v) => v.away.length === 0);
  return { back, view };
}

/**
 * What the Serverraum's consoles received since their logs ran to `from`:
 * the rack never a code nor the terminal's table, the terminal never a
 * rack's LED, neither console the printed rules.
 */
function assertTerminalAndRackApart(
  { terminal, rack }: { terminal: TestClient; rack: TestClient },
  from: { terminal: number; rack: number },
): void {
  const atTerminal = terminal.raw.slice(from.terminal).join('\n');
  const atRack = rack.raw.slice(from.rack).join('\n');
  assert(!/"code":"E\d\d"|"rows":\[\{/.test(atRack), 'no code and no table ever reached the rack');
  assert(!/"led":"|"rack":\[\{/.test(atTerminal), 'no LED ever reached the terminal');
  const rules = 'Wenn ein Dienst keinen Strom hat';
  assert(!atTerminal.includes(rules) && !atRack.includes(rules),
    'the printed rules never reached either console');
}

/**
 * Station 4, the Serverraum, at two consoles in the room behind the
 * bulkhead: `rack` walks to the locker, `terminal` to console A and switches
 * it on; `rack` searches the locker and reads the rules there, then takes the rack.
 * The terminal shows the table with its codes and no LED, the rack its
 * switches and LEDs and no code, neither the rules; the audience sees all.
 * Mid-solve the rack drops and resumes; the solver then brings every service
 * back from the two consoles' views.
 */
async function runServers(terminal: TestClient, rack: TestClient): Promise<void> {
  const locker = sourceOf(SUBSYSTEME);
  // No drone is out yet: both sleep until this room is solved, the crew inside it.
  await walkTo(rack, placeOf(locker.id));
  await bring(terminal, STAND[SUBSYSTEME] ?? fail('no spot at the terminal'), rack);
  const fromTerminal = terminal.raw.length;
  await switchOn(terminal, SUBSYSTEME);
  await openSource(rack, locker.id, `Spind durchsucht: ${locker.label}`);
  await rack.expectView(`reads the ${SERVERS.title}'s rules in the ${locker.label}`, (v) =>
    v.manualsHere.some((m) => m.id === locker.id && m.sections.some((s) => s.puzzleId === SERVERS.id)));
  credit(rack, 'read');
  await bring(rack, CONSOLE_B.get(SUBSYSTEME) ?? fail('no spot at the rack'), terminal);
  const fromRack = rack.raw.length;
  await terminal.expectView('console A is the terminal: the table with its codes, no LED, no rules',
    (v) => serversOf(v)?.role === 'terminal' && serversOf(v)?.rows?.some((r) => r.code !== null) === true &&
      serversOf(v)?.rack === null && v.puzzle?.manual === null);
  await rack.expectView('console B is the rack: switches and LEDs, no code, no rules', (v) =>
    serversOf(v)?.role === 'rack' && serversOf(v)?.rack?.length === 6 &&
      serversOf(v)?.rows === null && v.puzzle?.manual === null);
  const live = await zoe.untilSpectator('sees the terminal, the rack and the rules at once', (v) =>
    v.puzzle?.kind === 'servers' && v.puzzle.rows !== null && v.puzzle.rack !== null &&
      v.puzzle.manual !== null);
  assert(live.puzzle?.kind === 'servers', 'the audience watches the Serverraum');
  const { back } = await reconnect(rack, (v) =>
    serversOf(v)?.role === 'rack' && v.presence.stationId === SERVERS.id);
  await solveStation(SUBSYSTEME);
  assertTerminalAndRackApart({ terminal, rack: back }, { terminal: fromTerminal, rack: fromRack });
  // The Serverraum counts for both consoles, whichever move solved it.
  credit(terminal, 'operated');
  credit(back, 'operated');
  await backOnTheMap(SUBSYSTEME + 1);
}

async function solveMorse(op: TestClient, rd: TestClient): Promise<void> {
  await rd.expectView('reads the Morse tables but sees no lamp', (v) =>
    v.puzzle?.kind === 'morse' && v.puzzle.pattern === null && v.puzzle.manual !== null);
  await op.expectView('stands at the blinking lamp', (v) =>
    v.puzzle?.kind === 'morse' && v.puzzle.pattern !== null && v.puzzle.manual === null);
  await readerStepsAway(op, rd);
  await solveStation(WECHSEL);
}

const labortuer =
  mission.map.doors.find((d) => d.id === 'labortuer') ?? fail('Blackout has no Labor door');
/**
 * In the Labor four tiles east of its door and a row north: from here the ways to the door
 * and to every spot of the cabinet run north of the radio panel in its south-west corner, so
 * the reader never comes close enough to see the lamp.
 */
const LABOR_CORNER: Tile = besides(labortuer, 4, -1, 'in the Labor east of its door');
/**
 * In the Maschinenraum two tiles west of the Labor's door: out of reach of every spot of the
 * cabinet and of the panel, and out of the Labor drone's sight.
 */
const AWAY_FROM_THE_CABINET: Tile = besides(labortuer, -2, 0, 'west of the Labor door');
/**
 * A station of one console takes its operator's input with nobody else there: the reader
 * walks off out of reach of the cabinet and the panel, the solver's first move goes in from the
 * radio panel and counts — the dial turns, or the station solves — without an alarm; then the
 * reader walks back to the cabinet for the rest.
 */
async function readerStepsAway(op: TestClient, rd: TestClient): Promise<void> {
  const cabinet = sourceOf(WECHSEL);
  const [move] = nextMoves(WECHSEL);
  if (move === undefined) {
    fail('the solver has no first move at the radio panel');
  }
  for (const to of [LABOR_CORNER, AWAY_FROM_THE_CABINET]) {
    await walkTo(rd, to);
  }
  await rd.expectView('stands away from the cabinet and the panel', (v) =>
    v.presence.manualId === null && v.presence.stationId === null);
  const before = op.view ?? fail(`${op.label}: no view yet`);
  const dial = before.puzzle?.kind === 'morse' ? before.puzzle.dial : null;
  op.send({ kind: 'puzzle-input', input: move.input });
  await op.expectView('takes the move with nobody else at the station or its rules', (v) =>
    v.penaltySeq === before.penaltySeq &&
    (v.currentPuzzleIndex > WECHSEL || (v.puzzle?.kind === 'morse' && v.puzzle.dial !== dial)));
  for (const to of [LABOR_CORNER, placeOf(cabinet.id)]) {
    await walkTo(rd, to);
  }
}

async function solveSync(): Promise<void> {
  for (const client of crew) {
    await client.expectView('stands at the reactor with the crew', (v) =>
      v.puzzle?.kind === 'button-sync' && v.presence.stationId === 'reaktorstart');
  }
  await solveStation(REAKTOR);
}

/**
 * Switch on the armed station from where `client` stands, which has to be
 * within reach of it — of either console, where it has two.
 */
async function switchOn(client: TestClient, index: number): Promise<void> {
  const self = await client.ensureSelf();
  const armed = client.view?.map?.stations.filter((s) => s.known && s.status === 'armed') ?? [];
  assert(
    armed.some(
      (station) => Math.hypot(self.x - (station.x + 0.5), self.y - (station.y + 0.5)) <= 1.6,
    ),
    `${client.label} stands within interact range of station ${index + 1}`,
  );
  client.pressE();
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

/**
 * The station the run has at its Wechselplatz, the Labortür open and both patrols out. The
 * Signalkette: console A at the Flur's east end and console B in the Maschinenraum, its legend
 * on the Klemmbrett in the Flur, which whoever takes console A passes on the way, crossing the
 * Flur's length while the other holds the camera plate. The Funkpult
 * in the Labor: its tables in the cabinet the Serverraum's key opens. The Notstromkasten: the
 * fuse box inside the Maschinenraum's door and the meter in the Labor, its rules in the
 * Wartungsbuch in the Maschinenraum, which whoever takes the meter reads first.
 */
async function atTheWechselplatz(): Promise<void> {
  await quietFor(STRETCH_SEC);
  const [a, b] = crew;
  if (DRAWN === 'signal') {
    await bring(a, placeOf(sourceOf(WECHSEL).id), b);
    // Console A stands at the Flur's far end, the whole patrol between: `b` holds the Flur's
    // drone still from the camera plate while `a` crosses, then walks to console B behind it.
    await holdTheCameraPlateFromBehind(b);
    await crossFrozen(a, STAND[WECHSEL] ?? fail('no spot at console A'), flurDrone.id);
    await bring(b, CONSOLE_B.get(WECHSEL) ?? fail('no spot at console B'), a);
    await runSignal(a, b);
  } else if (DRAWN === 'morse') {
    await unlockCabinet();
    const atRadio = await takePlaces(WECHSEL);
    await runStation(WECHSEL, atRadio, () => solveMorse(atRadio.op, atRadio.rd));
  } else if (DRAWN === 'circuit') {
    await readUp(WECHSEL, b, a);
    await takeConsoles(WECHSEL, a, b);
    await runCircuit(a, b);
  } else {
    fail(`the smoke has no play for a ${DRAWN} at the Wechselplatz`);
  }
}

// --- credits -----------------------------------------------------------------

/** When the lights went out, epoch ms: the room's emergencies keep their schedule from it. */
let lightsOutAt = Infinity;

/** What the walkthrough did, by player id: what the end screen has to credit. */
const tally = new Map<string, Credits>();
/** The alarms the walkthrough set off on purpose so far. */
let deliberate = 0;

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

anna.send({
  kind: 'create-room',
  name: 'Anna',
  pass: anna.pass,
  missionId: 'blackout',
  seed: SEED,
});
const annaJoined = await anna.seated();
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
ben.send({ kind: 'join-room', code: openRoom.code, name: 'Ben', pass: ben.pass });
await ben.seated();
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
// The run opens with the power on: no clock yet, no station armed, mission control still quiet.
const intro = mission.intro ?? fail('Blackout opens without an intro');
for (const client of crew) {
  const powered = client.view ?? fail(`${client.label}: no view of the run`);
  assert(
    !powered.lights.out && powered.deadlineAt === null && powered.events.length === 0,
    `${client.label}: the run opens with the power on — no clock, no radio line yet`,
  );
  // The lit lab shows every station and source to everybody, found or not.
  const lit = powered.map;
  assert(
    lit?.stations.length === mission.map.stations.length &&
      lit.manuals.length === mission.map.manuals.length &&
      lit.stations.every((s) => !s.known || s.status !== 'armed'),
    `${client.label}: while the power is on, the whole lab shows, and no station is armed`,
  );
}
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

// The sign goes to whoever walks up to it; a source to whoever has it within two tiles in
// sight, or long enough in the cone of the lamp they face east with from their spawn — each
// for themselves; the crew knows of whatever either found. Through a wall nobody finds anything.
const doorsAtStart = crew[0].view?.map?.doors ?? fail('anna: no doors at the start');
const shutAtStart = new Set(doorsAtStart.filter((d) => !d.open).map((d) => key(d.x, d.y)));
const middle = (x: number, y: number): { x: number; y: number } => ({ x: x + 0.5, y: y + 0.5 });
const foundFrom = (client: TestClient): string[] => {
  const at = middle(spawnOf(client).x, spawnOf(client).y);
  return mission.map.manuals
    .filter((m) => {
      const spot = middle(...placeOf(m.id));
      const near = Math.hypot(spot.x - at.x, spot.y - at.y) <= FIND_REACH;
      const looked = inCone(mission.map, shutAtStart, { ...at, facing: 0 }, spot);
      return (near && canSee(mission.map, at, spot, shutAtStart)) || looked;
    })
    .map((m) => m.id);
};
const crewKnows = mission.map.manuals
  .filter((m) => crew.some((client) => foundFrom(client).includes(m.id)))
  .map((m) => m.id)
  .join(',');
for (const client of crew) {
  const at = spawnOf(client);
  const atSign = Math.hypot(at.x - sign.x, at.y - sign.y) <= 1.6;
  const mine = foundFrom(client).join(',');
  await client.expectView(
    `${atSign ? 'has' : 'has not'} the Laborkennung and has found ${mine || 'nothing'}; ` +
      `the crew knows of ${crewKnows || 'nothing'}`,
    (v) =>
      (v.edgework !== null) === atSign &&
      v.presence.signSeen === atSign &&
      v.map?.manuals.filter((m) => m.found).map((m) => m.id).join(',') === mine &&
      v.map?.manuals.filter((m) => m.known).map((m) => m.id).join(',') === crewKnows,
  );
}

// Map pings fan out to the whole crew and are rate limited per player: one at the lever, then
// one at the sign.
const [pingX, pingY] = STAND[NOTLICHT] ?? fail('no spot at the lever');
anna.send({ kind: 'ping', x: pingX, y: pingY });
anna.send({ kind: 'ping', x: sign.x, y: sign.y }); // swallowed by the cooldown
const pinged = await ben.expect(
  'ping arrives',
  (m): m is Extract<ServerMessage, { kind: 'ping' }> => m.kind === 'ping',
);
assert(
  pinged.playerId === annaJoined.playerId && pinged.x === pingX && pinged.y === pingY,
  'ping is broadcast to the other player with its origin',
);
await sleep(200);
assert(
  !ben.hasQueued((m) => m.kind === 'ping'),
  'a second ping within the cooldown is dropped',
);

// Quick chat reaches the whole crew as said: Blackout's phrase for a number — a feeder's, a
// line's, a wire's — filled in.
const wirePhrase = mission.chat?.phrases.findIndex((phrase) => phrase.text === 'Nummer {n}') ?? -1;
assert(wirePhrase >= 0, 'Blackout’s quick chat carries a number');
anna.send({ kind: 'chat', phrase: wirePhrase, value: '3' });
const said = await ben.expect(
  'chat arrives',
  (m): m is Extract<ServerMessage, { kind: 'chat' }> => m.kind === 'chat',
);
assert(
  said.playerId === annaJoined.playerId && said.text === 'Nummer 3',
  'quick chat is broadcast with its sender and the phrase as said, its slot filled in',
);

// Voice signals: Anna offers, Ben answers, a candidate follows — each reaches the one player it
// names, stamped with its sender and otherwise untouched; the spectator hears none of them.
const isRtc = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'rtc' }> => m.kind === 'rtc';
const isRooms = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'rooms' }> =>
  m.kind === 'rooms';
const voiceOffer = { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n' } as const;
const voiceAnswer = { type: 'answer', sdp: 'v=0\r\no=- 3 2 IN IP4 127.0.0.1\r\ns=-\r\n' } as const;
const voiceCandidate = {
  type: 'ice',
  candidate: {
    candidate: 'candidate:1 1 udp 2122260223 127.0.0.1 50000 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
  },
} as const;
const exchange = [
  { from: anna, to: ben, signal: voiceOffer },
  { from: ben, to: anna, signal: voiceAnswer },
  { from: anna, to: ben, signal: voiceCandidate },
];
for (const { from, to, signal } of exchange) {
  from.send({ kind: 'rtc', to: to.playerId, signal });
  const relayed = await to.expect(`voice ${signal.type} arrives`, isRtc);
  assert(
    relayed.from === from.playerId && JSON.stringify(relayed.signal) === JSON.stringify(signal),
    `a voice ${signal.type} from ${from.label} reaches ${to.label} as it was sent`,
  );
}
// The wrong target: a player in another room. The server drops the signal without a word; once
// Anna's room list is back, it has handled it.
const dora = new TestClient('dora');
await dora.open();
dora.send({ kind: 'create-room', name: 'Dora', pass: dora.pass, missionId: 'blackout' });
const doraJoined = await dora.seated();
anna.send({ kind: 'rtc', to: doraJoined.playerId, signal: voiceOffer });
anna.send({ kind: 'list-rooms' });
await anna.expect('room list after the stray voice signal', isRooms);
await sleep(200);
assert(
  !dora.hasQueued(isRtc) && !anna.hasQueued(isError),
  'a voice signal for a player of another room is refused, quietly',
);
assert(!zoe.hasQueued(isRtc), 'the spectator hears none of the crew’s voice signals');
dora.close();

/** Ids of the drones in the client's latest positions message, sorted and comma-joined. */
const streamedDrones = (client: TestClient): string =>
  Object.keys(client.drones).sort().join(',');

/** The rooms the mission's solved stations light, each once, as the views must list them. */
const litAfter = (solvedCount: number): string =>
  [...new Set(mission.puzzles.slice(0, solvedCount).flatMap((p) => p.lights))].join(',');

/**
 * After station `solved`: back on the map with one more room lit, and
 * security asleep until the Serverraum is solved — both drones wake with it,
 * the crew out of their sight inside the room.
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
  if (solved <= SUBSYSTEME) {
    // Any positions message arriving after the view above was sent after the solve.
    const stale = watcher.positions;
    await watcher.untilPositions('a fresh positions message', (p) => p !== stale);
    assert(streamedDrones(watcher) === '', `no drone patrols after station ${solved}`);
  } else if (solved === SUBSYSTEME + 1) {
    await watcher.untilPositions('both drones patrol', () =>
      streamedDrones(watcher) === 'flurwache,laborwache');
    console.log('✓ both drones patrol after the Serverraum');
  }
}

// Both have seen enough of the opening, Anna twice over: the lights burn on while one of the
// crew still watches, and go out the moment the second skips — long before the intro's own end.
anna.send({ kind: 'intro-done' });
anna.send({ kind: 'intro-done' });
await ben.expectView('Anna has seen enough of the opening', (v) =>
  JSON.stringify(v.intro?.done) === JSON.stringify([annaJoined.playerId]));
assert(ben.view?.lights.out === false, 'one of two skipping the opening leaves the lights on');
const skippedAt = Date.now();
ben.send({ kind: 'intro-done' });

// The lights go out as the crew skips: the clock starts with the whole limit from then on,
// the first station is armed and mission control speaks.
const dark = await crew[0].expectView('the lights go out', (v) => v.lights.out);
const outAt = dark.lights.outAt ?? fail('the lights went out at no moment');
lightsOutAt = outAt;
const outIn = outAt - (dark.startedAt ?? outAt);
assert(outAt >= skippedAt && outIn < intro.lightsSec * 1000,
  `the lights went out ${(outIn / 1000).toFixed(1)} s into the run, as the second of the crew ` +
    `skipped the opening, before its ${intro.lightsSec} s were up`);
assert(dark.deadlineAt === outAt + mission.timeLimitSec * 1000,
  'the clock started when the lights went out, with the whole limit');
const [blackoutLine, opener] = dark.events;
assert(dark.events.length === 2 && blackoutLine?.label === POWER_OUT &&
  variantsOf(mission.radio.start ?? []).includes(opener?.label ?? '') && opener?.moment === 'start',
  'the run report has the blackout, then one of mission control\'s openers, as the start');
const darkLever = dark.map?.stations.find((s) => s.puzzleId === leverDef.id);
assert(darkLever?.known === true && darkLever.status === 'armed',
  'the lever is armed once the lights are out');

// Station 1: the Notlicht's main switch in the Flur, a lever for each of the crew. Both walk up
// to it, then throw it together; the note of the last shift pinned beside it is read there.
await runLever();
await readTheLeverNote();
// The sprint (Shift): Ben runs the lit Flur at 1.3 times the walk, and the server's step guard
// takes it — a burst after lag included — while no drone patrols yet.
await sprintTheFlur(crew[1]);

// Station 2: the Anlaufsteuerung, console A in the Maschinenraum and console B in the Flur, its
// rules in the Betriebsbuch in the Archiv. Ben reads them and the Laborkennung, then lets Anna in.
const [atA, atB] = crew;
await readUp(ANLAUF, atB, atA);
await pastTheSign(atB, atA);
await takeConsoles(ANLAUF, atA, atB);
await runStartup(atA, atB);
// Its plate held the Maschinenraum door so far; from now on the door stands open by itself.
await crew[0].expectView(`"${lastingDoor.id}" stays open with nobody on its plate`, (v) =>
  v.map?.doors.find((d) => d.id === lastingDoor.id)?.open === true &&
  v.map.plates.find((p) => p.id === lastingPlate)?.pressed === false);

// Station 3: the Paketfilter, both consoles in the Flur east of the Serverschott, its policy
// pinned up on the Flur's south wall. Ben reads it, then takes the Analysepult.
await readUp(PAKETFILTER, atB, atA);
await takeConsoles(PAKETFILTER, atA, atB);
await runFirewall(atA, atB);
await crew[0].expectView('the Serverschott stands open', (v) =>
  v.map?.doors.find((d) => d.id === 'serverschott')?.open === true);

// Station 4: the Serverraum, its terminal and its rack apart in the room behind the bulkhead,
// its rules in the locker there, which has to be searched. Anna takes the terminal; Ben, who
// walked past the Laborkennung before the Anlaufsteuerung, reads in the locker and takes the
// rack, and drops and resumes there.
const locker = sourceOf(SUBSYSTEME);
// The emergencies are due from here on, by the room's schedule: none may cut a station short.
await quietFor(STRETCH_SEC);
await runServers(atA, atB);

// Station 5: the Wechselplatz, the station this run's seed draws; the other two stand out of
// service, each console found by the crew wearing its tag.
const outOfService = missionFile.puzzles.filter(
  (def) => def.pool !== undefined && def.id !== mission.puzzles[WECHSEL]?.id,
);
assert(
  outOfService.length === 2 &&
    crew.every((client) =>
      (client.view?.map?.stations ?? [])
        .filter((station) => outOfService.some((def) => def.id === station.puzzleId))
        .every((station) => !station.known || station.status === 'out'),
    ),
  `${outOfService.map((def) => def.title).join(' and ')} stand out of service this run`,
);
await atTheWechselplatz();

// Station 6: the reactor, dead until the spare fuse is in; the whole crew presses.
await quietFor(STRETCH_SEC);
await fetchFuse();
await switchOn(crew[0], REAKTOR);
await solveSync();
await backOnTheMap(mission.puzzles.length);

// --- escape finale: everyone to the hatch before the clock runs out --------
const unlocked = await crew[0].expectView('exit hatch is open', (v) =>
  v.map?.exit?.open === true);
// Every source of a station of the run: one of a station out of service may lie off the way.
const inService = mission.map.manuals.filter((m) =>
  m.puzzleIds.some((id) => mission.puzzles.some((def) => def.id === id)));
const unknown = inService
  .filter((m) => unlocked.map?.manuals.some((seen) => seen.id === m.id && seen.known) !== true)
  .map((m) => `${m.id} at ${placeOf(m.id).join(',')}`);
const missed = unknown.length > 0 ? ` (not ${unknown.join(', ')})` : '';
assert(unknown.length === 0, `the crew has found every source of its run on the way${missed}`);
assert(unlocked.map?.litRooms.join(',') === litAfter(mission.puzzles.length),
  `the reactor lit the last room: ${litAfter(mission.puzzles.length)}`);
const unlockedAt = unlocked.events.find((e) => e.kind === 'escape')?.at;
assert(unlockedAt !== undefined && unlocked.map?.exit?.openedAt === unlockedAt,
  'the hatch says when it opened: the moment the run report logged it unlocked');
assert(unlocked.map?.exit?.atExit.length === 0, 'nobody stands on the hatch yet');
const [first, onTheWay] = crew;
// Out by the Labor's way and the Flur to the hatch in the Archiv's corner.
for (const to of [OUT_OF_THE_LABOR, EXIT]) {
  await walkTo(first, to);
}
const firstOut = JSON.stringify([first.playerId]);
for (const client of crew) {
  await client.expectView(`the checklist ticks ${first.label} off at the hatch`, (v) =>
    JSON.stringify(v.map?.exit?.atExit) === firstOut);
}
await zoe.untilSpectator(`sees ${first.label} on the hatch and ${onTheWay.label} still on the way`,
  (v) => JSON.stringify(v.map?.exit?.atExit) === firstOut);
const halfwayOut = onTheWay.view?.phase;
assert(halfwayOut === 'playing', 'one player at the hatch is not enough to escape');
// The one still on the way drops, the other on the hatch: the run goes on and the hatch waits —
// whoever is away and not on it is not out, and a drop alone never ends a run.
const { back: last } = await reconnect(onTheWay, (v) => v.phase === 'playing', async (other) => {
  await other.expectView('sees the one away, the run going on, from the hatch', (v) =>
    v.pausedAt === null && v.away.some((away) => away.id === onTheWay.playerId));
  await sleep(500);
  assert(other.view?.phase === 'playing' && first.view?.map?.exit?.atExit.length === 1,
    'the escape with a member dropped does not end the run');
});
for (const to of [OUT_OF_THE_LABOR, EXIT]) {
  await walkTo(last, to);
}

const won = await first.expectView('won the mission', (v) => v.phase === 'won');
await last.expectView('won the mission', (v) => v.phase === 'won');
assert(/erwachen die Systeme/.test(won.storyText), 'win story is shown');
// At least the wrong start, and the wrong key or the wrong cut where the Signalkette or the
// Notstromkasten has the Wechselplatz; patrolling drones may add more.
assert(deliberate === (DRAWN === 'morse' ? 1 : 2) && won.penaltySeq >= deliberate,
  `the ${deliberate} deliberate alarm(s) were counted, ${won.penaltySeq} alarms in all`);
const finds = [
  `Spind durchsucht: ${locker.label}`,
  ...(DRAWN === 'morse' ? [`Schrank aufgeschlossen: ${sourceOf(WECHSEL).label}`] : []),
];
assert(
  won.events.filter((e) => e.kind === 'find').map((e) => e.label).join(' · ') ===
    finds.join(' · '),
  `the run report holds what the crew opened: ${finds.join(', ')}`,
);
assertKeptApart(openWindows);
reportWalks();
reportWin(won, outAt);

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
  // The lever and the reactor count for whichever press completed them.
  const presses = got.operated - did.operated;
  assert(presses >= 0 && presses <= 2,
    `${client.label} is credited with the ${did.operated} stations it worked, maybe the lever ` +
      'and the reactor');
  assert(got.alarms >= did.alarms && got.hints === 0,
    `${client.label} carries its ${did.alarms} deliberate alarms and asked for no note`);
}
// A station counts once, one with two consoles once for each of its consoles.
const workedAt = (def: (typeof mission.puzzles)[number]): number =>
  moduleFor(def.type).consoles ?? 1;
assert(summed('operated') === mission.puzzles.reduce((sum, def) => sum + workedAt(def), 0),
  'every station is credited to whoever worked it, one of two consoles to both');
assert(summed('alarms') === won.penaltySeq, 'every alarm is credited to whoever set it off');

// The won run left one line in the run log: its report, which names the crew and nobody's id.
const logged = readFileSync(RUNS_LOG, 'utf8').trimEnd().split('\n');
assert(logged.length === 1, `the won run left one line in ${RUNS_LOG}`);
const line = logged[0] ?? '';
const report = JSON.parse(line) as RunReport;
assert(
  report.version === 2 &&
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
assert(report.lightsOutAt === outAt && outAt > report.startedAt,
  'the run report has when the lights went out, after the start: the run’s clock counts from it');
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
      s.openedAt === (report.stations[i - 1]?.solvedAt ?? report.lightsOutAt)),
  'the run report has every station, each up from the solve before it — the first from the ' +
    'lights going out — until its own',
);
assert(
  report.penalties.reduce((sum, p) => sum + p.count, 0) === won.penaltySeq &&
    report.stations.reduce((sum, s) => sum + s.alarms, 0) >= deliberate &&
    (report.stations[ANLAUF]?.alarms ?? 0) >= 1,
  'the run report has every alarm by its cause, the deliberate ones at their stations',
);
assert(
  JSON.stringify(report.drawn) === JSON.stringify(DRAW) &&
    report.stations[WECHSEL]?.puzzleId === DRAW[wechselDef.pool ?? ''],
  `the run report names the station drawn at the Wechselplatz: ${JSON.stringify(report.drawn)}`,
);
const crewNames = won.players.map((p) => p.name);
assert(
  report.crew.join() === 'Anna,Ben' && crewNames.join() === 'Anna,Ben',
  'the run report names the crew as it played, Anna and Ben in the order they joined',
);
assert(report.roomCode === annaJoined.code, `the run report names the room, ${annaJoined.code}`);
assert(won.players.every((p) => !line.includes(p.id)), 'the run report holds no player id');

// The Bestenliste counts the won run, by the crew's names and nothing else of anybody's.
const getJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(`http://localhost:${PORT}${path}`);
  assert(res.ok, `GET ${path} answers ${res.status}`);
  return (await res.json()) as T;
};
const board = await getJson<MissionStats[]>('/stats');
const onBlackout = board
  .find((m) => m.missionId === mission.id)
  ?.difficulties.find((d) => d.difficulty === 'normal');
assert(
  onBlackout !== undefined && onBlackout.runs >= 1 && onBlackout.wins >= 1,
  `GET /stats lists Blackout on normal: ${onBlackout?.runs ?? 0} run(s), the won one among them`,
);
assert(
  onBlackout.top.some((entry) => entry.crew.join() === crewNames.join()),
  `GET /stats names the crew: ${crewNames.join(', ')}`,
);
const boardText = JSON.stringify(board);
assert(
  won.players.every((p) => !boardText.includes(p.id)) && !boardText.includes(annaJoined.code),
  'GET /stats holds no player id and no room',
);
const standing = await getJson<MissionStanding>(`/stats/${mission.id}?run=${won.finishedAt}`);
assert(
  standing.place?.difficulty === 'normal' && standing.place.place === 1,
  'GET /stats/blackout?run= puts the won run first on normal',
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
// The fresh report holds nothing yet: the rematch opens with the power on again.
assert(
  replay.currentPuzzleIndex === 0 &&
    replay.penaltySeq === 0 &&
    replay.events.length === 0 &&
    !replay.lights.out &&
    replay.deadlineAt === null,
  'the rematch starts from a clean slate, the power on',
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
// A step inside the spawn's own tile, floor for every spawn: the new run would take it.
const fresh = spawnOf(first);
const aside = { x: fresh.x + 0.5, y: fresh.y + 0.8, facing: 0, moving: true };
first.send({ kind: 'pos', run: lastRun, ...aside, t: Date.now() });
// The server answers in order: once the room list is back, it has handled the position.
first.send({ kind: 'list-rooms' });
await first.expect(
  'room list after the stale position',
  (m): m is Extract<ServerMessage, { kind: 'rooms' }> => m.kind === 'rooms',
);
// Still in the intro nothing moves; a step of the other's onto its own spawn has the room
// broadcast where everybody stands now.
const handled = first.positions;
const stays = spawnOf(last);
last.sendPos(stays.x + 0.5, stays.y + 0.5, false);
await first.untilPositions('a broadcast after the stale position', (p) => p !== handled);
assert(onSpawn(first.positions, first), 'a position stamped with the run before is dropped');

for (const client of crew) {
  client.close();
}

// --- the tutorial, and on into Blackout through the end screen's „Weiter" -----

const tutorial = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);

/**
 * A room for the tutorial on the server at `port`: Cleo opens it, Dan joins and
 * says yes, Cleo starts. The tutorial has no intro: its lights are out and its
 * first station is armed from the start.
 */
async function openTutorial(port: number = PORT): Promise<Lab> {
  const cleo = new TestClient('cleo', [], mintPass(), port);
  const dan = new TestClient('dan', [], mintPass(), port);
  await cleo.open();
  await dan.open();
  cleo.send({ kind: 'create-room', name: 'Cleo', pass: cleo.pass, missionId: tutorial.id });
  const cleoJoined = await cleo.seated();
  dan.send({ kind: 'join-room', code: cleoJoined.code, name: 'Dan', pass: dan.pass });
  await dan.seated();
  dan.send({ kind: 'set-ready', ready: true });
  await cleo.until('Dan says yes', (v) => v.players.some((p) => p.name === 'Dan' && p.ready));
  cleo.send({ kind: 'start-mission' });
  for (const client of [cleo, dan]) {
    await client.until('the tutorial under way', (v) => v.phase === 'playing' && v.map !== null);
    await client.ensureSelf();
  }
  return { mission: tutorial, crew: [cleo, dan] };
}

/**
 * The Initialisierung, a main switch with a window: Cleo throws hers alone,
 * and once the window is over the room's own clock springs it back — her
 * device says so, Dan's does not, and it costs nothing. Then both throw
 * theirs within the window, worked out by the solver.
 */
async function initLever(lab: Lab): Promise<void> {
  const [cleo, dan] = lab.crew;
  const def = tutorial.puzzles[0];
  if (def?.type !== 'button-sync' || def.style !== 'lever' || def.windowMs === undefined) {
    fail('the tutorial should open on a main switch with a window');
  }
  const windowMs = def.windowMs;
  await walkTo(cleo, [11, 1]); // beside the Initialisierung at (12,1), west
  await walkTo(dan, [13, 1]); // and east
  await switchOn(cleo, 0);
  for (const client of lab.crew) {
    await client.expectView(`sees the main switch: a lever each, ${windowMs} ms to throw both`,
      (v) => v.puzzle?.kind === 'button-sync' && v.puzzle.style === 'lever' &&
        v.puzzle.windowMs === windowMs && v.puzzle.here === 2);
  }
  cleo.send({ kind: 'puzzle-input', input: { press: true } });
  const thrown = await cleo.expectView('her lever down, running out after the window', (v) => {
    const press = v.puzzle?.kind === 'button-sync' ? v.puzzle.press : null;
    return press !== null && press.expiresAt === press.at + windowMs;
  });
  await dan.expectView('sees her lever down, and that it is hers: the count both see', (v) =>
    v.puzzle?.kind === 'button-sync' && v.puzzle.partnerPressed && v.puzzle.press === null &&
    v.puzzle.presses[0]?.by === cleo.playerId);
  const sprang = await cleo.expectView('her lever sprang back on the room\'s clock, she is told',
    (v) => v.puzzle?.kind === 'button-sync' && v.puzzle.press === null &&
      v.puzzle.lastResult === 'expired');
  await dan.expectView('sees it up again and is told nothing', (v) =>
    v.puzzle?.kind === 'button-sync' && !v.puzzle.partnerPressed && v.puzzle.lastResult === null);
  assert(sprang.alarms.count === 0 && sprang.deadlineAt === thrown.deadlineAt,
    'the lever that sprang back cost no alarm and no time');
  await solveStation(0, lab);
}

/** The Signalprobe from its two consoles in the Leitstand: Cleo at A, Dan at B. */
async function signalProbe(lab: Lab): Promise<void> {
  const [cleo, dan] = lab.crew;
  await walkTo(cleo, [8, 5]); // console A
  await walkTo(dan, [13, 5]); // console B
  await switchOn(dan, 1);
  await solveStation(1, lab);
}

/**
 * The Kabelprüfung in the Kontrolle: Dan holds the plate of its door, Cleo
 * walks through to the box, and Dan searches the locker beside the plate and
 * reads the box's rules there, still on the plate.
 */
async function wiringBox(lab: Lab): Promise<void> {
  const [cleo, dan] = lab.crew;
  const plate = tutorial.map.plates[0] ?? fail('the tutorial has no plate');
  const locker = tutorial.map.manuals[0] ?? fail('the tutorial has no locker');
  await walkTo(dan, [plate.x, plate.y]);
  await cleo.until('the Kontrolle\'s door held open', (v) =>
    v.map?.doors.find((d) => d.id === 'kontrolltuer')?.open === true);
  await walkTo(cleo, [3, 4]); // beside the box at (2,4)
  await openSource(dan, locker.id, `Spind durchsucht: ${locker.label}`);
  await switchOn(cleo, 2);
  await solveStation(2, lab);
}

/**
 * The Synchronkalibrierung in the Spulen, open since the box: Cleo comes out
 * through the door Dan still holds, both walk east and press within the
 * window, and both get out by the hatch.
 */
async function finale(lab: Lab): Promise<void> {
  const [cleo, dan] = lab.crew;
  await walkTo(cleo, [15, 4]); // west of the Synchronkalibrierung at (16,4)
  await walkTo(dan, [17, 4]); // and east
  await switchOn(cleo, 3);
  await solveStation(3, lab);
  const hatch = tutorial.map.exit ?? fail('the tutorial has no hatch');
  for (const client of lab.crew) {
    await walkTo(client, [hatch.x, hatch.y]);
  }
  for (const client of lab.crew) {
    await client.expectView('won the tutorial', (v) => v.phase === 'won');
  }
}

/**
 * The tutorial's end screen leads on to Blackout. A yes naming the mission
 * that comes next is the host's alone, and names one the catalog has; Dan
 * says yes, Cleo says yes naming Blackout, and Blackout opens with the power
 * on — the same crew, the same difficulty.
 */
async function onIntoBlackout(lab: Lab): Promise<void> {
  const [cleo, dan] = lab.crew;
  const over = cleo.view ?? fail('cleo: no view of the end screen');
  assert(over.phase === 'won' && over.nextMissionId === mission.id,
    `the won tutorial leads on to ${mission.title}`);
  dan.send({ kind: 'set-ready', ready: true, missionId: mission.id });
  const guest = await dan.expect('refusal of a guest naming the next mission', isError);
  assert(guest.message === 'Den nächsten Einsatz wählt der Host.',
    'only the host names the mission that comes next');
  cleo.send({ kind: 'set-ready', ready: true, missionId: 'gibt-es-nicht' });
  const unknown = await cleo.expect('refusal of a mission the catalog lacks', isError);
  assert(/gibt es nicht/.test(unknown.message), 'a mission the catalog lacks is refused');
  dan.send({ kind: 'set-ready', ready: true });
  await cleo.until('Dan says yes', (v) => v.players.some((p) => p.name === 'Dan' && p.ready));
  assert(cleo.view?.phase === 'won', 'a yes from Dan alone starts nothing');
  cleo.send({ kind: 'set-ready', ready: true, missionId: mission.id });
  for (const client of lab.crew) {
    const next = await client.expectView(`in ${mission.title}: Normalbetrieb, the power still on`,
      (v) => v.phase === 'playing' && v.missionId === mission.id && !v.lights.out &&
        v.deadlineAt === null);
    const spawn = next.map?.yourSpawn;
    assert(
      next.difficulty === over.difficulty &&
        next.events.length === 0 &&
        mission.map.spawns.some((s) => s.x === spawn?.x && s.y === spawn.y),
      `${client.label} starts ${mission.title} on a spawn of its own, at the same difficulty`,
    );
  }
  cleo.send({ kind: 'list-rooms' });
  const rooms = await cleo.expect('room list', isRooms);
  const room = rooms.rooms.find((r) => r.code === cleo.joined?.code);
  assert(room?.missionId === mission.id && room.phase === 'playing',
    `the lobby browser lists the room with ${mission.title} under way`);
  const lines = readFileSync(RUNS_LOG, 'utf8').trimEnd().split('\n');
  const tutorialRun = JSON.parse(lines.at(-1) ?? '{}') as Partial<RunReport>;
  assert(tutorialRun.missionId === tutorial.id && tutorialRun.outcome === 'won',
    'the won tutorial left its line in the run log');
}

const tutorialLab = await openTutorial();
await initLever(tutorialLab);
await signalProbe(tutorialLab);
await wiringBox(tutorialLab);
await finale(tutorialLab);
await onIntoBlackout(tutorialLab);
for (const client of tutorialLab.crew) {
  client.close();
}

// --- a station rests through an emergency, and comes back with what was done ----------

const restMission = parseMission(restFile);
/** The seed the Ruheprobe's room is pinned to: the Paketfilter's probe's own. */
const REST_SEED = 4;
/**
 * The longest a wave of the Ruheprobe takes to its clean end, s: the breath before its first
 * packet (FIREWALL_PAUSE_MS), four gaps of 0.32 of a fall at most, and the last packet's fall —
 * 22.3 s; the shortest is 19 s.
 */
const REST_WAVE_MAX_SEC = 23;
/**
 * How far into the second wave the emergency is to fall, s, counted from the longest first
 * wave: 7 to 11 s into it — its first packets on the lines, none at the Kern before 12 s.
 */
const REST_INTO_WAVE_SEC = 7;
/** How long before its emergency the Ruheprobe's first wave is released, ms. */
const REST_LEAD_MS = (REST_WAVE_MAX_SEC + REST_INTO_WAVE_SEC) * 1000;
/** How exactly the release keeps that lead, ms: a later moment waits for the next emergency. */
const REST_SLOT_MS = 500;
/** How long before the emergency the crew's hands come off the consoles, ms: no move meets it. */
const HANDS_OFF_MS = 600;

/**
 * How long until the schedule of `lab`'s room has its next emergency, ms: `firstAfterSec` after
 * its lights went out, then every `everySec` (server room.ts `reconcileSabotage`).
 */
function emergencyDueIn(lab: Lab): number {
  const [watcher] = lab.crew;
  const { firstAfterSec, everySec } =
    lab.mission.map.sabotage ?? fail(`${lab.mission.id}: no emergencies`);
  const since = Date.now() - (watcher.view?.lights.outAt ?? fail('the lights are not out'));
  const [first, every] = [firstAfterSec * 1000, everySec * 1000];
  return (since < first ? first : Math.ceil((since - first) / every) * every + first) - since;
}

/** A room for the Ruheprobe on its pinned seed: Hana opens it, Ivo joins, Hana starts. */
async function openRestProbe(): Promise<Lab> {
  const hana = new TestClient('hana');
  const ivo = new TestClient('ivo');
  await hana.open();
  await ivo.open();
  const room = { name: 'Hana', pass: hana.pass, missionId: restMission.id, seed: REST_SEED };
  hana.send({ kind: 'create-room', ...room });
  const { code } = await hana.seated();
  ivo.send({ kind: 'join-room', code, name: 'Ivo', pass: ivo.pass });
  await ivo.seated();
  ivo.send({ kind: 'set-ready', ready: true });
  await hana.until('Ivo says yes', (v) => v.players.some((p) => p.name === 'Ivo' && p.ready));
  hana.send({ kind: 'start-mission' });
  for (const client of [hana, ivo]) {
    await client.until('the Ruheprobe under way', (v) => v.phase === 'playing' && v.lights.out);
    await client.ensureSelf();
  }
  return { mission: restMission, crew: [hana, ivo] };
}

/**
 * The solver's moves at the one station of `lab`, on the server's clock and from the views
 * alone, four looks a second, until `stop` holds; fails where it does not within the time a
 * station on the clock gets.
 */
async function onTheClockUntil(lab: Lab, stop: () => boolean, what: string): Promise<void> {
  const def = lab.mission.puzzles[0] ?? fail(`${lab.mission.id} has no station`);
  const deadline = Date.now() + ON_THE_CLOCK_SEC * 1000;
  while (!stop()) {
    if (Date.now() > deadline) {
      fail(`${lab.mission.id}: ${what} did not come within ${ON_THE_CLOCK_SEC} s`);
    }
    if (lab.crew.some((client) => client.view?.puzzle?.index !== 0)) {
      await sleep(50);
      continue;
    }
    const { views, edgework, remainingSec } = crewSees(0, lab);
    const aid = { transcript: [], remainingSec, at: Date.now() };
    const moves = moduleFor(def.type).solve(def, views, edgework, aid);
    if (moves.length > 0) {
      await play(moves, 0, lab);
    } else {
      await sleep(250);
    }
  }
}

/**
 * The first wave released REST_LEAD_MS before the next emergency, so that the emergency falls
 * into the second: an emergency that comes first — the crew was slow to its consoles — is
 * weathered with the wave still waiting, and the one after it is taken.
 */
async function releaseBeforeEmergency(lab: Lab): Promise<void> {
  const [gate] = lab.crew;
  for (let due = emergencyDueIn(lab); due > REST_LEAD_MS || due < REST_LEAD_MS - REST_SLOT_MS; ) {
    if (emergencyIn(lab.crew)) {
      await weather(lab);
    }
    await sleep(20);
    due = emergencyDueIn(lab);
  }
  gate.send({ kind: 'puzzle-input', input: { start: true } });
  await gate.expectView('the first wave released, its emergency a wave and a bit away', (v) =>
    firewallOf(v)?.waiting === false);
}

/** Whether the Paketfilter runs its second wave: one clean behind it, packets on the lines. */
const midSecondWave = (filter: FirewallView): boolean =>
  filter.cleared === 1 && !filter.waiting && filter.clock?.heldAt === null &&
  (filter.packets?.length ?? 0) > 0;

/** Whether the Paketfilter waits for the Freigabe with one clean wave and no packet on a line. */
const waitsAfresh = (filter: FirewallView | null): boolean =>
  filter?.cleared === 1 && filter.waiting && filter.packets?.length === 0;

/** How many of the map's consoles `view` tells resting through an emergency: all, none, some. */
function consolesRest(view: PlayerView): 'all' | 'none' | 'some' {
  const spots = view.map?.stations ?? [];
  const resting = spots.filter((spot) => spot.known && spot.resting === true).length;
  if (resting === 0) {
    return 'none';
  }
  return resting === spots.length ? 'all' : 'some';
}

/** Whether a message carries the Paketfilter or a packet's header. */
const carriesStation = (frame: string): boolean =>
  frame.includes('"kind":"firewall"') || frame.includes('"protocol":"');

/** What `client` received while an emergency had its lab: every message naming one. */
const framesInEmergency = (client: TestClient, from: number): string[] =>
  client.raw.slice(from).filter((frame) => frame.includes('"sabotage":{'));

/**
 * The emergency falls into the open Paketfilter, its first wave clean and packets of the second
 * on the lines: on both views the station is gone and its consoles rest, and nothing of its
 * instance comes with any message while the emergency is on. Returns the station as the
 * Sperrpult last showed it, and the alarms then.
 */
async function restsThroughEmergency(lab: Lab): Promise<{ before: FirewallView; alarms: number }> {
  const [gate] = lab.crew;
  const from = lab.crew.map((client) => client.raw.length);
  const before = firewallOf(gate.view) ?? fail('the Sperrpult shows no Paketfilter');
  const alarms = alarmsOf(gate);
  assert(
    midSecondWave(before),
    `the emergency meets a clean wave and ${before.packets?.length} packet(s) of the next ` +
      'on the lines, the wave running',
  );
  for (const client of lab.crew) {
    await client.expectView('the emergency: no station on the view, its consoles resting', (v) =>
      v.map?.sabotage != null && v.puzzle === null && consolesRest(v) === 'all');
  }
  await weather(lab);
  const during = lab.crew.flatMap((client, i) => framesInEmergency(client, from[i] ?? 0));
  assert(
    during.length > 0 && !during.some(carriesStation),
    `none of the ${during.length} messages of the emergency carried the station or a packet`,
  );
  return { before, alarms };
}

/**
 * After the emergency the station is back on both consoles without a switch-on — E there has
 * nothing to switch on —, its clean wave kept, the wave that was in the air gone for a fresh
 * one that waits for the Freigabe, and no alarm counted for it.
 */
async function backWithItsProgress(lab: Lab, before: FirewallView, alarms: number): Promise<void> {
  const [gate, analysis] = lab.crew;
  const inTheAir = before.packets?.map((packet) => packet.id) ?? [];
  for (const client of lab.crew) {
    await client.expectView('the Paketfilter back without a switch-on: a clean wave, waiting',
      (v) => waitsAfresh(firewallOf(v)) && consolesRest(v) === 'none');
  }
  assert(alarmsOf(gate) === alarms, 'the wave the emergency called off cost no alarm');
  gate.pressE();
  const refused = await gate.expect('refusal of a second switch-on', isError);
  assert(refused.message === 'Die Station läuft schon.', 'E finds the station running');
  gate.send({ kind: 'puzzle-input', input: { start: true } });
  const fresh = await analysis.expectView('a fresh wave on the lines after the Freigabe', (v) =>
    (firewallOf(v)?.packets?.length ?? 0) > 0);
  const now = firewallOf(fresh)?.packets?.map((packet) => packet.id) ?? [];
  assert(now.every((id) => !inTheAir.includes(id)),
    `the wave in the air (${inTheAir.join(', ')}) was replaced: ${now.join(', ')} comes on`);
}

/**
 * The Ruheprobe: both walk to their consoles — Ivo past the Laborkennung —, the Paketfilter is
 * switched on, an emergency falls into its second wave (`restsThroughEmergency`), the station
 * comes back with its clean wave (`backWithItsProgress`), the solver clears what is left
 * without an alarm, and both get out by the hatch: the run is won.
 */
async function restProbe(): Promise<void> {
  const began = Date.now();
  const lab = await openRestProbe();
  const [gate, analysis] = lab.crew;
  const [a, b] = restMission.map.stations;
  const sign = restMission.map.edgeworkSign;
  const hatch = restMission.map.exit;
  if (a === undefined || b === undefined || sign === undefined || hatch === undefined) {
    fail('the Ruheprobe should have two consoles, the Laborkennung and a hatch');
  }
  await walkTo(gate, [a.x, a.y + 1]);
  await walkTo(analysis, [sign.x, sign.y]);
  await walkTo(analysis, [b.x, b.y + 1]);
  await switchOn(gate, 0);
  await releaseBeforeEmergency(lab);
  const comes = (): boolean => emergencyIn(lab.crew) || emergencyDueIn(lab) < HANDS_OFF_MS;
  await onTheClockUntil(lab, comes, 'the emergency');
  const { before, alarms } = await restsThroughEmergency(lab);
  await backWithItsProgress(lab, before, alarms);
  const solved = (): boolean => lab.crew.every((client) => solvedOf(client) > 0);
  await onTheClockUntil(lab, solved, 'the solve');
  assert(alarmsOf(gate) === alarms, 'the solver cleared the rested Paketfilter without an alarm');
  for (const client of lab.crew) {
    await walkTo(client, [hatch.x, hatch.y]);
  }
  for (const client of lab.crew) {
    await client.expectView('won the Ruheprobe', (v) => v.phase === 'won');
    client.close();
  }
  const took = ((Date.now() - began) / 1000).toFixed(1);
  console.log(`✓ the Ruheprobe, from its room's opening to the won run: ${took} s`);
}

await restProbe();

// --- a crew of three: one away, the others on without them, and back ------------------

/** A crew of three in Blackout, its room's code: Eva opened it, Finn and Gus joined. */
interface Trio {
  code: string;
  eva: TestClient;
  finn: TestClient;
  gus: TestClient;
}

/**
 * Blackout for three on the server at `port`: Eva opens it, Finn and Gus join and say yes, Eva
 * starts, and all three skip the opening — the lights go out at the third skip.
 */
async function crewOfThree(port: number = PORT): Promise<Trio> {
  const [eva, finn, gus] = ['eva', 'finn', 'gus'].map(
    (label) => new TestClient(label, [], mintPass(), port),
  ) as [TestClient, TestClient, TestClient];
  for (const client of [eva, finn, gus]) {
    await client.open();
  }
  eva.send({ kind: 'create-room', name: 'Eva', pass: eva.pass, missionId: mission.id });
  const { code } = await eva.seated();
  for (const [client, name] of [[finn, 'Finn'], [gus, 'Gus']] as const) {
    client.send({ kind: 'join-room', code, name, pass: client.pass });
    await client.seated();
  }
  // Every join has the room confirm anew: the yeses come once the crew is complete.
  for (const client of [finn, gus]) {
    client.send({ kind: 'set-ready', ready: true });
  }
  await eva.until('Finn and Gus say yes', (v) => v.players.filter((p) => p.ready).length === 2);
  eva.send({ kind: 'start-mission' });
  for (const client of [eva, finn, gus]) {
    await client.until('the run on', (v) => v.phase === 'playing');
    client.send({ kind: 'intro-done' });
  }
  await eva.expectView('a crew of three in the dark, the lights out at the third skip',
    (v) => v.lights.out && v.players.length === 3);
  return { code, eva, finn, gus };
}

/**
 * Finn's line drops for 70 s: the run goes on, the air saying so; once the minute of the run's
 * first drop is over Eva goes on without him, the clock having run all along; ten seconds later
 * Finn is back on his pass — counted in at once, and playing on. Returns Finn's new client.
 */
async function awayAndBack({ code, eva, finn }: Trio): Promise<TestClient> {
  const deadline = eva.view?.deadlineAt ?? fail('eva: no clock running');
  finn.close();
  const held = await eva.expectView('Finn away, the run going on', (v) =>
    v.away[0]?.name === 'Finn' && v.pausedAt === null);
  const away = held.away[0] ?? fail('nobody away');
  assert(away.waivableAt - away.since === FIRST_WAIT_MS,
    'the run\'s first drop lets the crew go on without him after a minute');
  assert(held.events.some((e) => e.kind === 'away' && e.label === 'Finns Leitung ist weg.'),
    'mission control says on the air that Finn\'s line is gone');
  eva.send({ kind: 'continue-without', absentId: away.id });
  const early = await eva.expect('a refusal before the minute is over', isError);
  assert(early.message === 'Die Wartezeit läuft noch.', 'going on before the minute is refused');
  await sleep(Math.max(0, away.waivableAt - Date.now()) + 200);
  eva.send({ kind: 'continue-without', absentId: away.id });
  const on = await eva.expectView('on without Finn', (v) =>
    v.players.some((p) => p.name === 'Finn' && p.waived === true));
  assert(on.deadlineAt === deadline, 'the clock ran all along: the deadline is as it was');
  await sleep(10_000);
  const back = new TestClient('finn2', finn.raw, finn.pass);
  await back.open();
  back.send({ kind: 'resume', code, pass: back.pass });
  await back.seated();
  await eva.expectView('Finn back and counted in again, playing on',
    (v) => v.away.length === 0 &&
      v.players.some((p) => p.name === 'Finn' && p.connected && p.waived === undefined));
  assert(back.view?.pausedAt === null && back.view.deadlineAt === deadline,
    'Finn is back in the run as it runs, its clock where it is');
  console.log(`  Finn was away ${((Date.now() - away.since) / 1000).toFixed(0)} s`);
  return back;
}

/**
 * Gus gives his seat up: the crew of two left goes on, Gus told he left and his pass sitting
 * nowhere; then Finn gives his up — below the mission's smallest crew the run ends for
 * everyone, called off, its end card naming him, and the run log keeps it so.
 */
async function giveUp({ code, eva, gus }: Trio, finn: TestClient): Promise<void> {
  gus.send({ kind: 'abandon', code, pass: gus.pass });
  await gus.expect('Gus told he left', isLeft);
  await eva.expectView('the run goes on for Eva and Finn', (v) =>
    v.phase === 'playing' && v.players.map((p) => p.name).join(',') === 'Eva,Finn');
  gus.send({ kind: 'whereami', pass: gus.pass });
  const nowhere = await gus.expect('where Gus sits', isSeated);
  assert(nowhere.seat === null, 'the pass of who gave up sits nowhere');
  finn.send({ kind: 'abandon', code, pass: finn.pass });
  await finn.expect('Finn told he left', isLeft);
  const over = await eva.expectView('the run over for Eva: called off, Finn named', (v) =>
    v.phase === 'lost' && v.calledOff === 'Finn hat den Einsatz verlassen.');
  assert(over.players.map((p) => p.name).join(',') === 'Eva', 'Eva alone on the end screen');
  const lines = readFileSync(RUNS_LOG, 'utf8').trimEnd().split('\n');
  const called = JSON.parse(lines.at(-1) ?? '{}') as Partial<RunReport>;
  assert(called.outcome === 'lost:abandoned' && called.crew?.join(',') === 'Eva',
    'the run log keeps the run called off, with the crew that was left');
}

/**
 * Gus's line drops and a phone that never held his pass joins by the room's code and his name:
 * it waits for the crew, Eva lets it in, and it resumes his seat on its pass — the run goes
 * on; his old pass is refused, the seat taken over, and a name still on the line is no seat to
 * take. Returns the phone's client.
 */
async function takeOver({ code, eva, gus }: Trio): Promise<TestClient> {
  gus.close();
  await eva.expectView('Gus away, the run going on', (v) => v.away[0]?.name === 'Gus');
  const phone = new TestClient('gus-phone');
  await phone.open();
  phone.send({ kind: 'join-room', code, name: 'Eva', pass: phone.pass });
  const eva2 = await phone.expect('a refusal of a name on the line', isError);
  assert(eva2.message === 'Eva ist noch verbunden.', 'a seat on the line is no seat to take over');
  phone.send({ kind: 'join-room', code, name: 'Gus', pass: phone.pass });
  await phone.expect('its ask waiting for the crew', isPending);
  const asked = await eva.expectView('the crew asked to let the phone in', (v) =>
    v.takeovers?.[0]?.name === 'Gus');
  eva.send({ kind: 'takeover-answer', seat: asked.takeovers?.[0]?.id ?? '', allow: true });
  await phone.expect('let in by Eva', isAllowed);
  phone.send({ kind: 'resume', code, pass: phone.pass });
  await phone.seated();
  assert(phone.view?.you.name === 'Gus', 'the phone sits on Gus\'s seat');
  await eva.expectView('Gus back on the phone, the run on', (v) =>
    v.away.length === 0 && v.players.some((p) => p.name === 'Gus' && p.connected));
  const laptop = new TestClient('gus-laptop', [], gus.pass);
  await laptop.open();
  laptop.send({ kind: 'resume', code, pass: laptop.pass });
  const refused = await laptop.expect('the old pass refused', isError);
  assert(refused.message === 'Der Platz wurde auf einem anderen Gerät übernommen.',
    'the pass that lost its seat is told it went to another device');
  laptop.close();
  return phone;
}

/**
 * Finn goes to the main menu (`to-menu`): a clean leave the server records as such, not a drop
 * — his socket told so and standing at the door, his seat bound to the run, which goes on, his
 * wait as for a later drop, and tells Eva where he went; back on his pass, he plays on.
 */
async function toTheMenuAndBack({ code, eva }: Trio, finn: TestClient): Promise<void> {
  finn.send({ kind: 'to-menu' });
  const told = await finn.expect('Finn told his seat is off its line', isAtMenu);
  assert(told.code === code, 'the socket is told which room it left for the menu');
  const held = await eva.expectView('Finn gone to the main menu, the run going on', (v) =>
    v.away[0]?.name === 'Finn' && v.away[0].menu === true && v.pausedAt === null);
  const gone = held.away[0] ?? fail('nobody away');
  assert(gone.waivableAt - gone.since === LATER_WAIT_MS,
    'the crew waits for a leave to the menu as for a later drop');
  finn.send({ kind: 'whereami', pass: finn.pass });
  const bound = await finn.expect('where Finn sits from the menu', isSeated);
  assert(bound.seat?.code === code && bound.seat.phase === 'playing' && !bound.seat.paused,
    'the pass gone to the menu stays bound to the run, which goes on');
  finn.send({ kind: 'resume', code, pass: finn.pass });
  await finn.seated();
  await eva.expectView('Finn back from the menu, playing on', (v) =>
    v.away.length === 0 &&
    v.players.some((p) => p.name === 'Finn' && p.connected && p.menu === undefined));
  console.log('  Finn left for the main menu, his seat kept, and came back');
}

const trio = await crewOfThree();
const finnBack = await awayAndBack(trio);
const gusPhone = await takeOver(trio);
await toTheMenuAndBack(trio, finnBack);
await giveUp({ ...trio, gus: gusPhone }, finnBack);
for (const client of [trio.eva, finnBack, gusPhone]) {
  client.close();
}

// --- the server restarts mid-run: SIGTERM, then SIGKILL; then a deploy hands over ---------

/** The port the restarting server listens on: its own, beside the smoke's in-process one. */
const RESTART_PORT = Number(process.env['SMOKE_RESTART_PORT'] ?? PORT + 1);
/** The port a deploy's new server comes up on while the old one is still up (`handover`). */
const HANDOVER_PORT = RESTART_PORT + 1;
/** How long the old server stays up beside the new one: Render's minute, shortened, ms. */
const OVERLAP_MS = 1500;
/** The port the server the start script runs listens on (`startScript`). */
const START_PORT = HANDOVER_PORT + 1;
/** The key every server of the restarts seals with, as Render's environment holds one. */
const ROOM_SECRET = randomBytes(32).toString('hex');
/** The server's entry, run as a process of its own. */
const SERVER_ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPO_DIR = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * How a ServerProcess comes up: node on the server's entry, or the repo's start script under
 * pnpm — in a process group of its own, so that none of it outlives the smoke.
 */
type Launch = 'entry' | 'start-script';
const LAUNCH: Record<Launch, { file: string; args: string[]; cwd: string }> = {
  entry: { file: process.execPath, args: ['--import', 'tsx', SERVER_ENTRY], cwd: SERVER_DIR },
  'start-script': { file: 'pnpm', args: ['run', 'start'], cwd: REPO_DIR },
};

/** Every server process the smoke started: none outlives it, however it ends. */
const servers = new Set<ChildProcess>();
process.on('exit', () => {
  for (const child of servers) {
    try {
      process.kill(-(child.pid ?? 0), 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
});

/**
 * The server as a process of its own on `port`, sealing with ROOM_SECRET, as Render runs it: what
 * it logs, line by line, and how it ended.
 */
class ServerProcess {
  readonly lines: string[] = [];
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private readonly child: ChildProcess;

  constructor(
    readonly name: string,
    readonly port = RESTART_PORT,
    launch: Launch = 'entry',
    env: Record<string, string> = {},
  ) {
    const { file, args, cwd } = LAUNCH[launch];
    this.child = spawn(file, args, {
      cwd,
      env: {
        ...process.env,
        PORT: String(port),
        TLS: 'off',
        ROOM_SECRET,
        RUNS_LOG: join(runsDir, 'logs', 'restarts.jsonl'),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: launch === 'start-script',
    });
    servers.add(this.child);
    for (const stream of [this.child.stdout, this.child.stderr]) {
      if (stream !== null) {
        createInterface({ input: stream }).on('line', (line) => this.lines.push(line));
      }
    }
    this.exited = new Promise((resolve) => {
      this.child.once('exit', (code, signal) => {
        servers.delete(this.child);
        resolve({ code, signal });
      });
    });
  }

  /** Resolves once the server listens; fails the smoke after 30 s, its log shown. */
  async up(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (!this.lines.some((line) => line.includes('[escapelab] server on'))) {
      if (Date.now() > deadline) {
        fail(`${this.name} did not come up within 30 s:\n${this.lines.join('\n')}`);
      }
      await sleep(50);
    }
    console.log(`✓ ${this.name} listens on ${this.port}`);
  }

  /** Sends the process `signal`: Render's SIGTERM, or a SIGKILL that leaves it no word. */
  kill(signal: NodeJS.Signals): void {
    this.child.kill(signal);
  }

  /** The commands of every process this one started, and theirs, as `ps` names them. */
  descendants(): string[] {
    const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
      .split('\n')
      .map((row) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }));
    const under = new Set([this.child.pid]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const row of rows) {
        if (under.has(row.ppid) && !under.has(row.pid)) {
          under.add(row.pid);
          grew = true;
        }
      }
    }
    return rows
      .filter((row) => row.pid !== this.child.pid && under.has(row.pid))
      .map((row) => row.command ?? '');
  }

  /** Whether the server logged a line holding `text`. */
  logged(text: string): boolean {
    return this.lines.some((line) => line.includes(text));
  }

  /**
   * The line the server logs holding `text`, once its log has come through: what it logs and
   * what it sends come apart. Fails the smoke, `what` said, after 5 s without it.
   */
  async logs(text: string, what: string): Promise<string> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const line = this.lines.find((said) => said.includes(text));
      if (line !== undefined) {
        console.log(`✓ ${this.name}: ${what}`);
        return line;
      }
      if (Date.now() > deadline) {
        fail(`${this.name}: no log line "${text}" — ${what}`);
      }
      await sleep(50);
    }
  }

  /** The instance this boot of the server is, as its log names it once it is up. */
  async instance(): Promise<string> {
    const line = await this.logs('this boot is instance ', 'it names the instance it is');
    const id = /this boot is instance (\S+):/.exec(line)?.[1];
    return id ?? fail(`${this.name}: no instance in "${line}"`);
  }
}

/**
 * `client`'s browser back on a socket to the new server on `port`, resuming its seat with the
 * snapshot it kept — seated within `within` ms, where the server waits for a newer snapshot of
 * the room first; its seat, its spot and what it kept go with it.
 */
async function comeBack(
  client: TestClient,
  port = RESTART_PORT,
  within = 5000,
): Promise<TestClient> {
  const kept = client.kept ?? fail(`${client.label}: no snapshot kept`);
  const code = client.joined?.code ?? fail(`${client.label}: in no room`);
  const back = new TestClient(`${client.label}'`, client.raw, client.pass, port);
  await back.open();
  back.send({ kind: 'resume', code, pass: client.pass, blob: kept.blob });
  await back.seated(within);
  back.self = client.self;
  back.kept = kept;
  return back;
}

/** Whether `client`'s log has the server telling it its room waits for a newer snapshot. */
function toldRestoring(client: TestClient, from: number): boolean {
  return client.raw
    .slice(from)
    .some((data) => (JSON.parse(data) as ServerMessage).kind === 'restoring');
}

/** The whole crew at the lever: E pressed by the first, then all three throw it together. */
async function throwTheLever(clients: TestClient[]): Promise<void> {
  const [first] = clients;
  await switchOn(first ?? fail('nobody at the lever'), NOTLICHT);
  for (const client of clients) {
    client.send({ kind: 'puzzle-input', input: { press: true } });
  }
  for (const client of clients) {
    await client.expectView('the Notlicht thrown', (v) => v.currentPuzzleIndex === NOTLICHT + 1);
  }
}

/**
 * SIGTERM for `server`, as Render sends it: it exits 0 within 10 s, every one of `clients` handed
 * the room's last snapshot (`restart`) and its socket closed with 1012, the run standing still
 * for the whole crew since the last snapshot — whoever's line had dropped before. Returns the
 * last snapshot.
 */
async function goneBySigterm(
  server: ServerProcess,
  clients: [TestClient, ...TestClient[]],
): Promise<Kept> {
  const sentAt = Date.now();
  server.kill('SIGTERM');
  const ended = await server.exited;
  const took = Date.now() - sentAt;
  assert(ended.code === 0 && took < 10_000, `SIGTERM: the server exits 0, in ${took} ms`);
  const last = lastHandedTo(clients);
  const view = clients[0].view ?? fail(`${clients[0].label}: no view`);
  assert(view.pausedAt === last.at,
    'the run stood still for the whole crew as the server went down');
  const kb = (last.blob.length / 1024).toFixed(1);
  console.log(`  the last snapshot: seq ${last.seq}, ${kb} kB sealed`);
  return last;
}

/**
 * The room's last snapshot, as every one of `clients` was handed it by a server going down — its
 * socket closed with 1012 after it.
 */
function lastHandedTo(clients: [TestClient, ...TestClient[]]): Kept {
  for (const client of clients) {
    assert(client.restartedWith !== null && client.closedWith === 1012,
      `${client.label} handed the room's last snapshot, its socket closed with 1012`);
  }
  const [first] = clients;
  return first.restartedWith ?? fail(`${first.label}: not handed the last snapshot`);
}

/** The three of `crew` back on the new server at once (`comeBack`), seated within `within` ms. */
async function allBack(crew: Trio3, within = 5000): Promise<Trio3> {
  const [eva, finn, gus] = crew;
  return Promise.all([
    comeBack(eva, RESTART_PORT, within),
    comeBack(finn, RESTART_PORT, within),
    comeBack(gus, RESTART_PORT, within),
  ]);
}

/** A crew of three, Eva, Finn and Gus, in that order. */
type Trio3 = [TestClient, TestClient, TestClient];

/**
 * The deadline `on` shows, moved on from `deadline` by exactly the time the run stood still:
 * from `since`, when it began to, to the moment the last of the crew was back (`on.at`).
 */
function assertShifted(
  on: { view: PlayerView; at: number },
  deadline: number,
  since: number,
): void {
  const shift = (on.view.deadlineAt ?? 0) - deadline;
  const downtime = on.at - since;
  const late = downtime - shift;
  assert(shift > 0 && late >= 0 && late <= 5,
    `the deadline moved on by ${shift} ms, the standstill ${downtime} ms`);
}

/**
 * The view `client` heard the run go on in, the first since its log ran to `from`, and when the
 * server sent it: the moment the last of the crew was back.
 */
function goingOn(client: TestClient, from: number): { view: PlayerView; at: number } {
  const going = client.raw
    .slice(from)
    .map((data) => JSON.parse(data) as ServerMessage)
    .find((msg) => msg.kind === 'view' && msg.view.pausedAt === null);
  return going?.kind === 'view' ? going : fail(`${client.label}: no view of the run going on`);
}

/**
 * Three in Blackout on a server of its own; mid-run Render sends SIGTERM (`goneBySigterm`). A new
 * server on the same port with the same ROOM_SECRET knows no room; the three resume with their
 * snapshots, the first takes the room up again — the log says so — and the run goes on once all
 * three are back, its deadline moved on by exactly the downtime. Then they throw the Notlicht's
 * lever together: inputs work.
 */
async function restartBySigterm(): Promise<{ server: ServerProcess; crew: Trio3 }> {
  const first = new ServerProcess('the server');
  await first.up();
  const { code, eva, finn, gus } = await crewOfThree(RESTART_PORT);
  const lever = STAND[NOTLICHT] ?? fail('no spot at the lever');
  for (const client of [eva, finn, gus]) {
    await walkTo(client, lever);
  }
  const deadline = eva.view?.deadlineAt ?? fail('eva: no clock running');
  const last = await goneBySigterm(first, [eva, finn, gus]);
  const server = new ServerProcess('a new server');
  await server.up();
  const heardBefore = [eva, finn, gus].map((client) => client.raw.length);
  const crew = await allBack([eva, finn, gus]);
  await crew[0].expectView('the run on again, the whole crew back',
    (v) => v.phase === 'playing' && v.pausedAt === null);
  assertShifted(goingOn(crew[0], heardBefore[0] ?? 0), deadline, last.at);
  assert(server.logged(`restored room ${code} from snapshot seq ${last.seq} (3 seats, `),
    'the new server\'s log says it restored the room from the last snapshot');
  assert(crew.every((client, i) => !toldRestoring(client, heardBefore[i] ?? 0)),
    'the last snapshot of the server before is taken up at once, nobody waiting for a newer one');
  await throwTheLever(crew);
  return { server, crew };
}

/**
 * `server` killed outright, with no word to `crew`, mid-run: the newest snapshot the crew kept
 * is SNAPSHOT_LIVE_MS old at most — the run's own beat. Returns it.
 */
async function goneBySigkill(server: ServerProcess, crew: TestClient[]): Promise<Kept> {
  const killedAt = Date.now();
  server.kill('SIGKILL');
  const ended = await server.exited;
  assert(ended.signal === 'SIGKILL', 'SIGKILL: the server is gone without a word');
  const kept = crew.map((client) => client.kept ?? fail(`${client.label}: no snapshot kept`));
  const newest = kept.reduce((a, b) => (b.seq > a.seq ? b : a));
  const lost = killedAt - newest.at;
  assert(lost <= SNAPSHOT_LIVE_MS, `the newest snapshot the crew kept was ${lost} ms old`);
  return newest;
}

/** Where the positions `seen` heard last have `client`, as the log says it: „15.5,9.5". */
function spotOf(seen: TestClient, client: TestClient): string {
  const stood = seen.positions[client.playerId ?? ''];
  return stood === undefined ? 'nowhere' : `${stood.x.toFixed(1)},${stood.y.toFixed(1)}`;
}

/** Whether the latest positions `seen` heard have `client` in the middle of tile (x, y). */
function standsAt(seen: TestClient, client: TestClient, [x, y]: Tile): boolean {
  const stood = seen.positions[client.playerId ?? ''];
  return stood !== undefined && Math.hypot(stood.x - (x + 0.5), stood.y - (y + 0.5)) < 0.05;
}

/** How long after the next server came up the crew is back on it, ms (`restartBySigkill`). */
const BACK_LATER_MS = 5000;
/** How much later than its wait a room may be back, the sockets' way included, ms. */
const BACK_SLACK_MS = 1500;

/**
 * The run goes on; then the server is killed outright (`goneBySigkill`): a new one takes the room
 * up again from the newest snapshot the crew kept — the run's beat of SNAPSHOT_LIVE_MS keeps
 * where everybody stands, a deed goes out SNAPSHOT_EVERY_MS after it — HANDOVER_MS after the
 * first of the crew came back, whenever the server came up: a killed server hands no last
 * snapshot over, and the room waits for one meanwhile. Gus's walk, a beat before the kill, is
 * kept — the lever thrown long before with it; Finn's, just before the kill, may be lost in part.
 */
async function restartBySigkill(server: ServerProcess, crew: Trio3): Promise<void> {
  const [eva, finn, gus] = crew;
  await sleep(SNAPSHOT_EVERY_MS + 500);
  const gusTo = besides(consoleOf(NOTLICHT), 3, 0, 'east of the lever');
  await walkTo(gus, gusTo);
  await sleep(SNAPSHOT_LIVE_MS + 500);
  const finnTo = besides(consoleOf(NOTLICHT), -3, 0, 'west of the lever');
  await walkTo(finn, finnTo);
  await sleep(300);
  const killed = await server.instance();
  const newest = await goneBySigkill(server, crew);
  const next = new ServerProcess('another server');
  await next.up();
  await sleep(BACK_LATER_MS);
  const resumedAt = Date.now();
  const heardBefore = crew.map((client) => client.raw.length);
  const back = await allBack(crew, HANDOVER_MS + 5000);
  const waited = Date.now() - resumedAt;
  assert(back.every((client, i) => toldRestoring(client, heardBefore[i] ?? 0)),
    'the crew is told its room is on its way back while the new server waits');
  assert(next.logged(`is not the last of instance ${killed}, waiting up to `),
    'the new server\'s log says it waits for a newer snapshot than the killed one\'s');
  const backAfter = `the room back ${(waited / 1000).toFixed(1)} s after the crew came back`;
  assert(waited > HANDOVER_MS - 100 && waited < HANDOVER_MS + BACK_SLACK_MS, backAfter);
  console.log(`  ${backAfter}, ${(BACK_LATER_MS / 1000).toFixed(0)} s after the server came up`);
  const gusBack = back[2];
  const on = await gusBack.expectView('the run on again after the kill, the lever still thrown',
    (v) => v.pausedAt === null && v.currentPuzzleIndex === NOTLICHT + 1);
  assert(on.phase === 'playing', 'the run goes on');
  await gusBack.untilPositions('Gus where his walk before the kill took him',
    () => standsAt(gusBack, gus, gusTo));
  const finnEnd = standsAt(gusBack, finn, finnTo) ? 'its end kept' : 'its end lost';
  console.log(`  Finn's walk just before the kill: back at ${spotOf(gusBack, finn)}, ${finnEnd}`);
  assert(next.logged(`restored room ${eva.joined?.code} from snapshot seq ${newest.seq}`),
    'the log says the room was restored from the newest periodic snapshot');
  for (const client of back) {
    client.close();
  }
  next.kill('SIGTERM');
  assert((await next.exited).code === 0, 'the server after the kill goes down cleanly');
}

/**
 * Finn's line drops while Render's deploy has a new server, `fresh`, up beside the old one, the
 * instance `old`: the run goes on without him on the old one, as Eva sees, and his page comes
 * back to the new one with the snapshot it kept, older than what the old one has — and waits
 * there (`restoring`), the new server's log naming the old one. Returns his client on the new
 * server.
 */
async function droppedOnto(
  fresh: ServerProcess,
  old: string,
  eva: TestClient,
  finn: TestClient,
): Promise<TestClient> {
  const code = finn.joined?.code ?? fail('finn: in no room');
  const kept = finn.kept ?? fail('finn: no snapshot kept');
  finn.close();
  await eva.expectView('Finn away on the old server, the run going on',
    (v) => v.away[0]?.name === 'Finn' && v.pausedAt === null);
  const back = new TestClient("finn'", finn.raw, finn.pass, HANDOVER_PORT);
  await back.open();
  back.send({ kind: 'resume', code, pass: finn.pass, blob: kept.blob });
  await back.expect('his room on its way back, the new server waiting', isRestoring);
  console.log(`✓ ${back.label}: waits on the new server, snapshot seq ${kept.seq} in hand`);
  const waits =
    `room ${code}: snapshot seq ${kept.seq} is not the last of instance ${old}, waiting up to `;
  await fresh.logs(waits, 'it waits for the old server\'s last snapshot, naming the old server');
  return back;
}

/**
 * Render's deploy: a new server comes up beside the old one and takes the traffic, the old one up
 * a while longer for the sockets it has (`droppedOnto`). Then the old one is sent SIGTERM: Eva and
 * Gus come back to the new one with its last snapshot, which the new one takes the room up from —
 * its log says so, and how long it waited — and Finn sits down with them. The run goes on from
 * where the old server left it: its clock moved on by exactly the time it stood still, from the
 * old server going down to the moment the last of the crew was back; it ran through Finn's drop.
 */
async function handover(): Promise<void> {
  const old = new ServerProcess('the old server');
  await old.up();
  const oldInstance = await old.instance();
  const { code, eva, finn, gus } = await crewOfThree(RESTART_PORT);
  const deadline = eva.view?.deadlineAt ?? fail('eva: no clock running');
  // A snapshot's time on: every seat keeps one of the run, the lights out.
  await sleep(SNAPSHOT_EVERY_MS + 500);
  const fresh = new ServerProcess('a new server beside it', HANDOVER_PORT);
  await fresh.up();
  const finnBack = await droppedOnto(fresh, oldInstance, eva, finn);
  await sleep(OVERLAP_MS);
  const last = await goneBySigterm(old, [eva, gus]);
  const heardBefore = eva.raw.length;
  const [evaBack, gusBack] = await Promise.all([
    comeBack(eva, HANDOVER_PORT),
    comeBack(gus, HANDOVER_PORT),
  ]);
  await finnBack.seated();
  await fresh.logs(`room ${code}: Finn resumed`, 'Finn sits on the new server');
  await evaBack.expectView('the run on again on the new server, Finn back with Eva and Gus',
    (v) => v.pausedAt === null && v.players.every((p) => p.connected));
  assertShifted(goingOn(evaBack, heardBefore), deadline, last.at);
  const took = await fresh.logs(`restored room ${code} from snapshot seq ${last.seq} (3 seats, `,
    'it took the room up from the old server\'s last snapshot');
  console.log(`  ${took.replace('[escapelab] ', '')}`);
  for (const client of [evaBack, gusBack, finnBack]) {
    client.close();
  }
  fresh.kill('SIGTERM');
  assert((await fresh.exited).code === 0, 'the new server goes down cleanly');
}

/**
 * The server as Render starts it, `pnpm run start` at the repo's root: pnpm runs node on it
 * straight — no shell and no tsx CLI between them — so SIGTERM for pnpm reaches the server; it
 * says it goes down, and pnpm exits 0 with it.
 */
async function startScript(): Promise<void> {
  const server = new ServerProcess('the start script', START_PORT, 'start-script');
  await server.up();
  const under = server.descendants();
  const between = under.filter((command) => /tsx\/dist\/cli|(^|\/)(ba|da)?sh( |$)/.test(command));
  assert(under.includes('node --import tsx src/index.ts') && between.length === 0,
    `pnpm runs node on the server straight: ${under.join(' | ')}`);
  server.kill('SIGTERM');
  const ended = await server.exited;
  await server.logs('SIGTERM: going down for a restart', 'SIGTERM for pnpm reached the server');
  assert(ended.code === 0, `pnpm exits 0 with the server (${ended.code ?? ended.signal})`);
}

// --- the database: runs and accounts that outlast a deploy --------------------------------

/** The port of the server on Postgres (`runOnPostgres`). */
const DATABASE_PORT = START_PORT + 1;

/** The run the database holds once one has landed there, seats and all; none after 10 s. */
async function landed(db: PrismaClient) {
  const until = Date.now() + 10_000;
  for (;;) {
    const runs = await db.run.findMany({ include: { members: true } });
    if (runs.length > 0 || Date.now() > until) {
      return runs;
    }
    await sleep(200);
  }
}

/**
 * The won tutorial as the database at `db` holds it: one run of the tutorial, won; a seat for
 * Cleo and for Dan, each by the account of the pass that held it, the names only there — the
 * run's report names nobody — and the Erfolge the run earned unlocked for both accounts.
 */
async function checkLanded(db: PrismaClient, lab: Lab): Promise<void> {
  const runs = await landed(db);
  const run = runs[0];
  assert(runs.length === 1 && run !== undefined, `one run landed in the database (${runs.length})`);
  assert(run.missionId === tutorial.id && run.outcome === 'won', 'the won tutorial landed');
  const seats = [...run.members].sort((a, b) => a.seat - b.seat);
  assert(seats.map((seat) => seat.seatName).join() === 'Cleo,Dan', 'a seat for Cleo and Dan');
  const identities = await db.identity.findMany();
  const accountOf = (client: TestClient): string | undefined =>
    identities.find((identity) => identity.subject === client.pass.id)?.accountId;
  const holders = lab.crew.map(accountOf);
  assert(
    seats.every((seat, i) => seat.accountId !== null && seat.accountId === holders[i]),
    'each seat by the account of the pass that held it',
  );
  assert(!JSON.stringify(run.report).includes('Cleo'), 'the report itself names nobody');
  const unlocked = await db.achievement.findMany();
  const keys = new Set(unlocked.map((achievement) => achievement.key));
  const named = [...keys].join(', ');
  assert(
    unlocked.length === keys.size * 2 &&
      [...keys].every((key) => key.startsWith(`${tutorial.id}:`)),
    `the run's Erfolge unlocked for both accounts: ${named}`,
  );
  console.log(`✓ the won tutorial is in Postgres: 2 seats by account, Erfolge ${named}`);
}

const isLogin = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'login' }> =>
  m.kind === 'login';
const isMyRuns = (m: ServerMessage): m is Extract<ServerMessage, { kind: 'my-runs' }> =>
  m.kind === 'my-runs';

/** The Kennwort Cleo sets for her account on Postgres (`signInOnPostgres`). */
const CLEOS_KENNWORT = 'Kaltenbrunn 1986';

/**
 * Cleo's account on Postgres gets a Kennwort, which mints its Ausweisnummer — returned: the login
 * keeps a scrypt hash, never the Kennwort.
 */
async function kennwortOnPostgres(db: PrismaClient, cleo: TestClient): Promise<string> {
  cleo.send({ kind: 'set-password', pass: cleo.pass, password: CLEOS_KENNWORT });
  const set = await cleo.expect('the Ausweisnummer minted', isLogin, 10_000);
  const number = set.account?.login ?? fail('no Ausweisnummer minted');
  const login = await db.identity.findUnique({
    where: { provider_subject: { provider: 'login', subject: number } },
  });
  const hash = login?.secretHash ?? '';
  assert(
    hash.startsWith('scrypt$32768$8$1$') && !hash.includes(CLEOS_KENNWORT),
    `the login keeps a scrypt hash, never the Kennwort (${number})`,
  );
  return number;
}

/**
 * Cleo's account on Postgres, its Kennwort set (`kennwortOnPostgres`): a phone of hers — a pass the
 * database never saw — hears of a wrong Kennwort what a wrong number would hear, signs in with the
 * right one, finds the won tutorial in „Meine Einsätze", and signs out again: its way in gone,
 * the account whole. Then a tablet of hers signs in, and a new Kennwort signs it out
 * (`changedOnPostgres`).
 */
async function signInOnPostgres(db: PrismaClient, lab: Lab): Promise<void> {
  const cleo = lab.crew[0] ?? fail('no Cleo on Postgres');
  const number = await kennwortOnPostgres(db, cleo);
  const phone = new TestClient('cleos phone', [], mintPass(), DATABASE_PORT);
  await phone.open();
  phone.send({ kind: 'sign-in', pass: phone.pass, login: number, password: 'nicht das Kennwort' });
  const wrong = await phone.expect('a wrong Kennwort refused', isError, 10_000);
  assert(
    wrong.message === 'Ausweisnummer oder Kennwort stimmen nicht.',
    `a wrong Kennwort hears what a wrong number would (${wrong.message})`,
  );
  phone.send({ kind: 'sign-in', pass: phone.pass, login: number, password: CLEOS_KENNWORT });
  const signed = await phone.expect('signed in', isLogin, 10_000);
  assert(signed.done === 'signed-in' && signed.account?.runs === 1, 'the phone signed in');
  phone.send({ kind: 'my-runs', pass: phone.pass });
  const mine = await phone.expect('„Meine Einsätze" of the account', isMyRuns);
  assert(mine.total === 1 && mine.runs[0]?.missionId === tutorial.id, 'the phone finds the run');
  phone.send({ kind: 'sign-out', pass: phone.pass });
  const out = await phone.expect('signed out', isLogin, 10_000);
  const way = await db.identity.findUnique({
    where: { provider_subject: { provider: 'pass', subject: phone.pass.id } },
  });
  assert(out.done === 'signed-out' && way === null, "the phone signed out, its way in gone");
  phone.close();
  console.log(`✓ on Postgres: a Kennwort minted ${number}, a phone signed in, found the run, out`);
  await changedOnPostgres(db, cleo, number);
}

/**
 * Cleo's tablet signs into her account on Postgres by the Ausweisnummer `number`, then Cleo sets a
 * new Kennwort: the tablet's next ask finds it signed out, its way in kept under 64 zeros.
 */
async function changedOnPostgres(db: PrismaClient, cleo: TestClient, number: string) {
  const tablet = new TestClient('cleos tablet', [], mintPass(), DATABASE_PORT);
  await tablet.open();
  tablet.send({ kind: 'sign-in', pass: tablet.pass, login: number, password: CLEOS_KENNWORT });
  assert((await tablet.expect('signed in', isLogin, 10_000)).done === 'signed-in', 'tablet in');
  const password = 'Kaltenbrunn 1987';
  cleo.send({ kind: 'change-password', pass: cleo.pass, old: CLEOS_KENNWORT, password });
  const changed = await cleo.expect('the Kennwort changed', isLogin, 10_000);
  assert(changed.done === 'changed', 'Cleo changed her Kennwort');
  tablet.send({ kind: 'my-runs', pass: tablet.pass });
  const told = await tablet.expect('told it signed out', isLogin, 10_000);
  const way = await db.identity.findUnique({
    where: { provider_subject: { provider: 'pass', subject: tablet.pass.id } },
  });
  const parked = way?.secretHash === '0'.repeat(64);
  assert(told.done === 'signed-out' && parked, 'the tablet signed out, its way in parked');
  tablet.close();
  console.log('✓ on Postgres: a new Kennwort signed the tablet out, told on its next ask');
}

/** The colour Ida clicks just before the server goes down (`colourAtTheEnd`). */
const LAST_COLOUR = '#f472b6';

/**
 * A colour clicked in a lobby just before Render's SIGTERM: the server going down keeps it with
 * the account all the same, before it lets go of the store — the clicks settle for a second.
 */
async function colourAtTheEnd(server: ServerProcess, db: PrismaClient): Promise<void> {
  const ida = new TestClient('ida', [], mintPass(), DATABASE_PORT);
  await ida.open();
  ida.send({ kind: 'create-room', name: 'Ida', pass: ida.pass, missionId: tutorial.id });
  await ida.seated();
  ida.send({ kind: 'select-color', color: LAST_COLOUR });
  await ida.until('her seat in the colour she clicked', (v) => v.you.color === LAST_COLOUR);
  server.kill('SIGTERM');
  const ended = await server.exited;
  const kept = await db.identity.findUnique({
    where: { provider_subject: { provider: 'pass', subject: ida.pass.id } },
    include: { account: true },
  });
  const colour = kept?.account.colour ?? 'none';
  assert(
    ended.code === 0 && colour === LAST_COLOUR,
    `a colour clicked just before SIGTERM kept with its account (${colour}, exit ${ended.code})`,
  );
}

/**
 * Where TEST_DATABASE_URL names a Postgres the smoke may write to: the start script with a
 * single direct DATABASE_URL, on a schema of the smoke's own — the server applying the
 * migrations itself before it listens — a crew winning the tutorial there (`checkLanded`), and a
 * colour clicked as the server goes down (`colourAtTheEnd`); the schema is dropped after.
 * Skipped, saying so, without.
 */
async function runOnPostgres(): Promise<void> {
  const base = process.env['TEST_DATABASE_URL'];
  if (base === undefined || base === '') {
    console.log('– the run on Postgres skipped: TEST_DATABASE_URL unset');
    return;
  }
  const schema = `smoke_${randomBytes(4).toString('hex')}`;
  const at = new URL(base);
  at.searchParams.set('schema', schema);
  const url = at.toString();
  const db = new PrismaClient({ datasourceUrl: url });
  // DATABASE_URL alone, as Render sets it without Neon's integration: the migrations take it too.
  // An unpooled URL the shell holds steers them nowhere else.
  const server = new ServerProcess('the start script on Postgres', DATABASE_PORT, 'start-script', {
    DATABASE_URL: url,
    DATABASE_URL_UNPOOLED: '',
  });
  try {
    await server.up();
    await server.logs('All migrations have been successfully applied', 'the migrations ran first');
    await server.logs('store: Postgres', 'it keeps the runs and the accounts in Postgres');
    const lab = await openTutorial(DATABASE_PORT);
    await initLever(lab);
    await signalProbe(lab);
    await wiringBox(lab);
    await finale(lab);
    await checkLanded(db, lab);
    await signInOnPostgres(db, lab);
    for (const client of lab.crew) {
      client.close();
    }
    await colourAtTheEnd(server, db);
  } finally {
    server.kill('SIGTERM');
    await server.exited;
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  }
}

/** The port of the server as Render's Start Command starts it (`renderStartCommand`). */
const RENDER_PORT = DATABASE_PORT + 1;

/** Where in `lines` the first that holds `text` stands; -1 for none. */
const lineOf = (lines: readonly string[], text: string): number =>
  lines.findIndex((line) => line.includes(text));

/**
 * Where TEST_DATABASE_URL names a Postgres: the server as Render's Start Command starts it —
 * `node` straight in packages/server, no script before it — on a schema of the smoke's own with
 * DATABASE_URL alone: it applies the migrations itself before it listens. Then, a migration
 * broken off as a deploy cut short leaves it, the next start stops before it listens, saying
 * P3009; no line names the database's URL or host. Skipped, saying so, without.
 */
async function renderStartCommand(): Promise<void> {
  const base = process.env['TEST_DATABASE_URL'];
  if (base === undefined || base === '') {
    console.log("– Render's Start Command on Postgres skipped: TEST_DATABASE_URL unset");
    return;
  }
  const schema = `smoke_${randomBytes(4).toString('hex')}`;
  const at = new URL(base);
  at.searchParams.set('schema', schema);
  const env = { DATABASE_URL: at.toString(), DATABASE_URL_UNPOOLED: '' };
  const db = new PrismaClient({ datasourceUrl: at.toString() });
  const name = "Render's Start Command on Postgres";
  try {
    const first = new ServerProcess(name, RENDER_PORT, 'entry', env);
    await first.up();
    const applied = lineOf(first.lines, 'migrate: All migrations have been successfully applied');
    const listening = lineOf(first.lines, '[escapelab] server on');
    assert(applied >= 0 && applied < listening, 'it applied the migrations before it listened');
    await first.logs('store: Postgres', 'it keeps the runs and the accounts in Postgres');
    first.kill('SIGTERM');
    await first.exited;
    await db.$executeRawUnsafe(
      `UPDATE "${schema}"._prisma_migrations SET finished_at = NULL WHERE migration_name =
         (SELECT max(migration_name) FROM "${schema}"._prisma_migrations)`,
    );
    const second = new ServerProcess(`${name}, a migration broken off`, RENDER_PORT, 'entry', env);
    const ended = await second.exited;
    await second.logs('not started: the migrations did not apply (P3009)', 'it says P3009');
    assert(
      ended.code === 1 && lineOf(second.lines, '[escapelab] server on') < 0,
      `a migration broken off stops the start before it listens (exit ${ended.code})`,
    );
    const said = [...first.lines, ...second.lines];
    assert(
      said.every((line) => !line.includes('postgresql://') && !line.includes(at.host)),
      "no line names the database's URL or host",
    );
  } finally {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  }
}

const restarted = await restartBySigterm();
await restartBySigkill(restarted.server, restarted.crew);
await handover();
await startScript();
await runOnPostgres();
await renderStartCommand();

rmSync(runsDir, { recursive: true, force: true });
console.log(
  '\nSmoke test passed: Blackout with its power on until the lights went out, the ' +
    'Notlicht\'s lever, a note of the last shift, drawn spawns and sources, streamed movement, ' +
    'plates, a door that stays open, the Anlaufsteuerung, the Paketfilter and the Serverraum ' +
    'at two consoles, the station of the Wechselplatz, the camera plate, reconnect, the hatch\'s ' +
    'checklist, a drop on the way out that ends nothing, penalties and credits; then ' +
    'the tutorial, its lever springing back on the clock, and on into Blackout; then a ' +
    'Paketfilter resting through an emergency and back with its clean wave; then a crew ' +
    'of three going on without the one away, his return, a seat taken over by its name once ' +
    'the crew let the phone in, and ' +
    'seats given up till the run is called off; then a server restarting mid-run, SIGTERM ' +
    'and SIGKILL, the run taken up again from the crew\'s snapshots; a deploy handing ' +
    'over from an old server still up, the run going on from its last snapshot; the ' +
    'start script passing SIGTERM on to the server; and, where TEST_DATABASE_URL names a ' +
    'Postgres, the server migrating it itself over a single URL, a won tutorial landing there ' +
    'by account, a phone signing into the account with its Ausweisnummer and Kennwort, a ' +
    'new Kennwort signing a tablet of the account out, a ' +
    'colour clicked just before SIGTERM kept, and the server started as ' +
    'Render\'s Start Command starts it migrating the database itself before it listens, a ' +
    'migration broken off stopping its start. 🎉',
);
process.exit(0);
