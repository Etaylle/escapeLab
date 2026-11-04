import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PuzzleView } from '@escapelab/core';
import { clock, ROUND_TRIPS } from '../src/clock.js';
import { heldView, type DeviceRun } from '../src/puzzles/Device.js';
import {
  countChangeAt,
  countDigit,
  countLine,
  countOf,
  TICK_LATE_MS,
  tickDue,
  type SyncCount,
} from '../src/puzzles/syncPress.js';
import { PuzzlePanel } from '../src/screens/PuzzlePanel.js';
import { changeSettings, DEFAULT_SETTINGS } from '../src/settings.js';
import { NO_CLOCK } from './fixtures.js';

/**
 * The count a sync station shows every page at it from the first press of its window
 * (puzzles/SyncCount.tsx): the same digit on Anna's page and Ben's from the server's clock,
 * whose press opened the window, a tick each whole second, and nothing more than the press's
 * own expiry allows — no count once it shut, no GO once every press is in.
 */

type SyncView = Extract<PuzzleView, { kind: 'button-sync' }>;

const T0 = 1_700_000_000_000;
/** Blackout's window at its main switch and its reactor. */
const WINDOW = 3500;

const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf' };
const ben = { id: 'p2', name: 'Ben', color: '#f472b6' };

/**
 * Blackout's main switch as `you` sees it at the station, a crew of two, the presses `presses`
 * live as the server lists them — the own one among them as the own press too.
 */
function station(
  you: string | null,
  presses: { by: string; at: number }[],
  fields: Partial<SyncView> = {},
): SyncView {
  const own = presses.find((p) => p.by === you);
  return {
    kind: 'button-sync',
    style: 'lever',
    windowMs: WINDOW,
    press: own === undefined ? null : { at: own.at, expiresAt: own.at + WINDOW },
    youPressed: own !== undefined,
    partnerPressed: presses.some((p) => p.by !== you),
    presses,
    pressedCount: presses.length,
    requiredCount: 2,
    here: 2,
    lastResult: null,
    index: 0,
    total: 6,
    title: 'Notlicht',
    manual: null,
    console: you === null ? null : 'a',
    plate: you === null ? null : 'Der Hauptschalter schaltet Licht und Grundversorgung zu',
    backup: null,
    ...fields,
  };
}

/** The run around the device on `you`'s page: Anna and Ben the crew; null for the audience. */
function run(you: string | null): DeviceRun {
  return { alarms: 0, solved: 0, refusal: null, crew: { you, mates: [anna, ben] }, alarm: null };
}

/** The station's device as `you`'s page draws it. */
function page(puzzle: PuzzleView, you: string | null): string {
  return renderToStaticMarkup(
    <PuzzlePanel puzzle={puzzle} run={run(you)} send={() => undefined} mission={NO_CLOCK} />,
  );
}

const COUNT =
  /<div class="sync-count" role="timer"><span class="sync-count-by">([^<]*)<\/span><span class="sync-count-digit">(\d)<\/span><\/div>/;

/** The count a page shows — its line and its digit — or null where it shows none. */
function countShown(html: string): { line: string; digit: string } | null {
  const match = COUNT.exec(html);
  return match === null ? null : { line: match[1] ?? '', digit: match[2] ?? '' };
}

/** The page's clock told that the server is `offset` ms ahead of it, by five round trips. */
function offsetBy(offset: number): void {
  for (let i = 0; i < ROUND_TRIPS; i++) {
    const back = Date.now();
    clock.heard(back, back + offset, back);
  }
}

/** The moment `serverTime` on a page whose own clock runs `skew` ms ahead of the server's. */
function serverTimeIs(serverTime: number, skew = 0): void {
  vi.setSystemTime(serverTime + skew);
  offsetBy(-skew);
}

/** Anna's pull at T0, and the count it opens. */
const PULLED = { by: 'p1', at: T0 };
const COUNTED: SyncCount = { by: 'p1', from: T0, until: T0 + WINDOW };

afterEach(() => {
  offsetBy(0);
  vi.useRealTimers();
  changeSettings(DEFAULT_SETTINGS);
});

describe('the count both see', () => {
  it('counts the window from its first press: 3, 2, 1 a second each, then 0 for the half left', () => {
    expect(countOf(station('p2', [PULLED]))).toEqual(COUNTED);
    const shown = [0, 999, 1000, 1999, 2000, 2999, 3000, 3499, 3500].map((ms) =>
      countDigit(COUNTED, T0 + ms),
    );
    expect(shown).toEqual([3, 3, 2, 2, 1, 1, 0, 0, null]);
    // A page whose reading of the server's clock lags behind the press shows the first digit.
    expect(countDigit(COUNTED, T0 - 40)).toBe(3);
    // A window of whole seconds counts 3, 2, 1 and shuts.
    const whole = { ...COUNTED, until: T0 + 3000 };
    expect([0, 1000, 2000, 2999, 3000].map((ms) => countDigit(whole, T0 + ms))).toEqual([
      3,
      2,
      1,
      1,
      null,
    ]);
  });

  it('counts from the oldest live press: the one that shuts the window first', () => {
    const three = station('p3', [PULLED, { by: 'p2', at: T0 + 2000 }], { requiredCount: 3 });
    expect(countOf(three)).toEqual(COUNTED);
  });

  it('shows the same digit and who pulled on both pages, by the server’s clock, not theirs', () => {
    vi.useFakeTimers();
    // Anna pulled at T0; 1.3 s on, Ben comes to the switch and opens it.
    serverTimeIs(T0 + 1300);
    const annas = countShown(page(station('p1', [PULLED]), 'p1'));
    // Ben's own clock runs 5 s ahead of the server's: his page goes by the server's.
    serverTimeIs(T0 + 1300, 5000);
    const bens = countShown(page(station('p2', [PULLED]), 'p2'));
    expect(annas).toEqual({ line: 'Anna hat gezogen —', digit: '2' });
    expect(bens).toEqual(annas);
    // The audience watching sees it too.
    expect(countShown(page(station(null, [PULLED]), null))).toEqual(annas);
  });

  it('goes as the window shuts, „Zug verfallen", and starts again from a press after it', () => {
    vi.useFakeTimers();
    serverTimeIs(T0 + WINDOW);
    const shut = page(station('p1', [PULLED], { lastResult: 'expired' }), 'p1');
    expect(countShown(shut)).toBeNull();
    expect(shut).toContain('Zug verfallen — nur zu zweit zugleich');
    // Ben's pull after it opens a window of its own, counted from its start.
    serverTimeIs(T0 + 4000);
    const again = station('p1', [{ by: 'p2', at: T0 + 4000 }], { lastResult: 'expired' });
    expect(countShown(page(again, 'p1'))).toEqual({ line: 'Ben hat gezogen —', digit: '3' });
  });

  it('shows none before a press, none without a window, and none once solved: no GO', () => {
    vi.useFakeTimers();
    serverTimeIs(T0 + 1300);
    expect(countShown(page(station('p1', []), 'p1'))).toBeNull();
    expect(countOf(station('p1', [PULLED], { windowMs: null }))).toBeNull();
    expect(countShown(page(station('p1', [PULLED], { windowMs: null }), 'p1'))).toBeNull();
    // Every press in: the device stands done, the count gone with it.
    const held = heldView(station('p1', [PULLED]), 1);
    expect(held === null ? 'none' : countShown(page(held, 'p1'))).toBeNull();
  });

  it('counts at the mushroom button as at the main switch: „Ben hat gedrückt —"', () => {
    vi.useFakeTimers();
    serverTimeIs(T0 + 2100);
    const reactor = station('p1', [{ by: 'p2', at: T0 }], { style: 'button', title: 'Reaktor' });
    expect(countShown(page(reactor, 'p1'))).toEqual({ line: 'Ben hat gedrückt —', digit: '1' });
    expect([countLine('lever', null), countLine('button', null)]).toEqual([
      'Gezogen —',
      'Gedrückt —',
    ]);
  });

  it('changes next as its next whole second begins, and last as the window shuts', () => {
    expect(countChangeAt(COUNTED, T0 - 40)).toBe(T0 + 1000);
    expect(countChangeAt(COUNTED, T0 + 999)).toBe(T0 + 1000);
    expect(countChangeAt(COUNTED, T0 + 1000)).toBe(T0 + 2000);
    expect(countChangeAt(COUNTED, T0 + 3200)).toBe(T0 + WINDOW);
    expect(countChangeAt(COUNTED, T0 + WINDOW)).toBeNull();
  });
});

/** The ticks a page sounds over renders at `times`, each render told the last tick it heard. */
function ticksOver(
  times: readonly number[],
  count: Pick<SyncCount, 'from' | 'until'> = COUNTED,
  heardBefore: number | null = null,
): number[] {
  const ticks: number[] = [];
  let heard = heardBefore;
  for (const now of times) {
    const due = tickDue(count, now, heard);
    if (due !== null) {
      heard = due;
      ticks.push(due);
    }
  }
  return ticks;
}

describe('the count’s tick', () => {
  it('ticks each whole second of the window once, however often the page renders', () => {
    const frames = Array.from({ length: 420 }, (_, i) => T0 + 5 + i * 9);
    expect(ticksOver(frames)).toEqual([T0, T0 + 1000, T0 + 2000, T0 + 3000]);
    // A burst of renders within one second: one tick, not two.
    expect(ticksOver([T0 + 1000, T0 + 1000, T0 + 1001, T0 + 1180])).toEqual([T0 + 1000]);
  });

  it('ticks a second only while it is fresh: a panel opened later waits for the next', () => {
    expect(ticksOver([T0 + TICK_LATE_MS])).toEqual([T0]);
    expect(ticksOver([T0 + TICK_LATE_MS + 1])).toEqual([]);
    // Ben opens the switch 1.3 s into the window: his first tick comes with Anna's at 2 s.
    expect(ticksOver([T0 + 1300, T0 + 2000, T0 + 3001, T0 + WINDOW])).toEqual([
      T0 + 2000,
      T0 + 3000,
    ]);
  });

  it('ticks a new window anew, from its own first press, and nothing once a window shut', () => {
    expect(ticksOver([T0 + WINDOW, T0 + 3600])).toEqual([]);
    const next = { from: T0 + 4000, until: T0 + 4000 + WINDOW };
    expect(ticksOver([T0 + 4010, T0 + 5002], next, T0 + 3000)).toEqual([T0 + 4000, T0 + 5000]);
  });
});

describe('the count under reduced motion', () => {
  const UX2 = readFileSync(new URL('../src/styles/ux2.css', import.meta.url), 'utf8');
  const DEVICES = readFileSync(new URL('../src/styles/devices.css', import.meta.url), 'utf8');

  it('stops the ring draining: it stands at the share left, a step with each digit', () => {
    expect(UX2).toMatch(
      /:where\(\[data-motion='reduce'\]\) \{\s*\.lever-ring-left \{\s*animation: none;\s*stroke-dashoffset: calc\(100 - 100 \* var\(--ring-left\)\);/,
    );
  });

  it('moves nothing on the count itself, and changes its digits all the same', () => {
    const rules = DEVICES.slice(DEVICES.indexOf('.sync-stage {'), DEVICES.indexOf('/* ══ Sicherungskasten'));
    expect(rules).toContain('.sync-count-digit {');
    expect(rules).not.toMatch(/animation|transition/);
    changeSettings({ ...DEFAULT_SETTINGS, motion: 'on' });
    vi.useFakeTimers();
    const digitAt = (ms: number): string | undefined => {
      serverTimeIs(T0 + ms);
      return countShown(page(station('p2', [PULLED]), 'p2'))?.digit;
    };
    expect([500, 1500, 2500, 3200].map(digitAt)).toEqual(['3', '2', '1', '0']);
  });
});
