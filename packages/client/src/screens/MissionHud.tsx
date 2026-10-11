import { useEffect, useState } from 'react';
import { chatText, type PlayerPosition, type PlayerView } from '@escapelab/core';
import type { ChatLine } from '../world/GameWorld.js';

interface Props {
  view: PlayerView;
  positionsRef: React.MutableRefObject<Record<string, PlayerPosition>>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  onOpenInfo: () => void;
}

const STATUS_SAMPLE_MS = 300;

type Status = { text: string; tone: 'ok' | 'warn' | 'idle' };

/**
 * What each crew member is doing, derived from the live positions the
 * renderer already receives — informational only, so the client may compute it.
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

  if (map.plates.some((p) => p.pressed && near(p.x, p.y, 0.8))) {
    return { text: 'hält die Platte', tone: 'ok' };
  }
  if (map.sabotage?.panels.some((p) => near(p.x, p.y, 0.9)) === true) {
    return { text: 'am Ventil', tone: 'ok' };
  }
  if (map.stations.some((s) => s.status === 'armed' && near(s.x, s.y, 1.6))) {
    return { text: 'an der Station', tone: 'ok' };
  }
  return { text: 'unterwegs', tone: 'idle' };
}

/**
 * The permanent strip under the world. Deliberately thin: only the crew and
 * the latest radio line, because everything else either sits on the world
 * itself or belongs in the info panel.
 */
export function MissionHud({ view, positionsRef, chatsRef, onOpenInfo }: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), STATUS_SAMPLE_MS);
    return () => clearInterval(timer);
  }, []);
  void tick;

  const positions = positionsRef.current;
  const lastChat = chatsRef.current.at(-1);
  const lastEvent = view.events.at(-1);
  const radio =
    lastChat !== undefined && (lastEvent === undefined || lastChat.at > 0)
      ? `${view.players.find((p) => p.id === lastChat.playerId)?.name ?? '?'}: ${chatText(lastChat.phrase)}`
      : lastEvent === undefined
        ? null
        : lastEvent.seconds === null
          ? lastEvent.label
          : `${lastEvent.label} (−${lastEvent.seconds}s)`;

  return (
    <section className="hud">
      <ul className="hud-crew">
        {view.players.map((p) => {
          const status = statusOf(view, p.id, positions);
          const mine = p.id === view.you.id;
          return (
            <li key={p.id} className={mine ? 'hud-me' : ''}>
              <span className="crew-dot" style={{ background: p.color }} aria-hidden="true" />
              <span className="hud-name">{p.name}</span>
              <span className="hud-role-tag">{p.roleName ?? '—'}</span>
              <span className={`hud-status hud-status-${status.tone}`}>{status.text}</span>
            </li>
          );
        })}
      </ul>

      <div className="hud-right">
        {radio !== null && <span className="hud-radio">📻 {radio}</span>}
        <button className="hud-info" onClick={onOpenInfo}>
          ℹ Info [I]
        </button>
      </div>
    </section>
  );
}
