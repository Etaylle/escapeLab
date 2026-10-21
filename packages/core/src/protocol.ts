import { z } from 'zod';
import { CHAT_PHRASE_IDS, type ChatPhrase } from './chat.js';
import { DIFFICULTIES, type Difficulty } from './difficulty.js';
import type { ManualSection } from './puzzles/module.js';
import type { Phase } from './state.js';
import type { PlayerView, SpectatorView } from './view.js';

/**
 * WebSocket protocol, shared by server and client. Every inbound message is
 * zod-validated on the server before it touches game logic.
 */

/** The most a voice signal may weigh as JSON, in characters: an audio offer runs to a few kB. */
export const RTC_SIGNAL_MAX = 16 * 1024;

const sdpSchema = z.string().min(1).max(RTC_SIGNAL_MAX);

/**
 * A WebRTC signal for the crew's push-to-talk (client/src/voice): an offer or
 * an answer with its session description, or one ICE candidate. The server
 * checks its shape and weight and relays it to one member of the room, unread.
 */
export const rtcSignalSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('offer'), sdp: sdpSchema }),
    z.object({ type: z.literal('answer'), sdp: sdpSchema }),
    z.object({
      type: z.literal('ice'),
      candidate: z.object({
        candidate: z.string().max(RTC_SIGNAL_MAX),
        sdpMid: z.string().max(64).nullable().optional(),
        sdpMLineIndex: z.number().int().min(0).max(1024).nullable().optional(),
        usernameFragment: z.string().max(256).nullable().optional(),
      }),
    }),
  ])
  .refine((signal) => JSON.stringify(signal).length <= RTC_SIGNAL_MAX);

export type RtcSignal = z.infer<typeof rtcSignalSchema>;

/** The largest seed a room can be pinned to: a seed is 32 bits wide, as the PRNG takes it. */
export const SEED_MAX = 0xffff_ffff;

export const clientMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create-room'),
    name: z.string().min(1).max(40),
    missionId: z.string().min(1).optional(),
    /**
     * pins the room for a repeatable test: its run n (from 0) plays seed + n;
     * the server takes it only with ALLOW_SEED=1
     */
    seed: z.number().int().min(0).max(SEED_MAX).optional(),
  }),
  z.object({
    kind: z.literal('join-room'),
    code: z.string().min(1).max(10),
    name: z.string().min(1).max(40),
  }),
  z.object({ kind: z.literal('spectate'), code: z.string().min(1).max(10) }),
  z.object({ kind: z.literal('list-rooms') }),
  z.object({
    kind: z.literal('resume'),
    code: z.string().min(1).max(10),
    playerId: z.string().min(1),
    token: z.string().min(1),
  }),
  z.object({ kind: z.literal('select-color'), color: z.string().regex(/^#[0-9a-f]{6}$/i) }),
  /**
   * yes or no to the next run; between runs the host's yes may name the
   * mission it plays, by catalog id — without one it is the same again
   */
  z.object({
    kind: z.literal('set-ready'),
    ready: z.boolean(),
    missionId: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal('switch-mission'), missionId: z.string().min(1) }),
  z.object({ kind: z.literal('select-difficulty'), difficulty: z.enum(DIFFICULTIES) }),
  z.object({ kind: z.literal('start-mission') }),
  /** a move at the open puzzle; its module's input schema checks `input` */
  z.object({ kind: z.literal('puzzle-input'), input: z.unknown() }),
  z.object({ kind: z.literal('request-hint') }),
  /** search the locker or unlock the cabinet the player stands at */
  z.object({ kind: z.literal('open-source'), manualId: z.string().min(1) }),
  z.object({
    kind: z.literal('pos'),
    /** the run the client plays, by its `startedAt`: a position from another run is dropped */
    run: z.number().finite(),
    x: z.number().finite().min(-10).max(500),
    y: z.number().finite().min(-10).max(500),
    /** facing angle in radians */
    facing: z.number().finite(),
    moving: z.boolean(),
  }),
  z.object({
    kind: z.literal('ping'),
    x: z.number().finite().min(-10).max(500),
    y: z.number().finite().min(-10).max(500),
  }),
  z.object({ kind: z.literal('interact') }),
  z.object({ kind: z.literal('drop-item') }),
  z.object({
    kind: z.literal('chat'),
    phrase: z.enum(CHAT_PHRASE_IDS as [ChatPhrase, ...ChatPhrase[]]),
  }),
  z.object({ kind: z.literal('back-to-lobby') }),
  z.object({ kind: z.literal('rematch') }),
  /** a voice signal for one other member of the room, by id */
  z.object({ kind: z.literal('rtc'), to: z.string().min(1).max(64), signal: rtcSignalSchema }),
]);

/** One row in the lobby browser. */
export interface RoomSummary {
  code: string;
  missionId: string;
  missionTitle: string;
  difficulty: Difficulty;
  phase: Phase;
  players: { name: string; color: string; connected: boolean }[];
  /** the most players this mission takes */
  capacity: number;
  /** seats still open; always 0 once the mission is running */
  free: number;
}

/** What the mission picker needs to know, served via GET /missions. */
export interface MissionInfo {
  id: string;
  title: string;
  subtitle: string;
  /** how many play it; a run starts with any count from min to max */
  players: { min: number; max: number };
  timeLimitSec: number;
  puzzleCount: number;
  /** tile rows of the map, for the preview thumbnail */
  tiles: string[];
  /** made in the editor and kept in missions/custom/; left out for the shipped missions */
  custom?: boolean;
}

/**
 * The id of a mission made in the editor: „custom-" and a slug of lower-case
 * letters and digits in dash-separated words, 64 characters at most. It is
 * the file name under missions/custom/ as well, so nothing else may pass.
 */
export function isCustomMissionId(id: string): boolean {
  return id.length <= 64 && /^custom(?:-[a-z0-9]+)+$/.test(id);
}

/**
 * A mission's printed Handbuch, served via GET /missions/:id/manual. The
 * same for every run and every difficulty, so it can be handed out on paper.
 */
export interface MissionManual {
  missionTitle: string;
  /** seconds a hint costs at difficulty `normal` */
  hintCostSec: number;
  /** one per puzzle, in mission order */
  stations: MissionManualStation[];
}

export interface MissionManualStation {
  /** position in the mission from 0, like `currentPuzzleIndex` */
  index: number;
  title: string;
  /** labels of the manual objects in the lab that print these rules; none where nobody reads */
  readAt: string[];
  usesEdgework: boolean;
  manual: ManualSection[];
}

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface PlayerPosition {
  x: number;
  y: number;
  facing: number;
  moving: boolean;
}

export interface DronePosition {
  x: number;
  y: number;
  facing: number;
  range: number;
  halfAngleDeg: number;
  /** true for a moment after it caught someone */
  alerted: boolean;
  /** held still by its plate: it neither moves nor sees */
  frozen: boolean;
}

export type ServerMessage =
  | { kind: 'joined'; code: string; playerId: string; token: string }
  | { kind: 'view'; view: PlayerView }
  | { kind: 'spectator-view'; view: SpectatorView; code: string }
  | { kind: 'rooms'; rooms: RoomSummary[] }
  | {
      kind: 'positions';
      /** the run these positions belong to, by its `startedAt` */
      run: number | null;
      players: Record<string, PlayerPosition>;
      drones: Record<string, DronePosition>;
    }
  | { kind: 'ping'; playerId: string; x: number; y: number }
  | { kind: 'chat'; playerId: string; phrase: ChatPhrase }
  /** a voice signal from another member of the room, as they sent it */
  | { kind: 'rtc'; from: string; signal: RtcSignal }
  | { kind: 'error'; message: string };

export function parseClientMessage(raw: string): ClientMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Nachricht ist kein gültiges JSON.');
  }
  const result = clientMessageSchema.safeParse(data);
  if (!result.success) {
    throw new Error('Unbekanntes Nachrichtenformat.');
  }
  return result.data;
}
