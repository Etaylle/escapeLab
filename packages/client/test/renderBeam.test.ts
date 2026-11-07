import { describe, expect, it } from 'vitest';
import type { MapView } from '@escapelab/core';
import {
  BEAM_STEPS,
  beamSpread,
  CORE_GLOW,
  coreAcross,
  CREW_BEAM,
  CREW_REACH,
  FLANK,
  GLOW_RGB,
} from '../src/world/beam.js';
import { TAU } from '../src/world/brush.js';
import { OWN_BEAM_STOPS, type Lamp } from '../src/world/light.js';
import { BLACK, rgba } from '../src/world/palette.js';
import { conesOf } from '../src/world/render/atmosphere.js';
import { acrossStops, bakeBeam, cutBeam, drawFlares } from '../src/world/render/beam.js';
import type { FrameLit } from '../src/world/render/frame.js';
import { callEntries, fakeCanvas, FakeGradient, setsOf, type FakeCanvas } from './fakeCanvas.js';
import { mapWith } from './fixtures.js';
import { frameWith, lightWith, lit, TILES } from './frames.js';

const BEAM = { facing: 0, halfAngle: 0.5, reach: 7.5 };
const LAMP: Lamp = { x: 2.5, y: 2.5, glow: 3.2, beam: BEAM };

/** The gradients set as a fill in `log`. */
function gradients(log: FakeCanvas['log']): FakeGradient[] {
  return setsOf(log, 'fillStyle').filter((v): v is FakeGradient => v instanceof FakeGradient);
}

describe('acrossStops — a beam’s profile across it, round its lamp', () => {
  it('peaks on the axis at 0.5, fades out either way to nothing past its spread', () => {
    const stops = acrossStops(0.5);
    const offsets = stops.map(([offset]) => offset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    expect(stops.find(([offset]) => offset === 0.5)?.[1]).toBe(1);
    const spread = beamSpread(0.5) / TAU;
    expect(stops.find(([offset]) => Math.abs(offset - (0.5 - spread)) < 1e-9)?.[1]).toBe(0);
    expect(stops[0]).toEqual([0, 0]);
    expect(stops.at(-1)).toEqual([1, 0]);
  });
});

describe('bakeBeam — a flashlight’s beam baked for one step of a turn', () => {
  it('bakes its box half as large: a conic gradient across, cut down along its reach', () => {
    const made: FakeCanvas[] = [];
    const make = (w: number, h: number): HTMLCanvasElement => {
      const canvas = fakeCanvas(w, h, 'beam');
      made.push(canvas);
      return canvas.canvas;
    };
    // Pointing south (step 90 of 360), 7.5 tiles at 100 px a tile.
    const { cut: sprite, glow: core } = bakeBeam(make, 90, [100, 7.5, 0.5]);
    const [baked, glow] = made;
    expect(sprite.canvas).toBe(baked?.canvas);
    expect(core.canvas).toBe(glow?.canvas);
    // The warm core baked in a box only as wide as the core: narrower than the beam's.
    expect(core.w).toBeLessThan(sprite.w);
    // The core's warm light: GLOW_RGB, CORE_GLOW of it on the axis, none out on the flanks.
    const [warm] = gradients(glow?.log ?? []);
    expect(warm?.stops).toContainEqual([0.5, rgba(GLOW_RGB, CORE_GLOW)]);
    const flank = 0.5 + 0.4 / TAU;
    expect(acrossStops(0.5, coreAcross).find(([o]) => Math.abs(o - flank) < 0.01)?.[1]).toBe(0);
    expect(baked?.canvas.width).toBe(Math.ceil(sprite.w / 2));
    expect(baked?.canvas.height).toBe(Math.ceil(sprite.h / 2));
    // South: the box runs from a pixel above the lamp to a pixel past its 750 px reach.
    expect(sprite.y).toBe(-1);
    expect(sprite.y + sprite.h).toBe(751);
    const [across, along] = gradients(baked?.log ?? []);
    expect(across?.gradient).toBe('conic');
    expect(across?.args[0]).toBeCloseTo(Math.PI / 2 - Math.PI, 12);
    expect(across?.stops).toContainEqual([0.5, rgba(BLACK, 1)]);
    expect(along?.args).toEqual([0, 0, 0, 0, 0, 750]);
    expect(along?.stops).toEqual(OWN_BEAM_STOPS.map(([o, d]) => [o, rgba(BLACK, d)]));
    expect(setsOf(baked?.log ?? [], 'globalCompositeOperation')).toEqual(['destination-in']);
  });
});

describe('cutBeam — a flashlight’s beam cut into the darkness', () => {
  it('cuts the baked beam scaled up at whole pixels, unsmoothed, then lays its warm core', () => {
    const frame = frameWith();
    const { ctx, log } = fakeCanvas(800, 600, 'cut');
    ctx.globalCompositeOperation = 'destination-out';
    cutBeam(ctx, frame, LAMP, [0.9, true]);
    const { cut, glow } = frame.kit.beams?.steps.get(0) ?? {};
    // The lamp at (2.5, 2.5) lies at (150, 250) on the canvas, 100 px a tile round (5, 3).
    const box = (b: typeof cut) => [150 + (b?.x ?? 0), 250 + (b?.y ?? 0), b?.w, b?.h];
    expect(callEntries(log, 'drawImage')).toMatchObject([
      { args: [cut?.canvas, ...box(cut)], alpha: 0.9, op: 'destination-out' },
      { args: [glow?.canvas, ...box(glow)], alpha: 0.9, op: 'source-over' },
    ]);
    expect(setsOf(log, 'imageSmoothingEnabled')).toEqual([false, true]);
    // The darkness's cut is left as it was found.
    expect(ctx.globalCompositeOperation).toBe('destination-out');
  });

  it('lays a shorter beam from the same sprite, smaller, and no warm core where not asked', () => {
    const frame = frameWith();
    const { ctx, log } = fakeCanvas(800, 600, 'cut');
    cutBeam(ctx, frame, { ...LAMP, beam: { ...BEAM, reach: CREW_REACH } }, [CREW_BEAM, false]);
    const sprite = frame.kit.beams?.steps.get(0)?.cut;
    const k = CREW_REACH / BEAM.reach;
    expect(callEntries(log, 'drawImage')).toMatchObject([
      {
        args: [
          sprite?.canvas,
          Math.round(150 + (sprite?.x ?? 0) * k),
          Math.round(250 + (sprite?.y ?? 0) * k),
          Math.round((sprite?.w ?? 0) * k),
          Math.round((sprite?.h ?? 0) * k),
        ],
        alpha: CREW_BEAM,
      },
    ]);
  });

  it('bakes a step once, all anew for another zoom, and keeps the 24 laid last', () => {
    const frame = frameWith();
    const { ctx } = fakeCanvas(800, 600, 'cut');
    cutBeam(ctx, frame, LAMP, [1, true]);
    const first = frame.kit.beams?.steps.get(0);
    cutBeam(ctx, frame, { ...LAMP, beam: { ...BEAM, facing: 0.001 } }, [1, true]);
    expect(frame.kit.beams?.steps.get(0)).toBe(first);
    for (let step = 1; step <= 24; step++) {
      const facing = (step / BEAM_STEPS) * TAU;
      cutBeam(ctx, frame, { ...LAMP, beam: { ...BEAM, facing } }, [1, true]);
    }
    expect(frame.kit.beams?.steps.size).toBe(24);
    expect(frame.kit.beams?.steps.has(0)).toBe(false);
    const zoomed = frameWith({ kit: frame.kit, camera: { x: 5, y: 3, scale: 50 } });
    cutBeam(ctx, zoomed, LAMP, [1, true]);
    expect(zoomed.kit.beams?.scale).toBe(50);
    expect(zoomed.kit.beams?.steps.size).toBe(1);
  });

  it('cuts nothing for a lamp without a beam, nor for a beam off the canvas', () => {
    const { ctx, log } = fakeCanvas(800, 600, 'cut');
    cutBeam(ctx, frameWith(), { ...LAMP, beam: null }, [1, true]);
    cutBeam(ctx, frameWith(), { ...LAMP, x: 40, y: 40 }, [1, true]);
    expect(callEntries(log, 'drawImage')).toEqual([]);
  });
});

describe('drawFlares — the glint at each lens and the streak on a shining floor', () => {
  /** The 10×6 lab of frames.ts, its floor of the kind `kind`. */
  function floored(kind: 'lab' | 'corridor'): MapView {
    const labels = [{ text: 'R', x: 2, y: 2, kind }];
    return mapWith({ width: 10, height: 6, tiles: TILES, labels });
  }

  /** `lamp` seeing every floor tile of the lab. */
  function seeing(lamp: Lamp, name: string): FrameLit {
    const tiles = new Set<string>();
    TILES.forEach((row, y) => [...row].forEach((c, x) => c === '.' && tiles.add(`${x},${y}`)));
    return { ...lit(lamp, name), sight: { tiles, walls: new Set(), outline: [] } };
  }

  it('adds a glint at both lenses, the crew’s softer, the streak only along a free floor', () => {
    const own = seeing(LAMP, 'own');
    // West from (7.5, 3.5): the wall at (5, 3) ends the floor 1.5 tiles on — too short for one.
    const theirs = seeing({ ...LAMP, x: 7.5, y: 3.5, beam: { ...BEAM, facing: Math.PI } }, 'crew');
    const frame = frameWith({ map: floored('lab'), light: lightWith({ own, crew: [theirs] }) });
    const { ctx, log } = fakeCanvas(800, 600);
    drawFlares(ctx, frame);
    const glints = callEntries(log, 'drawImage');
    expect(glints.map((g) => [g.op, g.alpha])).toEqual([
      ['lighter', 1],
      ['lighter', CREW_BEAM],
    ]);
    const streaks = callEntries(log, 'fillRect');
    expect(streaks).toHaveLength(1);
    expect(streaks[0]).toMatchObject({ args: [-1, -1, 2, 2], op: 'lighter', alpha: 1 });
  });

  it('leaves no streak on a floor that does not shine, and draws nothing without a lamp', () => {
    const own = seeing(LAMP, 'own');
    const corridor = frameWith({ map: floored('corridor'), light: lightWith({ own }) });
    const { ctx, log } = fakeCanvas(800, 600);
    drawFlares(ctx, corridor);
    expect(callEntries(log, 'fillRect')).toEqual([]);
    expect(callEntries(log, 'drawImage')).toHaveLength(1);
    const dark = fakeCanvas(800, 600);
    drawFlares(dark.ctx, frameWith({ map: floored('lab') }));
    expect(dark.log).toEqual([]);
  });

  it('keeps the flanks FLANK deep: the beam brighter in its core', () => {
    expect(FLANK).toBeLessThan(1);
    expect(FLANK).toBeGreaterThan(0.5);
  });
});

describe('conesOf — the beams dust drifts in', () => {
  it('counts the crew’s beams with yours: dust shows in a partner’s beam too', () => {
    const own = lit(LAMP, 'own');
    const theirs = lit({ ...LAMP, x: 7.5, beam: { ...BEAM, facing: Math.PI } }, 'crew');
    const cones = conesOf(frameWith({ light: lightWith({ own, crew: [theirs] }) }));
    expect(cones.map((cone) => [cone.beam.x, cone.beam.facing])).toEqual([
      [2.5, 0],
      [7.5, Math.PI],
    ]);
  });
});
