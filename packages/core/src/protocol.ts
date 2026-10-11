import { z } from 'zod';
import type { PlayerView } from './view.js';

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
  z.object({
    kind: z.literal('resume'),
    code: z.string().min(1).max(10),
    playerId: z.string().min(1),
    token: z.string().min(1),
  }),
  z.object({ kind: z.literal('select-role'), roleId: z.string().min(1) }),
  z.object({ kind: z.literal('select-color'), color: z.string().regex(/^#[0-9a-f]{6}$/i) }),
  z.object({ kind: z.literal('switch-mission'), missionId: z.string().min(1) }),
  z.object({ kind: z.literal('start-mission') }),
  z.object({ kind: z.literal('press-button') }),
  z.object({ kind: z.literal('cut-wire'), wireId: z.string().min(1) }),
  z.object({ kind: z.literal('press-key'), keyIndex: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('toggle-switch'), switchIndex: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('commit-switches') }),
  z.object({ kind: z.literal('press-simon'), buttonIndex: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('move-maze'), dir: z.number().int().min(0).max(3) }),
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
  z.object({ kind: z.literal('back-to-lobby') }),
]);

/** What the mission picker needs to know, served via GET /missions. */
export interface MissionInfo {
  id: string;
  title: string;
  subtitle: string;
  roles: string[];
  timeLimitSec: number;
  puzzleCount: number;
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
  | {
      kind: 'positions';
      players: Record<string, PlayerPosition>;
      drones: Record<string, DronePosition>;
    }
  | { kind: 'ping'; playerId: string; x: number; y: number }
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
