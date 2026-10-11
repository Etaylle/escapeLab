import type { Difficulty } from './difficulty.js';
import type { Edgework } from './edgework.js';
import type { Mission } from './mission.js';
import type { PuzzleState } from './puzzles/index.js';

export type Phase = 'lobby' | 'playing' | 'won' | 'lost';

/** One line of the run report, recorded as the mission unfolds. */
export interface RunEvent {
  /** epoch ms, turned into mm:ss against startedAt for display */
  at: number;
  kind: 'puzzle' | 'penalty' | 'sabotage' | 'item' | 'escape' | 'finish' | 'hint' | 'radio';
  label: string;
  /** seconds lost, for penalty and hint lines */
  seconds: number | null;
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
  /** null until the player picks a role in the lobby */
  roleId: string | null;
  /** '#rrggbb' from CREW_COLORS */
  color: string;
  /** cleared whenever the setup changes, so nobody is dragged in unprepared */
  ready: boolean;
  connected: boolean;
  isHost: boolean;
}

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
  /** running emergency that interrupts everything until it is cleared */
  sabotage: { endsAt: number } | null;
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
  /** hints bought over the whole run; they weigh on the grade */
  hintsUsed: number;
  /** hints revealed for the current puzzle; back to 0 whenever the crew moves on */
  hintsRevealed: number;
  /** epoch ms; earliest moment the next hint may be requested */
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
