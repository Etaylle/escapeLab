import {
  CREW_COLORS,
  type GameState,
  type ItemState,
  type Player,
  type RunEvent,
} from './state.js';
import type { Difficulty } from './difficulty.js';
import { generateEdgework } from './edgework.js';
import { fail } from './errors.js';
import type { Mission } from './mission.js';
import { mulberry32 } from './rng.js';
import { moduleFor, type PuzzleDef, type PuzzleState } from './puzzles/index.js';
import type { PuzzleContext } from './puzzles/module.js';
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
  | { type: 'set-ready'; playerId: string; ready: boolean }
  | { type: 'switch-mission'; playerId: string; mission: Mission; difficulty: Difficulty }
  | { type: 'start-mission'; playerId: string; at: number; seed: number }
  /** a move at the open puzzle; `input` is checked against that puzzle's module */
  | { type: 'puzzle-input'; playerId: string; at: number; input: unknown }
  | { type: 'request-hint'; playerId: string; at: number }
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
  | { type: 'back-to-lobby'; playerId: string }
  | { type: 'rematch'; playerId: string; at: number; seed: number };

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
    case 'set-ready':
      return setReady(state, action);
    case 'switch-mission':
      return switchMission(state, action);
    case 'start-mission':
      return startMission(state, action);
    case 'puzzle-input':
      return handlePuzzleInput(state, action);
    case 'request-hint':
      return requestHint(state, action);
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
      return state.sabotage === null
        ? state
        : logEvent({ ...state, sabotage: null }, 'sabotage', 'Notfall behoben', action.at);
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
        ? applyPenalty(state, action.penaltySec, action.at, 'Von einer Drohne erfasst')
        : state;
    case 'interact':
      return handleInteract(state, action);
    case 'escaped':
      return handleEscaped(state, action);
    case 'time-expired':
      return state.phase === 'playing' && state.paused === null
        ? lostNow(state, action.at)
        : state;
    case 'back-to-lobby':
      return backToLobby(state, action);
    case 'rematch':
      return rematch(state, action);
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
    ? unready(state.players)
    : unready(state.players).map((p) => ({ ...p, roleId: null }));
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
    ready: false,
    connected: true,
    isHost: state.players.length === 0,
  };
  return { ...state, players: [...unready(state.players), player] };
}

function setReady(state: GameState, action: { playerId: string; ready: boolean }): GameState {
  if (state.phase === 'playing') {
    fail('Bereitmelden geht nur zwischen den Läufen.');
  }
  findPlayer(state, action.playerId);
  const players = state.players.map((p) =>
    p.id === action.playerId ? { ...p, ready: action.ready } : p,
  );
  return { ...state, players };
}

/** Any change to the setup un-readies everyone — nobody starts by surprise. */
function unready(players: Player[]): Player[] {
  return players.map((p) => (p.ready ? { ...p, ready: false } : p));
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
  const players = unready(state.players).map((p) =>
    p.id === action.playerId ? { ...p, roleId: action.roleId } : p,
  );
  return { ...state, players };
}

/** What a module may know when it sets up or takes a move at `at`. */
function puzzleContext(state: GameState, at: number): PuzzleContext {
  if (state.edgework === null) {
    throw new Error('puzzle context: this run has no edgework — was start-mission skipped?');
  }
  return {
    edgework: state.edgework,
    alarms: state.penaltySeq,
    remainingSec: Math.max(0, Math.ceil(((state.deadlineAt ?? at) - at) / 1000)),
    at,
  };
}

function initPuzzleState(state: GameState, index: number, at: number): PuzzleState {
  const def = state.mission.puzzles[index];
  if (def === undefined) {
    throw new Error(`mission "${state.mission.id}" has no puzzle at index ${index}`);
  }
  // Distinct deterministic stream per puzzle.
  const rng = mulberry32(((state.seed ?? 0) + index * 7919) >>> 0);
  return moduleFor(def.type).init(def, rng, puzzleContext(state, at));
}

/** Put a puzzle on the consoles; mission control holds its hints back for a while. */
function openPuzzle(state: GameState, index: number, at: number): GameState {
  return {
    ...state,
    puzzleState: initPuzzleState(state, index, at),
    hintReadyAt: at + state.mission.hintDelaySec * 1000,
  };
}

/** Edgework rolls on its own stream, so the puzzle streams stay what they are for a seed. */
const EDGEWORK_STREAM = 0x45444745;

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
  // The host starts by pressing start; everyone else confirms beforehand.
  const waiting = state.players.filter((p) => !p.isHost && !p.ready);
  if (waiting.length > 0) {
    fail(`Noch nicht bereit: ${waiting.map((p) => p.name).join(', ')}.`);
  }
  const map = state.mission.map;
  const started: GameState = {
    ...state,
    phase: 'playing',
    currentPuzzleIndex: 0,
    puzzleState: null,
    seed: action.seed,
    edgework: generateEdgework(mulberry32((action.seed ^ EDGEWORK_STREAM) >>> 0)),
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
    events: [],
    startedAt: action.at,
    deadlineAt: action.at + state.mission.timeLimitSec * 1000,
    finishedAt: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    hintsUsed: 0,
    hintsRevealed: 0,
    hintReadyAt: null,
  };
  // With a map, puzzles wait for station activation; without one they chain directly.
  const opened = map === undefined ? openPuzzle(started, 0, action.at) : started;
  return logRadio(opened, state.mission.radio.start, action.at);
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
  const solved = state.mission.puzzles[state.currentPuzzleIndex];
  const reported = logEvent(
    { ...state, hintsRevealed: 0, hintReadyAt: null },
    'puzzle',
    `${solved?.title ?? 'Station'} gelöst`,
    at,
  );
  const logged = logRadio(reported, solved?.onSolved, at);
  const nextIndex = state.currentPuzzleIndex + 1;
  if (nextIndex >= state.mission.puzzles.length) {
    if (state.mission.map?.exit !== undefined) {
      // All systems online — but the lab is only beaten once everyone is out.
      const unlocked = logEvent(
        { ...logged, currentPuzzleIndex: nextIndex, puzzleState: null },
        'escape',
        'Notausgang entriegelt',
        at,
      );
      return logRadio(unlocked, state.mission.radio.escape, at);
    }
    return logEvent(
      {
        ...logged,
        phase: 'won',
        players: unready(logged.players),
        puzzleState: null,
        finishedAt: at,
      },
      'finish',
      'Alle Systeme online',
      at,
    );
  }
  const next: GameState = { ...logged, currentPuzzleIndex: nextIndex, puzzleState: null };
  // With a map the next puzzle waits at its station; without one it starts right away.
  return state.mission.map === undefined ? openPuzzle(next, nextIndex, at) : next;
}

/** Dispatched by the server once every connected player stands in the exit zone. */
function handleEscaped(state: GameState, action: { at: number }): GameState {
  if (!inEscapePhase(state)) {
    fail('Der Notausgang ist noch verriegelt.');
  }
  if (state.deadlineAt !== null && action.at >= state.deadlineAt) {
    return lostNow(state, action.at);
  }
  return logEvent(
    {
      ...state,
      phase: 'won',
      players: unready(state.players),
      puzzleState: null,
      finishedAt: action.at,
    },
    'finish',
    'Alle draußen',
    action.at,
  );
}

/** Append a line to the run report. */
function logEvent(
  state: GameState,
  kind: RunEvent['kind'],
  label: string,
  at: number,
  seconds: number | null = null,
): GameState {
  return { ...state, events: [...state.events, { at, kind, label, seconds }] };
}

/** Mission control speaks up, if the mission scripted a line for this moment. */
function logRadio(state: GameState, text: string | undefined, at: number): GameState {
  return text === undefined ? state : logEvent(state, 'radio', text, at);
}

/** Shrink the deadline; losing immediately if the penalty eats the rest. */
function applyPenalty(state: GameState, sec: number, at: number, reason: string): GameState {
  const deadlineAt = (state.deadlineAt ?? at) - sec * 1000;
  const punished = logEvent(
    { ...state, deadlineAt, penaltySeq: state.penaltySeq + 1, lastPenaltySec: sec },
    'penalty',
    reason,
    at,
    sec,
  );
  return at >= deadlineAt
    ? lostNow(punished, at)
    : punished;
}

function lostNow(state: GameState, at: number): GameState {
  return logEvent(
    { ...state, phase: 'lost', players: unready(state.players), puzzleState: null, finishedAt: at },
    'finish',
    'Zeit abgelaufen',
    at,
  );
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
  return logEvent(
    {
      ...state,
      puzzleState: null,
      sabotage: { endsAt: action.at + sabotage.durationSec * 1000 },
    },
    'sabotage',
    `Notfall: ${sabotage.label}`,
    action.at,
  );
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
    hintReadyAt: state.hintReadyAt === null ? null : state.hintReadyAt + frozen,
  };
}

function expireSabotage(state: GameState, action: { at: number }): GameState {
  const sabotage = state.mission.map?.sabotage;
  if (state.sabotage === null || sabotage === undefined) {
    return state;
  }
  return applyPenalty(
    { ...state, sabotage: null },
    sabotage.penaltySec,
    action.at,
    'Notfall nicht rechtzeitig behoben',
  );
}

/** One move at the open puzzle, interpreted by that puzzle's module. */
function handlePuzzleInput(
  state: GameState,
  action: { playerId: string; at: number; input: unknown },
): GameState {
  const playing = requirePlaying(state, action.playerId, action.at);
  if (playing === 'lost') {
    return lostNow(state, action.at);
  }
  const { player, def, puzzleState } = playing;
  const puzzleModule = moduleFor(def.type);
  const input = puzzleModule.inputSchema.safeParse(action.input);
  if (!input.success) {
    fail('Ungültige Eingabe.');
  }
  if (player.roleId === null) {
    fail('Ohne Rolle kannst du hier nichts tun.');
  }
  const result = puzzleModule.apply(
    def,
    puzzleState,
    input.data,
    player.roleId,
    puzzleContext(state, action.at),
  );
  const next = { ...state, puzzleState: result.state };
  if (result.penalty !== null) {
    return applyPenalty(next, def.penaltySec, action.at, result.penalty);
  }
  return result.solved ? advance(next, action.at) : next;
}

/**
 * Mission control talks a stuck crew through the open puzzle, one hint at a
 * time. A hint costs time like a penalty but is no alarm, so it leaves the
 * alarm counter alone; the next one only comes after another wait.
 */
function requestHint(state: GameState, action: { playerId: string; at: number }): GameState {
  const ctx = requirePlaying(state, action.playerId, action.at);
  if (ctx === 'lost') {
    return lostNow(state, action.at);
  }
  const hint = ctx.def.hints[state.hintsRevealed];
  if (hint === undefined) {
    fail('Keine weiteren Hinweise für diese Station.');
  }
  if (state.hintReadyAt === null || action.at < state.hintReadyAt) {
    fail('Die Leitstelle braucht noch einen Moment.');
  }
  const { hintCostSec, hintDelaySec } = state.mission;
  const deadlineAt = (state.deadlineAt ?? action.at) - hintCostSec * 1000;
  const helped = logEvent(
    {
      ...state,
      deadlineAt,
      hintsUsed: state.hintsUsed + 1,
      hintsRevealed: state.hintsRevealed + 1,
      hintReadyAt: action.at + hintDelaySec * 1000,
    },
    'hint',
    hint,
    action.at,
    hintCostSec,
  );
  return action.at >= deadlineAt ? lostNow(helped, action.at) : helped;
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
  action: { playerId: string; itemId: string; at: number },
): GameState {
  const { item } = requireCarryable(state, action.playerId, action.itemId);
  if (item.carriedBy !== action.playerId) {
    fail('Das trägst du gar nicht.');
  }
  const def = state.mission.map?.items.find((i) => i.id === action.itemId);
  if (def === undefined) {
    fail('Dieses Objekt gibt es hier nicht.');
  }
  return logEvent(
    {
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
    },
    'item',
    `${def.label} eingesetzt`,
    action.at,
  );
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
  return openPuzzle(state, state.currentPuzzleIndex, action.at);
}


/**
 * Straight into another run of the same mission with the same roles: the
 * crew confirms on the end screen, the host presses once. Same guards as a
 * normal start, just without the detour through the lobby.
 */
function rematch(
  state: GameState,
  action: { playerId: string; at: number; seed: number },
): GameState {
  if (state.phase !== 'won' && state.phase !== 'lost') {
    fail('Ein neuer Lauf geht erst nach Missionsende.');
  }
  return startMission({ ...state, phase: 'lobby' }, action);
}

function backToLobby(state: GameState, action: { playerId: string }): GameState {
  if (state.phase !== 'won' && state.phase !== 'lost') {
    fail('Zurück zur Lobby geht erst nach Missionsende.');
  }
  requireHost(state, action.playerId);
  return {
    ...state,
    phase: 'lobby',
    players: unready(state.players),
    currentPuzzleIndex: 0,
    puzzleState: null,
    seed: null,
    edgework: null,
    pressedPlates: [],
    occupiedPanels: [],
    sabotage: null,
    paused: null,
    items: {},
    events: [],
    startedAt: null,
    deadlineAt: null,
    finishedAt: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    hintsUsed: 0,
    hintsRevealed: 0,
    hintReadyAt: null,
  };
}
