import { useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  DronePosition,
  ManualHere,
  MapView,
  PlayerView,
  PuzzleView,
} from '@escapelab/core';
import { useKeys, useNow } from '../hooks.js';
import { airIcon, bannerFrom, noticeMs, radioNews, withNews, type Notice } from '../radio.js';
import { RelayConsole } from '../puzzles/RelayPanel.js';
import { play } from '../sounds.js';
import { radioChirp } from '../world/audio.js';
import { opensLit, REVEAL_MS, useDarkSince, useRevealed } from '../world/coldOpen.js';
import { consoleName } from '../world/consoles.js';
import { GameWorld, type ChatLine, type MapPing } from '../world/GameWorld.js';
import { toBring } from '../world/markers.js';
import type { KnownPositions } from '../world/movement.js';
import { startRoom } from '../world/rooms.js';
import { PuzzlePanel } from './PuzzlePanel.js';
import { Icon } from './Icon.js';
import { MissionHud } from './MissionHud.js';
import { InfoPanel } from './InfoPanel.js';
import { Manual } from './Manual.js';
import { Notepad, useNotes } from './Notepad.js';
import { ReadingOverlay } from './Reading.js';
import { WorldModal } from './WorldModal.js';

interface Props {
  view: PlayerView;
  /** the room this run plays in; the notepad is kept under it */
  roomCode: string | null;
  positionsRef: React.MutableRefObject<KnownPositions>;
  dronesRef: React.MutableRefObject<Record<string, DronePosition>>;
  pingsRef: React.MutableRefObject<MapPing[]>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  send: (msg: ClientMessage) => void;
}

function formatRemaining(deadlineAt: number, now: number): string {
  const totalSec = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Full-width emergency banner: what broke, where to go, how long you have. */
function SabotageAlert({ sabotage }: { sabotage: NonNullable<PlayerView['map']>['sabotage'] }) {
  const now = useNow(200);
  if (sabotage === null) {
    return null;
  }
  const left = Math.max(0, Math.ceil((sabotage.endsAt - now) / 1000));
  const manned = sabotage.panels.filter((p) => p.occupied).length;
  return (
    <div className="sabotage" role="alert">
      <div className="sabotage-head">
        <span className="sabotage-label">
          <Icon name="siren" /> {sabotage.label}
        </span>
        <span className="sabotage-clock">{left}s</span>
      </div>
      <p className="sabotage-hint">{sabotage.hint}</p>
      <div className="sabotage-panels">
        {sabotage.panels.map((panel) => (
          <span key={panel.id} className={`panel-pip ${panel.occupied ? 'panel-pip-on' : ''}`}>
            {panel.occupied ? '✓' : '○'}
          </span>
        ))}
        <span className="muted">
          {manned}/{sabotage.panels.length} besetzt
        </span>
      </div>
    </div>
  );
}

type Sabotage = NonNullable<NonNullable<PlayerView['map']>['sabotage']>;

/**
 * Relay mode: no valves to run to — the player's console stays in front of
 * everything until the emergency is over, the instruction to read out on top.
 * It takes the keys: focus moves in, and what is pressed there reaches
 * neither the world nor the screen's shortcuts.
 */
function RelayAlert({
  sabotage,
  relay,
  send,
}: {
  sabotage: Sabotage;
  relay: NonNullable<Sabotage['relay']>;
  send: (msg: ClientMessage) => void;
}) {
  const now = useNow(200);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    frame.current?.focus();
  }, []);
  const left = Math.max(0, Math.ceil((sabotage.endsAt - now) / 1000));
  return (
    <div
      ref={frame}
      className="puzzle-modal relay-modal"
      role="alertdialog"
      aria-modal="true"
      aria-label={sabotage.label}
      tabIndex={-1}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="panel">
        <div className="sabotage-head">
          <span className="sabotage-label">
            <Icon name="siren" /> {sabotage.label}
          </span>
          <span className="sabotage-clock">{left}s</span>
        </div>
        {sabotage.hint !== '' && <p className="sabotage-hint">{sabotage.hint}</p>}
        <RelayConsole relay={relay} send={(input) => send({ kind: 'puzzle-input', input })} />
        <details className="relay-manual">
          <summary>ABLAUF NACHLESEN</summary>
          <Manual sections={relay.manual} />
        </details>
      </div>
    </div>
  );
}

/**
 * The mission clock. Until `flashUntil` (epoch ms) — where it has just
 * started on this screen — its digits flash red, once.
 */
function Countdown({ deadlineAt, flashUntil }: { deadlineAt: number; flashUntil: number | null }) {
  const now = useNow(200);
  const left = deadlineAt - now;
  const stage = left < 10_000 ? 'final' : left < 60_000 ? 'critical' : '';
  const start = flashUntil !== null && now < flashUntil ? ' countdown--start' : '';
  return <div className={`countdown ${stage}${start}`}>{formatRemaining(deadlineAt, now)}</div>;
}

/** How long the clock's digits flash red as it starts: its animation in coldopen.css. */
const START_FLASH_MS = 900;

/** Where the clock will be while the lab still has its power: the plant's state, a dot. */
export function PowerStatus() {
  return (
    <div className="power-status" role="status">
      <span className="power-dot" aria-hidden="true" />
      NORMALBETRIEB
    </div>
  );
}

/**
 * The alarms against the limit, under the clock: a mark for every alarm the
 * limit allows, ✕ once charged, ○ while free. The last free one turns the
 * warning colour — the next alarm ends the run. Nothing without a limit.
 */
export function AlarmMarks({ alarms }: { alarms: PlayerView['alarms'] }) {
  const { count, limit } = alarms;
  if (limit === null) {
    return null;
  }
  const lastFree = count === limit - 1;
  return (
    <div className="alarm-marks" role="img" aria-label={`Alarme: ${count} von höchstens ${limit}`}>
      {Array.from({ length: limit }, (_, i) => {
        const lit = i < count;
        const tone = lit ? ' alarm-mark-lit' : lastFree ? ' alarm-mark-warn' : '';
        return (
          <span key={i} className={`alarm-mark${tone}`}>
            {lit ? '✕' : '○'}
          </span>
        );
      })}
    </div>
  );
}

/** Red edge glow while the clock runs out. */
function CriticalVignette({ deadlineAt }: { deadlineAt: number }) {
  const now = useNow(500);
  if (deadlineAt - now >= 60_000) {
    return null;
  }
  return <div className="vignette" aria-hidden="true" />;
}

/** How long the launch briefing covers the screen. */
const BRIEFING_MS = 3600;

/**
 * Mission briefing shown for the first seconds after launch: the mission,
 * where you are and how many alarms the run takes.
 */
function Briefing({ view }: { view: PlayerView }) {
  const now = useNow(200);
  const startedAt = view.startedAt ?? now;
  const msIn = now - startedAt;
  if (msIn > BRIEFING_MS) {
    return null;
  }
  const count = msIn < 1200 ? 3 : msIn < 2400 ? 2 : 1;
  const room = view.map === null ? null : startRoom(view.map);
  return (
    <div className="overlay briefing">
      <h1>{view.missionTitle}</h1>
      {room !== null && (
        <p>
          Du startest im <strong>{room}</strong>
        </p>
      )}
      {view.alarms.limit !== null && (
        <p className="briefing-alarms">{`Alarme: höchstens ${view.alarms.limit}`}</p>
      )}
      <div className="briefing-count">{count}</div>
    </div>
  );
}

/** Sounds, screen shake, alarm banner and the SYSTEM-ONLINE stamp. */
function useFeedback(view: PlayerView): { shaking: boolean; alarmVisible: boolean; stamp: boolean } {
  const [shaking, setShaking] = useState(false);
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [stamp, setStamp] = useState(false);
  const prevPenalty = useRef(view.penaltySeq);
  const prevPuzzle = useRef(view.puzzle?.index ?? 0);
  const started = useRef(false);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      play('start');
    }
  }, []);

  useEffect(() => {
    if (view.penaltySeq > prevPenalty.current) {
      prevPenalty.current = view.penaltySeq;
      setShaking(true);
      setAlarmVisible(true);
      const shakeTimer = setTimeout(() => setShaking(false), 600);
      const alarmTimer = setTimeout(() => setAlarmVisible(false), 4000);
      return () => {
        clearTimeout(shakeTimer);
        clearTimeout(alarmTimer);
      };
    }
    prevPenalty.current = view.penaltySeq;
    return undefined;
  }, [view.penaltySeq]);

  useEffect(() => {
    const index = view.currentPuzzleIndex;
    if (index > prevPuzzle.current) {
      play('solved');
      setStamp(true);
      const timer = setTimeout(() => setStamp(false), 1400);
      prevPuzzle.current = index;
      return () => clearTimeout(timer);
    }
    prevPuzzle.current = index;
    return undefined;
  }, [view.currentPuzzleIndex]);

  return { shaking, alarmVisible, stamp };
}

/**
 * From when the objective bar may carry a note that the sign was read and a
 * line on the air, epoch ms; null for not yet. After the briefing, or in a
 * run that opens with the power on — which has no briefing — the note at
 * once and the lines from the click of the cold open on.
 */
export interface NoticeGates {
  sign: number;
  line: number | null;
}

/**
 * What the objective bar carries under the goal right now, one notice at a
 * time so they never stack: the lines on the air as they come in, each with
 * a chirp (see `withNews` for a fresh batch), and the note once this player
 * has walked up to the Laborkennung. Nothing shows before its gate opens. A
 * player who spawns at the sign gets the note too; one who reconnects later
 * does not, they read it before.
 */
function useNotices(view: PlayerView, gates: NoticeGates): Notice | null {
  const seen = useRef(0);
  const [queue, setQueue] = useState<Notice[]>([]);
  const [shown, setShown] = useState<Notice | null>(null);
  const briefingEnds = (view.startedAt ?? 0) + BRIEFING_MS;

  useEffect(() => {
    const news = radioNews(view.events, seen.current, Date.now());
    seen.current = view.events.length;
    if (news.length > 0) {
      setQueue((queued) => withNews(queued, news));
    }
  }, [view.events]);

  const signSeen = view.presence.signSeen;
  const noted = useRef<boolean | null>(null);
  noted.current ??= signSeen && Date.now() >= briefingEnds;
  useEffect(() => {
    if (signSeen && !noted.current) {
      noted.current = true;
      setQueue((queued) => [...queued, { kind: 'sign' }]);
    }
  }, [signSeen]);

  const next = queue[0] ?? null;
  const gate = next === null ? null : next.kind === 'sign' ? gates.sign : gates.line;
  useEffect(() => {
    if (next === null || gate === null) {
      setShown(null);
      return undefined;
    }
    const wait = Math.max(0, gate - Date.now());
    const up = noticeMs(next, window.matchMedia('(pointer: coarse)').matches);
    const on = setTimeout(() => {
      if (next.kind === 'line') {
        radioChirp();
      }
      setShown(next);
    }, wait);
    const off = setTimeout(() => setQueue((queued) => queued.slice(1)), wait + up);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [next, gate]);

  return shown;
}

/** How long a main switch thrown home stays in view: its levers drop, then it closes itself. */
const LEVER_CLOSE_MS = 600;

/**
 * The main switch `last` showed, thrown home: every lever down — where the
 * panel this player had open was a main switch and the crew has solved it
 * by now (`solved` stations); null for any other panel, and for one only
 * closed or walked away from.
 */
export function droppedLever(last: PuzzleView, solved: number): PuzzleView | null {
  if (last.kind !== 'button-sync' || last.style !== 'lever' || solved <= last.index) {
    return null;
  }
  return { ...last, youPressed: true, pressedCount: last.requiredCount };
}

/**
 * The open station's panel — and for LEVER_CLOSE_MS after a main switch was
 * thrown home under this player's hands, that switch with every lever down.
 * The solve takes the station off the map at once, so the drop is shown
 * from the last view of it.
 */
function useLeverDrop(station: PuzzleView | null, solved: number): PuzzleView | null {
  const kept = useRef<{ last: PuzzleView | null; drop: PuzzleView | null; until: number }>({
    last: null,
    drop: null,
    until: 0,
  });
  const now = Date.now();
  const k = kept.current;
  if (station !== null) {
    k.last = station;
    k.drop = null;
  } else if (k.last !== null) {
    k.drop = droppedLever(k.last, solved);
    k.last = null;
    k.until = now + LEVER_CLOSE_MS;
  }
  const [, setTick] = useState(0);
  const until = k.drop === null ? null : k.until;
  useEffect(() => {
    if (until === null) {
      return undefined;
    }
    const timer = setTimeout(() => setTick((t) => t + 1), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);
  return station ?? (k.drop !== null && now < k.until ? k.drop : null);
}

/** What this player has open over the world. */
export interface Opened {
  /** the open station's panel, asked for at the station */
  operating: boolean;
  /** the source being read, by manual id */
  readingId: string | null;
  notes: boolean;
  info: boolean;
}

const NOTHING_OPEN: Opened = { operating: false, readingId: null, notes: false, info: false };

/**
 * What stays open as an emergency comes and goes. The moment one starts,
 * relay or valves, everything over the world closes: a book or a panel left
 * open would hide the alarm and keep the keys. When it ends, nothing comes
 * back by itself.
 */
export function stillOpen(opened: Opened, wasEmergency: boolean, emergency: boolean): Opened {
  return emergency && !wasEmergency ? NOTHING_OPEN : opened;
}

/**
 * What lies over the world: the open station's panel while this player
 * stands at it and asked for it, a manual object's pages while they stand
 * there, the notepad, the info panel. Panel and pages follow the server's
 * word on where the player stands; once that drops, they go and stay gone
 * until asked for again. An emergency closes all of it (`stillOpen`), and
 * while the relay console is up it keeps the keys: the notepad does not
 * open under it, nor the info panel over it.
 */
function useOpened(view: PlayerView): {
  station: PuzzleView | null;
  reading: ManualHere | null;
  notes: boolean;
  info: boolean;
  /** opens or closes what it names, the rest stays as it is */
  set: (parts: Partial<Opened>) => void;
  toggleNotes: () => void;
  toggleInfo: () => void;
} {
  const [opened, setOpened] = useState(NOTHING_OPEN);
  const armed = view.map?.stations.find((s) => s.status === 'armed')?.puzzleId ?? null;
  const atStation = armed !== null && view.presence.stationId === armed;
  const wasAtStation = useRef(atStation);
  useEffect(() => {
    if (wasAtStation.current && !atStation) {
      setOpened((now) => ({ ...now, operating: false }));
    }
    wasAtStation.current = atStation;
  }, [atStation]);
  const readingId = opened.readingId;
  const reading = view.manualsHere.find((m) => m.id === readingId) ?? null;
  useEffect(() => {
    if (readingId !== null && reading === null) {
      setOpened((now) => ({ ...now, readingId: null }));
    }
  }, [readingId, reading]);
  const emergency = view.map !== null && view.map.sabotage !== null;
  const wasEmergency = useRef(emergency);
  useEffect(() => {
    const was = wasEmergency.current;
    wasEmergency.current = emergency;
    setOpened((now) => stillOpen(now, was, emergency));
  }, [emergency]);
  const relayUp = view.map?.sabotage?.relay !== undefined;
  return {
    station: opened.operating && atStation ? view.puzzle : null,
    reading,
    notes: opened.notes,
    info: opened.info,
    set: (parts) => setOpened((now) => ({ ...now, ...parts })),
    toggleNotes: () => {
      if (!relayUp) {
        setOpened((now) => ({ ...now, notes: !now.notes }));
      }
    },
    toggleInfo: () => {
      if (!relayUp) {
        setOpened((now) => ({ ...now, info: !now.info }));
      }
    },
  };
}

/**
 * The station frame's name: the open station by paragraph and title, and
 * where it has two consoles the one this player works — „§2 — Signalkette ·
 * Pult B". The view calls a station with one console console a as well, so
 * whether there are two is the map's to tell.
 */
export function stationLabel(puzzle: PuzzleView, map: MapView): string {
  const label = `§${puzzle.index + 1} — ${puzzle.title}`;
  const twoConsoles = map.stations.some((s) => s.status === 'armed' && s.console !== undefined);
  return twoConsoles && puzzle.console !== null
    ? `${label} · ${consoleName(puzzle.console)}`
    : label;
}

/**
 * The open station over the world: its device, which names it on its plate
 * and says on its LED strip who backs this player up.
 */
export function StationModal({
  puzzle,
  map,
  edgework,
  deadlineAt,
  send,
  onClose,
}: {
  puzzle: PuzzleView;
  map: MapView;
  edgework: PlayerView['edgework'];
  deadlineAt: number | null;
  send: (msg: ClientMessage) => void;
  onClose: () => void;
}) {
  return (
    <WorldModal
      kind="station"
      label={stationLabel(puzzle, map)}
      edgework={edgework}
      onClose={onClose}
    >
      <PuzzlePanel puzzle={puzzle} send={send} deadlineAt={deadlineAt} />
    </WorldModal>
  );
}

/** Escape closes whatever lies on top. */
function useEscape(onEscape: () => void): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        handler.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** The cold open (world/coldOpen.ts) as this screen lives it. */
export interface ColdOpen {
  /** when the lights went out on this screen; null while the power is on */
  darkSince: number | null;
  /** the click has come: the clock runs and the goal is up */
  dark: boolean;
  /** this run opened with the power on: no briefing covers it */
  intro: boolean;
  /**
   * until when the clock's digits flash as it starts, epoch ms: where this
   * screen showed the power on this run; null where it landed in the dark
   */
  flashUntil: number | null;
  gates: NoticeGates;
}

function useColdOpen(view: PlayerView): ColdOpen {
  const darkSince = useDarkSince(view.lights, view.startedAt);
  const dark = useRevealed(darkSince);
  const intro = opensLit(view.lights, view.startedAt);
  const saw = useRef<number | null>(null);
  if (!dark) {
    saw.current = view.startedAt;
  }
  const briefingEnds = (view.startedAt ?? 0) + BRIEFING_MS;
  const gates = intro
    ? { sign: view.startedAt ?? 0, line: darkSince === null ? null : darkSince + REVEAL_MS }
    : { sign: briefingEnds, line: briefingEnds };
  const sawPower = saw.current === view.startedAt && darkSince !== null;
  const flashUntil = sawPower ? darkSince + REVEAL_MS + START_FLASH_MS : null;
  return { darkSince, dark, intro, flashUntil, gates };
}

/** The goal line: the station up, the way out, what the crew still has to bring. */
interface Goal {
  title: string;
  exitCall: boolean;
  missing: string | null;
}

function goalOf(view: PlayerView, map: MapView): Goal {
  const armedTitle = map.stations.find((s) => s.status === 'armed')?.title ?? null;
  const escaping = map.exit?.open === true;
  // What the station in front of the crew lacks, and what a later one will — hands are
  // free to carry it now.
  const parts = toBring(map);
  const forNow = parts.filter(
    (i) => i.requiredForTitle === null || i.requiredForTitle === armedTitle,
  );
  const forLater = parts.filter((i) => !forNow.includes(i));
  const errands = [
    forNow.length === 0 ? null : `${forNow.map((i) => i.label).join(', ')} fehlt noch`,
    forLater.length === 0 ? null : `${forLater.map((i) => i.label).join(', ')} mitnehmen`,
  ].filter((line): line is string => line !== null);
  return {
    title:
      view.puzzle !== null
        ? view.puzzle.title
        : escaping
          ? 'NOTAUSGANG — alle raus, JETZT!'
          : (armedTitle ?? 'Alle Stationen erledigt'),
    exitCall: view.puzzle === null && escaping,
    missing: escaping || errands.length === 0 ? null : errands.join(' · '),
  };
}

/**
 * While the lab still has its power: the mission's name where the goal will
 * be, and where this player starts.
 */
function PowerGoal({ view, map }: { view: PlayerView; map: MapView }) {
  const room = startRoom(map);
  return (
    <div className="stage-goal stage-goal--power">
      <h1>{view.missionTitle}</h1>
      {room !== null && <span className="stage-sub">Du startest im {room}</span>}
    </div>
  );
}

/** The run's progress and what to do now: a LED a station, the goal line under it. */
function StageGoal({ view, goal }: { view: PlayerView; goal: Goal }) {
  return (
    <div className="stage-goal">
      <div
        className="led-strip"
        aria-label={`Station ${view.currentPuzzleIndex + 1} von ${view.puzzleCount}`}
      >
        {Array.from({ length: view.puzzleCount }, (_, i) => (
          <span
            key={i}
            className={`led ${i < view.currentPuzzleIndex ? 'led-done' : ''} ${
              i === view.currentPuzzleIndex ? 'led-active' : ''
            }`}
          />
        ))}
      </div>
      <h1>
        {goal.exitCall && (
          <>
            <Icon name="exit" />{' '}
          </>
        )}
        {goal.title}
      </h1>
      {goal.missing !== null && <span className="stage-sub">{goal.missing}</span>}
    </div>
  );
}

/**
 * The objective bar over the world: the goal and the clock — while the lab
 * still has its power, its name and NORMALBETRIEB instead — then whatever
 * is on the air, the emergency and the alarm.
 */
export function StageTop({
  view,
  map,
  coldOpen,
  notice,
  alarmVisible,
}: {
  view: PlayerView;
  map: MapView;
  coldOpen: ColdOpen;
  notice: Notice | null;
  alarmVisible: boolean;
}) {
  const relay = map.sabotage?.relay;
  return (
    <div className="stage-top">
      {coldOpen.dark ? (
        <StageGoal view={view} goal={goalOf(view, map)} />
      ) : (
        <PowerGoal view={view} map={map} />
      )}
      <div className="stage-clock">
        {!coldOpen.dark ? (
          <PowerStatus />
        ) : (
          view.deadlineAt !== null && (
            <Countdown deadlineAt={view.deadlineAt} flashUntil={coldOpen.flashUntil} />
          )
        )}
        <AlarmMarks alarms={view.alarms} />
      </div>
      {notice?.kind === 'line' && (
        <div
          key={`${notice.event.at}-${notice.event.label}`}
          className="radio-banner"
          role="status"
        >
          <span className="radio-banner-from">
            <Icon name={airIcon(notice.event)} /> {bannerFrom(notice.event)}
          </span>{' '}
          — {notice.event.label}
        </div>
      )}
      {notice?.kind === 'sign' && (
        <div className="toast" role="status">
          ✓ Laborkennung notiert
        </div>
      )}
      {relay === undefined && <SabotageAlert sabotage={map.sabotage} />}
      {alarmVisible && view.lastPenaltySec !== null && (
        <div key={view.penaltySeq} className="alarm" role="alert">
          <Icon name="siren" /> ALARM — Fehlversuch! −{view.lastPenaltySec} Sekunden
        </div>
      )}
    </div>
  );
}

// --- screen ------------------------------------------------------------------

export function GameScreen({
  view,
  roomCode,
  positionsRef,
  dronesRef,
  pingsRef,
  chatsRef,
  send,
}: Props) {
  const { shaking, alarmVisible, stamp } = useFeedback(view);
  const coldOpen = useColdOpen(view);
  const notice = useNotices(view, coldOpen.gates);
  const open = useOpened(view);
  const station = useLeverDrop(open.station, view.currentPuzzleIndex);
  const notes = useNotes(roomCode, view.you.id);
  const closeModal = (): void => open.set({ operating: false, readingId: null });
  useKeys(['n'], open.toggleNotes);
  useEscape(() => {
    if (open.info) {
      open.set({ info: false });
    } else if (open.station !== null || open.reading !== null) {
      closeModal();
    } else {
      open.set({ notes: false });
    }
  });
  const map = view.map;
  if (map === null) {
    return <p className="muted">Lade Mission …</p>;
  }
  const relay = map.sabotage?.relay;
  const missingLabel = coldOpen.dark ? goalOf(view, map).missing : null;

  return (
    <div className={`game ${shaking ? 'shake' : ''}`}>
      {view.deadlineAt !== null && <CriticalVignette deadlineAt={view.deadlineAt} />}
      {!coldOpen.intro && <Briefing view={view} />}
      {stamp && (
        <div className="overlay stamp" aria-hidden="true">
          <span>✔ SYSTEM ONLINE</span>
        </div>
      )}

      {map.sabotage !== null && relay !== undefined && (
        <RelayAlert sabotage={map.sabotage} relay={relay} send={send} />
      )}

      {view.pausedFor !== null && (
        <div className="overlay pause" role="status">
          <span className="kicker">MISSION PAUSIERT</span>
          <h1>
            <Icon name="pause" /> Verbindung verloren
          </h1>
          <p>
            {view.pausedFor.length > 0
              ? `Warten auf ${view.pausedFor.join(', ')} — Uhr, Patrouillen und Notfälle stehen still.`
              : 'Warten auf die Crew — Uhr, Patrouillen und Notfälle stehen still.'}
          </p>
          <p className="muted">
            Wer getrennt wurde, lädt einfach die Seite neu und ist wieder dabei.
          </p>
        </div>
      )}

      <div className="stage">
        <StageTop
          view={view}
          map={map}
          coldOpen={coldOpen}
          notice={notice}
          alarmVisible={alarmVisible}
        />
        <GameWorld
          view={view}
          positionsRef={positionsRef}
          dronesRef={dronesRef}
          pingsRef={pingsRef}
          chatsRef={chatsRef}
          spectator={false}
          darkSince={coldOpen.darkSince}
          station={station}
          holdTips={notice !== null}
          inputLocked={
            station !== null ||
            open.reading !== null ||
            view.pausedFor !== null ||
            relay !== undefined
          }
          onToggleInfo={open.toggleInfo}
          onRead={(manualId) => open.set({ readingId: manualId })}
          onOperate={() => open.set({ operating: true })}
          send={send}
        />
        {open.notes && (
          <Notepad
            notes={notes}
            edgework={view.edgework}
            onClose={() => open.set({ notes: false })}
          />
        )}
      </div>

      {station !== null && (
        <StationModal
          puzzle={station}
          map={map}
          edgework={view.edgework}
          deadlineAt={view.deadlineAt}
          send={send}
          onClose={closeModal}
        />
      )}
      {open.reading !== null && (
        <ReadingOverlay
          key={open.reading.id}
          manual={open.reading}
          puzzle={view.puzzle}
          current={view.currentPuzzleIndex}
          mission={view.missionTitle}
          map={map}
          edgework={view.edgework}
          onAskNote={() => send({ kind: 'request-hint' })}
          onClose={closeModal}
        />
      )}

      <MissionHud
        view={view}
        positionsRef={positionsRef}
        chatsRef={chatsRef}
        // Until the click of the cold open the strip keeps quiet: the opener comes with the banner.
        onAir={notice?.kind === 'line' || !coldOpen.dark}
        parts={missingLabel}
        notesOpen={open.notes}
        onToggleNotes={open.toggleNotes}
        onOpenInfo={() => open.set({ info: true })}
      />

      {open.info && <InfoPanel view={view} onClose={() => open.set({ info: false })} />}
    </div>
  );
}
