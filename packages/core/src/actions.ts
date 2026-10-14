import {
  CREW_COLORS,
  NO_CREDITS,
  NOBODY_PRESENT,
  type Credits,
  type GameState,
  type ItemState,
  type Player,
  type RunEvent,
} from './state.js';
import type { Difficulty } from './difficulty.js';
import { generateEdgework } from './edgework.js';
import { fail } from './errors.js';
import type { ManualDef, Mission } from './mission.js';
import { mulberry32, shuffle } from './rng.js';
import { moduleFor, type PuzzleDef, type PuzzleState } from './puzzles/index.js';
import type { ConsoleId, PuzzleContext } from './puzzles/module.js';
import {
  expireRelay,
  relayDefFor,
  relayModule,
  shiftRelay,
  type RelayDef,
  type RelayState,
} from './puzzles/relay.js';
import {
  armedStations,
  backupsOf,
  consoleOf,
  operatorsOf,
  readersOf,
  sourceOpen,
  stationKey,
} from './map.js';
import type { Spot } from './reach.js';

/**
 * All game actions. `at` is the authoritative server time (epoch ms) and
 * `seed` the server-rolled PRNG seed — the reducer itself never reads a
 * clock or RNG, which keeps every game deterministic and replayable.
 */
export type Action =
  | { type: 'player-join'; playerId: string; name: string }
  | { type: 'player-connected'; playerId: string }
  | { type: 'player-disconnected'; playerId: string }
  | { type: 'select-color'; playerId: string; color: string }
  | { type: 'set-ready'; playerId: string; ready: boolean }
  | { type: 'switch-mission'; playerId: string; mission: Mission; difficulty: Difficulty }
  /** the players connected right now are the crew, each drawn a spawn; the rest leave */
  | { type: 'start-mission'; playerId: string; at: number; seed: number }
  /** a move at the open puzzle; `input` is checked against that puzzle's module */
  | { type: 'puzzle-input'; playerId: string; at: number; input: unknown }
  /** a note of the last crew, asked for at a manual object that covers the open puzzle */
  | { type: 'request-hint'; playerId: string; at: number }
  | { type: 'set-occupancy'; plates: string[]; panels: string[] }
  /**
   * who stands at which station spot (by `stationKey`) and manual object, who
   * has seen the sign (stays seen) and which manual objects somebody has
   * come close to (stay found)
   */
  | {
      type: 'set-presence';
      stations: Record<string, string[]>;
      manuals: Record<string, string[]>;
      signSeen: string[];
      seen: string[];
    }
  /** a locker searched or a cabinet unlocked by a player standing at it */
  | { type: 'open-source'; playerId: string; manualId: string; at: number }
  /** `playerId` is the one the drone caught */
  | { type: 'drone-spotted'; at: number; penaltySec: number; playerId: string }
  | { type: 'sabotage-start'; at: number }
  | { type: 'sabotage-cleared'; at: number }
  | { type: 'sabotage-expired'; at: number }
  /** once a second during a relay emergency: instructions that ran out are replaced */
  | { type: 'sabotage-tick'; at: number }
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
    case 'set-presence':
      return state.phase === 'playing' ? setPresence(state, action) : state;
    case 'open-source':
      return openSource(state, action);
    case 'sabotage-start':
      return startSabotage(state, action);
    case 'sabotage-cleared':
      // Manned valves; a relay emergency is only cleared by its instructions.
      return state.sabotage?.emergency === undefined ? clearSabotage(state, action.at) : state;
    case 'sabotage-expired':
      return expireSabotage(state, action);
    case 'sabotage-tick':
      return tickEmergency(state, action);
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
        ? applyPenalty(
            credited(state, action.playerId, 'alarms'),
            action.penaltySec,
            action.at,
            'Von einer Drohne erfasst',
          )
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
  const { max } = action.mission.players;
  if (state.players.length > max) {
    fail(`Für "${action.mission.title}" sind zu viele Spieler im Raum (max. ${max}).`);
  }
  return {
    ...state,
    mission: action.mission,
    difficulty: action.difficulty,
    players: unready(state.players),
  };
}

function playerJoin(
  state: GameState,
  action: { playerId: string; name: string },
): GameState {
  if (state.phase !== 'lobby') {
    fail('Die Mission läuft bereits — Beitritt ist nur in der Lobby möglich.');
  }
  const { max } = state.mission.players;
  if (state.players.length >= max) {
    fail(`Der Raum ist voll (max. ${max} Spielende für diese Mission).`);
  }
  const name = action.name.trim();
  if (name.length === 0) {
    fail('Bitte einen Namen eingeben.');
  }
  // Two Annas would make a relay drill's "PULT ANNA" ambiguous.
  const names = new Set(state.players.map((p) => p.name.toLowerCase()));
  let unique = name;
  for (let n = 2; names.has(unique.toLowerCase()); n++) {
    unique = `${name} ${n}`;
  }
  const taken = new Set(state.players.map((p) => p.color));
  const player: Player = {
    id: action.playerId,
    name: unique,
    color: CREW_COLORS.find((c) => !taken.has(c)) ?? CREW_COLORS[0],
    ready: false,
    connected: true,
    isHost: state.players.length === 0,
    spawn: null,
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

/** One more of `what` for the player in this run's credits. */
function credited(state: GameState, playerId: string, what: keyof Credits): GameState {
  const theirs = state.credits[playerId] ?? NO_CREDITS;
  return {
    ...state,
    credits: { ...state.credits, [playerId]: { ...theirs, [what]: theirs[what] + 1 } },
  };
}

/** Whoever reads the open station's rules for the first time is credited with it, once. */
function creditReaders(state: GameState): GameState {
  const open = state.mission.puzzles[state.currentPuzzleIndex];
  if (state.puzzleState === null || open === undefined) {
    return state;
  }
  const fresh = readersOf(state, open.id).filter((id) => !state.readersCredited.includes(id));
  return fresh.reduce(
    (next, playerId) => ({
      ...credited(next, playerId, 'read'),
      readersCredited: [...next.readersCredited, playerId].sort(),
    }),
    state,
  );
}

/**
 * What a module may know when it sets up or takes a move at `at`, made at
 * console `from` (null where nobody stands at a station: in `init`, in an
 * emergency).
 */
function puzzleContext(state: GameState, at: number, from: ConsoleId | null): PuzzleContext {
  if (state.edgework === null) {
    throw new Error('puzzle context: this run has no edgework — was start-mission skipped?');
  }
  const open = state.mission.puzzles[state.currentPuzzleIndex];
  return {
    edgework: state.edgework,
    alarms: state.penaltySeq,
    remainingSec: Math.max(0, Math.ceil(((state.deadlineAt ?? at) - at) / 1000)),
    at,
    crew: state.players.filter((p) => p.connected).map((p) => p.id),
    console: from,
    atConsoles: presentAtConsoles(state, from),
    readers: from === null || open === undefined ? [] : readersOf(state, open.id),
  };
}

/**
 * Who stands at each console of the open station, for a move made at one
 * of them: both empty at a station with one console, and for a move made
 * at no console at all.
 */
function presentAtConsoles(state: GameState, from: ConsoleId | null): PuzzleContext['atConsoles'] {
  const open = state.mission.puzzles[state.currentPuzzleIndex];
  if (from === null || open === undefined || moduleFor(open.type).consoles !== 2) {
    return { a: [], b: [] };
  }
  const at = (console: ConsoleId): string[] => [
    ...(state.presence.stations[stationKey({ puzzleId: open.id, console })] ?? []),
  ];
  return { a: at('a'), b: at('b') };
}

/**
 * Who stands where, as the server sees it. Lists are kept sorted and empty
 * ones dropped, so equal presence compares equal; whoever has seen the sign
 * keeps it, and a manual object once found stays on the crew's map.
 */
function setPresence(
  state: GameState,
  action: Extract<Action, { type: 'set-presence' }>,
): GameState {
  const tidy = (byId: Record<string, string[]>): Record<string, string[]> =>
    Object.fromEntries(
      Object.entries(byId)
        .filter(([, players]) => players.length > 0)
        .map(([id, players]) => [id, [...new Set(players)].sort()]),
    );
  return creditReaders({
    ...state,
    presence: {
      stations: tidy(action.stations),
      manuals: tidy(action.manuals),
      signSeen: [...new Set([...state.presence.signSeen, ...action.signSeen])].sort(),
    },
    discovered: [...new Set([...state.discovered, ...action.seen])].sort(),
  });
}

function initPuzzleState(state: GameState, index: number, at: number): PuzzleState {
  const def = state.mission.puzzles[index];
  if (def === undefined) {
    throw new Error(`mission "${state.mission.id}" has no puzzle at index ${index}`);
  }
  // Distinct deterministic stream per puzzle.
  const rng = mulberry32(((state.seed ?? 0) + index * 7919) >>> 0);
  return moduleFor(def.type).init(def, rng, puzzleContext(state, at, null));
}

/** Put a puzzle on the consoles; its first note is held back for a while. */
function openPuzzle(state: GameState, index: number, at: number): GameState {
  return creditReaders({
    ...state,
    puzzleState: initPuzzleState(state, index, at),
    hintReadyAt: at + state.mission.hintDelaySec * 1000,
  });
}

/** Edgework rolls on its own stream, so the puzzle streams stay what they are for a seed. */
const EDGEWORK_STREAM = 0x45444745;
/** So do the spawns … */
const SPAWN_STREAM = 0x5350574e;
/** … and the places of the manual objects. */
const PLACES_STREAM = 0x504c4143;

/** Every player of the crew starts on a spawn of their own, drawn from the seed. */
function drawSpawns(crew: Player[], spawns: readonly Spot[], seed: number): Player[] {
  const drawn = shuffle(spawns, mulberry32((seed ^ SPAWN_STREAM) >>> 0));
  return crew.map((player, i) => {
    const spawn = drawn[i];
    if (spawn === undefined) {
      throw new Error(`start: ${crew.length} players, but only ${spawns.length} spawns`);
    }
    return { ...player, spawn: { x: spawn.x, y: spawn.y } };
  });
}

/** Where each manual object lies this run: one of its spots, drawn from the seed. */
function placeSources(manuals: readonly ManualDef[], seed: number): GameState['places'] {
  const rng = mulberry32((seed ^ PLACES_STREAM) >>> 0);
  return Object.fromEntries(
    manuals.map((manual) => {
      const spot = manual.spots[Math.floor(rng() * manual.spots.length)];
      if (spot === undefined) {
        throw new Error(`manual object "${manual.id}" has no spot to be drawn to`);
      }
      return [manual.id, { x: spot.x, y: spot.y }];
    }),
  );
}

/**
 * The players connected right now are the crew — as many as the mission
 * takes — and everyone but the host has confirmed; whoever is gone from the
 * room is left out of the run.
 */
function crewToStart(state: GameState): Player[] {
  const crew = state.players.filter((p) => p.connected);
  const { min, max } = state.mission.players;
  if (crew.length < min) {
    fail(`Für diese Mission braucht es mindestens ${min} Spielende.`);
  }
  if (crew.length > max) {
    fail(`Für diese Mission sind es zu viele — höchstens ${max} Spielende.`);
  }
  // The host starts by pressing start; everyone else confirms beforehand.
  const waiting = crew.filter((p) => !p.isHost && !p.ready);
  if (waiting.length > 0) {
    fail(`Noch nicht bereit: ${waiting.map((p) => p.name).join(', ')}.`);
  }
  return crew;
}

function startMission(
  state: GameState,
  action: { playerId: string; at: number; seed: number },
): GameState {
  if (state.phase !== 'lobby') {
    fail('Die Mission läuft bereits.');
  }
  requireHost(state, action.playerId);
  const crew = crewToStart(state);
  const map = state.mission.map;
  const started: GameState = {
    ...state,
    phase: 'playing',
    players: drawSpawns(crew, map.spawns, action.seed),
    currentPuzzleIndex: 0,
    puzzleState: null,
    seed: action.seed,
    edgework: generateEdgework(mulberry32((action.seed ^ EDGEWORK_STREAM) >>> 0)),
    pressedPlates: [],
    occupiedPanels: [],
    presence: NOBODY_PRESENT,
    places: placeSources(map.manuals, action.seed),
    opened: [],
    discovered: [],
    credits: Object.fromEntries(crew.map((player) => [player.id, NO_CREDITS])),
    readersCredited: [],
    sabotage: null,
    paused: null,
    items: Object.fromEntries(
      map.items.map((item) => [
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
  return logRadio(started, state.mission.radio.start, action.at);
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
    state.mission.map.exit !== undefined
  );
}

function advance(state: GameState, at: number): GameState {
  const solved = state.mission.puzzles[state.currentPuzzleIndex];
  const reported = logEvent(
    { ...state, hintsRevealed: 0, hintReadyAt: null, readersCredited: [] },
    'puzzle',
    `${solved?.title ?? 'Station'} gelöst`,
    at,
  );
  const logged = logRadio(reported, solved?.onSolved, at);
  const nextIndex = state.currentPuzzleIndex + 1;
  if (nextIndex >= state.mission.puzzles.length) {
    if (state.mission.map.exit !== undefined) {
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
  // The next puzzle waits at its station.
  return { ...logged, currentPuzzleIndex: nextIndex, puzzleState: null };
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

/** Why a run was lost: the last line of its report. */
const OUT_OF_TIME = 'Zeit abgelaufen';
const TOO_MANY_ALARMS = 'Zu viele Alarme — Notversorgung abgeschaltet.';

/**
 * Sound the alarm: count it and shrink the deadline. Every alarm of the run
 * comes through here — a wrong move at a station or an emergency console, a
 * drone sighting, an emergency that ran out. The alarm that reaches the
 * mission's limit loses the run at once, whatever is left on the clock; so
 * does one whose penalty eats the rest of the time.
 */
function applyPenalty(state: GameState, sec: number, at: number, reason: string): GameState {
  const deadlineAt = (state.deadlineAt ?? at) - sec * 1000;
  const penaltySeq = state.penaltySeq + 1;
  const punished = logEvent(
    { ...state, deadlineAt, penaltySeq, lastPenaltySec: sec },
    'penalty',
    reason,
    at,
    sec,
  );
  const limit = state.mission.maxAlarms;
  if (typeof limit === 'number' && penaltySeq >= limit) {
    return lostNow(punished, at, TOO_MANY_ALARMS);
  }
  return at >= deadlineAt ? lostNow(punished, at) : punished;
}

function lostNow(state: GameState, at: number, why = OUT_OF_TIME): GameState {
  return logEvent(
    { ...state, phase: 'lost', players: unready(state.players), puzzleState: null, finishedAt: at },
    'finish',
    why,
    at,
  );
}

/**
 * An emergency interrupts whatever the crew was doing: the open puzzle is
 * dropped (its station stays armed and can be restarted afterwards).
 */
function startSabotage(state: GameState, action: { at: number }): GameState {
  const sabotage = state.mission.map.sabotage;
  if (state.phase !== 'playing' || sabotage === undefined || state.sabotage !== null) {
    return state;
  }
  const endsAt = action.at + sabotage.durationSec * 1000;
  return logEvent(
    {
      ...state,
      puzzleState: null,
      sabotage:
        sabotage.mode === 'relay'
          ? { endsAt, emergency: openEmergency(state, action.at) }
          : { endsAt },
    },
    'sabotage',
    `Notfall: ${sabotage.label}`,
    action.at,
  );
}

/** The emergency is over in time: the crew can get back to the stations. */
function clearSabotage(state: GameState, at: number): GameState {
  return state.sabotage === null
    ? state
    : logEvent({ ...state, sabotage: null }, 'sabotage', 'Notfall behoben', at);
}

/** The relay emergency's def; rebuilt from the game whenever needed, never stored. */
function emergencyDef(state: GameState): RelayDef {
  const sabotage = state.mission.map.sabotage;
  if (sabotage === undefined) {
    throw new Error(`mission "${state.mission.id}" has no sabotage to run a relay emergency`);
  }
  return relayDefFor(state.players, sabotage);
}

/** Emergencies roll on their own stream, salted with the moment they start. */
const EMERGENCY_STREAM = 0x52454c41;

/** A relay emergency's consoles and first instructions, rolled from the run's seed. */
function openEmergency(state: GameState, at: number): RelayState {
  const rng = mulberry32(((state.seed ?? 0) ^ EMERGENCY_STREAM ^ at) >>> 0);
  return relayModule.init(emergencyDef(state), rng, puzzleContext(state, at, null));
}

/** Instructions run out on the clock; each that did is a miss and is replaced. */
function tickEmergency(state: GameState, action: { at: number }): GameState {
  const emergency = state.sabotage?.emergency;
  if (
    state.phase !== 'playing' ||
    state.paused !== null ||
    state.sabotage === null ||
    emergency === undefined
  ) {
    return state;
  }
  const aged = expireRelay(emergencyDef(state), emergency, action.at);
  if (aged === emergency) {
    return state;
  }
  return { ...state, sabotage: { ...state.sabotage, emergency: aged } };
}

/**
 * A move at a relay emergency's consoles — while one runs, every input goes
 * there. Enough completed instructions clear it the way manned valves do.
 */
function handleEmergencyInput(
  state: GameState,
  action: { playerId: string; at: number; input: unknown },
  sabotage: NonNullable<GameState['sabotage']>,
  emergency: RelayState,
): GameState {
  if (state.paused !== null) {
    fail('Die Mission ist pausiert — es fehlt jemand aus der Crew.');
  }
  if (state.deadlineAt !== null && action.at >= state.deadlineAt) {
    return lostNow(state, action.at);
  }
  const input = relayModule.inputSchema.safeParse(action.input);
  if (!input.success) {
    fail('Ungültige Eingabe.');
  }
  const player = findPlayer(state, action.playerId);
  const def = emergencyDef(state);
  const ctx = puzzleContext(state, action.at, null);
  const result = relayModule.apply(def, emergency, input.data, player.id, ctx);
  const next = { ...state, sabotage: { ...sabotage, emergency: result.state } };
  if (result.penalty !== null) {
    const blamed = credited(next, player.id, 'alarms');
    return applyPenalty(blamed, def.penaltySec, action.at, result.penalty);
  }
  return result.solved ? clearSabotage(next, action.at) : next;
}

/** The emergency's deadline, and a relay's instruction clocks, moved on by `ms`. */
function shiftSabotage(
  sabotage: NonNullable<GameState['sabotage']>,
  ms: number,
): NonNullable<GameState['sabotage']> {
  const endsAt = sabotage.endsAt + ms;
  return sabotage.emergency === undefined
    ? { endsAt }
    : { endsAt, emergency: shiftRelay(sabotage.emergency, ms) };
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
    sabotage: state.sabotage === null ? null : shiftSabotage(state.sabotage, frozen),
    hintReadyAt: state.hintReadyAt === null ? null : state.hintReadyAt + frozen,
  };
}

function expireSabotage(state: GameState, action: { at: number }): GameState {
  const sabotage = state.mission.map.sabotage;
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

/**
 * One move at the open puzzle, interpreted by that puzzle's module, from the
 * console the player stands at. It counts only with a second person there:
 * another crew member at the station's other console or at the rules —
 * except where the whole crew works the panel. Alone, it is turned away
 * without an alarm.
 */
function handlePuzzleInput(
  state: GameState,
  action: { playerId: string; at: number; input: unknown },
): GameState {
  const sabotage = state.sabotage;
  if (state.phase === 'playing' && sabotage?.emergency !== undefined) {
    return handleEmergencyInput(state, action, sabotage, sabotage.emergency);
  }
  const playing = requirePlaying(state, action.playerId, action.at);
  if (playing === 'lost') {
    return lostNow(state, action.at);
  }
  const { player, def, puzzleState } = playing;
  const from = consoleOf(state, def.id, player.id);
  if (from === null) {
    fail('Dafür musst du am Pult stehen.');
  }
  const puzzleModule = moduleFor(def.type);
  if (!puzzleModule.wholeCrew && backupsOf(state, def.id, player.id).length === 0) {
    fail('Allein geht das nicht — jemand muss am anderen Pult oder bei den Regeln stehen.');
  }
  const input = puzzleModule.inputSchema.safeParse(action.input);
  if (!input.success) {
    fail('Ungültige Eingabe.');
  }
  const result = puzzleModule.apply(
    def,
    puzzleState,
    input.data,
    player.id,
    puzzleContext(state, action.at, from),
  );
  const next = { ...state, puzzleState: result.state };
  if (result.penalty !== null) {
    const blamed = credited(next, player.id, 'alarms');
    return applyPenalty(blamed, result.penaltySec ?? def.penaltySec, action.at, result.penalty);
  }
  return result.solved ? advance(creditWorkers(next, def, player.id), action.at) : next;
}

/**
 * A solved station counts for whoever worked it: the player whose input
 * solved it — at a station with two consoles everybody at either console,
 * since it takes both of them to work it.
 */
function creditWorkers(state: GameState, def: PuzzleDef, playerId: string): GameState {
  const workers = moduleFor(def.type).consoles === 2 ? operatorsOf(state, def.id) : [playerId];
  return workers.reduce((next, id) => credited(next, id, 'operated'), state);
}

/**
 * The last crew left notes beside the rules: a player reading the open
 * station's rules may ask for them, one at a time. A note costs time like a
 * penalty but is no alarm, so it leaves the alarm counter alone; the next
 * one only comes after another wait.
 */
function requestHint(state: GameState, action: { playerId: string; at: number }): GameState {
  const ctx = requirePlaying(state, action.playerId, action.at);
  if (ctx === 'lost') {
    return lostNow(state, action.at);
  }
  if (!readersOf(state, ctx.def.id).includes(ctx.player.id)) {
    fail('Dafür musst du bei den Regeln dieser Station stehen.');
  }
  const hint = ctx.def.hints[state.hintsRevealed];
  if (hint === undefined) {
    fail('Keine weiteren Notizen zu dieser Station.');
  }
  if (state.hintReadyAt === null || action.at < state.hintReadyAt) {
    fail('Die nächste Notiz braucht noch einen Moment.');
  }
  const { hintCostSec, hintDelaySec } = state.mission;
  const deadlineAt = (state.deadlineAt ?? action.at) - hintCostSec * 1000;
  const helped = logEvent(
    {
      ...credited(state, ctx.player.id, 'hints'),
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

/** The item comes to rest where it belongs, and whoever brought it gets the credit. */
function delivered(state: GameState, playerId: string, itemId: string, at: Spot): GameState {
  return credited(
    {
      ...state,
      items: {
        ...state.items,
        [itemId]: { carriedBy: null, delivered: true, x: at.x + 0.5, y: at.y + 0.5 },
      },
    },
    playerId,
    'delivered',
  );
}

function deliverItem(
  state: GameState,
  action: { playerId: string; itemId: string; at: number },
): GameState {
  const { item } = requireCarryable(state, action.playerId, action.itemId);
  if (item.carriedBy !== action.playerId) {
    fail('Das trägst du gar nicht.');
  }
  const def = state.mission.map.items.find((i) => i.id === action.itemId);
  if (def === undefined) {
    fail('Dieses Objekt gibt es hier nicht.');
  }
  if (def.deliverTo === undefined) {
    fail(`${def.label} gehört in ein Schloss — damit wird aufgeschlossen.`);
  }
  return logEvent(
    delivered(state, action.playerId, action.itemId, def.deliverTo),
    'item',
    `${def.label} eingesetzt`,
    action.at,
  );
}

/** Items a station still waits for before it can be switched on. */
export function missingItemsFor(state: GameState, puzzleId: string): string[] {
  return state.mission.map.items
    .filter((def) => def.requiredFor === puzzleId && state.items[def.id]?.delivered !== true)
    .map((def) => def.label);
}

/** The locker or cabinet a player stands at, while it is still closed. */
function closedSourceAt(state: GameState, playerId: string, manualId: string): ManualDef {
  const source = state.mission.map.manuals.find((m) => m.id === manualId);
  if (source === undefined || sourceOpen(state, source)) {
    fail(source === undefined ? 'Das gibt es hier nicht.' : 'Das ist schon offen.');
  }
  if (!(state.presence.manuals[source.id] ?? []).includes(playerId)) {
    fail('Dafür musst du direkt davor stehen.');
  }
  return source;
}

/** A cabinet takes its key out of the hands of the player unlocking it, and keeps it. */
function unlockWith(state: GameState, playerId: string, source: ManualDef): GameState {
  const keyId = source.needsKey;
  if (keyId === undefined) {
    return state;
  }
  const key = state.mission.map.items.find((i) => i.id === keyId);
  const place = state.places[source.id];
  if (key === undefined || place === undefined) {
    throw new Error(`cabinet "${source.id}": no key "${keyId}" or no place this run`);
  }
  if (state.items[keyId]?.carriedBy !== playerId) {
    fail(`Abgeschlossen — es fehlt ${key.label}.`);
  }
  return delivered(state, playerId, keyId, place);
}

/**
 * A player at a locker searches it, at a cabinet unlocks it with the key in
 * hand; from then on it reads like a book. Proximity is the presence the
 * server derived.
 */
function openSource(
  state: GameState,
  action: { playerId: string; manualId: string; at: number },
): GameState {
  if (state.phase !== 'playing') {
    fail('Dafür muss die Mission laufen.');
  }
  if (state.deadlineAt !== null && action.at >= state.deadlineAt) {
    return lostNow(state, action.at);
  }
  if (state.paused !== null) {
    fail('Die Mission ist pausiert — es fehlt jemand aus der Crew.');
  }
  findPlayer(state, action.playerId);
  const source = closedSourceAt(state, action.playerId, action.manualId);
  const unlocked = unlockWith(state, action.playerId, source);
  const done = source.kind === 'cabinet' ? 'Schrank aufgeschlossen' : 'Spind durchsucht';
  return creditReaders(
    logEvent(
      {
        ...credited(unlocked, action.playerId, 'found'),
        opened: [...unlocked.opened, source.id].sort(),
      },
      'find',
      `${done}: ${source.label}`,
      action.at,
    ),
  );
}

/**
 * Spatial proximity to the station is validated by the server (it owns the
 * live positions); the reducer enforces everything else.
 */
function handleInteract(state: GameState, action: { playerId: string; at: number }): GameState {
  if (state.phase !== 'playing') {
    fail('Interagieren geht nur während der Mission.');
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
  if (armedStations(state.mission.map, state).length === 0 || current === undefined) {
    fail('Hier gibt es nichts zu aktivieren.');
  }
  const missing = missingItemsFor(state, current.id);
  if (missing.length > 0) {
    fail(`Der Station fehlt noch: ${missing.join(', ')}. Bringt es her!`);
  }
  return openPuzzle(state, state.currentPuzzleIndex, action.at);
}


/**
 * Straight into another run of the same mission with the same crew: it
 * confirms on the end screen, the host presses once. Same guards as a
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
    players: unready(state.players).map((p) => ({ ...p, spawn: null })),
    currentPuzzleIndex: 0,
    puzzleState: null,
    seed: null,
    edgework: null,
    pressedPlates: [],
    occupiedPanels: [],
    presence: NOBODY_PRESENT,
    places: {},
    opened: [],
    discovered: [],
    credits: {},
    readersCredited: [],
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
