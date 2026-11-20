// The logic around the field, without a browser: the Info menu and pause, the fixed steps and the
// drawing between them, how the field fits a window, and what is kept in storage.
import { expect, it as test } from 'vitest';
import * as oracle from './rules-b22d4e4.js';
import { seeded } from '../../../src/arcade/flush/kit.js';
import { FIELD, H, W, createGame, update, type Game } from '../../../src/arcade/flush/rules.js';
import { closeInfo, createSitting, openInfo, setPaused, settle } from '../../../src/arcade/flush/session.js';
import { MAX_FRAME, STEP, blend, createClock, holdFor, snapshot, tick } from '../../../src/arcade/flush/clock.js';
import { COMPACT_BELOW, fit } from '../../../src/arcade/flush/layout.js';
import { DEFAULTS, KEYS, loadBest, loadSettings, write } from '../../../src/arcade/flush/settings.js';
import type { Store } from '../../../src/arcade/scores.js';

const IDLE = { x: 0, y: 0, fire: false, choose: null };

function found<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value, found none');
  return value;
}

function playing(): Game {
  const game = createGame({ rng: seeded(1) });
  update(game, STEP, { ...IDLE, choose: 'single' });
  return game;
}

test('Info pauses a game in play and closing it goes on', () => {
  const game = playing();
  const session = createSitting();
  expect(openInfo(session, game)).toBe(true);
  expect([session.info, session.paused]).toEqual([true, true]);
  expect(openInfo(session, game), 'a second open changes nothing').toBe(false);
  closeInfo(session, game);
  expect([session.info, session.paused]).toEqual([false, false]);
});

test('Info opened from the pause screen returns to the pause screen', () => {
  const game = playing();
  const session = createSitting();
  setPaused(session, game, true);
  openInfo(session, game);
  closeInfo(session, game);
  expect([session.info, session.paused]).toEqual([false, true]);
});

test('Info on the first screen pauses nothing, and only a game in play can be paused', () => {
  const game = createGame();
  const session = createSitting();
  openInfo(session, game);
  expect(session.paused).toBe(false);
  closeInfo(session, game);
  expect(setPaused(session, game, true)).toBe(false);
  const ended = playing();
  setPaused(session, ended, true);
  ended.screen = 'title';
  settle(session, ended);
  expect(session.paused).toBe(false);
});

test('the clock takes whole steps of 1/120 s and keeps the rest for the picture', () => {
  const clock = createClock();
  expect(tick(clock, 1000).steps).toBe(0);
  const frame = tick(clock, 1000 + 1000 / 60);
  expect(frame.steps).toBe(2);
  expect(frame.alpha >= 0 && frame.alpha < 1).toBeTruthy();
  const slow = tick(clock, 5000);
  expect(slow.seconds, 'a long gap counts as one short frame').toBe(MAX_FRAME);
  expect(slow.steps).toBe(Math.round(MAX_FRAME / STEP));
  holdFor(clock, 0.03);
  const held = tick(clock, 5000 + 1000 / 60);
  expect(held.steps < 2, 'a hit-stop holds the rules').toBeTruthy();
});

test('at any refresh rate the same seconds give the same steps', () => {
  for (const hz of [60, 90, 120, 144, 240]) {
    const clock = createClock();
    let steps = 0;
    tick(clock, 0);
    for (let i = 1; i <= hz * 2; i++) steps += tick(clock, (i * 1000) / hz).steps;
    expect(Math.abs(steps - 240) <= 1, `${hz} Hz took ${steps} steps`).toBeTruthy();
  }
});

test('birds are drawn between two steps and put back where the rules left them', () => {
  const game = playing();
  for (let i = 0; i < 600 && game.birds.length === 0; i++) update(game, STEP, IDLE);
  const before = snapshot(game);
  update(game, STEP, IDLE);
  const bird = found(game.birds[0]);
  const [x0, x1] = [found(before.get(bird.id))[0], bird.x];
  const restore = blend(game, before, 0.5);
  expect(Math.abs(bird.x - (x0 + x1) / 2) < 1e-9).toBeTruthy();
  restore();
  expect(bird.x).toBe(x1);
});

test('the field keeps its 1280 by 720 units and its shape in every window', () => {
  expect([W, H]).toEqual([oracle.W, oracle.H]);
  expect(FIELD).toEqual(oracle.FIELD);
  const windows: [number, number][] = [[1280, 800], [390, 844], [844, 390], [1920, 1080], [320, 568]];
  for (const [width, height] of windows) {
    const place = fit(width, height);
    expect(Math.abs(place.width / place.height - W / H) < 0.01, `${width}×${height}`).toBeTruthy();
    expect(place.width <= width && place.height <= height).toBeTruthy();
    expect(place.compact).toBe(place.scale < COMPACT_BELOW);
  }
  expect([fit(1280, 800).hud, fit(844, 390).hud, fit(390, 844).hud]).toEqual(['above', 'side', 'above']);
  expect(fit(1280, 800).compact, 'a laptop keeps the menus on the field').toBe(false);
  expect(fit(390, 844).compact, 'a phone shows them as panels').toBe(true);
  expect(fit(844, 390).width, 'sideways the HUD sits beside the field').toBe(684);
});

function memoryStorage(entries: Record<string, string> = {}): Store {
  const kept = new Map(Object.entries(entries));
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, value);
    },
  };
}

test('bests are kept apart for Classic and Modern, and odd values fall back', () => {
  const storage = memoryStorage({
    [KEYS.best.classic]: JSON.stringify({ single: 900, pair: 'x', clay: -5 }),
    [KEYS.settings]: JSON.stringify({ rules: 'nonsense', music: 3, effects: 0.2, touchAim: 1 })
  });
  expect(loadBest(storage, 'classic')).toEqual({ single: 900, pair: 0, clay: 0 });
  expect(loadBest(storage, 'modern')).toEqual({ single: 0, pair: 0, clay: 0 });
  const settings = loadSettings(storage);
  expect(settings).toEqual({ rules: 'modern', music: 1, effects: 0.2, touchAim: true });
  expect(write(storage, KEYS.best.modern, { single: 50 })).toBe(true);
  expect(loadBest(storage, 'modern').single).toBe(50);
  const broken = { getItem: () => '{nope', setItem: () => { throw new Error('full'); } };
  expect(loadSettings(broken)).toEqual({ ...DEFAULTS });
  expect(write(broken, KEYS.settings, {})).toBe(false);
  expect(loadSettings(null)).toEqual({ ...DEFAULTS });
});
