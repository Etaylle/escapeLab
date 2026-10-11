import { useEffect, useState } from 'react';
import { chatText, type PlayerPosition, type PlayerView } from '@escapelab/core';
import type { ChatLine } from '../world/GameWorld.js';

interface Props {
  view: PlayerView;
  positionsRef: React.MutableRefObject<Record<string, PlayerPosition>>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
}

const STATUS_SAMPLE_MS = 300;
const LOG_LINES = 5;

type Status = { text: string; tone: 'ok' | 'warn' | 'idle' };

/**
 * What each crew member is doing right now, derived from the live positions
 * the renderer already receives — purely informational, so computing it on
 * the client is enough.
 */
function statusOf(
  view: PlayerView,
  playerId: string,
  positions: Record<string, PlayerPosition>,
): Status {
  const player = view.players.find((p) => p.id === playerId);
  if (player === undefined || !player.connected) {
    return { text: 'getrennt', tone: 'warn' };
  }
  const map = view.map;
  const carried = map?.items.find((item) => item.carriedBy === playerId && !item.delivered);
  if (carried !== undefined) {
    return { text: `trägt ${carried.label}`, tone: 'ok' };
  }
  const pos = positions[playerId];
  if (map === null || map === undefined || pos === undefined) {
    return { text: 'bereit', tone: 'idle' };
  }
  const near = (x: number, y: number, r: number): boolean =>
    Math.hypot(pos.x - (x + 0.5), pos.y - (y + 0.5)) <= r;

  const plate = map.plates.find((p) => p.pressed && near(p.x, p.y, 0.8));
  if (plate !== undefined) {
    return { text: 'hält die Platte', tone: 'ok' };
  }
  const panel = map.sabotage?.panels.find((p) => near(p.x, p.y, 0.9));
  if (panel !== undefined) {
    return { text: 'am Notventil', tone: 'ok' };
  }
  const station = map.stations.find((s) => s.status === 'armed' && near(s.x, s.y, 1.6));
  if (station !== undefined) {
    return { text: 'an der Station', tone: 'ok' };
  }
  return { text: 'unterwegs', tone: 'idle' };
}

/**
 * The permanent bar under the world: what the crew is supposed to do, who is
 * doing what, and what just happened.
 */
export function MissionHud({ view, positionsRef, chatsRef }: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), STATUS_SAMPLE_MS);
    return () => clearInterval(timer);
  }, []);
  void tick;

  const positions = positionsRef.current;
  const myRole = view.roles.find((r) => r.id === view.you.roleId);
  const armed = view.map?.stations.find((s) => s.status === 'armed');
  const escaping = view.map?.exit?.open === true;
  const pending = view.map?.items.filter((i) => !i.delivered) ?? [];

  const chat = chatsRef.current.slice(-LOG_LINES).map((line) => ({
    at: line.at,
    label: `${view.players.find((p) => p.id === line.playerId)?.name ?? '?'}: ${chatText(line.phrase)}`,
  }));
  const events = view.events.slice(-LOG_LINES).map((e) => ({
    at: e.at,
    label: e.seconds === null ? e.label : `${e.label} (−${e.seconds}s)`,
  }));
  const log = [...events, ...chat].slice(-LOG_LINES).reverse();

  return (
    <section className="hud">
      <div className="hud-col">
        <h3>Auftrag</h3>
        {escaping ? (
          <p className="hud-objective">🚪 Alle zum Notausgang — gemeinsam raus!</p>
        ) : (
          <p className="hud-objective">
            {view.puzzle !== null
              ? view.puzzle.title
              : (armed?.title ?? 'Alle Stationen erledigt')}
          </p>
        )}
        <p className="muted">
          Station {Math.min(view.currentPuzzleIndex + 1, view.puzzleCount)} von{' '}
          {view.puzzleCount}
          {pending.length > 0 && ` · ${pending.map((i) => i.label).join(', ')} fehlt noch`}
        </p>
      </div>

      <div className="hud-col">
        <h3>Deine Rolle — {myRole?.name ?? '—'}</h3>
        <p className="muted hud-role">{myRole?.description ?? ''}</p>
      </div>

      <div className="hud-col">
        <h3>Crew</h3>
        <ul className="hud-crew">
          {view.players.map((p) => {
            const status = statusOf(view, p.id, positions);
            return (
              <li key={p.id}>
                <span className="crew-dot" style={{ background: p.color }} aria-hidden="true" />
                <span className="hud-name">{p.name}</span>
                <span className={`hud-status hud-status-${status.tone}`}>{status.text}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="hud-col">
        <h3>Funk</h3>
        {log.length === 0 ? (
          <p className="muted">Noch nichts passiert.</p>
        ) : (
          <ul className="hud-log">
            {log.map((line, i) => (
              <li key={`${line.at}-${i}`}>{line.label}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
