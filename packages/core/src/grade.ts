import { runSeconds, type RunReport } from './report.js';

/**
 * How well a crew did in a run it won: a clean run with time to spare is the top rank, every
 * alarm and every lost second pushes it down — where a clock runs at all. Hints count too, but
 * more gently: they only stand between the crew and the top two ranks. The end screen reckons
 * it from the run's state (view.ts), „Meine Einsätze" from the run's report — the same facts,
 * the same rank.
 */

export interface Grade {
  /** S, A, B or C — only awarded for a mission that was actually finished */
  rank: 'S' | 'A' | 'B' | 'C';
  label: string;
}

/** What a won run's grade is reckoned from. */
export interface GradeFacts {
  /** ms on the clock: from the lights going out to the end, the intro left out */
  usedMs: number;
  /** ms the clock started with, scaled to the difficulty; 0 for a mission without a clock */
  budgetMs: number;
  /** every alarm of the run, whatever set it off */
  alarms: number;
  /** notes of the last shift bought */
  hints: number;
  /** whether the crew got out by a hatch; false where the last station's solve won the run */
  hatch: boolean;
}

/** The grade of a won run of `facts`. */
export function gradeOf({ usedMs, budgetMs, alarms, hints, hatch }: GradeFacts): Grade {
  const spare = spareOf(usedMs, budgetMs);
  if (alarms === 0 && hints === 0 && spare >= 0.3) {
    return { rank: 'S', label: flawlessLabel(budgetMs) };
  }
  if (alarms <= 1 && hints <= 1 && spare >= 0.15) {
    return { rank: 'A', label: 'Sauber — fast ohne Zwischenfälle' };
  }
  if (alarms <= 3) {
    return { rank: 'B', label: solidLabel(hatch) };
  }
  return { rank: 'C', label: 'Knapp vorbei an der Katastrophe' };
}

/** The share of its clock a run left, 0 to 1 — and all of it where the mission has no clock. */
function spareOf(usedMs: number, budgetMs: number): number {
  return budgetMs === 0 ? 1 : Math.max(0, 1 - usedMs / budgetMs);
}

/** The top rank in words: time to spare where a clock ran, no note bought where none did. */
function flawlessLabel(budgetMs: number): string {
  return budgetMs === 0
    ? 'Makellos — kein einziger Alarm, keine Notiz gebraucht'
    : 'Makellos — kein einziger Alarm, massig Zeit übrig';
}

/** The third rank in words: the crew out through the hatch, or every station done without one. */
function solidLabel(hatch: boolean): string {
  return hatch
    ? 'Solide — es hat gewackelt, aber alle sind draußen'
    : 'Solide — es hat gewackelt, aber jede Station ist abgenommen';
}

/**
 * The grade of the run `report` holds — its alarms by cause added up, its notes station by
 * station — or null for a run lost.
 */
export function reportGrade(
  report: Pick<
    RunReport,
    | 'outcome'
    | 'startedAt'
    | 'lightsOutAt'
    | 'finishedAt'
    | 'timeLimitSec'
    | 'noHatch'
    | 'penalties'
    | 'stations'
  >,
): Grade | null {
  if (report.outcome !== 'won') {
    return null;
  }
  return gradeOf({
    usedMs: runSeconds(report) * 1000,
    budgetMs: report.timeLimitSec * 1000,
    alarms: report.penalties.reduce((sum, penalty) => sum + penalty.count, 0),
    hints: report.stations.reduce((sum, station) => sum + station.hints, 0),
    hatch: report.noHatch !== true,
  });
}
