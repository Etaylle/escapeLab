import { Activity, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isMuted, setMuted } from './world/audio.js';
import { difficultyInfos, type Difficulty, type MissionInfo } from '@escapelab/core';
import { useGameConnection } from './ws.js';
import { HandbookScreen } from './screens/Handbook.js';
import { Icon, type IconName } from './screens/Icon.js';
import { JoinScreen } from './screens/Join.js';
import { LobbyScreen } from './screens/Lobby.js';
import { GameScreen } from './screens/Game.js';
import { EndScreen } from './screens/End.js';
import { SpectateScreen } from './screens/Spectate.js';

function difficultyLabel(id: Difficulty): string {
  return difficultyInfos().find((level) => level.id === id)?.label ?? id;
}

/** How copying the invite went: not tried, done, or failed. */
type CopyState = 'idle' | 'done' | 'failed';

const COPY_SAYS: Readonly<Record<CopyState, { icon: IconName; text: string }>> = {
  idle: { icon: 'copy', text: 'Link' },
  done: { icon: 'check', text: 'Link kopiert' },
  failed: { icon: 'cross', text: 'nicht kopiert' },
};

/**
 * The room's code, the one place it stands — in the lobby too, where the
 * free places point up to it. It stays readable for saying out loud; the
 * button hands over a link that drops the other person straight into the
 * room, and says whether that worked.
 */
export function RoomCode({ code }: { code: string }) {
  const [copy, setCopy] = useState<CopyState>('idle');
  useEffect(() => {
    if (copy === 'idle') {
      return undefined;
    }
    const timer = setTimeout(() => setCopy('idle'), 1500);
    return () => clearTimeout(timer);
  }, [copy]);

  const invite = `${window.location.origin}${window.location.pathname}?room=${code}`;
  const copyLink = (): void => {
    // Without a secure origin, as on a LAN address, the browser has no clipboard.
    if (navigator.clipboard === undefined) {
      setCopy('failed');
      return;
    }
    navigator.clipboard.writeText(invite).then(
      () => setCopy('done'),
      () => setCopy('failed'),
    );
  };
  const says = COPY_SAYS[copy];
  return (
    <button className="room-code" title={`Einladungslink kopieren: ${invite}`} onClick={copyLink}>
      <span className="room-code-prefix">Raum: </span>
      <strong>{code}</strong>
      <span className="room-code-action">
        {' '}
        <Icon name={says.icon} /> {says.text}
      </span>
    </button>
  );
}

/** Which screen is up, so that each opens at its top. */
function screenOf(conn: ReturnType<typeof useGameConnection>): string {
  if (conn.spectatorView !== null) {
    return 'spectate';
  }
  return conn.view?.phase ?? 'join';
}

export function App() {
  const conn = useGameConnection();
  const [sound, setSound] = useState(() => !isMuted());
  const [missions, setMissions] = useState<MissionInfo[]>([]);
  // The handbook is a page of its own off the join screen: the mission whose
  // booklet is open, or null.
  const [handbook, setHandbook] = useState<string | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  // A running mission takes over the whole window, for players and for the
  // audience alike — the latter matters on a projector. So does the lobby,
  // the crew's room before the run.
  const immersive =
    conn.view?.phase === 'lobby' ||
    (conn.view?.phase === 'playing' && conn.view.map !== null) ||
    (conn.spectatorView !== null && conn.spectatorView.map !== null);
  // Which mission is running, for the header. The lobby already has it as its
  // headline, so naming it twice there would be noise.
  const running =
    conn.spectatorView ?? (conn.view !== null && conn.view.phase !== 'lobby' ? conn.view : null);

  useEffect(() => {
    fetch('/missions')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: MissionInfo[]) => setMissions(list))
      .catch(() => setMissions([]));
  }, []);

  // Every screen shares one scrolling area, the booklet too; each opens at its
  // top — the lobby on a phone would otherwise open where the join screen was
  // left, scrolled past the crew.
  const screen = screenOf(conn);
  useLayoutEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [handbook, screen]);

  return (
    <div className="app">
      <div className="scanlines" aria-hidden="true" />
      <header className="topbar">
        <span className="logo">
          <Icon name="hex" /> ESCAPELAB
        </span>
        {conn.roomCode !== null && <RoomCode code={conn.roomCode} />}
        {running !== null && (
          <span className="topbar-mission">
            {running.missionTitle}
            <span className="muted"> · {difficultyLabel(running.difficulty)}</span>
          </span>
        )}
        <button
          className="sound-toggle"
          title={sound ? 'Ton ausschalten' : 'Ton einschalten'}
          aria-label="Ton"
          aria-pressed={sound}
          onClick={() => {
            setMuted(sound);
            setSound(!sound);
          }}
        >
          <Icon name={sound ? 'speaker' : 'speaker-off'} />
        </button>
        <span className={`conn conn-${conn.status}`}>
          {conn.status === 'open' ? '●' : '○'}
          <span className="conn-text">{conn.status === 'open' ? ' VERBUNDEN' : ' VERBINDE …'}</span>
        </span>
      </header>

      {conn.error !== null && (
        <div className="banner error" role="alert">
          {conn.error}
          <button className="link" onClick={conn.dismissError}>
            schließen
          </button>
        </div>
      )}

      <main ref={contentRef} className={`content ${immersive ? 'content--stage' : ''}`}>
        {renderScreen()}
      </main>
    </div>
  );

  function renderScreen() {
    if (conn.spectatorView !== null) {
      return (
        <SpectateScreen
          view={conn.spectatorView}
          positionsRef={conn.positions}
          dronesRef={conn.drones}
          pingsRef={conn.pings}
          chatsRef={conn.chats}
          leaveRoom={conn.leaveRoom}
        />
      );
    }
    if (conn.view === null) {
      // The join screen stays mounted behind the booklet, so a typed name and
      // the picked mission are still there on the way back.
      return (
        <>
          <Activity mode={handbook === null ? 'visible' : 'hidden'}>
            <JoinScreen
              send={conn.send}
              connected={conn.status === 'open'}
              missions={missions}
              rooms={conn.rooms}
              openHandbook={setHandbook}
            />
          </Activity>
          {handbook !== null && (
            <HandbookScreen
              missions={missions}
              missionId={handbook}
              selectMission={setHandbook}
              back={() => setHandbook(null)}
            />
          )}
        </>
      );
    }
    switch (conn.view.phase) {
      case 'lobby':
        return (
          <LobbyScreen
            view={conn.view}
            send={conn.send}
            leaveRoom={conn.leaveRoom}
            missions={missions}
          />
        );
      case 'playing':
        return (
          <GameScreen
            view={conn.view}
            roomCode={conn.roomCode}
            positionsRef={conn.positions}
            dronesRef={conn.drones}
            pingsRef={conn.pings}
            chatsRef={conn.chats}
            send={conn.send}
          />
        );
      case 'won':
      case 'lost':
        return <EndScreen view={conn.view} send={conn.send} leaveRoom={conn.leaveRoom} />;
    }
  }
}
