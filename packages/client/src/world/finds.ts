import {
  CHIME_GAP_MS,
  type Discovery,
  type Find,
  type ManualKind,
  type PartKind,
} from '@escapelab/core';
import { discoveryBlip } from './audio.js';
import { consoleName } from './consoles.js';
import { noteMount } from './notes.js';
import type { Caption, WorldMap } from './render/frame.js';

/**
 * A player's finds that matter are their discoveries. The server lists them in the player's
 * view (core discovery.ts `discover`) — a console of the armed station, a source printing its
 * rules, a part, a note, the sign — and marks the ones whose chime sounds, at most one every
 * CHIME_GAP_MS. This screen answers each once: „… entdeckt" always rises over the thing, and
 * the chime sounds there and then — not while the opening holds the screen as a film, nor for a
 * discovery that comes late; a chime let go is never kept for later. On the screen's first look
 * only what was found just now is news: the rest was there before it came in.
 */

const SOURCE_NAMES: Record<ManualKind, string> = {
  book: 'Buch',
  terminal: 'Terminal',
  chart: 'Wandtafel',
  clipboard: 'Klemmbrett',
  locker: 'Spind',
  cabinet: 'Aktenschrank',
};

const PART_NAMES: Record<PartKind, string> = {
  fuse: 'Sicherung',
  key: 'Schlüssel',
  crate: 'Kiste',
};

/** A chime's caption: its words and where over the thing it rises from, in tiles. */
type Words = Omit<Caption, 'at'>;

function sourceWords(map: WorldMap, id: string): Words | null {
  const source = map.manuals.find((m) => m.id === id);
  return source === undefined
    ? null
    : { x: source.x + 0.5, y: source.y, text: `${SOURCE_NAMES[source.kind]} entdeckt` };
}

function noteWords(map: WorldMap, index: number): Words | null {
  const note = map.notes.find((n) => n.index === index);
  const mount = note === undefined ? null : noteMount(map, note);
  return mount === null ? null : { x: mount.x, y: mount.y - 0.6, text: 'Notiz entdeckt' };
}

function partWords(map: WorldMap, id: string): Words | null {
  const part = map.items.find((i) => i.id === id);
  if (part === undefined) {
    return null;
  }
  const name = PART_NAMES[part.kind];
  return { x: part.x, y: part.y - 0.5, text: `${name} entdeckt` };
}

/** What a console is called where it is found: the main switch, the fuse box, a console. */
function consoleWords(map: WorldMap, find: Extract<Find, { of: 'console' }>): Words | null {
  const spot = map.stations.find(
    (s) => s.puzzleId === find.puzzleId && (s.console ?? null) === find.console,
  );
  if (spot === undefined) {
    return null;
  }
  const name =
    spot.look === 'lever'
      ? 'Hauptschalter'
      : spot.look === 'fusebox'
        ? 'Sicherungskasten'
        : spot.console === undefined
          ? 'Pult'
          : consoleName(spot.console);
  return { x: spot.x + 0.5, y: spot.y, text: `${name} entdeckt` };
}

/** The caption a chime of `find` puts over it; null where the map holds no such thing. */
export function findWords(map: WorldMap, find: Find): Words | null {
  switch (find.of) {
    case 'source':
      return sourceWords(map, find.id);
    case 'note':
      return noteWords(map, find.index);
    case 'item':
      return partWords(map, find.id);
    case 'console':
      return consoleWords(map, find);
    case 'sign': {
      const sign = map.edgeworkSign;
      return sign === null ? null : { x: sign.x + 0.5, y: sign.y, text: 'Laborkennung entdeckt' };
    }
  }
}

/** A discovery as this screen took it: its caption shown, and whether its chime sounded. */
export interface Heard extends Discovery {
  sounded: boolean;
}

/** What this screen has taken of a run's discoveries. */
export interface Ear {
  /** the run, by its `startedAt`; null before one */
  run: number | null;
  /** how many of the run's discoveries it has taken, news or not: the view only adds to them */
  taken: number;
  /** each discovery it took as news this run, oldest first: for the walkthrough's probe */
  heard: Heard[];
}

/** An ear for `run` that has taken nothing yet. */
export function freshEar(run: number | null): Ear {
  return { run, taken: 0, heard: [] };
}

/** Where this screen stands as a view's discoveries come in. */
export interface Listening {
  run: number | null;
  /** this screen's first look at the lab: what was found before it came in is no news */
  first: boolean;
  /** the opening holds the screen as a film: nothing of the game's own sounds over it */
  held: boolean;
  /** the server's clock now, epoch ms (clock.ts) */
  serverNow: number;
}

/**
 * The discoveries of `list` (a run's, oldest first) that are news to this screen now, and its
 * ear after them: every new one — on the screen's first look only those made within
 * CHIME_GAP_MS. Each shows its caption; one that chimes sounds unless the screen is held or it
 * is older than CHIME_GAP_MS — then its chime is let go, its caption shows all the same.
 */
export function hearDiscoveries(
  ear: Ear,
  list: readonly Discovery[],
  now: Listening,
): { ear: Ear; news: Heard[] } {
  const was = ear.run === now.run ? ear : freshEar(now.run);
  const recent = (one: Discovery): boolean => now.serverNow - one.at <= CHIME_GAP_MS;
  const news = list
    .slice(was.taken)
    .filter((one) => !now.first || recent(one))
    .map((one) => ({ ...one, sounded: one.chime && !now.held && recent(one) }));
  return { ear: { run: now.run, taken: list.length, heard: [...was.heard, ...news] }, news };
}

/**
 * Answers the discoveries `map` brings this screen (`hearDiscoveries`): each one's caption rises
 * over its thing from sim time `time` — into `captions` — and the chime sounds, once for those
 * that chime. Returns the ear after them.
 */
export function answerDiscoveries(
  ear: Ear,
  map: WorldMap,
  now: Listening,
  captions: Caption[],
  time: number,
): Ear {
  const { ear: next, news } = hearDiscoveries(ear, map.discoveries, now);
  for (const one of news) {
    const words = findWords(map, one.find);
    if (words !== null) {
      captions.push({ ...words, at: time });
    }
  }
  if (news.some((one) => one.sounded)) {
    discoveryBlip();
  }
  return next;
}
