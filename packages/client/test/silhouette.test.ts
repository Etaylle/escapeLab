import { describe, expect, it } from 'vitest';
import type { CanvasMaker } from '../src/world/atlas.js';
import { PHOSPHOR, rgba } from '../src/world/palette.js';
import {
  bakeGlow,
  CORE,
  glowBounds,
  glowReach,
  glowSprite,
  HALO,
  newGlows,
  type Shape,
} from '../src/world/silhouette.js';
import { callsOf, fakeCanvas, setsOf, strip, type FakeCanvas } from './fakeCanvas.js';

/** A maker of fake canvases that keeps every one it made, in order. */
function maker(): { make: CanvasMaker; made: FakeCanvas[] } {
  const made: FakeCanvas[] = [];
  const make: CanvasMaker = (width, height) => {
    const fake = fakeCanvas(width, height, `canvas ${made.length}`);
    made.push(fake);
    return fake.canvas;
  };
  return { make, made };
}

/** A square half a tile across round its anchor. */
const SQUARE: Shape = {
  key: 'square',
  box: { x: -0.25, y: -0.25, w: 0.5, h: 0.5 },
  draw: (g) => g.fillRect(-0.25, -0.25, 0.5, 0.5),
};

describe('bakeGlow — a thing’s silhouette, spread, blurred and tinted phosphor', () => {
  it('draws the thing on a canvas of its own, grows it, then blurs it into a phosphor glow', () => {
    const { make, made } = maker();
    const glow = bakeGlow(make, SQUARE, 64, HALO);
    // At 64 px a tile: spread 1.5 px, blur 6 — reaching 9 px (three sigma) — and a pixel more.
    expect(glowReach(HALO, 64)).toBe(12);
    const bounds = { left: -28, top: -28, width: 56, height: 56 };
    expect(glowBounds(SQUARE, 64, HALO)).toEqual(bounds);
    const [silhouette, grown, halo] = made;
    expect(made.map(({ canvas }) => [canvas.width, canvas.height])).toEqual([
      [56, 56],
      [56, 56],
      [56, 56],
    ]);
    expect(strip(silhouette?.log ?? [])).toEqual([
      ['setTransform', [64, 0, 0, 64, 28, 28]],
      ['fillRect', [-0.25, -0.25, 0.5, 0.5]],
    ]);
    // Twelve copies round a circle 1.5 px wide, and the thing itself over them: it grows.
    const copies = callsOf(grown?.log ?? [], 'drawImage');
    expect(copies).toHaveLength(13);
    expect(strip(grown?.log ?? [])).toHaveLength(13);
    for (const [i, [canvas, x, y]] of copies.slice(0, 12).entries()) {
      const turn = (i / 12) * Math.PI * 2;
      expect(canvas).toBe(silhouette?.canvas);
      expect([x, y]).toEqual([1.5 * Math.cos(turn), 1.5 * Math.sin(turn)]);
    }
    expect(copies[12]).toEqual([silhouette?.canvas, 0, 0]);
    // The grown thing goes a canvas's width off to the left; its shadow lands, blurred.
    expect(strip(halo?.log ?? [])).toEqual([
      ['shadowColor=', rgba(PHOSPHOR, 1)],
      ['shadowBlur=', 6],
      ['shadowOffsetX=', 56],
      ['drawImage', [grown?.canvas, -56, 0]],
    ]);
    const tiles = { x: -28 / 64, y: -28 / 64, w: 56 / 64, h: 56 / 64 };
    expect(glow).toEqual({ canvas: halo?.canvas, ...tiles });
  });

  it('blurs the core round the silhouette itself, tighter: nothing grown', () => {
    const { make, made } = maker();
    const core = bakeGlow(make, SQUARE, 64, CORE);
    expect(made).toHaveLength(2);
    const [silhouette, glow] = made;
    expect(strip(glow?.log ?? [])).toEqual([
      ['shadowColor=', rgba(PHOSPHOR, 1)],
      ['shadowBlur=', 2],
      ['shadowOffsetX=', 40],
      ['drawImage', [silhouette?.canvas, -40, 0]],
    ]);
    expect(core.w).toBe(40 / 64);
  });

  it('grows the spread and the blur with the zoom', () => {
    const { make, made } = maker();
    const big = bakeGlow(make, SQUARE, 128, HALO);
    expect(setsOf(made[2]?.log ?? [], 'shadowBlur')).toEqual([12]);
    expect(strip(made[1]?.log ?? [])[0]).toEqual(['drawImage', [made[0]?.canvas, 3, 0]]);
    expect([big.x, big.w]).toEqual([-54 / 128, 108 / 128]);
    bakeGlow(make, SQUARE, 128, CORE);
    expect(setsOf(made[4]?.log ?? [], 'shadowBlur')).toEqual([4]);
  });

  it('names what failed where a canvas has no 2D context', () => {
    const blind: CanvasMaker = (width, height) =>
      ({ width, height, getContext: () => null }) as unknown as HTMLCanvasElement;
    const bake = () => bakeGlow(blind, SQUARE, 64, HALO);
    expect(bake).toThrow(/getContext\("2d"\) returned null; cannot bake a glow/);
  });
});

describe('glowSprite — baked once a shape and zoom level', () => {
  it('bakes on first use and hands the same glow out on every frame after', () => {
    const { make, made } = maker();
    const glows = newGlows(make);
    const first = glowSprite(glows, 64, SQUARE, HALO);
    for (let frame = 0; frame < 5; frame++) {
      expect(glowSprite(glows, 64, SQUARE, HALO)).toBe(first);
    }
    expect(made).toHaveLength(3);
    // The key decides: a drawing alike shares the bake; another cut is baked of its own.
    expect(glowSprite(glows, 64, { ...SQUARE, draw: () => undefined }, HALO)).toBe(first);
    expect(glowSprite(glows, 64, SQUARE, CORE)).not.toBe(first);
    expect(made).toHaveLength(5);
  });

  it('keeps the last two zoom levels baked, as the atlas keeps its sprites', () => {
    const { make, made } = maker();
    const glows = newGlows(make);
    const at64 = glowSprite(glows, 64, SQUARE, CORE);
    const at96 = glowSprite(glows, 96, SQUARE, CORE);
    expect(glowSprite(glows, 64, SQUARE, CORE)).toBe(at64);
    expect(made).toHaveLength(4);
    // 128 comes in: 96, asked for longest ago, goes; 64 stays.
    glowSprite(glows, 128, SQUARE, CORE);
    expect([...glows.levels.keys()]).toEqual([64, 128]);
    expect(glowSprite(glows, 64, SQUARE, CORE)).toBe(at64);
    expect(glowSprite(glows, 96, SQUARE, CORE)).not.toBe(at96);
    expect(made).toHaveLength(8);
  });
});
