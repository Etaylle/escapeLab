/**
 * Being counted at a thing before E is pressed there — pure, for the walkthrough
 * (tools/shots.mjs). The server counts a player at a station's console, at a source or at a
 * note of the last shift from the positions the page streams (server src/room.ts
 * `whereEverybodyStands`): within SERVER_REACH of the middle of the thing's tile, and at a
 * console only in sight of that middle or once the player has found it, at a source or a note
 * only once found. It writes that into the player's view a stream tick and a round trip after
 * the avatar stops, on a slow runner later still. Before it, E reads no source and no note,
 * and a station's panel stays down. So E waits for the count first (`pressUntilShown`), and
 * where nothing comes up, the log line says where the server has the player and what it
 * counts them at (`stateSaid`).
 */

import { canSee } from './patrol.mjs';

/** How near the server counts a player at a thing, in tiles (room.ts PRESENCE_ENTER_RADIUS). */
export const SERVER_REACH = 1.6;
/** How long E waits for the view to count the player there, and how often it looks, in ms. */
export const COUNT_WAIT = { ms: 6000, everyMs: 100 };
/** How many presses E gets after that wait, and over how long, in ms. */
export const PRESSES = { tries: 6, ms: 6000 };
/** A count that takes this long or longer, in ms, is named in the log even where all went well. */
export const SLOW_COUNT_MS = 1000;

/**
 * What E is pressed at: the consoles of a station a player may stand at, a source, or a note
 * of the last shift with the floor tile the server reads it from. A console's `side` is 'a' or
 * 'b', or null at a station with one console, which the view counts as console a.
 *
 * @typedef {{ of: 'station', puzzleId: string | null, title: string,
 *   consoles: Array<{ side: 'a' | 'b' | null, x: number, y: number }> }
 *   | { of: 'source', id: string, label: string, x: number, y: number }
 *   | { of: 'note', index: number, x: number, y: number }} Target
 */

/**
 * The console at `spot`, a station spot of a view's map.
 *
 * @returns {Target}
 */
export function consoleTarget(spot) {
  return {
    of: 'station',
    puzzleId: spot.puzzleId,
    title: spot.title ?? spot.puzzleId,
    consoles: [{ side: spot.console ?? null, x: spot.x, y: spot.y }],
  };
}

/** The spots of the station armed on `view`'s map, one per console; none where none is armed. */
const armedOn = (view) => (view?.map?.stations ?? []).filter((spot) => spot.status === 'armed');

/**
 * Every console of the station armed on `view`: one to stand at, whichever. No consoles where
 * none is armed — then nobody is ever counted there.
 *
 * @returns {Target}
 */
export function armedTarget(view) {
  const armed = armedOn(view);
  return {
    of: 'station',
    puzzleId: armed[0]?.puzzleId ?? null,
    title: armed[0]?.title ?? 'no armed station',
    consoles: armed.map((spot) => ({ side: spot.console ?? null, x: spot.x, y: spot.y })),
  };
}

/**
 * A source where it lies: an entry of a view's map, or a place the plan lays it.
 *
 * @returns {Target}
 */
export function sourceTarget({ id, label, x, y }) {
  return { of: 'source', id, label: label ?? id, x, y };
}

/**
 * The note of the last shift `index` among the map's notes, read from the floor tile `spot`.
 *
 * @returns {Target}
 */
export function noteTarget(index, spot) {
  return { of: 'note', index, x: spot.x, y: spot.y };
}

/**
 * Whether `view` counts its player at `target`: at one of its consoles, a station with one
 * counting as console a; at the source, open or shut; at the note.
 */
export function presentAt(view, target) {
  if (view == null) {
    return false;
  }
  if (target.of === 'station') {
    const { stationId, console: side } = view.presence ?? {};
    return stationId === target.puzzleId && target.consoles.some((c) => (c.side ?? 'a') === side);
  }
  if (target.of === 'source') {
    return (view.sourcesHere ?? []).some((source) => source.id === target.id);
  }
  return view.noteHere?.index === target.index;
}

/** A console as the log names it: „console A", or „the console" at a station with one. */
const consoleSaid = (side) => (side === null ? 'the console' : `console ${side.toUpperCase()}`);

/** `target` as the log names it: console A of „Signalkette", „KLEMMBRETT", the note read at 4,2. */
export function targetSaid(target) {
  if (target.of === 'source') {
    return `„${target.label}"`;
  }
  if (target.of === 'note') {
    return `the note read at ${target.x},${target.y}`;
  }
  const [only] = target.consoles;
  const which = target.consoles.length === 1 ? `${consoleSaid(only.side)} of ` : '';
  return `${which}„${target.title}"`;
}

/**
 * E at a target until what it opens shows. While the view does not count the player there, it
 * looks again every COUNT_WAIT.everyMs for up to COUNT_WAIT.ms; then up to PRESSES.tries
 * presses, each given its share of PRESSES.ms to show, until it does. It presses where the
 * count never came too: a press carries the spot the avatar stands on, and the server judges
 * it there.
 *
 * @param {{ counted: () => boolean, shown: () => Promise<boolean>, press: () => Promise<void>,
 *   waitShown: (ms: number) => Promise<void>, sleep: (ms: number) => Promise<void>,
 *   now: () => number }} hands `counted` reads the view, `shown` the page; `waitShown` waits
 *   at most `ms` for it to show
 * @returns {Promise<{ shown: boolean, countedMs: number | null, presses: number }>} whether it
 *   shows, how long the count took (null where it never came), how many presses went out
 */
export async function pressUntilShown(hands) {
  const since = hands.now();
  while (!hands.counted() && hands.now() - since < COUNT_WAIT.ms) {
    await hands.sleep(COUNT_WAIT.everyMs);
  }
  const countedMs = hands.counted() ? hands.now() - since : null;
  let presses = 0;
  while (presses < PRESSES.tries && !(await hands.shown())) {
    await hands.press();
    presses += 1;
    await hands.waitShown(PRESSES.ms / PRESSES.tries);
  }
  return { shown: await hands.shown(), countedMs, presses };
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 'es'}`;

/**
 * The log's words on an E that waited (`pressUntilShown`'s outcome) for `what` („the panel") to
 * come up: null where it went as it should, counted within SLOW_COUNT_MS and shown; else how
 * the count and the presses went, „!!" where either did not come.
 */
export function pressSaid({ shown, countedMs, presses }, what) {
  if (shown && countedMs !== null && countedMs < SLOW_COUNT_MS) {
    return null;
  }
  const count =
    countedMs === null
      ? `!! not counted there in ${seconds(COUNT_WAIT.ms)}`
      : `counted there after ${seconds(countedMs)}`;
  if (!shown) {
    return `${count}, !! ${what} not up after ${plural(presses, 'press')}`;
  }
  return `${count}, ${what} up ${presses === 0 ? 'already' : `at press ${presses}`}`;
}

/** A value as the log gives it: a dash for none. */
const orDash = (value) => (value === null || value === undefined || value === '' ? '—' : value);

/** What `view` counts its player at, for the log: „station notstrom/a, sources —, …". */
export function presenceSaid(view) {
  if (view == null) {
    return 'no view';
  }
  const presence = view.presence ?? {};
  const station = presence.stationId == null ? null : `${presence.stationId}/${presence.console}`;
  const sources = (view.sourcesHere ?? []).map((source) => source.id).join(' ');
  return (
    `station ${orDash(station)}, sources ${orDash(sources)}, ` +
    `reading ${orDash(presence.manualId)}, note ${orDash(view.noteHere?.index)}; ` +
    `armed ${orDash(armedOn(view)[0]?.puzzleId)} (index ${view.currentPuzzleIndex})`
  );
}

/** The doors shut on `map`, by tile key, as sight takes them. */
const shutOn = (map) =>
  new Set((map?.doors ?? []).filter((door) => !door.open).map((door) => `${door.x},${door.y}`));

/** The consoles of a station target, each with whether the view's player has found it. */
function consolePlaces(target, map) {
  const spots = (map?.stations ?? []).filter((s) => s.found && s.puzzleId === target.puzzleId);
  return target.consoles.map((c) => ({
    said: consoleSaid(c.side),
    x: c.x,
    y: c.y,
    console: true,
    found: spots.some((s) => (s.console ?? null) === c.side),
  }));
}

/** The source or note of a target, with whether the view's player has found it. */
function thingPlace(target, map) {
  const source = target.of === 'source';
  const things = (source ? map?.manuals : map?.notes) ?? [];
  const thing = things.find((t) => (source ? t.id === target.id : t.index === target.index));
  const said = source ? 'the source' : 'the note';
  return { said, x: target.x, y: target.y, console: false, found: thing?.found === true };
}

/** One place of a target from where the server has the player: how far, in sight, found. */
function placeSaid(place, server, map) {
  const middle = { x: place.x + 0.5, y: place.y + 0.5 };
  const off = Math.hypot(server.x - middle.x, server.y - middle.y);
  const sight = canSee({ tiles: map?.tiles ?? [], shut: shutOn(map) }, server, middle);
  const seen = place.console ? `, ${sight ? 'in sight' : 'out of sight'}` : '';
  return (
    `${place.said} at ${place.x},${place.y} ${off.toFixed(1)} tiles off ` +
    `(counted within ${SERVER_REACH})${seen}, ${place.found ? 'found' : 'not found'}`
  );
}

const xy = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

/**
 * Where the server has `name` and what it counts them at, against `target`, for the log line
 * of an E that opened nothing: the position the server streams (`server`: x, y, facing in
 * radians, `rt` when the server took it) and the one the page last sent (`sent`), each of the
 * target's places — how far from the server's position, whether that sees the middle of a
 * console's tile (core's sight rule, the doors as `view` has them), whether the player has
 * found it — and the presence fields of `view` (`presenceSaid`).
 */
export function stateSaid({ name, view, server, sent, target, now }) {
  const counted = `${name}'s view: ${presenceSaid(view)}`;
  if (server == null) {
    return `no position of ${name} on the stream; ${counted}`;
  }
  const facing = Math.round((server.facing * 180) / Math.PI);
  const page = sent == null ? 'nothing yet' : xy(sent);
  const map = view?.map;
  const places = target.of === 'station' ? consolePlaces(target, map) : [thingPlace(target, map)];
  const said = places.map((place) => placeSaid(place, server, map));
  return (
    `the server has had ${name} at ${xy(server)} facing ${facing}° for ` +
    `${seconds(now - server.rt)} (the page sent ${page}); ${said.join('; ')}; ${counted}`
  );
}

/**
 * Which of `views` show an earlier station than the furthest of them, by index: a solve
 * reaches the pages one after the other. A missing view lags behind any.
 */
export function lagging(views) {
  const at = views.map((view) => view?.currentPuzzleIndex ?? -1);
  const furthest = Math.max(...at);
  return at.flatMap((index, i) => (index < furthest ? [i] : []));
}
