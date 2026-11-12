import { randomInt, randomUUID } from 'node:crypto';
import { DronePatrol } from './drones.js';
import { SeatBook } from './seats.js';
import {
  applyAction,
  armedStations,
  canSee,
  consoleFind,
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
  sayPhrase,
  shutDoors,
  sightables,
  stationKey,
  stepAllowed,
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
  type RoomSummary,
  type RtcSignal,
  type RunReport,
  type ServerMessage,
} from '@escapelab/core';

type Listener = (msg: ServerMessage) => void;

/** Hears of every run that ends in a room, won or lost, with the run's report. */
export type RunListener = (report: RunReport) => void;

/**
 * The subset of client messages that map 1:1 onto game actions. A yes to
 * the next run may name a mission from the catalog: that one goes through
 * `setReady`, which takes the mission already found.
 */
export type GameMessage = Extract<
  ClientMessage,
  {
    kind:
      | 'select-color'
      | 'set-daily'
      | 'start-mission'
      | 'intro-done'
      | 'puzzle-input'
      | 'request-hint'
      | 'open-source'
      | 'read-note'
      | 'drop-item'
      | 'back-to-lobby'
      | 'rematch';
  }
>;

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
/** Patrol simulation step. */
const DRONE_TICK_MS = 80;
/** How close you must stand to man an emergency panel. */
const PANEL_RADIUS = 0.8;
/** Reach for picking up and dropping off carryable objects. */
const ITEM_RADIUS = 0.95;
/** A relay emergency's instructions are aged this often. */
const RELAY_TICK_MS = 1000;
/** What a connection hears once its seat plays on another one: a tab opened later, say. */
const SEAT_MOVED = 'Dieser Platz spielt jetzt in einem anderen Fenster.';

/** Who stands where and what they found and see, as the room reports it in `set-presence`. */
type PresenceReport = Omit<Extract<Action, { type: 'set-presence' }>, 'type' | 'at'>;

/** Whose views a change reaches: every member's and the audience's, or only these members'. */
type Reach = 'everybody' | readonly string[];

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
  private readonly signalAllowance = new Map<string, { left: number; at: number }>();
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
  /** epoch ms since the room has had no connected players, null while occupied */
  emptySince: number | null = null;

  /**
   * `seed` pins the room's runs for a repeatable test: run n plays seed + n. `mission` comes
   * scaled to `difficulty`, the one the room opens on. `dailySalt` (dailySalt.ts) makes the
   * Tagesschicht's seeds; a room without one starts no run on it.
   */
  constructor(
    code: string,
    mission: Mission,
    private readonly onRunFinished: RunListener = () => undefined,
    seed: number | null = null,
    difficulty: Difficulty = 'normal',
    private readonly dailySalt: string | null = null,
  ) {
    this.code = code;
    this.state = initialState(mission, seed, difficulty);
  }

  /** A new seat for `name`, bound to `pass` (lobby only); its player id. */
  join(name: string, pass: CrewPass): { playerId: string } {
    const playerId = randomUUID();
    this.dispatch({ type: 'player-join', playerId, name });
    this.seats.bind(playerId, pass);
    return { playerId };
  }

  /** The seat `pass` holds in this room, by player id; null for none. */
  seatOf(pass: CrewPass): string | null {
    return this.seats.seatOf(pass);
  }

  /** Whether `listener` is the connection the seat of `playerId` plays on right now. */
  plays(playerId: string, listener: Listener): boolean {
    return this.listeners.get(playerId) === listener;
  }

  /**
   * The player whose seat `pass` holds is back, on whatever socket shows it; their player id.
   * Throws for a pass that holds no seat here, or once the run left its seat out.
   */
  resume(pass: CrewPass): string {
    const playerId = this.seats.seatOf(pass);
    if (playerId === null) {
      throw new Error('Wiederverbinden fehlgeschlagen — Raum neu beitreten.');
    }
    if (!this.state.players.some((p) => p.id === playerId)) {
      this.seats.free(playerId);
      throw new Error('Der Lauf hat ohne diese Verbindung begonnen — Raum neu beitreten.');
    }
    this.dispatch({ type: 'player-connected', playerId });
    this.reconcilePause();
    this.reconcilePlates();
    this.reconcilePresence();
    this.checkEscape();
    return playerId;
  }

  /**
   * Register the live connection for a player; push the current view and positions. Returns
   * how to let go of this very connection once it is lost. A connection the player has
   * replaced since — they resumed on a new socket before the old one was found dead, or from
   * another tab — lets go of nothing: the player stays connected on the new one, and the old
   * one hears that the seat went elsewhere.
   */
  attach(playerId: string, listener: Listener): () => void {
    const before = this.listeners.get(playerId);
    this.listeners.set(playerId, listener);
    this.emptySince = null;
    if (before !== undefined && before !== listener) {
      before({ kind: 'left', code: this.code, message: SEAT_MOVED });
    }
    listener({ kind: 'view', view: viewFor(this.state, playerId), at: Date.now() });
    if (this.positions.size > 0) {
      listener(this.positionsMessage());
    }
    return () => {
      if (this.listeners.get(playerId) === listener) {
        this.detach(playerId);
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
    return {
      spectatorId,
      detach: () => {
        this.spectators.delete(spectatorId);
        this.signalAllowance.delete(spectatorId);
      },
    };
  }

  /** Connection lost: keep the player (they may resume), notify the others. */
  private detach(playerId: string): void {
    if (!this.listeners.delete(playerId)) {
      return;
    }
    if (this.listeners.size === 0) {
      this.emptySince = Date.now();
    }
    this.dispatch({ type: 'player-disconnected', playerId });
    this.reconcilePause();
    this.reconcilePlates();
    this.reconcilePresence();
    this.checkEscape();
  }

  /** A mission needs its whole crew; freeze everything while someone is away. */
  private reconcilePause(): void {
    if (this.state.phase !== 'playing') {
      return;
    }
    const missing = this.state.players.some((p) => !p.connected);
    if (missing !== (this.state.paused !== null)) {
      this.dispatch({ type: 'set-paused', paused: missing, at: Date.now() });
    }
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
      case 'intro-done':
        this.dispatch({ type: 'intro-done', playerId, at: Date.now() });
        break;
      case 'puzzle-input':
        this.dispatch({ type: 'puzzle-input', playerId, at: Date.now(), input: msg.input });
        break;
      case 'request-hint':
        this.dispatch({ type: 'request-hint', playerId, at: Date.now() });
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
    const was = this.signalAllowance.get(member);
    const left =
      was === undefined
        ? SIGNAL_BURST
        : Math.min(SIGNAL_BURST, was.left + ((now - was.at) / 1000) * SIGNALS_PER_SEC);
    const allowed = left >= 1;
    this.signalAllowance.set(member, { left: allowed ? left - 1 : left, at: now });
    return allowed;
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

  /** Everyone standing close enough to a spot, by player id. */
  private occupantsOf(x: number, y: number, radius: number): string[] {
    return this.state.players
      .filter((player) => {
        if (!player.connected) {
          return false;
        }
        const pos = this.positions.get(player.id);
        return pos !== undefined && Math.hypot(pos.x - (x + 0.5), pos.y - (y + 0.5)) <= radius;
      })
      .map((player) => player.id);
  }

  /**
   * Translate live positions into plate and panel state; dispatch only on
   * change. Sabotage panels need a *different* player each, so they are
   * assigned greedily.
   */
  private reconcilePlates(): void {
    const map = this.state.mission.map;
    if (this.state.phase !== 'playing') {
      return;
    }
    const held = new Set(this.state.pressedPlates);
    const plates = map.plates
      .filter(
        (plate) =>
          this.occupantsOf(
            plate.x,
            plate.y,
            held.has(plate.id) ? PLATE_RELEASE_RADIUS : PLATE_PRESS_RADIUS,
          ).length > 0,
      )
      .map((plate) => plate.id)
      .sort();

    const claimed = new Set<string>();
    const panels: string[] = [];
    for (const panel of map.sabotage?.panels ?? []) {
      const free = this.occupantsOf(panel.x, panel.y, PANEL_RADIUS).find(
        (id) => !claimed.has(id),
      );
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
   * next of them. A pause freezes the run: nothing is found while it lasts, and a look begun
   * before it starts anew after it.
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
   * their glances still running; null for a player away or not placed yet. (One away pauses the
   * run, and a pause lets every glance go.)
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
   * station armed, the parts lying loose, a pause. Outside a run, just its phase.
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
   * Who stands on the exit hatch, sorted: everybody connected within
   * EXIT_RADIUS of it once it is open — the escape's own measure — and
   * nobody before.
   */
  private onTheHatch(): string[] {
    const exit = this.state.mission.map.exit;
    if (exit === undefined || !inEscapePhase(this.state)) {
      return [];
    }
    return this.occupantsOf(exit.x, exit.y, EXIT_RADIUS).sort();
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
   * console of a station on its own, keyed by `stationKey` — manual object
   * and note, who has walked up to the sign, what each player has just found
   * (`findsNow`), and who stands on the open hatch; dispatch only on change.
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
   * Who stands at each station spot, source and note, who saw the sign, who is on the hatch. At
   * a source, a note or the sign only a player who has found it — `fresh` from this very look
   * round included — counts, and at a console only one who sees it or has found it
   * (`facesConsole`): the distance alone would have them read, open, work or copy the
   * Laborkennung round a pillar or through a wall.
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
    const { stations, manuals, notes, exit, sight } = presence;
    const stood = JSON.stringify([next.stations, next.manuals, next.notes, next.exit]);
    if (
      Object.keys(next.found).length > 0 ||
      next.signSeen.length !== presence.signSeen.length ||
      stood !== JSON.stringify([stations, manuals, notes, exit])
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
   * nobody with nothing in sight. A pause stops no sight; while the power lights the whole lab
   * (`labLit`) every view shows all of it, and no sight is kept.
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
   * While a relay emergency runs, its instructions run out on the clock: the
   * reducer is told the time once a second. A pause stops the ticking.
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
    this.reconcilePause();
  }

  /**
   * Won once every connected player stands on the hatch: by the presence the
   * views carry, so that the crew's checklist and the escape never disagree.
   */
  private checkEscape(): void {
    if (!inEscapePhase(this.state)) {
      return;
    }
    const onIt = this.state.presence.exit;
    const connected = this.state.players.filter((p) => p.connected);
    if (connected.length > 0 && connected.every((player) => onIt.includes(player.id))) {
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

  /** Fixed-rate patrol simulation; only runs while a mission with drones is live in the dark. */
  private reconcileDroneTimer(): void {
    const map = this.state.mission.map;
    const live =
      lightsAreOut(this.state) && this.state.paused === null && map.drones.length > 0;
    if (live && this.droneTimer === null) {
      this.drones = new DronePatrol(map);
      this.lastDroneTick = Date.now();
      this.droneTimer = setInterval(() => this.tickDrones(), DRONE_TICK_MS);
    } else if (!live && this.droneTimer !== null) {
      clearInterval(this.droneTimer);
      this.droneTimer = null;
      this.drones = null;
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
    const wasPlaying = this.state.phase === 'playing';
    const world = this.findingWorld();
    this.state = applyAction(this.state, action);
    // A run ends exactly once, won or lost; a rematch is a run of its own.
    if (wasPlaying && (this.state.phase === 'won' || this.state.phase === 'lost')) {
      this.onRunFinished(runReport(this.state, this.code));
    }
    // A glance of one run finds nothing in the next.
    if (this.state.phase !== 'playing') {
      this.forgetGlances();
    }
    this.reconcileTimer();
    this.reconcileLights();
    this.reconcilePuzzleClock();
    this.reconcileNudge();
    this.reconcileDroneTimer();
    this.reconcileSabotage();
    this.reconcileRelayTick();
    this.broadcast(reach);
    // A door opened, a part put down, a station armed: whoever stands still sees it as well.
    if (action.type !== 'set-presence' && this.findingWorld() !== world) {
      this.reconcilePresence();
    }
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
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.lightsTimer !== null) {
      clearTimeout(this.lightsTimer);
      this.lightsTimer = null;
    }
    if (this.puzzleTimer !== null) {
      clearTimeout(this.puzzleTimer);
      this.puzzleTimer = null;
    }
    if (this.nudgeTimer !== null) {
      clearTimeout(this.nudgeTimer);
      this.nudgeTimer = null;
    }
    this.forgetGlances();
    if (this.positionsTimer !== null) {
      clearTimeout(this.positionsTimer);
      this.positionsTimer = null;
    }
    if (this.keepaliveTimer !== null) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.droneTimer !== null) {
      clearInterval(this.droneTimer);
      this.droneTimer = null;
      this.drones = null;
    }
    if (this.sabotageTimer !== null) {
      clearTimeout(this.sabotageTimer);
      this.sabotageTimer = null;
    }
    if (this.relayTimer !== null) {
      clearInterval(this.relayTimer);
      this.relayTimer = null;
    }
  }
}
