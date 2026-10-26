import type { MapView, NoteHere, SourceHere } from '@escapelab/core';
import { noteMount, noteSheet } from './notes.js';

/** Prompt and client-side gate for stations and manual objects; the server counts 1.6. */
export const INTERACT_RADIUS = 1.5;
/** Pick-up and drop-off reach; the server allows 0.95. */
export const ITEM_RADIUS = 0.9;
/** The primary pointer is a finger: no keys to name, the on-screen pad shows (as ui.css has it). */
export const TOUCH = '(pointer: coarse)';

/** The box round the thing a prompt names, in tiles: its corner, width and height. */
export interface Outline {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How wide the box round a part lying about is, in tiles, and round a note's sheet. */
const PART_BOX = 0.72;
const SHEET_BOX = 0.62;

/** The box of the tile at (x, y): a station, a source, a drop-off take a whole tile. */
const tileBox = (x: number, y: number): Outline => ({ x, y, w: 1, h: 1 });

/** A box `size` across round the point (x, y). */
const boxRound = (x: number, y: number, size: number): Outline => ({
  x: x - size / 2,
  y: y - size / 2,
  w: size,
  h: size,
});

/**
 * What pressing E does where the player stands, the words of its prompt —
 * „Bedienen", no key; promptText adds that — where the prompt goes, and the
 * box round the one thing it names (`outline`), which pulses while it shows.
 */
export type ContextAction = (
  | { kind: 'deliver' | 'pick' | 'operate'; label: string; x: number; y: number }
  | { kind: 'read' | 'open'; manualId: string; label: string; x: number; y: number }
  /** a note of the last shift the server counts this player at: E reads it, for nothing */
  | { kind: 'note'; index: number; label: string; x: number; y: number }
  /** a locked cabinet without its key in hand: the prompt names what is missing, E does nothing */
  | { kind: 'locked'; label: string; x: number; y: number }
) & { outline: Outline };

/**
 * The prompt over the world for `action`: with a keyboard the key comes
 * first, „[E] Bedienen"; a touch screen has no keys, so it gets the verb
 * alone. A locked cabinet only names what is missing, either way.
 */
export function promptText(action: ContextAction, keyboard: boolean): string {
  return keyboard && action.kind !== 'locked' ? `[E] ${action.label}` : action.label;
}

type Source = Pick<SourceHere, 'id' | 'kind' | 'opened' | 'needsKey'>;
type Manual = MapView['manuals'][number];
type Item = MapView['items'][number];

/** What `playerId` carries right now: an item in their hands, not yet set in its place. */
export function carriedItem(map: Pick<MapView, 'items'>, playerId: string): Item | undefined {
  return map.items.find((item) => item.carriedBy === playerId && !item.delivered);
}

/** The manual object prints the rules of the station that is armed now. */
export function coversArmed(map: Pick<MapView, 'stations'>, manual: Manual): boolean {
  const armed = map.stations.find((s) => s.status === 'armed');
  return armed !== undefined && manual.puzzleIds.includes(armed.puzzleId);
}

/** A cabinet's key goes into its padlock: the cabinet is the drop-off, no zone needed. */
export function opensCabinet(map: Pick<MapView, 'manuals'>, itemId: string): boolean {
  return map.manuals.some((manual) => manual.needsKey === itemId);
}

/**
 * E at a manual object: read it once it is open, search a closed locker,
 * unlock a cabinet with its key in hand — or learn which key is missing.
 */
function sourceAction(map: MapView, manual: Manual, source: Source, mine?: Item): ContextAction {
  const at = { x: manual.x + 0.5, y: manual.y - 0.55, outline: tileBox(manual.x, manual.y) };
  if (source.opened) {
    return { kind: 'read', manualId: manual.id, label: 'Lesen', ...at };
  }
  if (source.kind !== 'cabinet') {
    return { kind: 'open', manualId: manual.id, label: 'Durchsuchen', ...at };
  }
  if (mine !== undefined && mine.id === source.needsKey) {
    return { kind: 'open', manualId: manual.id, label: 'Aufschließen', ...at };
  }
  const key = map.items.find((item) => item.id === source.needsKey);
  return { kind: 'locked', label: `🔒 ${key?.label ?? 'Schlüssel'} fehlt`, ...at };
}

/**
 * E at the note of the last shift the server counts this player at, by its
 * spot on the map; none where the crew has not come across it yet.
 */
function noteAction(
  map: MapView,
  noteHere: Pick<NoteHere, 'index'> | null,
  dist: (x: number, y: number) => number,
): { action: ContextAction; d: number }[] {
  const note = map.notes.find((n) => n.index === noteHere?.index);
  const mount = note === undefined ? null : noteMount(map, note);
  if (note === undefined || mount === null) {
    return [];
  }
  const sheet = noteSheet(mount);
  const at = {
    x: mount.x,
    y: mount.facing === null ? mount.y - 0.55 : mount.y - 0.85,
    outline: boxRound(sheet.x, sheet.y, SHEET_BOX),
  };
  return [
    {
      action: { kind: 'note', index: note.index, label: 'Lesen', ...at },
      d: dist(mount.spot.x + 0.5, mount.spot.y + 0.5),
    },
  ];
}

/**
 * What pressing E would do where the player stands. A carried part goes in
 * first at its drop-off; otherwise the nearest of a loose part, the armed
 * station, a manual object and a note the server already counts this player
 * at — so the prompt names what E does, and never promises what it cannot do. A
 * station with two consoles is armed at both, and E works the nearer. Full
 * hands work a station like empty ones, open (`stationOpen`) or shut; only
 * with free hands does a loose part at the player's feet come before
 * switching a station on, because the server picks it up first. A key goes
 * into its cabinet by unlocking it. A locked cabinet only speaks up when
 * nothing else is in reach.
 */
export function contextAction(
  map: MapView,
  self: { x: number; y: number },
  youId: string,
  sourcesHere: readonly Source[],
  stationOpen: boolean,
  noteHere: Pick<NoteHere, 'index'> | null,
): ContextAction | null {
  const dist = (x: number, y: number): number => Math.hypot(self.x - x, self.y - y);

  const mine = carriedItem(map, youId);
  const key = mine !== undefined && map.manuals.some((manual) => manual.needsKey === mine.id);
  const goal = key ? null : (mine?.deliverTo ?? null);
  if (mine !== undefined && goal !== null && dist(goal.x + 0.5, goal.y + 0.5) <= ITEM_RADIUS) {
    return {
      kind: 'deliver',
      label: `${mine.label} einsetzen`,
      x: goal.x + 0.5,
      y: goal.y - 0.45,
      outline: tileBox(goal.x, goal.y),
    };
  }

  // The server picks up the first loose part in reach, in map order, and only with free hands.
  const loose = map.items.find(
    (item) => !item.delivered && item.carriedBy === null && dist(item.x, item.y) <= ITEM_RADIUS,
  );
  const stations =
    stationOpen || mine !== undefined || loose === undefined
      ? map.stations.filter((s) => s.status === 'armed')
      : [];
  const candidates: { action: ContextAction; d: number }[] = map.manuals.flatMap((manual) => {
    const source = sourcesHere.find((here) => here.id === manual.id);
    return source === undefined
      ? []
      : [
          {
            action: sourceAction(map, manual, source, mine),
            d: dist(manual.x + 0.5, manual.y + 0.5),
          },
        ];
  });
  candidates.push(...noteAction(map, noteHere, dist));
  if (mine === undefined && loose !== undefined) {
    const label = `${loose.label} aufnehmen`;
    const outline = boxRound(loose.x, loose.y, PART_BOX);
    candidates.push({
      action: { kind: 'pick', label, x: loose.x, y: loose.y - 0.95, outline },
      d: dist(loose.x, loose.y),
    });
  }
  for (const station of stations) {
    const { x, y } = station;
    const outline = tileBox(x, y);
    candidates.push({
      action: { kind: 'operate', label: 'Bedienen', x: x + 0.5, y: y - 0.55, outline },
      d: dist(x + 0.5, y + 0.5),
    });
  }
  const locked = (candidate: { action: ContextAction }): number =>
    Number(candidate.action.kind === 'locked');
  const nearest = candidates
    .filter((candidate) => candidate.d <= INTERACT_RADIUS)
    .sort((a, b) => locked(a) - locked(b) || a.d - b.d)[0];
  return nearest?.action ?? null;
}
