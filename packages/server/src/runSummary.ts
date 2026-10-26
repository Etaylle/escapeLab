import { DIFFICULTIES, runSeconds, type Difficulty } from '@escapelab/core';
import type { LoggedRun } from './runLog.js';

/** One station across the runs of a mission at one difficulty. */
export interface StationSummary {
  puzzleId: string;
  /** runs that got to it */
  reached: number;
  /** runs that solved it */
  solved: number;
  /** over the runs that solved it; null when none did */
  medianSeconds: number | null;
  /** alarms at it, over the runs that got to it; null when none did */
  medianAlarms: number | null;
}

/** What a balancing pass needs to know about the runs of one mission at one difficulty. */
export interface RunsSummary {
  missionId: string;
  difficulty: Difficulty;
  runs: number;
  won: number;
  lostOnTime: number;
  lostOnAlarms: number;
  /** from the clock's start to the finish, over every run */
  medianSeconds: number;
  /** in mission order */
  stations: StationSummary[];
  /** the three stations with the highest median seconds, slowest first */
  slowest: StationSummary[];
}

interface Group {
  missionId: string;
  difficulty: Difficulty;
  runs: LoggedRun[];
}

/**
 * The runs grouped by mission and difficulty: missions by id, difficulties
 * easiest first. Reports of either version, which agree on what is summed.
 */
export function summarize(runs: readonly LoggedRun[]): RunsSummary[] {
  const groups = new Map<string, Group>();
  for (const run of runs) {
    const { missionId, difficulty } = run;
    const key = JSON.stringify([missionId, difficulty]);
    const group = groups.get(key) ?? { missionId, difficulty, runs: [] };
    group.runs.push(run);
    groups.set(key, group);
  }
  const rank = (difficulty: Difficulty): number => DIFFICULTIES.indexOf(difficulty);
  return [...groups.values()]
    .map(summarizeGroup)
    .sort(
      (a, b) => a.missionId.localeCompare(b.missionId) || rank(a.difficulty) - rank(b.difficulty),
    );
}

function summarizeGroup({ missionId, difficulty, runs }: Group): RunsSummary {
  const ended = (outcome: LoggedRun['outcome']): number =>
    runs.filter((run) => run.outcome === outcome).length;
  const stations = stationsOf(runs);
  return {
    missionId,
    difficulty,
    runs: runs.length,
    won: ended('won'),
    lostOnTime: ended('lost:time'),
    lostOnAlarms: ended('lost:alarms'),
    medianSeconds: median(runs.map(runSeconds)) ?? 0,
    stations,
    slowest: stations
      .filter((station) => station.medianSeconds !== null)
      .sort((a, b) => (b.medianSeconds ?? 0) - (a.medianSeconds ?? 0))
      .slice(0, 3),
  };
}

/** Every station any of the runs lists, in the order the runs list them. */
function stationsOf(runs: readonly LoggedRun[]): StationSummary[] {
  const ids = [...new Set(runs.flatMap((run) => run.stations.map((s) => s.puzzleId)))];
  return ids.map((puzzleId) => {
    const all = runs.flatMap((run) => run.stations.filter((s) => s.puzzleId === puzzleId));
    const reached = all.filter((s) => s.openedAt !== null);
    const solved = all.flatMap((s) => (s.seconds === null ? [] : [s.seconds]));
    return {
      puzzleId,
      reached: reached.length,
      solved: solved.length,
      medianSeconds: median(solved),
      medianAlarms: median(reached.map((s) => s.alarms)),
    };
  });
}

/** The middle of the values, or the mean of the middle two; null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? 0) + upper) / 2;
}

/** The table's number columns; each is as wide as its heading. */
const COLUMNS = ['reached', 'solved', 'median s', 'median alarms'];

/** The summaries as text, one block per mission and difficulty. */
export function formatSummary(summaries: readonly RunsSummary[]): string {
  return summaries.map(formatGroup).join('\n\n');
}

function formatGroup(group: RunsSummary): string {
  const share = Math.round((100 * group.won) / group.runs);
  const head =
    `${group.missionId} · ${group.difficulty}: ${group.runs} run${group.runs === 1 ? '' : 's'}, ` +
    `${share} % won (${group.won}), lost ${group.lostOnTime} on time and ` +
    `${group.lostOnAlarms} on alarms, median ${clock(group.medianSeconds)}`;
  const width = Math.max('station'.length, ...group.stations.map((s) => s.puzzleId.length));
  const line = (name: string, cells: string[]): string =>
    `  ${name.padEnd(width)}  ` +
    cells.map((cell, i) => cell.padStart(COLUMNS[i]?.length ?? 0)).join('  ');
  const rows = group.stations.map((s) =>
    line(s.puzzleId, [
      String(s.reached),
      String(s.solved),
      fixed(s.medianSeconds, 0),
      fixed(s.medianAlarms, 1),
    ]),
  );
  const slowest = group.slowest.map((s) => `${s.puzzleId} ${fixed(s.medianSeconds, 0)} s`);
  const tail = `  slowest: ${slowest.join(', ') || '–'}`;
  return [head, line('station', COLUMNS), ...rows, tail].join('\n');
}

function fixed(value: number | null, digits: number): string {
  return value === null ? '–' : value.toFixed(digits);
}

/** Seconds as m:ss. */
function clock(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
