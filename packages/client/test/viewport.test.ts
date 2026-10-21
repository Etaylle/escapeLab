import { describe, expect, it } from 'vitest';
import {
  clampCamera,
  placeRoomNames,
  shiftClear,
  type Box,
  type Lens,
  type RoomName,
  type Viewport,
} from '../src/world/viewport.js';

describe('clampCamera — where the camera looks', () => {
  // A phone's world: 400x560 device pixels at 50 a tile, over a lab of 30x20 tiles.
  const LAB = { width: 30, height: 20 };
  const lens = (parts: Partial<Lens> = {}): Lens => ({
    scale: 50,
    w: 400,
    h: 560,
    top: 0,
    lift: 0,
    ...parts,
  });
  /** How far down the canvas a point of the lab `y` tiles down is drawn, the camera at `cam`. */
  const screenY = (y: number, cam: { y: number }, at: Lens): number =>
    at.h / 2 + (y - cam.y) * at.scale;

  it('centres the avatar while nothing lies over the canvas', () => {
    expect(clampCamera(LAB, { x: 15, y: 10 }, lens())).toEqual({ x: 15, y: 10 });
  });

  it('puts the avatar in the middle of the band the objective bar leaves free', () => {
    const under = lens({ top: 120 });
    const cam = clampCamera(LAB, { x: 15, y: 10 }, under);
    expect(screenY(10, cam, under)).toBeCloseTo((120 + 560) / 2);
  });

  it('brings the lab’s top edge down to the foot of the bar, at the top wall', () => {
    const under = lens({ top: 120 });
    const cam = clampCamera(LAB, { x: 15, y: 1.3 }, under);
    expect(screenY(0, cam, under)).toBeCloseTo(120);
  });

  it('never lets the avatar’s head under the overlays, wherever it stands', () => {
    for (const top of [0, 80, 160, 300]) {
      for (const lift of [0, 60, 120]) {
        const under = lens({ top, lift });
        for (let y = 1.28; y <= LAB.height - 1.28; y += 0.25) {
          const cam = clampCamera(LAB, { x: 15, y }, under);
          expect(screenY(y - 1, cam, under)).toBeGreaterThanOrEqual(top - 1e-9);
        }
      }
    }
  });

  it('lifts the avatar clear of the pad on a touch screen, down to the bottom wall', () => {
    const touch = lens({ lift: 120 });
    const mid = clampCamera(LAB, { x: 15, y: 10 }, touch);
    expect(screenY(10, mid, touch)).toBeCloseTo(560 / 2 - 120);
    const low = clampCamera(LAB, { x: 15, y: LAB.height - 1.3 }, touch);
    expect(screenY(LAB.height, low, touch)).toBeCloseTo(560 - 120);
  });

  it('keeps the lab’s sides in frame, and centres one narrower than the canvas', () => {
    expect(clampCamera(LAB, { x: 1, y: 10 }, lens()).x).toBeCloseTo(4);
    expect(clampCamera(LAB, { x: 29, y: 10 }, lens()).x).toBeCloseTo(26);
    expect(clampCamera({ width: 6, height: 20 }, { x: 1, y: 10 }, lens()).x).toBeCloseTo(3);
  });

  it('centres a lab that fits whole, as the audience sees it', () => {
    const audience = { scale: 40, w: 1000, h: 600, top: 0, lift: 0 };
    expect(clampCamera({ width: 20, height: 12 }, { x: 10, y: 6 }, audience)).toEqual({
      x: 10,
      y: 6,
    });
  });

  it('centres a lab shorter than the band in the band below the bar', () => {
    const under = { scale: 50, w: 1000, h: 600, top: 100, lift: 0 };
    const cam = clampCamera({ width: 30, height: 8 }, { x: 15, y: 1.5 }, under);
    expect(screenY(4, cam, under)).toBeCloseTo((100 + 600) / 2);
  });
});

describe('placeRoomNames — which room names are drawn, and where', () => {
  // A laptop's world: 1000x600, the bar 80px deep, the controls reaching 68px
  // up, the minimap below the bar at the top right.
  const MINIMAP: Box = { left: 820, top: 79, right: 991, bottom: 190 };
  const VIEW: Viewport = { w: 1000, h: 600, dpr: 1, top: 80, bottom: 68, boxes: [MINIMAP] };
  const name = (x: number, y: number, text = 'LABOR', width = 100): RoomName => ({
    text,
    x,
    y,
    width,
  });
  const placed = (names: RoomName[], view = VIEW): string[] =>
    placeRoomNames(names, view).map((n) => `${n.text}@${n.x},${n.y}`);

  it('draws a name where its anchor lies', () => {
    expect(placed([name(500, 300)])).toEqual(['LABOR@500,300']);
  });

  it('leaves out a name whose anchor lies off screen: the edge arrows point there', () => {
    expect(placed([name(-10, 300), name(1010, 300), name(500, -5), name(500, 610)])).toEqual([]);
  });

  it('nudges a name near a side in, to be read whole', () => {
    expect(placed([name(20, 300, 'ARCHIV'), name(990, 400, 'REAKTOR')])).toEqual([
      'ARCHIV@56,300',
      'REAKTOR@944,400',
    ]);
  });

  it('drops a name that would lie under the objective bar or the controls', () => {
    expect(placed([name(500, 85), name(500, 540)])).toEqual([]);
    expect(placed([name(500, 100), name(500, 520)])).toEqual(['LABOR@500,100', 'LABOR@500,520']);
  });

  it('drops a name that would lie on the minimap, and keeps one beside it', () => {
    expect(placed([name(900, 150, 'SERVER'), name(700, 150, 'FLUR')])).toEqual(['FLUR@700,150']);
  });

  it('drops the later of two names that would cover each other', () => {
    const names = [name(500, 300, 'FLUR'), name(530, 305, 'LABOR'), name(500, 340, 'KERN')];
    expect(placed(names)).toEqual(['FLUR@500,300', 'KERN@500,340']);
  });

  it('keeps its air in device pixels: twice as much at twice the density', () => {
    const dense: Viewport = { ...VIEW, w: 2000, h: 1200, dpr: 2, top: 160, bottom: 136, boxes: [] };
    expect(placed([name(1000, 185)], dense)).toEqual([]);
    expect(placed([name(1000, 195)], dense)).toEqual(['LABOR@1000,195']);
  });
});

describe('shiftClear — a tag moved off what it would cover', () => {
  // A prompt's pill over the own figure's name: 100 px wide, 20 high.
  const figure: Box = { left: 180, top: 140, right: 240, bottom: 230 };
  const pill = (top: number): Box => ({ left: 160, top, right: 260, bottom: top + 20 });

  it('leaves a tag that covers nothing where it is', () => {
    expect(shiftClear(pill(100), figure, 4, 50)).toBe(0);
  });

  it('lifts a tag up over what it would cover, air between them', () => {
    const dy = shiftClear(pill(150), figure, 4, 50);
    expect(dy).toBe(140 - 4 - 170);
    const moved = { ...pill(150), top: 150 + dy, bottom: 170 + dy };
    expect(moved.bottom).toBe(figure.top - 4);
  });

  it('drops it below instead where up would take it under the bar', () => {
    const dy = shiftClear(pill(150), figure, 4, 130);
    expect(150 + dy).toBe(figure.bottom + 4);
  });
});
