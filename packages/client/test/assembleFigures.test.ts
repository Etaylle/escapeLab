import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PlayerView } from '@escapelab/core';
import { worldText } from '../src/world/art.js';
import { assembleFrame, type FrameSource, type Latest } from '../src/world/assemble.js';
import type { FinaleCue } from '../src/world/finale.js';
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
