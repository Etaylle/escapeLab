import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PlayerView } from '@escapelab/core';
import { worldText } from '../src/world/art.js';
import { assembleFrame, type FrameSource, type Latest } from '../src/world/assemble.js';
import type { FinaleCue } from '../src/world/finale.js';
import type { IntroCue } from '../src/world/intro/sequence.js';
import { newSim } from '../src/world/sim.js';
import { fakeCanvas, FakePath2D } from './fakeCanvas.js';
import { kitWith, TILES } from './frames.js';
import { mapWith, type Item } from './fixtures.js';

/** A carryable lying in the lab, or carried as `parts` say. */
function item(parts: Partial<Item>): Item {
  return {
    id: 'fuse',
    label: 'SICHERUNG',
    x: 3.5,
    y: 2.5,
    carriedBy: null,
    delivered: false,
    deliverTo: null,
    requiredForTitle: null,
    ...parts,
  };
}

/** A running mission for Anna (p1), Ben (p2) in it, the lab holding `items`. */
function viewWith(items: Item[]): PlayerView {
  const you = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: true, isHost: true };
  const ben = { id: 'p2', name: 'Ben', color: '#f472b6', ready: true, isHost: false };
  return {
    phase: 'playing',
    missionId: 'probe',
    missionTitle: 'Probe',
    difficulty: 'normal',
    storyText: '',
    crewSize: { min: 2, max: 2 },
    you,
    players: [
      { ...you, connected: true },
      { ...ben, connected: true },
    ],
    palette: [],
    deadlineAt: null,
    startedAt: 1,
    lights: { out: true, outAt: 1 },
    finishedAt: null,
    timeLimitSec: 600,
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    pausedFor: null,
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
    map: mapWith({ width: 10, height: 6, tiles: TILES, items }),
  };
}

/** A world assembling its frames for Anna's view of `items`, the run ending as `finale` says. */
function sourceWith(items: Item[], finale: FinaleCue | null = null): FrameSource {
  const sim = newSim(0);
  Object.assign(sim.self, { x: 2.5, y: 2.5 });
  sim.others.set('p2', { x: 6, y: 2, facing: 0, moving: false, rx: 6, ry: 2, phase: 0 });
  const latest: Latest = {
    view: viewWith(items),
    darkSince: null,
    locked: false,
    finale,
    escapeSince: null,
    intro: null,
    reduced: false,
    voice: null,
  };
  return {
    canvas: fakeCanvas(800, 600).canvas,
    kit: kitWith(),
    sim,
    spectator: false,
    touchPad: { matches: false } as MediaQueryList,
    insets: { top: 0, bottom: 0 },
    live: { current: latest },
    alarm: { current: null },
    positions: { current: { run: null, players: {} } },
    drones: { current: {} },
    chats: { current: [] },
    clips: new WeakMap(),
    texts: { s: 100, dpr: 1, styles: worldText(100, 1) },
  };
}

/** The frame `source` assembles now, its sim clock at `seconds`. */
function frameAt(source: FrameSource, seconds: number) {
  source.sim.time = seconds;
  const map = source.live.current.view.map;
  if (map === null) {
    throw new Error('the view has no map');
  }
  return assembleFrame(source, map, 1, 0, []);
}

describe('assembleFrame — what the crew’s figures stand by', () => {
  // The light's clip paths are paths.
  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('tells who carries what by the view’s items, and nobody for an item delivered', () => {
    const source = sourceWith([
      item({ carriedBy: 'p2' }),
      item({ id: 'key', label: 'SCHLÜSSEL', carriedBy: 'p1', delivered: true }),
      item({ id: 'crate', label: 'KISTE' }),
    ]);
    expect([...frameAt(source, 1).carrying]).toEqual([['p2', 'SICHERUNG']]);
  });

  it('keeps since when each has stood still: you as you steer, the rest as they stream in', () => {
    const source = sourceWith([]);
    expect(Object.fromEntries(frameAt(source, 2).stillSince)).toEqual({ p1: 2000, p2: 2000 });
    expect(Object.fromEntries(frameAt(source, 5).stillSince)).toEqual({ p1: 2000, p2: 2000 });
    source.sim.self.moving = true;
    const ben = source.sim.others.get('p2');
    if (ben !== undefined) {
      ben.moving = true;
    }
    expect(frameAt(source, 6).stillSince.size).toBe(0);
    source.sim.self.moving = false;
    expect(Object.fromEntries(frameAt(source, 7).stillSince)).toEqual({ p1: 7000 });
  });

  it('celebrates a run won while it ends on screen, slumps over one lost, plays otherwise', () => {
    expect(frameAt(sourceWith([]), 1).mood).toBe('play');
    const since = Date.now();
    expect(frameAt(sourceWith([], { ending: 'won', since }), 1).mood).toBe('celebrate');
    expect(frameAt(sourceWith([], { ending: 'lost:time', since }), 1).mood).toBe('slump');
    expect(frameAt(sourceWith([], { ending: 'lost:alarms', since }), 1).mood).toBe('slump');
  });
});

describe('assembleFrame — the opening’s shot', () => {
  const SINCE = 2_000_000;
  /** A lab larger than the screen: 30 × 20 tiles, walls round floor. */
  const WIDE_TILES = Array.from({ length: 20 }, (_, y) =>
    y === 0 || y === 19 ? '#'.repeat(30) : `#${'.'.repeat(28)}#`,
  );

  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
    vi.useFakeTimers();
    vi.setSystemTime(SINCE + 5000);
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Anna's world in the wide lab, the power on, her opening as `cue` has it. */
  function opening(cue: Partial<IntroCue>): FrameSource {
    const source = sourceWith([]);
    const view = source.live.current.view;
    const map = mapWith({
      width: 30,
      height: 20,
      tiles: WIDE_TILES,
      yourSpawn: { x: 3, y: 3 },
      // The reactor in the far corner: further than the camera can look.
      labels: [{ text: 'REAKTOR', x: 28, y: 18, kind: 'reactor' }],
    });
    source.live.current = {
      ...source.live.current,
      view: { ...view, map, lights: { out: false, outAt: null } },
      intro: {
        since: SINCE,
        lightsSec: 29.1,
        skippedAt: null,
        outAt: null,
        closing: false,
        ...cue,
      },
    };
    return source;
  }

  it('shows the lab lit whole, a little wider than play, with no minimap and no marks', () => {
    const shot = frameAt(opening({}), 5);
    const free = frameAt(opening({ skippedAt: SINCE + 4000 }), 5);
    expect(shot.whole).toBe(1);
    expect(shot.minimap).toBeNull();
    expect(shot.markers).toEqual([]);
    expect(shot.action).toBeNull();
    expect(free.whole).toBe(0);
    expect(free.minimap).not.toBeNull();
    expect(shot.camera.scale).toBeLessThan(free.camera.scale);
    expect(shot.camera.scale / free.camera.scale).toBeCloseTo(0.9, 2);
  });

  it('moves from its first frame, its ends held where the camera can look', () => {
    // The lab as wide as the screen shows it: the shot's ends lie beyond the camera's reach
    // sideways, so they are held at its edge, and still the camera moves as the shot goes.
    const at = (ms: number) => {
      vi.setSystemTime(SINCE + ms);
      return frameAt(opening({}), ms / 1000).camera;
    };
    const first = at(1600);
    const later = at(2600);
    vi.setSystemTime(SINCE + 5000);
    expect(Math.hypot(later.x - first.x, later.y - first.y)).toBeGreaterThan(0);
  });

  it('looks along the shot, not at the avatar, until the player skips', () => {
    const source = opening({});
    source.sim.cam = { x: 3.5, y: 3.5 };
    const shot = frameAt(source, 5);
    expect(Math.hypot(shot.camera.x - 3.5, shot.camera.y - 3.5)).toBeGreaterThan(2);
    const skipped = opening({ skippedAt: SINCE + 4000 });
    skipped.sim.cam = { x: 3.5, y: 3.5 };
    const free = frameAt(skipped, 5);
    expect(Math.hypot(free.camera.x - 3.5, free.camera.y - 3.5)).toBeLessThan(
      Math.hypot(shot.camera.x - 3.5, shot.camera.y - 3.5),
    );
  });
});
