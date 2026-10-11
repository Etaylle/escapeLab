import { useEffect, useRef } from 'react';
import type { ClientMessage, PlayerView } from '@escapelab/core';
import { play } from '../sounds.js';
import { recordRun, type MissionRecord } from '../stats.js';

interface Props {
  view: PlayerView;
  send: (msg: ClientMessage) => void;
  leaveRoom: () => void;
}

const EVENT_ICON: Record<string, string> = {
  puzzle: '✔',
  penalty: '🚨',
  sabotage: '⚠',
  item: '📦',
  escape: '🚪',
  finish: '🏁',
};

function fmt(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
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

  // Folded into this browser's history exactly once per finished run.
  const recordRef = useRef<ReturnType<typeof recordRun> | null>(null);
  if (recordRef.current === null && haveStats) {
    recordRef.current = recordRun(view.missionId, {
      won,
      usedMs,
      rank: view.grade?.rank ?? null,
    });
  }
  const record = recordRef.current;
  const history: MissionRecord | null = record?.after ?? null;
  const waiting = view.players.filter((p) => !p.isHost && !p.ready);

  return (
    <div className={`card end ${won ? 'end-won' : 'end-lost'}`}>
      <span className="kicker">{view.missionTitle}</span>
      <h1>{won ? '✔ ENTKOMMEN' : '✖ GESCHEITERT'}</h1>
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
          {history !== null && history.bestMs !== null && (
            <div className={`stat ${record?.newBestTime === true ? 'stat-best' : ''}`}>
              <span className="stat-value">{fmt(history.bestMs)}</span>
              <span className="stat-label">
                {record?.newBestTime === true ? '🏆 neue Bestzeit' : 'Bestzeit'}
              </span>
            </div>
          )}
        </div>
      )}

      {record !== null && (record.newBestTime || record.newBestRank) && (
        <div className="record-banner">
          🏆 {record.newBestTime ? 'Neue Bestzeit!' : ''}
          {record.newBestTime && record.newBestRank ? ' · ' : ''}
          {record.newBestRank ? `Bester Rang bisher: ${record.after.bestRank}` : ''}
        </div>
      )}

      {view.grade !== null && (
        <div className={`grade grade-${view.grade.rank.toLowerCase()}`}>
          <span className="grade-rank">{view.grade.rank}</span>
          <span className="grade-label">{view.grade.label}</span>
        </div>
      )}

      {view.events.length > 0 && startedAt !== null && (
        <>
          <h2>Einsatzprotokoll</h2>
          <ol className="report">
            {view.events.map((event, i) => (
              <li key={`${event.at}-${i}`} className={`report-${event.kind}`}>
                <span className="report-time">{fmt(event.at - startedAt)}</span>
                <span className="report-icon">{EVENT_ICON[event.kind]}</span>
                <span className="report-text">{event.label}</span>
                {event.seconds !== null && (
                  <span className="report-cost">−{event.seconds}s</span>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {history !== null && history.runs > 1 && (
        <p className="muted history">
          Auf diesem Gerät: {history.runs} Läufe, {history.wins} geschafft
          {history.bestMs !== null ? ` · Bestzeit ${fmt(history.bestMs)}` : ''}
          {history.bestRank !== null ? ` · bester Rang ${history.bestRank}` : ''}
        </p>
      )}

      <div className="actions">
        {view.you.isHost ? (
          <>
            <button
              className="primary"
              disabled={waiting.length > 0}
              onClick={() => send({ kind: 'rematch' })}
            >
              {waiting.length > 0
                ? `Warten auf ${waiting.map((p) => p.name).join(', ')} …`
                : '↻ Nochmal, gleiche Besetzung'}
            </button>
            <button onClick={() => send({ kind: 'back-to-lobby' })}>
              Zur Lobby (Mission oder Rollen ändern)
            </button>
          </>
        ) : (
          <>
            <button
              className={view.you.ready ? '' : 'primary'}
              onClick={() => send({ kind: 'set-ready', ready: !view.you.ready })}
            >
              {view.you.ready ? '✓ Bereit für nochmal' : 'Nochmal? Bereit melden'}
            </button>
            <p className="muted">
              {view.you.ready
                ? 'Der Host startet den nächsten Lauf.'
                : 'Melde dich bereit, dann kann der Host direkt neu starten.'}
            </p>
          </>
        )}
        <button className="link" onClick={leaveRoom}>
          Raum verlassen
        </button>
      </div>
    </div>
  );
}
