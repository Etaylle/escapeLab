import { CHIME_GAP_MS, type Chime, type Find, type ManualKind } from '@escapelab/core';
import { discoveryBlip } from './audio.js';
import { consoleName } from './consoles.js';
import { carryableKind, type CarryableKind } from './hazards.js';
import { noteMount } from './notes.js';
import type { Caption, WorldMap } from './render/frame.js';

/**
 * Finds that matter chime. The server picks them (core discovery.ts `chimeFinds`): a console of
 * the armed station, a source printing its rules, a part, a note, the sign — at most one every
 * CHIME_GAP_MS for a player, never twice for one thing — and lists
 * them in the player's view. This screen answers each once, there and then, with the chime and
 * „… entdeckt" over the thing; one that comes while the opening holds the screen as a film, or
 * comes late, is let go — never kept for later. Whatever chimed before the screen first looked
 * chimed then.
 */

const SOURCE_NAMES: Record<ManualKind, string> = {
  book: 'Buch',
  terminal: 'Terminal',
  chart: 'Wandtafel',
  clipboard: 'Klemmbrett',
  locker: 'Spind',
  cabinet: 'Aktenschrank',
};

const PART_NAMES: Record<CarryableKind, string> = {
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
  const name = PART_NAMES[carryableKind(part.label)];
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

/** A chime as this screen took it: answered with its sound and caption, or let go. */
export interface Heard extends Chime {
  sounded: boolean;
}

/** What this screen has heard of a run's chimes. */
export interface ChimeEar {
  /** the run, by its `startedAt`; null before one */
  run: number | null;
  /** how many of the run's chimes it has taken, answered or let go: the view only adds to them */
  taken: number;
  /** each chime it took this run, oldest first: for the walkthrough's probe */
  heard: Heard[];
}

/** An ear for `run` that has heard nothing yet. */
export function chimeEar(run: number | null): ChimeEar {
  return { run, taken: 0, heard: [] };
}

/** Where this screen stands as a view's chimes come in. */
export interface Listening {
  run: number | null;
  /** this screen's first look at the lab: what chimed before was there already */
  first: boolean;
  /** the opening holds the screen as a film: nothing of the game's own sounds over it */
  held: boolean;
  /** the server's clock now, epoch ms (clock.ts) */
  serverNow: number;
}

/**
 * The chimes of `chimes` (a run's, oldest first) this screen answers now, and its ear after
 * them: the new ones, each sounded unless the screen is held or it is older than CHIME_GAP_MS —
 * then let go. On the first look, and for a chime of another run, nothing old is answered.
 */
export function hearChimes(
  ear: ChimeEar,
  chimes: readonly Chime[],
  now: Listening,
): { ear: ChimeEar; due: Chime[] } {
  const was = ear.run === now.run ? ear : chimeEar(now.run);
  if (now.first) {
    return { ear: { ...was, taken: chimes.length }, due: [] };
  }
  const fresh = chimes.slice(was.taken);
  const heard = fresh.map((chime) => ({
    ...chime,
    sounded: !now.held && now.serverNow - chime.at <= CHIME_GAP_MS,
  }));
  return {
    ear: { run: now.run, taken: chimes.length, heard: [...was.heard, ...heard] },
    due: heard.filter((one) => one.sounded).map(({ find, at }) => ({ find, at })),
  };
}

/**
 * Answers the chimes `map` brings this screen (`hearChimes`): each due one's caption rises over
 * its thing from sim time `time` — into `captions` — and the chime sounds, once for them all.
 * Returns the ear after them.
 */
export function answerChimes(
  ear: ChimeEar,
  map: WorldMap,
  now: Listening,
  captions: Caption[],
  time: number,
): ChimeEar {
  const { ear: next, due } = hearChimes(ear, map.chimes, now);
  for (const chime of due) {
    const words = findWords(map, chime.find);
    if (words !== null) {
      captions.push({ ...words, at: time });
    }
  }
  if (due.length > 0) {
    discoveryBlip();
  }
  return next;
}
