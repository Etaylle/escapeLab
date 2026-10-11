import { useEffect } from 'react';
import type { ClientMessage, PlayerView } from '@escapelab/core';
import { play } from '../sounds.js';

interface Props {
  view: PlayerView;
  send: (msg: ClientMessage) => void;
  leaveRoom: () => void;
}

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
        </div>
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
