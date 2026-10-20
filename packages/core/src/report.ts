import { DRONE_ALARM, EMERGENCY_CLEARED, EMERGENCY_MISSED } from './actions.js';
import type { Difficulty } from './difficulty.js';
import { NO_CREDITS, type Credits, type GameState, type Player, type RunEvent } from './state.js';

/** Escaped (or the last station solved), out of time, or stopped by the alarm limit. */
export type RunOutcome = 'won' | 'lost:time' | 'lost:alarms';

/** One station of a run. A station the run never got to has nulls and zeros. */
export interface StationReport {
  puzzleId: string;
  /**
   * When it came up, epoch ms: the start of the run for the first station,
   * the previous station's solve for every later one; null if never reached.
   */
  openedAt: number | null;
  /** epoch ms; null while unsolved */
  solvedAt: number | null;
  /** from openedAt to solvedAt; null while unsolved */
  seconds: number | null;
  /** wrong moves at it; drones and emergencies set their alarms off elsewhere */
  alarms: number;
  /** notes of the last crew asked for while it was up */
  hints: number;
}

/** A name in a report is cut to this many characters. */
const NAME_MAX = 24;

/**
 * What a finished run leaves behind for balancing and the Bestenliste, as
 * plain JSON. It names the crew by the names they played under — a game on
 * the LAN, first names typed at the door — but carries no player id: past
 * `crew`, everybody is p1…pn, in the order they joined. Times are epoch ms
 * like the state's.
 */
export interface RunReport {
  version: 2;
  missionId: string;
  /** the code of the room it was played in */
  roomCode: string;
  difficulty: Difficulty;
  /** seconds on the clock at the start, scaled to the difficulty */
  timeLimitSec: number;
  /** the alarm that reaches this many loses the run; null where the mission has no limit */
  alarmLimit: number | null;
  crewSize: number;
  /** the names the crew played under, p1…pn in order, each cut to NAME_MAX characters */
  crew: string[];
  /** the start tile each crew member drew, by p1…pn */
  spawns: Record<string, { x: number; y: number }>;
  /** the seed the run played, only where a tester pinned the room: `?seed=` plays it again */
  seed?: number;
  startedAt: number;
  finishedAt: number;
  outcome: RunOutcome;
  /** every station of the mission, in mission order */
  stations: StationReport[];
  /** emergencies started, and those that ran out before the crew cleared them */
  emergencies: { count: number; failed: number };
  /** every alarm by its cause, in the order the causes first came up */
  penalties: { cause: string; count: number; seconds: number }[];
  /** what each crew member did, by p1…pn */
  credits: Record<string, Credits>;
}

/**
 * The report of a finished run in the room `roomCode`, derived from its final
 * state alone: the events say when each station fell and what went wrong
 * where. Throws for a run that is not over yet.
 */
export function runReport(state: GameState, roomCode: string): RunReport {
  const { startedAt, finishedAt } = finishedRun(state);
  const crew = state.players.map((player, i) => ({ player, alias: `p${i + 1}` }));
  const alarmLimit = state.mission.maxAlarms ?? null;
  return {
    version: 2,
    missionId: state.mission.id,
    roomCode,
    difficulty: state.difficulty,
    timeLimitSec: state.mission.timeLimitSec,
    alarmLimit,
    crewSize: crew.length,
    crew: crew.map(({ player }) => cut(player.name)),
    spawns: Object.fromEntries(crew.map(({ player, alias }) => [alias, spawnOf(player, alias)])),
    ...(state.roomSeed === null || state.seed === null ? {} : { seed: state.seed }),
    startedAt,
    finishedAt,
    outcome: outcomeOf(state, alarmLimit),
    stations: stationsOf(state, startedAt),
    emergencies: emergenciesOf(state.events),
    penalties: penaltiesOf(state.events),
    credits: Object.fromEntries(
      crew.map(({ player, alias }) => [alias, { ...(state.credits[player.id] ?? NO_CREDITS) }]),
    ),
  };
}

function finishedRun(state: GameState): { startedAt: number; finishedAt: number } {
  const { phase, startedAt, finishedAt } = state;
  if (phase === 'lobby' || phase === 'playing' || startedAt === null || finishedAt === null) {
    throw new Error(
      `runReport: the run is not over (phase "${phase}") — report a run once it is won or lost`,
    );
  }
  return { startedAt, finishedAt };
}

/** A name cut to NAME_MAX characters, whole ones — never half an emoji — without a final space. */
function cut(name: string): string {
  return [...name].slice(0, NAME_MAX).join('').trimEnd();
}

function spawnOf(player: Player, alias: string): { x: number; y: number } {
  if (player.spawn === null) {
    throw new Error(`runReport: ${alias} drew no spawn — was start-mission skipped?`);
  }
  return { x: player.spawn.x, y: player.spawn.y };
}

/** Only the alarm that reaches the limit ends a run early, so a lost run at the limit hit it. */
function outcomeOf(state: GameState, alarmLimit: number | null): RunOutcome {
  if (state.phase === 'won') {
    return 'won';
  }
  return alarmLimit !== null && state.penaltySeq >= alarmLimit ? 'lost:alarms' : 'lost:time';
}

/** Every alarm but a drone's and a missed emergency's is a wrong move at the open station. */
function isStationAlarm(event: RunEvent): boolean {
  return (
    event.kind === 'penalty' && event.label !== DRONE_ALARM && event.label !== EMERGENCY_MISSED
  );
}

/**
 * Stations fall strictly in mission order, one 'puzzle' line each: an event
 * belongs to the station that was up, the one after all solved before it.
 * Whatever happens after the last solve, on the way out, belongs to none.
 */
function stationsOf(state: GameState, startedAt: number): StationReport[] {
  const located: { event: RunEvent; station: number }[] = [];
  let solvedSoFar = 0;
  for (const event of state.events) {
    located.push({ event, station: solvedSoFar });
    if (event.kind === 'puzzle') {
      solvedSoFar += 1;
    }
  }
  const solves = state.events.flatMap((event) => (event.kind === 'puzzle' ? [event.at] : []));
  return state.mission.puzzles.map((def, index) => {
    const openedAt = index === 0 ? startedAt : (solves[index - 1] ?? null);
    const solvedAt = solves[index] ?? null;
    const there = located.filter(({ station }) => station === index).map(({ event }) => event);
    return {
      puzzleId: def.id,
      openedAt,
      solvedAt,
      seconds: openedAt === null || solvedAt === null ? null : (solvedAt - openedAt) / 1000,
      alarms: there.filter(isStationAlarm).length,
      hints: there.filter((event) => event.kind === 'hint').length,
    };
  });
}

function emergenciesOf(events: readonly RunEvent[]): RunReport['emergencies'] {
  return {
    count: events.filter((e) => e.kind === 'sabotage' && e.label !== EMERGENCY_CLEARED).length,
    failed: events.filter((e) => e.kind === 'penalty' && e.label === EMERGENCY_MISSED).length,
  };
}

function penaltiesOf(events: readonly RunEvent[]): RunReport['penalties'] {
  const byCause = new Map<string, { count: number; seconds: number }>();
  for (const { kind, label, seconds } of events) {
    if (kind === 'penalty') {
      const tally = byCause.get(label) ?? { count: 0, seconds: 0 };
      byCause.set(label, { count: tally.count + 1, seconds: tally.seconds + (seconds ?? 0) });
    }
  }
  return [...byCause].map(([cause, tally]) => ({ cause, ...tally }));
}
