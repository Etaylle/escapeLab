import { randomInt, randomUUID } from 'node:crypto';
import { DronePatrol } from './drones.js';
import { SeatBook } from './seats.js';
import type { FinishedRun } from './store/store.js';
import {
  applyAction,
  armedStations,
  canSee,
  clockCallDueAt,
  consoleFind,
  crewOf,
  dailySeed,
  emergenciesDue,
  findKey,
  findables,
  foundBy,
  GameError,
  inSight,
  inEscapePhase,
  initialState,
  labLit,
  lightsAreOut,
  lookAround,
  noteKey,
  noteSpot,
  nudgeDueAt,
  phrasesOf,
  puzzleDueAt,
  runReport,
  runSeconds,
  sayPhrase,
  SNAPSHOT_EVERY_MS,
  SNAPSHOT_LIVE_MS,
  SNAPSHOT_MAX,
  shutDoors,
  sightables,
  stationKey,
  stepAllowed,
  TAKEOVER_WAIT_MS,
  utcDay,
  viewFor,
  viewForSpectator,
  type Action,
  type ClientMessage,
  type CrewPass,
  type DailyStart,
  type Difficulty,
  type Findable,
  type FindKey,
  type GameState,
  type Glances,
  type Look,
  type MapDef,
  type Mission,
  type PlayerPosition,
  type RelayedPosition,
  type Phase,
  type RoomSummary,
  type RoomSnapshot,
  type RtcSignal,
  type RunReport,
  type Seat,
  type ServerMessage,
} from '@escapelab/core';

type Listener = (msg: ServerMessage) => void;

/**
 * Hears of every run that ends in a room, won or lost: the run's report, and the pass that held
 * each seat of its crew as it ended (store/store.ts).
 */
export type RunListener = (run: FinishedRun) => void;

/**
 * The kinds of client message that map 1:1 onto game actions (`act`). A yes to
 * the next run may name a mission from the catalog: that one goes through
 * `setReady`, which takes the mission already found.
 */
export const GAME_KINDS = [
  'select-color',
  'set-daily',
  'start-mission',
  'intro-done',
  'puzzle-input',
  'request-hint',
  'open-source',
  'read-note',
  'drop-item',
  'back-to-lobby',
  'rematch',
  'continue-without',
  'call-off',
] as const satisfies readonly ClientMessage['kind'][];

/** A client message that maps 1:1 onto a game action (`GAME_KINDS`). */
export type GameMessage = Extract<ClientMessage, { kind: (typeof GAME_KINDS)[number] }>;

/** The game messages whose action is no more than who sent them and when. */
const BARE_KINDS = [
  'intro-done',
  'request-hint',
  'call-off',
] as const satisfies readonly GameMessage['kind'][];

/** A game message whose action is no more than who sent it and when (`BARE_KINDS`). */
type BareMessage = Extract<GameMessage, { kind: (typeof BARE_KINDS)[number] }>;

const BARE: ReadonlySet<GameMessage['kind']> = new Set(BARE_KINDS);

const isBare = (msg: GameMessage): msg is BareMessage => BARE.has(msg.kind);

/** A plate holds while someone is this close (in tiles); releases a bit wider. */
const PLATE_PRESS_RADIUS = 0.55;
const PLATE_RELEASE_RADIUS = 0.75;
/** A player is at a station, a manual object or the sign this close (in tiles); leaves wider. */
const PRESENCE_ENTER_RADIUS = 1.6;
const PRESENCE_LEAVE_RADIUS = 2.0;

/** How close to the armed station an interact is accepted. */
const INTERACT_RADIUS = 1.6;
/**
 * How far from where the room has a player, in tiles, the spot they pressed E on may lie and
 * still be taken: about two of a sprint's position updates.
 */
const PRESS_REACH = 0.5;
/** Everyone must stand on the exit hatch itself (below one tile) to escape. */
const EXIT_RADIUS = 0.7;
/** Positions fan out at most this often. */
const POSITIONS_INTERVAL_MS = 66;
/** …and at least this often while a run is on, whether or not anything moved. */
const POSITIONS_KEEPALIVE_MS = 1000;
/** Minimum gap between two pings from the same player. */
const PING_COOLDOWN_MS = 700;
/** Same idea for quick chat, a little slower so it stays readable. */
const CHAT_COOLDOWN_MS = 1200;
/**
 * Voice signals one member may send at once, and how many more come free
 * each second: a voice link takes an offer or answer and a handful of
 * candidates, and a crew of four sets up three links per player at once.
 */
const SIGNAL_BURST = 60;
const SIGNALS_PER_SEC = 10;
/**
 * Marks of the pause menu one seat may send at once, and how many more come free each second:
 * every mark sends every view, and a page that toggles its menu faster than a hand does is let
 * through no more — its next mark, once the latest view disagrees with its menu, says it again.
 */
const MENU_MARK_BURST = 6;
const MENU_MARKS_PER_SEC = 1;
/** Patrol simulation step. */
const DRONE_TICK_MS = 80;
/** How close you must stand to man an emergency panel. */
const PANEL_RADIUS = 0.8;
/** Reach for picking up and dropping off carryable objects. */
const ITEM_RADIUS = 0.95;
/** A relay emergency's instructions are aged this often. */
const RELAY_TICK_MS = 1000;
/** What a member may still send of something allowed by the second, and when that was worked out. */
interface Allowance {
  left: number;
  /** epoch ms */
  at: number;
}

/**
 * Takes one off `member`'s allowance in `byMember` — `burst` at first, topped up by `perSec` a
 * second to at most `burst` since it was last worked out; false where none is left.
 */
function takeAllowance(
  byMember: Map<string, Allowance>,
  member: string,
  now: number,
  burst: number,
  perSec: number,
): boolean {
  const was = byMember.get(member);
  const left =
    was === undefined ? burst : Math.min(burst, was.left + ((now - was.at) / 1000) * perSec);
  const allowed = left >= 1;
  byMember.set(member, { left: allowed ? left - 1 : left, at: now });
  return allowed;
}

/** What a connection hears once its seat plays on another one: a tab opened later, say. */
const PLAYS_IN_ANOTHER_TAB = 'Dieser Platz spielt jetzt in einem anderen Fenster.';
/** What a pass is told once another device took its seat over by its name. */
const SEAT_TAKEN = 'Der Platz wurde auf einem anderen Gerät übernommen.';

/**
 * How a seat's line ended: dropped — cut, or gone without a word —, closed cleanly by its tab
 * going away (1000, 1001), or closed on purpose for the main menu (`to-menu`), the seat kept.
 */
export type LineEnd = 'dropped' | 'closed' | 'menu';

/** What the log says of a seat's line ending so, by the seat's name. */
const LINE_END_LOG: Readonly<Record<LineEnd, (name: string) => string>> = {
  dropped: (name) => `${name}'s line closed`,
  closed: (name) => `${name}'s line closed, its tab gone`,
  menu: (name) => `${name} left to the main menu, the seat kept`,
};

/** How long a seat in the lobby may stay off the line before the room frees it, ms. */
export const LOBBY_AWAY_MS = 120_000;
/**
 * How long a lobby seat whose socket closed cleanly — its tab closed, or reloaded — waits for
 * its pass to be back before the room frees it, ms: a reload is back well within.
 */
export const LOBBY_GONE_MS = 10_000;

/** What a device is told whose ask for a seat the crew did not let in. */
// voice: interface — the room's refusal, not the lab's, names the crew
const CLAIM_REFUSED = 'Die Crew hat die Übernahme nicht bestätigt.';

/**
 * How long a device whose ask for a seat the crew turned away, or left unanswered, waits before
 * it may ask for that seat again, ms: no card pops up again and again for the crew.
 */
export const ASK_AGAIN_MS = 60_000;

/**
 * Seals a snapshot of the room for its crew to keep (seal.ts) — `final`, the room's last on this
 * server instance, as it goes down for a restart (`goDown`): the blob it goes out as.
 */
export type Sealer = (snapshot: RoomSnapshot, final: boolean) => string;

/**
 * How long after a room is taken up again from a snapshot a newer snapshot, handed in by a page
 * coming back, still replaces its game, ms (`replaceFrom`) — unless the crew did something first.
 */
export const RESTORE_WINDOW_MS = 10_000;

/**
 * What the room dispatches of its own as lines come and go — the seats on and off the line, who
 * stands where, the maintenance pause: none of it is the crew's deed, so none of it ends the
 * window in which a newer snapshot replaces a room just taken up again.
 */
const LINE_ACTIONS: ReadonlySet<Action['type']> = new Set([
  'player-connected',
  'player-disconnected',
  'set-presence',
  'set-occupancy',
  'set-menu',
  'maintenance',
]);

/**
 * What the room dispatches of where the crew stands, as it walks, and of a pause menu opened or
 * closed: no snapshot goes out for it on its own — a run whose clock runs sends one every
 * SNAPSHOT_LIVE_MS, where everybody stands with it.
 */
const PRESENCE_ACTIONS: ReadonlySet<Action['type']> = new Set([
  'set-presence',
  'set-occupancy',
  'set-menu',
]);

/** A new device's ask for a seat by its name: the pass it brings, whom to tell, its timer. */
interface Claim {
  pass: CrewPass;
  tell: Listener;
  timer: NodeJS.Timeout;
}

/**
 * How an ask for a seat ends: let in, refused by a member of the crew, left unanswered, void —
 * the seat back on its line, gone, or the run over — or withdrawn, its device gone.
 */
type ClaimEnd = 'allowed' | 'refused' | 'unanswered' | 'back' | 'over' | 'withdrawn';

/** How an ask ends that makes its device wait to ask again (ASK_AGAIN_MS): turned away. */
const TURNED_AWAY: ReadonlySet<ClaimEnd> = new Set(['refused', 'unanswered']);

/** The key a pass's wait to ask for a seat again goes by: the seat's player id and the pass's. */
const askKey = (seatId: string, pass: CrewPass): string => `${seatId}:${pass.id}`;

/** What the log says of a seat whose ask ended so (`ClaimEnd`). */
const CLAIM_LOG: Record<ClaimEnd, string> = {
  allowed: 'taken over by another device, let in',
  refused: 'kept from another device',
  unanswered: `kept from another device, unanswered for ${TAKEOVER_WAIT_MS / 1000} s`,
  back: 'kept from another device, back on its line',
  over: 'kept from another device, the seat gone or the run over',
  withdrawn: 'kept from another device that went away',
};

/** What the asking device is told of an ask that let it not in (`ClaimEnd`). */
function claimRefusal(how: ClaimEnd, name: string): string {
  if (how === 'back') {
    return `${name} ist wieder verbunden.`;
  }
  return how === 'over' ? 'Dieser Platz ist nicht mehr zu übernehmen.' : CLAIM_REFUSED;
}

/** A stretch of time in seconds, as the log says it: `12.3 s`. */
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** Who stands where and what they found and see, as the room reports it in `set-presence`. */
type PresenceReport = Omit<Extract<Action, { type: 'set-presence' }>, 'type' | 'at'>;

/** Whose views a change reaches: every member's and the audience's, or only these members'. */
type Reach = 'everybody' | readonly string[];

/** `map` holding what `record` holds, and nothing else. */
function refill<V>(map: Map<string, V>, record: Readonly<Record<string, V>>): void {
  map.clear();
  for (const [key, value] of Object.entries(record)) {
    map.set(key, value);
  }
}

/**
 * `byId` — who stands at each thing, by its id — with only the players `found(id)` lets count
 * there; a thing nobody counts at is left out.
 */
function onlyFinders(
  byId: Record<string, string[]>,
  found: (id: string) => (playerId: string) => boolean,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(byId)
      .map(([id, players]) => [id, players.filter(found(id))] as const)
      .filter(([, players]) => players.length > 0),
  );
}

/**
 * One game room: owns the authoritative GameState, its seats — each bound to the crew pass
 * that sat down on it (seats.ts) — the mission timer and the live avatar positions.
 * Movement is client-authoritative within limits: the room takes only steps
 * an avatar can walk, turns positions into plate state and presence and
 * validates interaction distance. Every run that ends goes to
 * `onRunFinished` as a report. Transport-agnostic.
 */
export class Room {
  readonly code: string;
  private state: GameState;
  private readonly seats = new SeatBook();
  private readonly listeners = new Map<string, Listener>();
  /** audience connections, by the id each got on attaching */
  private readonly spectators = new Map<string, Listener>();
  private readonly positions = new Map<string, RelayedPosition>();
  private readonly lastPingAt = new Map<string, number>();
  private readonly lastChatAt = new Map<string, number>();
  /** each member's voice signals still allowed, and when that was last worked out (epoch ms) */
  private readonly signalAllowance = new Map<string, Allowance>();
  /** each seat's marks of its pause menu still allowed (`MENU_MARK_BURST`) */
  private readonly menuAllowance = new Map<string, Allowance>();
  private drones: DronePatrol | null = null;
  private droneTimer: NodeJS.Timeout | null = null;
  private lastDroneTick = 0;
  private sabotageTimer: NodeJS.Timeout | null = null;
  private relayTimer: NodeJS.Timeout | null = null;
  /** ends a mission's intro: the lights go out when the state says they are due */
  private lightsTimer: NodeJS.Timeout | null = null;
  /** ticks the open puzzle when something of it runs out on the clock: a sync press */
  private puzzleTimer: NodeJS.Timeout | null = null;
  /** lets mission control speak up once the station that is up has stayed quiet */
  private nudgeTimer: NodeJS.Timeout | null = null;
  /** lets mission control call the time left as the clock comes down to the next call */
  private clockCallTimer: NodeJS.Timeout | null = null;
  /**
   * since when each thing has stood in each player's lamp cone, by player id
   * (core discovery.ts): a look held long enough finds it
   */
  private readonly glances = new Map<string, Glances>();
  /** looks round again once the next glance has been held long enough, nobody moving meanwhile */
  private glanceTimer: NodeJS.Timeout | null = null;
  /** the mission the host's yes on the end screen named for the next run; null: the same again */
  private next: Mission | null = null;
  private timer: NodeJS.Timeout | null = null;
  private positionsTimer: NodeJS.Timeout | null = null;
  /** a new sample, a refused step or a drone that moved since the positions last went out */
  private positionsDirty = false;
  /** sends the positions again once a second of a run has gone by without them */
  private keepaliveTimer: NodeJS.Timeout | null = null;
  /** the drones as the positions last carried them, to tell whether one has moved since */
  private dronesSent = '{}';
  /** steps refused in this room so far, for the log */
  private refusedSteps = 0;
  /** when each seat's line closed, by player id, for the log to say how long it was away */
  private readonly lostAt = new Map<string, number>();
  /** frees each lobby seat whose line has been down LOBBY_AWAY_MS, by player id */
  private readonly freeing = new Map<string, NodeJS.Timeout>();
  /** the seats whose socket closed cleanly, a tab closed or reloaded, by player id */
  private readonly closedClean = new Set<string>();
  /** the asks of new devices for seats whose line is down, by the seat's player id */
  private readonly claims = new Map<string, Claim>();
  /** until when a pass may not ask for a seat again, by seat and pass (`askKey`), epoch ms */
  private readonly askAgainAt = new Map<string, number>();
  /** epoch ms the room was opened; a room taken up again keeps its own (`restore`) */
  private opened = Date.now();
  /** the dispatches so far: a snapshot carries it, and the later of two has the higher */
  private seq = 0;
  /** sends the crew a snapshot after a dispatch, SNAPSHOT_EVERY_MS after the last at the soonest */
  private snapshotTimer: NodeJS.Timeout | null = null;
  /** sends the crew a snapshot of a run whose clock runs, SNAPSHOT_LIVE_MS after the last */
  private liveTimer: NodeJS.Timeout | null = null;
  /** epoch ms the crew was last sent a snapshot */
  private snapshotSentAt = 0;
  /** what the last snapshot sent held, its moment apart (`changedSinceSent`); null for none */
  private sentContent: string | null = null;
  /** the server goes down (`goDown`): its last snapshot of the room sent, no other goes out */
  private goneDown = false;
  /** whether the log said a snapshot was too big to send: it says so once */
  private tooBigSaid = false;
  /**
   * epoch ms the room was taken up again from a snapshot, while a newer one may still replace its
   * game (`replaceFrom`); null for a room never taken up, or once the crew did something in it
   */
  private restoredAt: number | null = null;
  /** the seq of the snapshot the room was last taken up again from; null: never taken up */
  private restoredSeq: number | null = null;
  /**
   * the seats whose line has been up since the room was opened, or taken up again from a
   * snapshot (`restore`), by player id: only these bind their pass to the room (`binds`)
   */
  private readonly seenOnLine = new Set<string>();
  /** epoch ms since the room has had no connected players, null while occupied */
  emptySince: number | null = null;

  /**
   * `seed` pins the room's runs for a repeatable test: run n plays seed + n. `mission` comes
   * scaled to `difficulty`, the one the room opens on. `dailySalt` (dailySalt.ts) makes the
   * Tagesschicht's seeds; a room without one starts no run on it. With a `sealer` the crew is
   * sent the room's snapshot after its dispatches (`scheduleSnapshot`); without, none.
   */
  constructor(
    code: string,
    mission: Mission,
    private readonly onRunFinished: RunListener = () => undefined,
    seed: number | null = null,
    difficulty: Difficulty = 'normal',
    private readonly dailySalt: string | null = null,
    private readonly sealer: Sealer | null = null,
  ) {
    this.code = code;
    this.state = initialState(mission, seed, difficulty);
  }

  /**
   * The room `snapshot` keeps, taken up again at `now` (`snapshot`): the game as it stood — a
   * run standing still for the whole crew, every seat off the line, and whoever was on the line
   * as it was taken waited for, not to be gone on without before FIRST_WAIT_MS from now (core
   * `maintenance`); whoever was away then stays away as before — every seat bound to its pass
   * again, and whatever the room kept beside the game. Its timers run again from the due times
   * the game and what it kept say: a run's once the pause is over, the lobby's seats' at once.
   * Nobody is on the line yet: the room is empty from `now`. `ties` are what the constructor
   * takes besides the game.
   */
  static restore(
    snapshot: RoomSnapshot,
    now: number,
    ties: { onRunFinished?: RunListener; dailySalt?: string | null; sealer?: Sealer | null } = {},
  ): Room {
    const { mission, roomSeed, difficulty } = snapshot.state;
    const { onRunFinished, dailySalt = null, sealer = null } = ties;
    const room = new Room(
      snapshot.code,
      mission,
      onRunFinished,
      roomSeed,
      difficulty,
      dailySalt,
      sealer,
    );
    room.load(snapshot, now);
    room.restoredAt = now;
    room.restoredSeq = snapshot.seq;
    return room;
  }

  /**
   * Everything a server needs to take this room up again (`restore`), as of `now` (core
   * snapshot.ts): the room's facts, the game — a run standing still for the whole crew from now,
   * waiting for whoever is on the line now — and its seats, and what the room keeps beside the
   * game. The room itself goes on as it was.
   */
  snapshot(now = Date.now()): RoomSnapshot {
    const { state } = this;
    const seats = this.seats.snapshot();
    return {
      code: this.code,
      missionId: state.mission.id,
      seed: state.roomSeed,
      difficulty: state.difficulty,
      daily: state.dailyOn,
      createdAt: this.opened,
      state: applyAction(state, { type: 'maintenance', at: now, waitFrom: now }),
      seats: seats.bound.map((seat) => ({ ...seat, name: this.nameOf(seat.playerId) })),
      lostPasses: seats.lost,
      keeping: {
        positions: Object.fromEntries(this.positions),
        drones: this.drones?.runtimeOf() ?? null,
        closedClean: [...this.closedClean],
        askAgainAt: Object.fromEntries(this.askAgainAt),
        lastPingAt: Object.fromEntries(this.lastPingAt),
        lastChatAt: Object.fromEntries(this.lastChatAt),
        signalAllowance: Object.fromEntries(this.signalAllowance),
        refusedSteps: this.refusedSteps,
      },
      seq: this.seq,
      at: now,
    };
  }

  /** The room `snapshot` keeps, in place of this one's, taken up at `now` (`restore`). */
  private load(snapshot: RoomSnapshot, now: number): void {
    const { keeping } = snapshot;
    this.opened = snapshot.createdAt;
    this.seq = snapshot.seq;
    this.state = applyAction(snapshot.state, {
      type: 'maintenance',
      at: snapshot.at,
      waitFrom: now,
    });
    this.seats.restore(snapshot.seats, snapshot.lostPasses);
    refill(this.positions, keeping.positions);
    // Every seat off the line from now, as the room takes it: a lobby seat's wait counts neither
    // the downtime nor how long the lobby stood quiet before. A run keeps its drops in the game
    // (core `maintenance`).
    refill(this.lostAt, Object.fromEntries(this.state.players.map((p) => [p.id, now])));
    refill(this.askAgainAt, keeping.askAgainAt);
    refill(this.lastPingAt, keeping.lastPingAt);
    refill(this.lastChatAt, keeping.lastChatAt);
    refill(this.signalAllowance, keeping.signalAllowance);
    this.closedClean.clear();
    keeping.closedClean.forEach((playerId) => this.closedClean.add(playerId));
    this.refusedSteps = keeping.refusedSteps;
    const { map } = this.state.mission;
    this.drones = keeping.drones === null ? null : DronePatrol.resume(map, keeping.drones);
    this.emptySince = this.listeners.size === 0 ? now : null;
    this.reconcileClocks();
    this.reconcileLobbyAway();
  }

  /**
   * An action of `type` dispatched: one the crew did — not a line coming or going, nor where it
   * stands (LINE_ACTIONS) — and a newer snapshot no longer replaces the room's game.
   */
  private noteDeed(type: Action['type']): void {
    if (!LINE_ACTIONS.has(type)) {
      this.restoredAt = null;
    }
  }

  /**
   * Whether a newer snapshot may still replace the room's game at `now` (`replaceFrom`): within
   * RESTORE_WINDOW_MS of its restore, and before the crew did anything in it.
   */
  private takesSnapshots(now: number): boolean {
    return this.restoredAt !== null && now < this.restoredAt + RESTORE_WINDOW_MS;
  }

  /**
   * The seq of the snapshot the room was last taken up again from (`restore`, `replaceFrom`): a
   * snapshot of a higher one holds more of the crew's run; null for a room never taken up.
   */
  get takenUpFrom(): number | null {
    return this.restoredSeq;
  }

  /**
   * A newer snapshot of this very room, handed in at `now` by a page coming back while the room
   * still takes one (`takesSnapshots`): the room is taken up again from it in place of the older
   * one — whoever is back on the line already stays, back on their seat in it, and their views
   * say so; a seat it does not have is told it left. An older or equal one, one of another room
   * of this code, or one handed in too late changes nothing. Returns whether it replaced.
   */
  replaceFrom(snapshot: RoomSnapshot, now: number): boolean {
    const from = this.restoredSeq ?? Number.POSITIVE_INFINITY;
    const newer = snapshot.seq > from && snapshot.createdAt === this.opened;
    if (!newer || !this.takesSnapshots(now)) {
      return false;
    }
    const attached = [...this.listeners];
    this.stopTimers();
    this.forgetWaits();
    this.load(snapshot, now);
    this.restoredSeq = snapshot.seq;
    for (const [playerId, listener] of attached) {
      if (this.state.players.some((player) => player.id === playerId)) {
        this.back(playerId);
      } else {
        this.listeners.delete(playerId);
        listener({ kind: 'left', code: this.code, message: null });
      }
    }
    this.broadcast('everybody');
    if (this.state.phase === 'playing') {
      this.positionsDirty = true;
      this.schedulePositionsBroadcast();
    }
    return true;
  }

  /** Epoch ms the room was opened: with its code, what tells it from another room of that code. */
  get createdAt(): number {
    return this.opened;
  }

  /**
   * After a dispatch of `type`: the crew is sent the room's snapshot (`sendSnapshot`) once the
   * burst it came in is over, and never sooner than SNAPSHOT_EVERY_MS after the last — what comes
   * meanwhile goes with that one. None for where the crew stands as it walks (PRESENCE_ACTIONS):
   * a run whose clock runs sends one every SNAPSHOT_LIVE_MS anyway (`armLiveSnapshot`). Nothing
   * without a sealer.
   */
  private scheduleSnapshot(type: Action['type']): void {
    if (this.sealer === null || this.snapshotTimer !== null || PRESENCE_ACTIONS.has(type)) {
      return;
    }
    const wait = Math.max(0, this.snapshotSentAt + SNAPSHOT_EVERY_MS - Date.now());
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.sendSnapshot();
    }, wait);
  }

  /**
   * The room's snapshot, sealed (`snapshot {blob, seq, at}`), to every seat on the line, where it
   * holds something new; the next one of a run whose clock runs armed (`armLiveSnapshot`). None
   * once the server goes down: its last one went out.
   */
  private sendSnapshot(): void {
    if (this.goneDown) {
      return;
    }
    const sealed = this.sealedAt(Date.now(), false);
    if (sealed !== null) {
      for (const listener of this.listeners.values()) {
        listener({ kind: 'snapshot', ...sealed });
      }
    }
    this.armLiveSnapshot();
  }

  /**
   * While the run's clock runs, the crew is sent a snapshot SNAPSHOT_LIVE_MS after the last, what
   * ever happened meanwhile: the clock moves on, and so does where everybody stands, with no
   * dispatch to say so. Let go of where the clock stands.
   */
  private armLiveSnapshot(): void {
    clearTimeout(this.liveTimer ?? undefined);
    this.liveTimer = null;
    if (this.sealer !== null && this.clockRuns) {
      this.liveTimer = setTimeout(() => {
        this.liveTimer = null;
        this.sendSnapshot();
      }, SNAPSHOT_LIVE_MS);
    }
  }

  /**
   * Whether the run's clock runs: a run on, not standing still for the server's maintenance —
   * whoever is away meanwhile.
   */
  private get clockRuns(): boolean {
    return this.state.phase === 'playing' && this.state.paused === null;
  }

  /**
   * Whether a snapshot now holds something the last one sent did not — its moment and its count of
   * dispatches apart — and so goes out: the last one as the server goes down always does, and one
   * of a run whose clock runs, whose clock moved on; one of a room whose clock stands only where
   * what it holds changed. Notes what it holds, for the next.
   */
  private changedSinceSent(final: boolean): boolean {
    const content = this.clockRuns ? null : JSON.stringify({ ...this.snapshot(0), seq: 0 });
    const changed = final || content === null || content !== this.sentContent;
    this.sentContent = content;
    return changed;
  }

  /**
   * The room's snapshot as of `now`, sealed for its crew — `final` as the server goes down
   * (`Sealer`) — with its seq: none without a sealer, for nobody on the line, of a run that is
   * over — an ended run is not taken up again — none where it holds nothing new
   * (`changedSinceSent`), and none over SNAPSHOT_MAX, which the log says once.
   */
  private sealedAt(now: number, final: boolean): { blob: string; seq: number; at: number } | null {
    const { phase } = this.state;
    if (this.sealer === null || this.listeners.size === 0 || phase === 'won' || phase === 'lost') {
      return null;
    }
    if (!this.changedSinceSent(final)) {
      return null;
    }
    const { seq } = this;
    const blob = this.sealer(this.snapshot(now), final);
    this.snapshotSentAt = now;
    if (blob.length <= SNAPSHOT_MAX) {
      return { blob, seq, at: now };
    }
    if (!this.tooBigSaid) {
      this.tooBigSaid = true;
      const kb = (blob.length / 1024).toFixed(0);
      console.warn(`[escapelab] room ${this.code}: a snapshot of ${kb} kB is too big to send`);
    }
    return null;
  }

  /**
   * The server goes down for a restart at `now` (shutdown.ts): a run on stands still for the
   * whole crew, every seat away, until whoever is on the line now is back (core `maintenance`) —
   * the crew's views say so — and every seat on the line is sent the room's last snapshot, sealed
   * as this instance's last of it (`final`),
   * as `restart {blob, seq, at}`; none of a run that is over. No snapshot of the room goes out
   * after it. Returns the snapshot's seq and the seats told; null where none was.
   */
  goDown(now: number): { seq: number; seats: number } | null {
    this.goneDown = true;
    if (this.state.phase === 'playing') {
      this.dispatch({ type: 'maintenance', at: now, waitFrom: now });
    }
    const sealed = this.sealedAt(now, true);
    if (sealed === null) {
      return null;
    }
    for (const listener of this.listeners.values()) {
      listener({ kind: 'restart', ...sealed });
    }
    return { seq: sealed.seq, seats: this.listeners.size };
  }

  /**
   * A new seat for `name`, bound to `pass` (lobby only), in `color` where nobody wears it yet;
   * its player id. A pass whose id binds a seat here under another secret is refused before
   * anything changes (seats.ts `check`).
   */
  join(name: string, pass: CrewPass, color?: string): { playerId: string } {
    this.seats.check(pass);
    const playerId = randomUUID();
    this.dispatch({
      type: 'player-join',
      playerId,
      name,
      ...(color === undefined ? {} : { color }),
    });
    this.seats.bind(playerId, pass);
    this.log(`${this.nameOf(playerId)} joined`);
    return { playerId };
  }

  /** The name and the colour of the seat of `playerId`; null for a seat there is none of. */
  playerOf(playerId: string): { name: string; color: string } | null {
    const player = this.state.players.find((p) => p.id === playerId);
    return player === undefined ? null : { name: player.name, color: player.color };
  }

  /** Whether the room has a seat named exactly `name`. */
  hasSeat(name: string): boolean {
    return this.state.players.some((player) => player.name === name);
  }

  /**
   * A new device asks for the seat named `name` in the run on (Jackbox, let in by the crew):
   * every member on the line is asked on their card, for TAKEOVER_WAIT_MS (core
   * `takeover-claimed`, which refuses a seat on the line, a second ask, or nobody to answer).
   * `tell` hears that it waits, then how it ends (`settleClaim`). Returns how to withdraw the
   * ask, its device gone.
   */
  claim(name: string, pass: CrewPass, tell: Listener): () => void {
    const seat = this.state.players.find((player) => player.name === name);
    if (seat === undefined) {
      throw new GameError(`Einen Platz namens ${name} gibt es hier nicht.`);
    }
    if (this.claims.has(seat.id)) {
      throw new GameError(`Für ${seat.name} wartet schon eine Übernahme auf Antwort.`);
    }
    this.checkAskAgain(seat, pass);
    this.seats.check(pass);
    const now = Date.now();
    this.dispatch({ type: 'takeover-claimed', playerId: seat.id, at: now });
    const timer = setTimeout(() => this.settleClaim(seat.id, 'unanswered'), TAKEOVER_WAIT_MS);
    this.claims.set(seat.id, { pass, tell, timer });
    this.log(`${seat.name}'s seat asked for by another device`);
    const until = now + TAKEOVER_WAIT_MS;
    tell({ kind: 'takeover-pending', code: this.code, name: seat.name, until });
    return () => {
      if (this.claims.get(seat.id)?.tell === tell) {
        this.settleClaim(seat.id, 'withdrawn');
      }
    };
  }

  /**
   * Refused, quietly — no card for the crew — while `pass` waits to ask for `seat` again after
   * the crew turned its last ask away or left it unanswered (ASK_AGAIN_MS).
   */
  private checkAskAgain(seat: { id: string; name: string }, pass: CrewPass): void {
    const key = askKey(seat.id, pass);
    const left = (this.askAgainAt.get(key) ?? 0) - Date.now();
    if (left <= 0) {
      this.askAgainAt.delete(key);
      return;
    }
    const wait = Math.ceil(left / 1000);
    throw new GameError(`Für ${seat.name} geht eine neue Anfrage erst in ${wait} s.`);
  }

  /**
   * `playerId`, of the crew and on the line, lets the device that asks for the seat of `seatId`
   * in, or not; the audience has no say.
   */
  answerTakeover(playerId: string, seatId: string, allow: boolean): void {
    if (!this.listeners.has(playerId)) {
      // voice: interface — the room's refusal, not the lab's
      throw new GameError('Über eine Übernahme entscheidet nur, wer im Einsatz verbunden ist.');
    }
    if (!this.claims.has(seatId)) {
      throw new GameError('Über diese Übernahme ist schon entschieden.');
    }
    this.settleClaim(seatId, allow ? 'allowed' : 'refused', this.nameOf(playerId));
  }

  /**
   * The ask for the seat of `seatId` ends `how` (`ClaimEnd`), `by` whom where somebody
   * answered: let in, its pass binds the seat — the pass that held it is refused from now on
   * (SEAT_TAKEN) — and the device resumes it; otherwise it is told why not, but for a device
   * gone. The crew's views lose the ask.
   */
  private settleClaim(seatId: string, how: ClaimEnd, by = ''): void {
    const claim = this.claims.get(seatId);
    if (claim === undefined) {
      return;
    }
    this.claims.delete(seatId);
    clearTimeout(claim.timer);
    if (this.state.phase === 'playing' && this.state.away[seatId]?.claimUntil !== undefined) {
      this.dispatch({ type: 'takeover-settled', playerId: seatId });
    }
    if (TURNED_AWAY.has(how)) {
      this.askAgainAt.set(askKey(seatId, claim.pass), Date.now() + ASK_AGAIN_MS);
    }
    this.answerClaim(seatId, claim, how);
    this.log(`${this.nameOf(seatId)}'s seat ${CLAIM_LOG[how]}${by === '' ? '' : ` by ${by}`}`);
  }

  /**
   * The asking device hears how its ask for the seat of `seatId` ended: let in — its pass
   * binds the seat, the pass that held it refused from now on (SEAT_TAKEN) — or why not;
   * nothing for a device gone.
   */
  private answerClaim(seatId: string, claim: Claim, how: ClaimEnd): void {
    if (how === 'allowed') {
      this.seats.takeOver(seatId, claim.pass);
      claim.tell({ kind: 'takeover-allowed', code: this.code });
    } else if (how !== 'withdrawn') {
      const message = claimRefusal(how, this.nameOf(seatId));
      claim.tell({ kind: 'error', message, of: 'join-room' });
    }
  }

  /** The seat `pass` holds in this room, by player id; null for none. */
  seatOf(pass: CrewPass): string | null {
    const playerId = this.seats.seatOf(pass);
    return playerId !== null && this.state.players.some((p) => p.id === playerId)
      ? playerId
      : null;
  }

  /** Whether `listener` is the connection the seat of `playerId` plays on right now. */
  plays(playerId: string, listener: Listener): boolean {
    return this.listeners.get(playerId) === listener;
  }

  /**
   * Whether `pass` is bound to this room: it holds a seat here whose line has been up since the
   * room was opened, or taken up again from a snapshot. A room taken up again binds only whoever
   * came back to it: a crew that never did is free to go elsewhere.
   */
  binds(pass: CrewPass): boolean {
    const playerId = this.seatOf(pass);
    return playerId !== null && this.seenOnLine.has(playerId);
  }

  /**
   * Where `pass` sits in this room, as its join screen shows it (`whereami`), the mission's
   * clock read at `now`; null for a pass the room does not bind (`binds`), and for one in a
   * finished run — the end screen binds nobody.
   */
  seatSummary(pass: CrewPass, now = Date.now()): Seat | null {
    const { state } = this;
    if (!this.binds(pass) || (state.phase !== 'lobby' && state.phase !== 'playing')) {
      return null;
    }
    const clock = state.paused?.since ?? now;
    return {
      code: this.code,
      missionTitle: state.mission.title,
      phase: state.phase,
      paused: state.paused !== null,
      ...this.standingForNobody(),
      crew: state.players.map((p) => p.name),
      leftMs: state.deadlineAt === null ? null : Math.max(0, state.deadlineAt - clock),
    };
  }

  /** That the run stands still with nobody of its crew on the line (`Seat`); nothing otherwise. */
  private standingForNobody(): Pick<Seat, 'nobodyOnLine'> {
    const { paused, players } = this.state;
    return paused !== null && players.every((p) => !p.connected) ? { nobodyOnLine: true } : {};
  }

  /**
   * The seat `pass` holds is given up for good (core `abandon`): its pass no longer binds it,
   * and the connection it played on hears that it left. In a run, what they carried goes down
   * where the room had them, their avatar is gone, the plates they held let go and the hatch
   * counts the crew that is left. Returns its player id. Throws for a pass with no seat here.
   */
  abandon(pass: CrewPass): string {
    const playerId = this.seatOf(pass);
    if (playerId === null) {
      throw new Error('Dieser Ausweis hat in diesem Raum keinen Platz.');
    }
    const left = this.state.phase === 'playing' ? 'gave the run up' : 'left the room';
    this.leave(playerId, `${this.nameOf(playerId)} ${left}`);
    return playerId;
  }

  /**
   * The seat of `playerId` given up for good (`abandon`), or freed in the lobby (`freeAway`);
   * the log says `line` first: a run it leaves short of its crew ends with it, and the log
   * says so next.
   */
  private leave(playerId: string, line: string): void {
    this.settleClaim(playerId, 'over');
    const stood = this.positions.get(playerId);
    const where = stood === undefined ? null : { x: stood.x, y: stood.y };
    // Worked out before anything is let go of: a leave the core refuses leaves the seat be.
    const next = applyAction(this.state, { type: 'abandon', playerId, at: Date.now(), where });
    // Its connection let go of next: the views the leave sends out go to the rest alone.
    const listener = this.listeners.get(playerId);
    this.listeners.delete(playerId);
    this.positions.delete(playerId);
    this.log(line);
    this.settle(next, 'abandon');
    this.seats.free(playerId);
    const kept = [
      this.signalAllowance,
      this.menuAllowance,
      this.lastPingAt,
      this.lastChatAt,
      this.glances,
    ];
    for (const byPlayer of [...kept, this.lostAt, this.closedClean]) {
      byPlayer.delete(playerId);
    }
    if (this.listeners.size === 0) {
      this.emptySince = Date.now();
    }
    listener?.({ kind: 'left', code: this.code, message: null });
    this.reconcileCrew();
    if (this.state.phase === 'playing') {
      this.positionsDirty = true;
      this.schedulePositionsBroadcast();
    }
  }

  /**
   * In the lobby, frees every seat whose line has been down LOBBY_AWAY_MS — LOBBY_GONE_MS where
   * its socket closed cleanly — (`freeAway`): at once, where the room comes back to its lobby
   * later than that, or once the time is up; and lets go of the timer of every other seat: back
   * on the line, gone, or in a run.
   */
  private reconcileLobbyAway(): void {
    const due = this.awayInLobby();
    for (const [playerId, timer] of this.freeing) {
      if (!due.has(playerId)) {
        clearTimeout(timer);
        this.freeing.delete(playerId);
      }
    }
    for (const [playerId, lost] of due) {
      if (!this.freeing.has(playerId)) {
        const held = this.closedClean.has(playerId) ? LOBBY_GONE_MS : LOBBY_AWAY_MS;
        const wait = Math.max(0, lost + held - Date.now());
        this.freeing.set(playerId, setTimeout(() => this.freeAway(playerId), wait));
      }
    }
  }

  /** The lobby's seats whose line is down, each with when it closed; none outside the lobby. */
  private awayInLobby(): Map<string, number> {
    const due = new Map<string, number>();
    for (const player of this.state.phase === 'lobby' ? this.state.players : []) {
      const lost = this.lostAt.get(player.id);
      if (!player.connected && lost !== undefined) {
        due.set(player.id, lost);
      }
    }
    return due;
  }

  /** The lobby seat of `playerId`, off the line long enough, freed: its pass binds it no more. */
  private freeAway(playerId: string): void {
    this.freeing.delete(playerId);
    const away = seconds(Date.now() - (this.lostAt.get(playerId) ?? Date.now()));
    this.leave(playerId, `${this.nameOf(playerId)}'s seat freed, ${away} after its line closed`);
  }

  /**
   * The player whose seat `pass` holds is back, on whatever socket shows it; their player id.
   * Throws for a pass that holds no seat here: never held one, gave it up, had it freed in the
   * lobby, or lost it to another device (SEAT_TAKEN).
   */
  resume(pass: CrewPass): string {
    const playerId = this.seatOf(pass);
    if (playerId === null && this.seats.lostSeat(pass)) {
      throw new GameError(SEAT_TAKEN);
    }
    if (playerId === null) {
      throw new Error('Wiederverbinden fehlgeschlagen — Raum neu beitreten.');
    }
    const gap = this.back(playerId);
    this.log(`${this.nameOf(playerId)} resumed, ${gap}`);
    return playerId;
  }

  /**
   * The player of `playerId` back on the line, at once: they play on in the run as it stands,
   * and a run standing still for the server's maintenance goes on once it waits for nobody whose
   * line went down with the server (core `player-connected`). Says for the log how long their
   * line was away.
   */
  private back(playerId: string): string {
    this.settleClaim(playerId, 'back');
    const lost = this.lostAt.get(playerId);
    this.lostAt.delete(playerId);
    const now = Date.now();
    this.dispatch({ type: 'player-connected', playerId, at: now });
    this.reconcileCrew();
    return lost === undefined
      ? 'its old line still open'
      : `${seconds(now - lost)} after its line closed`;
  }

  /**
   * Register the live connection for a player; push the current view and positions. Returns
   * how to let go of this very connection once it is lost. A connection the player has
   * replaced since — they resumed on a new socket before the old one was found dead, or from
   * another tab — lets go of nothing: the player stays connected on the new one, and the old
   * one hears that the seat went elsewhere.
   */
  attach(playerId: string, listener: Listener): (end?: LineEnd) => void {
    const before = this.listeners.get(playerId);
    this.listeners.set(playerId, listener);
    this.seenOnLine.add(playerId);
    this.emptySince = null;
    if (before !== undefined && before !== listener) {
      before({ kind: 'left', code: this.code, message: PLAYS_IN_ANOTHER_TAB });
    }
    listener({ kind: 'view', view: viewFor(this.state, playerId), at: Date.now() });
    if (this.positions.size > 0) {
      listener(this.positionsMessage());
    }
    if (this.spectators.size > 0) {
      listener(this.audienceMessage());
    }
    return (end = 'dropped') => {
      if (this.listeners.get(playerId) === listener) {
        this.detach(playerId, end);
      }
    };
  }

  /**
   * Audience connection: read-only, gets the revealing view plus the same
   * live position, ping and chat stream the players get. Its id is what the
   * crew's voice signals address it by while it listens in.
   */
  attachSpectator(listener: Listener): { spectatorId: string; detach: () => void } {
    const spectatorId = `audience-${randomUUID()}`;
    this.spectators.set(spectatorId, listener);
    const view = viewForSpectator(this.state);
    listener({ kind: 'spectator-view', view, code: this.code, at: Date.now() });
    if (this.positions.size > 0) {
      listener(this.positionsMessage());
    }
    this.tellAudience();
    return {
      spectatorId,
      detach: () => {
        if (this.spectators.delete(spectatorId)) {
          this.tellAudience();
        }
        this.signalAllowance.delete(spectatorId);
      },
    };
  }

  /** How many watch, as the room tells it (`audience`). */
  private audienceMessage(): ServerMessage {
    return { kind: 'audience', code: this.code, count: this.spectators.size };
  }

  /** Tells everyone in the room — the crew on its lines, the audience — how many watch now. */
  private tellAudience(): void {
    const message = this.audienceMessage();
    for (const listener of this.audience) {
      listener(message);
    }
  }

  /**
   * Connection lost, as `end` says (`LineEnd`): keep the player (they may resume), notify the
   * others. In a run it goes on (core `player-disconnected`): their avatar stands where it stood
   * and keeps a plate down, works nothing and looks at nothing — a glance it held goes with the
   * line —, and a drop alone ends nothing. A socket that closed cleanly — a tab closed or
   * reloaded — frees its seat sooner in the lobby (LOBBY_GONE_MS); in a run it is held as any
   * other. A line closed for the main menu is held as a drop, in the lobby too, and the crew sees
   * where the player went.
   */
  private detach(playerId: string, end: LineEnd): void {
    if (!this.listeners.delete(playerId)) {
      return;
    }
    if (this.listeners.size === 0) {
      this.emptySince = Date.now();
    }
    this.lostAt.set(playerId, Date.now());
    this.glances.delete(playerId);
    if (end === 'closed') {
      this.closedClean.add(playerId);
    } else {
      this.closedClean.delete(playerId);
    }
    this.log(LINE_END_LOG[end](this.nameOf(playerId)));
    const menu = end === 'menu' ? { menu: true as const } : {};
    this.dispatch({ type: 'player-disconnected', playerId, at: Date.now(), ...menu });
    this.reconcileCrew();
  }

  /**
   * The plates, the presence and the hatch, as the crew on the line stands now: after somebody
   * came or went, or the crew went on without somebody away.
   */
  private reconcileCrew(): void {
    this.reconcilePlates();
    this.reconcilePresence();
    this.checkEscape();
  }

  /**
   * Client-authoritative avatar position, within limits; feeds plates,
   * presence and the position fan-out. A position the client sent for
   * another run (`run`, by its `startedAt`) is dropped. A step no avatar can
   * walk — too long, or through a wall or a shut door — is refused: the
   * player stays where the room had them, and the next fan-out says so.
   * The fan-out relays when the position was true by the sender's clock
   * (`t`; null for one taken as it comes) beside when the room took it.
   */
  updatePosition(
    playerId: string,
    run: number,
    pos: PlayerPosition,
    t: number | null = null,
  ): void {
    if (
      this.state.phase !== 'playing' ||
      this.state.paused !== null ||
      run !== this.state.startedAt
    ) {
      return;
    }
    // Every member of the crew stands on a spot from the moment the run is
    // seeded; a position for anyone else has nothing to step from.
    const from = this.positions.get(playerId);
    if (from === undefined) {
      return;
    }
    this.positionsDirty = true;
    if (!stepAllowed(this.state.mission.map, this.state, from, pos)) {
      this.refusedSteps += 1;
      const name = this.state.players.find((p) => p.id === playerId)?.name ?? playerId;
      const at = (p: PlayerPosition): string => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
      console.warn(
        `[escapelab] room ${this.code}: refused ${name}'s step from ${at(from)} to ${at(pos)} ` +
          `(${this.refusedSteps} refused here so far)`,
      );
      this.schedulePositionsBroadcast();
      return;
    }
    this.positions.set(playerId, { ...pos, t, rt: Date.now() });
    this.reconcilePlates();
    this.reconcilePresence();
    this.checkEscape();
    this.schedulePositionsBroadcast();
  }

  /**
   * A player says yes or no to the next run. Between runs the host's yes
   * may name the mission it plays — found in the catalog and scaled by the
   * caller — and every other answer of the host's takes that back: then the
   * same mission runs again. Once the whole crew has said yes, it starts.
   */
  setReady(playerId: string, ready: boolean, next: Mission | null = null): void {
    const isHost = this.state.players.some((p) => p.id === playerId && p.isHost);
    if (next !== null && !isHost) {
      throw new Error('Den nächsten Einsatz wählt der Host.');
    }
    this.dispatch({ type: 'set-ready', playerId, ready });
    if (isHost) {
      this.next = ready ? next : null;
    }
    this.checkRematch();
  }

  /** Player-triggered game actions coming in from the transport layer. */
  act(playerId: string, msg: GameMessage): void {
    if (isBare(msg)) {
      // Nothing more to it than who and when.
      this.dispatch({ type: msg.kind, playerId, at: Date.now() });
      return;
    }
    switch (msg.kind) {
      case 'select-color':
        this.dispatch({ type: 'select-color', playerId, color: msg.color });
        break;
      case 'set-daily':
        // The Tagesschicht needs no ALLOW_SEED: its seed is the day's, the same for every room.
        this.dispatch({ type: 'set-daily', playerId, daily: msg.daily });
        break;
      case 'start-mission': {
        const at = Date.now();
        this.dispatch({
          type: 'start-mission',
          playerId,
          at,
          seed: randomInt(2 ** 31),
          ...this.dailyAt(at),
        });
        this.next = null;
        this.seedPositions();
        break;
      }
      case 'puzzle-input':
        this.dispatch({ type: 'puzzle-input', playerId, at: Date.now(), input: msg.input });
        break;
      case 'open-source':
        this.dispatch({ type: 'open-source', playerId, manualId: msg.manualId, at: Date.now() });
        break;
      case 'read-note':
        this.dispatch({ type: 'read-note', playerId, note: msg.note, at: Date.now() });
        break;
      case 'drop-item':
        this.dropCarried(playerId);
        break;
      case 'back-to-lobby':
        this.positions.clear();
        this.dispatch({ type: 'back-to-lobby', playerId });
        this.next = null;
        break;
      case 'rematch':
        this.startRematch(playerId);
        break;
      case 'continue-without':
        this.dispatch({
          type: 'continue-without',
          playerId,
          absentId: msg.absentId,
          at: Date.now(),
        });
        this.log(`${this.nameOf(playerId)} went on without ${this.nameOf(msg.absentId)}`);
        this.reconcileCrew();
        break;
    }
  }

  /**
   * `playerId` opens the pause menu over the run, or closes it (`open`): the crew's views say so
   * (core `set-menu`), and nothing stands still for it. A word that changes nothing — outside a
   * run, said twice — sends nobody anything.
   */
  setMenu(playerId: string, open: boolean): void {
    const next = applyAction(this.state, { type: 'set-menu', playerId, open });
    const allowed = (): boolean =>
      takeAllowance(this.menuAllowance, playerId, Date.now(), MENU_MARK_BURST, MENU_MARKS_PER_SEC);
    if (next !== this.state && allowed()) {
      this.settle(next, 'set-menu');
    }
  }

  /**
   * The Tagesschicht of a run starting at `at`, for the reducer to play where the host has it
   * on: the day by this server's clock, and the day's seed made with its salt. None without a
   * salt.
   */
  private dailyAt(at: number): { daily?: DailyStart } {
    if (this.dailySalt === null) {
      return {};
    }
    const day = utcDay(at);
    return { daily: { day, seed: dailySeed(day, this.dailySalt) } };
  }

  /** The next run, started by `playerId`: of the mission the host's yes named, if it named one. */
  private startRematch(playerId: string): void {
    this.positions.clear();
    const next = this.next;
    const at = Date.now();
    this.dispatch({
      type: 'rematch',
      playerId,
      at,
      seed: randomInt(2 ** 31),
      ...this.dailyAt(at),
      ...(next === null ? {} : { mission: next }),
    });
    this.next = null;
    this.seedPositions();
  }

  /** Map ping: fan out to everyone, rate-limited per player. */
  ping(playerId: string, x: number, y: number): void {
    if (this.state.phase !== 'playing') {
      return;
    }
    const now = Date.now();
    if (now - (this.lastPingAt.get(playerId) ?? 0) < PING_COOLDOWN_MS) {
      return;
    }
    this.lastPingAt.set(playerId, now);
    for (const listener of this.audience) {
      listener({ kind: 'ping', playerId, x, y });
    }
  }

  /**
   * A quick-chat phrase by its place in the mission's list, its slot filled with `value` where
   * it has one (core chat.ts `sayPhrase`): fanned out to everyone as said, rate-limited per
   * player. A place the list does not have, or a value the slot does not take, is refused.
   */
  chat(playerId: string, index: number, value: string | undefined): void {
    const phrase = phrasesOf(this.state.mission.chat)[index];
    if (phrase === undefined) {
      throw new GameError('Diesen Schnellchat gibt es nicht.');
    }
    const text = sayPhrase(phrase, value);
    const now = Date.now();
    if (now - (this.lastChatAt.get(playerId) ?? 0) < CHAT_COOLDOWN_MS) {
      return;
    }
    this.lastChatAt.set(playerId, now);
    for (const listener of this.audience) {
      listener({ kind: 'chat', playerId, text });
    }
  }

  /**
   * Passes a voice signal on, unread, from one connected member of the room
   * to another: between two players, from a player to a spectator listening
   * in, from a spectator to a player — never between two spectators, never
   * back to its sender. A member may send SIGNAL_BURST at once and
   * SIGNALS_PER_SEC more each second. Like a chat line within its cooldown,
   * a signal over that or for nobody it may reach is dropped without a word:
   * voice is best effort, and the client retries a link that does not come up.
   * Returns whether it went out.
   */
  relaySignal(from: string, to: string, signal: RtcSignal): boolean {
    const fromPlayer = this.listeners.has(from);
    if ((!fromPlayer && !this.spectators.has(from)) || !this.allowSignal(from, Date.now())) {
      return false;
    }
    const target = this.listeners.get(to) ?? (fromPlayer ? this.spectators.get(to) : undefined);
    if (target === undefined || to === from) {
      return false;
    }
    target({ kind: 'rtc', from, signal });
    return true;
  }

  /** Takes a signal off a member's allowance, topped up since the last; false when none is left. */
  private allowSignal(member: string, now: number): boolean {
    return takeAllowance(this.signalAllowance, member, now, SIGNAL_BURST, SIGNALS_PER_SEC);
  }

  /** One row for the lobby browser. */
  summary(): RoomSummary {
    const capacity = this.state.mission.players.max;
    const open = this.state.phase === 'lobby';
    return {
      code: this.code,
      missionId: this.state.mission.id,
      missionTitle: this.state.mission.title,
      difficulty: this.state.difficulty,
      phase: this.state.phase,
      players: this.state.players.map((p) => ({
        name: p.name,
        color: p.color,
        connected: p.connected,
      })),
      capacity,
      free: open ? Math.max(0, capacity - this.state.players.length) : 0,
    };
  }

  /** True while at least one player is actually connected to this room. */
  get occupied(): boolean {
    return this.listeners.size > 0;
  }

  /** Mission currently selected in this room, so callers can rescale it. */
  get missionId(): string {
    return this.state.mission.id;
  }

  /** The title of the mission selected in this room. */
  get missionTitle(): string {
    return this.state.mission.title;
  }

  /** Where the room stands: its lobby, a run on — paused or not — or the end of one. */
  get phase(): Phase {
    return this.state.phase;
  }

  /** Whether a run on stands still for the server's maintenance, waiting for its crew. */
  get paused(): boolean {
    return this.state.paused !== null;
  }

  /** How many players are on the line here: their seats each played on a connection. */
  get playersOnTheLine(): number {
    return this.listeners.size;
  }

  /** How many audience connections watch here. */
  get watching(): number {
    return this.spectators.size;
  }

  /** The name of the player of `playerId`, for the log; a seat given up meanwhile says so. */
  nameOf(playerId: string): string {
    return this.state.players.find((p) => p.id === playerId)?.name ?? 'a seat given up';
  }

  get difficulty(): Difficulty {
    return this.state.difficulty;
  }

  /** Host switches mission or difficulty (validated by the reducer). */
  switchMission(playerId: string, mission: Mission, difficulty: Difficulty): void {
    this.dispatch({ type: 'switch-mission', playerId, mission, difficulty });
  }

  /**
   * E pressed on the spot `at`, walked in the sender's frame `t`: the room takes the spot as
   * the player's — where it lies within PRESS_REACH of where the room had them and they could
   * have walked there, else it judges where it had them — and then does what E does there
   * (`resolveInteract`). A position update is due anyway: this one comes with the press.
   */
  interact(playerId: string, at: { x: number; y: number }, t: number): void {
    const from = this.positions.get(playerId);
    const taken =
      from !== undefined &&
      this.state.phase === 'playing' &&
      this.state.paused === null &&
      Math.hypot(at.x - from.x, at.y - from.y) <= PRESS_REACH &&
      stepAllowed(this.state.mission.map, this.state, from, at);
    if (taken) {
      const pressed = { x: at.x, y: at.y, facing: from.facing, moving: from.moving };
      this.updatePosition(playerId, this.state.startedAt ?? Number.NaN, pressed, t);
    }
    this.resolveInteract(playerId);
  }

  /**
   * One key does the obvious thing: deliver what you carry where it belongs
   * (a key unlocks its cabinet), otherwise pick up what lies at your feet,
   * otherwise switch on the station in front of you — full hands or not.
   */
  private resolveInteract(playerId: string): void {
    const map = this.state.mission.map;
    const pos = this.positions.get(playerId);
    if (pos === undefined) {
      this.requireNearStation(playerId);
      this.dispatch({ type: 'interact', playerId, at: Date.now() });
      return;
    }
    const near = (x: number, y: number): boolean =>
      Math.hypot(pos.x - x, pos.y - y) <= ITEM_RADIUS;

    const carried = map.items.find((def) => this.state.items[def.id]?.carriedBy === playerId);
    if (carried !== undefined && this.handOver(playerId, carried, near)) {
      return;
    }

    const loose =
      carried !== undefined
        ? undefined
        : map.items.find((def) => {
            const live = this.state.items[def.id];
            return (
              live !== undefined && !live.delivered && live.carriedBy === null && near(live.x, live.y)
            );
          });
    if (loose !== undefined) {
      this.dispatch({ type: 'pick-item', playerId, itemId: loose.id, at: Date.now() });
      return;
    }

    if (carried !== undefined && !this.stationInReach(playerId)) {
      throw new Error(
        `${carried.label} in der Hand: zum markierten Platz bringen oder mit Q ablegen.`,
      );
    }
    this.requireNearStation(playerId);
    this.dispatch({ type: 'interact', playerId, at: Date.now() });
  }

  /**
   * What is carried goes where it belongs — an item to its drop-off, a key
   * into its cabinet — once that is in reach; elsewhere the hands stay full.
   */
  private handOver(
    playerId: string,
    item: MapDef['items'][number],
    near: (x: number, y: number) => boolean,
  ): boolean {
    const cabinet = this.state.mission.map.manuals.find((m) => m.needsKey === item.id);
    const goal = cabinet === undefined ? item.deliverTo : this.state.places[cabinet.id];
    if (goal === undefined || !near(goal.x + 0.5, goal.y + 0.5)) {
      return false;
    }
    const at = Date.now();
    this.dispatch(
      cabinet === undefined
        ? { type: 'deliver-item', playerId, itemId: item.id, at }
        : { type: 'open-source', playerId, manualId: cabinet.id, at },
    );
    return true;
  }

  /** Put down whatever this player is carrying, right where they stand. */
  private dropCarried(playerId: string): void {
    const pos = this.positions.get(playerId);
    const carried = Object.entries(this.state.items).find(
      ([, live]) => live.carriedBy === playerId,
    );
    if (carried === undefined || pos === undefined) {
      return;
    }
    this.dispatch({
      type: 'drop-item',
      playerId,
      itemId: carried[0],
      x: pos.x,
      y: pos.y,
      at: Date.now(),
    });
  }

  private requireNearStation(playerId: string): void {
    if (this.state.paused !== null) {
      return; // reducer rejects with a clearer message
    }
    const stations = armedStations(this.state.mission.map, this.state);
    const pos = this.positions.get(playerId);
    if (stations.length === 0 || pos === undefined) {
      throw new Error('Hier gibt es nichts zu aktivieren — nur die leuchtende Station.');
    }
    if (!this.stationInReach(playerId)) {
      throw new Error('Zu weit weg — nur direkt an der leuchtenden Station.');
    }
  }

  /**
   * Whether the armed station — any of its consoles — lies within this player's reach, and the
   * player faces it (`facesConsole`): through a wall or round a pillar there is nothing to work.
   */
  private stationInReach(playerId: string): boolean {
    const pos = this.positions.get(playerId);
    const { state } = this;
    const current = state.mission.puzzles[state.currentPuzzleIndex]?.id;
    if (pos === undefined || !lightsAreOut(state) || current === undefined) {
      return false;
    }
    const shut = shutDoors(state.mission.map, state);
    return state.mission.map.stations.some(
      (spot) =>
        spot.puzzleId === current &&
        Math.hypot(pos.x - (spot.x + 0.5), pos.y - (spot.y + 0.5)) <= INTERACT_RADIUS &&
        this.facesConsole(playerId, spot, shut, {}),
    );
  }

  /**
   * Whether `playerId` faces the console at `spot`: they see it from where they stand — the
   * line of sight finds go by (core discovery.ts), to the middle of its tile — or they have
   * found it, `fresh` from this very look round included. Behind a wall or round a pillar, a
   * console the player has not found has nobody standing at it.
   */
  private facesConsole(
    playerId: string,
    spot: MapDef['stations'][number],
    shut: ReadonlySet<string>,
    fresh: Readonly<Record<string, FindKey[]>>,
  ): boolean {
    const key = findKey(consoleFind(spot));
    if (foundBy(this.state, playerId, key) || fresh[playerId]?.includes(key) === true) {
      return true;
    }
    const pos = this.positions.get(playerId);
    const middle = { x: spot.x + 0.5, y: spot.y + 0.5 };
    return pos !== undefined && canSee(this.state.mission.map, pos, middle, shut);
  }

  /** Place every avatar on the spawn it drew when a mission starts. */
  private seedPositions(): void {
    if (this.state.phase !== 'playing') {
      return;
    }
    this.positions.clear();
    for (const player of this.state.players) {
      const spawn = player.spawn;
      this.positions.set(player.id, {
        x: (spawn?.x ?? 1) + 0.5,
        y: (spawn?.y ?? 1) + 0.5,
        facing: 0,
        moving: false,
        t: null,
        rt: Date.now(),
      });
    }
    this.positionsDirty = true;
    this.reconcilePresence();
    this.schedulePositionsBroadcast();
  }

  /**
   * Everyone whose avatar stands close enough to a spot, by player id: on the line or away — an
   * avatar whose line is down stands where it stood, and its weight is still on a plate or the
   * hatch.
   */
  private bodiesAt(x: number, y: number, radius: number): string[] {
    return this.state.players
      .filter((player) => {
        const pos = this.positions.get(player.id);
        return pos !== undefined && Math.hypot(pos.x - (x + 0.5), pos.y - (y + 0.5)) <= radius;
      })
      .map((player) => player.id);
  }

  /** Of those standing close enough to a spot, whoever is on the line: hands that can work it. */
  private handsAt(x: number, y: number, radius: number): string[] {
    const on = new Set(this.state.players.filter((p) => p.connected).map((p) => p.id));
    return this.bodiesAt(x, y, radius).filter((id) => on.has(id));
  }

  /**
   * Who stands on each plate the map has, by its id, sorted — by the reach that holds a plate
   * pressed: the release radius while the game has it pressed, the press radius while not. An
   * avatar whose line is down stands on it as any other (`bodiesAt`).
   */
  private onEachPlate(): [string, string[]][] {
    const held = new Set(this.state.pressedPlates);
    return this.state.mission.map.plates.map((plate) => {
      const radius = held.has(plate.id) ? PLATE_RELEASE_RADIUS : PLATE_PRESS_RADIUS;
      return [plate.id, this.bodiesAt(plate.x, plate.y, radius).sort()];
    });
  }

  /**
   * Translate live positions into plate and panel state; dispatch only on change. A plate holds
   * under any avatar, whoever's line is down included; an emergency's panel takes somebody on
   * the line, and a *different* one each, so they are assigned greedily.
   */
  private reconcilePlates(): void {
    const map = this.state.mission.map;
    if (this.state.phase !== 'playing') {
      return;
    }
    const plates = this.onEachPlate()
      .filter(([, players]) => players.length > 0)
      .map(([id]) => id)
      .sort();

    const claimed = new Set<string>();
    const panels: string[] = [];
    for (const panel of map.sabotage?.panels ?? []) {
      const free = this.handsAt(panel.x, panel.y, PANEL_RADIUS).find((id) => !claimed.has(id));
      if (free !== undefined) {
        claimed.add(free);
        panels.push(panel.id);
      }
    }
    panels.sort();

    const sameList = (a: string[], b: string[]): boolean =>
      a.length === b.length && a.every((id, i) => id === b[i]);
    if (
      !sameList(plates, [...this.state.pressedPlates].sort()) ||
      !sameList(panels, [...this.state.occupiedPanels].sort())
    ) {
      this.dispatch({ type: 'set-occupancy', plates, panels });
    }
    this.checkSabotageCleared();
  }

  /** Connected players in presence range of a spot; whoever was there already may stand wider. */
  private presentAt(x: number, y: number, was: readonly string[]): string[] {
    return this.state.players
      .filter((player) => {
        const pos = this.positions.get(player.id);
        const radius = was.includes(player.id) ? PRESENCE_LEAVE_RADIUS : PRESENCE_ENTER_RADIUS;
        return (
          player.connected &&
          pos !== undefined &&
          Math.hypot(pos.x - (x + 0.5), pos.y - (y + 0.5)) <= radius
        );
      })
      .map((player) => player.id)
      .sort();
  }

  /**
   * What each connected player finds where they stand at `now` (core discovery.ts), of what
   * they have not found yet, by player id: whatever lies in reach, whatever their lamp's cone
   * has rested on long enough. Keeps the glances still running and arms the look that ends the
   * next of them. The server's maintenance freezes the run: nothing is found while it lasts, and
   * a look begun before it starts anew after it.
   */
  private findsNow(now: number): Record<string, FindKey[]> {
    const found: Record<string, FindKey[]> = {};
    if (this.state.paused !== null) {
      this.forgetGlances();
      return found;
    }
    const shut = shutDoors(this.state.mission.map, this.state);
    const things = findables(this.state);
    let dueAt: number | null = null;
    for (const player of this.state.players) {
      const look = this.lookFor(player, things, shut, now);
      if (look === null) {
        continue;
      }
      if (look.found.length > 0) {
        found[player.id] = look.found;
      }
      if (look.dueAt !== null) {
        dueAt = Math.min(dueAt ?? Infinity, look.dueAt);
      }
    }
    this.armGlances(dueAt, now);
    return found;
  }

  /**
   * One player's look round at `now`, of what they have not found yet among `things`, keeping
   * their glances still running; null for a player away — whose glances went with their line
   * (`detach`) — or not placed yet.
   */
  private lookFor(
    player: GameState['players'][number],
    things: readonly Findable[],
    shut: ReadonlySet<string>,
    now: number,
  ): Look | null {
    const pos = this.positions.get(player.id);
    if (!player.connected || pos === undefined) {
      return null;
    }
    const had = new Set(this.state.found[player.id] ?? []);
    const fresh = things.filter((thing) => !had.has(thing.key));
    const glances = this.glances.get(player.id) ?? {};
    const look = lookAround(this.state.mission.map, shut, pos, fresh, glances, now);
    this.glances.set(player.id, look.glances);
    return look;
  }

  /** Lets every running glance go, and the look that would have ended the next of them. */
  private forgetGlances(): void {
    this.glances.clear();
    this.armGlances(null, 0);
  }

  /**
   * What there is to find and to see as the run stands, in one string: the doors shut, the
   * station armed, the parts lying loose, the server's maintenance. Outside a run, just its
   * phase.
   */
  private findingWorld(): string {
    const { state } = this;
    if (state.phase !== 'playing') {
      return state.phase;
    }
    const shut = [...shutDoors(state.mission.map, state)].sort().join(' ');
    const armed = lightsAreOut(state) ? state.currentPuzzleIndex : -1;
    const loose = Object.entries(state.items)
      .filter(([, item]) => item.carriedBy === null && !item.delivered)
      .map(([id, item]) => `${id}@${item.x},${item.y}`)
      .join(' ');
    return `${shut}|${armed}|${loose}|${state.paused === null ? 'on' : 'paused'}`;
  }

  /**
   * Looks round again at `dueAt` (epoch ms), when the next glance has been held long enough
   * though nobody moved; none for null.
   */
  private armGlances(dueAt: number | null, now: number): void {
    if (this.glanceTimer !== null) {
      clearTimeout(this.glanceTimer);
      this.glanceTimer = null;
    }
    if (dueAt !== null) {
      this.glanceTimer = setTimeout(
        () => {
          this.glanceTimer = null;
          this.reconcilePresence();
        },
        Math.max(0, dueAt - now),
      );
    }
  }

  /**
   * Who stands on the exit hatch, sorted: every avatar within EXIT_RADIUS of it once it is open
   * — the escape's own measure —, whoever's line is down included, and nobody before.
   */
  private onTheHatch(): string[] {
    const exit = this.state.mission.map.exit;
    if (exit === undefined || !inEscapePhase(this.state)) {
      return [];
    }
    return this.bodiesAt(exit.x, exit.y, EXIT_RADIUS).sort();
  }

  /** Connected players in presence range of each spot, by its id; empty spots left out. */
  private atEach(
    spots: readonly { id: string; x: number; y: number }[],
    was: Record<string, string[]>,
  ): Record<string, string[]> {
    return Object.fromEntries(
      spots
        .map((spot) => [spot.id, this.presentAt(spot.x, spot.y, was[spot.id] ?? [])] as const)
        .filter(([, players]) => players.length > 0),
    );
  }

  /**
   * Where each note of the last shift is read, by `noteKey`: the floor tile
   * it lies on, or the one its wall's face looks into (core's `noteSpot`).
   */
  private noteSpots(): { id: string; index: number; x: number; y: number }[] {
    const map = this.state.mission.map;
    return map.notes.flatMap((note, index) => {
      const spot = noteSpot(map, note);
      return spot === null ? [] : [{ id: noteKey(index), index, ...spot }];
    });
  }

  /**
   * Translate live positions into who stands at which station spot — each
   * console of a station on its own, keyed by `stationKey` — manual object,
   * note and plate, who has walked up to the sign, what each player has just
   * found (`findsNow`), and who stands on the open hatch; dispatch only on
   * change.
   */
  private reconcilePresence(): void {
    if (this.state.phase !== 'playing') {
      return;
    }
    const now = Date.now();
    const found = this.findsNow(now);
    const next = { ...this.whereEverybodyStands(found), found, sight: this.sightNow() };
    const reach = this.reachOf(next);
    if (reach === 'everybody' || reach.length > 0) {
      this.dispatch({ type: 'set-presence', ...next, at: now }, reach);
    }
  }

  /**
   * Who stands at each station spot, source, note and plate, who saw the sign, who is on the
   * hatch. At a source, a note or the sign only a player who has found it — `fresh` from this
   * very look round included — counts, and at a console only one who sees it or has found it
   * (`facesConsole`): the distance alone would have them read, open, work or copy the
   * Laborkennung round a pillar or through a wall. On a plate, whoever holds it pressed
   * (`onEachPlate`).
   */
  private whereEverybodyStands(
    fresh: Readonly<Record<string, FindKey[]>>,
  ): Omit<PresenceReport, 'found' | 'sight'> {
    const map = this.state.mission.map;
    const { presence, places } = this.state;
    const finders = (key: FindKey) => (playerId: string) =>
      foundBy(this.state, playerId, key) || fresh[playerId]?.includes(key) === true;
    const shut = shutDoors(map, this.state);
    const spots = new Map(map.stations.map((s) => [stationKey(s), s]));
    const stations = onlyFinders(
      this.atEach(
        map.stations.map((s) => ({ id: stationKey(s), x: s.x, y: s.y })),
        presence.stations,
      ),
      (id) => (playerId) => {
        const spot = spots.get(id);
        return spot !== undefined && this.facesConsole(playerId, spot, shut, fresh);
      },
    );
    const sources = map.manuals.flatMap((m) => {
      const at = places[m.id];
      return at === undefined ? [] : [{ id: m.id, x: at.x, y: at.y }];
    });
    const sign = map.edgeworkSign;
    const atSign = sign === undefined ? [] : this.presentAt(sign.x, sign.y, []);
    const signSeen = [...new Set([...presence.signSeen, ...atSign.filter(finders('sign'))])];
    return {
      stations,
      manuals: onlyFinders(this.atEach(sources, presence.manuals), (id) =>
        finders(findKey({ of: 'source', id })),
      ),
      notes: onlyFinders(this.atEach(this.noteSpots(), presence.notes), (id) =>
        finders(findKey({ of: 'note', index: Number(id) })),
      ),
      plates: Object.fromEntries(this.onEachPlate().filter(([, players]) => players.length > 0)),
      signSeen: signSeen.sort(),
      exit: this.onTheHatch(),
    };
  }

  /**
   * Whose views `next` changes, set as the presence: everybody's for a step, a find or the
   * sign; for a change of sight alone only those of the players whose sight it is, since no
   * other view shows it (`viewFor`); nobody's for no change.
   */
  private reachOf(next: PresenceReport): Reach {
    const { presence } = this.state;
    const { stations, manuals, notes, plates, exit, sight } = presence;
    const stood = JSON.stringify([next.stations, next.manuals, next.notes, next.plates, next.exit]);
    if (
      Object.keys(next.found).length > 0 ||
      next.signSeen.length !== presence.signSeen.length ||
      stood !== JSON.stringify([stations, manuals, notes, plates, exit])
    ) {
      return 'everybody';
    }
    const lookers = new Set([...Object.keys(sight), ...Object.keys(next.sight)]);
    const sees = (id: string, all: Record<string, readonly string[]>) =>
      JSON.stringify(all[id] ?? []);
    return [...lookers].filter((id) => sees(id, sight) !== sees(id, next.sight)).sort();
  }

  /**
   * What each connected player has in sight right now (core discovery.ts `inSight`) of what a
   * view carries only in sight (`sightables`), by player id, as the state keeps it: sorted,
   * nobody with nothing in sight. The maintenance stops no sight; while the power lights the
   * whole lab (`labLit`) every view shows all of it, and no sight is kept.
   */
  private sightNow(): Record<string, FindKey[]> {
    if (labLit(this.state)) {
      return {};
    }
    const map = this.state.mission.map;
    const shut = shutDoors(map, this.state);
    const things = sightables(this.state);
    const sight: Record<string, FindKey[]> = {};
    for (const player of this.state.players) {
      const pos = this.positions.get(player.id);
      const seen = player.connected && pos !== undefined ? inSight(map, shut, pos, things) : [];
      if (seen.length > 0) {
        sight[player.id] = seen.sort();
      }
    }
    return sight;
  }

  /** All panels manned at once ends the emergency. */
  private checkSabotageCleared(): void {
    const sabotage = this.state.mission.map.sabotage;
    // A relay emergency has no panels: only its instructions clear it.
    if (this.state.sabotage === null || sabotage === undefined || sabotage.mode !== 'valves') {
      return;
    }
    if (this.state.occupiedPanels.length >= sabotage.panels.length) {
      this.dispatch({ type: 'sabotage-cleared', at: Date.now() });
    }
  }

  /**
   * Keep the emergency schedule in sync with the game state: arm the next
   * emergency while the crew is still solving, and the expiry while one runs.
   */
  private reconcileSabotage(): void {
    const sabotage = this.state.mission.map.sabotage;
    if (this.sabotageTimer !== null) {
      clearTimeout(this.sabotageTimer);
      this.sabotageTimer = null;
    }
    if (this.state.phase !== 'playing' || this.state.paused !== null || sabotage === undefined) {
      return;
    }
    if (this.state.sabotage !== null) {
      const delay = Math.max(0, this.state.sabotage.endsAt - Date.now());
      this.sabotageTimer = setTimeout(() => {
        this.sabotageTimer = null;
        this.dispatch({ type: 'sabotage-expired', at: Date.now() });
      }, delay);
      return;
    }
    // Not before the crew is out of its starting rooms (`afterSolved` stations
    // done), and not once they are already running for the hatch; the schedule
    // runs on the clock, which starts when the lights go out.
    if (!emergenciesDue(this.state)) {
      return;
    }
    const sinceStart = Date.now() - (this.state.lightsOutAt ?? Date.now());
    const first = sabotage.firstAfterSec * 1000;
    const every = sabotage.everySec * 1000;
    const nextAt = sinceStart < first ? first : Math.ceil((sinceStart - first) / every) * every + first;
    this.sabotageTimer = setTimeout(
      () => {
        this.sabotageTimer = null;
        this.dispatch({ type: 'sabotage-start', at: Date.now() });
      },
      Math.max(500, nextAt - sinceStart),
    );
  }

  /**
   * While a relay emergency runs, its instructions run out on the clock: the reducer is told the
   * time once a second, whoever is away. The server's maintenance stops the ticking.
   */
  private reconcileRelayTick(): void {
    const live =
      this.state.phase === 'playing' &&
      this.state.paused === null &&
      this.state.sabotage?.emergency !== undefined;
    if (live && this.relayTimer === null) {
      this.relayTimer = setInterval(
        () => this.dispatch({ type: 'sabotage-tick', at: Date.now() }),
        RELAY_TICK_MS,
      );
    } else if (!live && this.relayTimer !== null) {
      clearInterval(this.relayTimer);
      this.relayTimer = null;
    }
  }

  /**
   * After a run, the next one starts by itself as soon as the whole crew has
   * said yes — nobody has to be the one who presses go. It plays the mission
   * the host's yes named, or the same again.
   */
  private checkRematch(): void {
    if (this.state.phase !== 'won' && this.state.phase !== 'lost') {
      return;
    }
    const crew = this.state.players;
    const host = crew.find((p) => p.isHost);
    // Everyone has to be back AND willing: a mission short-handed is a
    // mission nobody can finish.
    if (host === undefined || crew.length === 0) {
      return;
    }
    if (!crew.every((p) => p.connected && p.ready)) {
      return;
    }
    this.startRematch(host.id);
  }

  /**
   * Won once the whole crew the run counts stands on the hatch — everybody but whom it went on
   * without (core `crewOf`), somebody away where their avatar stands (`onTheHatch`): by the
   * presence the views carry, so that the crew's checklist and the escape never disagree. The
   * crew waits for whoever is away and not on it as for somebody slow, so a drop alone never ends
   * a run; never while it stands still for the server's maintenance.
   */
  private checkEscape(): void {
    if (!inEscapePhase(this.state) || this.state.paused !== null) {
      return;
    }
    const onIt = this.state.presence.exit;
    const crew = crewOf(this.state);
    if (crew.length > 0 && crew.every((player) => onIt.includes(player.id))) {
      this.dispatch({ type: 'escaped', at: Date.now() });
    }
  }

  /**
   * The positions go out now, and again POSITIONS_INTERVAL_MS on if something changed
   * meanwhile — a new sample, a refused step, a drone that moved — never oftener; a run that
   * stands still hears them once a second (POSITIONS_KEEPALIVE_MS).
   */
  private schedulePositionsBroadcast(): void {
    if (this.positionsTimer !== null) {
      return;
    }
    this.broadcastPositions();
    this.positionsTimer = setTimeout(() => {
      this.positionsTimer = null;
      if (this.positionsDirty) {
        this.schedulePositionsBroadcast();
      }
    }, POSITIONS_INTERVAL_MS);
  }

  private broadcastPositions(): void {
    this.positionsDirty = false;
    const msg = this.positionsMessage();
    // What everybody heard of the drones: a newcomer told alone is no one else's news.
    this.dronesSent = JSON.stringify(msg.drones);
    for (const listener of this.audience) {
      listener(msg);
    }
    if (this.keepaliveTimer !== null) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.state.phase === 'playing') {
      this.keepaliveTimer = setTimeout(() => {
        this.keepaliveTimer = null;
        this.schedulePositionsBroadcast();
      }, POSITIONS_KEEPALIVE_MS);
    }
  }

  /** Where everybody stands right now, stamped with the run it belongs to. */
  private positionsMessage(): Extract<ServerMessage, { kind: 'positions' }> {
    return {
      kind: 'positions',
      run: this.state.startedAt,
      players: Object.fromEntries(this.positions),
      drones: this.drones?.snapshot(this.state, Date.now()) ?? {},
    };
  }

  /**
   * A mission's intro ends on its own: once the lights are due, they go out.
   * A pause moves that moment on, like every deadline, so the timer is armed
   * afresh from the state after every dispatch, and none runs while paused.
   */
  private reconcileLights(): void {
    if (this.lightsTimer !== null) {
      clearTimeout(this.lightsTimer);
      this.lightsTimer = null;
    }
    const due = this.state.lightsDueAt;
    if (this.state.phase !== 'playing' || this.state.paused !== null || due === null) {
      return;
    }
    this.lightsTimer = setTimeout(
      () => {
        this.lightsTimer = null;
        this.dispatch({ type: 'lights-out', at: Date.now() });
      },
      Math.max(0, due - Date.now()),
    );
  }

  /**
   * Presses at a sync station run out on the clock: the open puzzle is
   * ticked once the next of them is due, so that everybody's view says so
   * then and not only at the next press. Armed afresh after every dispatch,
   * like the lights; none runs while paused.
   */
  private reconcilePuzzleClock(): void {
    if (this.puzzleTimer !== null) {
      clearTimeout(this.puzzleTimer);
      this.puzzleTimer = null;
    }
    const due = puzzleDueAt(this.state);
    if (due === null) {
      return;
    }
    this.puzzleTimer = setTimeout(
      () => {
        this.puzzleTimer = null;
        this.dispatch({ type: 'puzzle-tick', at: Date.now() });
      },
      Math.max(0, due - Date.now()),
    );
  }

  /**
   * Mission control speaks up about a station left quiet: the room asks once `nudgeDueAt` has
   * come — no input at either console for NUDGE_QUIET_MS — and the reducer puts the station's
   * next line on the air. Armed afresh after every dispatch, so any input moves it on; none
   * runs while paused, in an emergency or once the station's lines are said.
   */
  private reconcileNudge(): void {
    if (this.nudgeTimer !== null) {
      clearTimeout(this.nudgeTimer);
      this.nudgeTimer = null;
    }
    const due = nudgeDueAt(this.state);
    if (due === null) {
      return;
    }
    this.nudgeTimer = setTimeout(
      () => {
        this.nudgeTimer = null;
        this.dispatch({ type: 'nudge', at: Date.now() });
      },
      Math.max(0, due - Date.now()),
    );
  }

  /**
   * Mission control calls the time left: the room asks once `clockCallDueAt` has come — the
   * clock down to five minutes, two, the last — and the reducer says the call. Armed afresh
   * after every dispatch, so a penalty that moves the deadline moves it; none runs while paused
   * or once every call is behind the run.
   */
  private reconcileClockCall(): void {
    if (this.clockCallTimer !== null) {
      clearTimeout(this.clockCallTimer);
      this.clockCallTimer = null;
    }
    const due = clockCallDueAt(this.state);
    if (due === null) {
      return;
    }
    this.clockCallTimer = setTimeout(
      () => {
        this.clockCallTimer = null;
        this.dispatch({ type: 'clock-call', at: Date.now() });
      },
      Math.max(0, due - Date.now()),
    );
  }

  /**
   * Fixed-rate patrol simulation: the patrols of a mission with drones are out while its run is
   * in the dark, and move while it runs, whoever is away — they see nobody whose line is down
   * (drones.ts); the server's maintenance stands them still where they are, as it stands the
   * clock still. With the lights on, or the run over, there are none.
   */
  private reconcileDroneTimer(): void {
    const map = this.state.mission.map;
    if (!lightsAreOut(this.state) || map.drones.length === 0) {
      this.stopDrones();
      this.drones = null;
      return;
    }
    this.drones ??= new DronePatrol(map);
    if (this.state.paused !== null) {
      this.stopDrones();
    } else if (this.droneTimer === null) {
      this.lastDroneTick = Date.now();
      this.droneTimer = setInterval(() => this.tickDrones(), DRONE_TICK_MS);
    }
  }

  /** The patrols move no more: their timer stops. */
  private stopDrones(): void {
    if (this.droneTimer !== null) {
      clearInterval(this.droneTimer);
      this.droneTimer = null;
    }
  }

  private tickDrones(): void {
    const patrol = this.drones;
    if (patrol === null) {
      return;
    }
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastDroneTick) / 1000);
    this.lastDroneTick = now;
    patrol.step(this.state, dt);
    const spotted = patrol.detect(this.state, this.positionSnapshot(), now);
    for (const { penaltySec, playerId } of spotted) {
      this.dispatch({ type: 'drone-spotted', at: now, penaltySec, playerId });
    }
    // Drones asleep or held by their plate say nothing new: no fan-out for them.
    if (JSON.stringify(patrol.snapshot(this.state, now)) !== this.dronesSent) {
      this.positionsDirty = true;
      this.schedulePositionsBroadcast();
    }
  }

  private positionSnapshot(): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    for (const [id, pos] of this.positions) {
      out.set(id, { x: pos.x, y: pos.y });
    }
    return out;
  }

  /**
   * Applies `action` and sends the views it changes — every view, unless `reach` names the only
   * members whose view it can change — then keeps the timers and the presence in step.
   */
  private dispatch(action: Action, reach: Reach = 'everybody'): void {
    this.settle(applyAction(this.state, action), action.type, reach);
  }

  /**
   * `next` — the room's state with an action of `type` applied — becomes the room's: the end of
   * the run reported where it ended, the views it changes sent, the timers and the presence
   * kept in step (`dispatch`).
   */
  private settle(next: GameState, type: Action['type'], reach: Reach = 'everybody'): void {
    const wasPlaying = this.state.phase === 'playing';
    const world = this.findingWorld();
    this.state = next;
    this.seq += 1;
    this.noteDeed(type);
    // A run ends exactly once, won or lost; a rematch is a run of its own.
    if (wasPlaying && (this.state.phase === 'won' || this.state.phase === 'lost')) {
      this.runOver(runReport(this.state, this.code));
    }
    // A glance of one run finds nothing in the next.
    if (this.state.phase !== 'playing') {
      this.forgetGlances();
    }
    this.reconcileClocks();
    this.broadcast(reach);
    // A door opened, a part put down, a station armed: whoever stands still sees it as well.
    if (type !== 'set-presence' && this.findingWorld() !== world) {
      this.reconcilePresence();
    }
    this.reconcileLobbyAway();
    this.scheduleSnapshot(type);
  }

  /**
   * Every timer of the run armed afresh from the game as it stands — the deadline, the lights,
   * the open puzzle's clock, mission control's nudge and its calls of the clock, the patrols,
   * the emergencies — or let go.
   */
  private reconcileClocks(): void {
    this.reconcileTimer();
    this.reconcileLights();
    this.reconcilePuzzleClock();
    this.reconcileNudge();
    this.reconcileClockCall();
    this.reconcileDroneTimer();
    this.reconcileSabotage();
    this.reconcileRelayTick();
  }

  /**
   * The run is over: the log says how, its report goes to `onRunFinished` with the pass that
   * holds each seat of its crew — but that of a ghost (`ghostEnd`) — and no seat of it is to be
   * taken over any more.
   */
  private runOver(report: RunReport): void {
    for (const seatId of [...this.claims.keys()]) {
      this.settleClaim(seatId, 'over');
    }
    const why = this.state.calledOff === null ? '' : ` — ${this.state.calledOff}`;
    this.log(
      `run over, ${report.outcome} after ${runSeconds(report).toFixed(0)} s, ` +
        `crew ${report.crew.join(', ')}${why}`,
    );
    if (this.ghostEnd(report)) {
      this.log('not counted: none of its crew but who gave it up came back after the restore');
      return;
    }
    // The report's crew is the state's players, in order: p1 holds the first seat.
    const passes = this.state.players.map((player) => this.seats.passOf(player.id));
    this.onRunFinished({ report, passes });
  }

  /**
   * Whether the run `report` ends is a ghost's: given up, none of its crew but who gave it up on
   * the line since the room was opened or taken up again. A run starts with its whole crew on
   * the line, so only a room taken up again from a snapshot holds one — a page that kept a
   * snapshot of a run over elsewhere, or that its crew left. No run of the crew's: not reported.
   */
  private ghostEnd(report: RunReport): boolean {
    return report.outcome === 'lost:abandoned' && this.seenOnLine.size <= 1;
  }

  /** The seats waiting to be freed in the lobby, and the asks for seats: none any more. */
  private forgetWaits(): void {
    const claimed = [...this.claims.values()].map((claim) => claim.timer);
    for (const timer of [...this.freeing.values(), ...claimed]) {
      clearTimeout(timer);
    }
    this.freeing.clear();
    this.claims.clear();
    this.askAgainAt.clear();
    this.closedClean.clear();
  }

  /** One line of the server's log about this room. */
  private log(line: string): void {
    console.log(`[escapelab] room ${this.code}: ${line}`);
  }

  /**
   * Re-arm the deadline timeout after every dispatch — penalties move the
   * deadline, so the pending timer may be stale.
   */
  private reconcileTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (
      this.state.phase === 'playing' &&
      this.state.paused === null &&
      this.state.deadlineAt !== null
    ) {
      const delay = Math.max(0, this.state.deadlineAt - Date.now());
      this.timer = setTimeout(() => {
        this.timer = null;
        this.dispatch({ type: 'time-expired', at: Date.now() });
      }, delay);
    }
  }

  /**
   * The views of the state as it stands, stamped with the server's time: every member's and the
   * audience's, or only those of the members `reach` names.
   */
  private broadcast(reach: Reach): void {
    const at = Date.now();
    for (const [playerId, listener] of this.listeners) {
      if (reach === 'everybody' || reach.includes(playerId)) {
        listener({ kind: 'view', view: viewFor(this.state, playerId), at });
      }
    }
    if (reach === 'everybody' && this.spectators.size > 0) {
      const view = viewForSpectator(this.state);
      for (const listener of this.spectators.values()) {
        listener({ kind: 'spectator-view', view, code: this.code, at });
      }
    }
  }

  /** Everyone attached to this room, players and audience alike. */
  private get audience(): Listener[] {
    return [...this.listeners.values(), ...this.spectators.values()];
  }

  dispose(): void {
    this.forgetWaits();
    this.stopTimers();
  }

  /**
   * Every timer of the room let go — the run's, the stream of positions', the snapshots', the
   * glances' and the patrols' — and the patrols with them.
   */
  private stopTimers(): void {
    const timers = [
      this.timer,
      this.snapshotTimer,
      this.liveTimer,
      this.lightsTimer,
      this.puzzleTimer,
      this.nudgeTimer,
      this.clockCallTimer,
      this.positionsTimer,
      this.keepaliveTimer,
      this.sabotageTimer,
    ];
    for (const timer of timers) {
      clearTimeout(timer ?? undefined);
    }
    this.timer = null;
    this.snapshotTimer = null;
    this.liveTimer = null;
    this.lightsTimer = null;
    this.puzzleTimer = null;
    this.nudgeTimer = null;
    this.clockCallTimer = null;
    this.positionsTimer = null;
    this.keepaliveTimer = null;
    this.sabotageTimer = null;
    clearInterval(this.relayTimer ?? undefined);
    this.relayTimer = null;
    this.forgetGlances();
    this.stopDrones();
    this.drones = null;
  }
}
