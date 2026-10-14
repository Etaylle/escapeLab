import type { Mission } from './mission.js';
import type { PuzzleDef } from './puzzles/index.js';

/**
 * Difficulty is applied by scaling a mission into a new mission, so every
 * consumer downstream — deadlines, penalties, patrols, emergencies, the
 * alarm limit — keeps working on plain mission data and knows nothing about
 * difficulty.
 */

export const DIFFICULTIES = ['entspannt', 'normal', 'hart'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

interface Scaling {
  label: string;
  description: string;
  time: number;
  penalty: number;
  droneSpeed: number;
  droneRange: number;
  sabotageGap: number;
  sabotageDuration: number;
  /** alarms that end the run where the mission sets no limit of its own; null for none */
  maxAlarms: number | null;
}

const SCALING: Record<Difficulty, Scaling> = {
  entspannt: {
    label: 'Entspannt',
    description: 'Mehr Zeit, milde Strafen, träge Drohnen — gut für den ersten Durchlauf.',
    time: 1.35,
    penalty: 0.6,
    droneSpeed: 0.75,
    droneRange: 0.85,
    sabotageGap: 1.5,
    sabotageDuration: 1.3,
    maxAlarms: null,
  },
  normal: {
    label: 'Normal',
    description: 'Die Mission so, wie sie gedacht ist.',
    time: 1,
    penalty: 1,
    droneSpeed: 1,
    droneRange: 1,
    sabotageGap: 1,
    sabotageDuration: 1,
    maxAlarms: 5,
  },
  hart: {
    label: 'Hart',
    description: 'Knappe Zeit, teure Fehler, schnelle Patrouillen, häufige Notfälle.',
    time: 0.8,
    penalty: 1.4,
    droneSpeed: 1.2,
    droneRange: 1.15,
    sabotageGap: 0.7,
    sabotageDuration: 0.85,
    maxAlarms: 3,
  },
};

export function difficultyInfos(): { id: Difficulty; label: string; description: string }[] {
  return DIFFICULTIES.map((id) => ({
    id,
    label: SCALING[id].label,
    description: SCALING[id].description,
  }));
}

const atLeast = (value: number, min = 1): number => Math.max(min, Math.round(value));

function scalePuzzle(puzzle: PuzzleDef, factor: number): PuzzleDef {
  const scaled = { ...puzzle, penaltySec: atLeast(puzzle.penaltySec * factor, 5) };
  // A burnt-out box costs its own price, and that is a penalty like any other.
  if ('burnoutSec' in scaled) {
    return { ...scaled, burnoutSec: atLeast(scaled.burnoutSec * factor, 5) };
  }
  return scaled;
}

/**
 * Returns a copy of `mission` with every difficulty-dependent number scaled
 * and its alarm limit set.
 */
export function scaleMission(mission: Mission, difficulty: Difficulty): Mission {
  const s = SCALING[difficulty];
  // A count, not a cost: a limit the mission sets (null included) stands at every level.
  const maxAlarms = mission.maxAlarms === undefined ? s.maxAlarms : mission.maxAlarms;
  if (difficulty === 'normal') {
    return { ...mission, maxAlarms };
  }
  const map = mission.map;
  return {
    ...mission,
    maxAlarms,
    timeLimitSec: atLeast(mission.timeLimitSec * s.time, 60),
    hintCostSec: atLeast(mission.hintCostSec * s.penalty, 5),
    puzzles: mission.puzzles.map((puzzle) => scalePuzzle(puzzle, s.penalty)),
    map: {
      ...map,
      drones: map.drones.map((drone) => ({
        ...drone,
        speed: Math.round(drone.speed * s.droneSpeed * 100) / 100,
        range: Math.round(drone.range * s.droneRange * 100) / 100,
        penaltySec: atLeast(drone.penaltySec * s.penalty, 5),
      })),
      ...(map.sabotage === undefined
        ? {}
        : {
            sabotage: {
              ...map.sabotage,
              firstAfterSec: atLeast(map.sabotage.firstAfterSec * s.sabotageGap, 30),
              everySec: atLeast(map.sabotage.everySec * s.sabotageGap, 45),
              durationSec: atLeast(map.sabotage.durationSec * s.sabotageDuration, 20),
              penaltySec: atLeast(map.sabotage.penaltySec * s.penalty, 10),
            },
          }),
    },
  };
}
