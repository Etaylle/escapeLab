import type { CSSProperties } from 'react';
import { achievement, ACHIEVEMENTS, type AchievementId } from '@escapelab/core';
import { dateText } from '../runStats.js';

/** How far apart the new plaques come in, ms: styles/gameplay.css staggers them by it. */
export const PLAQUE_STAGGER_MS = 300;

/**
 * The Erfolge of a run on its won card: a brass plate each, as the lab screws them to a wall —
 * the title engraved, its line under it and the day it was first earned on this device. The
 * ones new here come in one after the other, PLAQUE_STAGGER_MS apart (styles/gameplay.css); the
 * ones seen before are already up. Nothing for a run that earned none.
 */
export function Plaques({
  earned,
  fresh,
  since,
}: {
  earned: readonly AchievementId[];
  /** the ones new to this device */
  fresh: ReadonlySet<AchievementId>;
  /** when each was first earned here, epoch ms */
  since: Readonly<Partial<Record<AchievementId, number>>>;
}) {
  if (earned.length === 0) {
    return null;
  }
  let order = 0;
  return (
    <ul className="plaques" aria-label={`Erfolge: ${earned.length} von ${ACHIEVEMENTS.length}`}>
      {earned.map((id) => {
        const plaque = achievement(id);
        const isNew = fresh.has(id);
        const style = isNew ? ({ '--i': order++ } as CSSProperties) : undefined;
        const first = since[id];
        return (
          <li
            key={id}
            className={isNew ? 'plaque plaque--new' : 'plaque'}
            style={style}
            data-achievement={id}
          >
            <span className="plaque-title">{plaque.title}</span>
            <span className="plaque-line">{plaque.line}</span>
            {first !== undefined && <span className="plaque-date">{dateText(first)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** „Erfolge 3/7": how many of the seven a mission's plaques this device holds. */
export function plaqueCount(count: number): string {
  return `Erfolge ${count}/${ACHIEVEMENTS.length}`;
}
