import type { Difficulty } from './difficulty.js';
import type { RelayedPosition } from './protocol.js';
import type { GameState } from './state.js';

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
 * connections. Left out: the connections themselves; a new device's ask for a seat, which
 * lapses with its device; the glances of the crew's lamps, since a look begun before a pause
 * starts anew after it; the mission the host's yes named for the next run, which only the end
 * of a run has, and no ended run is taken up again; and whatever the timers and the stream of
 * positions work out anew from the game and from what is kept here.
 */
export interface RoomKeeping {
  /** where every member of the crew stands, by player id */
  positions: Record<string, RelayedPosition>;
  /** each patrolling drone on its loop, by drone id; null while none patrols */
  drones: Record<string, DroneRuntime> | null;
  /** epoch ms the patrols last moved */
  lastDroneTick: number;
  /** epoch ms each seat's line closed, by player id: every seat's line is closed in a snapshot */
  lostAt: Record<string, number>;
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
