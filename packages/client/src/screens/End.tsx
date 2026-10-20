import { useEffect } from 'react';
import type { ClientMessage, PlayerView, RunEvent } from '@escapelab/core';
import { clock } from '../runStats.js';
import { play } from '../sounds.js';
import { CreditsTable } from './Crew.js';
import { Icon, type IconName } from './Icon.js';
import { RunStanding } from './Standing.js';

interface Props {
  view: PlayerView;
  send: (msg: ClientMessage) => void;
  leaveRoom: () => void;
}

/** Each line of the run report under the icon of what happened; notes and radio as on the HUD. */
const EVENT_ICON: Record<RunEvent['kind'], IconName> = {
  puzzle: 'check',
  penalty: 'siren',
  sabotage: 'warning',
  item: 'box',
  escape: 'exit',
  finish: 'flag',
  hint: 'note',
  radio: 'radio',
  find: 'search',
  power: 'power',
};

/** Milliseconds as m:ss. */
function fmt(ms: number): string {
  return clock(ms / 1000);
}

export function EndScreen({ view, send, leaveRoom }: Props) {
  const won = view.phase === 'won';
  useEffect(() => {
    play(won ? 'won' : 'lost');
  }, [won]);

  const { startedAt, finishedAt, deadlineAt } = view;
  const haveStats = startedAt !== null && finishedAt !== null;
  const usedMs = haveStats ? finishedAt - startedAt : 0;
  const remainingMs = haveStats && deadlineAt !== null ? Math.max(0, deadlineAt - finishedAt) : 0;

  const crew = view.players.filter((p) => p.connected);
  const waiting = crew.filter((p) => !p.ready);
  const confirmed = crew.length - waiting.length;

  return (
    <div className={`card end ${won ? 'end-won' : 'end-lost'}`}>
      <span className="kicker">{view.missionTitle}</span>
      <h1>
        <Icon name={won ? 'check' : 'cross'} /> {won ? 'ENTKOMMEN' : 'GESCHEITERT'}
      </h1>
      <p className="story">{view.storyText}</p>

      {haveStats && (
        <div className="stats">
          <div className="stat">
            <span className="stat-value">{fmt(usedMs)}</span>
            <span className="stat-label">gebraucht</span>
          </div>
          {won && (
            <div className="stat">
              <span className="stat-value">{fmt(remainingMs)}</span>
              <span className="stat-label">Restzeit</span>
            </div>
          )}
          <div className="stat">
            <span className="stat-value">{view.penaltySeq}</span>
            <span className="stat-label">{view.penaltySeq === 1 ? 'Alarm' : 'Alarme'}</span>
          </div>
          <div className="stat">
            <span className="stat-value">{view.hintsUsed}</span>
            <span className="stat-label">{view.hintsUsed === 1 ? 'Hinweis' : 'Hinweise'}</span>
          </div>
        </div>
      )}

      {view.grade !== null && (
        <div className={`grade grade-${view.grade.rank.toLowerCase()}`}>
          <span className="grade-rank">{view.grade.rank}</span>
          <span className="grade-label">{view.grade.label}</span>
        </div>
      )}

      {haveStats && (
        <RunStanding
          run={{
            missionId: view.missionId,
            missionTitle: view.missionTitle,
            difficulty: view.difficulty,
            won,
            crew: view.players.map((p) => p.name),
            seconds: usedMs / 1000,
            alarms: view.penaltySeq,
            finishedAt,
          }}
        />
      )}

      <h2>Beiträge</h2>
      <CreditsTable players={view.players} credits={view.credits} youId={view.you.id} />

      {view.events.length > 0 && startedAt !== null && (
        <>
          <h2>Einsatzprotokoll</h2>
          <ol className="report">
            {view.events.map((event, i) => (
              <li key={`${event.at}-${i}`} className={`report-${event.kind}`}>
                <span className="report-time">{fmt(event.at - startedAt)}</span>
                <span className="report-icon">
                  <Icon name={EVENT_ICON[event.kind]} />
                </span>
                <span className="report-text">{event.label}</span>
                {event.seconds !== null && (
                  <span className="report-cost">−{event.seconds}s</span>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="actions">
        <button
          className={view.you.ready ? '' : 'primary'}
          onClick={() => send({ kind: 'set-ready', ready: !view.you.ready })}
        >
          <Icon name={view.you.ready ? 'check' : 'replay'} />{' '}
          {view.you.ready ? 'Bereit für nochmal' : 'Nochmal — ich bin dabei'}
        </button>
        <p className="muted">
          {confirmed}/{crew.length} bereit
          {waiting.length > 0 ? ` — fehlen noch: ${waiting.map((p) => p.name).join(', ')}` : ''}
          . Sobald alle zugestimmt haben, startet derselbe Einsatz von selbst.
        </p>
        {view.you.isHost && (
          <button onClick={() => send({ kind: 'back-to-lobby' })}>
            Zur Lobby (Mission oder Schwierigkeit ändern)
          </button>
        )}
        <button className="link" onClick={leaveRoom}>
          Raum verlassen
        </button>
      </div>

      {/* A pinned room's run, for a bug report: ?seed= with it plays this run again. */}
      {view.seed?.run != null && <p className="muted run-seed">Seed {view.seed.run}</p>}
    </div>
  );
}
