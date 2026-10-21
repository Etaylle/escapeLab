import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MapView } from '@escapelab/core';
import type { LightLayer } from '../src/world/gl/lightLayer.js';
import { AMBER, REACTOR, rgba } from '../src/world/palette.js';
import { BEAM_ALPHA, draw, under } from '../src/world/render/glow.js';
import type { Frame } from '../src/world/render/frame.js';
import {
  callEntries,
  callsOf,
  fakeCanvas,
  FakeGradient,
  FakePath2D,
  setsOf,
} from './fakeCanvas.js';
import { mapWith } from './fixtures.js';
import { canvasLight, frameWith, lightWith } from './frames.js';

/**
 * A reactor room with its core, a server room with racks on its walls:
 *
 *   0123456789
 * 0 ##########
 * 1 #....#...#   SERVERRAUM (2,2); REAKTOR (7,2) with its core at (7,3)
 * 2 #....D...#   the door (5,2) shut
 * 3 #....#...#
 * 4 #....#...#
 * 5 ##########
 */
function lab(parts: Partial<MapView> = {}): MapView {
  return mapWith({
    width: 10,
    height: 6,
    tiles: ['##########', '#....#...#', '#........#', '#....#...#', '#....#...#', '##########'],
    labels: [
      { text: 'SERVERRAUM', x: 2, y: 2, kind: 'server' },
      { text: 'REAKTOR', x: 7, y: 2, kind: 'reactor' },
    ],
    doors: [{ id: 'tuer', x: 5, y: 2, open: false }],
    decor: [{ kind: 'core', x: 7, y: 3 }],
    ...parts,
  });
}

/** The colours the glow's gradients were made of, as their middles say. */
function gradientMiddles(log: ReturnType<typeof fakeCanvas>['log']): string[] {
  return setsOf(log, 'fillStyle').flatMap((fill) =>
    fill instanceof FakeGradient ? [fill.stops[0]?.[1] ?? ''] : [],
  );
}

describe('glow — the coloured light over the darkness', () => {
  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  function drawn(frame: Frame) {
    const canvas = fakeCanvas(800, 600);
    draw(canvas.ctx, frame);
    return canvas;
  }

  it('bakes the core’s orange once where it can see, and lays it on as it pulses', () => {
    const frame = frameWith({ map: lab(), time: 1.8 });
    const { log } = drawn(frame);
    const core = [...frame.kit.art.livePools].find(([key]) => key.includes(REACTOR.join(',')));
    expect(core?.[1]).toBeTruthy();
    const laid = callEntries(log, 'drawImage').find((call) => call.args[0] === core?.[1]?.canvas);
    // Added over the dark at the bottom of its pulse, 1.8 s in: not its full strength.
    expect(laid?.op).toBe('lighter');
    expect(laid?.alpha).toBeGreaterThan(0.2);
    expect(laid?.alpha).toBeLessThan(0.7);
    const later = drawn({ ...frame, time: 0.6 });
    const again = callEntries(later.log, 'drawImage').find((c) => c.args[0] === core?.[1]?.canvas);
    expect(again?.alpha).not.toBe(laid?.alpha);
    const baked = [...frame.kit.art.livePools.keys()].filter((key) => key.includes('255,122,28'));
    expect(baked).toHaveLength(1);
  });

  it('bakes the steady faint lights once, and lays the bake over the picture after', () => {
    const frame = frameWith({ map: lab() });
    drawn(frame);
    const pools = frame.kit.art.pools;
    // The server room's racks glow steadily: baked, not drawn anew every frame.
    expect(pools?.baked).toBeTruthy();
    const { log } = drawn(frame);
    expect(frame.kit.art.pools).toBe(pools);
    expect(callsOf(log, 'drawImage').map(([canvas]) => canvas)).toContain(pools?.baked?.canvas);
  });

  it('shows the core’s glow only where the world shows its tile', () => {
    const unseen = frameWith({ map: lab(), light: lightWith({ shown: (x) => x < 5 }) });
    const hidden = drawn(unseen);
    expect([...unseen.kit.art.livePools.keys()].some((key) => key.includes('255,122,28'))).toBe(
      false,
    );
    expect(callsOf(hidden.log, 'ellipse')).toEqual([]);
    const shown = drawn(frameWith({ map: lab() }));
    expect(callsOf(shown.log, 'ellipse').length).toBeGreaterThan(0);
  });

  it('turns the beacon’s two beams over the open hatch through the escape', () => {
    const exit = { x: 8, y: 4, open: true, openedAt: 0, atExit: [] };
    const escaping = drawn(frameWith({ map: lab({ exit }), escapeSince: 1, red: 0.6 }));
    const amber = gradientMiddles(escaping.log).filter((m) => m === rgba(AMBER, BEAM_ALPHA));
    expect(amber).toHaveLength(2);
    const calm = drawn(frameWith({ map: lab({ exit }) }));
    expect(gradientMiddles(calm.log)).not.toContain(rgba(AMBER, BEAM_ALPHA));
  });

  it('moves the particles on with the frame’s clock', () => {
    const frame = frameWith({ map: lab(), time: 2 });
    drawn(frame);
    expect(frame.kit.art.particles.tick).toBe(30);
  });
});

describe('glow — as the world’s light takes its way', () => {
  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  /** `frame`, its light taking a stand-in WebGL light layer. */
  function onGl(frame: Frame): Frame {
    const layer: LightLayer = { render: vi.fn(), dispose: vi.fn() };
    frame.kit.light = { ...canvasLight(), choice: { path: 'gl', reason: 'a test' }, layer };
    return frame;
  }

  /** What `pass` draws of `frame` on a canvas of its own. */
  function logOf(pass: typeof draw, frame: Frame) {
    const canvas = fakeCanvas(800, 600);
    pass(canvas.ctx, frame);
    return canvas.log;
  }

  it('on the layer: what glows and moves under the light, no coloured glow of its own', () => {
    const frame = onGl(frameWith({ map: lab(), time: 1.8 }));
    expect(logOf(draw, frame)).toEqual([]);
    const below = logOf(under, frame);
    // The core's heart and the racks' lights, but no pool: the layer lights the sources.
    expect(callsOf(below, 'ellipse').length).toBeGreaterThan(0);
    expect(callsOf(below, 'drawImage')).toEqual([]);
    expect(frame.kit.art.pools).toBeNull();
    expect(frame.kit.art.livePools.size).toBe(0);
    expect(frame.kit.art.particles.tick).toBe(27);
  });

  it('on the Canvas pass: the coloured glow and all over the darkness, nothing under it', () => {
    const frame = frameWith({ map: lab(), time: 1.8 });
    expect(logOf(under, frame)).toEqual([]);
    const over = logOf(draw, frame);
    expect(callsOf(over, 'drawImage').length).toBeGreaterThan(0);
    expect(callsOf(over, 'ellipse').length).toBeGreaterThan(0);
  });

  it('glows over the audience’s lab on the Canvas pass: the layer lights no darkness there', () => {
    const frame = onGl(frameWith({ map: lab(), spectator: true }));
    expect(logOf(under, frame)).toEqual([]);
    expect(callsOf(logOf(draw, frame), 'drawImage').length).toBeGreaterThan(0);
  });

  it('follows the probe that takes the light the Canvas way for a comparison', () => {
    const frame = onGl(frameWith({ map: lab() }));
    if (frame.kit.light !== null) {
      frame.kit.light.forced = 'canvas';
    }
    expect(logOf(under, frame)).toEqual([]);
    expect(callsOf(logOf(draw, frame), 'drawImage').length).toBeGreaterThan(0);
  });
});
