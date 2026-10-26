import { useEffect, useState } from 'react';
import {
  SEED_MAX,
  type ClientMessage,
  type Difficulty,
  type MissionInfo,
  type MissionStats,
  type RoomSummary,
} from '@escapelab/core';
import { FIRST_RUN_HINT, firstDifficulty, isTutorial, useWon } from '../firstRun.js';
import { localStore } from '../notes.js';
import { recordLine } from '../runStats.js';
import { crewSizeText } from './Crew.js';
import { HttpsHint } from './HttpsHint.js';
import { Icon } from './Icon.js';
import { InstallOffer } from './Install.js';
import { MapThumb } from './MapThumb.js';
import { phosphorClass, useComesOn } from './phosphor.js';

interface Props {
  send: (msg: ClientMessage) => void;
  connected: boolean;
  missions: MissionInfo[];
  rooms: RoomSummary[];
  /** the Bestenliste's runs, by mission */
  stats: MissionStats[];
  openHandbook: (missionId: string) => void;
  openHistory: (missionId: string) => void;
  /** opens the mission editor; without it the join screen offers none */
  openEditor?: () => void;
}

const REFRESH_MS = 2500;

/** Where the browser keeps the name last typed on the join screen. */
const NAME_KEY = 'escapelab-name';

/**
 * The name last typed on the join screen, kept by the browser: the join
 * screen and the editor's test run start with it. '' where there is none.
 */
export function lastName(): string {
  try {
    return localStore()?.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Keeps the name for next time; nothing is kept where the browser refuses. */
export function keepName(name: string): void {
  try {
    const store = localStore();
    if (name.trim() === '') {
      store?.removeItem(NAME_KEY);
    } else {
      store?.setItem(NAME_KEY, name);
    }
  } catch (err) {
    console.warn(`[escapelab] the name is not kept: ${String(err)}`);
  }
}

/** The name field's text, starting with the name kept last and kept again as it is typed. */
function useKeptName(): [string, (name: string) => void] {
  const [name, setName] = useState(lastName);
  const type = (next: string): void => {
    setName(next);
    keepName(next);
  };
  return [name, type];
}

/**
 * The message that opens a room for `missionId`, or for the server's first
 * mission where none is picked, on `difficulty` where one is given — a first
 * run's „entspannt" (firstRun.ts) — and on normal where not. A tester pins the
 * room to a seed with `?seed=<n>` in the page's address (`search`), so that
 * its runs repeat; a value that is no whole number from 0 to SEED_MAX is left
 * out, and the lobby then shows no seed.
 */
export function createRoomMessage(
  name: string,
  missionId: string | null,
  search: string,
  difficulty: Difficulty | null = null,
): ClientMessage {
  const asked = new URLSearchParams(search).get('seed') ?? '';
  const seed = /^\d{1,10}$/.test(asked) && Number(asked) <= SEED_MAX ? Number(asked) : null;
  return {
    kind: 'create-room',
    name,
    ...(missionId === null ? {} : { missionId }),
    ...(seed === null ? {} : { seed }),
    ...(difficulty === null ? {} : { difficulty }),
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
 * the mission has been played, a line says its best time and win rate. The
 * tutorial's card carries a label stuck on its edge while this device has
 * seen no run won (`first`): „Erster Einsatz? Hier starten".
 */
export function MissionCard({
  mission,
  stats,
  selected,
  first = false,
  onSelect,
}: {
  mission: MissionInfo;
  stats: MissionStats | undefined;
  selected: boolean;
  first?: boolean;
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
      {first && <span className="mission-first">{FIRST_RUN_HINT}</span>}
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

/** The row the older maps wait behind on the join screen. */
export const PROTOTYPES_ROW = 'Prototypen (ältere Karten)';

/** Whether a mission is an older map kept on (`Mission['stage']`). */
function isPrototype(mission: Pick<MissionInfo, 'stage'>): boolean {
  return mission.stage === 'prototype';
}

/**
 * The older maps kept on, behind a row of their own after the mission cards, collapsed: one
 * muted line each — its name and its facts — the picked one marked. Nothing without any.
 */
export function Prototypes({
  missions,
  selected,
  onSelect,
}: {
  missions: MissionInfo[];
  selected: string | null;
  onSelect: (missionId: string) => void;
}) {
  if (missions.length === 0) {
    return null;
  }
  return (
    <details className="mission-prototypes">
      <summary>{PROTOTYPES_ROW}</summary>
      <ul>
        {missions.map((m) => {
          const picked = m.id === selected;
          return (
            <li key={m.id}>
              <button
                className={picked ? 'mission-proto mission-proto-selected' : 'mission-proto'}
                aria-pressed={picked}
                title={m.subtitle}
                onClick={() => onSelect(m.id)}
              >
                <span className="mission-proto-title">{m.title}</span> ·{' '}
                {crewSizeText(m.players)} · {Math.round(m.timeLimitSec / 60)} min ·{' '}
                {m.puzzleCount} Stationen
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** What the two sections under the room list need of the join screen. */
interface SectionProps {
  send: Props['send'];
  connected: boolean;
  /** the name as typed, trimmed: nothing goes out under an empty one */
  name: string;
}

/**
 * „Neue Runde eröffnen": every current mission as a card — the tutorial's pointing a first
 * crew at it — the prototypes in a collapsed row after them, the button that opens a room for
 * the picked one (the first card until another is picked), on the first-run difficulty where
 * this device has won no run yet (firstRun.ts), and the ways to its booklet, its Bestenliste
 * and the editor.
 */
function NewRound({
  send,
  connected,
  name,
  missions,
  stats,
  openHandbook,
  openHistory,
  openEditor,
}: SectionProps &
  Pick<Props, 'missions' | 'stats' | 'openHandbook' | 'openHistory' | 'openEditor'>) {
  const [missionId, setMissionId] = useState<string | null>(null);
  const won = useWon();
  const current = missions.filter((m) => !isPrototype(m));
  const selected = missionId ?? current[0]?.id ?? missions[0]?.id ?? null;
  const open = (): void =>
    send(createRoomMessage(name, selected, window.location.search, firstDifficulty(won)));
  return (
    <section className="join-create">
      <h2>Neue Runde eröffnen</h2>
      {missions.length > 0 ? (
        <>
          <div className="mission-grid">
            {current.map((m) => (
              <MissionCard
                key={m.id}
                mission={m}
                stats={stats.find((s) => s.missionId === m.id)}
                selected={selected === m.id}
                first={!won && isTutorial(m)}
                onSelect={() => setMissionId(m.id)}
              />
            ))}
          </div>
          <Prototypes
            missions={missions.filter(isPrototype)}
            selected={selected}
            onSelect={setMissionId}
          />
        </>
      ) : (
        <p className="muted">Lade Missionen …</p>
      )}
      <div className="join-create-actions">
        <button className="primary" disabled={!connected || name === ''} onClick={open}>
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
        {openEditor !== undefined && (
          <button
            title="Eine eigene Mission bauen oder eine vorhandene abwandeln"
            onClick={openEditor}
          >
            <Icon name="pencil" /> Editor
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * „Mit Code": a room's code to join or watch it by. An invite link carries the room in
 * ?room=, so the field is already filled and all that is left to do is type a name.
 */
function WithCode({ send, connected, name }: SectionProps) {
  const [code, setCode] = useState(
    () => new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '',
  );
  return (
    <section className="join-join">
      <h2>Mit Code</h2>
      <p className="muted">Für eine verabredete Runde:</p>
      <div className="join-with-code">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={10}
          placeholder="CODE"
          aria-label="Raumcode"
        />
        <button
          disabled={!connected || name === '' || code.trim().length === 0}
          onClick={() => send({ kind: 'join-room', code: code.trim(), name })}
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
  openEditor,
}: Props) {
  const [name, setName] = useKeptName();
  const nameOk = name.trim().length > 0;
  const comesOn = useComesOn('start');

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

  const section = { send, connected, name: name.trim() };
  return (
    <div className="card join">
      <h1 className={phosphorClass(comesOn)}>
        <Icon name="hex" /> EscapeLab
      </h1>
      <p className="muted">
        Kooperatives Escape-Spiel für den Browser: Die Maschine sieht, wer am Pult steht, die
        Regeln, wer am Buch steht — lösen lässt es sich nur gemeinsam, per Stimme. Gerät pro
        Person, Rücken an Rücken, los.
      </p>
      <InstallOffer />
      <HttpsHint />

      <label>
        Name
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
          Gerade läuft nichts — eine Runde, die unten eröffnet wird, taucht hier für alle auf.
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
        <p className="muted">Zum Beitreten oben einen Namen eintragen.</p>
      )}

      <div className="join-grid">
        <NewRound
          {...section}
          missions={missions}
          stats={stats}
          openHandbook={openHandbook}
          openHistory={openHistory}
          {...(openEditor === undefined ? {} : { openEditor })}
        />
        <WithCode {...section} />
      </div>
    </div>
  );
}
