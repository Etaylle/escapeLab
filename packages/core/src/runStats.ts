import type { Difficulty } from './difficulty.js';

/**
 * The Bestenliste as the server serves it — GET /stats and GET
 * /stats/:mission — counted from the run log, one mission at one difficulty
 * at a time. It names crews by the names they played under and carries
 * nothing else about anybody: no player id, no room.
 */

/** A won run on the list. */
export interface LeaderEntry {
  /** the crew's names in the order it joined; none for a run logged before names were kept */
  crew: string[];
  crewSize: number;
  /** from start to finish */
  seconds: number;
  /** alarms over the whole run, whatever set them off */
  alarms: number;
  /** when it ended, epoch ms */
  finishedAt: number;
}

/** One mission at one difficulty, over every run of it in the log. */
export interface DifficultyStats {
  difficulty: Difficulty;
  runs: number;
  wins: number;
  /** the fastest won run, in seconds; null before the first win */
  bestSeconds: number | null;
  /** the median time of the won runs, in seconds; null before the first win */
  medianSeconds: number | null;
  /** the fastest won runs, ten at most: by time, then fewer alarms, then the earlier finish */
  top: LeaderEntry[];
}

/** One mission: the difficulties it has been played at, easiest first. */
export interface MissionStats {
  missionId: string;
  difficulties: DifficultyStats[];
}

/** Where a won run stands among every run of its mission at its difficulty. */
export interface RunPlace {
  difficulty: Difficulty;
  /** 1 for the fastest; a lost run comes after every won one */
  place: number;
}

/** GET /stats/:mission: one mission and, asked with ?run=<finishedAt>, where that run stands. */
export interface MissionStanding extends MissionStats {
  /** null without ?run=, and when no won run of the mission finished at that moment */
  place: RunPlace | null;
}
