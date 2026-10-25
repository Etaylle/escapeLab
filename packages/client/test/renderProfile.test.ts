import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawFrame } from '../src/world/render/pipeline.js';
import {
  PASS_NAMES,
  passProfile,
  PROFILE_FRAMES,
  profileRequested,
} from '../src/world/render/profile.js';
import { callsOf, fakeCanvas, FakePath2D } from './fakeCanvas.js';
import { frameWith, kitWith } from './frames.js';

/** A clock that moves on by `step` ms every time it is read. */
function ticking(step = 1): () => number {
  let now = 0;
  return () => {
    now += step;
    return now;
  };
}

describe('profile — what each pass costs a frame (?profile=1)', () => {
  it('is asked for by ?profile=1 alone', () => {
    expect(profileRequested('?profile=1')).toBe(true);
    expect(profileRequested('?trace=1&profile=1')).toBe(true);
    expect(profileRequested('?profile=0')).toBe(false);
    expect(profileRequested('')).toBe(false);
  });

  it('times a part with its canvas flushed, a part inside another counting for itself', () => {
    let now = 0;
    const profile = passProfile(() => now);
    const { ctx, log } = fakeCanvas(10, 10);
    const drawn = profile.time('light', ctx, () => {
      now += 2;
      profile.time('darkness', null, () => {
        now += 3;
      });
      now += 1;
      return 'drawn';
    });
    expect(drawn).toBe('drawn');
    // Read back a pixel: the canvas draws what it was asked to before the clock stops.
    expect(callsOf(log, 'getImageData')).toEqual([[0, 0, 1, 1]]);
    profile.endFrame();
    const { stats } = profile;
    expect(stats.light).toEqual({ p50: 3, p95: 3 });
    expect(stats.darkness).toEqual({ p50: 3, p95: 3 });
    expect(stats.total).toEqual({ p50: 6, p95: 6 });
    expect(stats.tiles).toEqual({ p50: 0, p95: 0 });
  });

  it('adds up a part timed twice in a frame, and keeps a ring of frames for percentiles', () => {
    const profile = passProfile(ticking(1));
    for (let frame = 0; frame < PROFILE_FRAMES + 20; frame++) {
      profile.time('glow', null, () => undefined);
      profile.time('glow', null, () => undefined);
      profile.endFrame();
    }
    expect(profile.stats.glow).toEqual({ p50: 2, p95: 2 });
    profile.reset();
    expect(profile.stats.glow).toEqual({ p50: 0, p95: 0 });
  });

  it('names every part of a frame, its assembly and the passes in draw order', () => {
    expect([...PASS_NAMES]).toEqual([
      'assemble',
      'tiles',
      'objects',
      'actors',
      'glow',
      'light',
      'darkness',
      'hud',
      'overlays',
    ]);
  });
});

describe('profile — the pipeline timed where the kit keeps a profile', () => {
  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('times every pass of a frame, the darkness apart from the light', () => {
    const kit = kitWith();
    kit.profile = passProfile(ticking(1));
    const frame = frameWith({ kit });
    drawFrame(fakeCanvas(800, 600).ctx, frame);
    kit.profile.endFrame();
    const { stats } = kit.profile;
    const passes = ['tiles', 'objects', 'actors', 'glow', 'light', 'darkness', 'hud', 'overlays'];
    for (const pass of passes) {
      expect(stats[pass as keyof typeof stats].p50).toBeGreaterThan(0);
    }
  });

  it('times nothing, and reads no pixel back, without a profile', () => {
    const { ctx, log } = fakeCanvas(800, 600);
    drawFrame(ctx, frameWith());
    expect(callsOf(log, 'getImageData')).toEqual([]);
  });
});
