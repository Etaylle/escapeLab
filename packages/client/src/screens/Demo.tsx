import { useEffect, useState } from 'react';
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
import { EndScreen } from './End.js';
import { GameScreen } from './Game.js';
import { Icon } from './Icon.js';
import type { GameLine } from './Line.js';
import { DEMO_LABEL, SpectateScreen } from './Spectate.js';

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
  one: 'Spieler 1',
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

/** The seat a viewer who chose `pin` is shown, by player id; null for the whole lab. */
export function seatShown(pin: DemoPin, shot: DemoShot | null): string | null {
  if (shot === null || pin === 'overview') {
    return null;
  }
  const [one, two] = Object.keys(shot.doing);
  const pinned = { regie: shot.onAir, one, two }[pin];
  return pinned ?? null;
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

/** The seat's own screen, read-only: the run on, its end as the world plays it, its Auswertung. */
function SeatScreen({ seat, doing, game }: { seat: PlayerView; doing: DemoDoing; game: Props }) {
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
    watch: doing,
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

const NOTHING = (): void => undefined;
const IDLE: DemoDoing = { what: 'idle', sourceId: null };

/**
 * The picture a viewer who chose `pin` is shown: the own view of a seat and what that seat is
 * doing — or no seat, for the whole lab: chosen, on air, or because no seat's view has come
 * yet, or the room stands in its lobby.
 */
export function pictureOf(
  pin: DemoPin,
  feed: DemoFeed,
  view: Pick<SpectatorView, 'phase'>,
): { seat: PlayerView | null; doing: DemoDoing } {
  const shown = seatShown(pin, feed.shot);
  const seat = shown === null ? undefined : feed.views[shown];
  if (shown === null || seat === undefined || seat.phase === 'lobby' || view.phase === 'lobby') {
    return { seat: null, doing: IDLE };
  }
  return { seat, doing: feed.shot?.doing[shown] ?? IDLE };
}

export function DemoScreen(props: Props) {
  const { view, feed, send } = props;
  const [pin, setPin] = useState<DemoPin>(keptPin);
  const up = props.line.status === 'open';
  // The server sends the seat pinned: it is told of each choice, and anew on every new line —
  // a line that just came up follows the director until it hears otherwise.
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
  const { seat, doing } = pictureOf(pin, feed, view);
  const line =
    seat === null
      ? { name: null, text: OVERVIEW_LINE }
      : { name: seat.you.name, text: doingLine(seat, doing) };
  return (
    <div className={seat === null ? 'demo demo--overview' : 'demo demo--seat'}>
      <div className="demo-picture">
        {seat !== null ? (
          <SeatScreen seat={seat} doing={doing} game={props} />
        ) : (
          <SpectateScreen
            view={view}
            finale={props.finale}
            positionsRef={props.positionsRef}
            dronesRef={props.dronesRef}
            pingsRef={props.pingsRef}
            chatsRef={props.chatsRef}
            leaveRoom={props.leaveRoom}
            demo
          />
        )}
      </div>
      <LowerThird line={line} pin={pin} choose={choose} leaveRoom={props.leaveRoom} />
    </div>
  );
}
