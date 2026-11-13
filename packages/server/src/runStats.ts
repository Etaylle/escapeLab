import {
  DIFFICULTIES,
  runSeconds,
  utcDay,
  type DailyStats,
  type Difficulty,
  type DifficultyStats,
  type LeaderEntry,
  type MissionStats,
  type RunPlace,
} from '@escapelab/core';
import { median } from './runSummary.js';
import type { LoggedRun } from './store/store.js';

/** How many of the fastest won runs each mission keeps by name at each difficulty. */
export const TOP_RUNS = 10;

/** How many days of the Tagesschicht the Bestenliste hands out, the newest first. */
export const DAILY_DAYS = 14;

/** What a won run is ranked by: its time, then fewer alarms, then the earlier finish. */
type Rank = Pick<LeaderEntry, 'seconds' | 'alarms' | 'finishedAt'>;

function byRank(a: Rank, b: Rank): number {
  return a.seconds - b.seconds || a.alarms - b.alarms || a.finishedAt - b.finishedAt;
}

/** Where `rank` goes into `ranks`, which are in order: after every one it does not beat. */
function slotOf(ranks: readonly Rank[], rank: Rank): number {
  let low = 0;
  let high = ranks.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const there = ranks[mid];
    if (there !== undefined && byRank(there, rank) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * A won run as the list shows it, by the names its crew played under: none for a version 1
 * report, and none for a seat whose account was deleted since (named '' in its report).
 */
function entryOf(run: LoggedRun): LeaderEntry {
  return {
    crew: run.version === 1 ? [] : run.crew.filter((name) => name !== ''),
    crewSize: run.crewSize,
    seconds: runSeconds(run),
    alarms: run.penalties.reduce((sum, penalty) => sum + penalty.count, 0),
    finishedAt: run.finishedAt,
  };
}

/** The runs of one mission at one difficulty. */
class Tally {
  runs = 0;
  /** every won run's rank, best first: the median and every place come from these */
  private readonly ranks: Rank[] = [];
  /** the first TOP_RUNS of them, with their crews */
  private readonly top: LeaderEntry[] = [];

  add(run: LoggedRun): void {
    this.runs += 1;
    if (run.outcome !== 'won') {
      return;
    }
    const entry = entryOf(run);
    const slot = slotOf(this.ranks, entry);
    const { seconds, alarms, finishedAt } = entry;
    this.ranks.splice(slot, 0, { seconds, alarms, finishedAt });
    if (slot < TOP_RUNS) {
      this.top.splice(slot, 0, entry);
      this.top.splice(TOP_RUNS);
    }
  }

  /** `name` off the crew of the listed run that finished at `finishedAt`, where it is listed. */
  unname(finishedAt: number, name: string): void {
    for (const entry of this.top) {
      if (entry.finishedAt === finishedAt) {
        entry.crew = entry.crew.filter((member) => member !== name);
      }
    }
  }

  /** The place of the won run that finished at `finishedAt`, from 1; null when none did. */
  placeOf(finishedAt: number): number | null {
    const index = this.ranks.findIndex((rank) => rank.finishedAt === finishedAt);
    return index < 0 ? null : index + 1;
  }

  stats(difficulty: Difficulty): DifficultyStats {
    return {
      difficulty,
      runs: this.runs,
      wins: this.ranks.length,
      bestSeconds: this.ranks[0]?.seconds ?? null,
      medianSeconds: median(this.ranks.map((rank) => rank.seconds)),
      top: this.top.map((entry) => ({ ...entry, crew: [...entry.crew] })),
    };
  }
}

/** One ranking: every mission's runs in it, by mission and difficulty. */
class Board {
  private readonly missions = new Map<string, Map<Difficulty, Tally>>();

  add(run: LoggedRun): void {
    const tallies = this.missions.get(run.missionId) ?? new Map<Difficulty, Tally>();
    const tally = tallies.get(run.difficulty) ?? new Tally();
    tally.add(run);
    tallies.set(run.difficulty, tally);
    this.missions.set(run.missionId, tallies);
  }

  /** `name` off the crew of `run` where this ranking lists it by its crew. */
  unname(run: LoggedRun, name: string): void {
    this.missions.get(run.missionId)?.get(run.difficulty)?.unname(run.finishedAt, name);
  }

  all(): MissionStats[] {
    return [...this.missions.keys()]
      .sort()
      .flatMap((missionId) => this.mission(missionId) ?? []);
  }

  mission(missionId: string): MissionStats | null {
    const tallies = this.missions.get(missionId);
    if (tallies === undefined) {
      return null;
    }
    return {
      missionId,
      difficulties: DIFFICULTIES.flatMap(
        (difficulty) => tallies.get(difficulty)?.stats(difficulty) ?? [],
      ),
    };
  }

  placeOf(missionId: string, finishedAt: number): RunPlace | null {
    for (const [difficulty, tally] of this.missions.get(missionId) ?? []) {
      const place = tally.placeOf(finishedAt);
      if (place !== null) {
        return { difficulty, place };
      }
    }
    return null;
  }
}

/** Whether a logged run played the Tagesschicht: only version 2 reports can say so. */
const isDaily = (run: LoggedRun): boolean => run.version === 2 && run.daily === true;

/**
 * The Bestenliste's numbers by mission and difficulty: counted from the store's runs as the
 * server starts, then kept up to date run by run, a deleted account's name taken off the runs
 * it is listed with (`unname`) — never counted anew while the server runs. It keeps
 * the time of every won run, for the median and the places, and names only for the TOP_RUNS
 * fastest. The runs of the Tagesschicht rank apart, a board for each UTC day they started on:
 * every crew that day played the same instance.
 */
export class RunStats {
  private readonly board = new Board();
  /** the Tagesschicht's boards, by the UTC day its runs started on */
  private readonly days = new Map<string, Board>();
  private counted = 0;

  /** The stats of `runs`, oldest first. */
  constructor(runs: Iterable<LoggedRun> = []) {
    for (const run of runs) {
      this.add(run);
    }
  }

  /** How many runs it counts, over every mission, the Tagesschicht's too. */
  get runs(): number {
    return this.counted;
  }

  /** Counts one more finished run in: on the Tagesschicht's board of its day, or the main one. */
  add(run: LoggedRun): void {
    if (isDaily(run)) {
      const day = utcDay(run.startedAt);
      const board = this.days.get(day) ?? new Board();
      board.add(run);
      this.days.set(day, board);
    } else {
      this.board.add(run);
    }
    this.counted += 1;
  }

  /**
   * `name` off the crew of `run` wherever the Bestenliste lists it by its crew (`TOP_RUNS`): its
   * account was deleted. The run keeps its place, its time and its count.
   */
  unname(run: LoggedRun, name: string): void {
    const board = isDaily(run) ? this.days.get(utcDay(run.startedAt)) : this.board;
    board?.unname(run, name);
  }

  /** Every mission with a run off the Tagesschicht, by id. */
  all(): MissionStats[] {
    return this.board.all();
  }

  /** One mission off the Tagesschicht, difficulties easiest first; null before its first run. */
  mission(missionId: string): MissionStats | null {
    return this.board.mission(missionId);
  }

  /** Where the won run of `missionId` that finished at `finishedAt` stands; null when none did. */
  placeOf(missionId: string, finishedAt: number): RunPlace | null {
    return this.board.placeOf(missionId, finishedAt);
  }

  /** The Tagesschicht's last DAILY_DAYS days with runs, the newest first. */
  daily(): DailyStats[] {
    return [...this.days.keys()]
      .sort()
      .reverse()
      .slice(0, DAILY_DAYS)
      .map((day) => ({ day, missions: this.days.get(day)?.all() ?? [] }));
  }

  /** One mission on the Tagesschicht of `day`; null where nobody played it that day. */
  dailyMission(day: string, missionId: string): MissionStats | null {
    return this.days.get(day)?.mission(missionId) ?? null;
  }

  /** Where a won run of the Tagesschicht of `day` stands among that day's; null when none did. */
  dailyPlaceOf(day: string, missionId: string, finishedAt: number): RunPlace | null {
    return this.days.get(day)?.placeOf(missionId, finishedAt) ?? null;
  }
}
