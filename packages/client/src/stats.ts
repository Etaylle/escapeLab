import type { Grade } from '@escapelab/core';

/**
 * Per-mission record kept in this browser only. Storage can be unavailable
 * (private windows, blocked site data), so every access degrades to "no
 * history" instead of breaking the end screen.
 */
export interface MissionRecord {
  runs: number;
  wins: number;
  /** fastest finished run in ms */
  bestMs: number | null;
  bestRank: Grade['rank'] | null;
}

const EMPTY: MissionRecord = { runs: 0, wins: 0, bestMs: null, bestRank: null };
const RANK_ORDER: Grade['rank'][] = ['C', 'B', 'A', 'S'];

const key = (missionId: string): string => `escapelab-record-${missionId}`;

export function readRecord(missionId: string): MissionRecord {
  try {
    const raw = localStorage.getItem(key(missionId));
    if (raw === null) {
      return EMPTY;
    }
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? { ...EMPTY, ...(parsed as Partial<MissionRecord>) }
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

export interface RunOutcome {
  won: boolean;
  usedMs: number;
  rank: Grade['rank'] | null;
}

/** Folds one finished run into the record and returns both halves. */
export function recordRun(
  missionId: string,
  outcome: RunOutcome,
): { before: MissionRecord; after: MissionRecord; newBestTime: boolean; newBestRank: boolean } {
  const before = readRecord(missionId);
  const newBestTime =
    outcome.won && (before.bestMs === null || outcome.usedMs < before.bestMs);
  const newBestRank =
    outcome.rank !== null &&
    (before.bestRank === null ||
      RANK_ORDER.indexOf(outcome.rank) > RANK_ORDER.indexOf(before.bestRank));
  const after: MissionRecord = {
    runs: before.runs + 1,
    wins: before.wins + (outcome.won ? 1 : 0),
    bestMs: newBestTime ? outcome.usedMs : before.bestMs,
    bestRank: newBestRank ? outcome.rank : before.bestRank,
  };
  try {
    localStorage.setItem(key(missionId), JSON.stringify(after));
  } catch {
    // Storage blocked: the run still shows its own numbers, just nothing saved.
  }
  return { before, after, newBestTime, newBestRank };
}
