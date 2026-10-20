import { useEffect, useState } from 'react';
import {
  SEED_MAX,
  type ClientMessage,
  type MissionInfo,
  type MissionStats,
  type RoomSummary,
} from '@escapelab/core';
import { recordLine } from '../runStats.js';
import { crewSizeText } from './Crew.js';
import { HttpsHint } from './HttpsHint.js';
import { Icon } from './Icon.js';
import { InstallOffer } from './Install.js';
import { MapThumb } from './MapThumb.js';

interface Props {
  send: (msg: ClientMessage) => void;
  connected: boolean;
  missions: MissionInfo[];
  rooms: RoomSummary[];
  /** the Bestenliste's runs, by mission */
  stats: MissionStats[];
  openHandbook: (missionId: string) => void;
  openHistory: (missionId: string) => void;
}

const REFRESH_MS = 2500;

/**
 * The message that opens a room for `missionId`, or for the server's first
 * mission where none is picked. A tester pins the room to a seed with
 * `?seed=<n>` in the page's address (`search`), so that its runs repeat; a
 * value that is no whole number from 0 to SEED_MAX is left out, and the
 * lobby then shows no seed.
 */
export function createRoomMessage(
  name: string,
  missionId: string | null,
  search: string,
): ClientMessage {
  const asked = new URLSearchParams(search).get('seed') ?? '';
  const seed = /^\d{1,10}$/.test(asked) && Number(asked) <= SEED_MAX ? Number(asked) : null;
  return {
    kind: 'create-room',
    name,
    ...(missionId === null ? {} : { missionId }),
    ...(seed === null ? {} : { seed }),
  };
}

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
          <Icon name="crew" /> {room.players.length}/{room.capacity} ·{' '}
          {running && (
            <>
              <Icon name="play" /> läuft gerade ·{' '}
            </>
          )}
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
          <Icon name="eye" /> Zuschauen
        </button>
      ) : (
        <button className="primary" onClick={onJoin} disabled={!canJoin}>
          Beitreten
        </button>
      )}
    </li>
  );
}

/**
 * One mission to pick: its map, its name and one line of facts. The picked
 * one also spells out its subtitle; on the others it is the tooltip. Once
 * the mission has been played, a line says its best time and win rate.
 */
function MissionCard({
  mission,
  stats,
  selected,
  onSelect,
}: {
  mission: MissionInfo;
  stats: MissionStats | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const record = recordLine(stats?.difficulties ?? []);
  return (
    <button
      className={`mission ${selected ? 'mission-selected' : ''}`}
      aria-pressed={selected}
      title={mission.subtitle}
      onClick={onSelect}
    >
      <MapThumb tiles={mission.tiles} height={64} />
      <span className="mission-text">
        <span className="mission-title">{mission.title}</span>
        <span className="mission-meta">
          {crewSizeText(mission.players)} · {Math.round(mission.timeLimitSec / 60)} min ·{' '}
          {mission.puzzleCount} Stationen
        </span>
        {selected && <span className="mission-sub">{mission.subtitle}</span>}
        {record !== null && <span className="mission-record">{record}</span>}
      </span>
    </button>
  );
}

export function JoinScreen({
  send,
  connected,
  missions,
  rooms,
  stats,
  openHandbook,
  openHistory,
}: Props) {
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
      <h1>
        <Icon name="hex" /> EscapeLab
      </h1>
      <p className="muted">
        Kooperatives Escape-Spiel für den Browser: Die Maschine sieht, wer am Pult steht, die
        Regeln, wer am Buch steht — lösen könnt ihr es nur gemeinsam, per Stimme. Gerät pro
        Person, Rücken an Rücken, los.
      </p>
      <InstallOffer />
      <HttpsHint />

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
            <div className="mission-grid">
              {missions.map((m) => (
                <MissionCard
                  key={m.id}
                  mission={m}
                  stats={stats.find((s) => s.missionId === m.id)}
                  selected={selected === m.id}
                  onSelect={() => setMissionId(m.id)}
                />
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
                send(createRoomMessage(name.trim(), selected, window.location.search))
              }
            >
              Runde eröffnen
            </button>
            {selected !== null && (
              <button
                title="Die Regeln dieser Mission lesen und ausdrucken"
                onClick={() => openHandbook(selected)}
              >
                <Icon name="book" /> Handbuch
              </button>
            )}
            {selected !== null && (
              <button
                title="Die schnellsten Crews jeder Mission, zum Ansehen und Ausdrucken"
                onClick={() => openHistory(selected)}
              >
                <Icon name="podium" /> Bestenliste
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
            <Icon name="eye" /> Mit Code zuschauen
          </button>
        </section>
      </div>
    </div>
  );
}
