import { useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  DronePosition,
  ManualHere,
  MapView,
  PlayerView,
  PuzzleView,
} from '@escapelab/core';
import { useKeys, useMedia, useNow } from '../hooks.js';
import {
  AFTER_SOLVE_MS,
  airIcon,
  bannerFrom,
  followsSolve,
  noticeMs,
  radioNews,
  withNews,
  type Notice,
} from '../radio.js';
import { deviceCoach, firstSight, SHOWN_MARKS, type CoachMark } from '../puzzles/coach.js';
import { useSolvedHold, type DeviceRun } from '../puzzles/Device.js';
import { RelayConsole } from '../puzzles/RelayPanel.js';
import {
  ALARM_NOTICE_MS,
  alarmLine,
  alarmNotice,
  type AlarmNotice,
} from '../world/alarm.js';
import { briefingCountdown, radioChirp } from '../world/audio.js';
import { opensLit, REVEAL_MS, useDarkSince, useRevealed } from '../world/coldOpen.js';
import { consoleName } from '../world/consoles.js';
import { escapeChecklist, escaping, type Mate } from '../world/escape.js';
import { REDUCED_MOTION, veilOf, type Ending, type Finale } from '../world/finale.js';
import { GameWorld } from '../world/GameWorld.js';
import { dueParts } from '../world/markers.js';
import { startingSpot, type KnownPositions } from '../world/movement.js';
import type { ChatLine, MapPing } from '../world/render/frame.js';
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
  /**
   * what the server has refused of this player's inputs so far (ws.ts): the
   * open device or relay console shakes the press a new refusal answers
   */
  refusals: number;
  /** the run's end, while the world still plays it on this screen (finale.ts); none before */
  finale: Finale | null;
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
  refusals,
}: {
  sabotage: Sabotage;
  relay: NonNullable<Sabotage['relay']>;
  send: (msg: ClientMessage) => void;
  refusals: number;
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
        <RelayConsole
          relay={relay}
          send={(input) => send({ kind: 'puzzle-input', input })}
          refusals={refusals}
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
 * The mission clock. Until `flashUntil` (epoch ms) — where it has just
 * started on this screen — its digits flash red, once; then as `clockStage`
 * has it.
 */
function Countdown({
  deadlineAt,
  flashUntil,
  escaping,
}: {
  deadlineAt: number;
  flashUntil: number | null;
  escaping: boolean;
}) {
  const now = useNow(200);
  const stage = clockStage(deadlineAt - now, escaping);
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
 * a chirp (see `withNews` for a fresh batch) — a line that comes with a solve
 * AFTER_SOLVE_MS later, so that the win is seen first — and the note once
 * this player has walked up to the Laborkennung. Nothing shows before its
 * gate opens. A player who spawns at the sign gets the note too; one who
 * reconnects later does not, they read it before.
 */
function useNotices(view: PlayerView, gates: NoticeGates): Notice | null {
  const seen = useRef(0);
  const [queue, setQueue] = useState<Notice[]>([]);
  const [shown, setShown] = useState<Notice | null>(null);
  const briefingEnds = (view.startedAt ?? 0) + BRIEFING_MS;

  useEffect(() => {
    const now = Date.now();
    const news = radioNews(view.events, seen.current, now);
    const notBefore = followsSolve(view.events, seen.current) ? now + AFTER_SOLVE_MS : 0;
    seen.current = view.events.length;
    if (news.length > 0) {
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
    const wait = Math.max(0, from - Date.now());
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

/**
 * The open station over the world: its device, which names it on its plate
 * and says on its LED strip who backs this player up — and, the first time,
 * the line that says what its controls do, under the Laborkennung's row,
 * where it covers neither the serial nor the device.
 */
export function StationModal({
  puzzle,
  run,
  map,
  edgework,
  deadlineAt,
  send,
  onClose,
}: {
  puzzle: PuzzleView;
  /** the run around the device: its alarms, the stations solved, the crew */
  run: DeviceRun;
  map: MapView;
  edgework: PlayerView['edgework'];
  deadlineAt: number | null;
  send: (msg: ClientMessage) => void;
  onClose: () => void;
}) {
  const coach = useDeviceCoach(puzzle);
  return (
    <WorldModal
      kind="station"
      label={stationLabel(puzzle, map)}
      edgework={edgework}
      onClose={onClose}
    >
      {coach !== null && (
        <p className="station-coach" role="note">
          {coach.text}
        </p>
      )}
      <PuzzlePanel puzzle={puzzle} run={run} send={send} deadlineAt={deadlineAt} />
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

/** Where a player stands, in tiles. */
type Point = { x: number; y: number };

/**
 * The goal line for a player standing at `self`: the station, or the way out — and under it
 * what the station in front of the crew lacks, and what the one after it will (hands are free
 * to carry it now) or what lies in sight; a part for a station further on waits (`dueParts`).
 */
function goalOf(view: PlayerView, map: MapView, self: Point): Goal {
  const armedTitle = map.stations.find((s) => s.status === 'armed')?.title ?? null;
  const out = escaping(map);
  const parts = dueParts(map, self);
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
        : out
          ? 'ALLE ZUM NOTAUSGANG'
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
      {room !== null && <span className="stage-sub">Du startest im {room}</span>}
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

/**
 * The objective bar over the world: the goal and the clock — while the lab
 * still has its power, its name and NORMALBETRIEB instead — then whatever
 * is on the air, the emergency and the alarm. While a device is open
 * (`deviceOpen`) the alarm shows in its head instead: here it would lie half
 * under it.
 */
export function StageTop({
  view,
  map,
  coldOpen,
  notice,
  alarmVisible,
  deviceOpen = false,
  self = spawnOf(map),
}: {
  view: PlayerView;
  map: MapView;
  coldOpen: ColdOpen;
  notice: Notice | null;
  alarmVisible: boolean;
  deviceOpen?: boolean;
  /** where this player stands, for what lies in their sight; their spawn by default */
  self?: Point;
}) {
  const relay = map.sabotage?.relay;
  const alarm = alarmVisible && !deviceOpen ? alarmNotice(view.events, view.alarms) : null;
  return (
    <div className="stage-top">
      {coldOpen.dark ? (
        <StageGoal view={view} map={map} goal={goalOf(view, map, self)} />
      ) : (
        <PowerGoal view={view} map={map} />
      )}
      <div className="stage-clock">
        {!coldOpen.dark ? (
          <PowerStatus />
        ) : (
          view.deadlineAt !== null && (
            <Countdown
              deadlineAt={view.deadlineAt}
              flashUntil={coldOpen.flashUntil}
              escaping={escaping(map)}
            />
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
  const reduced = useMedia(REDUCED_MOTION);
  const [shown] = useState(() => Date.now());
  const veil = veilOf(ending, reduced);
  const timing = {
    animationDelay: `${Math.round(since + veil.delay - shown)}ms`,
    animationDuration: `${Math.round(veil.duration)}ms`,
  };
  return <div className={`finale-veil finale-veil--${veil.tone}`} style={timing} aria-hidden="true" />;
}

// --- screen ------------------------------------------------------------------

/** The run frozen for a missing crew member: whom the crew waits for. */
function PauseOverlay({ pausedFor }: { pausedFor: string[] }) {
  return (
    <div className="overlay pause" role="status">
      <span className="kicker">MISSION PAUSIERT</span>
      <h1>
        <Icon name="pause" /> Verbindung verloren
      </h1>
      <p>
        {pausedFor.length > 0
          ? `Warten auf ${pausedFor.join(', ')} — Uhr, Patrouillen und Notfälle stehen still.`
          : 'Warten auf die Crew — Uhr, Patrouillen und Notfälle stehen still.'}
      </p>
      <p className="muted">Wer getrennt wurde, lädt einfach die Seite neu und ist wieder dabei.</p>
    </div>
  );
}

/**
 * What comes and goes over a run: the briefing, the pause. The clock's red
 * edge is the world's to draw (world/vignette.ts).
 */
function RunOverlays({ view, coldOpen }: { view: PlayerView; coldOpen: ColdOpen }) {
  return (
    <>
      {!coldOpen.intro && <Briefing view={view} />}
      {view.pausedFor !== null && <PauseOverlay pausedFor={view.pausedFor} />}
    </>
  );
}

/** Escape closes what lies on top: the info panel, a panel or pages, then the notepad. */
function useEscapeCloses(open: ReturnType<typeof useOpened>, closeModal: () => void): void {
  useEscape(() => {
    if (open.info) {
      open.set({ info: false });
    } else if (open.station !== null || open.reading !== null) {
      closeModal();
    } else {
      open.set({ notes: false });
    }
  });
}

/**
 * The run around an open device as this player's view has it: its alarms — the latest one's
 * notice for the device's head — the stations solved, what the server refused, and the crew,
 * connected, in order, for the levers' names.
 */
export function deviceRunOf(view: PlayerView, refusals: number): DeviceRun {
  return {
    alarms: view.penaltySeq,
    solved: view.currentPuzzleIndex,
    refusals,
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
 * The station's panel or a source's pages over the world, as this player
 * opened them; the panel hears of the run's alarms and solves, of the crew
 * and of what the server refused (`refusals`).
 */
function OverTheWorld({
  view,
  map,
  station,
  reading,
  send,
  refusals,
  onClose,
}: {
  view: PlayerView;
  map: MapView;
  station: PuzzleView | null;
  reading: ManualHere | null;
  send: (msg: ClientMessage) => void;
  refusals: number;
  onClose: () => void;
}) {
  const run = deviceRunOf(view, refusals);
  return (
    <>
      {station !== null && (
        <StationModal
          puzzle={station}
          run={run}
          map={map}
          edgework={view.edgework}
          deadlineAt={view.deadlineAt}
          send={send}
          onClose={onClose}
        />
      )}
      {reading !== null && (
        <ReadingOverlay
          key={reading.id}
          manual={reading}
          puzzle={view.puzzle}
          current={view.currentPuzzleIndex}
          mission={view.missionTitle}
          map={map}
          edgework={view.edgework}
          onAskNote={() => send({ kind: 'request-hint' })}
          onClose={onClose}
        />
      )}
    </>
  );
}

/**
 * The running mission. While its end plays in the world (`finale`), nothing
 * lies over the world any more, the controls are gone and the HUD fades,
 * until the veil closes over the screen.
 */
export function GameScreen({
  view,
  roomCode,
  positionsRef,
  dronesRef,
  pingsRef,
  chatsRef,
  send,
  refusals,
  finale,
}: Props) {
  const { alarmVisible } = useFeedback(view);
  const coldOpen = useColdOpen(view);
  const notice = useNotices(view, coldOpen.gates);
  const open = useOpened(view);
  const station = useSolvedHold(open.station, view.currentPuzzleIndex);
  const notes = useNotes(roomCode, view.you.id);
  const closeModal = (): void => open.set({ operating: false, readingId: null });
  useKeys(['n'], open.toggleNotes);
  useEscapeCloses(open, closeModal);
  const map = view.map;
  if (map === null) {
    return <p className="muted">Lade Mission …</p>;
  }
  const relay = map.sabotage?.relay;
  const self = startingSpot(positionsRef.current, view.you.id, map, view.startedAt);
  const missingLabel = coldOpen.dark ? goalOf(view, map, self).missing : null;
  const live = finale === null;
  const ending = finale === null ? 'game' : `game game--finale game--${finale.ending.split(':')[0]}`;

  return (
    <div className={ending}>
      {live && <RunOverlays view={view} coldOpen={coldOpen} />}
      {live && map.sabotage !== null && relay !== undefined && (
        <RelayAlert sabotage={map.sabotage} relay={relay} send={send} refusals={refusals} />
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
        />
        <GameWorld
          view={view}
          positionsRef={positionsRef}
          dronesRef={dronesRef}
          pingsRef={pingsRef}
          chatsRef={chatsRef}
          spectator={false}
          darkSince={coldOpen.darkSince}
          finale={finale === null ? null : { ending: finale.ending, since: finale.since }}
          station={station}
          holdTips={notice !== null}
          inputLocked={
            !live ||
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
        {live && open.notes && (
          <Notepad notes={notes} edgework={view.edgework} onClose={() => open.set({ notes: false })} />
        )}
      </div>

      {live && (
        <OverTheWorld
          view={view}
          map={map}
          station={station}
          reading={open.reading}
          send={send}
          refusals={refusals}
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

      {live && open.info && <InfoPanel view={view} onClose={() => open.set({ info: false })} />}
      {finale !== null && <FinaleVeil ending={finale.ending} since={finale.since} />}
    </div>
  );
}
