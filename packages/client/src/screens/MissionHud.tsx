import { useEffect, useState } from 'react';
import { chatText, type PlayerPosition, type PlayerView, type RunEvent } from '@escapelab/core';
import { fromMissionControl } from '../radio.js';
import type { ChatLine } from '../world/GameWorld.js';
import { crewTags, CrewTags, presenceNear, type CrewTag } from './Crew.js';
import { EdgeworkChip } from './EdgeworkChip.js';

interface Props {
  view: PlayerView;
  positionsRef: React.MutableRefObject<Record<string, PlayerPosition>>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  onOpenInfo: () => void;
}

const STATUS_SAMPLE_MS = 300;

/**
 * What a crew member is doing, as presence tags. Where you stand is the
 * server's word; for the others it follows the live positions the renderer
 * already receives — informational only, so the client may work it out.
 */
function tagsOf(
  view: PlayerView,
  player: { id: string; connected: boolean },
  positions: Record<string, PlayerPosition>,
): CrewTag[] {
  const pos = positions[player.id];
  const at = player.id === view.you.id ? view.presence : presenceNear(view.map, pos);
  return crewTags(view.map, player, at, pos);
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
 * edgework once you have read the sign, and the latest radio line, because
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
          const tags = tagsOf(view, p, positions);
          const mine = p.id === view.you.id;
          return (
            <li key={p.id} className={mine ? 'hud-me' : ''}>
              <span className="crew-dot" style={{ background: p.color }} aria-hidden="true" />
              <span className="hud-name">{p.name}</span>
              {tags.length > 0 ? (
                <CrewTags tags={tags} />
              ) : (
                <span className="hud-idle">unterwegs</span>
              )}
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
