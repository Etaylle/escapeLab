import {
  CREW_COLORS,
  NO_CREDITS,
  NOBODY_PRESENT,
  type Away,
  type Credits,
  type GameState,
  type ItemState,
  type MenuPlace,
  type Player,
  type Presence,
  type RunEvent,
} from './state.js';
import type { DailyStart } from './daily.js';
import type { Difficulty } from './difficulty.js';
import { discover, type FindKey } from './discovery.js';
import { generateEdgework } from './edgework.js';
import { fail } from './errors.js';
import type { ManualDef, Mission } from './mission.js';
import { noteKey } from './notes.js';
import { mulberry32, shuffle } from './rng.js';
import { moduleFor, type PuzzleDef, type PuzzleState } from './puzzles/index.js';
import type { ConsoleId, PuzzleContext } from './puzzles/module.js';
import {
  CLOCK_CALLS,
  CLOCK_LATE_MS,
  pickLine,
  wonBand,
  type Line,
  type LostCause,
  type RadioMoment,
} from './radio.js';
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
 * `seed` the server-rolled PRNG seed, which a room pinned to a seed passes
 * over for its own (`GameState.roomSeed`) — the reducer itself never reads a
 * clock or RNG, which keeps every game deterministic and replayable.
 */
export type Action =
  /** `color`: the crew colour the player's account wears, worn where nobody wears it yet */
  | { type: 'player-join'; playerId: string; name: string; color?: string }
  /**
   * a crew member's line is back at `at`: in a run they play on at once and count again,
   * whether the crew went on without them or not; a run standing still for the server's
   * maintenance goes on once it waits for nobody
   */
  | { type: 'player-connected'; playerId: string; at: number }
  /**
   * a crew member's line dropped at `at`: in a run they are away (`GameState.away`), and the
   * run goes on — a drop stands nothing still and alone ends no run. With `menu` it closed on
   * purpose, the player gone to the main menu: the seat stays theirs as after any drop, and the
   * crew sees where they went (`GameState.menus`)
   */
  | { type: 'player-disconnected'; playerId: string; at: number; menu?: true }
  /**
   * `playerId`, on the line, goes on without `absentId`, away since a drop, once its wait is
   * over (FIRST_WAIT_MS, LATER_WAIT_MS) and two of the crew at least are on the line
   */
  | { type: 'continue-without'; playerId: string; absentId: string; at: number }
  /**
   * the one crew member still on the line calls the run off once its wait is over: lost for
   * everyone (`lost:abandoned`)
   */
  | { type: 'call-off'; playerId: string; at: number }
  /**
   * a new device asks for the seat of `playerId`, away in a run, by its name: the crew on the
   * line is asked to let it in until TAKEOVER_WAIT_MS from `at`
   */
  | { type: 'takeover-claimed'; playerId: string; at: number }
  /** the ask for the seat of `playerId` is over: let in, refused, or withdrawn */
  | { type: 'takeover-settled'; playerId: string }
  /**
   * `playerId`, on the line in a run, opens the pause menu over it (`open`) or closes it again:
   * the run goes on, and the crew sees them at the menu (`GameState.menus`)
   */
  | { type: 'set-menu'; playerId: string; open: boolean }
  /**
   * the server goes down for maintenance at `at` — a deploy, a restart — or takes the room up
   * again from a snapshot taken then, at `waitFrom`: every seat is off the line, and a run
   * stands still for the whole crew (`wartung`) until it is back
   */
  | { type: 'maintenance'; at: number; waitFrom: number }
  | { type: 'select-color'; playerId: string; color: string }
  | { type: 'set-ready'; playerId: string; ready: boolean }
  | { type: 'switch-mission'; playerId: string; mission: Mission; difficulty: Difficulty }
  /**
   * the host switches the Tagesschicht on or off in the lobby, for a mission that offers it:
   * on, the room's runs play the seed of the UTC day of their start (daily.ts)
   */
  | { type: 'set-daily'; playerId: string; daily: boolean }
  /**
   * the players connected right now are the crew, each drawn a spawn; the rest leave. `daily`
   * is the server's day and its seed, which a run on the Tagesschicht plays
   */
  | { type: 'start-mission'; playerId: string; at: number; seed: number; daily?: DailyStart }
  /** the end of a mission's intro, once `lightsDueAt` has come: the clock starts */
  | { type: 'lights-out'; at: number }
  /**
   * a crew member has seen enough of the intro (the client's skip): once every one present
   * has, the lights go out at `at`, before `lightsDueAt`; saying it twice changes nothing
   */
  | { type: 'intro-done'; playerId: string; at: number }
  /** a move at the open puzzle; `input` is checked against that puzzle's module */
  | { type: 'puzzle-input'; playerId: string; at: number; input: unknown }
  /** once `puzzleDueAt` has come: whatever ran out at the open puzzle by `at` is dropped */
  | { type: 'puzzle-tick'; at: number }
  /** a note of the last shift, asked for at a manual object that covers the open puzzle */
  | { type: 'request-hint'; playerId: string; at: number }
  /** once `nudgeDueAt` has come: mission control names the next place for the station up */
  | { type: 'nudge'; at: number }
  /** once `clockCallDueAt` has come: mission control calls the time left on the clock */
  | { type: 'clock-call'; at: number }
  | { type: 'set-occupancy'; plates: string[]; panels: string[] }
  /**
   * who stands at which station spot (by `stationKey`), manual object, note
   * (by `noteKey`) and plate, who has seen the sign (stays seen), what each
   * player has just found at `at` (discovery.ts; stays found), what each has
   * in sight right now (discovery.ts `inSight`) and who stands on the exit
   * hatch
   */
  | {
      type: 'set-presence';
      stations: Record<string, string[]>;
      manuals: Record<string, string[]>;
      notes: Record<string, string[]>;
      plates: Record<string, string[]>;
      signSeen: string[];
      found: Record<string, FindKey[]>;
      sight: Record<string, FindKey[]>;
      exit: string[];
      at: number;
    }
  /** a locker searched or a cabinet unlocked by a player standing at it */
  | { type: 'open-source'; playerId: string; manualId: string; at: number }
  /** a note of the last shift read by a player standing at it, by its index */
  | { type: 'read-note'; playerId: string; note: number; at: number }
  /** `playerId` is the one the drone caught */
  | { type: 'drone-spotted'; at: number; penaltySec: number; playerId: string }
  | { type: 'sabotage-start'; at: number }
  | { type: 'sabotage-cleared'; at: number }
  | { type: 'sabotage-expired'; at: number }
  /** once a second during a relay emergency: instructions that ran out are replaced */
  | { type: 'sabotage-tick'; at: number }
  | { type: 'pick-item'; playerId: string; itemId: string; at: number }
  | { type: 'drop-item'; playerId: string; itemId: string; x: number; y: number; at: number }
  | { type: 'deliver-item'; playerId: string; itemId: string; at: number }
  | { type: 'interact'; playerId: string; at: number }
  | { type: 'escaped'; at: number }
  | { type: 'time-expired'; at: number }
  | { type: 'back-to-lobby'; playerId: string }
  /**
   * a crew member gives their seat up for good — the client's „Raum verlassen", „Einsatz
   * aufgeben": in the lobby and after a run they simply leave the room; in a run they leave
   * its crew, what they carried put down `where` they stood (where the room knows it), and
   * below the mission's smallest crew the run ends for everyone
   */
  | { type: 'abandon'; playerId: string; at: number; where: Spot | null }
  /** another run with the same crew: of `mission` where the host chose one, else the same again */
  | {
      type: 'rematch';
      playerId: string;
      at: number;
      seed: number;
      daily?: DailyStart;
      mission?: Mission;
    };

function findPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((p) => p.id === playerId);
  // voice: interface — the room's refusals, not the lab's, may name the players
  return player ?? fail('Unbekannter Spieler — bitte Raum neu beitreten.');
}

/** What a run standing still for the server's maintenance answers every move with. */
const STANDING_STILL = 'Wartung — der Einsatz steht still.';

/** What every move made outside a run is told. */
const NO_RUN = 'Nur während des Einsatzes.';

function requireHost(state: GameState, playerId: string): void {
  if (!findPlayer(state, playerId).isHost) {
    // voice: interface
    fail('Nur der Host (erste Spieler im Raum) kann das.');
  }
}

export function applyAction(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'player-join':
      return playerJoin(state, action);
    case 'player-connected':
      return lineBack(state, action);
    case 'player-disconnected':
      return lineDropped(state, action);
    case 'continue-without':
      return continueWithout(state, action);
    case 'call-off':
      return callOff(state, action);
    case 'takeover-claimed':
      return takeoverClaimed(state, action);
    case 'takeover-settled':
      return takeoverSettled(state, action);
    case 'set-menu':
      return setMenu(state, action);
    case 'maintenance':
      return maintenance(state, action);
    case 'select-color':
      return selectColor(state, action);
    case 'set-ready':
      return setReady(state, action);
    case 'switch-mission':
      return switchMission(state, action);
    case 'set-daily':
      return setDaily(state, action);
    case 'start-mission':
      return startMission(state, action);
    case 'lights-out':
      return lightsOut(state, action.at);
    case 'intro-done':
      return introDone(state, action);
    case 'puzzle-input':
      return handlePuzzleInput(state, action);
    case 'puzzle-tick':
      return tickPuzzle(state, action.at);
    case 'request-hint':
      return requestHint(state, action);
    case 'nudge':
      return nudge(state, action.at);
    case 'clock-call':
      return clockCall(state, action.at);
    case 'set-occupancy':
      return setOccupancy(state, action);
    case 'set-presence':
      return state.phase === 'playing' ? setPresence(state, action) : state;
    case 'open-source':
      return openSource(state, action);
    case 'read-note':
      return readNote(state, action);
    case 'sabotage-start':
      return startSabotage(state, action);
    case 'sabotage-cleared':
      // Manned valves; a relay emergency is only cleared by its instructions.
      return state.sabotage?.emergency === undefined ? clearSabotage(state, action.at) : state;
    case 'sabotage-expired':
      return expireSabotage(state, action);
    case 'sabotage-tick':
      return tickEmergency(state, action);
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
            DRONE_ALARM,
          )
        : state;
    case 'interact':
      return handleInteract(state, action);
    case 'escaped':
      return handleEscaped(state, action);
    case 'time-expired':
      return timeExpired(state, action.at);
    case 'back-to-lobby':
      return backToLobby(state, action);
    case 'abandon':
      return abandon(state, action);
    case 'rematch':
      return rematch(state, action);
  }
}

/**
 * A crew member gives their seat up for good. Before a run and after one, they leave the room
 * as they like: the host's part passes to whoever joined next, and since the crew changed,
 * everyone confirms anew. In a run they leave its crew (`leaveRun`): with fewer left than the
 * mission's smallest crew the run ends for everyone, lost and called off, its end card naming
 * who left — decided before anything else, an emergency at the relay included, is worked out
 * for a crew that small. Otherwise it goes on, at once where it stood still for the server's
 * maintenance and only them; but with fewer than the smallest crew on the line it counts again
 * whoever it went on without (`waitAgain`), rather than running on with too few counted. An
 * emergency at the relay under way is rolled anew for the consoles then (`relayForCrew`).
 */
function abandon(
  state: GameState,
  action: { playerId: string; at: number; where: Spot | null },
): GameState {
  const player = findPlayer(state, action.playerId);
  if (state.phase !== 'playing') {
    return withoutPlayer(state, player.id);
  }
  const left = leaveRun(state, player, action);
  const { min } = state.mission.players;
  if (left.players.length < min) {
    const line = `${player.name} hat den Einsatz verlassen.`;
    return lostNow({ ...left, paused: null, calledOff: line }, action.at, line);
  }
  const counted = onTheLine(left) < min ? waitAgain(left, action.at) : left;
  return resumeWhenBack(relayForCrew(counted, action.at), action.at);
}

/**
 * The crew counts again every member away it went on without, from `at` on: the stations the
 * whole crew presses and the hatch wait for them again, and their wait starts anew
 * (LATER_WAIT_MS), as for a later drop. A new device's ask for their seat still waits for its
 * answer (`claimUntil`).
 */
function waitAgain(state: GameState, at: number): GameState {
  const away = Object.fromEntries(
    Object.entries(state.away).map(([playerId, gone]) => [
      playerId,
      gone.waived ? { ...gone, since: at, waivableAt: at + LATER_WAIT_MS, waived: false } : gone,
    ]),
  );
  return { ...state, away };
}

/**
 * The run without `player`: what they carried lies `where` they stood — on their spawn where
 * the room does not know it — they stand nowhere and nobody waits for them.
 */
function leaveRun(
  state: GameState,
  player: Player,
  action: { at: number; where: Spot | null },
): GameState {
  const spawn = player.spawn === null ? null : { x: player.spawn.x + 0.5, y: player.spawn.y + 0.5 };
  const spot = action.where ?? spawn ?? { x: 0.5, y: 0.5 };
  const items = Object.fromEntries(
    Object.entries(state.items).map(([id, item]) => [
      id,
      item.carriedBy === player.id ? { ...item, carriedBy: null, x: spot.x, y: spot.y } : item,
    ]),
  );
  const away = Object.fromEntries(Object.entries(state.away).filter(([id]) => id !== player.id));
  return withoutPlayer(
    {
      ...state,
      items,
      away,
      presence: presenceWithout(state.presence, player.id),
      introDone: state.introDone.filter((id) => id !== player.id),
    },
    player.id,
  );
}

/**
 * Where everybody stands, `playerId` nowhere: at no station, source or note, on no plate, not on
 * the hatch.
 */
function presenceWithout(presence: Presence, playerId: string): Presence {
  const off = (byId: Record<string, string[]>): Record<string, string[]> =>
    Object.fromEntries(
      Object.entries(byId)
        .map(([id, players]) => [id, players.filter((p) => p !== playerId)] as const)
        .filter(([, players]) => players.length > 0),
    );
  return {
    stations: off(presence.stations),
    manuals: off(presence.manuals),
    notes: off(presence.notes),
    plates: off(presence.plates),
    signSeen: presence.signSeen.filter((p) => p !== playerId),
    exit: presence.exit.filter((p) => p !== playerId),
    sight: Object.fromEntries(Object.entries(presence.sight).filter(([id]) => id !== playerId)),
  };
}

/**
 * An emergency at the relay under way, rolled anew for the consoles it has now
 * (`relayCrewOf`) — once they changed: somebody's line dropped or is back, somebody left, or
 * the server's maintenance took every line; nothing where they did not. Its deadline, and what
 * it completed and missed, are kept. A run standing still rolls it as of the moment it stopped,
 * so that its instructions' clocks start as it goes on (`thaw`).
 */
function relayForCrew(state: GameState, at: number): GameState {
  const sabotage = state.sabotage;
  const emergency = sabotage?.emergency;
  if (sabotage === null || emergency === undefined || sameConsoles(state, emergency)) {
    return state;
  }
  const fresh = openEmergency(state, state.paused?.since ?? at);
  const { endsAt, completed, missed } = emergency;
  const rolled = { ...fresh, endsAt, completed, missed };
  return { ...state, sabotage: { ...sabotage, emergency: rolled } };
}

/** Whether `emergency` has a console for every one of the relay's crew now, and no other. */
function sameConsoles(state: GameState, emergency: RelayState): boolean {
  const owners = new Set(emergency.controls.map((control) => control.ownerId));
  const crew = relayCrewOf(state);
  return crew.length === owners.size && crew.every((player) => owners.has(player.id));
}

/**
 * Who has a console at the relay in an emergency: the crew the run counts (`crewOf`) on the
 * line — whoever is away has none, whether the crew went on without them or not. With fewer
 * than two of them on the line, where no console is worked anyway, the crew the run counts:
 * an emergency takes two consoles at least, and every one of them is somebody's.
 */
export function relayCrewOf(state: GameState): Player[] {
  const crew = crewOf(state);
  const on = crew.filter((player) => player.connected);
  return on.length >= 2 ? on : crew;
}

/**
 * The room without `playerId`: the host's part passed on where they held it, nobody ready, and
 * a menu they had open gone with them.
 */
function withoutPlayer(state: GameState, playerId: string): GameState {
  const rest = unready(state.players.filter((p) => p.id !== playerId));
  const heir = rest.some((p) => p.isHost) ? null : heirOf(rest);
  return {
    ...state,
    players: rest.map((p) => (p === heir ? { ...p, isHost: true } : p)),
    menus: menusWithout(state.menus, playerId),
  };
}

/**
 * Who takes the host's part over from a host gone, of `rest` in the order they sat down: the
 * longest seated of those on the line — whose start is not held back by their own line down —,
 * else the longest seated; null for a room left empty.
 */
export function heirOf<P extends { connected: boolean }>(rest: readonly P[]): P | null {
  return rest.find((p) => p.connected) ?? rest[0] ?? null;
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
    // voice: interface
    fail(`Für "${action.mission.title}" sind zu viele Spieler im Raum (max. ${max}).`);
  }
  return {
    ...state,
    mission: action.mission,
    difficulty: action.difficulty,
    players: unready(state.players),
    // A mission without a Tagesschicht plays its own seeds again.
    dailyOn: action.mission.daily && state.dailyOn,
  };
}

/**
 * The host's switch for the Tagesschicht, in the lobby: on, the room's runs play the seed of
 * the day each starts on, for a mission that offers it; off, the room's own seeds again. A
 * change of setup like any other: everybody confirms anew.
 */
function setDaily(state: GameState, action: { playerId: string; daily: boolean }): GameState {
  if (state.phase !== 'lobby') {
    fail('Die Tagesschicht lässt sich nur in der Lobby wählen.');
  }
  requireHost(state, action.playerId);
  if (action.daily && !state.mission.daily) {
    fail(`„${state.mission.title}" hat keine Tagesschicht.`);
  }
  if (action.daily === state.dailyOn) {
    return state;
  }
  return { ...state, dailyOn: action.daily, players: unready(state.players) };
}

function playerJoin(
  state: GameState,
  action: { playerId: string; name: string; color?: string },
): GameState {
  if (state.phase !== 'lobby') {
    fail(
      'Die Mission läuft bereits — Beitritt ist nur in der Lobby möglich. Ein getrennter Platz ' +
        'lässt sich mit seinem Namen übernehmen.',
    );
  }
  const { max } = state.mission.players;
  if (state.players.length >= max) {
    // voice: interface
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
  const asked = action.color?.toLowerCase();
  const free = CREW_COLORS.filter((c) => !taken.has(c));
  const player: Player = {
    id: action.playerId,
    name: unique,
    color: free.find((c) => c === asked) ?? free[0] ?? CREW_COLORS[0],
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

/**
 * How long the crew waits for the first crew member whose line drops in a run before it may go
 * on without them, ms …
 */
export const FIRST_WAIT_MS = 60_000;
/** … and for every later drop of the same run, whoever's it is, ms. */
export const LATER_WAIT_MS = 20_000;

/** What a move answered by a wait still running is told. */
const STILL_WAITING = 'Die Wartezeit läuft noch.';
/** What going on without somebody, or calling the run off, is told where nobody is missing. */
const NOBODY_AWAY = 'Hier fehlt niemand.';

/**
 * A crew member's line dropped at `at`. In a run they are away from then on, and the run goes
 * on: mission control says so on the air once (`awayLine`); their avatar stands where it stood
 * and holds what it held, the patrols do not see it, their console counts as unmanned and an
 * emergency at the relay is rolled anew without it (`relayForCrew`); an intro the others have
 * all seen enough of ends (`introOver`). The crew may go on without them once the drop's wait
 * is over — the run's first drop waits FIRST_WAIT_MS, every later one LATER_WAIT_MS. A drop
 * stands nothing still and alone ends no run, and a line that dropped once is down: said twice,
 * nothing counts twice. A menu they had open is closed with it. A line closed on purpose for
 * the main menu (`menu`) counts as a drop — the seat stays theirs, in a lobby too — and the crew
 * sees where they went.
 */
function lineDropped(
  state: GameState,
  action: { playerId: string; at: number; menu?: true },
): GameState {
  const player = findPlayer(state, action.playerId);
  const off = setConnected(state, player.id, false);
  const menus = menusWithout(state.menus, player.id);
  const gone: Record<string, MenuPlace> = action.menu === true ? { [player.id]: 'main' } : {};
  const dropped = { ...off, menus: { ...menus, ...gone } };
  if (state.phase !== 'playing' || !player.connected) {
    return dropped;
  }
  const wait = state.drops === 0 ? FIRST_WAIT_MS : LATER_WAIT_MS;
  const away = {
    ...state.away,
    [player.id]: { since: action.at, waivableAt: action.at + wait, waived: false },
  };
  const line = awayLine(player.name, action.menu === true);
  const said = logEvent({ ...dropped, away, drops: state.drops + 1 }, 'away', line, action.at);
  return introOver(relayForCrew(said, action.at), action.at);
}

/**
 * What mission control says on the air as a crew member goes from the run: „Bens Leitung ist
 * weg." for a line that dropped, „Ben hat sich abgemeldet." for the main menu (`menu`).
 */
function awayLine(name: string, menu: boolean): string {
  return menu ? `${name} hat sich abgemeldet.` : `${genitive(name)} Leitung ist weg.`;
}

/**
 * A crew member's line is back at `at`. In a run they play on at once and count again, whether
 * the crew went on without them or not: an emergency at the relay is rolled anew to give them a
 * console (`relayForCrew`), and a run standing still for the server's maintenance goes on once
 * it waits for nobody (`resumeWhenBack`).
 */
function lineBack(state: GameState, action: { playerId: string; at: number }): GameState {
  const id = findPlayer(state, action.playerId).id;
  const back = { ...setConnected(state, id, true), menus: menusWithout(state.menus, id) };
  if (state.phase !== 'playing') {
    return back;
  }
  const away = Object.fromEntries(
    Object.entries(state.away).filter(([playerId]) => playerId !== action.playerId),
  );
  return resumeWhenBack(relayForCrew({ ...back, away }, action.at), action.at);
}

/**
 * Whom the crew misses: the members away it has not gone on without, by player id — whom the
 * stations the whole crew presses and the hatch wait for, and a run standing still for the
 * server's maintenance too.
 */
function missing(state: GameState): string[] {
  return Object.entries(state.away)
    .filter(([, away]) => !away.waived)
    .map(([playerId]) => playerId);
}

/**
 * The crew the run counts — at the stations the whole crew presses, at the hatch: everybody
 * but whom it went on without (`continue-without`), whoever is away included.
 */
export function crewOf(state: GameState): Player[] {
  return state.players.filter((player) => state.away[player.id]?.waived !== true);
}

/** How many of the crew are on the line. */
function onTheLine(state: GameState): number {
  return state.players.filter((player) => player.connected).length;
}

/**
 * A run standing still for the server's maintenance goes on — every deadline moved on by the
 * pause (`thaw`) — once it misses nobody: the crew back, or gone on without whoever is not.
 */
function resumeWhenBack(state: GameState, at: number): GameState {
  return state.paused !== null && missing(state).length === 0 ? thaw(state, at) : state;
}

/**
 * `playerId`, on the line, goes on without `absentId`: away since a drop whose wait is over,
 * and two of the crew at least on the line — one alone could work no station with two
 * consoles. The absent keep their seat and are counted out until they are back (`crewOf`); at
 * the relay they have no console already, being away (`relayCrewOf`). A run standing still for
 * the server's maintenance goes on once it waits for nobody else.
 */
function continueWithout(
  state: GameState,
  action: { playerId: string; absentId: string; at: number },
): GameState {
  if (state.phase !== 'playing') {
    fail(NO_RUN);
  }
  findPlayer(state, action.playerId);
  const absent = state.away[action.absentId];
  if (absent === undefined || absent.waived) {
    fail(NOBODY_AWAY);
  }
  if (action.at < absent.waivableAt) {
    fail(STILL_WAITING);
  }
  if (onTheLine(state) < 2) {
    fail('Allein läuft kein Einsatz weiter.');
  }
  const away = { ...state.away, [action.absentId]: { ...absent, waived: true } };
  return resumeWhenBack({ ...state, away }, action.at);
}

/** How long a new device's ask to take a seat over waits for the crew to let it in, ms. */
export const TAKEOVER_WAIT_MS = 30_000;

/**
 * A new device asks for the seat of `playerId` by its name (Jackbox): the seat's line has to be
 * down, somebody of the crew on the line to answer, and no other ask waiting for it. The crew
 * on the line is asked until TAKEOVER_WAIT_MS from `at` (`takeovers` in its views); the room
 * lets the device in, or refuses it, and settles the ask (`takeover-settled`).
 */
function takeoverClaimed(state: GameState, action: { playerId: string; at: number }): GameState {
  if (state.phase !== 'playing') {
    fail(NO_RUN);
  }
  const seat = findPlayer(state, action.playerId);
  const away = state.away[seat.id];
  if (seat.connected || away === undefined) {
    fail(`${seat.name} ist noch verbunden.`);
  }
  if (onTheLine(state) === 0) {
    fail('Gerade ist niemand verbunden, der die Übernahme bestätigen könnte.');
  }
  if (away.claimUntil !== undefined) {
    fail(`Für ${seat.name} wartet schon eine Übernahme auf Antwort.`);
  }
  const claimed = { ...away, claimUntil: action.at + TAKEOVER_WAIT_MS };
  return { ...state, away: { ...state.away, [seat.id]: claimed } };
}

/** The ask for the seat of `playerId` is over, however it went; nothing where none waits. */
function takeoverSettled(state: GameState, action: { playerId: string }): GameState {
  const away = state.away[action.playerId];
  if (away?.claimUntil === undefined) {
    return state;
  }
  const settled = { since: away.since, waivableAt: away.waivableAt, waived: away.waived };
  return { ...state, away: { ...state.away, [action.playerId]: settled } };
}

/** The plates and the emergency's panels manned now, as the room reports them: only in a run. */
function setOccupancy(
  state: GameState,
  action: { plates: string[]; panels: string[] },
): GameState {
  if (state.phase !== 'playing') {
    return state;
  }
  const pressedPlates = [...action.plates].sort();
  return { ...state, pressedPlates, occupiedPanels: [...action.panels].sort() };
}

/**
 * A crew member opens the pause menu over the run, or closes it (`open`): the run goes on — the
 * clock, the patrols, the emergencies — and the crew sees them at the menu (`GameState.menus`).
 * Only a member on the line, and only in a run: anywhere else it changes nothing — nor does a
 * menu said open that stands open, or closed that is — and a line that drops closes it
 * (`lineDropped`).
 */
function setMenu(state: GameState, action: { playerId: string; open: boolean }): GameState {
  const player = findPlayer(state, action.playerId);
  const open = state.menus[player.id] === 'pause';
  if (state.phase !== 'playing' || !player.connected || open === action.open) {
    return state;
  }
  const menus = menusWithout(state.menus, player.id);
  return { ...state, menus: action.open ? { ...menus, [player.id]: 'pause' } : menus };
}

/** `menus` with only the main menus kept: whoever went there, their seat kept; no pause menus. */
function mainMenusOf(menus: Record<string, MenuPlace>): Record<string, MenuPlace> {
  return Object.fromEntries(Object.entries(menus).filter(([, place]) => place === 'main'));
}

/** `menus` without `playerId`'s: whatever menu they had open, closed. */
function menusWithout(
  menus: Record<string, MenuPlace>,
  playerId: string,
): Record<string, MenuPlace> {
  return Object.fromEntries(Object.entries(menus).filter(([id]) => id !== playerId));
}

/**
 * The server down for maintenance at `at`, or taking the room up again at `waitFrom`: every
 * seat is off the line. In a run each is away from `at` — whoever was away already keeps their
 * drop, and whom the run went on without stays counted out — and the run stands still for the
 * whole crew (`wartung`), its clock stopped from `at`, or from the pause it stood in already,
 * until it misses nobody (`resumeWhenBack`): whoever dropped before it is waited for with the
 * rest. Nobody may be left behind before FIRST_WAIT_MS after `waitFrom`, however long their own
 * drop has lasted, an ask for a seat lapses — its device went with the server — and every menu
 * open over the run closes with its line; whoever went to the main menu stays gone there. An
 * emergency at the relay is rolled for the crew the run counts, nobody being on the line
 * (`relayForCrew`). Said twice, nothing more changes.
 */
function maintenance(state: GameState, action: { at: number; waitFrom: number }): GameState {
  const players = state.players.map((p) => (p.connected ? { ...p, connected: false } : p));
  if (state.phase !== 'playing') {
    return { ...state, players, menus: mainMenusOf(state.menus) };
  }
  const waivableAt = action.waitFrom + FIRST_WAIT_MS;
  const away = Object.fromEntries(
    players.map((p) => [p.id, awayThroughMaintenance(state.away[p.id], action.at, waivableAt)]),
  );
  const since = state.paused?.since ?? action.at;
  const menus = mainMenusOf(state.menus);
  const down = { ...state, players, away, menus, paused: { since, kind: 'wartung' as const } };
  return relayForCrew(down, action.at);
}

/**
 * A seat away through maintenance: away from `at`, or since its own drop, its ask for a takeover
 * lapsed; waited for until `waivableAt` at least, unless the run went on without it.
 */
function awayThroughMaintenance(was: Away | undefined, at: number, waivableAt: number): Away {
  if (was === undefined) {
    return { since: at, waivableAt, waived: false };
  }
  const kept = { since: was.since, waivableAt: was.waivableAt, waived: was.waived };
  return kept.waived ? kept : { ...kept, waivableAt: Math.max(kept.waivableAt, waivableAt) };
}

/**
 * The one crew member still on the line calls the run off, once the wait for whoever the crew
 * misses is over: lost for everyone (`lost:abandoned`), its end card naming them.
 */
function callOff(state: GameState, action: { playerId: string; at: number }): GameState {
  if (state.phase !== 'playing') {
    fail(NO_RUN);
  }
  findPlayer(state, action.playerId);
  const waited = missing(state);
  if (waited.length === 0) {
    fail(NOBODY_AWAY);
  }
  if (onTheLine(state) > 1) {
    fail('Abbrechen erst, wenn sonst niemand mehr verbunden ist.');
  }
  const due = Math.min(...waited.map((playerId) => state.away[playerId]?.waivableAt ?? 0));
  if (action.at < due) {
    fail(STILL_WAITING);
  }
  const names = waited.map((playerId) => findPlayer(state, playerId).name).join(', ');
  const line = `Abgebrochen ohne ${names}.`;
  return lostNow({ ...state, paused: null, calledOff: line }, action.at, line);
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
    // Before the lights go out the clock stands still at the full limit.
    remainingSec:
      state.deadlineAt === null
        ? state.mission.timeLimitSec
        : Math.max(0, Math.ceil((state.deadlineAt - at) / 1000)),
    at,
    crew: crewOf(state).map((p) => p.id),
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
 * What each player found at `at` that they had not found before, by player id; nobody who
 * found nothing new.
 */
function freshFinds(
  state: GameState,
  found: Readonly<Record<string, readonly FindKey[]>>,
): Record<string, FindKey[]> {
  return Object.fromEntries(
    Object.entries(found)
      .map(([playerId, keys]) => {
        const had = new Set(state.found[playerId] ?? []);
        return [playerId, [...new Set(keys)].filter((key) => !had.has(key))] as const;
      })
      .filter(([, keys]) => keys.length > 0),
  );
}

/**
 * Who stands where, as the server sees it. Lists are kept sorted and empty
 * ones dropped, so equal presence compares equal; whoever has seen the sign
 * keeps it, and whatever a player has found stays theirs — the finds that
 * matter are their discoveries (discovery.ts `discover`). Nobody stands on
 * the hatch before it opens.
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
  const fresh = freshFinds(state, action.found);
  const found = { ...state.found };
  for (const [playerId, keys] of Object.entries(fresh)) {
    found[playerId] = [...(found[playerId] ?? []), ...keys].sort();
  }
  return creditReaders({
    ...state,
    presence: {
      stations: tidy(action.stations),
      manuals: tidy(action.manuals),
      notes: tidy(action.notes),
      plates: tidy(action.plates),
      signSeen: [...new Set([...state.presence.signSeen, ...action.signSeen])].sort(),
      exit: inEscapePhase(state) ? [...new Set(action.exit)].sort() : [],
      sight: tidy(action.sight),
    },
    found,
    discoveries: discover(state, fresh, action.at),
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

/**
 * Put a puzzle on the consoles; its first note is held back for a while, and switching it on
 * is the station's first input: mission control's quiet clock starts over.
 */
function openPuzzle(state: GameState, index: number, at: number): GameState {
  return creditReaders({
    ...state,
    puzzleState: initPuzzleState(state, index, at),
    hintReadyAt: at + state.mission.hintDelaySec * 1000,
    quietSince: at,
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
 * The room's players are the crew — as many as the mission takes — every one of them on the
 * line, and everyone but the host has confirmed. A seat whose line is down holds the start
 * back (`linesDown`) until it is back, or the room frees it.
 */
function crewToStart(state: GameState): Player[] {
  const off = state.players.filter((p) => !p.connected);
  if (off.length > 0) {
    const inMenu = (p: Player): boolean => state.menus[p.id] === 'main';
    const names = (ps: Player[]): string[] => ps.map((p) => p.name);
    fail(`${seatsOff(names(off.filter((p) => !inMenu(p))), names(off.filter(inMenu)))}.`);
  }
  const crew = state.players;
  const { min, max } = state.mission.players;
  if (crew.length < min) {
    // voice: interface
    fail(`Für diese Mission braucht es mindestens ${min} Spielende.`);
  }
  if (crew.length > max) {
    // voice: interface
    fail(`Für diese Mission sind es zu viele — höchstens ${max} Spielende.`);
  }
  // The host starts by pressing start; everyone else confirms beforehand.
  const waiting = crew.filter((p) => !p.isHost && !p.ready);
  if (waiting.length > 0) {
    fail(`Noch nicht bereit: ${waiting.map((p) => p.name).join(', ')}.`);
  }
  return crew;
}

/** A name in the genitive, „Bens", „Jens’": the s an apostrophe after an s, ß, x or z. */
function genitive(name: string): string {
  return /[sßxz]$/i.test(name) ? `${name}’` : `${name}s`;
}

/**
 * What holds a start back while seats of the room are off the line, by their names: „Bens
 * Leitung ist unterbrochen".
 */
export function linesDown(names: readonly string[]): string {
  const [only] = names;
  if (names.length === 1 && only !== undefined) {
    return `${genitive(only)} Leitung ist unterbrochen`;
  }
  return `Leitungen unterbrochen: ${names.join(', ')}`;
}

/**
 * Who went to the main menu, their seat kept: „Cem ist im Hauptmenü", „Cem und Dora sind im
 * Hauptmenü".
 */
export function inMainMenu(names: readonly string[]): string {
  if (names.length < 2) {
    return `${names.join('')} ist im Hauptmenü`;
  }
  return `${names.slice(0, -1).join(', ')} und ${names.at(-1) ?? ''} sind im Hauptmenü`;
}

/**
 * What holds a start back while seats of the room are off the line: whose line is down
 * (`linesDown`) and who went to the main menu (`inMainMenu`), the two apart by a dot.
 */
export function seatsOff(down: readonly string[], inMenu: readonly string[]): string {
  const said = [
    ...(down.length > 0 ? [linesDown(down)] : []),
    ...(inMenu.length > 0 ? [inMainMenu(inMenu)] : []),
  ];
  return said.join(' · ');
}

/**
 * The Tagesschicht a run plays, where the host has it on: the day the server's clock has at the
 * start, and its seed, both from the server (`DailyStart`); null where it is off.
 */
function dailyOfRun(state: GameState, daily: DailyStart | undefined): DailyStart | null {
  if (!state.dailyOn) {
    return null;
  }
  if (daily === undefined) {
    fail('Die Tagesschicht ist auf diesem Server nicht eingerichtet.');
  }
  return daily;
}

/**
 * The seed a run plays: on the Tagesschicht the day's, whatever else the room is pinned to; in
 * a room pinned to a seed, run n (from 0) plays seed + n, wrapped to 32 bits, so that any of
 * its runs can be named by its seed and played again; in any other room, the seed the server
 * rolled.
 */
function runSeed(state: GameState, rolled: number, daily: DailyStart | null): number {
  if (daily !== null) {
    return daily.seed;
  }
  return state.roomSeed === null ? rolled : (state.roomSeed + state.runs) >>> 0;
}

function startMission(
  state: GameState,
  action: { playerId: string; at: number; seed: number; daily?: DailyStart },
): GameState {
  if (state.phase !== 'lobby') {
    fail('Die Mission läuft bereits.');
  }
  requireHost(state, action.playerId);
  const crew = crewToStart(state);
  const { map, intro } = state.mission;
  const daily = dailyOfRun(state, action.daily);
  const seed = runSeed(state, action.seed, daily);
  const started: GameState = {
    ...state,
    phase: 'playing',
    players: drawSpawns(crew, map.spawns, seed),
    currentPuzzleIndex: 0,
    puzzleState: null,
    seed,
    // The Tagesschicht a run plays is the day it starts on, by the server's clock.
    daily: daily === null ? null : daily.day,
    runs: state.runs + 1,
    edgework: generateEdgework(mulberry32((seed ^ EDGEWORK_STREAM) >>> 0)),
    pressedPlates: [],
    occupiedPanels: [],
    presence: NOBODY_PRESENT,
    places: placeSources(map.manuals, seed),
    opened: [],
    found: {},
    discoveries: {},
    notesRead: [],
    credits: Object.fromEntries(crew.map((player) => [player.id, NO_CREDITS])),
    readersCredited: [],
    sabotage: null,
    paused: null,
    away: {},
    menus: {},
    drops: 0,
    calledOff: null,
    items: Object.fromEntries(
      map.items.map((item) => [
        item.id,
        { x: item.x + 0.5, y: item.y + 0.5, carriedBy: null, delivered: false },
      ]),
    ),
    events: [],
    startedAt: action.at,
    introDone: [],
    lightsOutAt: null,
    lightsDueAt: intro === undefined ? null : action.at + intro.lightsSec * 1000,
    deadlineAt: null,
    finishedAt: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    hintsUsed: 0,
    hintsRevealed: 0,
    hintReadyAt: null,
    quietSince: null,
    nudgesGiven: 0,
    clockCalls: 0,
  };
  // Without an intro the lights are out from the start, and nobody sees them fail.
  return intro === undefined ? clockStarts(started, action.at) : started;
}

/** What the run report calls the lights failing at the end of an intro. */
export const POWER_OUT = 'Stromausfall';

/**
 * The end of the intro: the lights fail, the clock starts, the first
 * station is armed and mission control speaks up. The room dispatches it
 * once `lightsDueAt` has come; it waits out a pause like every deadline.
 */
function lightsOut(state: GameState, at: number): GameState {
  if (state.phase !== 'playing' || state.lightsOutAt !== null || state.paused !== null) {
    return state;
  }
  return clockStarts(logEvent(state, 'power', POWER_OUT, at), at);
}

/**
 * Whether every crew member present — connected — has seen enough of the intro: then it
 * ends. Somebody away holds nothing up; a crew with nobody present has seen nothing.
 */
function everyoneWatched(state: GameState): boolean {
  const present = state.players.filter((player) => player.connected);
  return present.length > 0 && present.every((player) => state.introDone.includes(player.id));
}

/**
 * The intro over at `at` where every one present has said they had seen enough of it
 * (`everyoneWatched`) while the power is still on: once the one who had not goes away, or a run
 * standing still for the server's maintenance goes on (`thaw`). Nothing changes otherwise.
 */
function introOver(state: GameState, at: number): GameState {
  const said = state.lightsOutAt === null && state.introDone.length > 0;
  return said && everyoneWatched(state) ? lightsOut(state, at) : state;
}

/**
 * A crew member has seen enough of the intro: noted once, however often said, and only while
 * the power is still on. Once every one present has, the lights go out at `at` — not while the
 * run stands still for the server's maintenance, which ends it instead as the run goes on
 * (`thaw`).
 */
function introDone(state: GameState, action: { playerId: string; at: number }): GameState {
  if (state.phase !== 'playing' || state.lightsOutAt !== null) {
    return state;
  }
  const player = findPlayer(state, action.playerId);
  if (state.introDone.includes(player.id)) {
    return state;
  }
  const noted = { ...state, introDone: [...state.introDone, player.id] };
  return everyoneWatched(noted) ? lightsOut(noted, action.at) : noted;
}

/**
 * From `at` on the lights are out and the clock runs; mission control opens the run, and the
 * first station, up from now, is quiet from now. A call of the clock at or above the whole time
 * the run has — five minutes left, in a run of five — is behind it from the start.
 */
function clockStarts(state: GameState, at: number): GameState {
  const limitSec = state.mission.timeLimitSec;
  const running: GameState = {
    ...state,
    lightsOutAt: at,
    lightsDueAt: null,
    deadlineAt: at + limitSec * 1000,
    quietSince: at,
    nudgesGiven: 0,
    clockCalls: CLOCK_CALLS.filter((call) => call.sec >= limitSec).length,
  };
  return logRadio(running, 'start', state.mission.radio.start, at);
}

/** Common guards for in-game actions; returns the acting player's current puzzle. */
function requirePlaying(
  state: GameState,
  playerId: string,
  at: number,
): { player: Player; def: PuzzleDef; puzzleState: PuzzleState } | 'lost' {
  if (state.paused !== null) {
    fail(STANDING_STILL);
  }
  if (state.phase !== 'playing' || state.puzzleState === null) {
    fail('Gerade ist keine Station in Betrieb.');
  }
  if (state.deadlineAt !== null && at >= state.deadlineAt) {
    return 'lost';
  }
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (def === undefined) {
    fail('Gerade ist keine Station in Betrieb.');
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
    {
      ...state,
      hintsRevealed: 0,
      hintReadyAt: null,
      readersCredited: [],
      quietSince: null,
      nudgesGiven: 0,
    },
    'puzzle',
    `${solved?.title ?? 'Station'} gelöst`,
    at,
  );
  const logged = logRadio(reported, 'solved', solved?.onSolved, at, solved?.id);
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
      return logRadio(unlocked, 'escape', state.mission.radio.escape, at);
    }
    return wonNow(logged, at, 'Alle Systeme online');
  }
  // The next puzzle waits at its station, quiet from now.
  return { ...logged, currentPuzzleIndex: nextIndex, puzzleState: null, quietSince: at };
}

/**
 * Dispatched by the server once the whole crew it counts (`crewOf`) stands on the hatch —
 * somebody away counts where their avatar stands. Never while the run stands still for the
 * server's maintenance: a crew off the line in the middle of the escape is not out.
 */
function handleEscaped(state: GameState, action: { at: number }): GameState {
  if (!inEscapePhase(state)) {
    fail('Der Notausgang ist noch verriegelt.');
  }
  if (state.paused !== null) {
    return state;
  }
  if (state.deadlineAt !== null && action.at >= state.deadlineAt) {
    return lostNow(state, action.at);
  }
  return wonNow(state, action.at, 'Alle draußen');
}

/** Append a line to the run report; a line heard in the run names the `moment` that brought it. */
function logEvent(
  state: GameState,
  kind: RunEvent['kind'],
  label: string,
  at: number,
  seconds: number | null = null,
  moment?: RadioMoment,
): GameState {
  const event: RunEvent =
    moment === undefined ? { at, kind, label, seconds } : { at, kind, label, seconds, moment };
  return { ...state, events: [...state.events, event] };
}

/**
 * A line is heard at `moment` — mission control's on the radio, or the plant's over its
 * loudspeakers (radio.ts `speakerOf`) — if the mission scripted one for it: of its texts, the
 * one the run picks for it (radio.ts `pickLine`) at its `place` — the station, the clock's
 * call, the band of the time left, the cause — the `occurrence`-th time it comes in the run.
 */
function logRadio(
  state: GameState,
  moment: RadioMoment,
  line: Line | undefined,
  at: number,
  place = '',
  occurrence = 0,
): GameState {
  if (line === undefined) {
    return state;
  }
  const key = place === '' ? moment : `${moment}:${place}`;
  const text = pickLine(line, state.seed ?? 0, key, occurrence);
  return logEvent(state, 'radio', text, at, null, moment);
}

/**
 * How many emergencies the run has had so far, the one under way among them: its lines take
 * their turn by it (radio.ts `pickLine`), so that the next emergency hears the next take.
 */
function emergenciesSoFar(state: GameState): number {
  return state.events.filter((e) => e.kind === 'sabotage' && e.label !== EMERGENCY_CLEARED).length;
}

/** Why a run was lost: the last line of its report. */
const OUT_OF_TIME = 'Zeit abgelaufen';
const TOO_MANY_ALARMS = 'Zu viele Alarme — Notversorgung abgeschaltet.';
/**
 * The report lines of the two alarms no station sets off, and of an
 * emergency cleared in time — `runReport` tells the alarms apart by them.
 */
export const DRONE_ALARM = 'Von einer Drohne erfasst';
export const EMERGENCY_MISSED = 'Notfall nicht rechtzeitig behoben';
export const EMERGENCY_CLEARED = 'Notfall behoben';

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
  return at >= deadlineAt ? lostNow(punished, at) : firstAlarm(punished, reason, at);
}

/**
 * The operator's word on the run's first alarm, whatever set it off — a wrong move, a drone, a
 * slip at an emergency's console: nothing on any alarm after it, so that nobody is nagged, and
 * nothing on an emergency missed, which has a line of its own.
 */
function firstAlarm(state: GameState, reason: string, at: number): GameState {
  const first = state.penaltySeq === 1 && reason !== EMERGENCY_MISSED;
  return first ? logRadio(state, 'alarm', state.mission.radio.alarm, at) : state;
}

/**
 * The run is won at `at`, its report's last line `how`; the operator's last word on it follows,
 * by the time it left (radio.ts `wonBand`), for the end card to play.
 */
function wonNow(state: GameState, at: number, how: string): GameState {
  const finished = logEvent(overNow(state, 'won', at), 'finish', how, at);
  const band = wonBand((state.deadlineAt ?? at) - at);
  return logRadio(finished, 'won', state.mission.radio.won?.[band], at, band);
}

/**
 * The clock has run out at `at`: a run that plays, and does not stand still for the server's
 * maintenance, is lost — whoever is away meanwhile.
 */
function timeExpired(state: GameState, at: number): GameState {
  return state.phase === 'playing' && state.paused === null ? lostNow(state, at) : state;
}

/**
 * The run is lost at `at`, `why`: whatever emergency ran ends with it (`overNow`), and the
 * operator's last word on it follows, by what lost it, for the end card to play.
 */
function lostNow(state: GameState, at: number, why = OUT_OF_TIME): GameState {
  const finished = logEvent(overNow(state, 'lost', at), 'finish', why, at);
  const cause = lostCause(state, why);
  return logRadio(finished, 'lost', state.mission.radio.lost?.[cause], at, cause);
}

/** What lost a run that ends `why`: called off, its alarms at the limit, or its time. */
function lostCause(state: GameState, why: string): LostCause {
  if (state.calledOff !== null) {
    return 'abandoned';
  }
  return why === TOO_MANY_ALARMS ? 'alarms' : 'time';
}

/**
 * The run over at `at`, won or lost: nobody stands ready for the next yet, no station is open,
 * and no emergency runs on — its consoles were the crew's as it ran, which the end screen's
 * comings and goings no longer match.
 */
function overNow(state: GameState, phase: 'won' | 'lost', at: number): GameState {
  return {
    ...state,
    phase,
    players: unready(state.players),
    puzzleState: null,
    sabotage: null,
    finishedAt: at,
  };
}

/**
 * An emergency interrupts whatever the crew was doing: the open puzzle is
 * dropped (its station stays armed and can be restarted afterwards), the
 * plant's loudspeakers say so, where the mission gives them a message, and the
 * operator after them.
 */
function startSabotage(state: GameState, action: { at: number }): GameState {
  const sabotage = state.mission.map.sabotage;
  if (state.phase !== 'playing' || sabotage === undefined || state.sabotage !== null) {
    return state;
  }
  const endsAt = action.at + sabotage.durationSec * 1000;
  const started = logEvent(
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
  const seen = emergenciesSoFar(state);
  const announced = logRadio(started, 'announce', sabotage.announce, action.at, '', seen);
  const line = state.mission.radio.emergency?.start;
  return logRadio(announced, 'emergency', line, action.at, '', seen);
}

/**
 * Mission control's quiet clock once an emergency is over, at `at`: the crew comes back to the
 * station that is up, which is quiet from then on — none where no station is up.
 */
function quietAfterEmergency(state: GameState, at: number): number | null {
  return state.quietSince === null ? null : at;
}

/** The emergency is over in time: the crew can get back to the stations, the operator says so. */
function clearSabotage(state: GameState, at: number): GameState {
  if (state.sabotage === null) {
    return state;
  }
  const cleared = logEvent(
    { ...state, sabotage: null, quietSince: quietAfterEmergency(state, at) },
    'sabotage',
    EMERGENCY_CLEARED,
    at,
  );
  const line = state.mission.radio.emergency?.cleared;
  return logRadio(cleared, 'cleared', line, at, '', emergenciesSoFar(state) - 1);
}

/**
 * The relay emergency's def, a console for each of the relay's crew (`relayCrewOf`): rebuilt
 * from the game whenever needed, never stored.
 */
function emergencyDef(state: GameState): RelayDef {
  const sabotage = state.mission.map.sabotage;
  if (sabotage === undefined) {
    throw new Error(`mission "${state.mission.id}" has no sabotage to run a relay emergency`);
  }
  return relayDefFor(relayCrewOf(state), sabotage);
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
    fail(STANDING_STILL);
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
 * A run standing still for the server's maintenance goes on at `at` (`resumeWhenBack`).
 * Everything with a deadline is shifted by the time it stood still, so a deploy never costs the
 * crew the clock; an intro the crew said it had seen enough of while it waited ends as it goes
 * on (`introOver`).
 */
function thaw(state: GameState, at: number): GameState {
  if (state.paused === null) {
    return state;
  }
  const frozen = Math.max(0, at - state.paused.since);
  const resumed: GameState = {
    ...state,
    paused: null,
    lightsDueAt: later(state.lightsDueAt, frozen),
    deadlineAt: later(state.deadlineAt, frozen),
    sabotage: state.sabotage === null ? null : shiftSabotage(state.sabotage, frozen),
    hintReadyAt: later(state.hintReadyAt, frozen),
    quietSince: later(state.quietSince, frozen),
  };
  return introOver(resumed, at);
}

/** A moment of the run (epoch ms) moved on by `ms`, as a pause moves it; none stays none. */
function later(at: number | null, ms: number): number | null {
  return at === null ? null : at + ms;
}

/**
 * The emergency ran out: an alarm with its penalty, and the operator's word on it — unless the
 * alarm lost the run, which has the last word of its own.
 */
function expireSabotage(state: GameState, action: { at: number }): GameState {
  const sabotage = state.mission.map.sabotage;
  if (state.sabotage === null || sabotage === undefined) {
    return state;
  }
  const missed = applyPenalty(
    { ...state, sabotage: null, quietSince: quietAfterEmergency(state, action.at) },
    sabotage.penaltySec,
    action.at,
    EMERGENCY_MISSED,
  );
  const line = missed.phase === 'playing' ? state.mission.radio.emergency?.missed : undefined;
  return logRadio(missed, 'missed', line, action.at, '', emergenciesSoFar(state) - 1);
}

/**
 * What a station answers a move nobody backs up with: where it finds nobody — at the other
 * console, where it has two (`consoles`), and at the rules.
 */
function unbacked(consoles: 2 | undefined): string {
  return consoles === 2
    ? 'Eingabe gesperrt: Am anderen Pult und bei den Regeln steht niemand.'
    : 'Eingabe gesperrt: Bei den Regeln steht niemand.';
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
    fail('Eingabe nur am Pult.');
  }
  const puzzleModule = moduleFor(def.type);
  if (!puzzleModule.wholeCrew && backupsOf(state, def.id, player.id).length === 0) {
    fail(unbacked(puzzleModule.consoles));
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
  // Any move the station takes, right or wrong, starts mission control's quiet clock over.
  const next = { ...state, puzzleState: result.state, quietSince: action.at };
  if (result.penalty !== null) {
    const blamed = credited(next, player.id, 'alarms');
    return applyPenalty(blamed, result.penaltySec ?? def.penaltySec, action.at, result.penalty);
  }
  return result.solved ? advance(creditWorkers(next, def, player.id), action.at) : next;
}

/** The open puzzle and its def while a run is on and not paused; null otherwise. */
function openPuzzleOf(state: GameState): { def: PuzzleDef; puzzleState: PuzzleState } | null {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (
    state.phase !== 'playing' ||
    state.paused !== null ||
    state.puzzleState === null ||
    def === undefined
  ) {
    return null;
  }
  return { def, puzzleState: state.puzzleState };
}

/**
 * When the open puzzle next changes on the clock alone — a sync press
 * running out — so that the room can tick it then (`puzzle-tick`); null
 * while nothing is due, between stations, in an emergency, while paused and
 * outside a run.
 */
export function puzzleDueAt(state: GameState): number | null {
  const open = openPuzzleOf(state);
  if (open === null) {
    return null;
  }
  return moduleFor(open.def.type).dueAt?.(open.def, open.puzzleState) ?? null;
}

/** The open puzzle at `at`, whatever ran out by then gone; the same state where nothing did. */
function tickPuzzle(state: GameState, at: number): GameState {
  const open = openPuzzleOf(state);
  if (open === null) {
    return state;
  }
  const aged = moduleFor(open.def.type).expire?.(open.def, open.puzzleState, at);
  return aged === undefined || aged === open.puzzleState ? state : { ...state, puzzleState: aged };
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
 * The last shift left notes beside the rules: a player reading the open
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
    fail('Notizen nur bei den Regeln dieser Station.');
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

/**
 * How long the station that is up may stay quiet before mission control names the next place,
 * in ms: no input at either console, from when it came up, was switched on or last worked.
 */
export const NUDGE_QUIET_MS = 90_000;

/** What the run report calls mission control speaking up unasked; its line follows. */
export const NUDGED = 'Leitstelle meldet sich';

/**
 * When mission control next speaks up about the station that is up, epoch ms: NUDGE_QUIET_MS
 * after it went quiet, while the mission has a line left for it — the second only after
 * another quiet spell. Null between stations, in an emergency, while paused, outside a run,
 * once its lines are said and where the mission has none (on „hart" `scaleMission` takes them
 * away).
 */
export function nudgeDueAt(state: GameState): number | null {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (
    state.phase !== 'playing' ||
    state.paused !== null ||
    state.sabotage !== null ||
    state.quietSince === null ||
    def === undefined ||
    state.nudgesGiven >= def.nudges.length
  ) {
    return null;
  }
  return state.quietSince + NUDGE_QUIET_MS;
}

/**
 * Mission control speaks up once `nudgeDueAt` has come: the station's next line goes on the
 * air, logged as a `nudge`, and the quiet clock starts over for the one after it. Nothing
 * before it is due — the room only asks then.
 */
function nudge(state: GameState, at: number): GameState {
  const due = nudgeDueAt(state);
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  const line = def?.nudges[state.nudgesGiven];
  if (due === null || at < due || def === undefined || line === undefined) {
    return state;
  }
  const spoken = { ...state, nudgesGiven: state.nudgesGiven + 1, quietSince: at };
  const text = pickLine(line, state.seed ?? 0, `nudge:${def.id}:${state.nudgesGiven}`);
  return logEvent(spoken, 'nudge', text, at, null, 'nudge');
}

/**
 * When mission control next calls the time left, epoch ms: as the clock comes down to the next
 * of its calls the run has not left behind (radio.ts `CLOCK_CALLS`). Null outside a run, before
 * the lights are out, while paused, once every call is behind the run, and where the mission
 * has no calls at all.
 */
export function clockCallDueAt(state: GameState): number | null {
  const next = CLOCK_CALLS[state.clockCalls];
  if (
    state.phase !== 'playing' ||
    state.paused !== null ||
    state.deadlineAt === null ||
    next === undefined ||
    state.mission.radio.clock === undefined
  ) {
    return null;
  }
  return state.deadlineAt - next.sec * 1000;
}

/**
 * Mission control calls the time left once `clockCallDueAt` has come: the latest call the clock
 * has come down to — any before it pass unsaid, so that two never come at once — where the
 * mission has a line for it and the clock passed it CLOCK_LATE_MS ago at most. Every call up to
 * it is behind the run from then, said or not: none is ever said twice.
 */
function clockCall(state: GameState, at: number): GameState {
  const due = clockCallDueAt(state);
  if (due === null || at < due) {
    return state;
  }
  const left = (state.deadlineAt ?? at) - at;
  const reached = CLOCK_CALLS.filter((call) => call.sec * 1000 >= left).length;
  const call = CLOCK_CALLS[reached - 1];
  const passed = { ...state, clockCalls: reached };
  if (call === undefined || call.sec * 1000 - left > CLOCK_LATE_MS) {
    return passed;
  }
  return logRadio(passed, 'clock', state.mission.radio.clock?.[call.key], at, call.key);
}

/** Guards shared by all three item actions; proximity is the server's job. */
function requireCarryable(
  state: GameState,
  playerId: string,
  itemId: string,
): { item: ItemState } {
  if (state.phase !== 'playing') {
    fail(NO_RUN);
  }
  if (state.paused !== null) {
    fail(STANDING_STILL);
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
    fail(item.carriedBy === action.playerId ? 'Schon in der Hand.' : 'Das trägt jemand anderes.');
  }
  if (Object.values(state.items).some((i) => i.carriedBy === action.playerId)) {
    fail('Die Hände sind schon voll — erst ablegen.');
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
    fail('Nicht in der Hand.');
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
    fail('Nicht in der Hand.');
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
    fail('Nur direkt davor.');
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
    fail(NO_RUN);
  }
  if (state.deadlineAt !== null && action.at >= state.deadlineAt) {
    return lostNow(state, action.at);
  }
  if (state.paused !== null) {
    fail(STANDING_STILL);
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

/** What the run report says the first time a note of the last shift is read. */
export const NOTE_READ = 'Notiz gelesen';

/**
 * A player standing at a note of the last shift reads it, for nothing: no
 * time, no alarm, no hint counted. The first read of a note goes into the
 * run report; reading it again changes nothing. Proximity is the presence
 * the server derived: it counts only a player who has found the note.
 */
function readNote(
  state: GameState,
  action: { playerId: string; note: number; at: number },
): GameState {
  if (state.phase !== 'playing') {
    fail(NO_RUN);
  }
  if (state.deadlineAt !== null && action.at >= state.deadlineAt) {
    return lostNow(state, action.at);
  }
  if (state.paused !== null) {
    fail(STANDING_STILL);
  }
  findPlayer(state, action.playerId);
  if (state.mission.map.notes[action.note] === undefined) {
    fail('Diese Notiz gibt es hier nicht.');
  }
  if (!(state.presence.notes[noteKey(action.note)] ?? []).includes(action.playerId)) {
    fail('Nur direkt davor.');
  }
  if (state.notesRead.includes(action.note)) {
    return state;
  }
  const notesRead = [...state.notesRead, action.note].sort((a, b) => a - b);
  return logEvent({ ...state, notesRead }, 'note', NOTE_READ, action.at);
}

/**
 * Spatial proximity to the station is validated by the server (it owns the
 * live positions); the reducer enforces everything else.
 */
function handleInteract(state: GameState, action: { playerId: string; at: number }): GameState {
  if (state.phase !== 'playing') {
    fail(NO_RUN);
  }
  if (state.deadlineAt !== null && action.at >= state.deadlineAt) {
    return lostNow(state, action.at);
  }
  if (state.paused !== null) {
    fail(STANDING_STILL);
  }
  if (state.sabotage !== null) {
    fail('Gesperrt, bis der Notfall behoben ist.');
  }
  if (state.puzzleState !== null) {
    fail('Die Station läuft schon.');
  }
  findPlayer(state, action.playerId);
  const current = state.mission.puzzles[state.currentPuzzleIndex];
  if (armedStations(state.mission.map, state).length === 0 || current === undefined) {
    fail('Hier gibt es nichts zu aktivieren.');
  }
  const missing = missingItemsFor(state, current.id);
  if (missing.length > 0) {
    fail(`Der Station fehlt noch: ${missing.join(', ')}.`);
  }
  return openPuzzle(state, state.currentPuzzleIndex, action.at);
}


/**
 * Straight into another run with the same crew: it confirms on the end
 * screen, and the host's yes may name the mission it plays — found in the
 * catalog and scaled to the room's difficulty by the server, `mission` here;
 * without one the same mission runs again. Same guards as a normal start,
 * the crew's size included, just without the detour through the lobby.
 */
function rematch(
  state: GameState,
  action: { playerId: string; at: number; seed: number; daily?: DailyStart; mission?: Mission },
): GameState {
  if (state.phase !== 'won' && state.phase !== 'lost') {
    fail('Ein neuer Lauf geht erst nach Missionsende.');
  }
  const mission = action.mission ?? state.mission;
  // On to a mission without a Tagesschicht, the room plays its own seeds again.
  const dailyOn = mission.daily && state.dailyOn;
  return startMission({ ...state, phase: 'lobby', mission, dailyOn, daily: null }, action);
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
    daily: null,
    edgework: null,
    pressedPlates: [],
    occupiedPanels: [],
    presence: NOBODY_PRESENT,
    places: {},
    opened: [],
    found: {},
    discoveries: {},
    notesRead: [],
    credits: {},
    readersCredited: [],
    sabotage: null,
    paused: null,
    away: {},
    menus: mainMenusOf(state.menus),
    drops: 0,
    calledOff: null,
    items: {},
    events: [],
    startedAt: null,
    introDone: [],
    lightsOutAt: null,
    lightsDueAt: null,
    deadlineAt: null,
    finishedAt: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    hintsUsed: 0,
    hintsRevealed: 0,
    hintReadyAt: null,
    quietSince: null,
    nudgesGiven: 0,
    clockCalls: 0,
  };
}
