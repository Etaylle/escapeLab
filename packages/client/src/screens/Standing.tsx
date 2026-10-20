import type { Difficulty, MissionStanding } from '@escapelab/core';
import { difficultyLabel, recordLine, standingPath, useJson } from '../runStats.js';
import { LeaderTable, type LeaderRow } from './History.js';

/** How many of the fastest crews the end screen lists. */
const SHOWN = 5;

/** The run just finished, as the end screen knows it. */
export interface FinishedRun {
  missionId: string;
  missionTitle: string;
  difficulty: Difficulty;
  won: boolean;
  /** the crew's names, in the order it joined */
  crew: string[];
  seconds: number;
  alarms: number;
  /** epoch ms: what the server knows the run by */
  finishedAt: number;
}

/** The end screen's part of the Bestenliste, loaded for the run just finished. */
export function RunStanding({ run }: { run: FinishedRun }) {
  const loaded = useJson<MissionStanding>(standingPath(run.missionId, run.finishedAt));
  if (loaded.status === 'loading') {
    return null;
  }
  if (loaded.status === 'failed') {
    return (
      <p className="muted standing-line">Die Bestenliste ist nicht erreichbar ({loaded.reason}).</p>
    );
  }
  return <Standing run={run} stats={loaded.value} />;
}

/**
 * Where the run stands. After a win: its place among every run of the
 * mission at its difficulty and the five fastest, this crew's row lit — at
 * the foot where it is not among them. After a loss: the mission's best
 * time and how often it is won.
 */
export function Standing({ run, stats }: { run: FinishedRun; stats: MissionStanding }) {
  const group = stats.difficulties.find((level) => level.difficulty === run.difficulty);
  // Nothing counted: the run could not be logged.
  if (group === undefined) {
    return null;
  }
  const where = `${run.missionTitle} · ${difficultyLabel(run.difficulty)}`;
  const place = run.won && stats.place?.difficulty === run.difficulty ? stats.place.place : null;
  if (place === null) {
    return (
      <section className="standing">
        <h2>Bestenliste</h2>
        <p className="standing-line">{`${where}: ${recordLine([group]) ?? ''}`}</p>
      </section>
    );
  }
  const rows: LeaderRow[] = group.top
    .slice(0, SHOWN)
    .map((entry, i) => ({ place: i + 1, entry, you: i + 1 === place }));
  if (place > SHOWN) {
    const { crew, seconds, alarms, finishedAt } = run;
    rows.push({
      place,
      entry: { crew, crewSize: crew.length, seconds, alarms, finishedAt },
      you: true,
    });
  }
  const runs = `${group.runs} ${group.runs === 1 ? 'Lauf' : 'Läufen'}`;
  return (
    <section className="standing">
      <h2>Bestenliste</h2>
      <p className="standing-line">{`Platz ${place} von ${runs} auf ${where}`}</p>
      <LeaderTable rows={rows} dated={false} />
    </section>
  );
}
