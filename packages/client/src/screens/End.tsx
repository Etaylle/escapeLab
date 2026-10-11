import { useEffect, useRef } from 'react';
import type { ClientMessage, PlayerView } from '@escapelab/core';
import { play } from '../sounds.js';

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

/**
 * Personal best per mission, kept in localStorage. Returns the previous best
 * (null when there was none) and whether this run beat it.
 */
function recordBest(missionId: string, usedMs: number): { prev: number | null; isNew: boolean } {
  const key = `escapelab-best-${missionId}`;
  try {
    const raw = localStorage.getItem(key);
    const prev = raw === null ? null : Number(raw);
    const valid = prev !== null && Number.isFinite(prev) ? prev : null;
    if (valid === null || usedMs < valid) {
      localStorage.setItem(key, String(usedMs));
      return { prev: valid, isNew: true };
    }
    return { prev: valid, isNew: false };
  } catch {
    // Storage blocked (private window): the run just has no saved best.
    return { prev: null, isNew: false };
  }
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

  // Recorded once per finished run; the view carries a stable finish timestamp.
  const bestRef = useRef<{ prev: number | null; isNew: boolean } | null>(null);
  if (bestRef.current === null && won && haveStats) {
    bestRef.current = recordBest(view.missionId, usedMs);
  }
  const best = bestRef.current;

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
          {best !== null && (
            <div className={`stat ${best.isNew ? 'stat-best' : ''}`}>
              <span className="stat-value">
                {fmt(best.isNew ? usedMs : (best.prev ?? usedMs))}
              </span>
              <span className="stat-label">
                {best.isNew ? '🏆 neue Bestzeit' : 'Bestzeit'}
              </span>
            </div>
          )}
        </div>
      )}

      {best !== null && best.isNew && <div className="record-banner">🏆 Neue Bestzeit!</div>}

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

      <div className="actions">
        {view.you.isHost ? (
          <button className="primary" onClick={() => send({ kind: 'back-to-lobby' })}>
            ↻ Zurück zur Lobby
          </button>
        ) : (
          <p className="muted">Der Host kann euch zurück in die Lobby bringen.</p>
        )}
        <button className="link" onClick={leaveRoom}>
          Raum verlassen
        </button>
      </div>
    </div>
  );
}
