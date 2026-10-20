import { useEffect, useState } from 'react';
import {
  difficultyInfos,
  type Difficulty,
  type DifficultyStats,
  type LeaderEntry,
} from '@escapelab/core';

/**
 * The Bestenliste on the client: what the server counts from its run log
 * (GET /stats), fetched for the join screen, the end screen and the
 * Bestenliste page, and the words and numbers they put it in.
 */

/** Something fetched: still on its way, failed and why, or there. */
export type Loaded<T> =
  | { status: 'loading' }
  | { status: 'failed'; reason: string }
  | { status: 'ready'; value: T };

/** Every mission with runs. */
export const STATS_PATH = '/stats';

/** One mission, and where its won run that finished at `finishedAt` stands. */
export function standingPath(missionId: string, finishedAt: number): string {
  return `/stats/${encodeURIComponent(missionId)}?run=${finishedAt}`;
}

/**
 * The JSON at `path` on the game's server, fetched again whenever `path`
 * changes; an answer for a path no longer asked for never lands. A failure
 * goes to the console as well, for the screens that show nothing of it.
 */
export function useJson<T>(path: string): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    setLoaded({ status: 'loading' });
    fetch(path)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as T;
      })
      .then(
        (value) => {
          if (current) {
            setLoaded({ status: 'ready', value });
          }
        },
        (err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          console.warn(`[escapelab] GET ${path} failed: ${reason}`);
          if (current) {
            setLoaded({ status: 'failed', reason });
          }
        },
      );
    return () => {
      current = false;
    };
  }, [path]);
  return loaded;
}

/** Seconds as m:ss, rounded to the second. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** A percent sign behind a no-break space: number and sign stay on one line. */
const PERCENT = '\u00a0%';

/** The share of runs won, „63 %": never 0 % once one is won, never 100 % while one is lost. */
export function winShare(wins: number, runs: number): string {
  const share = runs === 0 ? 0 : Math.round((100 * wins) / runs);
  if (wins > 0 && share === 0) {
    return `unter 1${PERCENT}`;
  }
  if (wins < runs && share === 100) {
    return `über 99${PERCENT}`;
  }
  return `${share}${PERCENT}`;
}

/**
 * A mission's record over the difficulties given, in its two halves: the
 * best time, „Beste Zeit 7:42", and the share won, „63 % gewonnen"; null
 * before their first run.
 */
export function recordParts(groups: readonly DifficultyStats[]): [string, string] | null {
  const runs = groups.reduce((sum, group) => sum + group.runs, 0);
  if (runs === 0) {
    return null;
  }
  const wins = groups.reduce((sum, group) => sum + group.wins, 0);
  const bests = groups.flatMap((group) => (group.bestSeconds === null ? [] : [group.bestSeconds]));
  const best =
    bests.length === 0 ? 'Noch keine Bestzeit' : `Beste Zeit ${clock(Math.min(...bests))}`;
  return [best, `${winShare(wins, runs)} gewonnen`];
}

/**
 * A mission's record in one line over the difficulties given, „Beste Zeit
 * 7:42 · 63 % gewonnen"; null before their first run.
 */
export function recordLine(groups: readonly DifficultyStats[]): string | null {
  return recordParts(groups)?.join(' · ') ?? null;
}

export function difficultyLabel(id: Difficulty): string {
  return difficultyInfos().find((level) => level.id === id)?.label ?? id;
}

/** Who a run on the list was: the crew's names, or — logged before names were — how many. */
export function crewText(entry: LeaderEntry): string {
  return entry.crew.length > 0 ? entry.crew.join(', ') : `ohne Namen (${entry.crewSize})`;
}

/** The day a run ended, „20.10.2026". */
export function dateText(at: number): string {
  return new Date(at).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
