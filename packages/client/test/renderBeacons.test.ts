import { describe, expect, it } from 'vitest';
import type { Sight } from '@escapelab/core';
import { artKit } from '../src/world/artKit.js';
import type { CanvasMaker } from '../src/world/atlas.js';
import {
  beaconAngle,
  beaconPhase,
  LOBE_REACH,
  LOBE_SPREAD,
  lobesOut,
} from '../src/world/beacon.js';
import { TAU } from '../src/world/brush.js';
import {
  bakeLobe,
  drawBeacons,
  LOBE_ALPHA,
  LOBE_STEPS,
  lobeStep,
  sightBox,
} from '../src/world/render/beacons.js';
import type { Frame, FrameLit } from '../src/world/render/frame.js';
import { callEntries, callsOf, fakeCanvas, type Entry } from './fakeCanvas.js';
import { frameWith, kitWith, lightWith, lit } from './frames.js';

/** What was drawn on each canvas the art made — the lobes' bakes — by the canvas. */
function withCanvases(): { make: CanvasMaker; logs: Map<unknown, Entry[]> } {
  const logs = new Map<unknown, Entry[]>();
  const make: CanvasMaker = (width, height) => {
    const made = fakeCanvas(width, height, `canvas ${width}x${height}`);
    logs.set(made.canvas, made.log);
    return made.canvas;
  };
  return { make, logs };
}

/** A lamp's light whose sight takes in the tiles from (x0, y0) to (x1, y1), its walls none. */
function seeing(x: number, y: number, box: [number, number, number, number]): FrameLit {
  const [x0, y0, x1, y1] = box;
  const sight: Sight = {
    tiles: new Set(),
    walls: new Set(),
    outline: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  };
  return { ...lit({ x, y, glow: LOBE_REACH }), sight };
}

/** A frame with one lamp burning on the north wall at (4.5, 1.05), seeing the box `box`. */
function burning(
  parts: Partial<Frame> = {},
  box: [number, number, number, number] = [1, 1, 8, 5],
): Frame {
  const mount = { x: 4.5, y: 1.05, facing: Math.PI / 2 };
  const lamps = [{ mount, lit: seeing(4.5, 1.05, box) }];
  return frameWith({ light: lightWith({ lamps }), time: 2, ...parts });
}

describe('lobeStep — the baked step of a turn nearest an angle', () => {
  it('rounds to the nearest of LOBE_STEPS steps, and wraps round a full turn', () => {
    expect(lobeStep(0)).toBe(0);
    expect(lobeStep(TAU / LOBE_STEPS)).toBe(1);
    expect(lobeStep((TAU / LOBE_STEPS) * 0.4)).toBe(0);
    expect(lobeStep(TAU - 0.0001)).toBe(0);
    expect(lobeStep(-TAU / LOBE_STEPS)).toBe(LOBE_STEPS - 1);
  });
});

describe('bakeLobe — a lobe baked once for a step of a turn, at the zoom drawn at', () => {
  it('bakes the wedge of its step in the box round it, its layers added up', () => {
    const { make, logs } = withCanvases();
    const lobe = bakeLobe(make, 0, 100);
    // Pointing east: the lamp at its left edge, out to the reach, spread either way.
    expect(lobe.x).toBe(-1);
    expect(lobe.y).toBeLessThan(-LOBE_REACH * 100 * Math.sin(LOBE_SPREAD) + 1);
    expect(lobe.canvas.width).toBeGreaterThanOrEqual(LOBE_REACH * 100);
    const log = logs.get(lobe.canvas) ?? [];
    const arcs = callsOf(log, 'arc');
    expect(arcs).toHaveLength(4);
    expect(arcs[0]).toEqual([0, 0, LOBE_REACH * 100, -LOBE_SPREAD, LOBE_SPREAD]);
    expect(callEntries(log, 'fill').every((fill) => fill.op === 'lighter')).toBe(true);
  });

  it('turns with its step', () => {
    const { make, logs } = withCanvases();
    const quarter = bakeLobe(make, LOBE_STEPS / 4, 100);
    const [first] = callsOf(logs.get(quarter.canvas) ?? [], 'arc');
    expect(first?.[3]).toBeCloseTo(Math.PI / 2 - LOBE_SPREAD, 9);
    // Pointing south: the lamp at its top edge.
    expect(quarter.y).toBe(-1);
  });
});

describe('drawBeacons — the lamps’ lobes on the Canvas pass', () => {
  it('lays the lobes that leave the wall, in the box the lamp sees, added, at whole pixels', () => {
    const { make, logs } = withCanvases();
    const frame = burning({ kit: { ...kitWith(), art: artKit(make) } });
    const { ctx, log } = fakeCanvas(800, 600);
    drawBeacons(ctx, frame);
    // The box (1, 1)–(8, 5) on the canvas: (5, 3) at its middle, 100 px a tile.
    expect(callsOf(log, 'rect')).toEqual([[0, 100, 700, 400]]);
    expect(callsOf(log, 'clip')).toEqual([[]]);
    const angle = beaconAngle(2000, beaconPhase({ x: 4.5, y: 1.05 }), false);
    const out = lobesOut({ facing: Math.PI / 2 }, angle);
    const lobes = callEntries(log, 'drawImage').filter((e) => logs.has(e.args[0]));
    expect(lobes).toHaveLength(out.length);
    for (const lobe of lobes) {
      expect(lobe).toMatchObject({ op: 'lighter', alpha: LOBE_ALPHA });
      expect(Number.isInteger(lobe.args[1])).toBe(true);
      expect(Number.isInteger(lobe.args[2])).toBe(true);
    }
    // And the bloom round its lens, as brightly as the lamps burn.
    const bloom = callEntries(log, 'drawImage').filter((e) => !logs.has(e.args[0]));
    expect(bloom).toHaveLength(1);
    expect(bloom[0]).toMatchObject({ op: 'lighter', alpha: frame.burn });
  });

  it('bakes a step once and lays it again, frame after frame', () => {
    const { make, logs } = withCanvases();
    const frame = burning({ kit: { ...kitWith(), art: artKit(make) } });
    drawBeacons(fakeCanvas(800, 600).ctx, frame);
    const baked = logs.size;
    drawBeacons(fakeCanvas(800, 600).ctx, frame);
    expect(logs.size).toBe(baked);
    expect(frame.kit.beacons?.scale).toBe(100);
  });

  it('draws nothing for a lamp off the canvas', () => {
    const frame = burning({ camera: { x: 40, y: 3, scale: 100 } });
    const { ctx, log } = fakeCanvas(800, 600);
    drawBeacons(ctx, frame);
    expect(callsOf(log, 'drawImage')).toEqual([]);
  });

  it('lets the baked lobes go once no lamp burns', () => {
    const frame = burning();
    drawBeacons(fakeCanvas(800, 600).ctx, frame);
    expect(frame.kit.beacons).not.toBeNull();
    const dark = frameWith({ kit: frame.kit, light: lightWith({ lamps: [] }) });
    drawBeacons(fakeCanvas(800, 600).ctx, dark);
    expect(dark.kit.beacons).toBeNull();
  });
});

describe('sightBox — what a lamp’s light sees, as a box of tiles', () => {
  it('takes in the floor’s outline and every wall it lights whole', () => {
    const sight: Sight = {
      tiles: new Set(),
      walls: new Set(['9,1', '0,4']),
      outline: [
        { x: 1.2, y: 1 },
        { x: 6, y: 2.5 },
        { x: 3, y: 4 },
      ],
    };
    expect(sightBox(sight)).toEqual({ x0: 0, y0: 1, x1: 10, y1: 5 });
  });
});
