import { describe, expect, it } from 'vitest';
import {
  clampCamera,
  liftAbove,
  placeRoomNames,
  reachOf,
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

describe('liftAbove — the avatar over the controls on a touch screen', () => {
  // A phone held sideways at density 2: the canvas 582 device px high under a bar of 82, the
  // pad reaching 324 up from its foot, 61.4 device px a tile — the lab far larger than that.
  const LAB = { width: 27, height: 40 };
  const phone = { scale: 61.4, w: 1656, h: 582, top: 82 };
  const screenY = (y: number, cam: { y: number }): number =>
    phone.h / 2 + (y - cam.y) * phone.scale;

  it('lifts the avatar until its feet stand on the pad’s top edge, no further', () => {
    const lift = liftAbove(324, phone.h, phone.top, phone.scale);
    const cam = clampCamera(LAB, { x: 13, y: 20 }, { ...phone, lift });
    // The feet half a tile under the spot the avatar stands on.
    expect(screenY(20 + 0.5, cam)).toBeCloseTo(phone.h - 324, 6);
  });

  it('lifts nothing where the controls reach no higher than the band’s middle leaves free', () => {
    expect(liftAbove(136, phone.h, phone.top, phone.scale)).toBe(0);
    expect(liftAbove(0, phone.h, phone.top, phone.scale)).toBe(0);
  });

  it('takes the reach of the highest of the controls', () => {
    const pad: Box = { left: 28, top: 258, right: 320, bottom: 550 };
    const row: Box = { left: 1300, top: 446, right: 1628, bottom: 550 };
    expect(reachOf([pad, row], 582)).toBe(324);
    expect(reachOf([], 582)).toBe(0);
  });
});

describe('placeRoomNames — which room names are drawn, and where', () => {
  // A laptop's world: 1000x600, the bar 80px deep, the minimap below the bar at the top right,
  // the chat's handle in the bottom right corner.
  const MINIMAP: Box = { left: 820, top: 79, right: 991, bottom: 190 };
  const CHAT: Box = { left: 920, top: 532, right: 986, bottom: 584 };
  const VIEW: Viewport = {
    w: 1000,
    h: 600,
    dpr: 1,
    textScale: 1,
    top: 80,
    boxes: [MINIMAP, CHAT],
  };
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

  // A name's plate reaches 0.5 of its 13 px past its letters at either side, and the air
  // 6 px past that: 12.5 px beyond the 100 px of letters' half. Up and down the plate reaches
  // 0.8 + 0.25 of its size over the baseline, 0.3 + 0.25 under it, and the air 6 px past that.
  const RISE = (0.8 + 0.25) * 13 + 6;
  const DROP = (0.3 + 0.25) * 13 + 6;

  it('nudges a name near a side in, plate and all, to be read whole', () => {
    expect(placed([name(20, 300, 'ARCHIV'), name(990, 400, 'REAKTOR')])).toEqual([
      'ARCHIV@62.5,300',
      'REAKTOR@937.5,400',
    ]);
  });

  it('drops a name whose plate would lie under the objective bar or past the bottom edge', () => {
    const under = Math.ceil(80 + RISE) - 1;
    const over = Math.floor(600 - DROP) + 1;
    expect(placed([name(500, under), name(500, over)])).toEqual([]);
    expect(placed([name(500, under + 1), name(500, over - 1)])).toEqual([
      `LABOR@500,${under + 1}`,
      `LABOR@500,${over - 1}`,
    ]);
  });

  it('drops a name that would lie on the controls in a corner, and keeps one beside them', () => {
    expect(placed([name(900, 560, 'REAKTOR'), name(600, 560, 'LABOR')])).toEqual(['LABOR@600,560']);
  });

  it('drops a name that would lie on the minimap, and keeps one beside it', () => {
    expect(placed([name(900, 150, 'SERVER'), name(700, 150, 'FLUR')])).toEqual(['FLUR@700,150']);
  });

  it('drops the later of two names that would cover each other', () => {
    const names = [name(500, 300, 'FLUR'), name(530, 305, 'LABOR'), name(500, 340, 'KERN')];
    expect(placed(names)).toEqual(['FLUR@500,300', 'KERN@500,340']);
  });

  it('keeps its plate and air in device pixels: twice as much at twice the density', () => {
    const dense: Viewport = { ...VIEW, w: 2000, h: 1200, dpr: 2, top: 160, boxes: [] };
    const clear = Math.ceil(160 + 2 * RISE);
    expect(placed([name(1000, clear - 1)], dense)).toEqual([]);
    expect(placed([name(1000, clear)], dense)).toEqual([`LABOR@1000,${clear}`]);
  });

  it('grows the plate with the reader’s text size, and drops more names for it', () => {
    const large: Viewport = { ...VIEW, textScale: 1.15 };
    const clear = Math.ceil(80 + RISE);
    expect(placed([name(500, clear)])).toEqual([`LABOR@500,${clear}`]);
    expect(placed([name(500, clear)], large)).toEqual([]);
    const nudged = 50 + 0.5 * 13 * 1.15 + 6;
    expect(placed([name(20, 300, 'ARCHIV')], large)).toEqual([`ARCHIV@${nudged},300`]);
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
