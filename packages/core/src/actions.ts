import {
  CREW_COLORS,
  type GameState,
  type ItemState,
  type Player,
  type PuzzleState,
} from './state.js';
import type { Difficulty } from './difficulty.js';
import type { Mission, PuzzleDef } from './mission.js';
import { mulberry32 } from './rng.js';
import { initButtonSync, pressButton } from './puzzles/buttonSync.js';
import { cutWire, initWiring } from './puzzles/wiring.js';
import { initKeypad, pressKey } from './puzzles/keypad.js';
import { commitSwitches, initSwitches, toggleSwitch } from './puzzles/switches.js';
import { initSimon, pressSimon } from './puzzles/simon.js';
import { initMaze, moveMaze } from './puzzles/maze.js';
import { armedStation } from './map.js';

/**
 * All game actions. `at` is the authoritative server time (epoch ms) and
 * `seed` the server-rolled PRNG seed — the reducer itself never reads a
 * clock or RNG, which keeps every game deterministic and replayable.
 */
export type Action =
  | { type: 'player-join'; playerId: string; name: string }
  | { type: 'player-connected'; playerId: string }
  | { type: 'player-disconnected'; playerId: string }
  | { type: 'select-role'; playerId: string; roleId: string }
  | { type: 'select-color'; playerId: string; color: string }
  | { type: 'switch-mission'; playerId: string; mission: Mission; difficulty: Difficulty }
  | { type: 'start-mission'; playerId: string; at: number; seed: number }
  | { type: 'press-button'; playerId: string; at: number }
  | { type: 'cut-wire'; playerId: string; wireId: string; at: number }
  | { type: 'press-key'; playerId: string; keyIndex: number; at: number }
  | { type: 'toggle-switch'; playerId: string; switchIndex: number; at: number }
  | { type: 'commit-switches'; playerId: string; at: number }
  | { type: 'press-simon'; playerId: string; buttonIndex: number; at: number }
  | { type: 'move-maze'; playerId: string; dir: number; at: number }
  | { type: 'set-occupancy'; plates: string[]; panels: string[] }
  | { type: 'drone-spotted'; at: number; penaltySec: number }
  | { type: 'sabotage-start'; at: number }
  | { type: 'sabotage-cleared'; at: number }
  | { type: 'sabotage-expired'; at: number }
  | { type: 'set-paused'; paused: boolean; at: number }
  | { type: 'pick-item'; playerId: string; itemId: string; at: number }
  | { type: 'drop-item'; playerId: string; itemId: string; x: number; y: number; at: number }
  | { type: 'deliver-item'; playerId: string; itemId: string; at: number }
  | { type: 'interact'; playerId: string; at: number }
  | { type: 'escaped'; at: number }
  | { type: 'time-expired'; at: number }
  | { type: 'back-to-lobby'; playerId: string };

/** Rejected action: the message is shown to the acting player. */
export class GameError extends Error {}

function fail(message: string): never {
  throw new GameError(message);
}

function findPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((p) => p.id === playerId);
  return player ?? fail('Unbekannter Spieler — bitte Raum neu beitreten.');
}

function requireHost(state: GameState, playerId: string): void {
  if (!findPlayer(state, playerId).isHost) {
    fail('Nur der Host (erste Spieler im Raum) kann das.');
  }
}

export function applyAction(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'player-join':
      return playerJoin(state, action);
    case 'player-connected':
      return setConnected(state, action.playerId, true);
    case 'player-disconnected':
      return setConnected(state, action.playerId, false);
    case 'select-role':
      return selectRole(state, action);
    case 'select-color':
      return selectColor(state, action);
    case 'switch-mission':
      return switchMission(state, action);
    case 'start-mission':
      return startMission(state, action);
    case 'press-button':
      return handlePress(state, action);
    case 'cut-wire':
      return handleCutWire(state, action);
    case 'press-key':
      return handlePressKey(state, action);
    case 'toggle-switch':
      return handleToggleSwitch(state, action);
    case 'commit-switches':
      return handleCommitSwitches(state, action);
    case 'press-simon':
      return handlePressSimon(state, action);
    case 'move-maze':
      return handleMoveMaze(state, action);
    case 'set-occupancy':
      return state.phase === 'playing'
        ? {
            ...state,
            pressedPlates: [...action.plates].sort(),
            occupiedPanels: [...action.panels].sort(),
          }
        : state;
    case 'sabotage-start':
      return startSabotage(state, action);
    case 'sabotage-cleared':
      return state.sabotage === null ? state : { ...state, sabotage: null };
    case 'sabotage-expired':
      return expireSabotage(state, action);
    case 'set-paused':
      return setPaused(state, action);
    case 'pick-item':
      return pickItem(state, action);
    case 'drop-item':
      return dropItem(state, action);
    case 'deliver-item':
      return deliverItem(state, action);
    case 'drone-spotted':
      return state.phase === 'playing'
        ? applyPenalty(state, action.penaltySec, action.at)
        : state;
    case 'interact':
      return handleInteract(state, action);
    case 'escaped':
      return handleEscaped(state, action);
    case 'time-expired':
      return state.phase === 'playing' && state.paused === null
        ? { ...state, phase: 'lost', finishedAt: action.at, puzzleState: null }
        : state;
    case 'back-to-lobby':
      return backToLobby(state, action);
  }
}

function switchMission(
  state: GameState,
  action: { playerId: string; mission: Mission; difficulty: Difficulty },
): GameState {
  if (state.phase !== 'lobby') {
    fail('Die Mission kann nur in der Lobby gewechselt werden.');
  }
  requireHost(state, action.playerId);
  if (state.players.length > action.mission.roles.length) {
    fail(
      `Für "${action.mission.title}" sind zu viele Spieler im Raum ` +
        `(max. ${action.mission.roles.length}).`,
    );
  }
  const sameMission = state.mission.id === action.mission.id;
  // Role ids may differ between missions, so a real switch resets the picks.
  const players = sameMission
    ? state.players
    : state.players.map((p) => ({ ...p, roleId: null }));
  return { ...state, mission: action.mission, difficulty: action.difficulty, players };
}

function playerJoin(
  state: GameState,
  action: { playerId: string; name: string },
): GameState {
  if (state.phase !== 'lobby') {
    fail('Die Mission läuft bereits — Beitritt ist nur in der Lobby möglich.');
  }
  if (state.players.length >= state.mission.roles.length) {
    fail(`Der Raum ist voll (max. ${state.mission.roles.length} Spielende für diese Mission).`);
  }
  const name = action.name.trim();
  if (name.length === 0) {
    fail('Bitte einen Namen eingeben.');
  }
  const taken = new Set(state.players.map((p) => p.color));
  const player: Player = {
    id: action.playerId,
    name,
    roleId: null,
    color: CREW_COLORS.find((c) => !taken.has(c)) ?? CREW_COLORS[0],
    connected: true,
    isHost: state.players.length === 0,
  };
  return { ...state, players: [...state.players, player] };
}

function selectColor(
  state: GameState,
  action: { playerId: string; color: string },
): GameState {
  if (state.phase !== 'lobby') {
    fail('Die Farbe lässt sich nur in der Lobby ändern.');
  }
  findPlayer(state, action.playerId);
  if (!CREW_COLORS.some((c) => c === action.color)) {
    fail('Diese Farbe gibt es nicht.');
  }
  const takenBy = state.players.find((p) => p.color === action.color);
  if (takenBy !== undefined && takenBy.id !== action.playerId) {
    fail(`Die Farbe trägt schon ${takenBy.name}.`);
  }
  const players = state.players.map((p) =>
    p.id === action.playerId ? { ...p, color: action.color } : p,
  );
  return { ...state, players };
}

function setConnected(state: GameState, playerId: string, connected: boolean): GameState {
  const players = state.players.map((p) => (p.id === playerId ? { ...p, connected } : p));
  return { ...state, players };
}

function selectRole(
  state: GameState,
  action: { playerId: string; roleId: string },
): GameState {
  if (state.phase !== 'lobby') {
    fail('Rollen können nur in der Lobby gewechselt werden.');
  }
  findPlayer(state, action.playerId);
  if (!state.mission.roles.some((r) => r.id === action.roleId)) {
    fail('Diese Rolle gibt es in der Mission nicht.');
  }
  const takenBy = state.players.find((p) => p.roleId === action.roleId);
  if (takenBy !== undefined && takenBy.id !== action.playerId) {
    fail(`Die Rolle ist schon von ${takenBy.name} besetzt.`);
  }
  const players = state.players.map((p) =>
    p.id === action.playerId ? { ...p, roleId: action.roleId } : p,
  );
  return { ...state, players };
}

function initPuzzleState(state: GameState, index: number): PuzzleState {
  const def = state.mission.puzzles[index];
  if (def === undefined) {
    throw new Error(`mission "${state.mission.id}" has no puzzle at index ${index}`);
  }
  // Distinct deterministic stream per puzzle.
  const rng = mulberry32(((state.seed ?? 0) + index * 7919) >>> 0);
  switch (def.type) {
    case 'button-sync':
      return initButtonSync();
    case 'wiring':
      return initWiring(def, rng);
    case 'keypad':
      return initKeypad(def, rng);
    case 'switches':
      return initSwitches(def, rng);
    case 'simon':
      return initSimon(def, rng);
    case 'maze':
      return initMaze(def, rng);
  }
}

function startMission(
  state: GameState,
  action: { playerId: string; at: number; seed: number },
): GameState {
  if (state.phase !== 'lobby') {
    fail('Die Mission läuft bereits.');
  }
  requireHost(state, action.playerId);
  const assigned = new Set(
    state.players.map((p) => p.roleId).filter((r): r is string => r !== null),
  );
  const missing = state.mission.roles.filter((r) => !assigned.has(r.id));
  if (missing.length > 0) {
    fail(`Noch unbesetzte Rollen: ${missing.map((r) => r.name).join(', ')}.`);
  }
  const map = state.mission.map;
  const started: GameState = {
    ...state,
    phase: 'playing',
    currentPuzzleIndex: 0,
    seed: action.seed,
    pressedPlates: [],
    occupiedPanels: [],
    sabotage: null,
    paused: null,
    items: Object.fromEntries(
      (map?.items ?? []).map((item) => [
        item.id,
        { x: item.x + 0.5, y: item.y + 0.5, carriedBy: null, delivered: false },
      ]),
    ),
    startedAt: action.at,
    deadlineAt: action.at + state.mission.timeLimitSec * 1000,
    finishedAt: null,
    penaltySeq: 0,
    lastPenaltySec: null,
  };
  // With a map, puzzles wait for station activation; without one they chain directly.
  return { ...started, puzzleState: map === undefined ? initPuzzleState(started, 0) : null };
}

/** Common guards for in-game actions; returns the acting player's current puzzle. */
function requirePlaying(
  state: GameState,
  playerId: string,
  at: number,
): { player: Player; def: PuzzleDef; puzzleState: PuzzleState } | 'lost' {
  if (state.paused !== null) {
    fail('Die Mission ist pausiert — es fehlt jemand aus der Crew.');
  }
  if (state.phase !== 'playing' || state.puzzleState === null) {
    fail('Gerade läuft kein Rätsel.');
  }
  if (state.deadlineAt !== null && at >= state.deadlineAt) {
    return 'lost';
  }
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (def === undefined) {
    fail('Gerade läuft kein Rätsel.');
  }
  return { player: findPlayer(state, playerId), def, puzzleState: state.puzzleState };
}

/** True once every puzzle is solved and the crew still has to reach the exit. */
export function inEscapePhase(state: GameState): boolean {
  return (
    state.phase === 'playing' &&
    state.currentPuzzleIndex >= state.mission.puzzles.length &&
    state.mission.map?.exit !== undefined
  );
}

function advance(state: GameState, at: number): GameState {
  const nextIndex = state.currentPuzzleIndex + 1;
  if (nextIndex >= state.mission.puzzles.length) {
    if (state.mission.map?.exit !== undefined) {
      // All systems online — but the lab is only beaten once everyone is out.
      return { ...state, currentPuzzleIndex: nextIndex, puzzleState: null };
    }
    return { ...state, phase: 'won', puzzleState: null, finishedAt: at };
  }
  return {
    ...state,
    currentPuzzleIndex: nextIndex,
    // With a map the next puzzle waits at its station; without one it starts right away.
    puzzleState: state.mission.map === undefined ? initPuzzleState(state, nextIndex) : null,
  };
}

/** Dispatched by the server once every connected player stands in the exit zone. */
function handleEscaped(state: GameState, action: { at: number }): GameState {
  if (!inEscapePhase(state)) {
    fail('Der Notausgang ist noch verriegelt.');
  }
  if (state.deadlineAt !== null && action.at >= state.deadlineAt) {
    return lostNow(state, action.at);
  }
  return { ...state, phase: 'won', puzzleState: null, finishedAt: action.at };
}

/** Shrink the deadline; losing immediately if the penalty eats the rest. */
function applyPenalty(state: GameState, sec: number, at: number): GameState {
  const deadlineAt = (state.deadlineAt ?? at) - sec * 1000;
  const punished: GameState = {
    ...state,
    deadlineAt,
    penaltySeq: state.penaltySeq + 1,
    lastPenaltySec: sec,
  };
  return at >= deadlineAt
    ? { ...punished, phase: 'lost', puzzleState: null, finishedAt: at }
    : punished;
}

function lostNow(state: GameState, at: number): GameState {
  return { ...state, phase: 'lost', puzzleState: null, finishedAt: at };
}

/**
 * An emergency interrupts whatever the crew was doing: the open puzzle is
 * dropped (its station stays armed and can be restarted afterwards).
 */
function startSabotage(state: GameState, action: { at: number }): GameState {
  const sabotage = state.mission.map?.sabotage;
  if (state.phase !== 'playing' || sabotage === undefined || state.sabotage !== null) {
    return state;
  }
  return {
    ...state,
    puzzleState: null,
    sabotage: { endsAt: action.at + sabotage.durationSec * 1000 },
  };
}

/**
 * Freezing and thawing the run. Everything with a deadline is shifted by the
 * time spent paused, so a dropped connection never costs the crew the clock.
 */
function setPaused(state: GameState, action: { paused: boolean; at: number }): GameState {
  if (state.phase !== 'playing') {
    return state;
  }
  if (action.paused) {
    return state.paused === null ? { ...state, paused: { since: action.at } } : state;
  }
  if (state.paused === null) {
    return state;
  }
  const frozen = Math.max(0, action.at - state.paused.since);
  return {
    ...state,
    paused: null,
    deadlineAt: state.deadlineAt === null ? null : state.deadlineAt + frozen,
    sabotage: state.sabotage === null ? null : { endsAt: state.sabotage.endsAt + frozen },
  };
}

function expireSabotage(state: GameState, action: { at: number }): GameState {
  const sabotage = state.mission.map?.sabotage;
  if (state.sabotage === null || sabotage === undefined) {
    return state;
  }
  return applyPenalty({ ...state, sabotage: null }, sabotage.penaltySec, action.at);
}

function handlePress(state: GameState, action: { playerId: string; at: number }): GameState {
  const ctx = requirePlaying(state, action.playerId, action.at);
  if (ctx === 'lost') {
    return lostNow(state, action.at);
  }
  const { player, def, puzzleState } = ctx;
  if (def.type !== 'button-sync' || puzzleState.type !== 'button-sync') {
    fail('Dieses Rätsel hat keinen solchen Knopf.');
  }
  if (player.roleId === null || !def.buttons.some((b) => b.roleId === player.roleId)) {
    fail('Deine Rolle hat bei diesem Rätsel keinen Knopf.');
  }
  const result = pressButton(def, puzzleState, player.roleId, action.at);
  const next = { ...state, puzzleState: result.state };
  return result.solved ? advance(next, action.at) : next;
}

function handleCutWire(
  state: GameState,
  action: { playerId: string; wireId: string; at: number },
): GameState {
  const ctx = requirePlaying(state, action.playerId, action.at);
  if (ctx === 'lost') {
    return lostNow(state, action.at);
  }
  const { player, def, puzzleState } = ctx;
  if (def.type !== 'wiring' || puzzleState.type !== 'wiring') {
    fail('Hier gibt es keine Kabel zu trennen.');
  }
  if (player.roleId !== def.cutterRoleId) {
    fail('Nur die Rolle am Schaltschrank kann Kabel trennen.');
  }
  const result = cutWire(def, puzzleState, action.wireId);
  const next = { ...state, puzzleState: result.state };
  if (result.penalty) {
    return applyPenalty(next, def.penaltySec, action.at);
  }
  return result.solved ? advance(next, action.at) : next;
}

function handlePressKey(
  state: GameState,
  action: { playerId: string; keyIndex: number; at: number },
): GameState {
  const ctx = requirePlaying(state, action.playerId, action.at);
  if (ctx === 'lost') {
    return lostNow(state, action.at);
  }
  const { player, def, puzzleState } = ctx;
  if (def.type !== 'keypad' || puzzleState.type !== 'keypad') {
    fail('Hier gibt es kein Tastenfeld.');
  }
  if (player.roleId !== def.inputRoleId) {
    fail('Nur die Rolle am Tastenfeld kann Codes eingeben.');
  }
  const result = pressKey(def, puzzleState, action.keyIndex);
  const next = { ...state, puzzleState: result.state };
  if (result.penalty) {
    return applyPenalty(next, def.penaltySec, action.at);
  }
  return result.solved ? advance(next, action.at) : next;
}

function handleToggleSwitch(
  state: GameState,
  action: { playerId: string; switchIndex: number; at: number },
): GameState {
  const ctx = requirePlaying(state, action.playerId, action.at);
  if (ctx === 'lost') {
    return lostNow(state, action.at);
  }
  const { player, def, puzzleState } = ctx;
  if (def.type !== 'switches' || puzzleState.type !== 'switches') {
    fail('Hier gibt es keine Schalter.');
  }
  if (player.roleId !== def.panelRoleId) {
    fail('Nur die Rolle an der Schalterbank kann schalten.');
  }
  return { ...state, puzzleState: toggleSwitch(puzzleState, action.switchIndex) };
}

function handleCommitSwitches(
  state: GameState,
  action: { playerId: string; at: number },
): GameState {
  const ctx = requirePlaying(state, action.playerId, action.at);
  if (ctx === 'lost') {
    return lostNow(state, action.at);
  }
  const { player, def, puzzleState } = ctx;
  if (def.type !== 'switches' || puzzleState.type !== 'switches') {
    fail('Hier gibt es keine Schalter.');
  }
  if (player.roleId !== def.panelRoleId) {
    fail('Nur die Rolle an der Schalterbank kann prüfen.');
  }
  const result = commitSwitches(puzzleState);
  const next = { ...state, puzzleState: result.state };
  if (result.penalty) {
    return applyPenalty(next, def.penaltySec, action.at);
  }
  return result.solved ? advance(next, action.at) : next;
}

function handlePressSimon(
  state: GameState,
  action: { playerId: string; buttonIndex: number; at: number },
): GameState {
  const ctx = requirePlaying(state, action.playerId, action.at);
  if (ctx === 'lost') {
    return lostNow(state, action.at);
  }
  const { player, def, puzzleState } = ctx;
  if (def.type !== 'simon' || puzzleState.type !== 'simon') {
    fail('Hier gibt es kein Frequenz-Panel.');
  }
  if (player.roleId !== def.displayRoleId) {
    fail('Nur die Rolle am Frequenz-Panel kann Tasten drücken.');
  }
  const result = pressSimon(puzzleState, action.buttonIndex);
  const next = { ...state, puzzleState: result.state };
  if (result.penalty) {
    return applyPenalty(next, def.penaltySec, action.at);
  }
  return result.solved ? advance(next, action.at) : next;
}

function handleMoveMaze(
  state: GameState,
  action: { playerId: string; dir: number; at: number },
): GameState {
  const ctx = requirePlaying(state, action.playerId, action.at);
  if (ctx === 'lost') {
    return lostNow(state, action.at);
  }
  const { player, def, puzzleState } = ctx;
  if (def.type !== 'maze' || puzzleState.type !== 'maze') {
    fail('Hier gibt es kein Labyrinth.');
  }
  if (player.roleId !== def.navigatorRoleId) {
    fail('Nur die Rolle am Navigationspult kann den Marker bewegen.');
  }
  const result = moveMaze(puzzleState, action.dir);
  const next = { ...state, puzzleState: result.state };
  if (result.penalty) {
    return applyPenalty(next, def.penaltySec, action.at);
  }
  return result.solved ? advance(next, action.at) : next;
}

/** Guards shared by all three item actions; proximity is the server's job. */
function requireCarryable(
  state: GameState,
  playerId: string,
  itemId: string,
): { item: ItemState } {
  if (state.phase !== 'playing') {
    fail('Dafür muss die Mission laufen.');
  }
  if (state.paused !== null) {
    fail('Die Mission ist pausiert — es fehlt jemand aus der Crew.');
  }
  findPlayer(state, playerId);
  const item = state.items[itemId];
  if (item === undefined) {
    fail('Dieses Objekt gibt es hier nicht.');
  }
  if (item.delivered) {
    fail('Das ist bereits abgeliefert.');
  }
  return { item };
}

function pickItem(
  state: GameState,
  action: { playerId: string; itemId: string },
): GameState {
  const { item } = requireCarryable(state, action.playerId, action.itemId);
  if (item.carriedBy !== null) {
    fail(item.carriedBy === action.playerId ? 'Du trägst es schon.' : 'Das trägt jemand anderes.');
  }
  if (Object.values(state.items).some((i) => i.carriedBy === action.playerId)) {
    fail('Du hast schon die Hände voll — erst ablegen.');
  }
  return {
    ...state,
    items: { ...state.items, [action.itemId]: { ...item, carriedBy: action.playerId } },
  };
}

function dropItem(
  state: GameState,
  action: { playerId: string; itemId: string; x: number; y: number },
): GameState {
  const { item } = requireCarryable(state, action.playerId, action.itemId);
  if (item.carriedBy !== action.playerId) {
    fail('Das trägst du gar nicht.');
  }
  return {
    ...state,
    items: {
      ...state.items,
      [action.itemId]: { ...item, carriedBy: null, x: action.x, y: action.y },
    },
  };
}

function deliverItem(
  state: GameState,
  action: { playerId: string; itemId: string },
): GameState {
  const { item } = requireCarryable(state, action.playerId, action.itemId);
  if (item.carriedBy !== action.playerId) {
    fail('Das trägst du gar nicht.');
  }
  const def = state.mission.map?.items.find((i) => i.id === action.itemId);
  if (def === undefined) {
    fail('Dieses Objekt gibt es hier nicht.');
  }
  return {
    ...state,
    items: {
      ...state.items,
      [action.itemId]: {
        carriedBy: null,
        delivered: true,
        x: def.deliverTo.x + 0.5,
        y: def.deliverTo.y + 0.5,
      },
    },
  };
}

/** Items a station still waits for before it can be switched on. */
export function missingItemsFor(state: GameState, puzzleId: string): string[] {
  return (state.mission.map?.items ?? [])
    .filter((def) => def.requiredFor === puzzleId && state.items[def.id]?.delivered !== true)
    .map((def) => def.label);
}

/**
 * Spatial proximity to the station is validated by the server (it owns the
 * live positions); the reducer enforces everything else.
 */
function handleInteract(state: GameState, action: { playerId: string; at: number }): GameState {
  if (state.phase !== 'playing') {
    fail('Interagieren geht nur während der Mission.');
  }
  const map = state.mission.map;
  if (map === undefined) {
    fail('Diese Mission hat keine Karte.');
  }
  if (state.deadlineAt !== null && action.at >= state.deadlineAt) {
    return lostNow(state, action.at);
  }
  if (state.paused !== null) {
    fail('Die Mission ist pausiert — es fehlt jemand aus der Crew.');
  }
  if (state.sabotage !== null) {
    fail('Erst den Notfall beheben — an die Panele!');
  }
  if (state.puzzleState !== null) {
    fail('Die Station läuft schon — löst erst das aktuelle Rätsel.');
  }
  findPlayer(state, action.playerId);
  const current = state.mission.puzzles[state.currentPuzzleIndex];
  if (armedStation(map, state) === null || current === undefined) {
    fail('Hier gibt es nichts zu aktivieren.');
  }
  const missing = missingItemsFor(state, current.id);
  if (missing.length > 0) {
    fail(`Der Station fehlt noch: ${missing.join(', ')}. Bringt es her!`);
  }
  return { ...state, puzzleState: initPuzzleState(state, state.currentPuzzleIndex) };
}

function backToLobby(state: GameState, action: { playerId: string }): GameState {
  if (state.phase !== 'won' && state.phase !== 'lost') {
    fail('Zurück zur Lobby geht erst nach Missionsende.');
  }
  requireHost(state, action.playerId);
  return {
    ...state,
    phase: 'lobby',
    currentPuzzleIndex: 0,
    puzzleState: null,
    seed: null,
    pressedPlates: [],
    occupiedPanels: [],
    sabotage: null,
    paused: null,
    items: {},
    startedAt: null,
    deadlineAt: null,
    finishedAt: null,
    penaltySeq: 0,
    lastPenaltySec: null,
  };
}
