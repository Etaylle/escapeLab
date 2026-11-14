import {
  Activity,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { traceRequested } from './world/frameTrace.js';
import { endThemeProbe } from './world/endTheme.js';
import { menuSoundProbe, wantMenuSound, type MenuPlace } from './world/menuSound.js';
import {
  difficultyInfos,
  type Difficulty,
  type MissionInfo,
  type MissionStats,
} from '@escapelab/core';
import { firstDifficulty, hasWon, useWonMark } from './firstRun.js';
import { useHistoryGuard } from './historyGuard.js';
import { usePad } from './input/padRuntime.js';
import {
  anyOpen,
  PauseContext,
  pausePhaseOf,
  useEscapeOpensMenu,
  useMenuLayer,
  useMenuMark,
  type MenuLayer,
} from './menuLayer.js';
import { localStore } from './notes.js';
import { crewPass, keepName, lastColor } from './pass.js';
import { addProbes } from './probes.js';
import { STATS_PATH, useJson } from './runStats.js';
import { useRunScreen } from './runScreen.js';
import { useReducedMotion } from './settings.js';
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
import { MyRunsScreen } from './screens/MyRuns.js';
import { Icon, type IconName } from './screens/Icon.js';
import { UpdateNotice } from './screens/Install.js';
import { JoinScreen } from './screens/Join.js';
import { LobbyScreen } from './screens/Lobby.js';
import { DoorWipe, useDoorWipe, type Doors, type Place } from './screens/DoorWipe.js';
import { createRoomMessage, pickedMission, usePicked } from './screens/MenuPanels.js';
import { MenuScene } from './screens/MenuScene.js';
import { GameScreen } from './screens/Game.js';
import type { GameLine } from './screens/Line.js';
import { EndScreen } from './screens/End.js';
import { MenuLayers, type RoomCrew, type RoomMission } from './screens/MenuLayers.js';
import { SettingsPanel } from './screens/Settings.js';
import { SoundSwitch } from './screens/SoundSwitch.js';
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

/**
 * How many watch the room, as a chip in the bar: the eye and the count, the word for it in its
 * label; nothing while nobody watches.
 */
export function WatchingChip({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }
  const said = `${count} Zuschauer`;
  return (
    <span className="watching-chip" role="img" aria-label={said} title={said}>
      <Icon name="eye" /> {count}
    </span>
  );
}

interface RoomChipsProps {
  code: string | null;
  seed: number | null;
  /** how many watch the room (ws.ts `watching`); nobody where it is not given */
  watching?: number | undefined;
}

/** The room's code and how many watch it, as the bar's chips; nothing off any room. */
function RoomChips({ code, seed, watching }: RoomChipsProps) {
  if (code === null) {
    return null;
  }
  return (
    <>
      <RoomCode code={code} seed={seed} />
      <WatchingChip count={watching ?? 0} />
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
  /** the gear: in a room its pause menu (`inRoom`), off any room the settings (menuLayer.ts) */
  onGear: () => void;
  /** the window stands in a room — a run, a lobby, the audience's —, whose menu the gear opens */
  inRoom?: boolean;
  /** the menu is up: its sound switch shows while the menu's sound waits for a gesture */
  menu?: boolean;
  /** how many watch the room (ws.ts `watching`): a chip beside its code */
  watching?: number;
  /** a menu stands over the screens (menuLayer.ts `anyOpen`): the bar takes nothing meanwhile */
  covered?: boolean;
}

/**
 * The bar over every screen: the room's code and seed, how many watch it, the way back to the
 * editor for the host of a test run, the running mission, the sound — the quick switch — and the
 * gear for the room's menu or the settings, and the connection.
 */
export function TopBar(props: TopBarProps) {
  const { roomCode, seed, running, status, toEditor, onGear } = props;
  const gear = props.inRoom === true ? 'Menü' : 'Einstellungen';
  return (
    <header className="topbar" inert={props.covered}>
      <span className="logo">
        <Icon name="hex" /> <span className="logo-word">ESCAPELAB</span>
      </span>
      <RoomChips code={roomCode} seed={seed} watching={props.watching} />
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
      <SoundSwitch menu={props.menu === true} />
      <button className="settings-toggle" title={gear} aria-label={gear} onClick={onGear}>
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
      conn.send(
        createRoomMessage(
          crewPass(),
          name,
          missionId,
          window.location.search,
          difficulty,
          lastColor(),
        ),
      );
    },
    back: (): void => {
      mirrorRun(sessionStore(), null);
      replacePath(EDITOR_PATH);
      conn.leaveRoom();
    },
  };
}

/**
 * The pages off the join screen and what they show: the booklet's and the Bestenliste's
 * missions, null while closed, and „Meine Einsätze", open or not.
 */
interface PageState {
  handbook: string | null;
  setHandbook: (missionId: string | null) => void;
  history: string | null;
  setHistory: (missionId: string | null) => void;
  myRuns: boolean;
  setMyRuns: (open: boolean) => void;
}

/** The pages off the join screen, each closed as the app comes up (`PageState`). */
function usePages(): PageState {
  const [handbook, setHandbook] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [myRuns, setMyRuns] = useState(false);
  return { handbook, setHandbook, history, setHistory, myRuns, setMyRuns };
}

interface ScreenProps {
  conn: Connection;
  missions: MissionInfo[];
  loadMissions: () => void;
  stats: MissionStats[];
  pages: PageState;
  editor: EditorPage;
  startTestRun: (name: string, missionId: string) => void;
  /** the end of the run on this screen: while the world plays it, the end screen waits */
  finale: Finale | null;
  /** the mission picked on the join screen; null for none yet (MenuPanels.tsx `pickedMission`) */
  picked: string | null;
  setPicked: (missionId: string) => void;
  /** opens the settings, as the gear in the top bar does */
  openSettings: () => void;
}

/** Whether a page lies over the join screen: booklet, Bestenliste, „Meine Einsätze", editor. */
function joinCovered(pages: PageState, editor: EditorPage): boolean {
  return pages.handbook !== null || pages.history !== null || pages.myRuns || editor.open;
}

/**
 * Off any room: the join screen, and over it the editor, the booklet, the
 * Bestenliste and „Meine Einsätze". The join screen stays mounted behind them,
 * so a typed name and the picked mission are still there on the way back; the
 * editor stays behind the booklet it opens.
 */
function OffRoom(props: ScreenProps) {
  const { conn, missions, pages, editor } = props;
  const { handbook, history } = pages;
  const over = joinCovered(pages, editor);
  return (
    <>
      <Activity mode={over ? 'hidden' : 'visible'}>
        <JoinScreen
          send={conn.send}
          connected={conn.status === 'open'}
          missions={missions}
          rooms={conn.rooms}
          seat={conn.seat}
          account={conn.account}
          takeover={conn.takeover}
          restoring={conn.restoring}
          giveUp={conn.giveUp}
          stats={props.stats}
          picked={props.picked}
          onPick={props.setPicked}
          openHandbook={pages.setHandbook}
          openHistory={pages.setHistory}
          openMyRuns={() => pages.setMyRuns(true)}
          openEditor={editor.show}
          openSettings={props.openSettings}
        />
      </Activity>
      {editor.open && (
        <Activity mode={handbook === null ? 'visible' : 'hidden'}>
          <EditorScreen
            missions={missions}
            reloadMissions={props.loadMissions}
            openHandbook={pages.setHandbook}
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
          selectMission={pages.setHandbook}
          back={() => pages.setHandbook(null)}
        />
      )}
      {history !== null && (
        <HistoryScreen
          missions={missions}
          missionId={history}
          selectMission={pages.setHistory}
          back={() => pages.setHistory(null)}
        />
      )}
      {pages.myRuns && (
        <MyRunsScreen
          missions={missions}
          loaded={conn.myRuns}
          ask={conn.askMyRuns}
          connected={conn.status === 'open'}
          back={() => pages.setMyRuns(false)}
        />
      )}
    </>
  );
}

/** The own line as the game screen hears of it: its card while it is down (screens/Line.tsx). */
function lineOf(conn: Connection): GameLine {
  return { status: conn.status, retry: conn.retry, wake: conn.wake, giveUp: conn.giveUp };
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
          listen={conn.listen}
          refusal={conn.refusal}
          finale={null}
          line={lineOf(conn)}
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
          listen={conn.listen}
          refusal={conn.refusal}
          finale={finale}
          line={lineOf(conn)}
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
 * Where the menu's sound is wanted (world/menuSound.ts): off any room — under the booklet and the
 * Bestenliste too — but not while the editor is open (`editorOpen`), a workshop of its own; in
 * the lobby at the lobby's weight; nowhere in a run or for the audience.
 */
export function menuPlaceOf(
  conn: Pick<Connection, 'view' | 'spectatorView'>,
  editorOpen: boolean,
): MenuPlace | null {
  const place = placeOf(conn);
  if (place === 'menu') {
    return editorOpen ? null : 'menu';
  }
  return place === 'lobby' ? 'lobby' : null;
}

/**
 * The menu's sound where it is wanted (`menuPlaceOf`), gone with a run; its probe on the page
 * under `?trace=1`, and the end card's music's beside it (world/endTheme.ts).
 */
function useMenuSound(conn: Connection, editorOpen: boolean): void {
  const where = menuPlaceOf(conn, editorOpen);
  useEffect(() => wantMenuSound(where), [where]);
  useEffect(() => {
    if (!traceRequested(location.search)) {
      return undefined;
    }
    return addProbes({
      get menuSound() {
        return menuSoundProbe();
      },
      get endTheme() {
        return endThemeProbe();
      },
    });
  }, []);
}

/** The missions on the server: fetched at the start, and again whenever `load` is called. */
function useMissions(): [MissionInfo[], () => void] {
  const [missions, setMissions] = useState<MissionInfo[]>([]);
  const load = useCallback(() => {
    fetch('/missions')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: MissionInfo[]) => setMissions(list))
      .catch(() => setMissions([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return [missions, load];
}

/** Where the window is, as the door wipe tells the screens apart (screens/DoorWipe.tsx). */
export function placeOf(conn: Pick<Connection, 'view' | 'spectatorView'>): Place {
  if (conn.spectatorView !== null) {
    return 'elsewhere';
  }
  if (conn.view === null) {
    return 'menu';
  }
  return conn.view.phase === 'lobby' ? 'lobby' : 'elsewhere';
}

/**
 * The connection as the screens draw it: between the menu and the lobby as it was before the
 * door wipe's doors began to close, until they have (screens/DoorWipe.tsx); and the doors.
 */
function useWiped(live: Connection): { conn: Connection; doors: Doors } {
  const reduced = useReducedMotion();
  const wipe = useDoorWipe(live, placeOf(live), reduced);
  return { conn: wipe.value, doors: wipe.doors };
}

/**
 * The settings over every screen, the pass's account with them: named and deleted on the line
 * `live`.
 */
function Settings({ live, close }: { live: Connection; close: () => void }) {
  return (
    <SettingsPanel
      onClose={close}
      account={live.account}
      onDeleteAccount={() => live.send({ kind: 'delete-account', pass: crewPass() })}
      onName={(name) => live.send({ kind: 'profile', pass: crewPass(), name })}
      refusal={live.refusal}
    />
  );
}

/**
 * The menus over the screens (menuLayer.ts): a room's pause menu, its booklet, the settings — by
 * the gear, a controller's Start, Esc, in a run the browser's back button too; over a run the
 * crew sees this player at the menu.
 */
function useRoomMenus(live: Connection): MenuLayer {
  const layer = useMenuLayer(pausePhaseOf(live));
  usePad(layer.start);
  useEscapeOpensMenu(layer);
  useHistoryGuard(layer.phase === 'run', layer.openPause);
  useMenuMark(live.view, layer.pause, live.send);
  return layer;
}

/** What `layer` holds open over the screens: the room's menus, the settings, on the line `live`. */
function RoomMenus(props: { layer: MenuLayer; live: Connection; missions: MissionInfo[] }) {
  const { layer, live, missions } = props;
  return (
    <MenuLayers
      layer={layer}
      mission={roomMission(live)}
      crew={roomCrew(live)}
      missions={missions}
      leaveRoom={live.leaveRoom}
      toMenu={live.toMenu}
      settings={<Settings live={live} close={layer.closeSettings} />}
    />
  );
}

/** The connection's error over every screen, until it is dismissed. */
function ErrorBanner({ conn }: { conn: Connection }) {
  if (conn.error === null) {
    return null;
  }
  return (
    <div className="banner error" role="alert">
      {conn.error}
      <button className="link" onClick={conn.dismissError}>
        schließen
      </button>
    </div>
  );
}

/** The room's mission, as its menu names it and opens its booklet: a run's, lobby's, audience's. */
export function roomMission(conn: Pick<Connection, 'view' | 'spectatorView'>): RoomMission | null {
  const view = conn.view ?? conn.spectatorView;
  return view === null ? null : { id: view.missionId, title: view.missionTitle };
}

/**
 * The room's seats as the ask before giving one up counts them: the crew's, and the fewest the
 * mission takes; null for the audience, which holds none.
 */
export function roomCrew(conn: Pick<Connection, 'view'>): RoomCrew | null {
  const view = conn.view;
  return view === null ? null : { taken: view.players.length, least: view.crewSize.min };
}

/** The living scene behind the screens, as screens/MenuScene.tsx takes it. */
export interface Backdrop {
  missionId: string | null;
  shown: boolean;
  lobby: boolean;
}

/**
 * The living scene behind the screens: off any room the lab of the mission picked (`picked`),
 * shown on the menu (`menu`) and hidden under the pages over it; in the lobby the room's, behind
 * the crew room — the same scene, so that it drifts on; none in a run or for the audience.
 */
export function backdropOf(
  conn: Pick<Connection, 'view' | 'spectatorView'>,
  menu: boolean,
  picked: string | null,
): Backdrop | null {
  if (conn.spectatorView !== null) {
    return null;
  }
  if (conn.view === null) {
    return { missionId: picked, shown: menu, lobby: false };
  }
  return conn.view.phase === 'lobby'
    ? { missionId: conn.view.missionId, shown: true, lobby: true }
    : null;
}

/**
 * What shows off any room (`offRoom`): the editor, where nothing lies over it — it fills the
 * window as a run does —, and the menu over its living scene, where no page lies over it.
 */
function offRoomOf(
  offRoom: boolean,
  pages: Pick<PageState, 'handbook' | 'history' | 'myRuns'>,
  editor: boolean,
): { editing: boolean; menu: boolean } {
  const editing = offRoom && editor && pages.handbook === null;
  const paged = pages.handbook !== null || pages.history !== null || pages.myRuns;
  return { editing, menu: offRoom && !editor && !paged };
}

/**
 * The layout of the screens' area: a stage for a room's window, the editor's, the menu's over
 * its scene (styles/menu.css), or the plain page.
 */
function layoutOf(immersive: boolean, editing: boolean, menu: boolean): string {
  if (immersive) {
    return 'content--stage';
  }
  if (editing) {
    return 'content--editor';
  }
  return menu ? 'content--menu' : '';
}

/**
 * The one scrolling area every screen shares. Under a menu (`covered`: the pause menu, the
 * settings, the booklet) it takes nothing: inert, it leaves a press, Tab and a controller to the
 * menu, and its screens hear none of the keys they listen for on the window, which inert keeps
 * from no listener (`PauseContext`). `openPause` opens the room's pause menu.
 */
export function ScreenArea(props: {
  ref: Ref<HTMLElement>;
  layout: string;
  covered: boolean;
  openPause: () => void;
  children: ReactNode;
}) {
  return (
    <main ref={props.ref} className={`content ${props.layout}`} inert={props.covered}>
      <PauseContext value={{ open: props.covered, show: props.openPause }}>
        {props.children}
      </PauseContext>
    </main>
  );
}

/**
 * The app. `boot` is what the address asked for on load: the editor at
 * /editor, with a shared mission or the draft the tab kept.
 */
export function App({ boot }: { boot: EditorBoot }) {
  const live = useGameConnection();
  // The screens draw the connection as the door wipe shows it; the rest hears it live.
  const { conn, doors } = useWiped(live);
  // The crew's voice lives as long as the page: lobby, run and end screen alike.
  const voice = useVoiceMesh(live);
  // Fetched at the start, and again whenever the editor saves or deletes a mission.
  const [missions, loadMissions] = useMissions();
  // The booklet, the Bestenliste and „Meine Einsätze": pages of their own off the join screen.
  const pages = usePages();
  // The mission picked on the join screen: its card marked, its lab in the scene behind — kept
  // in the tab, so that both come back as leaving a lobby loads the page anew.
  const [picked, setPicked] = usePicked();
  // The join screen's cards and the host's mission strip in the lobby say each
  // mission's record; without it they say nothing.
  const stats = useJson<MissionStats[]>(STATS_PATH);
  // The mission editor, another page off the join screen; the booklet opens over it.
  const editor = useEditorPage(boot);
  const testRun = useTestRun(live);
  const layer = useRoomMenus(live);
  const covered = anyOpen(layer);
  const contentRef = useRef<HTMLElement>(null);
  // How the run ended, on this screen: the world plays it before the end screen opens.
  const finale = useFinale(live.view ?? live.spectatorView);
  // A run won on this device ends its first-run default (firstRun.ts).
  useWonMark(live.view?.phase ?? null);
  const immersive = useStage(conn, finale);
  // Which mission is running, for the header. The lobby already has it as its
  // headline, so naming it twice there would be noise.
  const running =
    conn.spectatorView ?? (conn.view !== null && conn.view.phase !== 'lobby' ? conn.view : null);
  // A tester sees in the lobby that the room is pinned to a seed (?seed=).
  const pinnedTo = conn.view?.phase === 'lobby' ? (conn.view.seed?.room ?? null) : null;
  const fromEditor = returnsToEditor(testRun.run, conn.roomCode, conn.view?.you.isHost === true);

  const offRoom = conn.view === null && conn.spectatorView === null;
  useMenuSound(conn, editor.open);
  // The editor scrolls on a phone (styles/editor.css); the menu lies over its living scene.
  const { editing, menu } = offRoomOf(offRoom, pages, editor.open);
  const layout = layoutOf(immersive, editing, menu);
  const backdrop = backdropOf(conn, menu, pickedMission(missions, picked));
  useEffect(() => keepPath(editing), [editing]);

  // Every screen shares one scrolling area, the booklet too; each opens at its
  // top — the lobby on a phone would otherwise open where the join screen was
  // left, scrolled past the crew.
  const screen = screenOf(conn);
  useLayoutEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [pages.handbook, pages.history, pages.myRuns, editor.open, screen]);

  return (
    <div className="app">
      <div className="scanlines" aria-hidden="true" />
      <DoorWipe doors={doors} />
      <TopBar
        roomCode={conn.roomCode}
        seed={pinnedTo}
        running={running}
        status={conn.status}
        toEditor={fromEditor ? testRun.back : null}
        onGear={layer.gear}
        inRoom={layer.phase !== null}
        menu={menu}
        watching={conn.watching}
        covered={covered}
      />
      <RoomMenus layer={layer} live={live} missions={missions} />
      <ErrorBanner conn={live} />
      <UpdateNotice />

      <ScreenArea ref={contentRef} layout={layout} covered={covered} openPause={layer.openPause}>
        {backdrop !== null && <MenuScene {...backdrop} />}
        <VoiceContext value={voice}>
          <Screens
            conn={conn}
            missions={missions}
            loadMissions={loadMissions}
            stats={stats.status === 'ready' ? stats.value : []}
            pages={pages}
            editor={editor}
            startTestRun={testRun.start}
            finale={finale}
            picked={picked}
            setPicked={setPicked}
            openSettings={layer.openSettings}
          />
        </VoiceContext>
      </ScreenArea>
    </div>
  );
}
