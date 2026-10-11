import { useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  DronePosition,
  PlayerPosition,
  PlayerView,
} from '@escapelab/core';
import { play } from '../sounds.js';
import { GameWorld, type ChatLine, type MapPing } from '../world/GameWorld.js';
import { PuzzlePanel } from './PuzzlePanel.js';

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
  const now = useNow(250);
  const critical = deadlineAt - now < 60_000;
  return (
    <div className={`countdown ${critical ? 'critical' : ''}`}>
      {formatRemaining(deadlineAt, now)}
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

/** Mission briefing shown for the first seconds after launch. */
function Briefing({ view }: { view: PlayerView }) {
  const now = useNow(200);
  const startedAt = view.startedAt ?? now;
  const msIn = now - startedAt;
  if (msIn > 3600) {
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


// --- screen ------------------------------------------------------------------

export function GameScreen({ view, positionsRef, dronesRef, pingsRef, chatsRef, send }: Props) {
  const { shaking, alarmVisible, stamp } = useFeedback(view);
  const puzzle = view.puzzle;
  const map = view.map;
  if (puzzle === null && map === null) {
    return <p className="muted">Lade Mission …</p>;
  }
  const myRole = view.players.find((p) => p.id === view.you.id)?.roleName ?? '—';
  const armedTitle = map?.stations.find((s) => s.status === 'armed')?.title ?? null;
  const escaping = map?.exit?.open === true;
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
          <h1>{puzzle === null && !escaping ? `Nächste Station: ${title}` : title}</h1>
        </div>
        {view.deadlineAt !== null && <Countdown deadlineAt={view.deadlineAt} />}
      </div>

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
        <GameWorld
          view={view}
          positionsRef={positionsRef}
          dronesRef={dronesRef}
          pingsRef={pingsRef}
          chatsRef={chatsRef}
          spectator={false}
          inputLocked={puzzle !== null || view.pausedFor !== null}
          send={send}
        />
      )}

      {puzzle !== null &&
        (map !== null ? (
          <div className="puzzle-modal" role="dialog" aria-modal="true">
            <div className="panel">
              <div className="panel-label">// STATION: {myRole}</div>
              <p className="story">{puzzle.prompt}</p>
              {puzzle.info !== null && <div className="info-box">📖 {puzzle.info}</div>}
              <PuzzlePanel puzzle={puzzle} send={send} />
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="panel-label">// STATION: {myRole}</div>
            {puzzle.info !== null && <div className="info-box">📖 {puzzle.info}</div>}
            <PuzzlePanel puzzle={puzzle} send={send} />
          </div>
        ))}

      <ul className="players inline">
        {view.players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'offline'}>
            {p.name} · {p.roleName ?? '—'}
            {p.connected ? '' : ' ⚠ getrennt'}
          </li>
        ))}
      </ul>
    </div>
  );
}
