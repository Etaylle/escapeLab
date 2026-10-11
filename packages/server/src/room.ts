import { randomInt, randomUUID } from 'node:crypto';
import {
  applyAction,
  armedStation,
  inEscapePhase,
  initialState,
  viewFor,
  type Action,
  type ClientMessage,
  type GameState,
  type Mission,
  type PlayerPosition,
  type ServerMessage,
} from '@escapelab/core';

type Listener = (msg: ServerMessage) => void;

/** The subset of client messages that map 1:1 onto game actions. */
export type GameMessage = Extract<
  ClientMessage,
  {
    kind:
      | 'select-role'
      | 'start-mission'
      | 'press-button'
      | 'cut-wire'
      | 'press-key'
      | 'toggle-switch'
      | 'commit-switches'
      | 'press-simon'
      | 'interact'
      | 'back-to-lobby';
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
  private readonly positions = new Map<string, PlayerPosition>();
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
    this.reconcilePlates();
    this.checkEscape();
  }

  /** Register the live connection for a player; push the current view and positions. */
  attach(playerId: string, listener: Listener): void {
    this.listeners.set(playerId, listener);
    this.emptySince = null;
    listener({ kind: 'view', view: viewFor(this.state, playerId) });
    if (this.positions.size > 0) {
      listener({ kind: 'positions', players: Object.fromEntries(this.positions) });
    }
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
    this.reconcilePlates();
    this.checkEscape();
  }

  /** Client-authoritative avatar position; feeds plates and the position fan-out. */
  updatePosition(playerId: string, pos: PlayerPosition): void {
    if (this.state.phase !== 'playing' || this.state.mission.map === undefined) {
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
      case 'interact':
        this.requireNearStation(playerId);
        this.dispatch({ type: 'interact', playerId, at: Date.now() });
        break;
      case 'back-to-lobby':
        this.positions.clear();
        this.dispatch({ type: 'back-to-lobby', playerId });
        break;
    }
  }

  /** Host switches the lobby to a different mission (validated by the reducer). */
  switchMission(playerId: string, mission: Mission): void {
    this.dispatch({ type: 'switch-mission', playerId, mission });
  }

  private requireNearStation(playerId: string): void {
    const map = this.state.mission.map;
    if (map === undefined) {
      return; // reducer rejects with a clear message
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

  /** Translate live positions into plate state; dispatch only on change. */
  private reconcilePlates(): void {
    const map = this.state.mission.map;
    if (this.state.phase !== 'playing' || map === undefined) {
      return;
    }
    const held = new Set(this.state.pressedPlates);
    const next: string[] = [];
    for (const plate of map.plates) {
      const radius = held.has(plate.id) ? PLATE_RELEASE_RADIUS : PLATE_PRESS_RADIUS;
      const pressed = this.state.players.some((player) => {
        if (!player.connected) {
          return false;
        }
        const pos = this.positions.get(player.id);
        return (
          pos !== undefined &&
          Math.hypot(pos.x - (plate.x + 0.5), pos.y - (plate.y + 0.5)) <= radius
        );
      });
      if (pressed) {
        next.push(plate.id);
      }
    }
    next.sort();
    const current = [...this.state.pressedPlates].sort();
    if (next.length !== current.length || next.some((id, i) => id !== current[i])) {
      this.dispatch({ type: 'set-pressed-plates', plates: next });
    }
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
    for (const listener of this.listeners.values()) {
      listener({ kind: 'positions', players });
    }
  }

  private dispatch(action: Action): void {
    this.state = applyAction(this.state, action);
    this.reconcileTimer();
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
    if (this.state.phase === 'playing' && this.state.deadlineAt !== null) {
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
  }
}
