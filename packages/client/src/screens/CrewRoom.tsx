import { useId, type CSSProperties } from 'react';
import type { ClientMessage, PlayerView } from '@escapelab/core';
import { makeFloorTile, makeWallTile } from '../world/art.js';
import { CrewFigure, type Facing } from './CrewFigure.js';

type Member = PlayerView['players'][number];

/** A place in the row: a crew member turned some way, or a place still free. */
export type Place =
  | { kind: 'crew'; member: Member; facing: Facing }
  | { kind: 'free'; first: boolean; needed: boolean };

/**
 * The row as one player sees it: the others in the order they came, then the
 * free places, and this player in the middle with everyone turned toward
 * them. The free places the mission cannot start without say so.
 */
export function lineup(view: Pick<PlayerView, 'players' | 'you' | 'crewSize'>): Place[] {
  const { min, max } = view.crewSize;
  const needed = min - view.players.filter((p) => p.connected).length;
  const free = Math.max(0, max - view.players.length);
  const around: Place[] = [
    ...view.players
      .filter((p) => p.id !== view.you.id)
      .map((member): Place => ({ kind: 'crew', member, facing: 'right' })),
    ...Array.from(
      { length: free },
      (_, i): Place => ({ kind: 'free', first: i === 0, needed: i < needed }),
    ),
  ];
  const half = Math.floor(around.length / 2);
  const me = view.players.find((p) => p.id === view.you.id);
  const middle: Place[] = me === undefined ? [] : [{ kind: 'crew', member: me, facing: 'front' }];
  const right = around
    .slice(half)
    .map((place): Place => (place.kind === 'crew' ? { ...place, facing: 'left' } : place));
  return [...around.slice(0, half), ...middle, ...right];
}

interface Badge {
  text: string;
  tone: 'ready' | 'wait' | 'host' | 'gone';
}

/** What the badge over a crew member says: gone, host, ready or not yet. */
function badgeOf(member: Member): Badge {
  if (!member.connected) {
    return { text: 'getrennt', tone: 'gone' };
  }
  if (member.isHost) {
    return { text: '★ Host', tone: 'host' };
  }
  return member.ready
    ? { text: '✓ bereit', tone: 'ready' }
    : { text: 'noch nicht bereit', tone: 'wait' };
}

interface SeatProps {
  member: Member;
  facing: Facing;
  isYou: boolean;
  phase: number;
}

function CrewSeat({ member, facing, isYou, phase }: SeatProps) {
  const badge = badgeOf(member);
  const marks = `seat${isYou ? ' seat-you' : ''}${member.connected ? '' : ' seat-gone'}`;
  return (
    <li className={marks}>
      <span className="seat-name">{member.name}</span>
      <span className={`seat-badge seat-badge-${badge.tone}`}>{badge.text}</span>
      <CrewFigure
        color={member.color}
        facing={facing}
        isYou={isYou}
        connected={member.connected}
        phase={phase}
      />
    </li>
  );
}

/**
 * Where somebody could stand: the figure's outline, dashed, in the canvas's
 * proportions and tile units times 100, the feet at the origin.
 */
function FigureOutline() {
  return (
    <svg className="seat-figure seat-outline" viewBox="-45 -90 90 106" aria-hidden="true">
      <ellipse cx="0" cy="0" rx="30" ry="9" />
      <path d="M-22 -60A22 22 0 0 1 22 -60V-24Q22 -15 13 -15H-13Q-22 -15 -22 -24Z" />
      <path d="M-20.5 -15V-5Q-20.5 0 -15.5 0H-8.5Q-3.5 0 -3.5 -5V-15" />
      <path d="M3.5 -15V-5Q3.5 0 8.5 0H15.5Q20.5 0 20.5 -5V-15" />
      <path d="M-22 -58H-24.5Q-28.5 -58 -28.5 -54V-34Q-28.5 -30 -24.5 -30H-22" />
      <path d="M8 -67.5H19A9.5 9.5 0 0 1 19 -48.5H8A9.5 9.5 0 0 1 8 -67.5Z" />
    </svg>
  );
}

function FreeSeat({ first, needed }: { first: boolean; needed: boolean }) {
  return (
    <li className="seat seat-open">
      <span className="seat-name">{first ? 'frei — Code oben teilen' : 'frei'}</span>
      {needed && <span className="seat-badge seat-badge-need">nötig</span>}
      <FigureOutline />
    </li>
  );
}

/** The crew colours by name for screen readers and tooltips; an unknown one goes by its code. */
const COLOR_NAMES: Readonly<Record<string, string>> = {
  '#2dd4bf': 'Türkis',
  '#f472b6': 'Pink',
  '#fbbf24': 'Gelb',
  '#60a5fa': 'Blau',
  '#a78bfa': 'Violett',
  '#4ade80': 'Grün',
  '#fb923c': 'Orange',
  '#f87171': 'Rot',
};

function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}

interface ChipProps {
  color: string;
  /** who else wears it, or null */
  owner: string | null;
  mine: boolean;
  pick: () => void;
}

function chipLabel({ color, owner, mine }: Omit<ChipProps, 'pick'>): string {
  const name = COLOR_NAMES[color] ?? color;
  if (mine) {
    return `${name} — deine Farbe`;
  }
  return owner === null ? name : `${name} — trägt ${owner}`;
}

/**
 * One crew colour as a round key: yours ticked, one that somebody else wears
 * locked under their initial.
 */
function ColorChip({ color, owner, mine, pick }: ChipProps) {
  const label = chipLabel({ color, owner, mine });
  return (
    <button
      className={mine ? 'chip chip-mine' : 'chip'}
      style={{ '--chip': color } as CSSProperties}
      disabled={owner !== null}
      aria-pressed={mine}
      aria-label={label}
      title={label}
      onClick={mine ? undefined : pick}
    >
      {owner !== null ? initialOf(owner) : mine ? '✓' : ''}
    </button>
  );
}

function Palette({ view, send }: { view: PlayerView; send: (msg: ClientMessage) => void }) {
  const caption = useId();
  return (
    <div className="palette">
      <p className="palette-caption" id={caption}>
        Deine Farbe
      </p>
      <div className="palette-chips" role="group" aria-labelledby={caption}>
        {view.palette.map(({ color, takenByName }) => {
          const mine = color === view.you.color;
          return (
            <ColorChip
              key={color}
              color={color}
              owner={mine ? null : takenByName}
              mine={mine}
              pick={() => send({ kind: 'select-color', color })}
            />
          );
        })}
      </div>
    </div>
  );
}

let tileUrls: CSSProperties | null = null;

/**
 * The game's wall and floor textures for the room's backdrop, made once: they
 * are seeded, so every call would draw the same. Without a DOM there is none.
 */
function roomTiles(): CSSProperties | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  tileUrls ??= {
    '--wall-tile': `url(${makeWallTile().toDataURL()})`,
    '--floor-tile': `url(${makeFloorTile().toDataURL()})`,
  } as CSSProperties;
  return tileUrls;
}

/**
 * The crew's room before the run: everybody standing on the lab's floor in
 * front of its wall, this player in the middle and a step nearer, with the
 * crew colours at their feet.
 */
export function CrewRoom({ view, send }: { view: PlayerView; send: (msg: ClientMessage) => void }) {
  return (
    <section className="crew-room" style={roomTiles()} aria-label="Crew">
      <p className="crew-room-sign">Startplätze werden beim Start verlost.</p>
      <ul className="seats">
        {lineup(view).map((place, i) =>
          place.kind === 'crew' ? (
            <CrewSeat
              key={place.member.id}
              member={place.member}
              facing={place.facing}
              isYou={place.member.id === view.you.id}
              phase={i * 1.9}
            />
          ) : (
            <FreeSeat key={`free-${i}`} first={place.first} needed={place.needed} />
          ),
        )}
      </ul>
      <div className="crew-room-floor">
        <Palette view={view} send={send} />
      </div>
    </section>
  );
}
