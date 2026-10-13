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
    | 'find';
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
  /** players who have walked up to the edgework sign; kept for the rest of the run */
  signSeen: string[];
}

export const NOBODY_PRESENT: Presence = { stations: {}, manuals: {}, signSeen: [] };

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
  /** notes of the last crew they asked for */
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
  /** epoch ms; shrinks when penalties strike */
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
}

export function initialState(mission: Mission): GameState {
  return {
    phase: 'lobby',
    mission,
    difficulty: 'normal',
    players: [],
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
