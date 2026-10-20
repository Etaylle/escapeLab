import { useState } from 'react';
import {
  difficultyInfos,
  type ClientMessage,
  type Difficulty,
  type MissionInfo,
  type PlayerView,
} from '@escapelab/core';
import { crewSizeText } from './Crew.js';
import { CrewRoom } from './CrewRoom.js';
import { Icon } from './Icon.js';
import { MapThumb } from './MapThumb.js';

type Send = (msg: ClientMessage) => void;

interface Props {
  view: PlayerView;
  send: Send;
  leaveRoom: () => void;
  missions: MissionInfo[];
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

function MissionHead({ view, info }: { view: PlayerView; info: MissionInfo | undefined }) {
  return (
    <header className="lobby-head">
      <h1>{view.missionTitle}</h1>
      {info !== undefined && info.tiles.length > 0 && (
        <div className="lobby-map">
          <MapThumb tiles={info.tiles} height={80} />
        </div>
      )}
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
}

/** The difficulty as three chips: the host picks one, everyone else sees which. */
function Levels({ current, pick }: LevelsProps) {
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
    </div>
  );
}

interface HostSetupProps {
  view: PlayerView;
  send: Send;
  missions: MissionInfo[];
}

function HostSetup({ view, send, missions }: HostSetupProps) {
  return (
    <div className="lobby-setup">
      {missions.length > 1 && (
        <label className="lobby-switch">
          Mission wechseln
          <select
            value={view.missionId}
            onChange={(e) => send({ kind: 'switch-mission', missionId: e.target.value })}
          >
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({crewSizeText(m.players)})
              </option>
            ))}
          </select>
        </label>
      )}
      <Levels
        current={view.difficulty}
        pick={(difficulty) => send({ kind: 'select-difficulty', difficulty })}
      />
    </div>
  );
}

/**
 * The host's start, locked with the reason while it is; everyone else's
 * ready switch, with what the start still waits for once they are ready.
 * On a phone this bar sticks to the bottom of the window (lobby.css).
 */
function StartArea({ view, send }: { view: PlayerView; send: Send }) {
  const blocker = startBlocker(view);
  if (view.you.isHost) {
    return (
      <div className="lobby-go">
        <button
          className="primary lobby-start"
          disabled={blocker !== null}
          onClick={() => send({ kind: 'start-mission' })}
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
        onClick={() => send({ kind: 'set-ready', ready: !ready })}
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
          : 'Lies die Mission — dann melde dich bereit.'}
      </p>
    </div>
  );
}

/**
 * The lobby as the crew's room: everybody on stage, the colours at your feet,
 * the mission beside them with its settings and the start. The room's code
 * stands once, in the header, where the free places point.
 */
export function LobbyScreen({ view, send, leaveRoom, missions }: Props) {
  const info = missions.find((m) => m.id === view.missionId);
  const [more, setMore] = useState(false);
  return (
    <div className="lobby">
      <CrewRoom view={view} send={send} />
      <aside
        className={more ? 'lobby-panel lobby-panel-more' : 'lobby-panel'}
        aria-label="Mission"
      >
        <MissionHead view={view} info={info} />
        <Story text={view.storyText} open={more} toggle={() => setMore(!more)} />
        {view.you.isHost ? (
          <HostSetup view={view} send={send} missions={missions} />
        ) : (
          <Levels current={view.difficulty} pick={null} />
        )}
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
