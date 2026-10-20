import { useEffect, useState } from 'react';
import type { PlayerPosition, DronePosition, SpectatorView } from '@escapelab/core';
import { useVoice } from '../voice/useVoice.js';
import { useDarkSince } from '../world/coldOpen.js';
import type { Finale } from '../world/finale.js';
import { GameWorld, type ChatLine, type MapPing } from '../world/GameWorld.js';
import type { KnownPositions } from '../world/movement.js';
import { RelayConsole } from '../puzzles/RelayPanel.js';
import { PuzzlePanel } from './PuzzlePanel.js';
import { Manual } from './Manual.js';
import { EdgeworkChip } from './EdgeworkChip.js';
import { CreditsTable, crewTags, CrewTags, type CrewTag } from './Crew.js';
import { TitleCard, titleCardOf } from './End.js';
import { FinaleVeil } from './Game.js';
import { Icon } from './Icon.js';
import { ListenToggle, SpeakingMark } from './Voice.js';

interface Props {
  view: SpectatorView;
  /** the end of the run on this screen (world/finale.ts): the world plays it, then its card */
  finale: Finale | null;
  positionsRef: React.MutableRefObject<KnownPositions>;
  dronesRef: React.MutableRefObject<Record<string, DronePosition>>;
  pingsRef: React.MutableRefObject<MapPing[]>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  leaveRoom: () => void;
}

function remaining(deadlineAt: number, now: number): string {
  const total = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Run time of an event as mm:ss, the way a match log reads. */
function elapsed(startedAt: number | null, at: number): string {
  const total = startedAt === null ? 0 : Math.max(0, Math.floor((at - startedAt) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * What the audience sees of a crew member: where the server says they stand,
 * what they hold and carry, and whether they have read the sign.
 */
export function audienceTags(
  view: SpectatorView,
  player: SpectatorView['players'][number],
  pos: PlayerPosition | undefined,
): CrewTag[] {
  const tags = crewTags(view.map, player, player.presence, pos);
  return player.presence.signSeen ? [...tags, { text: 'Kennung', tone: 'sign' }] : tags;
}

/**
 * The audience's column beside the world: the open station from every side —
 * once the run is over, who did what — any relay consoles in an emergency,
 * and the run report as it grows.
 */
function SpectatePanels({ view }: { view: SpectatorView }) {
  const noop = (): void => undefined;
  const feed = view.events.slice(-14).reverse();
  const over = view.phase === 'won' || view.phase === 'lost';
  const colorOf = (playerId: string): string | undefined =>
    view.players.find((p) => p.id === playerId)?.color;
  return (
    <div className="spectate-panels">
      {over ? (
        <section className="panel">
          <div className="panel-label">// Beiträge</div>
          <CreditsTable players={view.players} credits={view.credits} />
        </section>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <div className="panel-label">// {view.puzzle?.title ?? 'Station'}</div>
            {view.edgework !== null && <EdgeworkChip edgework={view.edgework} />}
          </div>
          {view.puzzle === null ? (
            <p className="muted">Unterwegs — gerade keine Station offen.</p>
          ) : (
            <>
              {view.puzzle.manual !== null && <Manual sections={view.puzzle.manual} />}
              <div className="read-only">
                <PuzzlePanel
                  puzzle={view.puzzle}
                  run={{ alarms: view.penaltySeq, solved: view.currentPuzzleIndex }}
                  send={noop}
                  deadlineAt={view.deadlineAt}
                />
              </div>
            </>
          )}
        </section>
      )}
      {view.panels.map(
        (panel) =>
          panel.emergency !== undefined && (
            <section key={panel.playerId} className="panel">
              <div className="panel-label">
                //{' '}
                <span
                  className="crew-dot"
                  style={{ background: colorOf(panel.playerId) }}
                  aria-hidden="true"
                />
                {panel.name}
              </div>
              <div className="read-only">
                <RelayConsole relay={panel.emergency} send={noop} />
              </div>
            </section>
          ),
      )}

      <section className="panel spectate-log">
        <div className="panel-label">// Einsatzprotokoll</div>
        {feed.length === 0 ? (
          <p className="muted">Noch nichts passiert.</p>
        ) : (
          <ul className="ticker">
            {feed.map((event, i) => (
              <li key={`${event.at}-${i}`} className={`ticker-${event.kind}`}>
                <span className="ticker-time">{elapsed(view.startedAt, event.at)}</span>
                {event.label}
                {event.seconds !== null ? ` (−${event.seconds}s)` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The crew along the foot, what each is doing, the voice and the way out. */
function SpectateFoot({
  view,
  positionsRef,
  leaveRoom,
}: Pick<Props, 'view' | 'positionsRef' | 'leaveRoom'>) {
  const speaking = useVoice()?.state.speaking;
  return (
    <div className="spectate-foot">
      <ul className="players inline">
        {view.players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'offline'}>
            <span className="crew-dot" style={{ background: p.color }} aria-hidden="true" />
            {p.name}
            {speaking?.has(p.id) === true && <SpeakingMark />}
            {view.phase === 'playing' && (
              <CrewTags tags={audienceTags(view, p, positionsRef.current.players[p.id])} />
            )}
          </li>
        ))}
      </ul>
      <ListenToggle />
      <button className="link" onClick={leaveRoom}>
        Zuschauen beenden
      </button>
    </div>
  );
}

/**
 * Audience view: the whole lab revealed, plus the open station from every
 * side. The run's end plays in the world as for the crew, and its title card
 * takes the world's place after.
 */
export function SpectateScreen({
  view,
  finale,
  positionsRef,
  dronesRef,
  pingsRef,
  chatsRef,
  leaveRoom,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  // The audience sees the lights fail too, unless it came in after.
  const darkSince = useDarkSince(view.lights, view.startedAt);

  const noop = (): void => undefined;
  const over = view.phase === 'won' || view.phase === 'lost';
  // While the end plays, the world goes on with the last map of the run.
  const ending = finale?.running === true ? finale : null;
  const map = view.map ?? ending?.map ?? null;

  return (
    <div className="spectate">
      <div className="spectate-head">
        <div>
          <span className="kicker">ZUSCHAUERMODUS · {view.difficulty}</span>
          <h1>{view.missionTitle}</h1>
        </div>
        <div className="spectate-stats">
          {view.deadlineAt !== null && view.phase === 'playing' && (
            <span className="countdown">{remaining(view.deadlineAt, now)}</span>
          )}
          <span className="pill">
            {view.currentPuzzleIndex}/{view.puzzleCount} Stationen · {view.penaltySeq} Alarme
          </span>
        </div>
      </div>

      {view.phase === 'lobby' && (
        <div className="banner-result">Die Crew ist noch in der Lobby …</div>
      )}

      {view.pausedFor !== null && (
        <div className="banner-result">
          <Icon name="pause" /> Pausiert — warten auf {view.pausedFor.join(', ')}
        </div>
      )}

      <div className="spectate-body">
        <div className="spectate-world">
          {over && ending === null ? (
            <TitleCard {...titleCardOf(view, null, finale?.played === true)} />
          ) : (
            map !== null && (
              <GameWorld
                view={spectatorAsPlayerView({ ...view, map })}
                positionsRef={positionsRef}
                dronesRef={dronesRef}
                pingsRef={pingsRef}
                chatsRef={chatsRef}
                spectator
                darkSince={darkSince}
                finale={ending === null ? null : { ending: ending.ending, since: ending.since }}
                inputLocked
                holdTips={false}
                onToggleInfo={noop}
                onRead={noop}
                onOperate={noop}
                send={noop}
              />
            )
          )}
        </div>

        <SpectatePanels view={view} />
      </div>

      <SpectateFoot view={view} positionsRef={positionsRef} leaveRoom={leaveRoom} />
      {ending !== null && <FinaleVeil ending={ending.ending} since={ending.since} />}
    </div>
  );
}

/**
 * GameWorld renders from a player's view; an audience has no player, so we
 * hand it a stand-in whose fields it actually reads in spectator mode.
 */
function spectatorAsPlayerView(view: SpectatorView): Parameters<typeof GameWorld>[0]['view'] {
  return {
    phase: view.phase,
    missionId: '',
    missionTitle: view.missionTitle,
    difficulty: view.difficulty,
    storyText: view.storyText,
    crewSize: { min: view.players.length, max: view.players.length },
    you: { id: '', name: '', color: '#2dd4bf', ready: false, isHost: false },
    players: view.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      ready: false,
      connected: p.connected,
      isHost: false,
    })),
    palette: [],
    deadlineAt: view.deadlineAt,
    startedAt: view.startedAt,
    finishedAt: view.finishedAt,
    timeLimitSec: view.timeLimitSec,
    lights: view.lights,
    currentPuzzleIndex: view.currentPuzzleIndex,
    puzzleCount: view.puzzleCount,
    pausedFor: view.pausedFor,
    events: view.events,
    grade: view.grade,
    penaltySeq: view.penaltySeq,
    lastPenaltySec: null,
    alarms: view.alarms,
    hintsUsed: view.hintsUsed,
    credits: view.credits,
    edgework: null,
    presence: { stationId: null, console: null, manualId: null, signSeen: false },
    sourcesHere: [],
    manualsHere: [],
    puzzle: null,
    map: view.map,
  };
}
