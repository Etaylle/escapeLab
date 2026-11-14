import { useEffect, useState } from 'react';
import type { PlayerPosition, PlayerView, RunEvent } from '@escapelab/core';
import { serverNow } from '../clock.js';
import { useMedia } from '../hooks.js';
import { pressingWord } from '../puzzles/syncPress.js';
import { airIcon, ANNOUNCED, fromControl, fromPlant, LAST_SHIFT, radioName } from '../radio.js';
import { useGlyph, usePadUsed } from '../input/glyphs.js';
import { useVoice, type Voice } from '../voice/useVoice.js';
import type { KnownPositions } from '../world/movement.js';
import type { ChatLine } from '../world/render/frame.js';
import { presenceNear } from '../world/presence.js';
import { CrewDot, crewTags, CrewTags, type CrewTag } from './Crew.js';
import { EdgeworkChip } from './EdgeworkChip.js';
import { Icon } from './Icon.js';
import { SpeakingMark } from './Voice.js';

interface Props {
  view: PlayerView;
  positionsRef: React.MutableRefObject<KnownPositions>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  /** a line is on the air in the banner over the world right now */
  onAir: boolean;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onOpenInfo: () => void;
  /** opens the pause menu over the run (menuLayer.ts) */
  onOpenMenu: () => void;
}

/** How often the crew's tags are read again from their live positions, ms. */
export const STATUS_SAMPLE_MS = 300;

/**
 * What a crew member is doing, as presence tags. Where you stand is the
 * server's word; for the others it follows the live positions the renderer
 * already receives — informational only, so the client may work it out. A
 * press waiting at the sync station is the station's view, which every
 * player gets wherever they stand: „zieht" calls a partner to the lever.
 */
export function tagsOf(
  view: PlayerView,
  player: PlayerView['players'][number],
  positions: Record<string, PlayerPosition>,
): CrewTag[] {
  const pos = positions[player.id];
  const at = player.id === view.you.id ? view.presence : presenceNear(view.map, pos);
  return crewTags(view.map, player, at, pos, pressingWord(view.puzzle, player.id, serverNow()));
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

/**
 * A run-report line as the radio strip reads it; the radio — the Leitstelle or the
 * Schichtleitung — the plant's loudspeakers and the last shift are named.
 */
function eventLine(event: RunEvent): Ticker {
  const text = event.seconds === null ? event.label : `${event.label} (−${event.seconds}s)`;
  const icon = airIcon(event);
  if (event.kind === 'hint') {
    return { icon, text: `${LAST_SHIFT} — ${text}` };
  }
  if (fromPlant(event)) {
    return { icon, text: `${ANNOUNCED}: ${text}` };
  }
  return { icon, text: fromControl(event) ? `${radioName(event)}: ${text}` : text };
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
 * The switch between talking by the key — V unless the settings name another,
 * or the talk button on a touch screen — and a microphone that stays open, for
 * a crew that wants it so.
 */
function MicSwitch({ voice, touch }: { voice: Voice; touch: boolean }) {
  const { mesh, state } = voice;
  const talk = useGlyph('talk');
  return (
    <button
      className="hud-info hud-mic"
      aria-pressed={state.open}
      onClick={() => mesh.setOpen(!state.open)}
    >
      <Icon name="mic" /> {state.open ? 'Mikro: offen' : withKey('Mikro: Taste', talk, touch)}
    </button>
  );
}

/** The radio strip's line: its icon and its words; nothing while there is none. */
function RadioStrip({ radio }: { radio: Ticker | null }) {
  if (radio === null) {
    return null;
  }
  return (
    <span className="hud-radio">
      <Icon name={radio.icon} /> {radio.text}
    </span>
  );
}

/**
 * The permanent strip under the world. Deliberately thin: only the crew, the
 * edgework once you have read the sign, and the latest radio line, because
 * everything else either sits on the world itself or belongs in the info panel —
 * and the buttons for the notepad, the info panel and the menu. A phone held
 * sideways folds it into the objective bar's row instead (hudFold.ts).
 */
export function MissionHud({
  view,
  positionsRef,
  chatsRef,
  onAir,
  notesOpen,
  onToggleNotes,
  onOpenInfo,
  onOpenMenu,
}: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), STATUS_SAMPLE_MS);
    return () => clearInterval(timer);
  }, []);
  void tick;
  const touch = useMedia('(pointer: coarse)');
  // A touch screen has no keys to name — unless a controller steers it.
  const padUsed = usePadUsed();
  const keyless = touch && !padUsed;
  const notesKey = useGlyph('notes');
  const infoKey = useGlyph('info');
  const menuKey = useGlyph('menu');
  const voice = useVoice();
  const talking = voice?.state.mic === 'on' ? voice : null;

  const positions = positionsRef.current.players;
  // The newest line holds the strip; a chat line only lives as long as its bubble.
  const lastChat = chatsRef.current.at(-1);
  const nameOf = (id: string): string => view.players.find((p) => p.id === id)?.name ?? '?';
  const heard =
    lastChat === undefined
      ? undefined
      : {
          at: chatArrival(lastChat),
          text: `${nameOf(lastChat.playerId)}: ${lastChat.text}`,
        };
  const radio = tickerLine(view.events.at(-1), heard, onAir);

  return (
    // The switch takes a place of its own in the strip's rows (voice.css).
    <section className={talking === null ? 'hud' : 'hud hud--voice'}>
      <ul className="hud-crew">
        {view.players.map((p) => {
          const tags = tagsOf(view, p, positions);
          const mine = p.id === view.you.id;
          return (
            <li key={p.id} className={mine ? 'hud-me' : ''}>
              <CrewDot color={p.color} />
              <span className="hud-name">{p.name}</span>
              {voice?.state.speaking.has(p.id) === true && <SpeakingMark />}
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
        <RadioStrip radio={radio} />
        {talking !== null && <MicSwitch voice={talking} touch={keyless} />}
        <button className="hud-info hud-notes" aria-pressed={notesOpen} onClick={onToggleNotes}>
          <Icon name="pencil" /> {withKey('Notizen', notesKey, keyless)}
        </button>
        <button className="hud-info" onClick={onOpenInfo}>
          <Icon name="info" /> {withKey('Info', infoKey, keyless)}
        </button>
        <button className="hud-info hud-menu" onClick={onOpenMenu}>
          <Icon name="menu" /> {withKey('Menü', menuKey, keyless)}
        </button>
      </div>
    </section>
  );
}
