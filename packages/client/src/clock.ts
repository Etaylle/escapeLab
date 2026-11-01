/**
 * clock.ts: the server's clock as this page reads it, and the mission's clock on it.
 *
 * Every moment the server names — the mission's deadline, an emergency's end, a press's window —
 * is epoch ms by the server's clock; a device whose own clock runs ahead or behind would count
 * them off wrong. So the page asks the server for its time (`clock` round trips, ws.ts) and keeps
 * the median offset of the last ROUND_TRIPS answers; until the first comes, a view's own stamp
 * stands in, a one-way guess. Local time is the page's wall clock (`Date.now()`), asked anew
 * every ASK_EVERY_MS: a clock set anew mid-run is caught up with in a few asks. A moment of the
 * page's frame timeline (`performance.now()`) goes over by `serverAt`, from the time now.
 */

/** How many round trips the offset is the median of. */
export const ROUND_TRIPS = 5;
/** How far apart the burst of asks goes out as a socket opens, ms. */
export const ASK_BURST_MS = 300;
/** How often the page asks once the burst is over, ms. */
export const ASK_EVERY_MS = 10_000;

/** The page's own time, epoch ms. */
export function localNow(): number {
  return Date.now();
}

/** The server's clock as a page reads it. */
export interface ServerClock {
  /** the server's time now, epoch ms */
  now: () => number;
  /** how far the server's clock is ahead of this page's, ms */
  offset: () => number;
  /** an answer to an ask that left at local `sent`, back at local `back`: the server read `at` */
  heard: (sent: number, at: number, back?: number) => void;
  /** a view the server stamped `at`, come in at local `back`: a guess until an answer comes */
  stamped: (at: number, back?: number) => void;
}

/** The middle of `values`; the mean of the two middle ones for an even count. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
}

/**
 * A server clock read through `local`: each answer's offset is the server's time against the
 * middle of its round trip; the offset is the median of the last ROUND_TRIPS of them.
 */
export function serverClock(local: () => number = localNow): ServerClock {
  let trips: number[] = [];
  let guess = 0;
  const offset = (): number => (trips.length === 0 ? guess : median(trips));
  return {
    now: () => local() + offset(),
    offset,
    heard: (sent, at, back = local()) => {
      trips = [...trips, at - (sent + back) / 2].slice(-ROUND_TRIPS);
    },
    stamped: (at, back = local()) => {
      guess = at - back;
    },
  };
}

/** The page's server clock. */
export const clock = serverClock();

/** The server's time now as this page reads it, epoch ms. */
export function serverNow(): number {
  return clock.now();
}

/**
 * The moment `perf` of the page's frame timeline (`performance.now()`, a frame's timestamp) on
 * the server's clock, epoch ms: as long before the server's time now as it lies before the
 * timeline's now. The timeline is never read against the wall clock's origin: it stands still
 * while the machine sleeps, and the wall clock may be set anew, so the two drift apart.
 */
export function serverAt(perf: number): number {
  return clock.now() - (performance.now() - perf);
}

/**
 * Asks the server for its time while the line is open (`ask` sends one ask): ROUND_TRIPS
 * asks ASK_BURST_MS apart as it opens, then one every ASK_EVERY_MS. `open` starts over,
 * `close` stops.
 */
export function askForTime(ask: () => void): { open: () => void; close: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked = 0;
  const next = (): void => {
    ask();
    asked += 1;
    timer = setTimeout(next, asked < ROUND_TRIPS ? ASK_BURST_MS : ASK_EVERY_MS);
  };
  return {
    open: () => {
      clearTimeout(timer);
      asked = 0;
      next();
    },
    close: () => clearTimeout(timer),
  };
}

/** What the mission's clock counts against: its deadline, and since when the run stands paused. */
export interface MissionTime {
  deadlineAt: number | null;
  pausedAt: number | null;
}

/**
 * The moment the mission's clock stands at, server time: the pause's start while the run
 * stands paused — every deadline moves on by the pause once it is over — else `now`.
 */
export function clockTime(pausedAt: number | null, now: number = serverNow()): number {
  return pausedAt ?? now;
}

/** `leftMs` on a clock as it reads, „mm:ss": whole seconds rounded up, never below 0. */
export function formatLeft(leftMs: number): string {
  const totalSec = Math.max(0, Math.ceil(leftMs / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** What is left on the mission's clock at server time `now`, ms; null without a deadline. */
export function timeLeft(mission: MissionTime, now: number = serverNow()): number | null {
  return mission.deadlineAt === null ? null : mission.deadlineAt - clockTime(mission.pausedAt, now);
}

/**
 * The countdown's beep due with `leftMs` on the mission's clock, the whole second announced
 * last being `last`: each of the last ten seconds once — and once more where the clock went
 * back up past it by more than a second, as for a new run: the few ms a fresh reading of the
 * server's clock may set it back replay none — and what to remember as announced. The clock
 * stands still while the run is paused (`timeLeft`), so a pause spends no beep.
 */
export function beepDue(leftMs: number, last: number): { beep: number | null; last: number } {
  const whole = Math.ceil(leftMs / 1000);
  const heard = whole > last + 1 ? Number.POSITIVE_INFINITY : last;
  if (whole <= 10 && whole >= 0 && whole < heard) {
    return { beep: whole, last: whole };
  }
  return { beep: null, last: heard };
}
