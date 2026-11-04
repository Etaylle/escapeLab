import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, parseMission, puzzleDueAt, viewFor } from '../src/index.js';
import type { Action, Mission } from '../src/index.js';
import { lightsOut, standing, started, T0 } from './lab.js';

/**
 * The first win (backlog N-4): the stations the whole crew presses together — Blackout's main
 * switch and its reactor, the tutorial's main switch — give the crew one window, 3.5 s, and
 * every module that runs a window takes it from the mission: the reducer that drops a press,
 * the room that ticks it out, the panels that count it down, the smoke that times the lever.
 */

/** The window of the first win, ms: one number in every mission that has one. */
const FIRST_WIN_MS = 3500;

function mission(file: string): Mission {
  const url = new URL(`../../../missions/${file}`, import.meta.url);
  return parseMission(JSON.parse(readFileSync(url, 'utf8')));
}

/** Every station of `of` the whole crew presses, by id: its look and its window. */
function syncStations(
  of: Mission,
): Record<string, { style: string; windowMs: number | undefined }> {
  return Object.fromEntries(
    of.puzzles.flatMap((p) =>
      p.type === 'button-sync' ? [[p.id, { style: p.style, windowMs: p.windowMs }]] : [],
    ),
  );
}

const press = (playerId: string, at: number): Action => ({
  type: 'puzzle-input',
  playerId,
  at,
  input: { press: true },
});

/**
 * The modules that run a sync station's window, from this folder: the module and the reducer,
 * the room's clock, the smoke's lever, the panels, their coach line and the crew strip, and the
 * ring's stylesheet.
 */
const MODULES = [
  '../src/puzzles/buttonSync.ts',
  '../src/actions.ts',
  '../../server/src/room.ts',
  '../../server/scripts/smoke.ts',
  '../../client/src/puzzles/syncPress.ts',
  '../../client/src/puzzles/LeverPanel.tsx',
  '../../client/src/puzzles/ButtonSyncPanel.tsx',
  '../../client/src/puzzles/coach.ts',
  '../../client/src/screens/Crew.tsx',
  '../../client/src/styles/ux2.css',
];

/** A window written out as a number — the old 2 s, the new 3.5 s — in code or in a stylesheet. */
const WINDOW_WRITTEN = /(?<![\w.])(?:2_?000|3_?500|2e3|3\.5e3)(?!\d)/g;

describe('the first win', () => {
  it('gives Blackout’s main switch and reactor and the tutorial’s main switch one window', () => {
    const blackout = syncStations(mission('blackout.json'));
    expect(blackout).toEqual({
      notlicht: { style: 'lever', windowMs: FIRST_WIN_MS },
      reaktorstart: { style: 'button', windowMs: FIRST_WIN_MS },
    });
    const tutorial = syncStations(mission('systemcheck.json'));
    expect(tutorial['init']).toEqual({ style: 'lever', windowMs: FIRST_WIN_MS });
    // Neither mission keeps a station at the old 2 s.
    const all = [...Object.values(blackout), ...Object.values(tutorial)];
    expect(all.filter((station) => station.windowMs === 2000)).toEqual([]);
  });

  it('opens both missions on it: the first station is the main switch with that window', () => {
    for (const file of ['blackout.json', 'systemcheck.json']) {
      const [first] = mission(file).puzzles;
      expect(first?.type === 'button-sync' ? [first.style, first.windowMs] : null).toEqual([
        'lever',
        FIRST_WIN_MS,
      ]);
    }
  });

  it('drops Blackout’s lever 3.5 s after its pull, on the room’s tick, and not a ms before', () => {
    const dark = lightsOut(started(mission('blackout.json'), 5), T0);
    const here = standing(dark, { stations: { notlicht: ['p1', 'p2'] } });
    const open = applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
    const pulled = applyAction(open, press('p1', T0 + 1000));
    expect(puzzleDueAt(pulled)).toBe(T0 + 1000 + FIRST_WIN_MS + 1);
    const last = applyAction(pulled, { type: 'puzzle-tick', at: T0 + 1000 + FIRST_WIN_MS });
    expect(viewFor(last, 'p2').puzzle).toMatchObject({ partnerPressed: true });
    const ran = applyAction(pulled, { type: 'puzzle-tick', at: T0 + 1001 + FIRST_WIN_MS });
    expect(viewFor(ran, 'p1').puzzle).toMatchObject({ press: null, lastResult: 'expired' });
    // A partner's pull in the window's last moment still throws the main switch.
    const thrown = applyAction(pulled, press('p2', T0 + 1000 + FIRST_WIN_MS));
    expect(thrown.currentPuzzleIndex).toBe(1);
  });

  it('is the mission’s alone: no module that runs a window writes one of its own', () => {
    for (const path of MODULES) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source.match(WINDOW_WRITTEN) ?? [], path).toEqual([]);
    }
    // The guard sees a window however it is written.
    const written = '2000; 2_000; 3500ms; 3_500; 2e3; 3.5e3';
    expect(written.match(WINDOW_WRITTEN)).toHaveLength(6);
    expect('12000; 20000; 0.3500; 35000'.match(WINDOW_WRITTEN)).toBeNull();
  });
});
