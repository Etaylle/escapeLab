import {
  NO_CREDITS,
  type Credits,
  type MapView,
  type PlayerPosition,
  type PlayerPresence,
} from '@escapelab/core';
import { consoleName } from '../world/consoles.js';

/** How many play a mission: „2 Spieler", or „2–3 Spieler" where the count may vary. */
export function crewSizeText({ min, max }: { min: number; max: number }): string {
  return min === max ? `${min} Spieler` : `${min}–${max} Spieler`;
}

export interface CrewTag {
  text: string;
  tone: 'pult' | 'read' | 'hold' | 'carry' | 'sign' | 'away';
}

/** Where someone stands: at a station, at which console where that is told, at an open source. */
type Whereabouts = Pick<PlayerPresence, 'stationId' | 'manualId'> &
  Partial<Pick<PlayerPresence, 'console'>>;

/**
 * Reach in tiles: of a station or a source, as the server counts someone
 * walking up to it; of a plate; of an emergency valve.
 */
const PRESENCE_RADIUS = 1.6;
const PLATE_RADIUS = 0.8;
const VALVE_RADIUS = 0.9;

function near(pos: PlayerPosition, spot: { x: number; y: number }, radius: number): boolean {
  return Math.hypot(pos.x - (spot.x + 0.5), pos.y - (spot.y + 0.5)) <= radius;
}

/**
 * Where someone stands, guessed from their live position the way the server
 * decides it: for crew members whose presence this player is not told.
 */
export function presenceNear(map: MapView | null, pos: PlayerPosition | undefined): Whereabouts {
  if (map === null || pos === undefined) {
    return { stationId: null, manualId: null };
  }
  const station = map.stations.find((s) => s.status === 'armed' && near(pos, s, PRESENCE_RADIUS));
  const source = map.manuals.find((m) => m.opened && near(pos, m, PRESENCE_RADIUS));
  return { stationId: station?.puzzleId ?? null, manualId: source?.id ?? null };
}

/** What someone keeps pressed by standing on it, if anything. */
function holding(map: MapView | null, pos: PlayerPosition | undefined): string | null {
  if (map === null || pos === undefined) {
    return null;
  }
  if (map.plates.some((p) => p.pressed && near(pos, p, PLATE_RADIUS))) {
    return 'hält Platte';
  }
  if (map.sabotage?.panels.some((p) => near(pos, p, VALVE_RADIUS)) === true) {
    return 'am Ventil';
  }
  return null;
}

/**
 * „am Pult", and at a station with two consoles which one, where that is
 * told: a player's own console, and everybody's to the audience. Where the
 * others stand is guessed from their position, and the guess names none.
 */
function atStation(armed: MapView['stations'][number], at: Whereabouts): string {
  const seat = armed.console === undefined ? null : (at.console ?? null);
  return seat === null ? 'am Pult' : `am ${consoleName(seat)}`;
}

/**
 * What one crew member is doing right now: at the armed station, reading,
 * holding a plate or a valve, carrying something. Plates and loads follow
 * the live position and the map; where they stand is whatever the screen
 * showing them knows.
 */
export function crewTags(
  map: MapView | null,
  player: { id: string; connected: boolean },
  at: Whereabouts,
  pos: PlayerPosition | undefined,
): CrewTag[] {
  if (!player.connected) {
    return [{ text: 'getrennt', tone: 'away' }];
  }
  const tags: CrewTag[] = [];
  // A station with two consoles is armed at both; either one has its puzzle id.
  const armed = map?.stations.find((s) => s.status === 'armed');
  if (armed !== undefined && at.stationId === armed.puzzleId) {
    tags.push({ text: atStation(armed, at), tone: 'pult' });
  }
  if (at.manualId !== null) {
    tags.push({ text: 'liest', tone: 'read' });
  }
  const held = holding(map, pos);
  if (held !== null) {
    tags.push({ text: held, tone: 'hold' });
  }
  const carried = map?.items.find((item) => item.carriedBy === player.id && !item.delivered);
  if (carried !== undefined) {
    tags.push({ text: `trägt ${carried.label}`, tone: 'carry' });
  }
  return tags;
}

export function CrewTags({ tags }: { tags: CrewTag[] }) {
  return (
    <span className="crew-tags">
      {tags.map((tag) => (
        <span key={tag.text} className={`presence-tag presence-${tag.tone}`}>
          {tag.text}
        </span>
      ))}
    </span>
  );
}

const CREDIT_COLUMNS: readonly (readonly [keyof Credits, string])[] = [
  ['operated', 'bedient'],
  ['read', 'gelesen'],
  ['found', 'gefunden'],
  ['delivered', 'geliefert'],
  ['alarms', 'Alarme'],
  ['hints', 'Notizen'],
];

function creditClass(key: keyof Credits, count: number): string | undefined {
  if (count === 0) {
    return 'credits-none';
  }
  return key === 'alarms' ? 'credits-alarm' : undefined;
}

/** Who did what this run, one row per crew member. */
export function CreditsTable({
  players,
  credits,
  youId = null,
}: {
  players: readonly { id: string; name: string; color: string }[];
  credits: Record<string, Credits>;
  youId?: string | null;
}) {
  return (
    <div className="credits">
      <table>
        <thead>
          <tr>
            <th scope="col">Crew</th>
            {CREDIT_COLUMNS.map(([key, label]) => (
              <th key={key} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const theirs = credits[p.id] ?? NO_CREDITS;
            return (
              <tr key={p.id} className={p.id === youId ? 'credits-you' : undefined}>
                <th scope="row">
                  <span className="crew-dot" style={{ background: p.color }} aria-hidden="true" />
                  {p.name}
                </th>
                {CREDIT_COLUMNS.map(([key]) => (
                  <td key={key} className={creditClass(key, theirs[key])}>
                    {theirs[key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
