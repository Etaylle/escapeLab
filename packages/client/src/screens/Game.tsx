import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  ClientMessage,
  DronePosition,
  ManualHere,
  MapView,
  NoteHere,
  PlayerView,
  PuzzleView,
} from '@escapelab/core';
import { clockTime, formatLeft, type MissionTime } from '../clock.js';
import { useKeys, useNow, useServerNow } from '../hooks.js';
import { withCapture } from '../notes.js';
import { NotepadContext, NotingPlace, placeName, type NotepadHand } from '../noting.js';
import {
  AFTER_SOLVE_MS,
  airIcon,
  bannerFrom,
  followsSolve,
  radioNews,
  voiced,
  withNews,
  type Notice,
} from '../radio.js';
import { deviceCoach, firstSight, SHOWN_MARKS, type CoachMark } from '../puzzles/coach.js';
import { useSolvedHold, type DeviceRun } from '../puzzles/Device.js';
import { RelayConsole } from '../puzzles/RelayPanel.js';
import { useReducedMotion, useSettings } from '../settings.js';
import type { Connection, Refusal } from '../ws.js';
import {
  ALARM_NOTICE_MS,
  alarmLine,
  alarmNotice,
  type AlarmNotice,
} from '../world/alarm.js';
import {
  briefingCountdown,
  coverShut,
  paperSwish,
  pencilScratch,
  readerSolve,
  sheetDown,
} from '../world/audio.js';
import { clickSeenAt, opensLit, useDarkSince, useRevealed } from '../world/coldOpen.js';
import { consoleName } from '../world/consoles.js';
import { escapeChecklist, escaping, type Mate } from '../world/escape.js';
import { veilOf, type Ending, type Finale } from '../world/finale.js';
import { GameWorld } from '../world/GameWorld.js';
import { IntroOverlay } from '../world/intro/IntroOverlay.js';
import { airFrom, cutIn, hudBackAt, hudHeld, type IntroCue } from '../world/intro/sequence.js';
import { useIntro, type Intro } from '../world/intro/useIntro.js';
import { coversArmed } from '../world/interact.js';
import { isArmed, known } from '../world/known.js';
import { dueParts } from '../world/markers.js';
import { startingSpot, type KnownPositions } from '../world/movement.js';
import { airNotice } from '../world/onAir.js';
import { stopAnnounce } from '../world/pa.js';
import { fetchLines, stopVoice, voiceForRun } from '../world/radioVoice.js';
import type { ChatLine, MapPing } from '../world/render/frame.js';
import { startRoom } from '../world/rooms.js';
import { PuzzlePanel } from './PuzzlePanel.js';
import { useHudRow } from './hudFold.js';
import { RowCrew, RowTools } from './HudRow.js';
import { Icon } from './Icon.js';
import { LineLostCard, lineLost, type GameLine } from './Line.js';
import { BackToast, PauseCard, TakeoverCard } from './Pause.js';
import { MissionHud } from './MissionHud.js';
import { InfoPanel } from './InfoPanel.js';
import { Manual } from './Manual.js';
import { Notepad, useNotes } from './Notepad.js';
import { noteRoom, PinnedNote } from './PinnedNote.js';
import { putDownKeys, useLeaving, usePutDown, type Over, type Shown } from './PutDown.js';
import { lookOf, ReadingOverlay } from './Reading.js';
import { PANEL_FADE_MS, WorldModal } from './WorldModal.js';

interface Props {
  view: PlayerView;
  /** the room this run plays in; the notepad is kept under it */
  roomCode: string | null;
  positionsRef: React.MutableRefObject<KnownPositions>;
  dronesRef: React.MutableRefObject<Record<string, DronePosition>>;
  pingsRef: React.MutableRefObject<MapPing[]>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  send: (msg: ClientMessage) => void;
  /** hears what the server says as it comes (ws.ts): the world hears E's answers by it */
  listen: Connection['listen'];
  /**
   * the server's latest refusal of this player's messages (ws.ts): the open device or relay
   * console shakes the press it answers and says it in its head
   */
  refusal: Refusal | null;
  /** the run's end, while the world still plays it on this screen (finale.ts); none before */
  finale: Finale | null;
  /** the own line, whose card stands over the world while it is down (Line.tsx) */
  line: GameLine;
}

/**
 * The whole seconds left until `endsAt` on the server's clock at `now` — standing still at the
 * pause's start (`pausedAt`) while the run is paused — never below 0.
 */
function secondsUntil(endsAt: number, pausedAt: number | null, now: number): number {
  return Math.max(0, Math.ceil((endsAt - clockTime(pausedAt, now)) / 1000));
}

/** Full-width emergency banner: what broke, where to go, how long you have. */
function SabotageAlert({
  sabotage,
  pausedAt,
}: {
  sabotage: NonNullable<PlayerView['map']>['sabotage'];
  pausedAt: number | null;
}) {
  const now = useServerNow(200);
  if (sabotage === null) {
    return null;
  }
  const left = secondsUntil(sabotage.endsAt, pausedAt, now);
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

export type Sabotage = NonNullable<NonNullable<PlayerView['map']>['sabotage']>;

/**
 * Relay mode: no valves to run to — the player's console stays in front of
 * everything until the emergency is over, the instruction to read out on top.
 * It takes the keys: focus moves in, and what is pressed there reaches
 * neither the world nor the screen's shortcuts.
 */
export function RelayAlert({
  sabotage,
  relay,
  pausedAt,
  send,
  refusal,
}: {
  sabotage: Sabotage;
  relay: NonNullable<Sabotage['relay']>;
  pausedAt: number | null;
  send: (msg: ClientMessage) => void;
  refusal: Refusal | null;
}) {
  const now = useServerNow(200);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    frame.current?.focus();
  }, []);
  const left = secondsUntil(sabotage.endsAt, pausedAt, now);
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
        <RelayConsole
          relay={relay}
          pausedAt={pausedAt}
          send={(input) => send({ kind: 'puzzle-input', input })}
          refusal={refusal}
        />
        <details className="relay-manual">
          <summary>ABLAUF NACHLESEN</summary>
          <Manual sections={relay.manual} />
        </details>
      </div>
    </div>
  );
}

/**
 * How the clock looks with `left` ms on it: big and red in the last ten seconds, pulsing red
 * in the last minute — and amber all through the escape until then, the hatch open and the
 * time still enough.
 */
export function clockStage(left: number, escaping: boolean): string {
  if (left < 10_000) {
    return 'final';
  }
  if (left < 60_000) {
    return 'critical';
  }
  return escaping ? 'countdown--escape' : '';
}

/**
 * The mission clock, on the server's clock (clock.ts) and standing still while the run is
 * paused. Over the START_FLASH_MS up to `flashUntil` (epoch ms) — where it has just started on
 * this screen — its digits flash red, once; then as `clockStage` has it.
 */
function Countdown({
  mission,
  flashUntil,
  escaping,
}: {
  mission: MissionTime & { deadlineAt: number };
  flashUntil: number | null;
  escaping: boolean;
}) {
  const now = useServerNow(200);
  const left = mission.deadlineAt - clockTime(mission.pausedAt, now);
  const stage = clockStage(left, escaping);
  // By the time of this draw: the screen draws anew as the HUD comes back, between two ticks.
  const drawn = Date.now();
  const flashing =
    flashUntil !== null && drawn >= flashUntil - START_FLASH_MS && drawn < flashUntil;
  const start = flashing ? ' countdown--start' : '';
  return <div className={`countdown ${stage}${start}`}>{formatLeft(left)}</div>;
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
 * The alarms against the limit, under the clock, under the word ALARME: a
 * mark for every alarm the limit allows, ✕ once charged, ○ while free. The
 * last free one turns the warning colour — the next alarm ends the run.
 * Nothing without a limit.
 */
export function AlarmMarks({ alarms }: { alarms: PlayerView['alarms'] }) {
  const { count, limit } = alarms;
  if (limit === null) {
    return null;
  }
  const lastFree = count === limit - 1;
  return (
    <div className="alarm-marks" role="img" aria-label={`Alarme: ${count} von höchstens ${limit}`}>
      <span className="alarm-marks-label">ALARME</span>
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

/** How long the launch briefing covers the screen. */
const BRIEFING_MS = 3600;

/**
 * Mission briefing shown for the first seconds after launch: the mission,
 * where you are and how many alarms the run takes, counted down with a beep
 * at each number — heard only where it shows, so never in a run that opens
 * with the power on.
 */
function Briefing({ view }: { view: PlayerView }) {
  const now = useNow(200);
  const startedAt = view.startedAt ?? now;
  const msIn = now - startedAt;
  const run = view.startedAt;
  const counted = useRef<number | null>(null);
  useEffect(() => {
    if (run === null || counted.current === run) {
      return;
    }
    counted.current = run;
    const elapsed = Date.now() - run;
    if (elapsed < BRIEFING_MS) {
      briefingCountdown(elapsed);
    }
  }, [run]);
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
          Start im <strong>{room}</strong>
        </p>
      )}
      {view.alarms.limit !== null && (
        <p className="briefing-alarms">{`Alarme: höchstens ${view.alarms.limit}`}</p>
      )}
      <div className="briefing-count">{count}</div>
    </div>
  );
}

/**
 * The alarm banner, up for ALARM_NOTICE_MS after each alarm; the world strobes
 * and shakes at an alarm on its own (world/alarm.ts), and a solved station's
 * device sweeps, sounds and closes itself (puzzles/Device.tsx).
 */
function useFeedback(view: PlayerView): { alarmVisible: boolean } {
  const [alarmVisible, setAlarmVisible] = useState(false);
  const prevPenalty = useRef(view.penaltySeq);

  useEffect(() => {
    if (view.penaltySeq > prevPenalty.current) {
      prevPenalty.current = view.penaltySeq;
      setAlarmVisible(true);
      const alarmTimer = setTimeout(() => setAlarmVisible(false), ALARM_NOTICE_MS);
      return () => clearTimeout(alarmTimer);
    }
    prevPenalty.current = view.penaltySeq;
    return undefined;
  }, [view.penaltySeq]);

  return { alarmVisible };
}

/**
 * From when the objective bar may carry a note that the sign was read and a
 * line on the air, epoch ms; null for not yet. After the briefing, or in a
 * run that opens with the power on — which has no briefing — the note as
 * soon as the opening no longer shows the world as a film, which fades the
 * bar, and the lines from the click of the cold open on.
 */
export interface NoticeGates {
  sign: number | null;
  line: number | null;
}

/**
 * What the objective bar carries under the goal right now, one notice at a
 * time so they never stack: the lines on the air as they come in, each up
 * as its sound starts and while it speaks — the plant's message over its
 * loudspeakers, mission control's over the radio, a line without a
 * recording keyed with the radio's chirp or, the plant's, silent
 * (world/onAir.ts `airNotice`; see `withNews` for a fresh batch); a line
 * that comes with a solve AFTER_SOLVE_MS later, so that the win is seen
 * first — and the note once this player has walked up to the Laborkennung.
 * Nothing shows before its gate opens. A player who spawns at the sign gets
 * the note too; one who reconnects later does not, they read it before. As
 * the run starts only the list of the recordings is fetched; each line's own
 * recording as the line is queued, decoded only as it airs, so that a line
 * the queue drops leaves nothing decoded; one still speaking stops with the
 * screen.
 */
function useNotices(view: PlayerView, gates: NoticeGates): Notice | null {
  const seen = useRef(0);
  const [queue, setQueue] = useState<Notice[]>([]);
  const [shown, setShown] = useState<Notice | null>(null);
  const briefingEnds = (view.startedAt ?? 0) + BRIEFING_MS;

  useEffect(() => {
    voiceForRun();
  }, [view.missionId, view.startedAt]);
  useEffect(
    () => () => {
      stopVoice();
      stopAnnounce();
    },
    [],
  );

  useEffect(() => {
    const now = Date.now();
    const news = radioNews(view.events, seen.current, now);
    const notBefore = followsSolve(view.events, seen.current) ? now + AFTER_SOLVE_MS : 0;
    seen.current = view.events.length;
    if (news.length > 0) {
      fetchLines(news.filter(voiced).map((event) => event.label));
      setQueue((queued) => withNews(queued, news, notBefore));
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
    const from = next.kind === 'line' ? Math.max(gate, next.notBefore) : gate;
    return airNotice(next, {
      wait: Math.max(0, from - Date.now()),
      coarse: window.matchMedia('(pointer: coarse)').matches,
      show: setShown,
      done: () => setQueue((queued) => queued.slice(1)),
    });
  }, [next, gate]);

  return shown;
}

/**
 * Whether the view going from `before` to `after` solved a station whose rules this player
 * stood reading at the source, with no device of their own open (`deviceOpen`): the reader's
 * share of the solve.
 */
export function readerSawSolve(
  before: PlayerView,
  after: PlayerView,
  deviceOpen: boolean,
): boolean {
  const map = before.map;
  if (map === null || deviceOpen || after.currentPuzzleIndex <= before.currentPuzzleIndex) {
    return false;
  }
  const source = map.manuals.filter(known).find((m) => m.id === before.presence.manualId);
  return source !== undefined && coversArmed(map, source);
}

/**
 * The reader at the source hears a solve as it comes, quietly (world/audio.ts `readerSolve`):
 * the console's own sounds are its operator's.
 */
function useReaderHearsSolve(view: PlayerView, deviceOpen: boolean): void {
  const before = useRef(view);
  useEffect(() => {
    if (readerSawSolve(before.current, view, deviceOpen)) {
      readerSolve();
    }
    before.current = view;
  }, [view, deviceOpen]);
}

/** What this player has open over the world. */
export interface Opened {
  /** the open station's panel, asked for at the station */
  operating: boolean;
  /** the source being read, by manual id */
  readingId: string | null;
  /** the note of the last shift being read, by its index among the map's notes */
  noteIndex: number | null;
  notes: boolean;
  info: boolean;
}

const NOTHING_OPEN: Opened = {
  operating: false,
  readingId: null,
  noteIndex: null,
  notes: false,
  info: false,
};

/**
 * What putting away what lies over the world closes: the station's panel, a source's pages, a
 * note — never the notepad, which stays open beside the next source or device until hidden.
 */
export const NOTHING_OVER: Partial<Opened> = { operating: false, readingId: null, noteIndex: null };

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
 * stands at it and asked for it, a manual object's pages or a note of the
 * last shift while they stand there, the notepad, the info panel. Panel,
 * pages and note follow the server's word on where the player stands; once
 * that drops, they go and stay gone until asked for again. An emergency
 * closes all of it (`stillOpen`), and while the relay console is up it
 * keeps the keys: the notepad does not open under it, nor the info panel
 * over it.
 */
function useOpened(view: PlayerView): {
  station: PuzzleView | null;
  reading: ManualHere | null;
  note: NoteHere | null;
  notes: boolean;
  info: boolean;
  /** opens or closes what it names, the rest stays as it is */
  set: (parts: Partial<Opened>) => void;
  toggleNotes: () => void;
  toggleInfo: () => void;
} {
  const [opened, setOpened] = useState(NOTHING_OPEN);
  const armed = view.map?.stations.find(isArmed)?.puzzleId ?? null;
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
  const noteIndex = opened.noteIndex;
  const note = view.noteHere?.index === noteIndex ? view.noteHere : null;
  useEffect(() => {
    if (noteIndex !== null && note === null) {
      setOpened((now) => ({ ...now, noteIndex: null }));
    }
  }, [noteIndex, note]);
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
    note,
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
  const twoConsoles = map.stations.some((s) => isArmed(s) && s.console !== undefined);
  return twoConsoles && puzzle.console !== null
    ? `${label} · ${consoleName(puzzle.console)}`
    : label;
}

/**
 * The newcomer's line for the device in front of them (puzzles/coach.ts), the first time this
 * session meets it: kept for as long as the device stays open, so that nothing jumps under
 * the player's hands.
 */
function useDeviceCoach(puzzle: PuzzleView): CoachMark | null {
  const next = deviceCoach(puzzle);
  const id = next?.id ?? null;
  const [kept, setKept] = useState(() => ({ id, mark: firstSight(next, SHOWN_MARKS) }));
  if (kept.id !== id) {
    // Another device in the same frame: its own first sight.
    setKept({ id, mark: firstSight(next, SHOWN_MARKS) });
  }
  const mark = kept.id === id ? kept.mark : null;
  useEffect(() => {
    if (mark !== null) {
      SHOWN_MARKS.add(mark.id);
    }
  }, [mark]);
  return mark;
}

/** What a device on its way out of view does with a press or a step back: nothing. */
const TAKES_NOTHING = (): void => undefined;

/**
 * The open station over the world: its device, which names it on its plate
 * and says on its LED strip who backs this player up and on its chassis how
 * to step back — and, the first time, the line that says what its controls
 * do, under the Laborkennung's row, where it covers neither the serial nor
 * the device. Stepped back from (`leaving`), it fades out as it came and
 * takes nothing more: no key, no press, no step back reaches the run.
 */
export function StationModal({
  puzzle,
  run,
  map,
  edgework,
  mission,
  send,
  onStepBack,
  leaving = false,
}: {
  puzzle: PuzzleView;
  /** the run around the device: its alarms, the stations solved, the crew */
  run: DeviceRun;
  map: MapView;
  edgework: PlayerView['edgework'];
  /** the mission's clock, for a device that shows it */
  mission: MissionTime;
  send: (msg: ClientMessage) => void;
  onStepBack: () => void;
  leaving?: boolean;
}) {
  const coach = useDeviceCoach(puzzle);
  return (
    <WorldModal
      kind="station"
      label={stationLabel(puzzle, map)}
      edgework={edgework}
      leaving={leaving}
    >
      {coach !== null && (
        <p className="station-coach" role="note">
          {coach.text}
        </p>
      )}
      {puzzle.plate !== null && (
        // A phone held sideways has no row of the device's to spare: what its machine does
        // stands beside it there, under the Laborkennung, and in its head everywhere else.
        <p className="station-plate device-engraving">{puzzle.plate}</p>
      )}
      <PuzzlePanel
        puzzle={puzzle}
        run={run}
        send={leaving ? TAKES_NOTHING : send}
        mission={mission}
        onStepBack={leaving ? TAKES_NOTHING : onStepBack}
      />
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

/**
 * The cold open as this screen lives it — `cut` straight to the bang where the opening's shot
 * still ran as the lights went out (world/intro/sequence.ts). Where the opening keeps the HUD
 * out past the click, until `hudBack` (epoch ms), the clock's flash and the first line on the
 * air wait for the HUD: they come where they can be seen.
 */
function useColdOpen(view: PlayerView, cut: boolean, hudBack: number | null): ColdOpen {
  const darkSince = useDarkSince(view.lights, view.startedAt, cut);
  const dark = useRevealed(darkSince);
  const intro = opensLit(view.lights, view.startedAt);
  const saw = useRef<number | null>(null);
  if (!dark) {
    saw.current = view.startedAt;
  }
  const briefingEnds = (view.startedAt ?? 0) + BRIEFING_MS;
  const shown = clickSeenAt(darkSince, hudBack);
  const gates = intro
    ? { sign: view.startedAt ?? 0, line: airFrom(shown, hudBack) }
    : { sign: briefingEnds, line: briefingEnds };
  const sawPower = saw.current === view.startedAt && shown !== null;
  const flashUntil = sawPower ? shown + START_FLASH_MS : null;
  return { darkSince, dark, intro, flashUntil, gates };
}

/** The goal line: the station up, the way out, what the crew still has to bring. */
interface Goal {
  title: string;
  exitCall: boolean;
  missing: string | null;
}

/** Where a player stands, in tiles. */
type Point = { x: number; y: number };

/**
 * The goal line for a player standing at `self`: the station, or the way out — and under it
 * what the station in front of the crew lacks, and what the one after it will (hands are free
 * to carry it now) or what lies in sight; a part for a station further on waits (`dueParts`).
 */
function goalOf(view: PlayerView, map: MapView, self: Point): Goal {
  const armedTitle = map.stations.find(isArmed)?.title ?? null;
  const out = escaping(map);
  const parts = dueParts(map, self);
  const forNow = parts.filter((i) => i.requiredFor === null || i.requiredFor.ahead === 0);
  const forLater = parts.filter((i) => !forNow.includes(i));
  const errands = [
    forNow.length === 0 ? null : `${forNow.map((i) => i.label).join(', ')} fehlt noch`,
    forLater.length === 0 ? null : `${forLater.map((i) => i.label).join(', ')} mitnehmen`,
  ].filter((line): line is string => line !== null);
  return {
    title:
      view.puzzle !== null
        ? view.puzzle.title
        : out
          ? 'NOTAUSGANG ENTRIEGELT'
          : (armedTitle ?? 'Alle Stationen erledigt'),
    exitCall: view.puzzle === null && out,
    missing: out || errands.length === 0 ? null : errands.join(' · '),
  };
}

/** The escape's checklist under the goal: the crew by name, each ticked off on the hatch. */
export function EscapeChecklist({ mates }: { mates: Mate[] }) {
  const out = mates.filter((mate) => mate.out).length;
  return (
    <ul className="escape-list" aria-label={`Am Notausgang: ${out} von ${mates.length}`}>
      {mates.map((mate) => (
        <li key={mate.id} className={mate.out ? 'escape-mate escape-mate--out' : 'escape-mate'}>
          <span className="crew-dot" style={{ background: mate.color }} aria-hidden="true" />
          {mate.name}
          {mate.out && <Icon name="check" />}
        </li>
      ))}
    </ul>
  );
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
      {room !== null && <span className="stage-sub">Start im {room}</span>}
    </div>
  );
}

/**
 * The run's progress and what to do now: a LED a station, the goal line
 * under it — in the escape, the crew's checklist for the hatch.
 */
function StageGoal({ view, map, goal }: { view: PlayerView; map: MapView; goal: Goal }) {
  return (
    <div className={goal.exitCall ? 'stage-goal stage-goal--escape' : 'stage-goal'}>
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
      {goal.exitCall && map.exit !== null && (
        <EscapeChecklist mates={escapeChecklist(view.players, map.exit)} />
      )}
    </div>
  );
}

/**
 * The alarm on the objective bar: what set it off and what it cost — „ALARM — Drohne! −20
 * Sekunden" — and with the run's first, how many more it takes.
 */
function AlarmBanner({ notice }: { notice: AlarmNotice }) {
  return (
    <div className="alarm" role="alert">
      <Icon name="siren" /> {alarmLine(notice)}
      {notice.warning !== null && <span className="alarm-warning">{notice.warning}</span>}
    </div>
  );
}

/** A player on their spawn: where the bar takes them to stand when it is told nothing else. */
function spawnOf(map: MapView): Point {
  return { x: map.yourSpawn.x + 0.5, y: map.yourSpawn.y + 0.5 };
}

/** What the bar carries on the air: the line mission control speaks, or the sign's note. */
function OnAir({ notice }: { notice: Notice }) {
  if (notice.kind === 'sign') {
    return (
      <div className="toast" role="status">
        ✓ Laborkennung notiert
      </div>
    );
  }
  return (
    <div
      key={`${notice.event.at}-${notice.event.label}`}
      className="radio-banner"
      role="status"
      style={notice.upMs === undefined ? undefined : { animationDuration: `${notice.upMs}ms` }}
    >
      <span className="radio-banner-from">
        <Icon name={airIcon(notice.event)} /> {bannerFrom(notice.event)}
      </span>{' '}
      — {notice.event.label}
    </div>
  );
}

/**
 * The clock's column of the bar: while the lab still has its power NORMALBETRIEB, then the
 * mission's clock; the alarm marks with either.
 */
function StageClock({
  view,
  map,
  coldOpen,
}: {
  view: PlayerView;
  map: MapView;
  coldOpen: ColdOpen;
}) {
  return (
    <div className="stage-clock">
      {!coldOpen.dark ? (
        <PowerStatus />
      ) : (
        view.deadlineAt !== null && (
          <Countdown
            mission={{ deadlineAt: view.deadlineAt, pausedAt: view.pausedAt }}
            flashUntil={coldOpen.flashUntil}
            escaping={escaping(map)}
          />
        )
      )}
      <AlarmMarks alarms={view.alarms} />
    </div>
  );
}

/**
 * What the crew strip folds into the bar's row on a phone held sideways (hudFold.ts,
 * HudRow.tsx): the crew and the Laborkennung before the clock, the buttons after it.
 */
export interface RowParts {
  crew: ReactNode;
  tools: ReactNode;
}

/**
 * The objective bar over the world: the goal and the clock — while the lab
 * still has its power, its name and NORMALBETRIEB instead — then whatever
 * is on the air, the emergency and the alarm. While a device is open
 * (`deviceOpen`) the alarm shows in its head instead: here it would lie half
 * under it. On a phone held sideways (`row`) it is one row with the crew strip folded in
 * (hudFold.ts), and a line on the air stands in the goal's place; the emergency and the alarm
 * stand under the row while they last.
 */
export function StageTop({
  view,
  map,
  coldOpen,
  notice,
  alarmVisible,
  deviceOpen = false,
  self = spawnOf(map),
  row = null,
}: {
  view: PlayerView;
  map: MapView;
  coldOpen: ColdOpen;
  notice: Notice | null;
  alarmVisible: boolean;
  deviceOpen?: boolean;
  /** where this player stands, for what lies in their sight; their spawn by default */
  self?: Point;
  /** the crew strip's parts, where it folds into the bar's row; none by default */
  row?: RowParts | null;
}) {
  const relay = map.sabotage?.relay;
  const alarm = alarmVisible && !deviceOpen ? alarmNotice(view.events, view.alarms) : null;
  const goal = coldOpen.dark ? (
    <StageGoal view={view} map={map} goal={goalOf(view, map, self)} />
  ) : (
    <PowerGoal view={view} map={map} />
  );
  const clock = <StageClock view={view} map={map} coldOpen={coldOpen} />;
  const onAir = notice === null ? null : <OnAir notice={notice} />;
  return (
    <div className="stage-top">
      {row === null ? (
        <>
          {goal}
          {clock}
          {onAir}
        </>
      ) : (
        <div className="stage-row">
          {onAir ?? goal}
          {row.crew}
          {clock}
          {row.tools}
        </div>
      )}
      {relay === undefined && <SabotageAlert sabotage={map.sabotage} pausedAt={view.pausedAt} />}
      {alarm !== null && <AlarmBanner key={alarm.seq} notice={alarm} />}
    </div>
  );
}

/**
 * The ending's last fade over the whole screen (finale.ts): to white for a
 * run won, to black for one lost — timed from when the ending started on
 * this screen, however late the veil went up.
 */
export function FinaleVeil({ ending, since }: { ending: Ending; since: number }) {
  const reduced = useReducedMotion();
  const [shown] = useState(() => Date.now());
  const veil = veilOf(ending, reduced);
  const timing = {
    animationDelay: `${Math.round(since + veil.delay - shown)}ms`,
    animationDuration: `${Math.round(veil.duration)}ms`,
  };
  return <div className={`finale-veil finale-veil--${veil.tone}`} style={timing} aria-hidden="true" />;
}

// --- screen ------------------------------------------------------------------

/**
 * What comes and goes over a run: the briefing, the own line lost, the pause, a return the run
 * went on without, the relay's alert. The clock's red edge lies over the world alone, under
 * the HUD (GameWorld.tsx RedEdge).
 */
function RunOverlays({
  view,
  coldOpen,
  send,
  refusal,
  line,
}: {
  view: PlayerView;
  coldOpen: ColdOpen;
  send: Props['send'];
  refusal: Refusal | null;
  line: GameLine;
}) {
  const sabotage = view.map?.sabotage ?? null;
  const relay = sabotage?.relay;
  return (
    <>
      {!coldOpen.intro && <Briefing view={view} />}
      <Standstill view={view} send={send} line={line} />
      <BackToast players={view.players} />
      {sabotage !== null && relay !== undefined && (
        <RelayAlert
          sabotage={sabotage}
          relay={relay}
          pausedAt={view.pausedAt}
          send={send}
          refusal={refusal}
        />
      )}
    </>
  );
}

/**
 * What stands over the world while the run does not go on for this player: the own line down
 * — whatever stands still for the others is not news here — else the pause, else a new
 * device's ask for a seat the run went on without.
 */
function Standstill({
  view,
  send,
  line,
}: {
  view: PlayerView;
  send: Props['send'];
  line: GameLine;
}) {
  if (lineLost(line, view)) {
    return <LineLostCard line={line} />;
  }
  if (view.pausedFor !== null) {
    return <PauseCard view={view} send={send} />;
  }
  return view.takeovers === undefined ? null : <TakeoverCard asks={view.takeovers} send={send} />;
}

/** What this player has open, as the screen keeps it (`useOpened`). */
type OpenNow = ReturnType<typeof useOpened>;

/** Escape closes what lies on top: the info panel, a panel, pages or a note, then the notepad. */
function useEscapeCloses(open: OpenNow, closeModal: () => void): void {
  useEscape(() => {
    if (open.info) {
      open.set({ info: false });
    } else if (open.station !== null || open.reading !== null || open.note !== null) {
      closeModal();
    } else {
      open.set({ notes: false });
    }
  });
}

/** What lies over the world: the station's device, a source's pages, a note; null for nothing. */
function overOf(open: OpenNow): Over | null {
  if (open.station !== null) {
    return 'station';
  }
  if (open.reading !== null) {
    return 'reading';
  }
  return open.note === null ? null : 'note';
}

/** A source's pages put down: a book's cover shuts, any other sheet clacks down. */
function readingDown(manual: ManualHere): void {
  if (lookOf(manual.kind) === 'book') {
    coverShut();
  } else {
    sheetDown();
  }
}

/**
 * The source's pages and the note of the last shift over the world as they are put down: held
 * a moment on their way out of view (PutDown.tsx), with the sound of it.
 */
function useSheets(open: OpenNow): {
  reading: Shown<ManualHere> | null;
  note: Shown<NoteHere> | null;
} {
  return { reading: usePutDown(open.reading, readingDown), note: usePutDown(open.note, sheetDown) };
}

/** The notepad taken up with the paper's swish, and laid down again with its clack. */
function useNotepadSounds(open: boolean): void {
  const was = useRef(open);
  useEffect(() => {
    if (open !== was.current) {
      (open ? paperSwish : sheetDown)();
    }
    was.current = open;
  }, [open]);
}

/**
 * The notepad as the game screen keeps it: what it holds (`useNotes`), whether N or a tab
 * opened it — then it takes the keys — and the hand it holds out to a source, a device or a
 * note (noting.ts): a capture goes down at the bottom with a pencil's scratch — one of the same
 * replaced, which the hand reports —, the pad opening where it was shut without taking the keys
 * from the page, and scrolling down to it.
 */
function useNotepad(roomCode: string | null, playerId: string, open: OpenNow) {
  const notes = useNotes(roomCode, playerId);
  useNotepadSounds(open.notes);
  const [focus, setFocus] = useState(true);
  const [jump, setJump] = useState(0);
  const toggle = (): void => {
    setFocus(true);
    open.toggleNotes();
  };
  const hand: NotepadHand = {
    noteDown: (capture) => {
      const taken = withCapture(notes.content, capture);
      notes.change(taken.content);
      setFocus(false);
      setJump((n) => n + 1);
      open.set({ notes: true });
      pencilScratch();
      return taken.replaced;
    },
    toggle,
  };
  return { notes, focus, jump, toggle, hand };
}

/**
 * The run around an open device as this player's view has it: its alarms — the latest one's
 * notice for the device's head — the stations solved, what the server refused, and the crew,
 * connected, in order, for the levers' names.
 */
export function deviceRunOf(view: PlayerView, refusal: Refusal | null): DeviceRun {
  return {
    alarms: view.penaltySeq,
    solved: view.currentPuzzleIndex,
    refusal,
    crew: {
      you: view.you.id,
      mates: view.players
        .filter((player) => player.connected)
        .map(({ id, name, color }) => ({ id, name, color })),
    },
    alarm: alarmNotice(view.events, view.alarms),
  };
}

/**
 * The station's panel, a source's pages or a note of the last shift over the
 * world, as this player opened them — the panel fading out once stepped back
 * from, pages and note on their way down once put down; the panel hears of
 * the run's alarms and solves, of the crew and of what the server refused
 * (`refusal`).
 */
function OverTheWorld({
  view,
  map,
  station,
  reading,
  note,
  send,
  refusal,
  onClose,
}: {
  view: PlayerView;
  map: MapView;
  station: Shown<PuzzleView> | null;
  reading: Shown<ManualHere> | null;
  note: Shown<NoteHere> | null;
  send: (msg: ClientMessage) => void;
  refusal: Refusal | null;
  onClose: () => void;
}) {
  const run = deviceRunOf(view, refusal);
  return (
    <>
      {station !== null && (
        <StationModal
          puzzle={station.item}
          run={run}
          map={map}
          edgework={view.edgework}
          mission={view}
          send={send}
          onStepBack={onClose}
          leaving={station.leaving}
        />
      )}
      {reading !== null && (
        // What the notepad takes down here is taken at this source: „Klemmbrett · Legende".
        <NotingPlace value={{ id: reading.item.id, name: placeName(reading.item.label) }}>
          <ReadingOverlay
            key={reading.item.id}
            manual={reading.item}
            puzzle={view.puzzle}
            current={view.currentPuzzleIndex}
            pausedAt={view.pausedAt}
            mission={view.missionTitle}
            map={map}
            edgework={view.edgework}
            onAskNote={() => send({ kind: 'request-hint' })}
            onPutDown={onClose}
            leaving={reading.leaving}
          />
        </NotingPlace>
      )}
      {note !== null && (
        <PinnedNote
          note={note.item}
          room={noteRoom(map, note.item.index)}
          edgework={view.edgework}
          onPutDown={onClose}
          leaving={note.leaving}
        />
      )}
    </>
  );
}

/**
 * The game's classes: while its end plays, the finale's; while the notepad stands beside
 * something over the world, `game--noting`, which sets it as a strip of its own
 * (styles/putdown.css); while the run's opening keeps the HUD out, `game--hud-held`
 * (styles/intro.css); on a phone held sideways, the HUD folded into one row, `game--row`
 * (hudFold.ts, styles/pwa.css).
 */
export function gameClass(
  finale: Finale | null,
  noting: boolean,
  hudOut = false,
  row = false,
): string {
  const ending = finale === null ? [] : ['game--finale', `game--${finale.ending.split(':')[0]}`];
  const extra = [
    ...(noting ? ['game--noting'] : []),
    ...(hudOut ? ['game--hud-held'] : []),
    ...(row ? ['game--row'] : []),
  ];
  return ['game', ...ending, ...extra].join(' ');
}

/** Whether the world is held for this player, whatever else: the end plays, or the line is down. */
export function worldHeld(finale: Finale | null, line: GameLine, view: PlayerView): boolean {
  return finale !== null || lineLost(line, view);
}

/**
 * Whether the world takes no keys: while it is held (`worldHeld`), the station's panel, pages
 * or a note lie over it, the run is paused or the relay console holds them. Pages on their way
 * down hold nothing: the player walks off at once.
 */
export function worldLocked(
  view: PlayerView,
  open: Pick<OpenNow, 'reading' | 'note'>,
  station: PuzzleView | null,
  held: boolean,
) {
  const relayUp = view.map?.sabotage?.relay !== undefined;
  const over = station !== null || open.reading !== null || open.note !== null;
  return held || over || view.pausedFor !== null || relayUp;
}

/**
 * The world as the running mission shows it to this player: the cold open, the end, the open
 * station — and E at a source, a note or the station opens it over the world.
 */
function RunWorld({
  game,
  coldOpen,
  intro,
  station,
  open,
  holdTips,
}: {
  game: Props;
  coldOpen: ColdOpen;
  /** the run's opening on this screen; none where it plays none */
  intro: IntroCue | null;
  station: PuzzleView | null;
  open: OpenNow;
  holdTips: boolean;
}) {
  const { view, finale } = game;
  return (
    <GameWorld
      view={view}
      intro={intro}
      positionsRef={game.positionsRef}
      dronesRef={game.dronesRef}
      pingsRef={game.pingsRef}
      chatsRef={game.chatsRef}
      spectator={false}
      darkSince={coldOpen.darkSince}
      finale={finale === null ? null : { ending: finale.ending, since: finale.since }}
      station={station}
      holdTips={holdTips}
      inputLocked={worldLocked(view, open, station, worldHeld(finale, game.line, view))}
      onToggleInfo={open.toggleInfo}
      onRead={(manualId) => open.set({ readingId: manualId })}
      onReadNote={(index) => open.set({ noteIndex: index })}
      onOperate={() => open.set({ operating: true })}
      send={game.send}
      listen={game.listen}
    />
  );
}

/** What the crew strip's buttons open: the notepad and the info panel. */
interface StripButtons {
  notesOpen: boolean;
  onToggleNotes: () => void;
  onOpenInfo: () => void;
}

/**
 * The crew strip as this window has it: under the world (`strip`), or on a phone held sideways
 * folded into the bar's row (hudFold.ts) — its parts for StageTop (`row`), nothing under the
 * world. `onAir` while a line is on the air over the world, which the strip then leaves to it.
 */
function useCrewStrip(
  game: Props,
  onAir: boolean,
  buttons: StripButtons,
): { row: RowParts | null; strip: ReactNode } {
  const folded = useHudRow();
  const { view, positionsRef, chatsRef } = game;
  if (folded) {
    const crew = <RowCrew view={view} positionsRef={positionsRef} />;
    return { row: { crew, tools: <RowTools {...buttons} /> }, strip: null };
  }
  const strip = (
    <MissionHud
      view={view}
      positionsRef={positionsRef}
      chatsRef={chatsRef}
      onAir={onAir}
      {...buttons}
    />
  );
  return { row: null, strip };
}

/** Whether the opening keeps the HUD out now: it fades, the tips and the sign's note wait. */
function hudOut(intro: Intro): boolean {
  return intro.cue !== null && hudHeld(intro.cue, Date.now());
}

/**
 * The running mission. It opens with the run's opening (world/intro/): a mission's intro as a
 * film over the lit lab, or a mission's name card, the HUD out until its title or its card is
 * gone. While its end plays in the world (`finale`), nothing lies over the world any more, the
 * controls are gone and the HUD fades, until the veil closes over the screen. The notepad
 * stands beside whatever lies over the world, as a strip of its own (`gameClass`), and a source
 * or a device hands it what is taken down (noting.ts); E, Esc or a step put a sheet down
 * (PutDown.tsx).
 */
export function GameScreen(props: Props) {
  const { view, roomCode, positionsRef, send, refusal, finale } = props;
  const { alarmVisible } = useFeedback(view);
  const intro = useIntro(view, send);
  const cue = intro.cue;
  const hudBack = cue === null ? null : hudBackAt(cue);
  const coldOpen = useColdOpen(view, cue !== null && cutIn(cue), hudBack);
  // While the opening keeps the HUD out the bar is faded: the sign's note waits for it.
  const heldNow = hudOut(intro);
  const notice = useNotices(view, heldNow ? { ...coldOpen.gates, sign: null } : coldOpen.gates);
  const open = useOpened(view);
  const station = useSolvedHold(open.station, view.currentPuzzleIndex);
  // Stepped back from, the device fades out as it came: held a moment, taking nothing more.
  const panel = useLeaving(station, PANEL_FADE_MS);
  useReaderHearsSolve(view, station !== null);
  const sheets = useSheets(open);
  const pad = useNotepad(roomCode, view.you.id, open);
  const closeModal = (): void => open.set(NOTHING_OVER);
  const { keys } = useSettings();
  useKeys([keys.notes], pad.toggle);
  useKeys(putDownKeys(overOf(open), keys), closeModal);
  useEscapeCloses(open, closeModal);
  // Until the click of the cold open the strip keeps quiet: the opener has the banner.
  const crewStrip = useCrewStrip(props, notice?.kind === 'line' || !coldOpen.dark, {
    notesOpen: open.notes,
    onToggleNotes: pad.toggle,
    onOpenInfo: () => open.set({ info: true }),
  });
  const map = view.map;
  if (map === null) {
    return <p className="muted">Lade Mission …</p>;
  }
  const self = startingSpot(positionsRef.current, view.you.id, map, view.startedAt);
  const live = finale === null;
  const over = station !== null || sheets.reading !== null || sheets.note !== null;
  const held = live && heldNow;
  const row = crewStrip.row;
  return (
    <div className={gameClass(finale, live && open.notes && over, held, row !== null)}>
      {live && (
        <RunOverlays
          view={view}
          coldOpen={coldOpen}
          send={send}
          refusal={refusal}
          line={props.line}
        />
      )}
      <div className="stage">
        <StageTop
          view={view}
          map={map}
          coldOpen={coldOpen}
          notice={notice}
          alarmVisible={alarmVisible}
          deviceOpen={live && station !== null}
          self={self}
          row={row}
        />
        <RunWorld
          game={props}
          coldOpen={coldOpen}
          intro={intro.cue}
          station={station}
          open={open}
          holdTips={notice !== null || held}
        />
        {live && cue !== null && <IntroOverlay cue={cue} view={view} skip={intro.skip} />}
        {live && open.notes && (
          <Notepad
            notes={pad.notes}
            edgework={view.edgework}
            focus={pad.focus}
            jump={pad.jump}
            onClose={() => open.set({ notes: false })}
          />
        )}
      </div>
      {live && (
        <NotepadContext value={pad.hand}>
          <OverTheWorld
            view={view}
            map={map}
            station={panel}
            reading={sheets.reading}
            note={sheets.note}
            send={send}
            refusal={refusal}
            onClose={closeModal}
          />
        </NotepadContext>
      )}
      {crewStrip.strip}
      {live && open.info && <InfoPanel view={view} onClose={() => open.set({ info: false })} />}
      {finale !== null && <FinaleVeil ending={finale.ending} since={finale.since} />}
    </div>
  );
}
