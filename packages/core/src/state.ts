import type { Difficulty } from './difficulty.js';
import type { Edgework } from './edgework.js';
import type { Mission } from './mission.js';
import type { PuzzleState } from './puzzles/index.js';
import type { RelayState } from './puzzles/relay.js';

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
    | 'nudge';
  label: string;
  /** seconds lost, for penalty and hint lines */
  seconds: number | null;
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
  /** players who have walked up to the edgework sign; kept for the rest of the run */
  signSeen: string[];
  /** players standing on the open exit hatch right now; nobody before the escape */
  exit: string[];
}

export const NOBODY_PRESENT: Presence = {
  stations: {},
  manuals: {},
  notes: {},
  signSeen: [],
  exit: [],
};

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
  /** already scaled to `difficulty` — downstream code just reads the numbers */
  mission: Mission;
  difficulty: Difficulty;
  players: Player[];
  /** index into mission.puzzles; only meaningful while playing */
  currentPuzzleIndex: number;
  puzzleState: PuzzleState | null;
  /** PRNG seed for this run; set by start-mission */
  seed: number | null;
  /**
   * The seed a tester pinned the room to, so that its runs repeat (dev and CI
   * only), or null: then every run plays the seed the server rolled for it.
   * A pinned room's run n (from 0) plays roomSeed + n.
   */
  roomSeed: number | null;
  /** runs started in this room so far: the n of the next one */
  runs: number;
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
  /** manual objects somebody has come close to this run; the crew's map shows only these */
  discovered: string[];
  /**
   * notes of the last shift somebody has come across this run, by index; the
   * crew's map shows only these
   */
  notesFound: number[];
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
   * Set while someone is disconnected: the clock, patrols and emergencies
   * all stand still, because the crew cannot finish a mission short-handed.
   */
  paused: { since: number } | null;
  /** Where every carryable object currently is, by item id. */
  items: Record<string, ItemState>;
  /** Everything worth retelling afterwards, oldest first. */
  events: RunEvent[];
  /** epoch ms; set when the mission starts */
  startedAt: number | null;
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
  /** epoch ms; set once the lights are out, shrinks when penalties strike */
  deadlineAt: number | null;
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
}

/**
 * A fresh room for `mission` — already scaled to `difficulty` — its runs pinned to `roomSeed`
 * where a tester asked for one.
 */
export function initialState(
  mission: Mission,
  roomSeed: number | null = null,
  difficulty: Difficulty = 'normal',
): GameState {
  return {
    phase: 'lobby',
    mission,
    difficulty,
    players: [],
    currentPuzzleIndex: 0,
    puzzleState: null,
    seed: null,
    roomSeed,
    runs: 0,
    edgework: null,
    pressedPlates: [],
    occupiedPanels: [],
    presence: NOBODY_PRESENT,
    places: {},
    opened: [],
    discovered: [],
    notesFound: [],
    notesRead: [],
    credits: {},
    readersCredited: [],
    sabotage: null,
    paused: null,
    items: {},
    events: [],
    startedAt: null,
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
  };
}
