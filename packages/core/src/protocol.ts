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

export const clientMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create-room'),
    name: z.string().min(1).max(40),
    missionId: z.string().min(1).optional(),
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
  z.object({ kind: z.literal('select-role'), roleId: z.string().min(1) }),
  z.object({ kind: z.literal('select-color'), color: z.string().regex(/^#[0-9a-f]{6}$/i) }),
  z.object({ kind: z.literal('set-ready'), ready: z.boolean() }),
  z.object({ kind: z.literal('switch-mission'), missionId: z.string().min(1) }),
  z.object({ kind: z.literal('select-difficulty'), difficulty: z.enum(DIFFICULTIES) }),
  z.object({ kind: z.literal('start-mission') }),
  /** a move at the open puzzle; its module's input schema checks `input` */
  z.object({ kind: z.literal('puzzle-input'), input: z.unknown() }),
  z.object({ kind: z.literal('request-hint') }),
  z.object({
    kind: z.literal('pos'),
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
]);

/** One row in the lobby browser. */
export interface RoomSummary {
  code: string;
  missionId: string;
  missionTitle: string;
  difficulty: Difficulty;
  phase: Phase;
  players: { name: string; color: string; connected: boolean }[];
  /** how many roles this mission has */
  capacity: number;
  /** seats still open; always 0 once the mission is running */
  free: number;
}

/** What the mission picker needs to know, served via GET /missions. */
export interface MissionInfo {
  id: string;
  title: string;
  subtitle: string;
  roles: string[];
  timeLimitSec: number;
  puzzleCount: number;
  /** tile rows of the map, for the preview thumbnail; empty without a map */
  tiles: string[];
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
  /** null where every role at the station presses a button and nobody reads (button-sync) */
  manualRoleName: string | null;
  /** several names, comma-separated, where every listed role operates (button-sync) */
  operatorRoleName: string;
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
}

export type ServerMessage =
  | { kind: 'joined'; code: string; playerId: string; token: string }
  | { kind: 'view'; view: PlayerView }
  | { kind: 'spectator-view'; view: SpectatorView; code: string }
  | { kind: 'rooms'; rooms: RoomSummary[] }
  | {
      kind: 'positions';
      players: Record<string, PlayerPosition>;
      drones: Record<string, DronePosition>;
    }
  | { kind: 'ping'; playerId: string; x: number; y: number }
  | { kind: 'chat'; playerId: string; phrase: ChatPhrase }
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
