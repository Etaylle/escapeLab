import type { DemoDoing } from '@escapelab/core';

/**
 * The demo's director: which picture is on air — the own view of one of the crew's two seats,
 * or the whole lab from above — the same for everybody who watches. A pure function of the
 * scene (how the run stands, what each seat is doing, who last made a move) and of the cut on
 * air: it holds no room and no view, and cuts no faster than a viewer can follow.
 *
 * Its rules, the first that holds: the lobby is watched from above; the opening and the
 * Auswertung are the first seat's, as a player gets them; the way out and the moment a station
 * is solved are the whole lab's; who reads at a source or works a console is on air — the one
 * who made the last move where both do —; a walk under the drones is the whole lab's; and the
 * rest of the time the first seat is.
 */

/** One of the crew's two seats, as the director sees it. */
export interface SeatScene {
  /** its player id */
  id: string;
  doing: DemoDoing;
  /** when it last made a move at a console, epoch ms; 0 for never in this run */
  actedAt: number;
  /** drones fly where it could be seen */
  drones: boolean;
}

/** How the demo stands at `now`. */
export interface Scene {
  now: number;
  phase: 'lobby' | 'playing' | 'won' | 'lost';
  /** the run's opening plays: its lights are not out yet */
  opening: boolean;
  /** when a station of the run on was last solved, epoch ms; null for none yet */
  solvedAt: number | null;
  seats: readonly [SeatScene, SeatScene];
}

/** What is on air: a seat by its player id, or the whole lab (null); and since when. */
export interface Cut {
  onAir: string | null;
  since: number;
}

/** The shortest a seat's own view stays on air before the next cut, ms. */
export const SEAT_SHOT_MS = 6000;
/** The shortest the whole lab stays on air, ms. */
export const OVERVIEW_SHOT_MS = 5000;
/** How long after a station's solve the whole lab may still come on air for it, ms. */
export const SOLVED_SHOT_MS = 5000;
/** How long a move at a console keeps its seat on air where the other reads beside it, ms. */
export const MOVE_HOLDS_MS = 9000;

/** A picture the director wants, and whether it cuts to it at once, whatever is on air. */
interface Wish {
  onAir: string | null;
  now?: true;
}

const ON_THE_WAY: ReadonlySet<DemoDoing['what']> = new Set(['walk', 'carry', 'sign', 'plate']);

/** The seats of `seats` doing `what`. */
const doing = (seats: Scene['seats'], what: DemoDoing['what']): SeatScene[] =>
  seats.filter((seat) => seat.doing.what === what);

/** A rule of the director's: the picture it asks for in `scene`, or null where it says nothing. */
type Rule = (scene: Scene) => Wish | null;

/** The lobby from above; the opening and the Auswertung as the first seat has them. */
const byPhase: Rule = ({ phase, opening, seats }) => {
  if (phase === 'lobby') {
    return { onAir: null, now: true };
  }
  return phase !== 'playing' || opening ? { onAir: seats[0].id, now: true } : null;
};

/** The whole lab for the way out, and for the moment a station is solved. */
const byTheRun: Rule = ({ seats, solvedAt, now }) => {
  const solved = solvedAt !== null && now - solvedAt < SOLVED_SHOT_MS;
  return solved || doing(seats, 'escape').length > 0 ? { onAir: null } : null;
};

/** Two at their consoles: whoever made the last move, the first seat before any. */
const byTheMove: Rule = ({ seats }) => {
  const [a, b] = doing(seats, 'operate');
  if (a === undefined || b === undefined) {
    return null;
  }
  return { onAir: b.actedAt > a.actedAt ? b.id : a.id };
};

/** Who reads or works: where one reads to the other, the console for a while after each move. */
const byTheWork: Rule = ({ seats, now }) => {
  const [worker] = doing(seats, 'operate');
  const [reader] = doing(seats, 'read');
  if (worker !== undefined && reader !== undefined) {
    return { onAir: now - worker.actedAt < MOVE_HOLDS_MS ? worker.id : reader.id };
  }
  const busy = reader ?? worker;
  return busy === undefined ? null : { onAir: busy.id };
};

/** A walk under the drones is the whole lab's; any other time is the first seat's. */
const byTheWay: Rule = ({ seats }) => {
  const exposed = seats.some((seat) => seat.drones && ON_THE_WAY.has(seat.doing.what));
  return { onAir: exposed ? null : seats[0].id };
};

const RULES: readonly Rule[] = [byPhase, byTheRun, byTheMove, byTheWork, byTheWay];

/** The picture the scene asks for: the first of the director's rules that says one. */
function wishFor(scene: Scene): Wish {
  for (const rule of RULES) {
    const wish = rule(scene);
    if (wish !== null) {
      return wish;
    }
  }
  return { onAir: scene.seats[0].id };
}

/**
 * What is on air at `scene.now`, `last` having been on air until now (null before the first
 * cut): the picture the scene asks for, once the one on air has had its time — at once where
 * the run's phase turns.
 */
export function direct(scene: Scene, last: Cut | null): Cut {
  const wish = wishFor(scene);
  if (last === null) {
    return { onAir: wish.onAir, since: scene.now };
  }
  if (wish.onAir === last.onAir) {
    return last;
  }
  const least = last.onAir === null ? OVERVIEW_SHOT_MS : SEAT_SHOT_MS;
  if (wish.now !== true && scene.now - last.since < least) {
    return last;
  }
  return { onAir: wish.onAir, since: scene.now };
}
