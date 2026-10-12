import { useEffect, useState } from 'react';
import type { PlayerPosition, DronePosition, SpectatorView } from '@escapelab/core';
import { GameWorld, type ChatLine, type MapPing } from '../world/GameWorld.js';
import { RelayConsole } from '../puzzles/RelayPanel.js';
import { PuzzlePanel } from './PuzzlePanel.js';
import { Manual } from './Manual.js';
import { EdgeworkChip } from './EdgeworkChip.js';

interface Props {
  view: SpectatorView;
  positionsRef: React.MutableRefObject<Record<string, PlayerPosition>>;
  dronesRef: React.MutableRefObject<Record<string, DronePosition>>;
  pingsRef: React.MutableRefObject<MapPing[]>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  leaveRoom: () => void;
}

function remaining(deadlineAt: number, now: number): string {
  const total = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Run time of an event as mm:ss, the way a match log reads. */
function elapsed(startedAt: number | null, at: number): string {
  const total = startedAt === null ? 0 : Math.max(0, Math.floor((at - startedAt) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Audience view: the whole lab revealed, plus the open station from every side. */
export function SpectateScreen({
  view,
  positionsRef,
  dronesRef,
  pingsRef,
  chatsRef,
  leaveRoom,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const noop = (): void => undefined;
  const feed = view.events.slice(-14).reverse();

  return (
    <div className="spectate">
      <div className="spectate-head">
        <div>
          <span className="kicker">ZUSCHAUERMODUS · {view.difficulty}</span>
          <h1>{view.missionTitle}</h1>
        </div>
        <div className="spectate-stats">
          {view.deadlineAt !== null && view.phase === 'playing' && (
            <span className="countdown">{remaining(view.deadlineAt, now)}</span>
          )}
          <span className="pill">
            {view.currentPuzzleIndex}/{view.puzzleCount} Stationen · {view.penaltySeq} Alarme
          </span>
        </div>
      </div>

      {view.phase !== 'playing' && (
        <div className={`banner-result ${view.phase === 'won' ? 'won' : ''}`}>
          {view.phase === 'lobby' && 'Die Crew ist noch in der Lobby …'}
          {view.phase === 'won' && `✔ Geschafft${view.grade === null ? '' : ` — Rang ${view.grade.rank}`}`}
          {view.phase === 'lost' && '✖ Gescheitert'}
        </div>
      )}

      {view.pausedFor !== null && (
        <div className="banner-result">⏸ Pausiert — warten auf {view.pausedFor.join(', ')}</div>
      )}

      <div className="spectate-body">
        <div className="spectate-world">
          {view.map !== null && (
            <GameWorld
              view={spectatorAsPlayerView(view)}
              positionsRef={positionsRef}
              dronesRef={dronesRef}
              pingsRef={pingsRef}
              chatsRef={chatsRef}
              spectator
              inputLocked
              holdTips={false}
              onToggleInfo={noop}
              send={noop}
            />
          )}
        </div>

        <div className="spectate-panels">
          <section className="panel">
            <div className="panel-head">
              <div className="panel-label">// {view.puzzle?.title ?? 'Station'}</div>
              {view.edgework !== null && <EdgeworkChip edgework={view.edgework} />}
            </div>
            {view.puzzle === null ? (
              <p className="muted">Unterwegs — gerade keine Station offen.</p>
            ) : (
              <>
                {view.puzzle.manual !== null && <Manual sections={view.puzzle.manual} />}
                <div className="read-only">
                  <PuzzlePanel puzzle={view.puzzle} send={noop} deadlineAt={view.deadlineAt} />
                </div>
              </>
            )}
          </section>
          {view.panels.map(
            (panel) =>
              panel.emergency !== undefined && (
                <section key={panel.roleId} className="panel">
                  <div className="panel-label">// {panel.roleName}</div>
                  <div className="read-only">
                    <RelayConsole relay={panel.emergency} send={noop} />
                  </div>
                </section>
              ),
          )}

          <section className="panel spectate-log">
            <div className="panel-label">// Einsatzprotokoll</div>
            {feed.length === 0 ? (
              <p className="muted">Noch nichts passiert.</p>
            ) : (
              <ul className="ticker">
                {feed.map((event, i) => (
                  <li key={`${event.at}-${i}`} className={`ticker-${event.kind}`}>
                    <span className="ticker-time">{elapsed(view.startedAt, event.at)}</span>
                    {event.label}
                    {event.seconds !== null ? ` (−${event.seconds}s)` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="spectate-foot">
        <ul className="players inline">
          {view.players.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'offline'}>
              <span className="crew-dot" style={{ background: p.color }} aria-hidden="true" />
              {p.name} · {p.roleName ?? '—'}
            </li>
          ))}
        </ul>
        <button className="link" onClick={leaveRoom}>
          Zuschauen beenden
        </button>
      </div>
    </div>
  );
}

/**
 * GameWorld renders from a player's view; an audience has no player, so we
 * hand it a stand-in whose fields it actually reads in spectator mode.
 */
function spectatorAsPlayerView(view: SpectatorView): Parameters<typeof GameWorld>[0]['view'] {
  return {
    phase: view.phase,
    missionId: '',
    missionTitle: view.missionTitle,
    difficulty: view.difficulty,
    storyText: view.storyText,
    you: { id: '', name: '', roleId: null, color: '#2dd4bf', ready: false, isHost: false },
    players: view.players.map((p) => ({
      id: p.id,
      name: p.name,
      roleId: null,
      roleName: p.roleName,
      color: p.color,
      ready: false,
      connected: p.connected,
      isHost: false,
    })),
    palette: [],
    roles: [],
    deadlineAt: view.deadlineAt,
    startedAt: view.startedAt,
    finishedAt: view.finishedAt,
    timeLimitSec: view.timeLimitSec,
    currentPuzzleIndex: view.currentPuzzleIndex,
    puzzleCount: view.puzzleCount,
    pausedFor: view.pausedFor,
    events: view.events,
    grade: view.grade,
    penaltySeq: view.penaltySeq,
    lastPenaltySec: null,
    hintsUsed: view.hintsUsed,
    edgework: null,
    presence: { stationId: null, manualId: null, signSeen: false },
    manualsHere: [],
    puzzle: null,
    map: view.map,
  };
}
