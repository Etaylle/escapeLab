import {
  CREW_COLORS,
  NO_CREDITS,
  type Credits,
  type MapView,
  type MenuPlace,
  type PlayerPosition,
} from '@escapelab/core';
import { consoleName } from '../world/consoles.js';
import { carriedItem } from '../world/interact.js';
import { isArmed } from '../world/known.js';
import { near, type Whereabouts } from '../world/presence.js';

/** How many play a mission: „2 Spieler", or „2–3 Spieler" where the count may vary. */
export function crewSizeText({ min, max }: { min: number; max: number }): string {
  return min === max ? `${min} Spieler` : `${min}–${max} Spieler`;
}

/** How long a mission's clock runs: „15 min", or „ohne Uhr" for one that has none. */
export function clockSizeText(timeLimitSec: number): string {
  return timeLimitSec === 0 ? 'ohne Uhr' : `${Math.round(timeLimitSec / 60)} min`;
}

/**
 * A mission's clock in a line of its facts, the separator after it: „15 min ·", or „ohne Uhr
 * ·". The minutes stand in a text node of their own, as the lines always had them: the browser
 * shapes text node by text node, and a line with a clock lays out to the pixel as before.
 */
export function ClockFact({ timeLimitSec }: { timeLimitSec: number }) {
  if (timeLimitSec === 0) {
    return <>{clockSizeText(timeLimitSec)} ·</>;
  }
  return <>{Math.round(timeLimitSec / 60)} min ·</>;
}

/**
 * A crew member's dot in their colour — and where the settings ask for it (Zugang, „Farbmuster"),
 * the mark of that colour over it (styles/settings.css), so that the crew stands told apart
 * without the colour too: on a phone held sideways, where the row shows their dots alone.
 */
export function CrewDot({ color }: { color: string }) {
  const at = CREW_COLORS.findIndex((crew) => crew === color.toLowerCase());
  return (
    <span
      className={at < 0 ? 'crew-dot' : `crew-dot crew-dot--${at}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

export interface CrewTag {
  text: string;
  tone: 'pult' | 'press' | 'read' | 'hold' | 'carry' | 'sign' | 'away' | 'menu';
}

/** Reach in tiles of a plate, and of an emergency valve (a station's: world/presence.ts). */
const PLATE_RADIUS = 0.8;
const VALVE_RADIUS = 0.9;

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
 * What someone does at an armed station: „zieht" or „drückt" while their press there waits
 * for the rest of the crew (`pressing`), else that they stand at it; null away from every one.
 */
function stationTag(map: MapView | null, at: Whereabouts, pressing: string | null): CrewTag | null {
  if (pressing !== null) {
    return { text: pressing, tone: 'press' };
  }
  // A station with two consoles is armed at both; either one has its puzzle id. While a
  // free-order run waits for the crew's pick, every station still to solve is armed.
  const armed = map?.stations.find((s) => isArmed(s) && s.puzzleId === at.stationId);
  return armed === undefined ? null : { text: atStation(armed, at), tone: 'pult' };
}

/**
 * What one crew member is doing right now: at the pause menu over the run, which the run goes
 * on under — first, since nothing else they do moves on meanwhile —, and what they do there
 * (`doing`). A member whose line is down is only that, or gone to the main menu, their seat kept.
 */
export function crewTags(
  map: MapView | null,
  player: { id: string; connected: boolean; menu?: MenuPlace },
  at: Whereabouts,
  pos: PlayerPosition | undefined,
  pressing: string | null = null,
): CrewTag[] {
  if (!player.connected) {
    return [{ text: player.menu === 'main' ? 'im Hauptmenü' : 'getrennt', tone: 'away' }];
  }
  const menu: CrewTag[] = player.menu === 'pause' ? [{ text: 'im Menü', tone: 'menu' }] : [];
  return [...menu, ...doing(map, player.id, at, pos, pressing)];
}

/**
 * What one crew member on the line is doing: at the armed station — pulling or pressing there,
 * where their press waits for the others' (`pressing`, from the station's view) — reading,
 * holding a plate or a valve, carrying something. Plates and loads follow the live position
 * and the map; where they stand is whatever the screen showing them knows.
 */
function doing(
  map: MapView | null,
  playerId: string,
  at: Whereabouts,
  pos: PlayerPosition | undefined,
  pressing: string | null,
): CrewTag[] {
  const tags: CrewTag[] = [];
  const station = stationTag(map, at, pressing);
  if (station !== null) {
    tags.push(station);
  }
  if (at.manualId !== null) {
    tags.push({ text: 'liest', tone: 'read' });
  }
  const held = holding(map, pos);
  if (held !== null) {
    tags.push({ text: held, tone: 'hold' });
  }
  const carried = map === null ? undefined : carriedItem(map, playerId);
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
                  <CrewDot color={p.color} />
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
