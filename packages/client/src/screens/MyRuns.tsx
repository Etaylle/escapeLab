import { Fragment, useEffect } from 'react';
import { dailyLabel, type AccountRun, type MissionInfo } from '@escapelab/core';
import { clock, dateText, difficultyLabel, type Loaded } from '../runStats.js';
import type { MyRuns } from '../ws.js';
import { ENDING_TITLES } from './End.js';

/**
 * „Meine Einsätze", a page of its own off the menu as the Bestenliste is: the runs the pass's
 * account played, the newest first — the mission, the day, how it ended, the time on the
 * clock, the crew and the rank. The server keeps them with the account (`my-runs`); the page
 * asks for them as it opens.
 */

interface Props {
  missions: MissionInfo[];
  /** what the server said, or why it did not */
  loaded: Loaded<MyRuns>;
  /** asks the server for the runs (`my-runs`): once as the page opens, and once the line is up */
  ask: () => void;
  connected: boolean;
  back: () => void;
}

/** How a run ended, as its row says it: the title card's words, in a sentence's case. */
export function outcomeText(outcome: AccountRun['outcome']): string {
  const title = ENDING_TITLES[outcome];
  return `${title.charAt(0)}${title.slice(1).toLowerCase()}`;
}

/** The row's mission: its title, the difficulty, and the Tagesschicht's day where it was one. */
function missionCell(run: AccountRun, missions: MissionInfo[]): { title: string; how: string } {
  const title = missions.find((mission) => mission.id === run.missionId)?.title ?? run.missionId;
  const shift = run.daily === null ? '' : ` · Tagesschicht ${dailyLabel(run.daily)}`;
  return { title, how: `${difficultyLabel(run.difficulty)}${shift}` };
}

/**
 * The crew of a run as its row names them, in the order they joined: the account's own seat
 * marked; a seat whose account was deleted since names nobody.
 */
function CrewNames({ run }: { run: AccountRun }) {
  const named = run.crew.flatMap((name, seat) => (name === '' ? [] : [{ name, seat }]));
  return (
    <>
      {named.map(({ name, seat }, i) => (
        <Fragment key={seat}>
          {i > 0 && ', '}
          <span className={seat === run.seat ? 'my-runs-you' : undefined}>{name}</span>
        </Fragment>
      ))}
    </>
  );
}

/** One run of the account, a row: mission, day, outcome, time, crew, rank. */
function RunRow({ run, missions }: { run: AccountRun; missions: MissionInfo[] }) {
  const { title, how } = missionCell(run, missions);
  const won = run.outcome === 'won';
  return (
    <tr className={won ? 'my-runs-won' : 'my-runs-lost'}>
      <th scope="row" className="my-runs-mission">
        {title}
        <span className="my-runs-how">{how}</span>
      </th>
      <td className="leader-date">{dateText(run.finishedAt)}</td>
      <td className="my-runs-outcome">{outcomeText(run.outcome)}</td>
      <td className="leader-time">{clock(run.seconds)}</td>
      <td className="my-runs-crew">
        <CrewNames run={run} />
      </td>
      <td className="my-runs-rank-cell">
        {run.rank === null ? (
          <span className="my-runs-norank">–</span>
        ) : (
          <span className={`my-runs-rank my-runs-rank--${run.rank.toLowerCase()}`}>{run.rank}</span>
        )}
      </td>
    </tr>
  );
}

/** The account's runs as a table, and how many older ones it leaves out. */
export function MyRunsTable({ mine, missions }: { mine: MyRuns; missions: MissionInfo[] }) {
  if (mine.runs.length === 0) {
    return <p className="muted">Noch kein Einsatz mit diesem Konto.</p>;
  }
  const older = mine.total - mine.runs.length;
  return (
    <>
      <table className="leaders my-runs-table">
        <thead>
          <tr>
            <th scope="col">Mission</th>
            <th scope="col" className="leader-date">
              Datum
            </th>
            <th scope="col">Ausgang</th>
            <th scope="col">Zeit</th>
            <th scope="col">Crew</th>
            <th scope="col">Rang</th>
          </tr>
        </thead>
        <tbody>
          {mine.runs.map((run) => (
            <RunRow key={`${run.finishedAt}-${run.seat}`} run={run} missions={missions} />
          ))}
        </tbody>
      </table>
      {older > 0 && (
        <p className="muted my-runs-older">
          Die letzten {mine.runs.length} von {mine.total} Einsätzen.
        </p>
      )}
    </>
  );
}

/** The page: the way back, its title, and the account's runs once the server sent them. */
export function MyRunsScreen({ missions, loaded, ask, connected, back }: Props) {
  // Asked as the page opens, and again whenever the line is back: runs end while it is closed.
  useEffect(() => {
    if (connected) {
      ask();
    }
    // `ask` is stable for the lifetime of the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);
  return (
    <div className="card history my-runs">
      <div className="history-head">
        <button className="link history-back" onClick={back}>
          ← Zurück
        </button>
        <h1>Meine Einsätze</h1>
      </div>
      {loaded.status === 'loading' && <p className="muted">Lade die Einsätze …</p>}
      {loaded.status === 'failed' && (
        <p className="warn" role="alert">
          Die Einsätze ließen sich nicht laden ({loaded.reason}).
        </p>
      )}
      {loaded.status === 'ready' && <MyRunsTable mine={loaded.value} missions={missions} />}
    </div>
  );
}
