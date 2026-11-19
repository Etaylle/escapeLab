import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  DEMO_PINS,
  type ClientMessage,
  type DemoDoing,
  type DemoPin,
  type DemoShot,
  type DronePosition,
  type PlayerView,
  type SpectatorView,
} from '@escapelab/core';
import type { Connection, DemoFeed } from '../ws.js';
import type { Finale } from '../world/finale.js';
import type { KnownPositions } from '../world/movement.js';
import type { ChatLine, MapPing } from '../world/render/frame.js';
import { useReducedMotion } from '../settings.js';
import { useDarkSince } from '../world/coldOpen.js';
import { GameWorld } from '../world/GameWorld.js';
import { EndScreen, TitleCard, titleCardOf } from './End.js';
import { GameScreen, type Watch } from './Game.js';
import { Icon } from './Icon.js';
import type { GameLine } from './Line.js';
import { DEMO_LABEL, spectatorAsPlayerView } from './Spectate.js';

/**
 * The demo room as its audience sees it: the game as one of its crew has it — that seat's own
 * screen, read-only (Game.tsx `watch`) — cut by the server's director between the two seats and
 * the whole lab (server demo/director.ts), the same picture for everybody; under it a line that
 * says who is on air and what they are doing, and a choice of one's own: the director's cut, a
 * seat, or the lab from above.
 */

interface Props {
  view: SpectatorView;
  feed: DemoFeed;
  finale: Finale | null;
  positionsRef: React.MutableRefObject<KnownPositions>;
  dronesRef: React.MutableRefObject<Record<string, DronePosition>>;
  pingsRef: React.MutableRefObject<MapPing[]>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  send: (msg: ClientMessage) => void;
  listen: Connection['listen'];
  line: GameLine;
  leaveRoom: () => void;
}

/** What the choice of one's own picture calls each (`DemoPin`). */
export const PIN_LABELS: Record<DemoPin, string> = {
  regie: 'Regie',
  // voice: interface — the choice's own labels name the seats, as Uros asked (2026-11-19)
  one: 'Spieler 1',
  // voice: interface — as above
  two: 'Spieler 2',
  overview: 'Übersicht',
};

/** What the line under the picture says of the whole lab from above. */
export const OVERVIEW_LINE = 'Übersicht · die ganze Anlage';

/** What one of the crew is doing, as the line under the picture says it after its name. */
const DOING_LINES: Record<DemoDoing['what'], string> = {
  idle: 'wartet',
  intro: 'Schichtbeginn',
  walk: 'unterwegs',
  carry: 'bringt ein Teil',
  sign: 'liest die Laborkennung',
  plate: 'hält die Tür offen',
  read: 'liest',
  operate: 'am Pult',
  escape: 'auf dem Weg zur Luke',
};

/** The key the viewer's own choice is kept under for the session. */
const PIN_KEY = 'escapelab.demoPin';

/** The choice kept for this session; the director's cut where none is, or none can be read. */
export function keptPin(): DemoPin {
  try {
    const kept = sessionStorage.getItem(PIN_KEY);
    return DEMO_PINS.find((pin) => pin === kept) ?? 'regie';
  } catch {
    return 'regie';
  }
}

function keepPin(pin: DemoPin): void {
  try {
    sessionStorage.setItem(PIN_KEY, pin);
  } catch {
    // A session that keeps nothing shows the director's cut next time.
  }
}

/**
 * What the line under the picture says of the seat `view` doing `doing`: its name, what it does
 * — the source it reads by its name, the console it stands at by its letter where the station
 * has two.
 */
export function doingLine(view: PlayerView, doing: DemoDoing): string {
  const said = DOING_LINES[doing.what];
  if (doing.what === 'read') {
    const source = view.map?.manuals.find((manual) => manual.id === doing.sourceId);
    return source?.known === true ? `${said}: ${source.label}` : said;
  }
  const letter = doing.what === 'operate' ? consoleOfTwo(view) : null;
  return letter === null ? said : `${said} ${letter}`;
}

/** The letter of the console `view`'s seat stands at, where the station up has two; else null. */
function consoleOfTwo(view: PlayerView): string | null {
  const armed = view.map?.stations.filter((s) => s.known && s.status === 'armed') ?? [];
  const console = view.presence.console;
  return armed.length > 1 && console !== null ? console.toUpperCase() : null;
}

/** The viewer's own choice of picture: four buttons, the one chosen pressed. */
function PinChoice({ pin, choose }: { pin: DemoPin; choose: (pin: DemoPin) => void }) {
  return (
    <div className="demo-pins" role="group" aria-label="Bild wählen">
      {DEMO_PINS.map((each) => (
        <button
          key={each}
          type="button"
          className={each === pin ? 'demo-pin demo-pin--on' : 'demo-pin'}
          aria-pressed={each === pin}
          onClick={() => choose(each)}
        >
          {PIN_LABELS[each]}
        </button>
      ))}
    </div>
  );
}

/** The bar under the picture: the label, who is on air doing what, the choice, the way out. */
function LowerThird({
  line,
  pin,
  choose,
  leaveRoom,
}: {
  line: { name: string | null; text: string };
  pin: DemoPin;
  choose: (pin: DemoPin) => void;
  leaveRoom: () => void;
}) {
  return (
    <div className="demo-third">
      <span className="demo-label">{DEMO_LABEL}</span>
      <p className="demo-onair" aria-live="polite">
        {line.name !== null && <strong>{line.name}</strong>}
        {line.name !== null && ' · '}
        {line.text}
      </p>
      <PinChoice pin={pin} choose={choose} />
      <button className="link demo-leave" onClick={leaveRoom}>
        <Icon name="exit" /> Zuschauen beenden
      </button>
    </div>
  );
}

/**
 * What one of the crew tells the other, under the picture as a subtitle: the crew are machines
 * and say nothing, so the audience reads what a crew of people would call across — a sentence of
 * the rules the one has just read, word for word (server demo/caption.ts).
 */
function Caption({ view, shot }: { view: SpectatorView; shot: DemoShot | null }) {
  const caption = shot?.caption ?? null;
  if (caption === null) {
    return null;
  }
  const by = view.players.find((player) => player.id === caption.by);
  return (
    <p className="demo-caption" aria-live="polite">
      {by !== undefined && <strong style={{ color: by.color }}>{by.name}: </strong>}
      „{caption.text}“
    </p>
  );
}

/** How long a cut's cross-fade takes, ms (styles/demo.css `demo-fade`). */
export const CUT_FADE_MS = 400;

/** The seat's own screen, read-only: the run on, its end as the world plays it, its Auswertung. */
function SeatScreen({ seat, watch, game }: { seat: PlayerView; watch: Watch; game: Props }) {
  const { finale } = game;
  const shared = {
    roomCode: null,
    positionsRef: game.positionsRef,
    dronesRef: game.dronesRef,
    pingsRef: game.pingsRef,
    chatsRef: game.chatsRef,
    send: NOTHING,
    listen: game.listen,
    refusal: null,
    line: game.line,
    watch,
  };
  if (seat.phase === 'playing') {
    return <GameScreen {...shared} view={seat} finale={null} />;
  }
  if (finale?.running === true && finale.map !== null) {
    return <GameScreen {...shared} view={{ ...seat, map: finale.map }} finale={finale} />;
  }
  return (
    <div className="demo-end" inert>
      <EndScreen view={seat} fresh={finale?.played === true} send={NOTHING} leaveRoom={NOTHING} />
    </div>
  );
}

/** What the whole lab's picture says between two runs, while the room stands in its lobby. */
export const LOBBY_LINE = 'Schichtwechsel: Der nächste Einsatz beginnt gleich.';

/**
 * A box whose canvas is handed to `leaving` as the box goes — while it is still in the page: the
 * cut's cross-fade takes its last picture off it.
 */
function useLastPicture(leaving: (canvas: HTMLCanvasElement) => void) {
  const box = useRef<HTMLDivElement>(null);
  const hand = useRef(leaving);
  hand.current = leaving;
  useLayoutEffect(() => {
    const el = box.current;
    return () => {
      const canvas = el?.querySelector('canvas') ?? null;
      if (canvas !== null) {
        hand.current(canvas);
      }
    };
  }, []);
  return box;
}

/** What the whole lab's picture is: the run's card after its end, a line in the lobby, the lab. */
export function labStage(view: SpectatorView, finale: Finale | null): 'card' | 'wait' | 'world' {
  const ending = finale?.running === true;
  if ((view.phase === 'won' || view.phase === 'lost') && !ending) {
    return 'card';
  }
  return view.map === null && !(ending && finale.map !== null) ? 'wait' : 'world';
}

/**
 * The whole lab from above, as the audience has it: a picture over the seat's screen, which is
 * heard on under it — the picture itself makes no sound (GameWorld `silent`). As it goes it
 * hands `leaving` its canvas, for the cut's cross-fade.
 */
function LabPicture(props: { game: Props; leaving: (canvas: HTMLCanvasElement) => void }) {
  const { view, finale } = props.game;
  const box = useLastPicture(props.leaving);
  const stage = labStage(view, finale);
  return (
    <div className="demo-lab" ref={box}>
      {stage === 'card' && <TitleCard {...titleCardOf(view, null, finale?.played === true)} />}
      {stage === 'wait' && <p className="demo-wait">{LOBBY_LINE}</p>}
      {stage === 'world' && <LabWorld game={props.game} />}
    </div>
  );
}

/** The lab's world for the audience, silent: the run on, or its end as the world plays it. */
function LabWorld({ game }: { game: Props }) {
  const { view, finale } = game;
  const darkSince = useDarkSince(view.lights, view.startedAt);
  const ending = finale?.running === true ? finale : null;
  const map = view.map ?? ending?.map ?? null;
  if (map === null) {
    return null;
  }
  return (
    <GameWorld
      view={spectatorAsPlayerView({ ...view, map })}
      positionsRef={game.positionsRef}
      dronesRef={game.dronesRef}
      pingsRef={game.pingsRef}
      chatsRef={game.chatsRef}
      spectator
      silent
      darkSince={darkSince}
      finale={ending === null ? null : { ending: ending.ending, since: ending.since }}
      inputLocked
      holdTips={false}
      onToggleInfo={NOTHING}
      onRead={NOTHING}
      onReadNote={NOTHING}
      onOperate={NOTHING}
      send={NOTHING}
    />
  );
}

const NOTHING = (): void => undefined;
const IDLE: DemoDoing = { what: 'idle', sourceId: null };

/** What a viewer is shown and hears the lab by (`pictureOf`). */
export interface Picture {
  /**
   * the seat whose own screen is up, and heard: the one pinned, the one on air, or — under the
   * whole lab — the one last on air; null while no seat's view has come, and in the lobby
   */
  seat: PlayerView | null;
  /** what that seat is doing */
  doing: DemoDoing;
  /** the whole lab is the picture: chosen, on air, or for want of a seat */
  lab: boolean;
}

/** The seat a viewer who chose `pin` is shown or hears by, by player id; null before any shot. */
export function seatShown(pin: DemoPin, shot: DemoShot | null): string | null {
  if (shot === null) {
    return null;
  }
  const [one, two] = Object.keys(shot.doing);
  return { regie: shot.onAir ?? shot.ear, overview: shot.ear, one, two }[pin] ?? null;
}

/** The view of the seat `shown` as the feed last had it; null for none, and in a lobby. */
function seatView(
  shown: string | null,
  feed: DemoFeed,
  view: Pick<SpectatorView, 'phase'>,
): PlayerView | null {
  const sent = shown === null ? undefined : feed.views[shown];
  return sent === undefined || sent.phase === 'lobby' || view.phase === 'lobby' ? null : sent;
}

/** The picture of a viewer who chose `pin`, by the demo's `feed` and the audience's `view`. */
export function pictureOf(
  pin: DemoPin,
  feed: DemoFeed,
  view: Pick<SpectatorView, 'phase'>,
): Picture {
  const shown = seatShown(pin, feed.shot);
  const seat = seatView(shown, feed, view);
  if (shown === null || seat === null) {
    return { seat: null, doing: IDLE, lab: true };
  }
  const lab = pin === 'overview' || (pin === 'regie' && feed.shot?.onAir === null);
  return { seat, doing: feed.shot?.doing[shown] ?? IDLE, lab };
}

/** `to` laid exactly over `from` inside the frame both stand in, `from`'s picture drawn on it. */
function copyOver(to: HTMLCanvasElement, from: HTMLCanvasElement): void {
  const frame = to.parentElement?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const at = from.getBoundingClientRect();
  to.width = from.width;
  to.height = from.height;
  Object.assign(to.style, {
    left: `${at.left - frame.left}px`,
    top: `${at.top - frame.top}px`,
    width: `${at.width}px`,
    height: `${at.height}px`,
  });
  to.getContext('2d')?.drawImage(from, 0, 0);
}

/**
 * The cut's cross-fade: the picture that goes, kept on `fade` for a moment and faded out over
 * the one that comes — `snap` takes it off a world's canvas. A plain swap for whoever asked for
 * less motion.
 */
function useCrossFade(
  fade: React.RefObject<HTMLCanvasElement | null>,
  reduced: boolean,
): (from: HTMLCanvasElement) => void {
  return useCallback(
    (from) => {
      const to = fade.current;
      if (reduced || to === null || from.width === 0) {
        return;
      }
      copyOver(to, from);
      to.classList.remove('demo-fade--on');
      // Read to restart the animation on the same element.
      void to.offsetWidth;
      to.classList.add('demo-fade--on');
    },
    [fade, reduced],
  );
}

/** The pin a viewer chose, kept for the session, and told the server on every line (`demo-pin`). */
function usePin(send: Props['send'], up: boolean): [DemoPin, (pin: DemoPin) => void] {
  const [pin, setPin] = useState<DemoPin>(keptPin);
  // A line that just came up follows the director until it hears otherwise.
  useEffect(() => {
    if (up && pin !== 'regie') {
      send({ kind: 'demo-pin', pin });
    }
    // `send` is stable for the connection's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, up]);
  const choose = (next: DemoPin): void => {
    keepPin(next);
    setPin(next);
    if (next === 'regie' && up) {
      send({ kind: 'demo-pin', pin: next });
    }
  };
  return [pin, choose];
}

export function DemoScreen(props: Props) {
  const { view, feed } = props;
  const [pin, choose] = usePin(props.send, props.line.status === 'open');
  const { seat, doing, lab } = pictureOf(pin, feed, view);
  const fade = useRef<HTMLCanvasElement>(null);
  const seatBox = useRef<HTMLDivElement>(null);
  const snap = useCrossFade(fade, useReducedMotion());
  // A cut away from a seat — to the other, or to the whole lab — fades that seat's picture out.
  const onSeat = lab || seat === null ? null : seat.you.id;
  const was = useRef(onSeat);
  useLayoutEffect(() => {
    const canvas = seatBox.current?.querySelector('canvas');
    if (was.current !== null && was.current !== onSeat && canvas != null) {
      snap(canvas);
    }
    was.current = onSeat;
  }, [onSeat, snap]);
  const line =
    lab || seat === null
      ? { name: null, text: OVERVIEW_LINE }
      : { name: seat.you.name, text: doingLine(seat, doing) };
  return (
    <div className={lab ? 'demo demo--lab' : 'demo demo--seat'}>
      <div className="demo-picture">
        {seat !== null && (
          <div className="demo-seat" ref={seatBox}>
            <SeatScreen seat={seat} watch={{ doing, covered: lab }} game={props} />
          </div>
        )}
        {lab && <LabPicture game={props} leaving={snap} />}
        <canvas className="demo-fade" ref={fade} aria-hidden="true" />
        <Caption view={view} shot={feed.shot} />
      </div>
      <LowerThird line={line} pin={pin} choose={choose} leaveRoom={props.leaveRoom} />
    </div>
  );
}
