import { z } from 'zod';
import { DIFFICULTIES, type Difficulty } from './difficulty.js';
import { INDICATOR_IDS } from './edgework.js';
import { missionSchema } from './mission.js';
import type { RelayedPosition } from './protocol.js';
import type { PuzzleState } from './puzzles/index.js';
import type { RelayState } from './puzzles/relay.js';
import type { GameState, RunEvent } from './state.js';

/**
 * A room as the server hands it to its crew to keep (server room.ts `snapshot`), sealed so that
 * only a server with its key can read it (server seal.ts): a server that knows nothing of the
 * room — a new instance after a deploy, or a restart — takes it up again from it
 * (`Room.restore`). It holds the room's facts, the game, the seats and whatever else the room
 * keeps beside the game, as the room stands for a server taking it up: every seat off the line,
 * a run standing still for the whole crew (core `maintenance`). None of the room's connections
 * is kept — players and audience alike come back on their own.
 */
export interface RoomSnapshot {
  code: string;
  missionId: string;
  /** the seed the room is pinned to, or null (`GameState.roomSeed`) */
  seed: number | null;
  difficulty: Difficulty;
  /** whether the host has the Tagesschicht on (`GameState.dailyOn`) */
  daily: boolean;
  /** epoch ms the room was opened: with the code, what tells it from another room of that code */
  createdAt: number;
  /** the game, every seat off the line and a run standing still since `at` */
  state: GameState;
  /** every seat, by the pass it is bound to */
  seats: SeatSnapshot[];
  /** the passes whose seat another device took over, by pass id: they are told so, not seated */
  lostPasses: string[];
  /** what the room keeps beside the game */
  keeping: RoomKeeping;
  /** the room's dispatches so far: of two snapshots of a room, the later has the higher */
  seq: number;
  /** epoch ms, by the server's clock, the snapshot was taken */
  at: number;
}

/**
 * A room's snapshot as a server seals it for the crew (server seal.ts): the room, the server
 * instance that sealed it, and whether it was that instance's last of the room — sealed as the
 * instance went down for a restart (`Room.goDown`). One sealed by another instance that is not
 * its last may be older than what that instance still has: a new instance takes the room up
 * again from it only once no newer one can come (server roomManager.ts `HANDOVER_MS`).
 */
export interface SealedSnapshot extends RoomSnapshot {
  /** the server instance that sealed it: one id per boot (server index.ts) */
  instance: string;
  /** sealed as that instance went down for a restart, SIGTERM: its last snapshot of the room */
  final: boolean;
}

/** A seat and the pass bound to it: its id and the SHA-256 of its secret, never the secret. */
export interface SeatSnapshot {
  playerId: string;
  passId: string;
  /** the SHA-256 of the pass's secret, hex */
  hash: string;
  name: string;
}

/** Where a patrolling drone is on its loop, which lives outside the game (server drones.ts). */
export interface DroneRuntime {
  /** index of the waypoint it is heading towards */
  target: number;
  x: number;
  y: number;
  facing: number;
  /** epoch ms until which it cannot trigger another alarm */
  quietUntil: number;
}

/**
 * What a room keeps beside the game (server room.ts), as far as it outlasts the room's
 * connections. Left out: the connections themselves, and when each closed, since a room taken
 * up again waits for every seat from then; a new device's ask for a seat, which lapses with its
 * device; the glances of the crew's lamps, since a look begun before a pause starts anew after
 * it; the mission the host's yes named for the next run, which only the end of a run has, and
 * no ended run is taken up again; and whatever the timers and the stream of positions work out
 * anew from the game and from what is kept here.
 */
export interface RoomKeeping {
  /** where every member of the crew stands, by player id */
  positions: Record<string, RelayedPosition>;
  /** each patrolling drone on its loop, by drone id; null while none patrols */
  drones: Record<string, DroneRuntime> | null;
  /** the seats whose socket closed cleanly, a tab closed or reloaded, by player id */
  closedClean: string[];
  /** until when a pass may not ask for a seat again, by seat and pass id (`<seat>:<pass>`) */
  askAgainAt: Record<string, number>;
  /** epoch ms of each member's last map ping, by id */
  lastPingAt: Record<string, number>;
  /** epoch ms of each member's last quick-chat line, by id */
  lastChatAt: Record<string, number>;
  /** each member's voice signals still allowed, and when that was last worked out, by id */
  signalAllowance: Record<string, { left: number; at: number }>;
  /** the steps refused in the room so far, for the log */
  refusedSteps: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a module keeps its own way — a puzzle's state, the relay's: it names its type. */
const typed = <T>() =>
  z.custom<T>((value) => isRecord(value) && typeof value['type'] === 'string');

const spot = z.looseObject({ x: z.number(), y: z.number() });
const ids = z.array(z.string());
const idsBy = z.record(z.string(), ids);
const timesBy = z.record(z.string(), z.number());
const count = z.number().int().nonnegative();
const moment = z.number().nullable();

const playerSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  ready: z.boolean(),
  connected: z.boolean(),
  isHost: z.boolean(),
  spawn: spot.nullable(),
});

const creditsSchema = z.looseObject({
  operated: count,
  read: count,
  found: count,
  delivered: count,
  alarms: count,
  hints: count,
});

const awaySchema = z.looseObject({
  since: z.number(),
  waivableAt: z.number(),
  waived: z.boolean(),
  claimUntil: z.number().exactOptional(),
});

const runEventSchema = z.looseObject({
  at: z.number(),
  kind: z.custom<RunEvent['kind']>((value) => typeof value === 'string'),
  label: z.string(),
  seconds: z.number().nullable(),
});

const edgeworkSchema = z.looseObject({
  serial: z.string(),
  indicators: z.array(z.looseObject({ id: z.enum(INDICATOR_IDS), lit: z.boolean() })),
  cells: z.number(),
});

const presenceSchema = z.looseObject({
  stations: idsBy,
  manuals: idsBy,
  notes: idsBy,
  signSeen: ids,
  exit: ids,
  sight: idsBy,
});

const itemSchema = z.looseObject({
  x: z.number(),
  y: z.number(),
  carriedBy: z.string().nullable(),
  delivered: z.boolean(),
});

/** The game as a snapshot carries it (state.ts `GameState`): its mission checked as a file is. */
const gameStateSchema = z.looseObject({
  phase: z.enum(['lobby', 'playing', 'won', 'lost']),
  mission: missionSchema,
  difficulty: z.enum(DIFFICULTIES),
  players: z.array(playerSchema),
  currentPuzzleIndex: count,
  puzzleState: typed<PuzzleState>().nullable(),
  seed: z.number().nullable(),
  roomSeed: z.number().nullable(),
  dailyOn: z.boolean(),
  daily: z.string().nullable(),
  runs: count,
  edgework: edgeworkSchema.nullable(),
  pressedPlates: ids,
  occupiedPanels: ids,
  presence: presenceSchema,
  places: z.record(z.string(), spot),
  opened: ids,
  found: idsBy,
  discoveries: z.record(
    z.string(),
    z.array(z.looseObject({ key: z.string(), at: z.number(), chime: z.boolean() })),
  ),
  notesRead: z.array(z.number()),
  credits: z.record(z.string(), creditsSchema),
  readersCredited: ids,
  sabotage: z
    .looseObject({ endsAt: z.number(), emergency: typed<RelayState>().exactOptional() })
    .nullable(),
  paused: z.looseObject({ since: z.number(), kind: z.enum(['away', 'wartung']) }).nullable(),
  away: z.record(z.string(), awaySchema),
  drops: count,
  calledOff: z.string().nullable(),
  items: z.record(z.string(), itemSchema),
  events: z.array(runEventSchema),
  startedAt: moment,
  introDone: ids,
  lightsOutAt: moment,
  lightsDueAt: moment,
  deadlineAt: moment,
  finishedAt: moment,
  penaltySeq: count,
  lastPenaltySec: z.number().nullable(),
  hintsUsed: count,
  hintsRevealed: count,
  hintReadyAt: moment,
  quietSince: moment,
  nudgesGiven: count,
}) satisfies z.ZodType<GameState>;

const seatSchema = z.looseObject({
  playerId: z.string(),
  passId: z.string().regex(/^[0-9a-f]{32}$/),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string(),
}) satisfies z.ZodType<SeatSnapshot>;

const droneRuntimeSchema = z.looseObject({
  target: count,
  x: z.number(),
  y: z.number(),
  facing: z.number(),
  quietUntil: z.number(),
}) satisfies z.ZodType<DroneRuntime>;

const keepingSchema = z.looseObject({
  positions: z.record(
    z.string(),
    z.looseObject({
      x: z.number(),
      y: z.number(),
      facing: z.number(),
      moving: z.boolean(),
      t: z.number().nullable(),
      rt: z.number(),
    }),
  ),
  drones: z.record(z.string(), droneRuntimeSchema).nullable(),
  closedClean: ids,
  askAgainAt: timesBy,
  lastPingAt: timesBy,
  lastChatAt: timesBy,
  signalAllowance: z.record(z.string(), z.looseObject({ left: z.number(), at: z.number() })),
  refusedSteps: count,
}) satisfies z.ZodType<RoomKeeping>;

/**
 * Whether a snapshot's facts are its game's — the mission, the seed, the difficulty, the
 * Tagesschicht — and every seat it binds is a player of it, under the player's name.
 */
function factsAgree(snapshot: Omit<RoomSnapshot, 'keeping' | 'lostPasses'>): boolean {
  const { state } = snapshot;
  const names = new Map(state.players.map((player) => [player.id, player.name]));
  return (
    snapshot.missionId === state.mission.id &&
    snapshot.seed === state.roomSeed &&
    snapshot.difficulty === state.difficulty &&
    snapshot.daily === state.dailyOn &&
    snapshot.seats.every((seat) => names.get(seat.playerId) === seat.name)
  );
}

/**
 * A room's snapshot as it is read back from its seal (server seal.ts), with what the seal says
 * of it (`SealedSnapshot`): every part of it of the shape this build gives it, and its facts
 * its game's. A module's own state — a puzzle's, the relay's — is checked as far as the type it
 * names, and the mission as a mission file is. Snapshots outlive a deploy: a key this build does
 * not know passes through, one a later build drops stays harmless, and a field this build adds
 * needs a default here, or every snapshot of the build before it is refused — and every run on
 * goes with it (server test/fixtures/blackout-snapshot.json holds one of those).
 */
export const sealedSnapshotSchema: z.ZodType<SealedSnapshot> = z
  .looseObject({
    code: z.string().min(1).max(10),
    missionId: z.string().min(1),
    seed: z.number().nullable(),
    difficulty: z.enum(DIFFICULTIES),
    daily: z.boolean(),
    createdAt: z.number(),
    state: gameStateSchema,
    seats: z.array(seatSchema),
    lostPasses: ids,
    keeping: keepingSchema,
    seq: count,
    at: z.number(),
    instance: z.string().min(1),
    final: z.boolean(),
  })
  .refine(factsAgree, 'the snapshot’s facts are not its game’s');
