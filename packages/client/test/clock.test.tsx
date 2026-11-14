import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerView } from '@escapelab/core';
import {
  ASK_BURST_MS,
  ASK_EVERY_MS,
  askForTime,
  beepDue,
  clock,
  clockText,
  formatLeft,
  formatRun,
  ROUND_TRIPS,
  serverAt,
  serverClock,
  timeLeft,
  timeRun,
} from '../src/clock.js';
import { StageTop, type ColdOpen } from '../src/screens/Game.js';
import { mapWith } from './fixtures.js';

/** A wall clock read on demand, set by the test. */
function wall(at: number): { now: () => number; set: (t: number) => void } {
  let t = at;
  return { now: () => t, set: (next) => (t = next) };
}

describe('the server’s clock as a page reads it', () => {
  it('guesses from a view’s stamp until the first round trip answers', () => {
    const local = wall(10_000);
    const server = serverClock(local.now);
    server.stamped(14_960);
    expect(server.now()).toBe(14_960);
    server.heard(9_900, 14_950, 10_000);
    expect(server.offset()).toBe(5_000);
  });

  it('takes the median of the last five round trips: one slow answer moves nothing', () => {
    const server = serverClock(wall(0).now);
    for (const offset of [5_000, 5_002, 4_998, 5_001]) {
      server.heard(1_000, 1_020 + offset, 1_040);
    }
    // a round trip held up 400 ms on its way back
    server.heard(1_000, 1_020 + 5_000, 1_440);
    expect(server.offset()).toBe(5_000);
  });

  it('forgets all but the last five', () => {
    const server = serverClock(wall(0).now);
    for (let i = 0; i < ROUND_TRIPS; i++) {
      server.heard(0, 100, 0);
    }
    expect(server.offset()).toBe(100);
    for (let i = 0; i < ROUND_TRIPS; i++) {
      server.heard(0, -300, 0);
    }
    expect(server.offset()).toBe(-300);
  });

  it('reads the same time on a device whose own clock runs 5 s ahead as on its partner', () => {
    const truth = 1_700_000_000_000;
    const ahead = wall(truth + 5_000);
    const right = wall(truth);
    const pages = [serverClock(ahead.now), serverClock(right.now)];
    // each asks at its own time, the server answers 15 ms later, 15 ms back
    pages[0]?.heard(truth + 5_000 - 30, truth - 15, truth + 5_000);
    pages[1]?.heard(truth - 30, truth - 15, truth);
    expect(pages[0]?.now()).toBe(truth);
    expect(pages[1]?.now()).toBe(truth);
  });
});

describe('the mission’s clock', () => {
  it('stands still while the run is paused, and goes on from there once it resumes', () => {
    const pausedAt = 100_000;
    const paused = { deadlineAt: 400_000, pausedAt };
    expect(timeLeft(paused, pausedAt)).toBe(300_000);
    expect(timeLeft(paused, pausedAt + 6_000)).toBe(300_000);
    // the server moves the deadline on by the 25 s the pause lasted
    const resumed = { deadlineAt: 425_000, pausedAt: null };
    expect(timeLeft(resumed, pausedAt + 25_000)).toBe(300_000);
    expect(timeLeft(resumed, pausedAt + 26_000)).toBe(299_000);
  });

  it('has nothing to count without a deadline', () => {
    expect(timeLeft({ deadlineAt: null, pausedAt: null }, 0)).toBeNull();
  });

  it('reads as minutes and seconds, rounded up', () => {
    expect(formatLeft(300_000)).toBe('05:00');
    expect(formatLeft(299_001)).toBe('05:00');
    expect(formatLeft(-20)).toBe('00:00');
  });
});

describe('the clock of a mission without one', () => {
  const from = 100_000;

  it('counts the time run up from the moment the view names, in whole seconds gone', () => {
    const counting = { deadlineAt: null, pausedAt: null, clockFrom: from };
    expect(timeRun(counting, from + 61_999)).toBe(61_999);
    expect(clockText(counting, from + 61_999)).toBe('01:01');
    expect(formatRun(999)).toBe('00:00');
    expect(formatRun(-20)).toBe('00:00');
  });

  it('stands still while the run is paused', () => {
    const paused = { deadlineAt: null, pausedAt: from + 30_000, clockFrom: from };
    expect(clockText(paused, from + 90_000)).toBe('00:30');
  });

  it('counts down where a deadline stands, and shows nothing with neither', () => {
    const both = { deadlineAt: from + 60_000, pausedAt: null, clockFrom: from };
    expect(clockText(both, from)).toBe('01:00');
    expect(timeRun(both, from)).toBeNull();
    expect(clockText({ deadlineAt: null, pausedAt: null }, from)).toBeNull();
  });
});

describe('asking for the server’s time', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks five times as the line opens, then every ten seconds, until it closes', () => {
    vi.useFakeTimers();
    const asks: number[] = [];
    const asking = askForTime(() => asks.push(Date.now()));
    const from = Date.now();
    asking.open();
    vi.advanceTimersByTime(4 * ASK_BURST_MS + 2 * ASK_EVERY_MS);
    expect(asks.map((t) => t - from)).toEqual([
      0,
      ASK_BURST_MS,
      2 * ASK_BURST_MS,
      3 * ASK_BURST_MS,
      4 * ASK_BURST_MS,
      4 * ASK_BURST_MS + ASK_EVERY_MS,
      4 * ASK_BURST_MS + 2 * ASK_EVERY_MS,
    ]);
    asking.close();
    vi.advanceTimersByTime(3 * ASK_EVERY_MS);
    expect(asks).toHaveLength(7);
  });
});

/** The beeps of the last ten seconds over `lefts`, ms on the clock frame by frame. */
function beepsOver(lefts: readonly number[]): number[] {
  let last = Number.POSITIVE_INFINITY;
  const beeps: number[] = [];
  for (const left of lefts) {
    const due = beepDue(left, last);
    last = due.last;
    if (due.beep !== null) {
      beeps.push(due.beep);
    }
  }
  return beeps;
}

/** The clock from `from` down to `to` ms left, a frame each 100 ms. */
function counting(from: number, to: number): number[] {
  return Array.from({ length: Math.floor((from - to) / 100) + 1 }, (_, i) => from - i * 100);
}

describe('the countdown’s beeps', () => {
  it('beeps each of the last ten seconds once, down to the breaker at 0', () => {
    expect(beepsOver(counting(12_000, 0))).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('loses none to a pause: the clock stands still meanwhile and goes on from there', () => {
    const before = counting(12_000, 6_500);
    const paused = Array.from({ length: 60 }, () => 6_500);
    const after = counting(6_500, 0);
    expect(beepsOver([...before, ...paused, ...after])).toEqual([
      10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    ]);
  });

  it('beeps each second once, at its time, over a run paused for 6 s in its last ten', () => {
    const deadline = 100_000;
    const pauseFrom = deadline - 6_500;
    const heard: [number, number][] = [];
    let last = Number.POSITIVE_INFINITY;
    for (let now = deadline - 12_000; now <= deadline + 6_000; now += 100) {
      const paused = now >= pauseFrom && now < pauseFrom + 6_000;
      const view = paused
        ? { deadlineAt: deadline, pausedAt: pauseFrom }
        : { deadlineAt: now < pauseFrom ? deadline : deadline + 6_000, pausedAt: null };
      const due = beepDue(timeLeft(view, now) ?? 0, last);
      last = due.last;
      if (due.beep !== null) {
        heard.push([due.beep, now]);
      }
    }
    expect(heard.map(([beep]) => beep)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    // none of them while the run stood paused
    expect(heard.filter(([, at]) => at > pauseFrom && at < pauseFrom + 6_000)).toEqual([]);
  });

  it('counts the seconds again that the clock went back up past', () => {
    expect(beepsOver([...counting(10_000, 7_000), ...counting(9_000, 8_000)])).toEqual([
      10, 9, 8, 7, 9, 8,
    ]);
  });

  it('replays none where a fresh reading of the server’s clock sets it back a few ms', () => {
    // 6 announced at 6.000 s; the next ask moves the offset 10 ms, just past the second
    expect(beepsOver([7_000, 6_500, 6_000, 5_995, 6_005, 5_990, 5_000])).toEqual([7, 6, 5]);
  });
});

/** A running mission's view on this page, its clock running out at `deadlineAt`. */
function running(deadlineAt: number, pausedAt: number | null = null): PlayerView {
  const you = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: true, isHost: true };
  return {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    crewSize: { min: 2, max: 3 },
    chat: [],
    you,
    players: [{ ...you, connected: true }],
    palette: [],
    deadlineAt,
    startedAt: 0,
    finishedAt: null,
    timeLimitSec: 900,
    lights: { out: true, outAt: 0 },
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    pausedFor:
      pausedAt === null
        ? null
        : [{ id: 'p2', name: 'Ben', since: pausedAt, waivableAt: pausedAt + 60_000 }],
    pausedAt,
    events: [],
    grade: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    alarms: { count: 0, limit: 5 },
    hintsUsed: 0,
    credits: {},
    edgework: null,
    presence: { stationId: null, console: null, manualId: null, signSeen: false },
    sourcesHere: [],
    manualsHere: [],
    noteHere: null,
    puzzle: null,
    map: mapWith({}),
  };
}

const DARK: ColdOpen = {
  darkSince: 0,
  dark: true,
  intro: false,
  flashUntil: null,
  gates: { sign: 0, line: 0 },
};

/** What the objective bar's clock reads for `view` on this page now. */
function clockReads(view: PlayerView): string | undefined {
  const map = view.map;
  if (map === null) {
    throw new Error('a running mission has a map');
  }
  const html = renderToStaticMarkup(
    <StageTop view={view} map={map} coldOpen={DARK} notice={null} alarmVisible={false} />,
  );
  return /<div class="countdown[^"]*">([^<]*)<\/div>/.exec(html)?.[1];
}

/** The page's clock told that the server is `offset` ms ahead of it, by five round trips. */
function offsetBy(offset: number): void {
  for (let i = 0; i < ROUND_TRIPS; i++) {
    const back = Date.now();
    clock.heard(back, back + offset, back);
  }
}

describe('the objective bar’s clock', () => {
  const truth = 1_700_000_000_000;
  afterEach(() => {
    offsetBy(0);
    vi.useRealTimers();
  });

  it('shows on a device 5 s ahead what its partner shows', () => {
    vi.useFakeTimers();
    const view = running(truth + 295_000);
    vi.setSystemTime(truth);
    offsetBy(0);
    const partner = clockReads(view);
    vi.setSystemTime(truth + 5_000);
    offsetBy(-5_000);
    expect(clockReads(view)).toBe(partner);
    expect(partner).toBe('04:55');
  });

  it('stands still while the run is paused', () => {
    vi.useFakeTimers();
    vi.setSystemTime(truth);
    offsetBy(0);
    const view = running(truth + 295_000, truth - 6_000);
    expect(clockReads(view)).toBe('05:01');
    vi.setSystemTime(truth + 20_000);
    expect(clockReads(view)).toBe('05:01');
  });

  it('counts the time run where the mission has no clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(truth);
    offsetBy(0);
    const clockFrom = truth - 75_400;
    const view = { ...running(truth), deadlineAt: null, timeLimitSec: 0, clockFrom };
    expect(clockReads(view)).toBe('01:15');
    vi.setSystemTime(truth + 2_000);
    expect(clockReads(view)).toBe('01:17');
  });
});

describe('a frame’s moment on the server’s clock', () => {
  afterEach(() => {
    offsetBy(0);
    vi.useRealTimers();
  });

  it('stays the server’s time after a sleep: the wall clock went on, the timeline stood', () => {
    vi.useFakeTimers();
    // the wall clock as the frame timeline has it, the server 2 s ahead of both
    const start = Math.round(performance.timeOrigin + performance.now());
    vi.setSystemTime(start);
    offsetBy(2_000);
    expect(serverAt(performance.now())).toBeCloseTo(start + 2_000, -1);
    // a minute asleep: the wall clock and the server went on, the frame timeline did not
    vi.setSystemTime(start + 60_000);
    expect(serverAt(performance.now())).toBeCloseTo(start + 62_000, -1);
    // a frame 16 ms before now is 16 ms before the server's now
    expect(serverAt(performance.now() - 16)).toBeCloseTo(start + 62_000 - 16, -1);
  });
});
