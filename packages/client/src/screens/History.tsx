import { useState } from 'react';
import {
  DIFFICULTIES,
  type Difficulty,
  type DifficultyStats,
  type LeaderEntry,
  type MissionInfo,
  type MissionStats,
} from '@escapelab/core';
import {
  clock,
  crewText,
  dateText,
  difficultyLabel,
  STATS_PATH,
  useJson,
  winShare,
} from '../runStats.js';

interface Props {
  missions: MissionInfo[];
  /** the mission whose tab is open */
  missionId: string;
  selectMission: (missionId: string) => void;
  back: () => void;
}

/**
 * The Bestenliste, a page of its own off the join screen like the handbook:
 * a tab per mission, the difficulty to show, the totals and the fastest
 * crews. On paper only the list of the open tab remains — see history.css.
 */
export function HistoryScreen({ missions, missionId, selectMission, back }: Props) {
  // Fetched afresh every time the page opens: runs end while it is closed.
  const loaded = useJson<MissionStats[]>(STATS_PATH);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');

  return (
    <div className="card history">
      <div className="history-head">
        <button className="link history-back" onClick={back}>
          ← Zurück
        </button>
        <h1>Bestenliste</h1>
        <button
          className="primary history-print"
          disabled={loaded.status !== 'ready'}
          onClick={() => window.print()}
        >
          Drucken
        </button>
      </div>
      {loaded.status === 'loading' && <p className="muted">Lade Bestenliste …</p>}
      {loaded.status === 'failed' && (
        <p className="warn" role="alert">
          Die Bestenliste ließ sich nicht laden ({loaded.reason}).
        </p>
      )}
      {loaded.status === 'ready' && (
        <HistoryBoard
          missions={missions}
          stats={loaded.value}
          missionId={missionId}
          selectMission={selectMission}
          difficulty={difficulty}
          selectDifficulty={setDifficulty}
        />
      )}
    </div>
  );
}

interface BoardProps {
  missions: MissionInfo[];
  stats: MissionStats[];
  missionId: string;
  selectMission: (missionId: string) => void;
  difficulty: Difficulty;
  selectDifficulty: (difficulty: Difficulty) => void;
}

/** The missions to pick from: the catalog's in its order, then any it no longer has, by id. */
function tabsOf(missions: MissionInfo[], stats: MissionStats[]): { id: string; title: string }[] {
  const gone = stats.filter((m) => !missions.some((known) => known.id === m.missionId));
  return [
    ...missions.map(({ id, title }) => ({ id, title })),
    ...gone.map(({ missionId }) => ({ id: missionId, title: missionId })),
  ];
}

/** The tabs and the difficulty, then the totals and the list of the pair picked. */
export function HistoryBoard({
  missions,
  stats,
  missionId,
  selectMission,
  difficulty,
  selectDifficulty,
}: BoardProps) {
  const tabs = tabsOf(missions, stats);
  const title = tabs.find((tab) => tab.id === missionId)?.title ?? missionId;
  const group = stats
    .find((mission) => mission.missionId === missionId)
    ?.difficulties.find((level) => level.difficulty === difficulty);

  return (
    <>
      <div className="history-tabs" role="group" aria-label="Mission">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className="history-tab"
            aria-pressed={tab.id === missionId}
            onClick={() => selectMission(tab.id)}
          >
            {tab.title}
          </button>
        ))}
      </div>
      <div className="history-levels" role="group" aria-label="Schwierigkeit">
        {DIFFICULTIES.map((level) => (
          <button
            key={level}
            className="history-level"
            aria-pressed={level === difficulty}
            onClick={() => selectDifficulty(level)}
          >
            {difficultyLabel(level)}
          </button>
        ))}
      </div>
      <section className="history-board">
        <h2>{`${title} · ${difficultyLabel(difficulty)}`}</h2>
        {group === undefined ? (
          <p className="muted">Auf dieser Stufe ist hier noch niemand gelaufen.</p>
        ) : (
          <Ranking group={group} />
        )}
      </section>
    </>
  );
}

/** One mission at one difficulty: its totals, then its fastest crews. */
function Ranking({ group }: { group: DifficultyStats }) {
  const time = (seconds: number | null): string => (seconds === null ? '–' : clock(seconds));
  return (
    <>
      <dl className="history-totals">
        <div>
          <dt>Läufe</dt>
          <dd>{group.runs}</dd>
        </div>
        <div>
          <dt title={`${group.wins} von ${group.runs}`}>Gewonnen</dt>
          <dd>{winShare(group.wins, group.runs)}</dd>
        </div>
        <div>
          <dt>Beste Zeit</dt>
          <dd>{time(group.bestSeconds)}</dd>
        </div>
        <div>
          <dt title="Median der gewonnenen Läufe">Median</dt>
          <dd>{time(group.medianSeconds)}</dd>
        </div>
      </dl>
      {group.top.length === 0 ? (
        <p className="muted">Noch ist keine Crew entkommen.</p>
      ) : (
        <LeaderTable
          rows={group.top.map((entry, i) => ({ place: i + 1, entry, you: false }))}
          dated
        />
      )}
    </>
  );
}

/** A won run on a list: at its place, and whether it is the crew looking at it. */
export interface LeaderRow {
  place: number;
  entry: LeaderEntry;
  you: boolean;
}

/**
 * Won runs, a row each: place, crew, time, alarms and, where `dated`, the
 * day. A row whose place does not follow on from the one above stands apart.
 */
export function LeaderTable({ rows, dated }: { rows: LeaderRow[]; dated: boolean }) {
  return (
    <table className="leaders">
      <thead>
        <tr>
          <th scope="col">Platz</th>
          <th scope="col">Crew</th>
          <th scope="col">Zeit</th>
          <th scope="col">Alarme</th>
          {dated && (
            <th scope="col" className="leader-date">
              Datum
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ place, entry, you }, i) => {
          const apart = i > 0 && place !== (rows[i - 1]?.place ?? 0) + 1;
          const classes = [you && 'leader-you', apart && 'leader-apart'].filter(Boolean);
          return (
            <tr
              key={`${place}-${entry.finishedAt}`}
              className={classes.length > 0 ? classes.join(' ') : undefined}
              aria-current={you ? 'true' : undefined}
            >
              <td className="leader-place">{place}</td>
              <th scope="row" className={entry.crew.length > 0 ? 'leader-crew' : 'leader-nameless'}>
                {crewText(entry)}
              </th>
              <td className="leader-time">{clock(entry.seconds)}</td>
              <td className="leader-alarms">{entry.alarms}</td>
              {dated && <td className="leader-date">{dateText(entry.finishedAt)}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
