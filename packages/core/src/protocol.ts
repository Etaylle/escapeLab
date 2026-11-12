import { z } from 'zod';
import { CHAT_PHRASE_COUNT } from './chat.js';
import { DIFFICULTIES, type Difficulty } from './difficulty.js';
import { MAX_NOTES } from './notes.js';
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

/**
 * The most a room's sealed snapshot may weigh, in characters (`snapshot`): Blackout's runs to
 * some 30 kB. A room does not send one over it, and a resume carries none over it.
 */
export const SNAPSHOT_MAX = 256 * 1024;

/**
 * The most often a room sends its crew its snapshot, ms (`snapshot`): a server killed outright,
 * with no word to the crew, loses no more of a run than this.
 */
export const SNAPSHOT_EVERY_MS = 2000;

/**
 * A crew pass (Dienstausweis): what binds a seat to the browser profile that holds it — an id
 * and a secret the client mints once and keeps (client pass.ts), both hex. The server keeps the
 * id and a hash of the secret, never the secret itself; whoever shows both sits down on the
 * seat again, from any socket.
 */
export const crewPassSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  secret: z.string().regex(/^[0-9a-f]{64}$/),
});

export type CrewPass = z.infer<typeof crewPassSchema>;

export const clientMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create-room'),
    name: z.string().min(1).max(40),
    pass: crewPassSchema,
    missionId: z.string().min(1).optional(),
    /**
     * pins the room for a repeatable test: its run n (from 0) plays seed + n;
     * the server takes it only with ALLOW_SEED=1
     */
    seed: z.number().int().min(0).max(SEED_MAX).optional(),
    /**
     * the difficulty the room opens on: „entspannt" from a device that has seen no run won
     * yet (client firstRun.ts); normal where left out
     */
    difficulty: z.enum(DIFFICULTIES).optional(),
  }),
  z.object({
    kind: z.literal('join-room'),
    code: z.string().min(1).max(10),
    name: z.string().min(1).max(40),
    pass: crewPassSchema,
  }),
  z.object({ kind: z.literal('spectate'), code: z.string().min(1).max(10) }),
  z.object({ kind: z.literal('list-rooms') }),
  /**
   * back onto the seat the pass holds in the room, from whatever socket this is, with the newest
   * snapshot of the room the page holds (`snapshot`): a server that knows the room no more takes
   * it up again from it, one that knows it leaves it be
   */
  z.object({
    kind: z.literal('resume'),
    code: z.string().min(1).max(10),
    pass: crewPassSchema,
    blob: z.string().min(1).max(SNAPSHOT_MAX).optional(),
  }),
  /** where the pass sits, for the join screen: answered with `seated` */
  z.object({ kind: z.literal('whereami'), pass: crewPassSchema }),
  /** the seat the pass holds in the room given up for good, from whatever socket this is */
  z.object({
    kind: z.literal('abandon'),
    code: z.string().min(1).max(10),
    pass: crewPassSchema,
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
  /** the host's switch for the Tagesschicht in the lobby: the day's seed for every crew */
  z.object({ kind: z.literal('set-daily'), daily: z.boolean() }),
  z.object({ kind: z.literal('start-mission') }),
  /** the player has seen enough of the intro: the skip of the opening on their screen */
  z.object({ kind: z.literal('intro-done') }),
  /** a move at the open puzzle; its module's input schema checks `input` */
  z.object({ kind: z.literal('puzzle-input'), input: z.unknown() }),
  z.object({ kind: z.literal('request-hint') }),
  /** search the locker or unlock the cabinet the player stands at */
  z.object({ kind: z.literal('open-source'), manualId: z.string().min(1) }),
  /** read the note of the last shift the player stands at, by its index among the map's notes */
  z.object({
    kind: z.literal('read-note'),
    note: z
      .number()
      .int()
      .min(0)
      .max(MAX_NOTES - 1),
  }),
  z.object({
    kind: z.literal('pos'),
    /** the run the client plays, by its `startedAt`: a position from another run is dropped */
    run: z.number().finite(),
    x: z.number().finite().min(-10).max(500),
    y: z.number().finite().min(-10).max(500),
    /** facing angle in radians */
    facing: z.number().finite(),
    moving: z.boolean(),
    /**
     * when the position was true, epoch ms by the sender's own clock: the frame it was walked
     * in. The server relays it unread beside its own receive time (`RelayedPosition`)
     */
    t: z.number().finite(),
  }),
  z.object({
    kind: z.literal('ping'),
    x: z.number().finite().min(-10).max(500),
    y: z.number().finite().min(-10).max(500),
  }),
  /**
   * E where the player stands as they press it — with the frame it was walked in, as a `pos`
   * carries it: the server judges the press there (within reason of where it has them)
   */
  z.object({
    kind: z.literal('interact'),
    x: z.number().finite().min(-10).max(500),
    y: z.number().finite().min(-10).max(500),
    t: z.number().finite(),
  }),
  z.object({ kind: z.literal('drop-item') }),
  /**
   * a quick-chat phrase by its place in the mission's list (chat.ts), and what its slot is
   * filled with, where it has one: the server says it filled in
   */
  z.object({
    kind: z.literal('chat'),
    phrase: z
      .number()
      .int()
      .min(0)
      .max(CHAT_PHRASE_COUNT - 1),
    value: z.string().min(1).max(16).optional(),
  }),
  z.object({ kind: z.literal('back-to-lobby') }),
  z.object({ kind: z.literal('rematch') }),
  /** on without the crew member away by id, once the wait for their drop is over */
  z.object({ kind: z.literal('continue-without'), absentId: z.string().min(1).max(64) }),
  /** the run called off by the one crew member still on the line, once the wait is over */
  z.object({ kind: z.literal('call-off') }),
  /** a new device's ask to take the seat of `seat` over: let in, or refused */
  z.object({
    kind: z.literal('takeover-answer'),
    seat: z.string().min(1).max(64),
    allow: z.boolean(),
  }),
  /** a voice signal for one other member of the room, by id */
  z.object({ kind: z.literal('rtc'), to: z.string().min(1).max(64), signal: rtcSignalSchema }),
  /**
   * asks the server for its time; `sent` is the page's own clock as it asked (ms), handed back
   * with the answer — whatever the page's clock says, the server only echoes it
   */
  z.object({ kind: z.literal('clock'), sent: z.number().finite() }),
  /**
   * the answer to the server's `tick`, sent as it comes in: the page's message handler runs
   * where its timers are held back (a tab long hidden), so the line counts as alive
   */
  z.object({ kind: z.literal('tock') }),
]);

/**
 * Where a crew pass sits, as its join screen shows it (`whereami`): the room by its code, the
 * mission, whether the run is on — it binds the pass while it runs or stands paused — the crew
 * by name in the order they joined, and what the mission's clock showed as the server answered.
 */
export interface Seat {
  code: string;
  missionTitle: string;
  /** 'lobby' before the run; 'playing' while it runs or stands paused */
  phase: 'lobby' | 'playing';
  paused: boolean;
  crew: string[];
  /** ms left on the mission's clock as the server answered; null before the clock started */
  leftMs: number | null;
}

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
  /** an older map kept on (`Mission['stage']`); left out for a current mission */
  stage?: 'prototype';
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

/**
 * A player's position as the server relays it: when it was true by the sender's own clock
 * (`t`; null for one the server placed itself, a spawn) and when the server took it (`rt`, the
 * server's clock). The spacing of the `t`s is the walk's own; the `rt`s tie them to the
 * server's clock — a partner is drawn on that timeline (client world/trail.ts).
 */
export interface RelayedPosition extends PlayerPosition {
  t: number | null;
  rt: number;
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

/**
 * What the server says. A view carries the server's time as it went out (`at`, epoch ms by the
 * server's clock): every moment a view names is on that clock.
 */
export type ServerMessage =
  /** the socket sits on its seat in room `code`: its pass holds it, the views say whose it is */
  | { kind: 'joined'; code: string }
  /**
   * the pass sits on its seat in room `code` no more, or this socket does not: the seat was
   * given up (`abandon`; `message` null), or it plays on another socket that showed its pass,
   * a tab opened later say — `message` says so
   */
  | { kind: 'left'; code: string; message: string | null }
  /** the answer to `whereami`: where the pass sits; null where it sits nowhere it is bound to */
  | { kind: 'seated'; seat: Seat | null }
  /**
   * a join by the name of a seat whose line is down waits for the crew on the line to let this
   * device in, until `until` (epoch ms): answered by `takeover-allowed`, or a refusal
   */
  | { kind: 'takeover-pending'; code: string; name: string; until: number }
  /** the crew let this device in: its pass holds the seat now, and it resumes it (`resume`) */
  | { kind: 'takeover-allowed'; code: string }
  | { kind: 'view'; view: PlayerView; at: number }
  | { kind: 'spectator-view'; view: SpectatorView; code: string; at: number }
  /** the answer to a `clock` ask: the page's `sent` handed back, and the server's time (`at`) */
  | { kind: 'clock'; sent: number; at: number }
  /**
   * the server's beat, every 10 s on every socket, answered at once with a `tock`: each side
   * hears the other while nothing else is said
   */
  | { kind: 'tick' }
  /** E was taken: what it did is in the views that came before this */
  | { kind: 'interacted' }
  /**
   * the room as of `at`, sealed (server seal.ts) — `seq` its dispatches so far, the newer the
   * higher: the page keeps the newest of its room and hands it back with every `resume`, so that a
   * server that knows the room no more, after a deploy or a restart, takes it up again
   */
  | { kind: 'snapshot'; blob: string; seq: number; at: number }
  | { kind: 'rooms'; rooms: RoomSummary[] }
  | {
      kind: 'positions';
      /** the run these positions belong to, by its `startedAt` */
      run: number | null;
      players: Record<string, RelayedPosition>;
      drones: Record<string, DronePosition>;
    }
  | { kind: 'ping'; playerId: string; x: number; y: number }
  /** a quick-chat phrase somebody said, its slot filled in: „Kabel 3" */
  | { kind: 'chat'; playerId: string; text: string }
  /** a voice signal from another member of the room, as they sent it */
  | { kind: 'rtc'; from: string; signal: RtcSignal }
  /** a refusal, and the kind of message it refuses (`of`) — left out where none could be read */
  | { kind: 'error'; message: string; of?: ClientMessage['kind'] };

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
