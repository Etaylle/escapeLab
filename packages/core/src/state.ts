import type { DailyDay } from './daily.js';
import type { Difficulty } from './difficulty.js';
import type { FindKey } from './discovery.js';
import type { Edgework } from './edgework.js';
import type { Mission } from './mission.js';
import type { PuzzleState } from './puzzles/index.js';
import type { RelayState } from './puzzles/relay.js';
import type { RadioMoment, Speaker } from './radio.js';

export type Phase = 'lobby' | 'playing' | 'won' | 'lost';

/** One line of the run report, recorded as the mission unfolds. */
export interface RunEvent {
  /** epoch ms, turned into mm:ss against startedAt for display */
  at: number;
  kind:
    | 'puzzle'
    | 'penalty'
    | 'sabotage'
    | 'item'
    | 'escape'
    | 'finish'
    | 'hint'
    | 'radio'
    | 'find'
    /** the lights failing at the end of a mission's intro */
    | 'power'
    /** a note of the last shift read for the first time this run */
    | 'note'
    /**
     * mission control naming the next place, the station that is up having stayed quiet
     * (actions.ts `nudge`): on the air like a radio line, its line the label
     */
    | 'nudge'
    /**
     * a crew member gone from the run — their line dropped, or they went to the main menu, their
     * seat kept (actions.ts `player-disconnected`): mission control says so on the air once, its
     * line the label, and the run goes on
     */
    | 'away';
  label: string;
  /** seconds lost, for penalty and hint lines */
  seconds: number | null;
  /**
   * on a line heard in the run (`radio`, `nudge`): the moment that brought it, which says who
   * speaks it and how it ranks on the air (radio.ts); left out on every other line, and on the
   * lines of a run kept before it was noted
   */
  moment?: RadioMoment;
  /**
   * on a line heard in the run: who says it — the role its moment wants and the person of the
   * night's cast filling it (cast.ts `speakerAt`), and on mission control's word that a crew member
   * is gone the Leitstelle on duty (`deskAt`); left out on every other line, and on the lines of a
   * run kept before the cast
   */
  speaker?: Speaker;
}

/**
 * Who stands where, translated from live positions by the server like the
 * plates. It decides who works the open station, who reads its rules and
 * who knows the edgework.
 */
export interface Presence {
  /** players at each station spot, by `stationKey`: the puzzle id, `<puzzleId>/b` at console b */
  stations: Record<string, string[]>;
  /** players at each manual object, by its id */
  manuals: Record<string, string[]>;
  /** players at each note of the last shift, by its index as text (`noteKey`) */
  notes: Record<string, string[]>;
  /**
   * players standing on each plate, by its id: whoever holds it pressed (`pressedPlates`, which
   * the doors and drones go by), counted by the same reach — the hands of the crew name them
   */
  plates: Record<string, string[]>;
  /** players who have walked up to the edgework sign; kept for the rest of the run */
  signSeen: string[];
  /** players standing on the open exit hatch right now; nobody before the escape */
  exit: string[];
  /**
   * what each player has in sight right now, by player id: the keys of the sources, notes,
   * loose parts and consoles nobody of the crew has found — the armed station's aside — that a
   * straight line reaches from where they stand (discovery.ts `sightables`, `inSight`), sorted;
   * none while the power lights the whole lab (`labLit`). A view carries a thing nobody has
   * found only while it is in sight
   */
  sight: Record<string, FindKey[]>;
}

export const NOBODY_PRESENT: Presence = {
  stations: {},
  manuals: {},
  notes: {},
  plates: {},
  signSeen: [],
  exit: [],
  sight: {},
};

/**
 * Where a crew member's menu stands, as the crew sees it: the pause menu open over the run while
 * they are on the line in it ('pause') — the run goes on —, or the main menu they went to on
 * purpose, off the line, their seat kept bound to them ('main', actions.ts
 * `player-disconnected`).
 */
export type MenuPlace = 'pause' | 'main';

/**
 * A crew member away from a run: their line dropped, and they are not back yet. The run goes on
 * without stopping for them: their avatar stands where it stood and holds what it held, the
 * patrols do not see it, and their console counts as unmanned.
 */
export interface Away {
  /** epoch ms the line dropped */
  since: number;
  /** epoch ms from which the crew may go on without them (actions.ts `continue-without`) */
  waivableAt: number;
  /**
   * the crew went on without them: it counts them out — at the stations the whole crew
   * presses, at the hatch — until they are back; their seat stays theirs. Until then those wait
   * for them as for somebody slow
   */
  waived: boolean;
  /**
   * epoch ms until which a new device's ask to take their seat over waits for the crew on the
   * line to let it in (actions.ts `takeover-claimed`); left out while nobody asks
   */
  claimUntil?: number;
  /**
   * their line went down with the server for its maintenance (actions.ts `maintenance`): a run
   * standing still for it waits for them until they are back or the crew goes on without them;
   * left out for a line that dropped on its own, before the maintenance or after, which stands
   * nothing still
   */
  maintenance?: true;
}

export interface ItemState {
  /** tile-space position while lying on the floor */
  x: number;
  y: number;
  /** player id while someone is carrying it */
  carriedBy: string | null;
  delivered: boolean;
}

/** Crew colors, unique per room; the first free one is handed out on join. */
export const CREW_COLORS = [
  '#2dd4bf',
  '#f472b6',
  '#fbbf24',
  '#60a5fa',
  '#a78bfa',
  '#4ade80',
  '#fb923c',
  '#f87171',
] as const;

export interface Player {
  id: string;
  name: string;
  /** '#rrggbb' from CREW_COLORS */
  color: string;
  /** cleared whenever the setup changes, so nobody is dragged in unprepared */
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  /** the start tile this run drew for the player; null in the lobby */
  spawn: { x: number; y: number } | null;
}

/** What one player did over a run, for the end screen. */
export interface Credits {
  /**
   * stations they worked as they were solved: their input solved it, or —
   * at a station with two consoles — they stood at either console
   */
  operated: number;
  /** stations whose rules they read at a manual object while the station was open */
  read: number;
  /** lockers they searched and cabinets they unlocked */
  found: number;
  /** items they carried to where they belong, a key into its cabinet included */
  delivered: number;
  /** alarms they set off: a wrong move, a drone that caught them */
  alarms: number;
  /** notes of the last shift they asked for */
  hints: number;
}

export const NO_CREDITS: Credits = {
  operated: 0,
  read: 0,
  found: 0,
  delivered: 0,
  alarms: 0,
  hints: 0,
};

export interface GameState {
  phase: Phase;
  /**
   * already scaled to `difficulty` — downstream code just reads the numbers; in a free-order
   * run its puzzles stand in the run's order, the solved ones first (`currentPuzzleIndex`)
   */
  mission: Mission;
  difficulty: Difficulty;
  players: Player[];
  /**
   * index into mission.puzzles of the station up — as many as are solved, since the run's
   * `mission.puzzles` keep the solved ones first: in free order the station the crew switches
   * on is moved up to this place (actions.ts `takeUp`); only meaningful while playing
   */
  currentPuzzleIndex: number;
  /**
   * in a free-order run, whether the crew has switched on the station up since the last solve:
   * from then on it is theirs until solved, as in a chain; until then every station still to
   * solve stands armed. False in a chain run, and outside a run
   */
  picked: boolean;
  puzzleState: PuzzleState | null;
  /** PRNG seed for this run; set by start-mission */
  seed: number | null;
  /**
   * The seed a tester pinned the room to, so that its runs repeat (dev and CI
   * only), or null: then every run plays the seed the server rolled for it.
   * A pinned room's run n (from 0) plays roomSeed + n.
   */
  roomSeed: number | null;
  /**
   * The host's switch for the Tagesschicht, for a mission that offers it: on, the room's runs
   * play the seed of the day each starts on (daily.ts), over the room's own and any tester's.
   */
  dailyOn: boolean;
  /**
   * the UTC day whose Tagesschicht the run plays (daily.ts), as the server's clock had it at
   * the start; null for any other run, and in the lobby
   */
  daily: DailyDay | null;
  /** runs started in this room so far: the n of the next one */
  runs: number;
  /**
   * What each night's cast is drawn from (cast.ts `castFor`): run n (from 0) is staffed by
   * castOf(castSeed + n). A room pinned to a seed has that seed here, so that a run's cast follows
   * its seed; any other room one the server drew as it opened the room — known in the lobby, so
   * that the Funkprobe is said by the operator who then has the run.
   */
  castSeed: number;
  /** serial, lamps and cells of this run; rolled from the seed by start-mission */
  edgework: Edgework | null;
  /**
   * Plates and sabotage panels currently manned. Movement is
   * client-authoritative and lives outside this state machine; the server
   * translates live positions into set-occupancy actions, which keeps door
   * and sabotage logic deterministic.
   */
  pressedPlates: string[];
  occupiedPanels: string[];
  /** Stations, manual objects and the sign, by who stands there; derived like the plates. */
  presence: Presence;
  /** where each manual object lies this run: one of its spots, drawn by start-mission */
  places: Record<string, { x: number; y: number }>;
  /** lockers searched and cabinets unlocked this run, by manual object id */
  opened: string[];
  /**
   * what each player has found this run, by player id: the keys of the sources, notes, parts,
   * consoles and the sign they came near enough to or looked at long enough (discovery.ts),
   * sorted. The crew shares them only as the game already shares things — the minimap, the
   * arrows, a key's lock
   */
  found: Record<string, FindKey[]>;
  /**
   * each player's finds that matter, by player id, oldest first (discovery.ts `discover`):
   * when, and whether its chime sounds — at most one every CHIME_GAP_MS
   */
  discoveries: Record<string, { key: FindKey; at: number; chime: boolean }[]>;
  /** notes somebody has read this run, by index: the run report logs each once */
  notesRead: number[];
  /** who did what this run, by player id */
  credits: Record<string, Credits>;
  /** players already credited with reading the current station's rules */
  readersCredited: string[];
  /**
   * Running emergency that interrupts everything until it is cleared. In
   * relay mode it carries the consoles and instructions; valves need none.
   */
  sabotage: { endsAt: number; emergency?: RelayState } | null;
  /**
   * Set while the run stands still for the server's maintenance — a deploy, a restart put every
   * seat away (actions.ts `maintenance`) — until whoever was on the line then is back, or the
   * crew has gone on without them (`Away.maintenance`); and from the moment the crew's last line
   * drops until the first of them is back (`player-disconnected`): the clock, the patrols and
   * the emergencies stand still meanwhile. Any other line that drops stands nothing still. The
   * kind is the one there is, kept as snapshots carry it.
   */
  paused: { since: number; kind: 'wartung' } | null;
  /**
   * the crew members whose line dropped in this run and who are not back, by player id
   * (actions.ts `player-disconnected`): the run goes on, and the crew may go on without them
   * once their wait is over, or has
   */
  away: Record<string, Away>;
  /**
   * the crew members whose menu stands open, by player id (`MenuPlace`): the pause menu over the
   * run (actions.ts `set-menu`), or the main menu they went to, their seat kept, in a run or a
   * lobby; left out for everybody else
   */
  menus: Record<string, MenuPlace>;
  /**
   * lines dropped in this run so far: the first drop lets the crew go on without whoever
   * dropped after FIRST_WAIT_MS, every later one after LATER_WAIT_MS
   */
  drops: number;
  /**
   * why the run was called off, as its end card says it — whoever left it, or whom the one
   * still there called it off without; null for a run that ended any other way, or runs on
   */
  calledOff: string | null;
  /** Where every carryable object currently is, by item id. */
  items: Record<string, ItemState>;
  /** Everything worth retelling afterwards, oldest first. */
  events: RunEvent[];
  /** epoch ms; set when the mission starts */
  startedAt: number | null;
  /**
   * who of the crew has seen enough of the intro this run, by player id, in the order they
   * said so (actions.ts `intro-done`): once every crew member present has, the lights go out
   */
  introDone: string[];
  /**
   * epoch ms the lights went out and the clock started: the start itself
   * for a mission without an intro. Null while the power is still on — no
   * clock, no armed station, no patrol, no emergency — and outside a run.
   */
  lightsOutAt: number | null;
  /**
   * epoch ms the lights are due to fail while the power is still on: the
   * start plus the intro's `lightsSec`, moved on by a pause like every
   * deadline. Null otherwise.
   */
  lightsDueAt: number | null;
  /**
   * epoch ms; set once the lights are out, shrinks when penalties strike — null all through a
   * run whose mission has no clock (`timeLimitSec` 0)
   */
  deadlineAt: number | null;
  /**
   * epoch ms the run's clock counts from: the lights going out, moved on by every pause since,
   * as a deadline is — where the mission has no clock, every screen shows the time run since
   * then. Null while the lights are on, and outside a run
   */
  clockFrom: number | null;
  /** epoch ms; set when the mission ends (won or lost) */
  finishedAt: number | null;
  /** increments on every penalty — lets clients retrigger alarm effects */
  penaltySeq: number;
  lastPenaltySec: number | null;
  /** notes bought over the whole run; they weigh on the grade */
  hintsUsed: number;
  /** notes revealed for the current puzzle; back to 0 whenever the crew moves on */
  hintsRevealed: number;
  /** epoch ms; earliest moment the next note may be asked for */
  hintReadyAt: number | null;
  /**
   * epoch ms since when the station that is up has had no input: from when it came up, was
   * switched on or last worked, an emergency ended or mission control last spoke about it;
   * moved on by a pause like every deadline. Null while no station is up.
   */
  quietSince: number | null;
  /** lines mission control has sent about the station that is up; back to 0 with the next */
  nudgesGiven: number;
  /**
   * how many of the clock's calls (radio.ts `CLOCK_CALLS`) are behind the run, said or passed
   * by: the next one is due once the time left comes down to it (actions.ts `clockCallDueAt`)
   */
  clockCalls: number;
}

/** What a room's nights are staffed from: the seed `drawn` by the server, else the pinned one. */
const castSeedOf = (roomSeed: number | null, drawn: number | undefined): number =>
  drawn ?? roomSeed ?? 0;

/**
 * A fresh room for `mission` — already scaled to `difficulty` — its runs pinned to `roomSeed`
 * where a tester asked for one, its nights staffed from `castSeed`, which the server draws for a
 * room pinned to nothing (`GameState.castSeed`).
 */
export function initialState(
  mission: Mission,
  roomSeed: number | null = null,
  difficulty: Difficulty = 'normal',
  castSeed?: number,
): GameState {
  return {
    phase: 'lobby',
    mission,
    difficulty,
    players: [],
    currentPuzzleIndex: 0,
    picked: false,
    puzzleState: null,
    seed: null,
    roomSeed,
    dailyOn: false,
    daily: null,
    runs: 0,
    castSeed: castSeedOf(roomSeed, castSeed),
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
    menus: {},
    drops: 0,
    calledOff: null,
    items: {},
    events: [],
    startedAt: null,
    introDone: [],
    lightsOutAt: null,
    lightsDueAt: null,
    deadlineAt: null,
    clockFrom: null,
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
