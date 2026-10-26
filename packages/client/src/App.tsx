import { Activity, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isMuted, setMuted } from './world/audio.js';
import {
  difficultyInfos,
  type Difficulty,
  type MissionInfo,
  type MissionStats,
} from '@escapelab/core';
import { firstDifficulty, hasWon, useWonMark } from './firstRun.js';
import { localStore } from './notes.js';
import { STATS_PATH, useJson } from './runStats.js';
import { useRunScreen } from './runScreen.js';
import { useVoiceMesh, VoiceContext } from './voice/useVoice.js';
import { useGameConnection, type Connection } from './ws.js';
import { useFinale, type Finale } from './world/finale.js';
import { EditorScreen } from './editor/EditorScreen.js';
import {
  mirrorRun,
  mirrorWork,
  returnsToEditor,
  sessionStore,
  storedRun,
  type EditorBoot,
  type TestRun,
} from './editor/session.js';
import { EDITOR_PATH, sharedIn } from './editor/share.js';
import { HandbookScreen } from './screens/Handbook.js';
import { HistoryScreen } from './screens/History.js';
import { Icon, type IconName } from './screens/Icon.js';
import { UpdateNotice } from './screens/Install.js';
import { createRoomMessage, JoinScreen, keepName } from './screens/Join.js';
import { LobbyScreen } from './screens/Lobby.js';
import { GameScreen } from './screens/Game.js';
import { EndScreen } from './screens/End.js';
import { SettingsPanel } from './screens/Settings.js';
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
 * room, and says whether that worked. Beside it, muted, the seed a tester
 * pinned the room to, where one is given.
 */
export function RoomCode({ code, seed = null }: { code: string; seed?: number | null }) {
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
    <>
      <button className="room-code" title={`Einladungslink kopieren: ${invite}`} onClick={copyLink}>
        <span className="room-code-prefix">Raum: </span>
        <strong>{code}</strong>
        <span className="room-code-action">
          {' '}
          <Icon name={says.icon} /> {says.text}
        </span>
      </button>
      {seed !== null && <span className="muted room-seed">Seed {seed}</span>}
    </>
  );
}

interface TopBarProps {
  roomCode: string | null;
  /** the seed a tester pinned the room to, shown in the lobby */
  seed: number | null;
  /** the mission that is running, named in the bar; null where the screen names it itself */
  running: { missionTitle: string; difficulty: Difficulty } | null;
  status: Connection['status'];
  /** leaves the room for the editor, where it came from the editor's test run; else null */
  toEditor: (() => void) | null;
  /** opens the settings (screens/Settings.tsx) */
  onSettings: () => void;
}

/**
 * The bar over every screen: the room's code and seed, the way back to the
 * editor for the host of a test run, the running mission, the sound — the
 * quick switch — and the gear for the settings, and the connection.
 */
export function TopBar({ roomCode, seed, running, status, toEditor, onSettings }: TopBarProps) {
  const [sound, setSound] = useState(() => !isMuted());
  return (
    <header className="topbar">
      <span className="logo">
        <Icon name="hex" /> ESCAPELAB
      </span>
      {roomCode !== null && <RoomCode code={roomCode} seed={seed} />}
      {toEditor !== null && (
        <button className="topbar-editor" aria-label="Zurück zum Editor" onClick={toEditor}>
          <span className="topbar-editor-way">Zurück zum </span>Editor
        </button>
      )}
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
      <button
        className="settings-toggle"
        title="Einstellungen"
        aria-label="Einstellungen"
        onClick={onSettings}
      >
        <Icon name="gear" />
      </button>
      <span className={`conn conn-${status}`}>
        {status === 'open' ? '●' : '○'}
        <span className="conn-text">{status === 'open' ? ' VERBUNDEN' : ' VERBINDE …'}</span>
      </span>
    </header>
  );
}

/** Which screen is up, so that each opens at its top. */
function screenOf(conn: ReturnType<typeof useGameConnection>): string {
  if (conn.spectatorView !== null) {
    return 'spectate';
  }
  return conn.view?.phase ?? 'join';
}

/** The address with another path, its query and any fragment but a shared mission's kept. */
function replacePath(path: string): void {
  const { search, hash } = window.location;
  const kept = sharedIn(hash) === null ? hash : '';
  window.history.replaceState(window.history.state, '', `${path}${search}${kept}`);
}

/**
 * The address follows the editor: its path while the editor is on screen,
 * so that a reload comes back to it, the plain one everywhere else, so that
 * an invite link never points into the editor. A shared mission's fragment
 * goes once the page has read it.
 */
function keepPath(editing: boolean): void {
  const path = editing ? EDITOR_PATH : '/';
  if (window.location.pathname !== path || sharedIn(window.location.hash) !== null) {
    replacePath(path);
  }
}

/** The editor's page: whether it is open, its work (kept in the tab too), its first word. */
function useEditorPage(boot: EditorBoot) {
  const [open, setOpen] = useState(boot.open);
  const [work, setWork] = useState(boot.work);
  const [greeting, setGreeting] = useState(boot.status);
  useEffect(() => mirrorWork(sessionStore(), work), [work]);
  return {
    open,
    work,
    setWork,
    greeting,
    show: (): void => setOpen(true),
    close: (): void => {
      setOpen(false);
      setGreeting(null);
    },
  };
}

type EditorPage = ReturnType<typeof useEditorPage>;

/**
 * A test run of the editor's mission: the room this tab opens for it is
 * remembered by its code once the server names it — in the tab as well, so
 * a reload in the lobby keeps it — and its host gets the way back to the
 * editor, which leaves the room as „Raum verlassen" does and reloads on
 * the editor's path. Where the room does not open, nothing is remembered.
 */
function useTestRun(conn: Connection) {
  const [run, setRun] = useState<TestRun | null>(() => storedRun(sessionStore()));
  useEffect(() => mirrorRun(sessionStore(), run), [run]);
  const { listen } = conn;
  useEffect(
    () =>
      listen({
        message: (msg) => {
          if (msg.kind === 'joined') {
            setRun((r) => (r !== null && r.code === null ? { code: msg.code } : r));
          } else if (msg.kind === 'error') {
            setRun((r) => (r !== null && r.code === null ? null : r));
          }
        },
        closed: () => undefined,
      }),
    [listen],
  );
  return {
    run,
    start: (name: string, missionId: string): void => {
      keepName(name);
      setRun({ code: null });
      // The lobby's invite link is made from the address: the plain one, not the editor's.
      replacePath('/');
      const difficulty = firstDifficulty(hasWon(localStore()));
      conn.send(createRoomMessage(name, missionId, window.location.search, difficulty));
    },
    back: (): void => {
      mirrorRun(sessionStore(), null);
      replacePath(EDITOR_PATH);
      conn.leaveRoom();
    },
  };
}

interface ScreenProps {
  conn: Connection;
  missions: MissionInfo[];
  loadMissions: () => void;
  stats: MissionStats[];
  handbook: string | null;
  setHandbook: (missionId: string | null) => void;
  history: string | null;
  setHistory: (missionId: string | null) => void;
  editor: EditorPage;
  startTestRun: (name: string, missionId: string) => void;
  /** the end of the run on this screen: while the world plays it, the end screen waits */
  finale: Finale | null;
}

/**
 * Off any room: the join screen, and over it the editor, the booklet and the
 * Bestenliste. The join screen stays mounted behind them, so a typed name
 * and the picked mission are still there on the way back; the editor stays
 * behind the booklet it opens.
 */
function OffRoom(props: ScreenProps) {
  const { conn, missions, handbook, history, editor } = props;
  return (
    <>
      <Activity mode={handbook === null && history === null && !editor.open ? 'visible' : 'hidden'}>
        <JoinScreen
          send={conn.send}
          connected={conn.status === 'open'}
          missions={missions}
          rooms={conn.rooms}
          stats={props.stats}
          openHandbook={props.setHandbook}
          openHistory={props.setHistory}
          openEditor={editor.show}
        />
      </Activity>
      {editor.open && (
        <Activity mode={handbook === null ? 'visible' : 'hidden'}>
          <EditorScreen
            missions={missions}
            reloadMissions={props.loadMissions}
            openHandbook={props.setHandbook}
            back={editor.close}
            work={editor.work}
            onWork={editor.setWork}
            greeting={editor.greeting}
            connected={conn.status === 'open'}
            startTestRun={props.startTestRun}
          />
        </Activity>
      )}
      {handbook !== null && (
        <HandbookScreen
          missions={missions}
          missionId={handbook}
          selectMission={props.setHandbook}
          back={() => props.setHandbook(null)}
        />
      )}
      {history !== null && (
        <HistoryScreen
          missions={missions}
          missionId={history}
          selectMission={props.setHistory}
          back={() => props.setHistory(null)}
        />
      )}
    </>
  );
}

/**
 * The screen for where this connection is: watching, off any room, or in one
 * by its phase. A run that is over stays on the game screen while the world
 * plays its end (world/finale.ts) — the same screen, so that the world goes on
 * — and opens the end screen after.
 */
function Screens(props: ScreenProps) {
  const { conn, finale } = props;
  if (conn.spectatorView !== null) {
    return (
      <SpectateScreen
        view={conn.spectatorView}
        finale={finale}
        positionsRef={conn.positions}
        dronesRef={conn.drones}
        pingsRef={conn.pings}
        chatsRef={conn.chats}
        leaveRoom={conn.leaveRoom}
      />
    );
  }
  if (conn.view === null) {
    return <OffRoom {...props} />;
  }
  switch (conn.view.phase) {
    case 'lobby':
      return (
        <LobbyScreen
          view={conn.view}
          send={conn.send}
          leaveRoom={conn.leaveRoom}
          missions={props.missions}
          stats={props.stats}
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
          refusals={conn.refusals}
          finale={null}
        />
      );
    case 'won':
    case 'lost':
      return finale?.running === true && finale.map !== null ? (
        <GameScreen
          view={{ ...conn.view, map: finale.map }}
          roomCode={conn.roomCode}
          positionsRef={conn.positions}
          dronesRef={conn.drones}
          pingsRef={conn.pings}
          chatsRef={conn.chats}
          send={conn.send}
          refusals={conn.refusals}
          finale={finale}
        />
      ) : (
        <EndScreen
          view={conn.view}
          fresh={finale?.played === true}
          send={conn.send}
          leaveRoom={conn.leaveRoom}
          missions={props.missions}
        />
      );
  }
}

/**
 * Whether the window belongs to the room: a running mission — its end still
 * playing in the world included — takes it over, for players and for the
 * audience alike (the latter matters on a projector), and so does the lobby,
 * the crew's room before the run. A player in a run, or watching its end, is
 * on a phone fullscreen, sideways and awake.
 */
function useStage(conn: Connection, finale: Finale | null): boolean {
  const ending = finale?.running === true && finale.map !== null;
  const playing =
    (conn.view?.phase === 'playing' && conn.view.map !== null) || (conn.view !== null && ending);
  useRunScreen(playing);
  return (
    conn.view?.phase === 'lobby' ||
    playing ||
    (conn.spectatorView !== null && (conn.spectatorView.map !== null || ending))
  );
}

/**
 * The app. `boot` is what the address asked for on load: the editor at
 * /editor, with a shared mission or the draft the tab kept.
 */
export function App({ boot }: { boot: EditorBoot }) {
  const conn = useGameConnection();
  // The crew's voice lives as long as the page: lobby, run and end screen alike.
  const voice = useVoiceMesh(conn);
  const [missions, setMissions] = useState<MissionInfo[]>([]);
  // The handbook is a page of its own off the join screen: the mission whose
  // booklet is open, or null.
  const [handbook, setHandbook] = useState<string | null>(null);
  // So is the Bestenliste: the mission whose tab is open, or null.
  const [history, setHistory] = useState<string | null>(null);
  // The join screen's cards and the host's mission strip in the lobby say each
  // mission's record; without it they say nothing.
  const stats = useJson<MissionStats[]>(STATS_PATH);
  // The mission editor, another page off the join screen; the booklet opens over it.
  const editor = useEditorPage(boot);
  const testRun = useTestRun(conn);
  // The settings, over whatever screen is up; nothing under them pauses.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  // How the run ended, on this screen: the world plays it before the end screen opens.
  const finale = useFinale(conn.view ?? conn.spectatorView);
  // A run won on this device ends its first-run default (firstRun.ts).
  useWonMark(conn.view?.phase ?? null);
  const immersive = useStage(conn, finale);
  // Which mission is running, for the header. The lobby already has it as its
  // headline, so naming it twice there would be noise.
  const running =
    conn.spectatorView ?? (conn.view !== null && conn.view.phase !== 'lobby' ? conn.view : null);
  // A tester sees in the lobby that the room is pinned to a seed (?seed=).
  const pinnedTo = conn.view?.phase === 'lobby' ? (conn.view.seed?.room ?? null) : null;
  const fromEditor = returnsToEditor(testRun.run, conn.roomCode, conn.view?.you.isHost === true);

  // Fetched at the start, and again whenever the editor saves or deletes a mission.
  const loadMissions = useCallback(() => {
    fetch('/missions')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: MissionInfo[]) => setMissions(list))
      .catch(() => setMissions([]));
  }, []);
  useEffect(() => {
    loadMissions();
  }, [loadMissions]);
  // The editor fills the window as a run does, but it scrolls on a phone (styles/editor.css).
  const editing =
    editor.open && handbook === null && conn.view === null && conn.spectatorView === null;
  const layout = immersive ? 'content--stage' : editing ? 'content--editor' : '';
  useEffect(() => keepPath(editing), [editing]);

  // Every screen shares one scrolling area, the booklet too; each opens at its
  // top — the lobby on a phone would otherwise open where the join screen was
  // left, scrolled past the crew.
  const screen = screenOf(conn);
  useLayoutEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [handbook, history, editor.open, screen]);

  return (
    <div className="app">
      <div className="scanlines" aria-hidden="true" />
      <TopBar
        roomCode={conn.roomCode}
        seed={pinnedTo}
        running={running}
        status={conn.status}
        toEditor={fromEditor ? testRun.back : null}
        onSettings={() => setSettingsOpen(true)}
      />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {conn.error !== null && (
        <div className="banner error" role="alert">
          {conn.error}
          <button className="link" onClick={conn.dismissError}>
            schließen
          </button>
        </div>
      )}
      <UpdateNotice />

      <main ref={contentRef} className={`content ${layout}`}>
        <VoiceContext value={voice}>
          <Screens
            conn={conn}
            missions={missions}
            loadMissions={loadMissions}
            stats={stats.status === 'ready' ? stats.value : []}
            handbook={handbook}
            setHandbook={setHandbook}
            history={history}
            setHistory={setHistory}
            editor={editor}
            startTestRun={testRun.start}
            finale={finale}
          />
        </VoiceContext>
      </main>
    </div>
  );
}
