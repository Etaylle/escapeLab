import { randomInt, randomUUID } from 'node:crypto';
import { DronePatrol } from './drones.js';
import {
  applyAction,
  armedStation,
  inEscapePhase,
  initialState,
  viewFor,
  viewForSpectator,
  type Action,
  type ChatPhrase,
  type ClientMessage,
  type Difficulty,
  type GameState,
  type Mission,
  type PlayerPosition,
  type RoomSummary,
  type ServerMessage,
} from '@escapelab/core';

type Listener = (msg: ServerMessage) => void;

/** The subset of client messages that map 1:1 onto game actions. */
export type GameMessage = Extract<
  ClientMessage,
  {
    kind:
      | 'select-role'
      | 'select-color'
      | 'set-ready'
      | 'start-mission'
      | 'press-button'
      | 'cut-wire'
      | 'press-key'
      | 'toggle-switch'
      | 'commit-switches'
      | 'press-simon'
      | 'move-maze'
      | 'request-hint'
      | 'interact'
      | 'drop-item'
      | 'back-to-lobby'
      | 'rematch';
  }
>;

/** A plate holds while someone is this close (in tiles); releases a bit wider. */
const PLATE_PRESS_RADIUS = 0.55;
const PLATE_RELEASE_RADIUS = 0.75;
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
/** Patrol simulation step. */
const DRONE_TICK_MS = 80;
/** How close you must stand to man an emergency panel. */
const PANEL_RADIUS = 0.8;
/** Reach for picking up and dropping off carryable objects. */
const ITEM_RADIUS = 0.95;
/**
 * Emergencies only start once this many stations are done: before that the
 * crew may still be locked in its separate starting rooms.
 */
const SABOTAGE_AFTER_PUZZLES = 2;

/**
 * One game room: owns the authoritative GameState, player sessions
 * (reconnect tokens), the mission timer and the live avatar positions.
 * Movement is client-authoritative; the room turns positions into plate
 * state and validates interaction distance. Transport-agnostic.
 */
export class Room {
  readonly code: string;
  private state: GameState;
  private readonly tokens = new Map<string, string>();
  private readonly listeners = new Map<string, Listener>();
  private readonly spectators = new Set<Listener>();
  private readonly positions = new Map<string, PlayerPosition>();
  private readonly lastPingAt = new Map<string, number>();
  private readonly lastChatAt = new Map<string, number>();
  private drones: DronePatrol | null = null;
  private droneTimer: NodeJS.Timeout | null = null;
  private lastDroneTick = 0;
  private sabotageTimer: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private positionsTimer: NodeJS.Timeout | null = null;
  private positionsDirty = false;
  /** epoch ms since the room has had no connected players, null while occupied */
  emptySince: number | null = null;

  constructor(code: string, mission: Mission) {
    this.code = code;
    this.state = initialState(mission);
  }

  /** Add a new player (lobby only). Returns credentials for later resume. */
  join(name: string): { playerId: string; token: string } {
    const playerId = randomUUID();
    this.dispatch({ type: 'player-join', playerId, name });
    const token = randomUUID();
    this.tokens.set(playerId, token);
    return { playerId, token };
  }

  /** Re-authenticate a returning player. Throws on a bad token. */
  resume(playerId: string, token: string): void {
    if (this.tokens.get(playerId) !== token) {
      throw new Error('Wiederverbinden fehlgeschlagen — Raum neu beitreten.');
    }
    this.dispatch({ type: 'player-connected', playerId });
    this.reconcilePause();
    this.reconcilePlates();
    this.checkEscape();
  }

  /** Register the live connection for a player; push the current view and positions. */
  attach(playerId: string, listener: Listener): void {
    this.listeners.set(playerId, listener);
    this.emptySince = null;
    listener({ kind: 'view', view: viewFor(this.state, playerId) });
    if (this.positions.size > 0) {
      listener({
        kind: 'positions',
        players: Object.fromEntries(this.positions),
        drones: this.drones?.snapshot(this.state, Date.now()) ?? {},
      });
    }
  }

  /**
   * Audience connection: read-only, gets the revealing view plus the same
   * live position, ping and chat stream the players get.
   */
  attachSpectator(listener: Listener): () => void {
    this.spectators.add(listener);
    listener({ kind: 'spectator-view', view: viewForSpectator(this.state), code: this.code });
    if (this.positions.size > 0) {
      listener({
        kind: 'positions',
        players: Object.fromEntries(this.positions),
        drones: this.drones?.snapshot(this.state, Date.now()) ?? {},
      });
    }
    return () => this.spectators.delete(listener);
  }

  /** Connection lost: keep the player (they may resume), notify the others. */
  detach(playerId: string): void {
    if (!this.listeners.delete(playerId)) {
      return;
    }
    if (this.listeners.size === 0) {
      this.emptySince = Date.now();
    }
    this.dispatch({ type: 'player-disconnected', playerId });
    this.reconcilePause();
    this.reconcilePlates();
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

  /** Client-authoritative avatar position; feeds plates and the position fan-out. */
  updatePosition(playerId: string, pos: PlayerPosition): void {
    if (
      this.state.phase !== 'playing' ||
      this.state.paused !== null ||
      this.state.mission.map === undefined
    ) {
      return;
    }
    this.positions.set(playerId, pos);
    this.positionsDirty = true;
    this.reconcilePlates();
    this.checkEscape();
    this.schedulePositionsBroadcast();
  }

  /** Player-triggered game actions coming in from the transport layer. */
  act(playerId: string, msg: GameMessage): void {
    switch (msg.kind) {
      case 'select-role':
        this.dispatch({ type: 'select-role', playerId, roleId: msg.roleId });
        break;
      case 'select-color':
        this.dispatch({ type: 'select-color', playerId, color: msg.color });
        break;
      case 'set-ready':
        this.dispatch({ type: 'set-ready', playerId, ready: msg.ready });
        this.checkRematch();
        break;
      case 'start-mission':
        this.dispatch({
          type: 'start-mission',
          playerId,
          at: Date.now(),
          seed: randomInt(2 ** 31),
        });
        this.seedPositions();
        break;
      case 'press-button':
        this.dispatch({ type: 'press-button', playerId, at: Date.now() });
        break;
      case 'cut-wire':
        this.dispatch({ type: 'cut-wire', playerId, wireId: msg.wireId, at: Date.now() });
        break;
      case 'press-key':
        this.dispatch({ type: 'press-key', playerId, keyIndex: msg.keyIndex, at: Date.now() });
        break;
      case 'toggle-switch':
        this.dispatch({
          type: 'toggle-switch',
          playerId,
          switchIndex: msg.switchIndex,
          at: Date.now(),
        });
        break;
      case 'commit-switches':
        this.dispatch({ type: 'commit-switches', playerId, at: Date.now() });
        break;
      case 'press-simon':
        this.dispatch({
          type: 'press-simon',
          playerId,
          buttonIndex: msg.buttonIndex,
          at: Date.now(),
        });
        break;
      case 'move-maze':
        this.dispatch({ type: 'move-maze', playerId, dir: msg.dir, at: Date.now() });
        break;
      case 'request-hint':
        this.dispatch({ type: 'request-hint', playerId, at: Date.now() });
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
        break;
      case 'rematch':
        this.positions.clear();
        this.dispatch({
          type: 'rematch',
          playerId,
          at: Date.now(),
          seed: randomInt(2 ** 31),
        });
        this.seedPositions();
        break;
    }
  }

  /** Map ping: fan out to everyone, rate-limited per player. */
  ping(playerId: string, x: number, y: number): void {
    if (this.state.phase !== 'playing' || this.state.mission.map === undefined) {
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

  /** One row for the lobby browser. */
  summary(): RoomSummary {
    const capacity = this.state.mission.roles.length;
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
   * One key does the obvious thing: deliver what you carry, otherwise pick up
   * what lies at your feet, otherwise switch on the station in front of you.
   */
  private resolveInteract(playerId: string): void {
    const map = this.state.mission.map;
    const pos = this.positions.get(playerId);
    if (map === undefined || pos === undefined) {
      this.requireNearStation(playerId);
      this.dispatch({ type: 'interact', playerId, at: Date.now() });
      return;
    }
    const near = (x: number, y: number): boolean =>
      Math.hypot(pos.x - x, pos.y - y) <= ITEM_RADIUS;

    const carried = map.items.find((def) => this.state.items[def.id]?.carriedBy === playerId);
    if (carried !== undefined) {
      if (!near(carried.deliverTo.x + 0.5, carried.deliverTo.y + 0.5)) {
        throw new Error(
          `Du trägst ${carried.label} — bring es zum markierten Platz (oder lege es mit Q ab).`,
        );
      }
      this.dispatch({ type: 'deliver-item', playerId, itemId: carried.id, at: Date.now() });
      return;
    }

    const loose = map.items.find((def) => {
      const live = this.state.items[def.id];
      return live !== undefined && !live.delivered && live.carriedBy === null && near(live.x, live.y);
    });
    if (loose !== undefined) {
      this.dispatch({ type: 'pick-item', playerId, itemId: loose.id, at: Date.now() });
      return;
    }

    this.requireNearStation(playerId);
    this.dispatch({ type: 'interact', playerId, at: Date.now() });
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
    const map = this.state.mission.map;
    if (map === undefined || this.state.paused !== null) {
      return; // reducer rejects with a clearer message
    }
    const station = armedStation(map, this.state);
    const pos = this.positions.get(playerId);
    if (station === null || pos === undefined) {
      throw new Error('Hier gibt es nichts zu aktivieren — geht zur leuchtenden Station.');
    }
    const dist = Math.hypot(pos.x - (station.x + 0.5), pos.y - (station.y + 0.5));
    if (dist > INTERACT_RADIUS) {
      throw new Error('Zu weit weg — stell dich direkt an die leuchtende Station.');
    }
  }

  /** Place every avatar at its role spawn when a mapped mission starts. */
  private seedPositions(): void {
    const map = this.state.mission.map;
    if (this.state.phase !== 'playing' || map === undefined) {
      return;
    }
    this.positions.clear();
    for (const player of this.state.players) {
      const spawn = player.roleId !== null ? map.spawns[player.roleId] : undefined;
      this.positions.set(player.id, {
        x: (spawn?.x ?? 1) + 0.5,
        y: (spawn?.y ?? 1) + 0.5,
        facing: 0,
        moving: false,
      });
    }
    this.positionsDirty = true;
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
    if (this.state.phase !== 'playing' || map === undefined) {
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

  /** All panels manned at once ends the emergency. */
  private checkSabotageCleared(): void {
    const sabotage = this.state.mission.map?.sabotage;
    if (this.state.sabotage === null || sabotage === undefined) {
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
    const sabotage = this.state.mission.map?.sabotage;
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
    // Not before the crew is out of its starting rooms (two stations done),
    // and not once they are already running for the hatch.
    const solved = this.state.currentPuzzleIndex;
    if (solved < SABOTAGE_AFTER_PUZZLES || solved >= this.state.mission.puzzles.length) {
      return;
    }
    const sinceStart = Date.now() - (this.state.startedAt ?? Date.now());
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
   * After a run, the next one starts by itself as soon as the whole crew has
   * said yes — nobody has to be the one who presses go.
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
    this.positions.clear();
    this.dispatch({
      type: 'rematch',
      playerId: host.id,
      at: Date.now(),
      seed: randomInt(2 ** 31),
    });
    this.seedPositions();
    this.reconcilePause();
  }

  /** Won once every connected player stands in the exit zone. */
  private checkEscape(): void {
    const exit = this.state.mission.map?.exit;
    if (exit === undefined || !inEscapePhase(this.state)) {
      return;
    }
    const connected = this.state.players.filter((p) => p.connected);
    const everyoneOut =
      connected.length > 0 &&
      connected.every((player) => {
        const pos = this.positions.get(player.id);
        return (
          pos !== undefined &&
          Math.hypot(pos.x - (exit.x + 0.5), pos.y - (exit.y + 0.5)) <= EXIT_RADIUS
        );
      });
    if (everyoneOut) {
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
    const players = Object.fromEntries(this.positions);
    const drones = this.drones?.snapshot(this.state, Date.now()) ?? {};
    for (const listener of this.audience) {
      listener({ kind: 'positions', players, drones });
    }
  }

  /** Fixed-rate patrol simulation; only runs while a mission with drones is live. */
  private reconcileDroneTimer(): void {
    const map = this.state.mission.map;
    const live =
      this.state.phase === 'playing' &&
      this.state.paused === null &&
      map !== undefined &&
      map.drones.length > 0;
    if (live && this.droneTimer === null && map !== undefined) {
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
    for (const event of spotted) {
      this.dispatch({ type: 'drone-spotted', at: now, penaltySec: event.penaltySec });
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
    this.state = applyAction(this.state, action);
    this.reconcileTimer();
    this.reconcileDroneTimer();
    this.reconcileSabotage();
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
      for (const listener of this.spectators) {
        listener({ kind: 'spectator-view', view, code: this.code });
      }
    }
  }

  /** Everyone attached to this room, players and audience alike. */
  private get audience(): Listener[] {
    return [...this.listeners.values(), ...this.spectators];
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
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
  }
}
