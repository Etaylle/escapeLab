import { useEffect, useState } from 'react';
import { chatText, type PlayerPosition, type PlayerView, type RunEvent } from '@escapelab/core';
import { fromMissionControl } from '../radio.js';
import type { ChatLine } from '../world/GameWorld.js';
import { EdgeworkChip } from './EdgeworkChip.js';

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

/** A run-report line as the radio strip reads it; mission control is named like a speaker. */
function eventLine(event: RunEvent): string {
  const text = event.seconds === null ? event.label : `${event.label} (−${event.seconds}s)`;
  return fromMissionControl(event) ? `Leitstelle: ${text}` : text;
}

/** Epoch ms a quick-chat line came in; chat lines are stamped with performance.now(). */
function chatArrival(line: ChatLine): number {
  return Date.now() - (performance.now() - line.at);
}

/**
 * The permanent strip under the world. Deliberately thin: only the crew, the
 * edgework for roles that read it out, and the latest radio line, because
 * everything else either sits on the world itself or belongs in the info panel.
 */
export function MissionHud({ view, positionsRef, chatsRef, onOpenInfo }: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), STATUS_SAMPLE_MS);
    return () => clearInterval(timer);
  }, []);
  void tick;

  const positions = positionsRef.current;
  // The newest line holds the strip; a chat line only lives as long as its bubble.
  const lastChat = chatsRef.current.at(-1);
  const lastEvent = view.events.at(-1);
  const radio =
    lastChat !== undefined && (lastEvent === undefined || chatArrival(lastChat) >= lastEvent.at)
      ? `${view.players.find((p) => p.id === lastChat.playerId)?.name ?? '?'}: ${chatText(lastChat.phrase)}`
      : lastEvent === undefined
        ? null
        : eventLine(lastEvent);

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
        {view.edgework !== null && <EdgeworkChip edgework={view.edgework} />}
        {radio !== null && <span className="hud-radio">📻 {radio}</span>}
        <button className="hud-info" onClick={onOpenInfo}>
          ℹ Info [I]
        </button>
      </div>
    </section>
  );
}
