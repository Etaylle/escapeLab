import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  difficultyInfos,
  type ClientMessage,
  type Difficulty,
  type MissionInfo,
  type MissionStats,
  type PlayerView,
} from '@escapelab/core';
import { FIRST_RUN_LINE, useWon } from '../firstRun.js';
import { fullscreenForRun } from '../runScreen.js';
import { recordParts } from '../runStats.js';
import { crewSizeText } from './Crew.js';
import { CrewRoom } from './CrewRoom.js';
import { Icon } from './Icon.js';
import { MapThumb } from './MapThumb.js';
import { phosphorClass, useComesOn } from './phosphor.js';
import { MicSetup } from './Voice.js';

type Send = (msg: ClientMessage) => void;

interface Props {
  view: PlayerView;
  send: Send;
  leaveRoom: () => void;
  missions: MissionInfo[];
  /** the Bestenliste's runs, by mission: the host's strip says each mission's record */
  stats: MissionStats[];
}

/**
 * Why the host cannot start yet, or null: the connected crew must be a size
 * the mission takes and everyone but the host must have confirmed — the
 * server checks the same.
 */
export function startBlocker(view: Pick<PlayerView, 'crewSize' | 'players'>): string | null {
  const crew = view.players.filter((p) => p.connected);
  const missing = view.crewSize.min - crew.length;
  if (missing > 0) {
    return `Noch ${missing} ${missing === 1 ? 'Person' : 'Personen'} nötig`;
  }
  if (crew.length > view.crewSize.max) {
    return 'Zu viele für diese Mission';
  }
  const waiting = crew.filter((p) => !p.isHost && !p.ready);
  return waiting.length === 0 ? null : `Warten auf ${waiting.map((p) => p.name).join(', ')} …`;
}

/** A story up to this many characters fits the two lines the panel shows of it. */
const STORY_FITS = 70;

/** What the panel says of an older map kept on (`Mission['stage']`), under its facts. */
export const PROTOTYPE_LINE = 'Prototyp: ältere Karte ohne Kaltstart und Einrichtung.';

interface HeadProps {
  view: PlayerView;
  info: MissionInfo | undefined;
  /** the host's strip of missions, in the map's place — each card has a map of its own */
  picker: ReactNode;
}

function MissionHead({ view, info, picker }: HeadProps) {
  const comesOn = useComesOn('lobby');
  return (
    <header className="lobby-head">
      <h1 className={phosphorClass(comesOn)}>{view.missionTitle}</h1>
      {picker ??
        (info !== undefined && info.tiles.length > 0 && (
          <div className="lobby-map">
            <MapThumb tiles={info.tiles} height={80} />
          </div>
        ))}
      <p className="lobby-facts">
        <span>
          <Icon name="clock" /> {Math.round(view.timeLimitSec / 60)} min
        </span>
        <span>
          <Icon name="crew" /> {crewSizeText(view.crewSize)}
        </span>
        {info !== undefined && (
          <span>
            <Icon name="station" /> {info.puzzleCount} Stationen
          </span>
        )}
      </p>
      {info?.stage === 'prototype' && <p className="muted lobby-prototype">{PROTOTYPE_LINE}</p>}
    </header>
  );
}

interface StoryProps {
  text: string;
  /** whether „mehr" is open: the whole story, and on a phone the map as well */
  open: boolean;
  toggle: () => void;
}

/**
 * The story in two lines, the rest behind „mehr". On a phone the story and
 * the map both wait behind „mehr", so the crew stays in view over the start;
 * there „mehr" shows for a short story too (lobby.css).
 */
function Story({ text, open, toggle }: StoryProps) {
  const long = text.length > STORY_FITS;
  return (
    <div className="lobby-story">
      <p className={long && !open ? 'story story-short' : 'story'}>{text}</p>
      <button
        className={long ? 'link lobby-more' : 'link lobby-more lobby-more-phone'}
        aria-expanded={open}
        onClick={toggle}
      >
        {open ? 'weniger' : 'mehr'}
      </button>
    </div>
  );
}

interface LevelsProps {
  current: Difficulty;
  /** the host's pick; null for everyone else, who only sees it */
  pick: ((id: Difficulty) => void) | null;
  /**
   * the host's device has seen no run won yet: the room opened on „entspannt" for a first
   * crew (firstRun.ts), and while it stays on it, a muted line says so
   */
  firstRun?: boolean;
}

/**
 * The difficulty as three chips: the host picks one, everyone else sees which. A host on a
 * first run is told why „entspannt" stands picked.
 */
export function Levels({ current, pick, firstRun = false }: LevelsProps) {
  const levels = difficultyInfos();
  return (
    <div className="lobby-levels">
      <p className="lobby-caption">Schwierigkeit{pick === null && ' (wählt der Host)'}</p>
      <div className={pick === null ? 'level-chips level-chips-shown' : 'level-chips'}>
        {levels.map((level) => {
          const on = level.id === current;
          const marks = on ? 'level-chip level-chip-on' : 'level-chip';
          return pick === null ? (
            <span key={level.id} className={marks} title={level.description}>
              {level.label}
            </span>
          ) : (
            <button
              key={level.id}
              className={marks}
              title={level.description}
              aria-pressed={on}
              onClick={() => pick(level.id)}
            >
              {level.label}
            </button>
          );
        })}
      </div>
      <p className="muted lobby-level-note">
        {levels.find((level) => level.id === current)?.description}
      </p>
      {firstRun && current === 'entspannt' && (
        <p className="muted lobby-first-run">{FIRST_RUN_LINE}</p>
      )}
    </div>
  );
}

/**
 * Where a key moves the pick from card `at` of `count` in the mission strip:
 * an arrow one card on, round from the last to the first and back, Home and
 * End to the ends; null for any other key.
 */
export function stepTo(at: number, key: string, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (at + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (at - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Scrolls the strip sideways, and nothing else, until `card` stands whole within its padding. */
function reveal(strip: HTMLElement, card: HTMLElement): void {
  const pad = parseFloat(getComputedStyle(strip).paddingLeft) || 0;
  const start = card.offsetLeft - pad;
  const end = card.offsetLeft + card.offsetWidth + pad - strip.clientWidth;
  if (start < strip.scrollLeft) {
    strip.scrollLeft = start;
  } else if (end > strip.scrollLeft) {
    strip.scrollLeft = end;
  }
}

interface CardProps {
  mission: MissionInfo;
  /** the record's two lines, as the join screen's card says them in one; null before a run */
  record: [string, string] | null;
  checked: boolean;
  /** the card Tab stops at in the strip: the ticked one */
  focusable: boolean;
  cardRef: (card: HTMLButtonElement | null) => void;
  onPick: () => void;
  onKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

/** One mission in the strip: its map, its name, how many play it, its record; the room's ticked. */
function MissionCard({ mission, record, checked, focusable, cardRef, onPick, onKey }: CardProps) {
  return (
    <button
      ref={cardRef}
      className={checked ? 'lobby-mission lobby-mission-on' : 'lobby-mission'}
      role="radio"
      aria-checked={checked}
      tabIndex={focusable ? 0 : -1}
      title={mission.subtitle}
      onClick={onPick}
      onKeyDown={onKey}
    >
      <span className="lobby-mission-map" aria-hidden="true">
        <MapThumb tiles={mission.tiles} height={40} />
        {checked && (
          <span className="lobby-mission-mark">
            <Icon name="check" />
          </span>
        )}
      </span>
      <span className="lobby-mission-title">{mission.title}</span>
      <span className="lobby-mission-meta">
        <Icon name="crew" /> {crewSizeText(mission.players)}
      </span>
      {record !== null && (
        <span className="lobby-mission-record">
          <span>{record[0]}</span>
          <span>{record[1]}</span>
        </span>
      )}
    </button>
  );
}

interface StripProps {
  missions: MissionInfo[];
  /** the Bestenliste's runs, by mission: each card says its mission's record */
  stats: MissionStats[];
  /** the room's mission, by id */
  current: string;
  pick: (missionId: string) => void;
}

/**
 * The host's pick of the mission: every mission as a compact card — its
 * map, its name, how many play it and its record, as the join screen's card
 * says it — in a strip that scrolls sideways, the room's mission ticked.
 * One radio group: Tab stops at the ticked card, an arrow key picks the
 * next, and the strip scrolls to whichever card is picked.
 */
export function MissionStrip({ missions, stats, current, pick }: StripProps) {
  const strip = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const index = missions.findIndex((mission) => mission.id === current);
  useEffect(() => {
    const card = cards.current[index];
    if (strip.current !== null && card != null) {
      reveal(strip.current, card);
    }
  }, [index]);
  const choose = (missionId: string): void => {
    if (missionId !== current) {
      pick(missionId);
    }
  };
  const onKey = (at: number, event: KeyboardEvent<HTMLButtonElement>): void => {
    const next = stepTo(at, event.key, missions.length);
    const mission = next === null ? undefined : missions[next];
    if (next === null || mission === undefined) {
      return;
    }
    event.preventDefault();
    choose(mission.id);
    const card = cards.current[next];
    if (card != null && strip.current !== null) {
      card.focus({ preventScroll: true });
      reveal(strip.current, card);
    }
  };
  return (
    <div ref={strip} className="lobby-missions" role="radiogroup" aria-label="Mission wechseln">
      {missions.map((mission, i) => (
        <MissionCard
          key={mission.id}
          mission={mission}
          record={recordParts(stats.find((s) => s.missionId === mission.id)?.difficulties ?? [])}
          checked={i === index}
          focusable={i === Math.max(0, index)}
          cardRef={(card) => {
            cards.current[i] = card;
          }}
          onPick={() => choose(mission.id)}
          onKey={(event) => onKey(i, event)}
        />
      ))}
    </div>
  );
}

/**
 * The host's start, locked with the reason while it is; everyone else's
 * ready switch, with what the start still waits for once they are ready.
 * On a phone this bar sticks to the bottom of the window (lobby.css), and
 * the press that leads into the run takes the page fullscreen (runScreen.ts).
 */
function StartArea({ view, send }: { view: PlayerView; send: Send }) {
  const blocker = startBlocker(view);
  if (view.you.isHost) {
    return (
      <div className="lobby-go">
        <button
          className="primary lobby-start"
          disabled={blocker !== null}
          onClick={(event) => {
            fullscreenForRun(event.nativeEvent);
            send({ kind: 'start-mission' });
          }}
        >
          {blocker ?? (
            <>
              <Icon name="play" /> Mission starten
            </>
          )}
        </button>
      </div>
    );
  }
  const { ready } = view.you;
  return (
    <div className="lobby-go">
      <button
        className={ready ? 'lobby-start' : 'primary lobby-start'}
        onClick={(event) => {
          if (!ready) {
            fullscreenForRun(event.nativeEvent);
          }
          send({ kind: 'set-ready', ready: !ready });
        }}
      >
        {ready ? (
          <>
            <Icon name="check" /> Bereit — doch nicht?
          </>
        ) : (
          'Ich bin bereit'
        )}
      </button>
      <p className="muted lobby-go-note">
        {ready
          ? (blocker ?? 'Alle bereit — der Host startet.')
          : 'Erst die Mission lesen, dann bereit melden.'}
      </p>
    </div>
  );
}

/**
 * The lobby as the crew's room: everybody on stage, the colours at your feet,
 * the mission beside them with its settings, the microphone and the start.
 * The room's code stands once, in the header, where the free places point.
 */
export function LobbyScreen({ view, send, leaveRoom, missions, stats }: Props) {
  const info = missions.find((m) => m.id === view.missionId);
  const [more, setMore] = useState(false);
  const host = view.you.isHost;
  const won = useWon();
  // The host picks among the missions where everyone else sees the map.
  const picker =
    host && missions.length > 1 ? (
      <MissionStrip
        missions={missions}
        stats={stats}
        current={view.missionId}
        pick={(missionId) => send({ kind: 'switch-mission', missionId })}
      />
    ) : null;
  return (
    <div className="lobby">
      <CrewRoom view={view} send={send} />
      <aside
        className={more ? 'lobby-panel lobby-panel-more' : 'lobby-panel'}
        aria-label="Mission"
      >
        <MissionHead view={view} info={info} picker={picker} />
        <Story text={view.storyText} open={more} toggle={() => setMore(!more)} />
        <Levels
          current={view.difficulty}
          pick={host ? (difficulty) => send({ kind: 'select-difficulty', difficulty }) : null}
          firstRun={host && !won}
        />
        <MicSetup />
        <StartArea view={view} send={send} />
        <div className="lobby-foot">
          <button className="link" onClick={leaveRoom}>
            Raum verlassen
          </button>
        </div>
      </aside>
    </div>
  );
}
