import { useState } from 'react';
import type { ClientMessage, MissionInfo } from '@escapelab/core';

interface Props {
  send: (msg: ClientMessage) => void;
  connected: boolean;
  missions: MissionInfo[];
}

export function JoinScreen({ send, connected, missions }: Props) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [missionId, setMissionId] = useState<string | null>(null);
  const nameOk = name.trim().length > 0;
  const selected = missionId ?? missions[0]?.id ?? null;

  return (
    <div className="card join">
      <h1>⬢ EscapeLab</h1>
      <p className="muted">
        Kooperatives Escape-Spiel für den Browser: Jede Rolle sieht ein anderes Panel — lösen
        könnt ihr nur gemeinsam, per Stimme. Gerät pro Person, Rücken an Rücken, los.
      </p>

      <label>
        Dein Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="z. B. Anna"
          autoFocus
        />
      </label>

      <div className="join-grid">
        <section className="join-create">
          <h2>Neue Mission</h2>
          {missions.length > 0 ? (
            <div className="mission-list">
              {missions.map((m) => (
                <button
                  key={m.id}
                  className={`mission ${selected === m.id ? 'mission-selected' : ''}`}
                  onClick={() => setMissionId(m.id)}
                >
                  <span className="mission-title">{m.title}</span>
                  <span className="mission-sub">{m.subtitle}</span>
                  <span className="mission-meta">
                    👥 {m.roles.length} Rollen · ⏱ {Math.round(m.timeLimitSec / 60)} min ·{' '}
                    {m.puzzleCount} Rätsel
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">Lade Missionen …</p>
          )}
          <button
            className="primary"
            disabled={!connected || !nameOk}
            onClick={() =>
              send(
                selected === null
                  ? { kind: 'create-room', name: name.trim() }
                  : { kind: 'create-room', name: name.trim(), missionId: selected },
              )
            }
          >
            Raum erstellen
          </button>
        </section>

        <section className="join-join">
          <h2>Oder beitreten</h2>
          <p className="muted">Jemand hat schon einen Raum? Code eingeben:</p>
          <div className="join-with-code">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={10}
              placeholder="CODE"
              aria-label="Raumcode"
            />
            <button
              disabled={!connected || !nameOk || code.trim().length === 0}
              onClick={() => send({ kind: 'join-room', code: code.trim(), name: name.trim() })}
            >
              Beitreten
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
