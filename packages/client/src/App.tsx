import { useEffect, useState } from 'react';
import { isMuted, setMuted } from './world/audio.js';
import type { MissionInfo } from '@escapelab/core';
import { useGameConnection } from './ws.js';
import { JoinScreen } from './screens/Join.js';
import { LobbyScreen } from './screens/Lobby.js';
import { GameScreen } from './screens/Game.js';
import { EndScreen } from './screens/End.js';
import { SpectateScreen } from './screens/Spectate.js';

function RoomCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      className="room-code"
      title="Raumcode kopieren"
      onClick={() => {
        navigator.clipboard
          ?.writeText(code)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      Raum: <strong>{code}</strong> {copied ? '✓ kopiert' : '⧉'}
    </button>
  );
}

export function App() {
  const conn = useGameConnection();
  const [sound, setSound] = useState(() => !isMuted());
  const [missions, setMissions] = useState<MissionInfo[]>([]);
  // A running mission takes over the whole window, for players and for the
  // audience alike — the latter matters on a projector.
  const immersive =
    (conn.view?.phase === 'playing' && conn.view.map !== null) ||
    (conn.spectatorView !== null && conn.spectatorView.map !== null);

  useEffect(() => {
    fetch('/missions')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: MissionInfo[]) => setMissions(list))
      .catch(() => setMissions([]));
  }, []);

  return (
    <div className="app">
      <div className="scanlines" aria-hidden="true" />
      <header className="topbar">
        <span className="logo">⬢ ESCAPELAB</span>
        {conn.roomCode !== null && <RoomCode code={conn.roomCode} />}
        <button
          className="sound-toggle"
          title={sound ? 'Ton ausschalten' : 'Ton einschalten'}
          aria-pressed={sound}
          onClick={() => {
            setMuted(sound);
            setSound(!sound);
          }}
        >
          {sound ? '🔊' : '🔇'}
        </button>
        <span className={`conn conn-${conn.status}`}>
          {conn.status === 'open' ? '● VERBUNDEN' : '○ VERBINDE …'}
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

      <main className={`content ${immersive ? 'content--stage' : ''}`}>{renderScreen()}</main>
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
      return (
        <JoinScreen
          send={conn.send}
          connected={conn.status === 'open'}
          missions={missions}
          rooms={conn.rooms}
        />
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
