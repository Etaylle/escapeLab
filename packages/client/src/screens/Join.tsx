import { useEffect, useState } from 'react';
import type { ClientMessage, MissionInfo, RoomSummary } from '@escapelab/core';
import { MapThumb } from './MapThumb.js';

interface Props {
  send: (msg: ClientMessage) => void;
  connected: boolean;
  missions: MissionInfo[];
  rooms: RoomSummary[];
  openHandbook: (missionId: string) => void;
}

const REFRESH_MS = 2500;

/** One open or running room in the browser. */
function RoomRow({
  room,
  tiles,
  canJoin,
  onJoin,
  onWatch,
}: {
  room: RoomSummary;
  tiles: string[];
  canJoin: boolean;
  onJoin: () => void;
  onWatch: () => void;
}) {
  const running = room.phase !== 'lobby';
  return (
    <li className={`room ${running ? 'room-running' : ''}`}>
      <MapThumb tiles={tiles} height={48} />
      <div className="room-main">
        <span className="room-title">{room.missionTitle}</span>
        <span className="room-meta">
          {running ? '▶ läuft gerade' : `${room.free} von ${room.capacity} Plätzen frei`} ·{' '}
          {room.difficulty} · Code {room.code}
        </span>
        <span className="room-crew">
          {room.players.map((p) => (
            <span key={p.name} className={p.connected ? '' : 'offline'}>
              <span className="crew-dot" style={{ background: p.color }} aria-hidden="true" />
              {p.name}
            </span>
          ))}
          {room.players.length === 0 && <span className="muted">noch niemand da</span>}
        </span>
      </div>
      {running || room.free === 0 ? (
        <button onClick={onWatch} disabled={!running}>
          👁 Zuschauen
        </button>
      ) : (
        <button className="primary" onClick={onJoin} disabled={!canJoin}>
          Beitreten
        </button>
      )}
    </li>
  );
}

export function JoinScreen({ send, connected, missions, rooms, openHandbook }: Props) {
  const [name, setName] = useState('');
  // An invite link carries the room in ?room=, so the code field is already
  // filled and all that is left to do is type a name.
  const [code, setCode] = useState(
    () => new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '',
  );
  const [missionId, setMissionId] = useState<string | null>(null);
  const nameOk = name.trim().length > 0;
  const selected = missionId ?? missions[0]?.id ?? null;

  // Keep the room browser fresh while nobody has joined anything yet.
  useEffect(() => {
    if (!connected) {
      return undefined;
    }
    send({ kind: 'list-rooms' });
    const timer = setInterval(() => send({ kind: 'list-rooms' }), REFRESH_MS);
    return () => clearInterval(timer);
    // `send` is stable for the lifetime of the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  return (
    <div className="card join">
      <h1>⬢ EscapeLab</h1>
      <p className="muted">
        Kooperatives Escape-Spiel für den Browser: Die Maschine sieht, wer am Pult steht, die
        Regeln, wer am Buch steht — lösen könnt ihr es nur gemeinsam, per Stimme. Gerät pro
        Person, Rücken an Rücken, los.
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

      <h2>Offene Runden</h2>
      {rooms.length === 0 ? (
        <p className="muted">
          Gerade läuft nichts — eröffne unten die erste Runde, dann taucht sie hier für alle auf.
        </p>
      ) : (
        <ul className="rooms">
          {rooms.map((room) => (
            <RoomRow
              key={room.code}
              room={room}
              tiles={missions.find((m) => m.id === room.missionId)?.tiles ?? []}
              canJoin={connected && nameOk}
              onJoin={() => send({ kind: 'join-room', code: room.code, name: name.trim() })}
              onWatch={() => send({ kind: 'spectate', code: room.code })}
            />
          ))}
        </ul>
      )}
      {rooms.length > 0 && !nameOk && (
        <p className="muted">Trag oben deinen Namen ein, dann kannst du beitreten.</p>
      )}

      <div className="join-grid">
        <section className="join-create">
          <h2>Neue Runde eröffnen</h2>
          {missions.length > 0 ? (
            <div className="mission-list">
              {missions.map((m) => (
                <button
                  key={m.id}
                  className={`mission ${selected === m.id ? 'mission-selected' : ''}`}
                  onClick={() => setMissionId(m.id)}
                >
                  <MapThumb tiles={m.tiles} height={44} />
                  <span className="mission-title">{m.title}</span>
                  <span className="mission-sub">{m.subtitle}</span>
                  <span className="mission-meta">
                    👥 {m.players.min}–{m.players.max} Spieler · ⏱{' '}
                    {Math.round(m.timeLimitSec / 60)} min ·{' '}
                    {m.puzzleCount} Rätsel
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">Lade Missionen …</p>
          )}
          <div className="join-create-actions">
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
              Runde eröffnen
            </button>
            {selected !== null && (
              <button
                title="Die Regeln dieser Mission lesen und ausdrucken"
                onClick={() => openHandbook(selected)}
              >
                📖 Handbuch
              </button>
            )}
          </div>
        </section>

        <section className="join-join">
          <h2>Mit Code</h2>
          <p className="muted">Wenn ihr euch direkt verabredet habt:</p>
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
          <button
            className="link"
            disabled={!connected || code.trim().length === 0}
            onClick={() => send({ kind: 'spectate', code: code.trim() })}
          >
            👁 Mit Code zuschauen
          </button>
        </section>
      </div>
    </div>
  );
}
