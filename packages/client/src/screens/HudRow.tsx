import { useRef } from 'react';
import type { PlayerView } from '@escapelab/core';
import { useNow } from '../hooks.js';
import { useVoice } from '../voice/useVoice.js';
import { escaping } from '../world/escape.js';
import type { KnownPositions } from '../world/movement.js';
import { CrewDot, CrewTags, type CrewTag } from './Crew.js';
import { EdgeworkChip } from './EdgeworkChip.js';
import { freshTags, type TagMemory } from './hudFold.js';
import { Icon } from './Icon.js';
import { STATUS_SAMPLE_MS, tagsOf } from './MissionHud.js';

/**
 * What the crew strip folds into the objective bar's row on a phone held sideways (hudFold.ts,
 * Game.tsx `StageTop`): the crew and the Laborkennung before the clock, the buttons after it.
 */

/** A crew member's tags in words, „unterwegs" for none: what the row tells apart as a change. */
function tagWords(tags: readonly CrewTag[]): string {
  return tags.length === 0 ? 'unterwegs' : tags.map((tag) => tag.text).join(' · ');
}

/** The ids of the crew standing on the open hatch in the escape; none before it. */
function outOnHatch(view: PlayerView): ReadonlySet<string> {
  const exit = view.map?.exit ?? null;
  return new Set(exit !== null && escaping(view.map) ? exit.atExit : []);
}

/** A crew member's place in the row: ringed while they speak, greyed while their line is down. */
function mateClass(speaking: boolean, connected: boolean): string {
  return [
    'row-mate',
    ...(speaking ? ['row-mate--speaking'] : []),
    ...(connected ? [] : ['row-mate--away']),
  ].join(' ');
}

/**
 * The crew in the row: a dot in each one's colour — ringed while they speak, ticked once they
 * stand on the open hatch, greyed while away — and beside it what they do, for TAG_SHOWN_MS
 * after it changed (`freshTags`), read again from the live positions every STATUS_SAMPLE_MS:
 * one away keeps theirs, its counter of their time away changing every second. Their name and
 * what they do stand in the dot's label all along. Then the Laborkennung's value, once the sign
 * is read.
 */
export function RowCrew({
  view,
  positionsRef,
}: {
  view: PlayerView;
  positionsRef: React.MutableRefObject<KnownPositions>;
}) {
  const now = useNow(STATUS_SAMPLE_MS);
  const memory = useRef<TagMemory>(new Map());
  const voice = useVoice();
  const positions = positionsRef.current.players;
  const crew = view.players.map((player) => {
    const tags = tagsOf(view, player, positions);
    return { player, tags, words: tagWords(tags) };
  });
  const fresh = freshTags(
    memory.current,
    crew.map(({ player, words }) => ({ id: player.id, said: words })),
    now,
  );
  memory.current = fresh.memory;
  const out = outOnHatch(view);
  return (
    <>
      <ul className="row-crew">
        {crew.map(({ player, tags, words }) => {
          const speaking = voice?.state.speaking.has(player.id) === true;
          const onHatch = out.has(player.id);
          const label = `${player.name}: ${words}${onHatch ? ', am Notausgang' : ''}`;
          return (
            <li
              key={player.id}
              className={mateClass(speaking, player.connected)}
              aria-label={label}
              title={label}
            >
              <CrewDot color={player.color} />
              {onHatch && <Icon name="check" />}
              {fresh.shown.has(player.id) &&
                (tags.length > 0 ? (
                  <CrewTags tags={tags} />
                ) : (
                  <span className="hud-idle">unterwegs</span>
                ))}
            </li>
          );
        })}
      </ul>
      {view.edgework !== null && <EdgeworkChip edgework={view.edgework} />}
    </>
  );
}

/**
 * The row's buttons, a fingertip's target each, their words in their labels: the switch
 * between talking by the button and a microphone that stays open — while the microphone is on —,
 * the notepad, the info panel and the menu.
 */
export function RowTools({
  notesOpen,
  onToggleNotes,
  onOpenInfo,
  onOpenMenu,
}: {
  notesOpen: boolean;
  onToggleNotes: () => void;
  onOpenInfo: () => void;
  onOpenMenu: () => void;
}) {
  const voice = useVoice();
  const talking = voice?.state.mic === 'on' ? voice : null;
  const open = talking?.state.open === true;
  return (
    <>
      {talking !== null && (
        <button
          className="hud-info hud-mic"
          aria-pressed={open}
          aria-label={open ? 'Mikro: offen' : 'Mikro: Taste'}
          title={open ? 'Mikro: offen' : 'Mikro: Taste'}
          onClick={() => talking.mesh.setOpen(!open)}
        >
          <Icon name="mic" />
        </button>
      )}
      <button
        className="hud-info hud-notes"
        aria-pressed={notesOpen}
        aria-label="Notizen"
        title="Notizen"
        onClick={onToggleNotes}
      >
        <Icon name="pencil" />
      </button>
      <button className="hud-info" aria-label="Info" title="Info" onClick={onOpenInfo}>
        <Icon name="info" />
      </button>
      <button className="hud-info hud-menu" aria-label="Menü" title="Menü" onClick={onOpenMenu}>
        <Icon name="menu" />
      </button>
    </>
  );
}
