import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawFrame } from '../src/world/render/pipeline.js';
import { fakeCanvas, FakePath2D, type Entry } from './fakeCanvas.js';
import { frameWith, kitWith, TILES } from './frames.js';
import { mapWith } from './fixtures.js';

type Call = Extract<Entry, { kind: 'call' }>;

/** Where in `log` the first call matching `test` lies; -1 for none. */
function firstCall(log: readonly Entry[], test: (call: Call) => boolean): number {
  return log.findIndex((entry) => entry.kind === 'call' && test(entry));
}

describe('drawFrame — the passes in their order', () => {
  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('draws void, tiles, things, crew, light, minimap and what lies over it, in this order', () => {
    const overlay = fakeCanvas(800, 600, 'overlay');
    const edge = fakeCanvas(0, 0, 'edge');
    const kit = kitWith(overlay);
    kit.vignette.canvas = edge.canvas;
    const now = 1_000_000;
    const map = mapWith({
      width: 10,
      height: 6,
      tiles: TILES,
      stations: [{ puzzleId: 'kasten', x: 7, y: 1, title: 'Kasten', status: 'armed' }],
    });
    const frame = frameWith({
      kit,
      map,
      now,
      deadlineAt: now + 30_000,
      minimap: { ox: 600, oy: 100, cell: 10, mw: 100, mh: 60 },
      pings: [{ playerId: 'p1', x: 3, y: 3, at: 0 }],
      perf: 100,
    });
    const { ctx, log } = fakeCanvas(800, 600);
    drawFrame(ctx, frame);
    const steps = [
      firstCall(log, (c) => c.name === 'fillRect' && c.args.join() === '0,0,800,600'),
      firstCall(log, (c) => c.name === 'drawImage' && c.args[0] === kit.textures.wall),
      firstCall(log, (c) => c.name === 'translate' && c.args.join() === '7.5,1.5'),
      firstCall(log, (c) => c.name === 'translate' && c.args.join() === '2.5,2.8'),
      firstCall(log, (c) => c.name === 'drawImage' && c.args[0] === overlay.canvas),
      firstCall(log, (c) => c.name === 'roundRect' && c.args[0] === 595),
      firstCall(log, (c) => c.name === 'arc' && c.args[0] === 200),
      firstCall(log, (c) => c.name === 'drawImage' && c.args[0] === edge.canvas),
    ];
    expect(steps.every((at) => at >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    // The red edge is the last thing on the canvas.
    expect(log.at(-2)).toMatchObject({ name: 'drawImage', args: [edge.canvas, 0, 0] });
    expect(log.at(-1)).toMatchObject({ name: 'globalAlpha', value: 1 });
  });
});
