import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { difficultyInfos, parseMission, scaleMission, DIFFICULTIES } from '../src/index.js';
import type { Mission } from '../src/index.js';

const blackout: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

/** Smallest penalty value anywhere in a mission, for the ordering checks. */
function penalties(mission: Mission): number[] {
  const puzzle = mission.puzzles.flatMap((p) => ('penaltySec' in p ? [p.penaltySec] : []));
  const drones = mission.map?.drones.map((d) => d.penaltySec) ?? [];
  const sabotage = mission.map?.sabotage === undefined ? [] : [mission.map.sabotage.penaltySec];
  return [...puzzle, ...drones, ...sabotage];
}

describe('difficulty scaling', () => {
  it('leaves a mission untouched on normal', () => {
    expect(scaleMission(blackout, 'normal')).toBe(blackout);
  });

  it('never mutates the mission it scales from', () => {
    const before = JSON.stringify(blackout);
    scaleMission(blackout, 'hart');
    scaleMission(blackout, 'entspannt');
    expect(JSON.stringify(blackout)).toBe(before);
  });

  it('orders time budget relaxed > normal > hard', () => {
    const times = DIFFICULTIES.map((d) => scaleMission(blackout, d).timeLimitSec);
    expect(times[0]).toBeGreaterThan(times[1] ?? 0);
    expect(times[1]).toBeGreaterThan(times[2] ?? 0);
  });

  it('orders every penalty the other way round', () => {
    const easy = penalties(scaleMission(blackout, 'entspannt'));
    const normal = penalties(blackout);
    const hard = penalties(scaleMission(blackout, 'hart'));
    expect(easy).toHaveLength(normal.length);
    for (const [i, value] of normal.entries()) {
      expect(easy[i]).toBeLessThan(value);
      expect(hard[i]).toBeGreaterThan(value);
    }
  });

  it('scales patrols and emergencies', () => {
    const easy = scaleMission(blackout, 'entspannt');
    const hard = scaleMission(blackout, 'hart');
    const speedOf = (m: Mission): number => m.map?.drones[0]?.speed ?? 0;
    expect(speedOf(easy)).toBeLessThan(speedOf(blackout));
    expect(speedOf(hard)).toBeGreaterThan(speedOf(blackout));

    const gapOf = (m: Mission): number => m.map?.sabotage?.everySec ?? 0;
    expect(gapOf(easy)).toBeGreaterThan(gapOf(blackout));
    expect(gapOf(hard)).toBeLessThan(gapOf(blackout));
    // More time to fix it when relaxed, less when hard.
    expect(easy.map?.sabotage?.durationSec ?? 0).toBeGreaterThan(
      hard.map?.sabotage?.durationSec ?? 0,
    );
  });

  it('scales the hint price like a penalty, never below five seconds', () => {
    const priced = (hintCostSec: number): Mission =>
      parseMission({ ...JSON.parse(JSON.stringify(blackout)), hintCostSec });
    expect(scaleMission(priced(20), 'entspannt').hintCostSec).toBeLessThan(20);
    expect(scaleMission(priced(20), 'hart').hintCostSec).toBeGreaterThan(20);
    expect(scaleMission(priced(5), 'entspannt').hintCostSec).toBe(5);
    // The wait before a hint is no penalty and stays as it is.
    expect(scaleMission(priced(20), 'hart').hintDelaySec).toBe(priced(20).hintDelaySec);
  });

  it('keeps scaled missions valid and solvable by the schema', () => {
    for (const level of DIFFICULTIES) {
      const scaled = scaleMission(blackout, level);
      expect(() => parseMission(JSON.parse(JSON.stringify(scaled)))).not.toThrow();
      expect(scaled.timeLimitSec).toBeGreaterThanOrEqual(60);
    }
  });

  it('describes every level for the lobby', () => {
    const infos = difficultyInfos();
    expect(infos.map((i) => i.id)).toEqual([...DIFFICULTIES]);
    expect(infos.every((i) => i.label.length > 0 && i.description.length > 0)).toBe(true);
  });
});
