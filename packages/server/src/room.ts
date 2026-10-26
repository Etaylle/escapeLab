import { randomInt, randomUUID } from 'node:crypto';
import { DronePatrol } from './drones.js';
import {
  applyAction,
  armedStations,
  canSee,
  emergenciesDue,
  inEscapePhase,
  initialState,
  lightsAreOut,
  noteKey,
  noteSpot,
  nudgeDueAt,
  puzzleDueAt,
  runReport,
  shutDoors,
  stationKey,
  stepAllowed,
  viewFor,
  viewForSpectator,
  type Action,
  type ChatPhrase,
  type ClientMessage,
  type Difficulty,
  type GameState,
  type MapDef,
  type Mission,
  type PlayerPosition,
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
      | 'start-mission'
      | 'intro-done'
      | 'puzzle-input'
      | 'request-hint'
      | 'open-source'
      | 'read-note'
      | 'interact'
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
/**
 * A manual object is found for the whole crew once somebody comes this close
 * (in tiles) and has it in sight: through a wall nobody finds anything.
 */
const DISCOVER_RADIUS = 3.5;
/** How close to the armed station an interact is accepted. */
const INTERACT_RADIUS = 1.6;
/** Everyone must stand on the exit hatch itself (below one tile) to escape. */
const EXIT_RADIUS = 0.7;
/** Positions fan out at most this often. */
const POSITIONS_INTERVAL_MS = 66;
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

/**
 * One game room: owns the authoritative GameState, player sessions
 * (reconnect tokens), the mission timer and the live avatar positions.
 * Movement is client-authoritative within limits: the room takes only steps
 * an avatar can walk, turns positions into plate state and presence and
 * validates interaction distance. Every run that ends goes to
 * `onRunFinished` as a report. Transport-agnostic.
 */
export class Room {
  readonly code: string;
  private state: GameState;
  private readonly tokens = new Map<string, string>();
  private readonly listeners = new Map<string, Listener>();
  /** audience connections, by the id each got on attaching */
  private readonly spectators = new Map<string, Listener>();
  private readonly positions = new Map<string, PlayerPosition>();
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
  /** the mission the host's yes on the end screen named for the next run; null: the same again */
  private next: Mission | null = null;
  private timer: NodeJS.Timeout | null = null;
  private positionsTimer: NodeJS.Timeout | null = null;
  private positionsDirty = false;
  /** steps refused in this room so far, for the log */
  private refusedSteps = 0;
  /** epoch ms since the room has had no connected players, null while occupied */
  emptySince: number | null = null;

  /**
   * `seed` pins the room's runs for a repeatable test: run n plays seed + n. `mission` comes
   * scaled to `difficulty`, the one the room opens on.
   */
  constructor(
    code: string,
    mission: Mission,
    private readonly onRunFinished: RunListener = () => undefined,
    seed: number | null = null,
    difficulty: Difficulty = 'normal',
  ) {
    this.code = code;
    this.state = initialState(mission, seed, difficulty);
  }

  /** Add a new player (lobby only). Returns credentials for later resume. */
  join(name: string): { playerId: string; token: string } {
    const playerId = randomUUID();
    this.dispatch({ type: 'player-join', playerId, name });
    const token = randomUUID();
    this.tokens.set(playerId, token);
    return { playerId, token };
  }

  /** Re-authenticate a returning player. Throws on a bad token, or once the run left them out. */
  resume(playerId: string, token: string): void {
    if (this.tokens.get(playerId) !== token) {
      throw new Error('Wiederverbinden fehlgeschlagen — Raum neu beitreten.');
    }
    if (!this.state.players.some((p) => p.id === playerId)) {
      this.tokens.delete(playerId);
      throw new Error('Der Lauf hat ohne diese Verbindung begonnen — Raum neu beitreten.');
    }
    this.dispatch({ type: 'player-connected', playerId });
    this.reconcilePause();
    this.reconcilePlates();
    this.reconcilePresence();
    this.checkEscape();
  }

  /**
   * Register the live connection for a player; push the current view and positions. Returns
   * how to let go of this very connection once it is lost. A connection the player has
   * replaced since — they resumed on a new socket before the old one was found dead — lets
   * go of nothing: the player stays connected on the new one.
   */
  attach(playerId: string, listener: Listener): () => void {
    this.listeners.set(playerId, listener);
    this.emptySince = null;
    listener({ kind: 'view', view: viewFor(this.state, playerId) });
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
    listener({ kind: 'spectator-view', view: viewForSpectator(this.state), code: this.code });
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
   */
  updatePosition(playerId: string, run: number, pos: PlayerPosition): void {
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
    this.positions.set(playerId, pos);
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
      case 'start-mission':
        this.dispatch({
          type: 'start-mission',
          playerId,
          at: Date.now(),
          seed: randomInt(2 ** 31),
        });
        this.next = null;
        this.seedPositions();
        break;
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
      case 'interact':
        this.resolveInteract(playerId);
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

  /** The next run, started by `playerId`: of the mission the host's yes named, if it named one. */
  private startRematch(playerId: string): void {
    this.positions.clear();
    const next = this.next;
    this.dispatch({
      type: 'rematch',
      playerId,
      at: Date.now(),
      seed: randomInt(2 ** 31),
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

  /** Quick-chat phrase: fan out to everyone, rate-limited per player. */
  chat(playerId: string, phrase: ChatPhrase): void {
    const now = Date.now();
    if (now - (this.lastChatAt.get(playerId) ?? 0) < CHAT_COOLDOWN_MS) {
      return;
    }
    this.lastChatAt.set(playerId, now);
    for (const listener of this.audience) {
      listener({ kind: 'chat', playerId, phrase });
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

  /** Whether the armed station — any of its consoles — lies within this player's reach. */
  private stationInReach(playerId: string): boolean {
    const pos = this.positions.get(playerId);
    return (
      pos !== undefined &&
      armedStations(this.state.mission.map, this.state).some(
        (station) =>
          Math.hypot(pos.x - (station.x + 0.5), pos.y - (station.y + 0.5)) <= INTERACT_RADIUS,
      )
    );
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

  /** Whether a connected player within DISCOVER_RADIUS of a source's tile has it in sight. */
  private sighted(spot: { x: number; y: number }, shut: ReadonlySet<string>): boolean {
    const middle = { x: spot.x + 0.5, y: spot.y + 0.5 };
    return this.occupantsOf(spot.x, spot.y, DISCOVER_RADIUS).some((id) => {
      const pos = this.positions.get(id);
      return pos !== undefined && canSee(this.state.mission.map, pos, middle, shut);
    });
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
   * and note, who has walked up to the sign, which manual objects and notes
   * somebody has come close to and seen for the first time, and who stands on
   * the open hatch; dispatch only on change.
   */
  private reconcilePresence(): void {
    const map = this.state.mission.map;
    if (this.state.phase !== 'playing') {
      return;
    }
    const { presence, places, discovered, notesFound } = this.state;
    const stations = this.atEach(
      map.stations.map((s) => ({ id: stationKey(s), x: s.x, y: s.y })),
      presence.stations,
    );
    const sources = map.manuals.flatMap((m) => {
      const at = places[m.id];
      return at === undefined ? [] : [{ id: m.id, x: at.x, y: at.y }];
    });
    const manuals = this.atEach(sources, presence.manuals);
    const pinned = this.noteSpots();
    const notes = this.atEach(pinned, presence.notes);
    const sign = map.edgeworkSign;
    const signSeen =
      sign === undefined
        ? presence.signSeen
        : [...new Set([...presence.signSeen, ...this.presentAt(sign.x, sign.y, [])])].sort();
    const shut = shutDoors(map, this.state);
    const seen = sources
      .filter((s) => !discovered.includes(s.id) && this.sighted(s, shut))
      .map((s) => s.id);
    const notesSeen = pinned
      .filter((n) => !notesFound.includes(n.index) && this.sighted(n, shut))
      .map((n) => n.index);
    const exit = this.onTheHatch();
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    if (
      !same(stations, presence.stations) ||
      !same(manuals, presence.manuals) ||
      !same(notes, presence.notes) ||
      signSeen.length !== presence.signSeen.length ||
      seen.length + notesSeen.length > 0 ||
      !same(exit, presence.exit)
    ) {
      const action = { stations, manuals, notes, signSeen, seen, notesSeen, exit };
      this.dispatch({ type: 'set-presence', ...action });
    }
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
    for (const listener of this.audience) {
      listener(msg);
    }
  }

  /** Where everybody stands right now, stamped with the run it belongs to. */
  private positionsMessage(): ServerMessage {
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
    this.positionsDirty = true;
    this.schedulePositionsBroadcast();
  }

  private positionSnapshot(): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    for (const [id, pos] of this.positions) {
      out.set(id, { x: pos.x, y: pos.y });
    }
    return out;
  }

  private dispatch(action: Action): void {
    const wasPlaying = this.state.phase === 'playing';
    this.state = applyAction(this.state, action);
    // A run ends exactly once, won or lost; a rematch is a run of its own.
    if (wasPlaying && (this.state.phase === 'won' || this.state.phase === 'lost')) {
      this.onRunFinished(runReport(this.state, this.code));
    }
    this.reconcileTimer();
    this.reconcileLights();
    this.reconcilePuzzleClock();
    this.reconcileNudge();
    this.reconcileDroneTimer();
    this.reconcileSabotage();
    this.reconcileRelayTick();
    this.broadcast();
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

  private broadcast(): void {
    for (const [playerId, listener] of this.listeners) {
      listener({ kind: 'view', view: viewFor(this.state, playerId) });
    }
    if (this.spectators.size > 0) {
      const view = viewForSpectator(this.state);
      for (const listener of this.spectators.values()) {
        listener({ kind: 'spectator-view', view, code: this.code });
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
    if (this.positionsTimer !== null) {
      clearTimeout(this.positionsTimer);
      this.positionsTimer = null;
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
