import type { MapView, SourceHere } from '@escapelab/core';

/** Prompt and client-side gate for stations and manual objects; the server counts 1.6. */
export const INTERACT_RADIUS = 1.5;
/** Pick-up and drop-off reach; the server allows 0.95. */
export const ITEM_RADIUS = 0.9;

/**
 * What pressing E does where the player stands, the words of its prompt —
 * „Bedienen", no key; promptText adds that — and where the prompt goes.
 */
export type ContextAction =
  | { kind: 'deliver' | 'pick' | 'operate'; label: string; x: number; y: number }
  | { kind: 'read' | 'open'; manualId: string; label: string; x: number; y: number }
  /** a locked cabinet without its key in hand: the prompt names what is missing, E does nothing */
  | { kind: 'locked'; label: string; x: number; y: number };

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

/**
 * E at a manual object: read it once it is open, search a closed locker,
 * unlock a cabinet with its key in hand — or learn which key is missing.
 */
function sourceAction(map: MapView, manual: Manual, source: Source, mine?: Item): ContextAction {
  const at = { x: manual.x + 0.5, y: manual.y - 0.55 };
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
 * What pressing E would do where the player stands. A carried part goes in
 * first at its drop-off; otherwise the nearest of a loose part, the armed
 * station and a manual object the server already counts this player at —
 * so the prompt names what E does, and never promises what it cannot do. A
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
  if (mine === undefined && loose !== undefined) {
    const label = `${loose.label} aufnehmen`;
    candidates.push({
      action: { kind: 'pick', label, x: loose.x, y: loose.y - 0.95 },
      d: dist(loose.x, loose.y),
    });
  }
  for (const station of stations) {
    candidates.push({
      action: { kind: 'operate', label: 'Bedienen', x: station.x + 0.5, y: station.y - 0.55 },
      d: dist(station.x + 0.5, station.y + 0.5),
    });
  }
  const locked = (candidate: { action: ContextAction }): number =>
    Number(candidate.action.kind === 'locked');
  const nearest = candidates
    .filter((candidate) => candidate.d <= INTERACT_RADIUS)
    .sort((a, b) => locked(a) - locked(b) || a.d - b.d)[0];
  return nearest?.action ?? null;
}
