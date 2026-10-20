import { useEffect, useState } from 'react';
import {
  difficultyInfos,
  type ClientMessage,
  type Difficulty,
  type MissionInfo,
  type PlayerView,
} from '@escapelab/core';
import { crewSizeText } from './Crew.js';
import { CrewRoom } from './CrewRoom.js';
import { MapThumb } from './MapThumb.js';

type Send = (msg: ClientMessage) => void;

interface Props {
  view: PlayerView;
  /** the room's code, for inviting; null before the server has named it */
  roomCode: string | null;
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
        ⏱ {Math.round(view.timeLimitSec / 60)} min · 👥 {crewSizeText(view.crewSize)}
        {info !== undefined && ` · 🧩 ${info.puzzleCount} Stationen`}
      </p>
    </header>
  );
}

/** The story in two lines, the rest behind „mehr". */
function Story({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > STORY_FITS;
  return (
    <div className="lobby-story">
      <p className={long && !open ? 'story story-short' : 'story'}>{text}</p>
      {long && (
        <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'weniger' : 'mehr'}
        </button>
      )}
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
          {blocker ?? '▶ Mission starten'}
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
        {ready ? '✓ Bereit — doch nicht?' : 'Ich bin bereit'}
      </button>
      <p className="muted lobby-go-note">
        {ready
          ? (blocker ?? 'Alle bereit — der Host startet.')
          : 'Lies die Mission — dann melde dich bereit.'}
      </p>
    </div>
  );
}

type CopyState = 'idle' | 'done' | 'failed';

const COPY_LABELS: Readonly<Record<CopyState, string>> = {
  idle: '⧉ Link kopieren',
  done: '✓ Link kopiert',
  failed: '✗ nicht kopiert',
};

/** The code to read out, and a link that drops the next person straight into the room. */
function Invite({ code }: { code: string }) {
  const [copy, setCopy] = useState<CopyState>('idle');
  useEffect(() => {
    if (copy === 'idle') {
      return undefined;
    }
    const timer = setTimeout(() => setCopy('idle'), 1500);
    return () => clearTimeout(timer);
  }, [copy]);

  const copyLink = (): void => {
    const link = `${window.location.origin}${window.location.pathname}?room=${code}`;
    // Without a secure origin, as on a LAN address, the browser has no clipboard.
    if (navigator.clipboard === undefined) {
      setCopy('failed');
      return;
    }
    navigator.clipboard.writeText(link).then(
      () => setCopy('done'),
      () => setCopy('failed'),
    );
  };

  return (
    <div className="lobby-invite">
      <span className="lobby-invite-label">Code</span>
      <strong className="lobby-code">{code}</strong>
      <button className="lobby-copy" onClick={copyLink}>
        {COPY_LABELS[copy]}
      </button>
    </div>
  );
}

/**
 * The lobby as the crew's room: everybody on stage, the colours at your feet,
 * the mission beside them with its settings, the start and the invite.
 */
export function LobbyScreen({ view, roomCode, send, leaveRoom, missions }: Props) {
  const info = missions.find((m) => m.id === view.missionId);
  return (
    <div className="lobby">
      <CrewRoom view={view} send={send} />
      <aside className="lobby-panel" aria-label="Mission">
        <MissionHead view={view} info={info} />
        <Story text={view.storyText} />
        {view.you.isHost ? (
          <HostSetup view={view} send={send} missions={missions} />
        ) : (
          <Levels current={view.difficulty} pick={null} />
        )}
        <StartArea view={view} send={send} />
        <div className="lobby-foot">
          {roomCode !== null && <Invite code={roomCode} />}
          <button className="link" onClick={leaveRoom}>
            Raum verlassen
          </button>
        </div>
      </aside>
    </div>
  );
}
