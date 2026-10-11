import { useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  DronePosition,
  PlayerPosition,
  PlayerView,
  PuzzleView,
  RunEvent,
} from '@escapelab/core';
import { BANNER_MS, radioNews } from '../radio.js';
import { play } from '../sounds.js';
import { radioChirp } from '../world/audio.js';
import { GameWorld, type ChatLine, type MapPing } from '../world/GameWorld.js';
import { PuzzlePanel } from './PuzzlePanel.js';
import { MissionHud } from './MissionHud.js';
import { InfoPanel } from './InfoPanel.js';
import { Manual } from './Manual.js';
import { EdgeworkChip } from './EdgeworkChip.js';

interface Props {
  view: PlayerView;
  positionsRef: React.MutableRefObject<Record<string, PlayerPosition>>;
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

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
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
        <span className="sabotage-label">🚨 {sabotage.label}</span>
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

function Countdown({ deadlineAt }: { deadlineAt: number }) {
  const now = useNow(200);
  const left = deadlineAt - now;
  const stage = left < 10_000 ? 'final' : left < 60_000 ? 'critical' : '';
  return <div className={`countdown ${stage}`}>{formatRemaining(deadlineAt, now)}</div>;
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

/** Mission briefing shown for the first seconds after launch. */
function Briefing({ view }: { view: PlayerView }) {
  const now = useNow(200);
  const startedAt = view.startedAt ?? now;
  const msIn = now - startedAt;
  if (msIn > BRIEFING_MS) {
    return null;
  }
  const count = msIn < 1200 ? 3 : msIn < 2400 ? 2 : 1;
  return (
    <div className="overlay briefing">
      <span className="kicker">MISSION GESTARTET</span>
      <h1>{view.missionTitle}</h1>
      <p>Du bist: <strong>{view.players.find((p) => p.id === view.you.id)?.roleName}</strong></p>
      <div className="briefing-count">{count}</div>
    </div>
  );
}

/**
 * Mission control's side of a station, the same for every role: the hints
 * given so far and the button for the next one, which unlocks after a wait.
 */
function HintStrip({
  hints,
  send,
}: {
  hints: PuzzleView['hints'];
  send: (msg: ClientMessage) => void;
}) {
  const now = useNow(1000);
  if (hints.shown.length === 0 && hints.left === 0) {
    return null;
  }
  const waitSec = hints.readyAt === null ? 0 : Math.ceil((hints.readyAt - now) / 1000);
  return (
    <section className="hint-strip" aria-label="Hinweise der Leitstelle">
      <span className="kicker">LEITSTELLE</span>
      {hints.shown.length > 0 && (
        <ol className="hint-list">
          {hints.shown.map((text, i) => (
            <li key={i}>
              <span aria-hidden="true">📻</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      )}
      {hints.left > 0 && (
        <button
          className="hint-request"
          disabled={waitSec > 0}
          onClick={() => send({ kind: 'request-hint' })}
        >
          {waitSec > 0 ? `Hinweis in ${waitSec} s` : `Hinweis anfordern · −${hints.costSec} s`}
        </button>
      )}
    </section>
  );
}

/** Whose station this is, and the edgework within reach for roles that read it out. */
function StationHead({ role, edgework }: { role: string; edgework: PlayerView['edgework'] }) {
  return (
    <div className="panel-head">
      <div className="panel-label">// STATION: {role}</div>
      {edgework !== null && <EdgeworkChip edgework={edgework} />}
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
      if (view.map === null) {
        play('alarm'); // mapped missions get their alarm from the world audio layer
      }
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
  }, [view.penaltySeq, view.map]);

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
 * The mission-control line on the air right now, if any. A fresh batch of
 * lines replaces whatever was still waiting — it is the newer news — and is
 * read out one line at a time, each with a chirp. Nothing goes on the air
 * while the briefing still covers the screen.
 */
function useRadioBanner(view: PlayerView): RunEvent | null {
  const seen = useRef(0);
  const [queue, setQueue] = useState<RunEvent[]>([]);
  const [onAir, setOnAir] = useState<RunEvent | null>(null);

  useEffect(() => {
    const news = radioNews(view.events, seen.current, Date.now());
    seen.current = view.events.length;
    if (news.length > 0) {
      setQueue(news);
    }
  }, [view.events]);

  const next = queue[0] ?? null;
  const briefingEnds = (view.startedAt ?? 0) + BRIEFING_MS;
  useEffect(() => {
    if (next === null) {
      setOnAir(null);
      return undefined;
    }
    const wait = Math.max(0, briefingEnds - Date.now());
    const on = setTimeout(() => {
      radioChirp();
      setOnAir(next);
    }, wait);
    const off = setTimeout(() => setQueue((lines) => lines.slice(1)), wait + BANNER_MS);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [next, briefingEnds]);

  return onAir;
}

// --- screen ------------------------------------------------------------------

export function GameScreen({ view, positionsRef, dronesRef, pingsRef, chatsRef, send }: Props) {
  const { shaking, alarmVisible, stamp } = useFeedback(view);
  const radioLine = useRadioBanner(view);
  const [infoOpen, setInfoOpen] = useState(false);
  const puzzle = view.puzzle;
  const map = view.map;
  if (puzzle === null && map === null) {
    return <p className="muted">Lade Mission …</p>;
  }
  const myRole = view.players.find((p) => p.id === view.you.id)?.roleName ?? '—';
  const armedTitle = map?.stations.find((s) => s.status === 'armed')?.title ?? null;
  const escaping = map?.exit?.open === true;
  const missing = map?.items.filter((i) => !i.delivered).map((i) => i.label) ?? [];
  const missingLabel =
    escaping || missing.length === 0 ? null : `${missing.join(', ')} fehlt noch`;
  const title =
    puzzle !== null
      ? puzzle.title
      : escaping
        ? '🏃 NOTAUSGANG — alle raus, JETZT!'
        : (armedTitle ?? 'Alle Stationen erledigt');

  return (
    <div className={`game ${shaking ? 'shake' : ''}`}>
      {view.deadlineAt !== null && <CriticalVignette deadlineAt={view.deadlineAt} />}
      <Briefing view={view} />
      {stamp && (
        <div className="overlay stamp" aria-hidden="true">
          <span>✔ SYSTEM ONLINE</span>
        </div>
      )}

      {map === null && (
        <div className="game-header">
          <div>
            <div
              className="led-strip"
              aria-label={`Rätsel ${view.currentPuzzleIndex + 1} von ${view.puzzleCount}`}
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
            <h1>{title}</h1>
          </div>
          {view.deadlineAt !== null && <Countdown deadlineAt={view.deadlineAt} />}
        </div>
      )}

      {puzzle !== null && map === null && <p className="story">{puzzle.prompt}</p>}

      {map !== null && <SabotageAlert sabotage={map.sabotage} />}

      {alarmVisible && view.lastPenaltySec !== null && (
        <div key={view.penaltySeq} className="alarm">
          🚨 ALARM — Fehlversuch! −{view.lastPenaltySec} Sekunden
        </div>
      )}

      {view.pausedFor !== null && (
        <div className="overlay pause" role="status">
          <span className="kicker">MISSION PAUSIERT</span>
          <h1>⏸ Verbindung verloren</h1>
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

      {map !== null && (
        <div className="stage">
          <div className="stage-top">
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
              <h1>{title}</h1>
              {missingLabel !== null && <span className="stage-sub">{missingLabel}</span>}
            </div>
            {view.deadlineAt !== null && <Countdown deadlineAt={view.deadlineAt} />}
            {radioLine !== null && (
              <div
                key={`${radioLine.at}-${radioLine.label}`}
                className="radio-banner"
                role="status"
              >
                <span className="radio-banner-from">📻 LEITSTELLE</span> — {radioLine.label}
              </div>
            )}
          </div>
          <GameWorld
            view={view}
            positionsRef={positionsRef}
            dronesRef={dronesRef}
            pingsRef={pingsRef}
            chatsRef={chatsRef}
            spectator={false}
            holdTips={radioLine !== null}
            inputLocked={puzzle !== null || view.pausedFor !== null}
            onToggleInfo={() => setInfoOpen((open) => !open)}
            send={send}
          />
        </div>
      )}

      {puzzle !== null &&
        (map !== null ? (
          <div className="puzzle-modal" role="dialog" aria-modal="true">
            <div className="panel">
              <StationHead role={myRole} edgework={view.edgework} />
              <p className="story">{puzzle.prompt}</p>
              {puzzle.info !== null && <div className="info-box">📖 {puzzle.info}</div>}
              {puzzle.manual !== null && <Manual sections={puzzle.manual} />}
              <PuzzlePanel puzzle={puzzle} send={send} deadlineAt={view.deadlineAt} />
              <HintStrip hints={puzzle.hints} send={send} />
            </div>
          </div>
        ) : (
          <div className="panel">
            <StationHead role={myRole} edgework={view.edgework} />
            {puzzle.info !== null && <div className="info-box">📖 {puzzle.info}</div>}
            {puzzle.manual !== null && <Manual sections={puzzle.manual} />}
            <PuzzlePanel puzzle={puzzle} send={send} deadlineAt={view.deadlineAt} />
          </div>
        ))}

      {map !== null ? (
        <MissionHud
          view={view}
          positionsRef={positionsRef}
          chatsRef={chatsRef}
          onOpenInfo={() => setInfoOpen(true)}
        />
      ) : (
        <ul className="players inline">
          {view.players.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'offline'}>
              {p.name} · {p.roleName ?? '—'}
              {p.connected ? '' : ' ⚠ getrennt'}
            </li>
          ))}
        </ul>
      )}

      {infoOpen && <InfoPanel view={view} onClose={() => setInfoOpen(false)} />}
    </div>
  );
}
