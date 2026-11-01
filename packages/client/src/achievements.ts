import { useEffect, useState } from 'react';
import { ACHIEVEMENT_IDS, type AchievementId } from '@escapelab/core';
import { localStore } from './notes.js';

/**
 * The Erfolge a device has seen earned, mission by mission, each with the moment of the run that
 * first earned it — kept in the browser, as the device's first won run is (firstRun.ts). The
 * server says which plaques a run earned (core achievements.ts, `PlayerView.achievements`); that
 * one is new here is the device's to tell: the won card lets the new ones come in, the lobby
 * counts them.
 */

/** Where the browser keeps them. */
export const ACHIEVEMENTS_KEY = 'escapelab.achievements';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The plaques earned on this device, by mission, each with when it was first earned (epoch ms). */
export type Earned = Readonly<Record<string, Readonly<Partial<Record<AchievementId, number>>>>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isId = (value: string): value is AchievementId => ACHIEVEMENT_IDS.some((id) => id === value);

/** One mission's plaques as stored: every known id with a moment, the rest left out. */
function missionOf(value: unknown): Partial<Record<AchievementId, number>> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [AchievementId, number] =>
        isId(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ),
  );
}

/** What `store` keeps; nothing where it keeps nothing, or nothing readable. */
export function readEarned(store: Pick<Store, 'getItem'> | null): Earned {
  let text: string | null = null;
  try {
    text = store?.getItem(ACHIEVEMENTS_KEY) ?? null;
  } catch {
    return {};
  }
  if (text === null) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).map(([missionId, plaques]) => [missionId, missionOf(plaques)]),
    );
  } catch {
    console.warn(`[escapelab] the stored Erfolge are no JSON, none count: ${text}`);
    return {};
  }
}

/** The plaques of `earned` that `known` has not seen for `missionId`: new on this device. */
export function newOnes(
  known: Earned,
  missionId: string,
  earned: readonly AchievementId[],
): AchievementId[] {
  return earned.filter((id) => known[missionId]?.[id] === undefined);
}

/**
 * `earned` for `missionId` kept in `store`, each new one dated `at`, the ones seen before
 * keeping their first date; false where the browser refuses it.
 */
export function keepEarned(
  store: Store | null,
  missionId: string,
  earned: readonly AchievementId[],
  at: number,
): boolean {
  if (store === null) {
    return false;
  }
  const known = readEarned(store);
  const mission = { ...known[missionId] };
  for (const id of earned) {
    mission[id] ??= at;
  }
  try {
    store.setItem(ACHIEVEMENTS_KEY, JSON.stringify({ ...known, [missionId]: mission }));
    return true;
  } catch {
    return false;
  }
}

/** How many of the seven plaques `known` holds for `missionId`. */
export function earnedCount(known: Earned, missionId: string): number {
  return Object.keys(known[missionId] ?? {}).length;
}

/** The plaques the device holds now, read as the screen comes up. */
export function useEarned(): Earned {
  const [known] = useState(() => readEarned(localStore()));
  return known;
}

/**
 * A finished run's plaques on this device: which of `earned` are new to it — worked out from
 * what it held as the screen came up — and every one kept, dated `at`, once the screen is up.
 * The plaques' first dates come back with them.
 */
export function useRunPlaques(
  missionId: string,
  earned: readonly AchievementId[],
  at: number | null,
): { fresh: ReadonlySet<AchievementId>; since: Readonly<Partial<Record<AchievementId, number>>> } {
  const [known] = useState(() => readEarned(localStore()));
  const ids = earned.join(' ');
  useEffect(() => {
    if (at === null || ids === '') {
      return;
    }
    if (!keepEarned(localStore(), missionId, ids.split(' ').filter(isId), at)) {
      console.warn('[escapelab] the browser keeps nothing here: the Erfolge stay this screen\'s');
    }
  }, [missionId, ids, at]);
  const fresh = new Set(newOnes(known, missionId, earned));
  const since: Partial<Record<AchievementId, number>> = {};
  for (const id of earned) {
    const first = known[missionId]?.[id] ?? at;
    if (first !== null) {
      since[id] = first;
    }
  }
  return { fresh, since };
}
