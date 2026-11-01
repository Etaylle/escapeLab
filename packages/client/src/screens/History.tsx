import { useEffect, useRef, useState } from 'react';
import {
  dailyLabel,
  DIFFICULTIES,
  type DailyStats,
  type Difficulty,
  type DifficultyStats,
  type LeaderEntry,
  type MissionInfo,
  type MissionStats,
} from '@escapelab/core';
import {
  clock,
  crewText,
  DAILY_PATH,
  dateText,
  difficultyLabel,
  STATS_PATH,
  useJson,
  winShare,
} from '../runStats.js';

/** The Tagesschicht's tab among the missions': no mission carries this id. */
export const DAILY_TAB = ':tagesschicht';

interface Props {
  missions: MissionInfo[];
  /** the mission whose tab is open */
  missionId: string;
  selectMission: (missionId: string) => void;
  back: () => void;
}

/**
 * The Bestenliste, a page of its own off the join screen like the handbook:
 * a tab per mission and one for the Tagesschicht, the difficulty to show, the
 * totals and the fastest crews. On paper only the list of the open tab
 * remains — see history.css.
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

/**
 * Where a strip scrolled to `scroll`, `width` wide, scrolls to so that the span from `left` to
 * `right` of what it holds shows whole, `pad` clear of its edges: where it is if it shows, else
 * the nearest scroll that shows it.
 */
export function scrollToShow(
  scroll: number,
  width: number,
  [left, right]: readonly [number, number],
  pad: number,
): number {
  if (left - pad < scroll) {
    return Math.max(0, left - pad);
  }
  return right + pad > scroll + width ? right + pad - width : scroll;
}

/** Scrolls the strip of tabs `strip` to show its tab pressed (history.css `.history-tabs`). */
function showPressed(strip: HTMLElement | null): void {
  const tab = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (strip == null || tab == null) {
    return;
  }
  const box = strip.getBoundingClientRect();
  const at = tab.getBoundingClientRect();
  const left = at.left - box.left + strip.scrollLeft;
  const pad = parseFloat(getComputedStyle(strip).paddingLeft) || 0;
  const span = [left, left + at.width] as const;
  strip.scrollLeft = scrollToShow(strip.scrollLeft, strip.clientWidth, span, pad);
}

/** The missions to pick from: the catalog's in its order, then any it no longer has, by id. */
function tabsOf(missions: MissionInfo[], stats: MissionStats[]): { id: string; title: string }[] {
  const gone = stats.filter((m) => !missions.some((known) => known.id === m.missionId));
  return [
    ...missions.map(({ id, title }) => ({ id, title })),
    ...gone.map(({ missionId }) => ({ id: missionId, title: missionId })),
  ];
}

/**
 * The tabs and the difficulty, then the totals and the list of the pair picked — on the
 * Tagesschicht's tab, of the day picked (`DailyBoard`).
 */
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
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => showPressed(strip.current), [missionId]);

  return (
    <>
      <div ref={strip} className="history-tabs" role="group" aria-label="Mission">
        {[...tabs, { id: DAILY_TAB, title: 'Tagesschicht' }].map((tab) => (
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
      {missionId === DAILY_TAB ? (
        <DailyBoard missions={missions} difficulty={difficulty} />
      ) : (
        <section className="history-board">
          <h2>{`${title} · ${difficultyLabel(difficulty)}`}</h2>
          {group === undefined ? (
            <p className="muted">Auf dieser Stufe ist hier noch niemand gelaufen.</p>
          ) : (
            <Ranking group={group} />
          )}
        </section>
      )}
    </>
  );
}

/** The Tagesschicht's days as the server ranks them (GET /stats/daily), fetched as it opens. */
function DailyBoard({ missions, difficulty }: { missions: MissionInfo[]; difficulty: Difficulty }) {
  const loaded = useJson<DailyStats[]>(DAILY_PATH);
  if (loaded.status === 'loading') {
    return <p className="muted">Lade die Tagesschicht …</p>;
  }
  if (loaded.status === 'failed') {
    return (
      <p className="warn" role="alert">
        Die Tagesschicht ließ sich nicht laden ({loaded.reason}).
      </p>
    );
  }
  return <DailyDays days={loaded.value} missions={missions} difficulty={difficulty} />;
}

/**
 * The Tagesschicht by day, the newest first: a chip per day, then each mission played on the
 * day picked at the difficulty picked — its totals and its fastest crews, every one of which
 * played the same instance.
 */
export function DailyDays({
  days,
  missions,
  difficulty,
}: {
  days: readonly DailyStats[];
  missions: MissionInfo[];
  difficulty: Difficulty;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const day = days.find((each) => each.day === picked) ?? days[0];
  if (day === undefined) {
    return <p className="muted">Noch ist keine Tagesschicht gelaufen.</p>;
  }
  const titleOf = (id: string): string => missions.find((m) => m.id === id)?.title ?? id;
  return (
    <>
      <div className="history-days" role="group" aria-label="Tag">
        {days.map((each) => (
          <button
            key={each.day}
            className="history-level"
            aria-pressed={each.day === day.day}
            onClick={() => setPicked(each.day)}
          >
            {dailyLabel(each.day)}
          </button>
        ))}
      </div>
      {day.missions.map((mission) => {
        const group = mission.difficulties.find((level) => level.difficulty === difficulty);
        const shift = `Tagesschicht ${dailyLabel(day.day)}`;
        return (
          <section key={mission.missionId} className="history-board">
            <h2>{`${titleOf(mission.missionId)} · ${shift} · ${difficultyLabel(difficulty)}`}</h2>
            {group === undefined ? (
              <p className="muted">Auf dieser Stufe ist an diesem Tag niemand gelaufen.</p>
            ) : (
              <Ranking group={group} />
            )}
          </section>
        );
      })}
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
