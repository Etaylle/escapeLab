import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PlayerView, PuzzleView } from '@escapelab/core';
import { worldText } from '../src/world/art.js';
import { assembleFrame, type FrameSource, type Latest } from '../src/world/assemble.js';
import type { FinaleCue } from '../src/world/finale.js';
import {
  BARS_MS,
  HUD_FADE_MS,
  TITLE_FADE_MS,
  TITLE_HOLD_MS,
  type IntroCue,
} from '../src/world/intro/sequence.js';
import {
  easeOut,
  NO_ZOOM,
  PANEL_ZOOM,
  ZOOM_MS,
  zoomAt,
  zoomToward,
} from '../src/world/render/camera.js';
import { newSim } from '../src/world/sim.js';
import { fakeCanvas, FakePath2D } from './fakeCanvas.js';
import { kitWith, TILES } from './frames.js';
import { mapWith, type Item } from './fixtures.js';

/** A carryable lying in the lab, or carried as `parts` say. */
function item(parts: Partial<Item>): Item {
  return {
    seen: true,
    found: true,
    known: true,
    id: 'fuse',
    kind: 'fuse',
    label: 'SICHERUNG',
    x: 3.5,
    y: 2.5,
    carriedBy: null,
    delivered: false,
    deliverTo: null,
    requiredFor: null,
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
    pausedAt: null,
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
    textScale: 1,
    voice: null,
    station: null,
  };
  return {
    canvas: fakeCanvas(800, 600).canvas,
    kit: kitWith(),
    sim,
    spectator: false,
    touchPad: { matches: false } as MediaQueryList,
    insets: { top: 0, bottom: 0, controls: [] },
    live: { current: latest },
    alarm: { current: null },
    positions: { current: { run: null, players: {} } },
    drones: { current: {} },
    chats: { current: [] },
    clips: new WeakMap(),
    texts: { s: 100, dpr: 1, scale: 1, styles: worldText(100, 1) },
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

  it('sets the screen’s and the world’s text at the reader’s text size, anew on a change', () => {
    const source = sourceWith([]);
    const normal = frameAt(source, 1);
    expect(normal.viewport.textScale).toBe(1);
    source.live.current = { ...source.live.current, textScale: 1.15 };
    const large = frameAt(source, 2);
    expect(large.viewport.textScale).toBe(1.15);
    expect(large.text.label.size).toBeCloseTo(normal.text.label.size * 1.15, 9);
    expect(large.text.name.size).toBeCloseTo(normal.text.name.size * 1.15, 9);
  });

  it('tells who carries what by the view’s items, and nobody for an item delivered', () => {
    const source = sourceWith([
      item({ carriedBy: 'p2' }),
      item({ id: 'key', kind: 'key', label: 'SCHLÜSSEL', carriedBy: 'p1', delivered: true }),
      item({ id: 'crate', kind: 'crate', label: 'KISTE' }),
    ]);
    expect([...frameAt(source, 1).carrying]).toEqual([['p2', 'fuse']]);
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

  it('keeps the minimap and the marks out until the title has gone, then fades them in', () => {
    const out = SINCE + 5000;
    const at = (ms: number) => {
      const source = opening({ outAt: out });
      const { view } = source.live.current;
      // The hatch open: an arrow points at it whenever the marks show.
      const exit = { x: 20, y: 10, open: true, openedAt: 1, atExit: [] };
      const map = view.map === null ? null : { ...view.map, exit };
      source.live.current = { ...source.live.current, view: { ...view, map } };
      vi.setSystemTime(out + ms);
      return frameAt(source, 5 + ms / 1000);
    };
    // The bars gone and the crew free to walk again; the title still dissolving.
    const walking = at(TITLE_HOLD_MS + BARS_MS);
    expect(walking.hud).toBe(0);
    expect(walking.minimap).toBeNull();
    expect(walking.markers).toEqual([]);
    const fading = at(TITLE_HOLD_MS + TITLE_FADE_MS + HUD_FADE_MS / 2);
    expect(fading.hud).toBeCloseTo(0.5);
    expect(fading.minimap).not.toBeNull();
    expect(fading.markers).toHaveLength(1);
    vi.setSystemTime(SINCE + 5000);
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

describe('assembleFrame — the camera leaning in on a station’s open panel', () => {
  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** The camera's zoom at `ms` on the wall clock, the panel open or not, as `source` frames it. */
  function scaleAt(source: FrameSource, ms: number, open: boolean): number {
    vi.useFakeTimers();
    vi.setSystemTime(ms);
    const station = open ? ({ kind: 'button' } as unknown as PuzzleView) : null;
    source.live.current = { ...source.live.current, station };
    const scale = frameAt(source, 1).camera.scale;
    vi.useRealTimers();
    return scale;
  }

  it('zooms in PANEL_ZOOM times over ZOOM_MS as a panel opens, eased out, back as it shuts', () => {
    const source = sourceWith([]);
    const plain = scaleAt(source, 10_000, false);
    expect(scaleAt(source, 10_000, true)).toBeCloseTo(plain, 9);
    const half = scaleAt(source, 10_000 + ZOOM_MS / 2, true);
    // Eased out: past the middle of the way at half the time.
    expect(half).toBeGreaterThan(plain * (1 + (PANEL_ZOOM - 1) / 2));
    expect(half).toBeLessThan(plain * PANEL_ZOOM);
    expect(scaleAt(source, 10_000 + ZOOM_MS, true)).toBeCloseTo(plain * PANEL_ZOOM, 9);
    expect(scaleAt(source, 20_000, true)).toBeCloseTo(plain * PANEL_ZOOM, 9);
    expect(scaleAt(source, 20_000, false)).toBeCloseTo(plain * PANEL_ZOOM, 9);
    expect(scaleAt(source, 20_000 + ZOOM_MS / 2, false)).toBeLessThan(plain * PANEL_ZOOM);
    expect(scaleAt(source, 20_000 + ZOOM_MS, false)).toBeCloseTo(plain, 9);
  });

  it('turns back from where it stands when the panel shuts halfway in', () => {
    const source = sourceWith([]);
    const plain = scaleAt(source, 10_000, false);
    scaleAt(source, 10_000, true);
    const halfway = scaleAt(source, 10_050, true);
    expect(scaleAt(source, 10_050, false)).toBeCloseTo(halfway, 9);
    expect(scaleAt(source, 10_050 + ZOOM_MS, false)).toBeCloseTo(plain, 9);
  });

  it('cuts straight to the zoom under reduced motion, and never leans in for the audience', () => {
    const calm = sourceWith([]);
    calm.live.current = { ...calm.live.current, reduced: true };
    const plain = scaleAt(calm, 10_000, false);
    expect(scaleAt(calm, 10_001, true)).toBeCloseTo(plain * PANEL_ZOOM, 9);
    const audience = { ...sourceWith([]), spectator: true };
    const wide = scaleAt(audience, 10_000, false);
    expect(scaleAt(audience, 10_000 + ZOOM_MS, true)).toBeCloseTo(wide, 9);
  });
});

describe('easeOut and zoomToward — the zoom’s easing', () => {
  it('starts quickly and settles softly, from 0 to 1', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeCloseTo(0.875, 12);
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(2)).toBe(1);
  });

  it('keeps a zoom heading the way it is asked, and starts a new one from where it stands', () => {
    const opening = zoomToward(NO_ZOOM, true, 1000, false);
    expect(opening).toEqual({ from: 1, to: PANEL_ZOOM, since: 1000 });
    expect(zoomToward(opening, true, 1100, false)).toBe(opening);
    const closing = zoomToward(opening, false, 1100, false);
    expect(closing.from).toBeCloseTo(zoomAt(opening, 1100, false), 12);
    expect(closing.to).toBe(1);
  });
});
