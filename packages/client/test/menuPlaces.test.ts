import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMission } from '@escapelab/core';
import { menuItems } from '../src/screens/MainMenu.js';
import { cameraAt, newCamera, TRAVEL_MS, travelMs } from '../src/world/menu/camera.js';
import { driftBox, sceneBox, sceneShot } from '../src/world/menu/drift.js';
import { heroPainter } from '../src/world/menu/heroStage.js';
import {
  aimSweep,
  AIM_RATE,
  holdLamp,
  newSweep,
  runAt,
  sweepAngle,
  SWEEP,
  type Sweep,
} from '../src/world/menu/lamp.js';
import {
  heldPlace,
  holdPlace,
  placeCorner,
  placesOf,
  SCENE_ANCHOR,
  watchPlace,
} from '../src/world/menu/places.js';
import { sceneBacking, type SceneLab } from '../src/world/menu/scene.js';
import { parkedDrones, sceneViewOf } from '../src/world/menu/view.js';
import { FakePath2D } from './fakeCanvas.js';
import { FakeItem, heroOnPage, painting } from './heroPage.js';

/**
 * Every menu item has its place (docs/art-bible.md „The menu's places"): a room of Blackout's
 * lab for each item, which the scene's camera travels to as the item is hovered or the focus is
 * moved to it — not the focus the menu comes up with — and holds while its panel lies open, in a
 * slow pan from where it stood, a cut under reduced motion; the hero's beam turned to the room it
 * arrives in; the scene's bake wide enough for every place, its density stepping down by quarters
 * where a box that wide would not bake.
 */

const blackout = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

/** Blackout's lab as the scene shows it. */
const LAB: SceneLab = {
  missionId: 'blackout',
  view: sceneViewOf(blackout),
  drones: parkedDrones(blackout),
};

describe('the menu’s places in Blackout’s lab', () => {
  it('give every item of the menu a room of its own, each on the lab’s floor', () => {
    const places = placesOf('blackout');
    expect(Object.keys(places).sort()).toEqual([...menuItems(true)].sort());
    const tiles = blackout.map.tiles;
    for (const [item, spot] of Object.entries(places)) {
      expect(tiles[Math.floor(spot.y)]?.[Math.floor(spot.x)], item).toBe('.');
    }
    const rooms = new Set(Object.values(places).map((spot) => `${spot.x},${spot.y}`));
    expect(rooms.size).toBe(Object.keys(places).length);
  });

  it('leave a lab without places to its drift for every item', () => {
    expect(placesOf('systemcheck')).toEqual({});
  });

  it('show a room where the menu’s column and the hero leave the stage free', () => {
    const corner = placeCorner({ x: 10, y: 4 }, 64, 1440, 820);
    expect(10 * 64 - corner.x).toBeCloseTo(SCENE_ANCHOR.x * 1440, 0);
    expect(4 * 64 - corner.y).toBeCloseTo(SCENE_ANCHOR.y * 820, 0);
    expect(Number.isInteger(corner.x) && Number.isInteger(corner.y)).toBe(true);
  });
});

describe('the box the scene bakes', () => {
  const map = LAB.view.map;
  if (map === null) throw new Error('no map');

  it('holds the drift and every place’s frame, the dark round the lab where one reaches it', () => {
    const shot = sceneShot(map, 1440, 820, 1);
    const corners = Object.values(placesOf('blackout')).map((spot) =>
      placeCorner(spot, shot.scale, 1440, 820),
    );
    const box = sceneBox(shot, 1440, 820, corners);
    const drift = driftBox(shot, 1440, 820);
    for (const { x, y } of [{ x: drift.left, y: drift.top }, ...corners]) {
      expect(x).toBeGreaterThanOrEqual(box.left);
      expect(y).toBeGreaterThanOrEqual(box.top);
    }
    for (const { x, y } of corners) {
      expect(x + 1440).toBeLessThanOrEqual(box.left + box.width);
      expect(y + 820).toBeLessThanOrEqual(box.top + box.height);
    }
    expect(box.width * box.height).toBeGreaterThan(drift.width * drift.height);
    // The Archiv, in the lab's corner, is seen from beyond the lab's edge.
    expect(box.left).toBeLessThan(0);
  });

  it('drops its density by quarters where the box would not bake at the screen’s', () => {
    expect(sceneBacking(LAB, 1440, 820, 1).dpr).toBe(1);
    const dense = sceneBacking(LAB, 1440, 820, 2);
    expect(dense.dpr).toBeGreaterThan(1);
    expect(dense.dpr).toBeLessThanOrEqual(2);
    expect((dense.dpr * 4) % 1).toBe(0);
    expect(dense.w).toBe(Math.round(1440 * dense.dpr));
  });
});

describe('the scene’s camera between the places', () => {
  const goal = { x: 1000, y: 400 };

  it('stands where it is aimed on its first frame, and at once under reduced motion', () => {
    const camera = newCamera();
    expect(cameraAt(camera, ['join', goal], 0, [1, false])).toEqual(goal);
    expect(cameraAt(camera, ['handbook', { x: 0, y: 0 }], 10, [1, true])).toEqual({ x: 0, y: 0 });
  });

  it('pans to a new place over 1.2 to 2 s, easing out and in, its frames whole pixels', () => {
    const camera = newCamera();
    cameraAt(camera, [null, { x: 0, y: 0 }], 0, [1, false]);
    const ms = travelMs(1000, 1);
    expect(ms).toBeGreaterThanOrEqual(TRAVEL_MS.least);
    expect(ms).toBeLessThanOrEqual(TRAVEL_MS.most);
    const xs: number[] = [];
    for (let now = 0; now <= ms + 100; now += 50) {
      const at = cameraAt(camera, ['join', { x: 1000, y: 0 }], now, [1, false]);
      expect(Number.isInteger(at.x)).toBe(true);
      xs.push(at.x);
    }
    // Easing out of where it stood and into the place: slow at either end.
    expect(xs[1]).toBeLessThan(10);
    expect(xs[Math.floor(ms / 50) - 1]).toBeGreaterThan(990);
    expect(xs.at(-1)).toBe(1000);
    expect(xs.every((x, i) => i === 0 || x >= (xs[i - 1] ?? 0))).toBe(true);
    expect(camera.travel).toBeNull();
  });

  it('turns from wherever it has come to, as a new item is picked out on the way', () => {
    const camera = newCamera();
    cameraAt(camera, [null, { x: 0, y: 0 }], 0, [1, false]);
    cameraAt(camera, ['join', { x: 1000, y: 0 }], 0, [1, false]);
    const halfway = cameraAt(camera, ['join', { x: 1000, y: 0 }], 600, [1, false]);
    const turned = cameraAt(camera, ['handbook', { x: -500, y: 0 }], 600, [1, false]);
    expect(turned).toEqual(halfway);
    const later = cameraAt(camera, ['handbook', { x: -500, y: 0 }], 700, [1, false]);
    expect(later.x).toBeLessThanOrEqual(halfway.x);
  });

  it('follows the drift back, its frame moving on as the camera comes', () => {
    const camera = newCamera();
    cameraAt(camera, ['join', { x: 800, y: 0 }], 0, [1, false]);
    const end = travelMs(800, 1) + 50;
    let last = { x: 800, y: 0 };
    for (let now = 0; now <= end; now += 50) {
      last = cameraAt(camera, [null, { x: now / 10, y: 0 }], now, [1, false]);
    }
    expect(last.x).toBe(Math.round(end / 10 - (end % 50) / 10));
  });
});

describe('the place the menu holds', () => {
  afterEach(() => {
    holdPlace(null);
  });

  it('tells whoever listens only as it changes', () => {
    const told = vi.fn();
    const stop = watchPlace(told);
    holdPlace('join');
    holdPlace('join');
    holdPlace(null);
    stop();
    holdPlace('handbook');
    expect(told).toHaveBeenCalledTimes(2);
    expect(heldPlace()).toBe('handbook');
  });
});

describe('the place picked out on the menu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    holdLamp(null);
    holdPlace(null);
  });

  it('is none for the focus the menu comes up with, then the item the focus is moved to', () => {
    const [missions, join] = [new FakeItem('missions', 240), new FakeItem('join', 286)];
    const page = heroOnPage(1440, 820, missions);
    page.play(300);
    expect(heldPlace()).toBeNull();
    page.fire('focusin', join);
    page.play(100);
    expect(heldPlace()).toBe('join');
    // Back on the first, by the player's keys: that is picked out too.
    page.fire('focusin', missions);
    page.play(100);
    expect(heldPlace()).toBe('missions');
    page.run.stop();
    expect(heldPlace()).toBeNull();
  });

  it('is the item hovered over the one in the focus, never a run’s card', () => {
    const page = heroOnPage(1440, 820);
    page.play(300);
    page.fire('pointerover', new FakeItem('history', 450));
    page.play(100);
    expect(heldPlace()).toBe('history');
    page.fire('pointerover', new FakeItem(null, 200));
    page.play(100);
    expect(heldPlace()).toBeNull();
    page.run.stop();
  });

  it('holds the place of the item whose panel lies open, wherever the pointer goes', () => {
    vi.stubGlobal('Path2D', FakePath2D);
    vi.stubGlobal('window', { devicePixelRatio: 1, innerWidth: 1440, innerHeight: 820 });
    const on = painting({ look: { panel: 'rounds' } });
    on.picked.current = 'history';
    heroPainter(on, 0)(100);
    expect(heldPlace()).toBe('rounds');
  });
});

describe('the hero’s beam turned to a place', () => {
  it('turns no faster than AIM_RATE, holds within the sweep, and stays there', () => {
    const sweep: Sweep = newSweep();
    sweep.last = 0;
    const target = SWEEP.high + 1;
    // From where the sweep stands, no step larger than a frame's turn — the first neither.
    let angle = sweepAngle(sweep.run);
    for (let now = 0; now <= 4000; now += 1000 / 30) {
      const next = aimSweep(sweep, now, target);
      expect(Math.abs(next - angle)).toBeLessThanOrEqual((AIM_RATE * 34) / 1000);
      angle = next;
    }
    expect(angle).toBeCloseTo(SWEEP.high, 9);
  });

  it('goes on sweeping from where it was let go, the way it was going', () => {
    for (const run of [0.3, 1.4]) {
      const angle = sweepAngle(run);
      const again = runAt(angle, run);
      expect(sweepAngle(again)).toBeCloseTo(angle, 6);
      expect(again < 1).toBe(run < 1);
    }
  });

  it('lights the room the scene shows: the beam held toward the place on the canvas', () => {
    vi.stubGlobal('Path2D', FakePath2D);
    vi.stubGlobal('window', { devicePixelRatio: 1, innerWidth: 1440, innerHeight: 820 });
    const on = painting();
    on.picked.current = 'handbook';
    const paint = heroPainter(on, 0);
    for (let now = 0; now <= 4000; now += 1000 / 30) paint(now);
    const beam = on.probe.beam;
    if (beam === null) throw new Error('no beam');
    const anchor = { x: SCENE_ANCHOR.x * 1440, y: SCENE_ANCHOR.y * 820 };
    const toward = Math.atan2(anchor.y - beam.lens.y, anchor.x - beam.lens.x) + 2 * Math.PI;
    // Aimed from the lamp's grip, a little behind the lens the probe tells of.
    expect(beam.angle).toBeCloseTo(Math.min(SWEEP.high, Math.max(SWEEP.low, toward)), 1);
    expect(beam.angle).toBeLessThan(SWEEP.high);
    vi.unstubAllGlobals();
    holdLamp(null);
    holdPlace(null);
  });
});
