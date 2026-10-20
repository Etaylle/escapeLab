import { useEffect, useState } from 'react';
import { chatText, type PlayerPosition, type PlayerView, type RunEvent } from '@escapelab/core';
import { useMedia } from '../hooks.js';
import { airIcon, LAST_CREW } from '../radio.js';
import type { ChatLine } from '../world/GameWorld.js';
import type { KnownPositions } from '../world/movement.js';
import { crewTags, CrewTags, presenceNear, type CrewTag } from './Crew.js';
import { EdgeworkChip } from './EdgeworkChip.js';
import { Icon } from './Icon.js';

interface Props {
  view: PlayerView;
  positionsRef: React.MutableRefObject<KnownPositions>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  /** a line is on the air in the banner over the world right now */
  onAir: boolean;
  notesOpen: boolean;
  onToggleNotes: () => void;
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

/** A line on the radio strip: the icon of who or what it is from, and its words. */
export interface Ticker {
  icon: 'note' | 'radio';
  text: string;
}

/** A quick-chat line as the strip takes it: when it came in (epoch ms) and its words. */
export interface ChatHeard {
  at: number;
  text: string;
}

/** A run-report line as the radio strip reads it; mission control and the last crew are named. */
function eventLine(event: RunEvent): Ticker {
  const text = event.seconds === null ? event.label : `${event.label} (−${event.seconds}s)`;
  const icon = airIcon(event);
  if (event.kind === 'hint') {
    return { icon, text: `${LAST_CREW} — ${text}` };
  }
  return { icon, text: event.kind === 'radio' ? `Leitstelle: ${text}` : text };
}

/**
 * What the radio strip carries: the newer of the last chat line and the last
 * line of the run — and nothing while a line is on the air over the world,
 * since the banner says it already.
 */
export function tickerLine(
  lastEvent: RunEvent | undefined,
  lastChat: ChatHeard | undefined,
  onAir: boolean,
): Ticker | null {
  if (onAir) {
    return null;
  }
  if (lastChat !== undefined && (lastEvent === undefined || lastChat.at >= lastEvent.at)) {
    return { icon: 'radio', text: lastChat.text };
  }
  return lastEvent === undefined ? null : eventLine(lastEvent);
}

/** A HUD button's words with its key, „Notizen [N]"; on a touch screen, with no keys, the words. */
export function withKey(words: string, key: string, touch: boolean): string {
  return touch ? words : `${words} [${key}]`;
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
export function MissionHud({
  view,
  positionsRef,
  chatsRef,
  onAir,
  notesOpen,
  onToggleNotes,
  onOpenInfo,
}: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), STATUS_SAMPLE_MS);
    return () => clearInterval(timer);
  }, []);
  void tick;
  const touch = useMedia('(pointer: coarse)');

  const positions = positionsRef.current.players;
  // The newest line holds the strip; a chat line only lives as long as its bubble.
  const lastChat = chatsRef.current.at(-1);
  const nameOf = (id: string): string => view.players.find((p) => p.id === id)?.name ?? '?';
  const heard =
    lastChat === undefined
      ? undefined
      : {
          at: chatArrival(lastChat),
          text: `${nameOf(lastChat.playerId)}: ${chatText(lastChat.phrase)}`,
        };
  const radio = tickerLine(view.events.at(-1), heard, onAir);

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
        {radio !== null && (
          <span className="hud-radio">
            <Icon name={radio.icon} /> {radio.text}
          </span>
        )}
        <button className="hud-info hud-notes" aria-pressed={notesOpen} onClick={onToggleNotes}>
          <Icon name="pencil" /> {withKey('Notizen', 'N', touch)}
        </button>
        <button className="hud-info" onClick={onOpenInfo}>
          <Icon name="info" /> {withKey('Info', 'I', touch)}
        </button>
      </div>
    </section>
  );
}
