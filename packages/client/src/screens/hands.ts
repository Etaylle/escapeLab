import type { ConsoleId, HandsView, MapView, Place, PlayerView } from '@escapelab/core';
import { placeName } from '../noting.js';
import { consoleName } from '../world/consoles.js';
import { isArmed, known } from '../world/known.js';

/**
 * The hands line under the goal for a crew of three or more (Game.tsx `goalOf`): what each of
 * the crew does at the station in front of it, from the view's `hands` — the server's word of
 * who stands where, never a position guessed on this screen — in the map's words, this
 * screen's own player first: „Cleo: Klemmbrett · Anna: Pult A · Ben: Pult B". The first hand
 * without a place names the places nobody holds: „Cleo: frei — Handbuch, HALTEN · Anna: frei".
 * Names and devices, in the world's voice. Pure.
 */

/** The hands line: every hand in it, and the own one alone — the phone row's chip; null for none. */
export interface HandsLine {
  line: string;
  own: string | null;
}

/**
 * A console of the station in front of the crew in the map's words: console A or B where it
 * has two, the main switch where its look is one, else the station's title.
 */
function consoleWord(map: MapView, console: ConsoleId): string | null {
  const spot = map.stations.filter(isArmed).find((s) => (s.console ?? 'a') === console);
  if (spot?.console !== undefined) {
    return consoleName(spot.console);
  }
  return spot?.look === 'lever' ? 'Hauptschalter' : (spot?.title ?? null);
}

/** A manual object as its label names it, „KLEMMBRETT" the Klemmbrett — once the crew knows it. */
function sourceWord(map: MapView, id: string): string | null {
  const source = map.manuals.find((m) => m.id === id);
  return source !== undefined && known(source) ? placeName(source.label) : null;
}

/** A plate by the label it carries, „HALTEN"; a plate without one is a Platte. */
function plateWord(map: MapView, id: string): string | null {
  const label = map.plates.find((p) => p.id === id)?.label;
  return label === undefined ? null : label === '' ? 'Platte' : label;
}

/** A part to carry in by its label, „SICHERUNG holen" — once the crew knows it. */
function partWord(map: MapView, id: string): string | null {
  const part = map.items.find((i) => i.id === id);
  return part !== undefined && known(part) ? `${part.label} holen` : null;
}

/** The job a place gives a hand, in the map's words; null where this screen's map names none. */
function jobWord(map: MapView, place: Place): string | null {
  switch (place.kind) {
    case 'console':
      return consoleWord(map, place.console);
    case 'source':
      return sourceWord(map, place.id);
    case 'plate':
      return plateWord(map, place.id);
    case 'part':
      return partWord(map, place.id);
  }
}

/** A hand in the line: the name the view gives it, whether it is this screen's own, its job. */
interface Job {
  name: string;
  mine: boolean;
  job: string | null;
}

/**
 * Each of the crew `held` names a hand for, by the name the view gives them and with the job of
 * the place they hold in the words of `map`: this screen's own player first, then the rest of
 * the crew in its order. Somebody the run no longer counts holds no hand and stands nowhere in it.
 */
function jobsOf(view: PlayerView, held: HandsView['held'], map: MapView): Job[] {
  const mine = (id: string): boolean => id === view.you.id;
  const players = [
    ...view.players.filter((player) => mine(player.id)),
    ...view.players.filter((player) => !mine(player.id)),
  ];
  return players.flatMap(({ id, name }) => {
    const place = held.find((hand) => hand.playerId === id)?.place;
    if (place === undefined) {
      return [];
    }
    return [{ name, mine: mine(id), job: place === null ? null : jobWord(map, place) }];
  });
}

/** One hand in the line: „Anna: Pult A"; with no job, „frei" and the places nobody holds. */
function entry(name: string, job: string | null, open: readonly string[]): string {
  if (job !== null) {
    return `${name}: ${job}`;
  }
  return open.length === 0 ? `${name}: frei` : `${name}: frei — ${open.join(', ')}`;
}

/**
 * The hands line of `view` in the words of `map`: this screen's player first, then the rest of
 * the crew in its order. The places nobody holds stand once, beside the first hand without a
 * place — this screen's own where it has none — and every later one says „frei" alone. Null
 * where the view names no hands: for a crew of two, and while no station is up.
 */
export function handsLine(view: PlayerView, map: MapView): HandsLine | null {
  const hands = view.hands;
  if (hands === undefined) {
    return null;
  }
  const open = hands.open.flatMap((place) => jobWord(map, place) ?? []);
  const jobs = jobsOf(view, hands.held, map);
  const firstFree = jobs.findIndex((hand) => hand.job === null);
  const said = jobs.map((hand, i) => ({
    mine: hand.mine,
    text: entry(hand.name, hand.job, i === firstFree ? open : []),
  }));
  return {
    line: said.map((hand) => hand.text).join(' · '),
    own: said.find((hand) => hand.mine)?.text ?? null,
  };
}
