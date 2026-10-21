import { useEffect } from 'react';
import type { ClientMessage, Grade, MissionInfo, PlayerView, RunEvent } from '@escapelab/core';
import { clock } from '../runStats.js';
import { victoryChord } from '../world/audio.js';
import { endingOf, type Ending } from '../world/finale.js';
import { CreditsTable } from './Crew.js';
import { CrewFigure } from './CrewFigure.js';
import { Icon, type IconName } from './Icon.js';
import { RunStanding } from './Standing.js';

interface Props {
  view: PlayerView;
  /** this screen played the run's end: its card comes up out of the end's fade, with its sound */
  fresh: boolean;
  send: (msg: ClientMessage) => void;
  leaveRoom: () => void;
  /** the mission catalog, for the title of the mission a won run leads on to; without it, none */
  missions?: MissionInfo[];
}

/** Each line of the run report under the icon of what happened; notes and radio as on the HUD. */
const EVENT_ICON: Record<RunEvent['kind'], IconName> = {
  puzzle: 'check',
  penalty: 'siren',
  sabotage: 'warning',
  item: 'box',
  escape: 'exit',
  finish: 'flag',
  hint: 'note',
  radio: 'radio',
  find: 'search',
  power: 'power',
};

/** What the title card says a run came to. */
export const ENDING_TITLES: Record<Ending, string> = {
  won: 'GESCHAFFT',
  'lost:time': 'ZEIT ABGELAUFEN',
  'lost:alarms': 'NOTVERSORGUNG ABGESCHALTET',
};

/** Milliseconds as m:ss. */
function fmt(ms: number): string {
  return clock(ms / 1000);
}

/** A member of the crew as the title card shows them. */
export interface CardMate {
  id: string;
  name: string;
  color: string;
}

export interface TitleCardProps {
  ending: Ending;
  missionTitle: string;
  /** how long the run took, ms; null where it has no start or no end */
  usedMs: number | null;
  grade: Grade | null;
  crew: CardMate[];
  /** stations solved, and how many the mission has */
  stations: { solved: number; total: number };
  /** the run's alarms against the limit: a run lost on them says so */
  alarms: PlayerView['alarms'];
  /** whose screen it is: their figure stands in its ring; null for the audience */
  youId: string | null;
  /** this screen played the run's end: the card comes up out of its fade */
  fresh: boolean;
}

/**
 * The card a run ends on, as the last shot of a film: what it came to in
 * large letters, the mission, the time and the rank. Won, the crew stands
 * side by side outside on the pavement, the open door behind them, and a
 * major chord sounds over the wind; lost, it stands in the dark lab under
 * the red of an emergency lamp. Where this screen played the end, the card
 * comes up out of its fade.
 */
export function TitleCard(props: TitleCardProps) {
  const { ending, fresh } = props;
  const won = ending === 'won';
  useEffect(() => {
    if (fresh && won) {
      victoryChord();
    }
  }, [fresh, won]);
  const title = ENDING_TITLES[ending];
  const tone = won ? 'won' : ending === 'lost:time' ? 'time' : 'alarms';
  return (
    <section
      className={`end-title end-title--${tone}${fresh ? ' end-title--fresh' : ''}`}
      aria-label={title}
    >
      <span className="end-title-mission">{props.missionTitle}</span>
      <h1 className="end-title-word">{title}</h1>
      <EndScene won={won} crew={props.crew} youId={props.youId} />
      <EndFacts
        usedMs={props.usedMs}
        grade={props.grade}
        stations={props.stations}
        cause={ending === 'lost:alarms' ? alarmsCause(props.alarms) : null}
      />
    </section>
  );
}

/** Why a run lost on its alarms ended: „5 von 5 Alarmen"; null where no limit counted them. */
export function alarmsCause({ count, limit }: PlayerView['alarms']): string | null {
  return limit === null ? null : `${count} von ${limit} Alarmen`;
}

/**
 * The crew on the card, side by side in their colours: won, outside on a
 * strip of pavement before the lab's open door, the light spilling out of
 * it, jumping for joy; lost, inside in the dark, the door shut, a red lamp
 * over them — their figures slumped in its shadow (finale.css).
 */
function EndScene({ won, crew, youId }: { won: boolean; crew: CardMate[]; youId: string | null }) {
  const names = crew.map((mate) => mate.name).join(', ');
  const says = won
    ? `Die Crew draußen vor dem offenen Notausgang: ${names}`
    : `Die Crew im dunklen Labor: ${names}`;
  return (
    <div className={`end-scene end-scene--${won ? 'out' : 'in'}`} role="img" aria-label={says}>
      <div className="end-sky" />
      <div className="end-wall">
        <div className="end-door">
          <span className="end-door-sign">
            <Icon name="exit" /> NOTAUSGANG
          </span>
          <span className="end-door-gap" />
        </div>
      </div>
      <div className="end-ground" />
      <ul className="end-crew">
        {crew.map((mate) => (
          <li key={mate.id} className="end-mate">
            <CrewFigure
              id={mate.id}
              color={mate.color}
              facing="front"
              isYou={mate.id === youId}
              connected
              mood={won ? 'celebrate' : 'slump'}
            />
            <span className="end-mate-name">{mate.name}</span>
          </li>
        ))}
      </ul>
      {won && <span className="end-scene-caption">Alle draußen</span>}
    </div>
  );
}

/**
 * The time large, and the rank beside it — for a run lost, the stations it got through, and
 * for one lost on its alarms (`cause`) how many it took.
 */
function EndFacts({
  usedMs,
  grade,
  stations,
  cause,
}: Pick<TitleCardProps, 'usedMs' | 'grade' | 'stations'> & { cause: string | null }) {
  return (
    <div className="end-facts">
      {cause !== null && <span className="end-cause">{cause}</span>}
      {usedMs !== null && (
        <div className="end-fact">
          <span className="end-fact-value">{fmt(usedMs)}</span>
          <span className="end-fact-label">Zeit</span>
        </div>
      )}
      {grade !== null ? (
        <div className={`grade grade-${grade.rank.toLowerCase()}`}>
          <span className="grade-rank">{grade.rank}</span>
          <span className="grade-label">{grade.label}</span>
        </div>
      ) : (
        <div className="end-fact">
          <span className="end-fact-value">
            {stations.solved}/{stations.total}
          </span>
          <span className="end-fact-label">Stationen</span>
        </div>
      )}
    </div>
  );
}

/** What the card reads off a view of a run that is over, a player's or the audience's. */
export type CardSource = Pick<
  PlayerView,
  | 'phase'
  | 'alarms'
  | 'missionTitle'
  | 'startedAt'
  | 'finishedAt'
  | 'grade'
  | 'currentPuzzleIndex'
  | 'puzzleCount'
> & { players: CardMate[] };

/** The title card of a run that is over, seen by `youId` — null for the audience. */
export function titleCardOf(
  view: CardSource,
  youId: string | null,
  fresh: boolean,
): TitleCardProps {
  const { startedAt, finishedAt } = view;
  return {
    ending: endingOf(view) ?? 'lost:time',
    missionTitle: view.missionTitle,
    usedMs: startedAt === null || finishedAt === null ? null : finishedAt - startedAt,
    grade: view.grade,
    crew: view.players.map(({ id, name, color }) => ({ id, name, color })),
    stations: { solved: view.currentPuzzleIndex, total: view.puzzleCount },
    alarms: view.alarms,
    youId,
    fresh,
  };
}

/** What the run left on the clock, and the alarms and notes it took. */
function EndStats({ view, won }: { view: PlayerView; won: boolean }) {
  const { finishedAt, deadlineAt } = view;
  const remainingMs =
    finishedAt !== null && deadlineAt !== null ? Math.max(0, deadlineAt - finishedAt) : 0;
  return (
    <div className="stats">
      {won && (
        <div className="stat">
          <span className="stat-value">{fmt(remainingMs)}</span>
          <span className="stat-label">Restzeit</span>
        </div>
      )}
      <div className="stat">
        <span className="stat-value">{view.penaltySeq}</span>
        <span className="stat-label">{view.penaltySeq === 1 ? 'Alarm' : 'Alarme'}</span>
      </div>
      <div className="stat">
        <span className="stat-value">{view.hintsUsed}</span>
        <span className="stat-label">{view.hintsUsed === 1 ? 'Hinweis' : 'Hinweise'}</span>
      </div>
    </div>
  );
}

/** The run report, line by line, each at its time into the run. */
function RunLog({ events, startedAt }: { events: RunEvent[]; startedAt: number }) {
  return (
    <>
      <h2>Einsatzprotokoll</h2>
      <ol className="report">
        {events.map((event, i) => (
          <li key={`${event.at}-${i}`} className={`report-${event.kind}`}>
            <span className="report-time">{fmt(event.at - startedAt)}</span>
            <span className="report-icon">
              <Icon name={EVENT_ICON[event.kind]} />
            </span>
            <span className="report-text">{event.label}</span>
            {event.seconds !== null && <span className="report-cost">−{event.seconds}s</span>}
          </li>
        ))}
      </ol>
    </>
  );
}

/** What the buttons under the report work with: the catalog given, possibly empty. */
type RematchProps = Omit<Props, 'fresh' | 'missions'> & { missions: MissionInfo[] };

/** The mission a won run leads on to, by id, where the run was won and its mission has one. */
function nextOf(view: PlayerView): string | undefined {
  return view.phase === 'won' ? view.nextMissionId : undefined;
}

/**
 * The yes to the next run. After a won run of a mission that leads on to
 * another, the main button goes on to that one and „Nochmal" plays the same
 * again: either click is a yes, and the host's also says which of the two
 * starts. Otherwise one button says yes to the same again. A yes given can
 * be taken back.
 */
export function NextRun({
  view,
  missions,
  send,
}: Pick<RematchProps, 'view' | 'missions' | 'send'>) {
  const ready = view.you.ready;
  const next = nextOf(view);
  if (next === undefined) {
    const toggle = (): void => send({ kind: 'set-ready', ready: !ready });
    return (
      <button className={ready ? '' : 'primary'} onClick={toggle}>
        <Icon name={ready ? 'check' : 'replay'} />{' '}
        {ready ? 'Bereit für nochmal' : 'Nochmal — ich bin dabei'}
      </button>
    );
  }
  if (ready) {
    return (
      <button onClick={() => send({ kind: 'set-ready', ready: false })}>
        <Icon name="check" /> Bereit
      </button>
    );
  }
  const title = missions.find((mission) => mission.id === next)?.title ?? 'nächster Einsatz';
  const pick = view.you.isHost ? { missionId: next } : {};
  return (
    <>
      <button className="primary" onClick={() => send({ kind: 'set-ready', ready: true, ...pick })}>
        <Icon name="play" /> Weiter: {title}
      </button>
      <button onClick={() => send({ kind: 'set-ready', ready: true })}>
        <Icon name="replay" /> Nochmal
      </button>
    </>
  );
}

/** What starts once everybody has said yes: the same again, or what the host's yes chose. */
function startsLine(view: PlayerView): string {
  if (nextOf(view) === undefined) {
    return 'Sobald alle zugestimmt haben, startet derselbe Einsatz von selbst.';
  }
  return view.you.isHost
    ? 'Sobald alle zugestimmt haben, startet der Einsatz, den du wählst.'
    : 'Sobald alle zugestimmt haben, startet der Einsatz, den der Host wählt.';
}

/** Once more with the same crew, or on — once all agree — or back to the lobby, or out. */
function Rematch({ view, missions, send, leaveRoom }: RematchProps) {
  const crew = view.players.filter((p) => p.connected);
  const waiting = crew.filter((p) => !p.ready);
  const confirmed = crew.length - waiting.length;
  return (
    <div className="actions">
      <NextRun view={view} missions={missions} send={send} />
      <p className="muted">
        {confirmed}/{crew.length} bereit
        {waiting.length > 0 ? ` — fehlen noch: ${waiting.map((p) => p.name).join(', ')}` : ''}
        . {startsLine(view)}
      </p>
      {view.you.isHost && (
        <button onClick={() => send({ kind: 'back-to-lobby' })}>
          Zur Lobby (Mission oder Schwierigkeit ändern)
        </button>
      )}
      <button className="link" onClick={leaveRoom}>
        Raum verlassen
      </button>
    </div>
  );
}

/**
 * The end of a run: its title card on top, then the story, the numbers,
 * where it stands, who did what, the run report and the rematch.
 */
export function EndScreen({ view, fresh, send, leaveRoom, missions = [] }: Props) {
  const card = titleCardOf(view, view.you.id, fresh);
  const won = card.ending === 'won';
  const { startedAt, finishedAt } = view;
  const haveStats = startedAt !== null && finishedAt !== null;

  return (
    <div className="end-screen">
      <TitleCard {...card} />
      <div className={`card end end-${won ? 'won' : 'lost'}`}>
        <p className="story">{view.storyText}</p>
        {haveStats && <EndStats view={view} won={won} />}
        {haveStats && (
          <RunStanding
            run={{
              missionId: view.missionId,
              missionTitle: view.missionTitle,
              difficulty: view.difficulty,
              won,
              crew: view.players.map((p) => p.name),
              seconds: (finishedAt - startedAt) / 1000,
              alarms: view.penaltySeq,
              finishedAt,
            }}
          />
        )}

        <h2>Beiträge</h2>
        <CreditsTable players={view.players} credits={view.credits} youId={view.you.id} />

        {view.events.length > 0 && startedAt !== null && (
          <RunLog events={view.events} startedAt={startedAt} />
        )}
        <Rematch view={view} missions={missions} send={send} leaveRoom={leaveRoom} />

        {/* A pinned room's run, for a bug report: ?seed= with it plays this run again. */}
        {view.seed?.run != null && <p className="muted run-seed">Seed {view.seed.run}</p>}
      </div>
    </div>
  );
}
