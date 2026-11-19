import {
  DIFFICULTIES,
  poolsOf,
  runSeconds,
  utcDay,
  type DailyStats,
  type Difficulty,
  type DifficultyStats,
  type LeaderEntry,
  type Mission,
  type MissionStats,
  type RunBoard,
  type RunPlace,
} from '@escapelab/core';
import { median } from './runSummary.js';
import type { LoggedRun } from './store/store.js';

/**
 * Which board a run stands on (`RunBoard`): every reader of the stats — the list, a run's place
 * on its end card, a mission card's best time and share won, the Tagesschicht's days — counts
 * the runs this puts on the live board, and no other. A run on the archive stands on its
 * mission's „Frühere Anlage", ranked among the runs of that chain alone; one on none stands
 * nowhere. Every run stays kept and stays in „Meine Einsätze"; nothing is deleted.
 */
export type Ranking = (run: LoggedRun) => RunBoard;

/** Every run stands on the live board: the rule of a server that knows no missions. */
const everyRun: Ranking = () => 'live';

/**
 * The board of `run` of the `mission` it played, as the mission stands now. A mission without a
 * Wechselplatz asks nothing: live. One that has them was another chain of stations before it got
 * them: a run that names, for every pool, a station the pool holds now is live; a run that names
 * no draw at all was played on that earlier chain — shorter or longer than any run can be now —
 * and goes on its archive; a run that names a draw the mission no longer holds was neither, and
 * stands on none.
 */
export function boardOf(mission: Pick<Mission, 'puzzles'>, run: LoggedRun): RunBoard {
  const pools = [...poolsOf(mission.puzzles)];
  const drawn: Readonly<Record<string, string>> = run.drawn ?? {};
  if (pools.length === 0) {
    return 'live';
  }
  if (Object.keys(drawn).length === 0) {
    return 'archive';
  }
  const named = pools.every(([pool, members]) =>
    members.includes(Object.hasOwn(drawn, pool) ? (drawn[pool] ?? '') : ''),
  );
  return named ? 'live' : 'none';
}

/**
 * The ranking over the missions `known` has now, by id: a run of a mission with a Wechselplatz
 * goes where `boardOf` says; a run of a mission nobody knows any more — a custom one deleted
 * since — counts as it always did, live.
 */
export function rankingOf(known: () => readonly Mission[]): Ranking {
  return (run) => {
    const mission = known().find((each) => each.id === run.missionId);
    return mission === undefined ? 'live' : boardOf(mission, run);
  };
}

/**
 * What the start-up log says of the boards: „the 40 runs kept so far, 12 of them on an archive:
 * runs of a mission's earlier chain" — and how many stand on none, where any do.
 */
export function boardsLine({ runs, archived, unranked }: RunStats): string {
  const archive =
    archived === 0 ? '' : `, ${archived} of them on an archive: runs of a mission's earlier chain`;
  const none =
    unranked === 0 ? '' : `, ${unranked} on no board: they name a draw the mission no longer holds`;
  return `the ${runs} runs kept so far${archive}${none}`;
}

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

  /** The ids of the missions with a run on it. */
  ids(): string[] {
    return [...this.missions.keys()];
  }

  /** One mission's difficulties on it, easiest first; null before its first run. */
  difficulties(missionId: string): DifficultyStats[] | null {
    const tallies = this.missions.get(missionId);
    if (tallies === undefined) {
      return null;
    }
    return DIFFICULTIES.flatMap((difficulty) => tallies.get(difficulty)?.stats(difficulty) ?? []);
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

/**
 * The boards of one set of runs — the main list, or one day of the Tagesschicht: the live one,
 * and the archive of the runs of a mission's earlier chain, ranked apart. Only the live one
 * places a run.
 */
class Shelf {
  private readonly boards: Record<'live' | 'archive', Board> = {
    live: new Board(),
    archive: new Board(),
  };

  board(which: 'live' | 'archive'): Board {
    return this.boards[which];
  }

  /** Every mission with a run on either board, by id. */
  all(): MissionStats[] {
    const ids = new Set([...this.boards.live.ids(), ...this.boards.archive.ids()]);
    return [...ids].sort().flatMap((missionId) => this.mission(missionId) ?? []);
  }

  /** One mission, its archive where it has one; null before its first run on either board. */
  mission(missionId: string): MissionStats | null {
    const live = this.boards.live.difficulties(missionId);
    const archive = this.boards.archive.difficulties(missionId);
    if (live === null && archive === null) {
      return null;
    }
    return { missionId, difficulties: live ?? [], ...(archive === null ? {} : { archive }) };
  }

  placeOf(missionId: string, finishedAt: number): RunPlace | null {
    return this.boards.live.placeOf(missionId, finishedAt);
  }
}

/** Whether a logged run played the Tagesschicht: only version 2 reports can say so. */
const isDaily = (run: LoggedRun): boolean => run.version === 2 && run.daily === true;

/**
 * The Bestenliste's numbers by mission and difficulty: counted from the store's runs as the
 * server starts, then kept up to date run by run, a deleted account's name taken off the runs
 * it is listed with (`unname`) — never counted anew while the server runs. It keeps
 * the time of every won run, for the median and the places, and names only for the TOP_RUNS
 * fastest. The runs of the Tagesschicht rank apart, a shelf for each UTC day they started on:
 * every crew that day played the same instance. The ranking (`Ranking`) puts each run on the
 * live board of its shelf, on its archive, or on none; every run is kept and counted as kept.
 */
export class RunStats {
  private readonly main = new Shelf();
  /** the Tagesschicht's shelves, by the UTC day its runs started on */
  private readonly days = new Map<string, Shelf>();
  private counted = 0;
  private onTheArchive = 0;
  private offTheBoards = 0;

  /** The stats of `runs`, oldest first, on the boards as `ranked` says. */
  constructor(
    runs: Iterable<LoggedRun> = [],
    private readonly ranked: Ranking = everyRun,
  ) {
    for (const run of runs) {
      this.add(run);
    }
  }

  /** How many runs it keeps, over every mission, the Tagesschicht's too, on a board or not. */
  get runs(): number {
    return this.counted;
  }

  /** How many of the runs it keeps stand on an archive: runs of a mission's earlier chain. */
  get archived(): number {
    return this.onTheArchive;
  }

  /** How many of the runs it keeps stand on no board: the ranking leaves them out. */
  get unranked(): number {
    return this.offTheBoards;
  }

  /** The board `run` stands on, by the ranking it was counted with: „Meine Einsätze" says it. */
  boardOf(run: LoggedRun): RunBoard {
    return this.ranked(run);
  }

  /**
   * Counts one more finished run in: on the shelf of its Tagesschicht's day, or the main one —
   * on the board of it the ranking says, or on none.
   */
  add(run: LoggedRun): void {
    this.counted += 1;
    const board = this.ranked(run);
    if (board === 'none') {
      this.offTheBoards += 1;
      return;
    }
    if (board === 'archive') {
      this.onTheArchive += 1;
    }
    this.shelfOf(run).board(board).add(run);
  }

  /** The shelf `run` goes on: its Tagesschicht day's, made with the day's first run, or main. */
  private shelfOf(run: LoggedRun): Shelf {
    if (!isDaily(run)) {
      return this.main;
    }
    const day = utcDay(run.startedAt);
    const shelf = this.days.get(day) ?? new Shelf();
    this.days.set(day, shelf);
    return shelf;
  }

  /**
   * `name` off the crew of `run` wherever the Bestenliste lists it by its crew (`TOP_RUNS`): its
   * account was deleted. The run keeps its place, its time and its count. Off both boards of
   * its shelf: the ranking it was counted under may differ from today's — a custom mission saved
   * again with a Wechselplatz while the server runs — and the name has to leave wherever it is.
   */
  unname(run: LoggedRun, name: string): void {
    const shelf = isDaily(run) ? this.days.get(utcDay(run.startedAt)) : this.main;
    shelf?.board('live').unname(run, name);
    shelf?.board('archive').unname(run, name);
  }

  /** Every mission with a run off the Tagesschicht, by id. */
  all(): MissionStats[] {
    return this.main.all();
  }

  /** One mission off the Tagesschicht, difficulties easiest first; null before its first run. */
  mission(missionId: string): MissionStats | null {
    return this.main.mission(missionId);
  }

  /**
   * Where the won run of `missionId` that finished at `finishedAt` stands on the live board; null
   * when none did there.
   */
  placeOf(missionId: string, finishedAt: number): RunPlace | null {
    return this.main.placeOf(missionId, finishedAt);
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

  /** Where a won run of the Tagesschicht of `day` stands on that day's live board; null if none. */
  dailyPlaceOf(day: string, missionId: string, finishedAt: number): RunPlace | null {
    return this.days.get(day)?.placeOf(missionId, finishedAt) ?? null;
  }
}
