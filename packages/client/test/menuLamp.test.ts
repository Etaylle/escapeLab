import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIGURE_TALL, heroPlace, type StageFacts } from '../src/world/menu/hero.js';
import { attendedOf, heroPainter, type HeroPainting } from '../src/world/menu/heroStage.js';
import {
  BEAT_MS,
  BEAM_STEP,
  heroLamp,
  holdLamp,
  lensAt,
  newSweep,
  REACH_SHARE,
  reachOf,
  STILL_ANGLE,
  stepSweep,
  SWEEP,
  SWEEP_MS,
  sweepAngle,
  tiltOf,
  watchLamp,
  type HeroLamp,
} from '../src/world/menu/lamp.js';
import { beamSpread } from '../src/world/beam.js';
import {
  BEAM_HALF,
  BEAM_LIGHT,
  layBeam,
  sceneBeam,
  type BeamFrame,
} from '../src/world/menu/lampArt.js';
import { OWN_BEAM_STOPS } from '../src/world/light.js';
import { callEntries, fakeCanvas, FakeGradient, FakePath2D, type Entry } from './fakeCanvas.js';
import { painting } from './heroPage.js';

/**
 * The hand lamp the hero holds and its beam over the menu's lab (world/menu/lamp.ts,
 * lampArt.ts, stage.ts): the beam sweeping to and fro in SWEEP_MS a pass, holding a beat where
 * it points at the item hovered; standing still under reduced motion; its light fading before the
 * menu's column; laid on the scene's canvas from a sprite turned once a degree, the dust in it.
 */

/** The menu's stage at 1440 × 820, as menu.css lays it out. */
const DESKTOP: StageFacts = {
  w: 1440,
  h: 760,
  windowH: 820,
  phone: false,
  padBottom: 32.8,
  safeRight: 0,
  safeBottom: 0,
  menuRight: 512,
  panelRight: 832,
  chipBottom: 115,
};

const PLACE = (() => {
  const place = heroPlace(DESKTOP);
  if (place === null) throw new Error('no hero at 1440 × 820');
  return place;
})();

describe('the beam’s sweep', () => {
  it('goes to and fro across its range, a pass in 10 to 14 s, easing at either end', () => {
    expect(SWEEP_MS).toBeGreaterThanOrEqual(10_000);
    expect(SWEEP_MS).toBeLessThanOrEqual(14_000);
    expect(sweepAngle(0)).toBeCloseTo(SWEEP.low, 9);
    expect(sweepAngle(1)).toBeCloseTo(SWEEP.high, 9);
    expect(sweepAngle(2)).toBeCloseTo(SWEEP.low, 9);
    expect(sweepAngle(0.5)).toBeCloseTo((SWEEP.low + SWEEP.high) / 2, 9);
    const atEnd = sweepAngle(0.02) - sweepAngle(0);
    const inMiddle = sweepAngle(0.51) - sweepAngle(0.49);
    expect(atEnd).toBeLessThan(inMiddle / 10);
  });

  it('comes across in one pass of its clock, then back', () => {
    const sweep = newSweep();
    stepSweep(sweep, 0, null);
    let angle = 0;
    for (let now = 0; now <= SWEEP_MS; now += 1000 / 30) angle = stepSweep(sweep, now, null);
    expect(angle).toBeCloseTo(SWEEP.high, 2);
    for (let now = SWEEP_MS; now <= 2 * SWEEP_MS; now += 1000 / 30) {
      angle = stepSweep(sweep, now, null);
    }
    expect(angle).toBeCloseTo(SWEEP.low, 2);
  });

  it('holds a beat where it comes to the item hovered, and again on its way back', () => {
    const target = (SWEEP.low + SWEEP.high) * 0.4 + SWEEP.high * 0.2;
    const sweep = newSweep();
    const held: number[] = [];
    let last = Number.NaN;
    for (let now = 0; now <= 2 * SWEEP_MS + 2 * BEAT_MS; now += 1000 / 30) {
      const angle = stepSweep(sweep, now, target);
      if (angle === target && last === target) held.push(now);
      last = angle;
    }
    // Two beats, one each way, each BEAT_MS long (frames of 33 ms).
    const beats = held.filter((now, i) => i === 0 || now - (held[i - 1] ?? 0) > 100);
    expect(beats).toHaveLength(2);
    const firstBeat = held.filter((now) => now < (beats[1] ?? Infinity));
    expect(firstBeat.length * (1000 / 30)).toBeGreaterThan(BEAT_MS - 100);
    expect(firstBeat.length * (1000 / 30)).toBeLessThan(BEAT_MS + 100);
  });

  it('goes on after its beat from where it held, its clock stood still meanwhile', () => {
    const target = (SWEEP.low + SWEEP.high) / 2;
    const sweep = newSweep();
    let now = 0;
    // At most one pass to come to the item, a beat to hold there.
    for (; sweep.hold === null && now <= SWEEP_MS; now += 1000 / 30) {
      stepSweep(sweep, now, target);
    }
    expect(sweep.hold).not.toBeNull();
    const until = sweep.hold?.until ?? 0;
    for (; now < until; now += 1000 / 30) stepSweep(sweep, now, target);
    const after = stepSweep(sweep, now, target);
    // A frame or two of the sweep's middle on from the beat: no jump over the time it held.
    expect(after - target).toBeGreaterThan(0);
    expect(after - target).toBeLessThan(0.01);
  });

  it('holds its beat for an item outside its range at the end nearest it', () => {
    const sweep = newSweep();
    const held = new Set<number>();
    for (let now = 0; now <= SWEEP_MS + 2000; now += 1000 / 30) {
      stepSweep(sweep, now, SWEEP.high + 1);
      if (sweep.hold !== null) held.add(sweep.hold.angle);
    }
    expect([...held]).toEqual([SWEEP.high]);
  });
});

describe('the lamp in the hands', () => {
  it('turns from straight ahead — the menu’s side — up and down as the beam points', () => {
    expect(tiltOf(Math.PI)).toBeCloseTo(0, 9);
    expect(tiltOf(Math.PI + 0.3)).toBeCloseTo(-0.3, 9);
    expect(tiltOf(Math.PI - 0.3)).toBeCloseTo(0.3, 9);
  });

  it('shines from a lens ahead of the hands, on the menu’s side of the hero, at its chest', () => {
    const lens = lensAt(PLACE, 0, 0);
    expect(lens.x).toBeLessThan(PLACE.feet.x - 0.5 * PLACE.scale);
    expect(lens.y).toBeLessThan(PLACE.feet.y - 0.3 * PLACE.scale);
    expect(lens.y).toBeGreaterThan(PLACE.feet.y - 0.6 * PLACE.scale);
    expect(lensAt(PLACE, -0.3, 0).y).toBeLessThan(lens.y);
    expect(lensAt(PLACE, 0, 0.02).y).toBeCloseTo(lens.y - 0.02 * PLACE.scale, 9);
  });

  it('reaches as far as its share of the hero’s height, and never over the menu’s column', () => {
    expect(reachOf(320, 1000, 512)).toBeCloseTo(REACH_SHARE * 320, 9);
    expect(reachOf(320, 700, 512)).toBe(188);
    expect(reachOf(320, 400, 512)).toBe(0);
  });
});

/** A lamp at (x, y) pointing at `angle`, 400 px long, on. */
const lampAt = (x: number, y: number, angle: number, on = 1): HeroLamp => ({
  x,
  y,
  angle,
  reach: 400,
  on,
});

describe('the lamp the page holds', () => {
  afterEach(() => {
    holdLamp(null);
  });

  it('tells whoever listens only where the beam it lays changes', () => {
    let told = 0;
    const stop = watchLamp(() => (told += 1));
    holdLamp(lampAt(900, 500, Math.PI));
    expect(told).toBe(1);
    holdLamp(lampAt(900.2, 500.3, Math.PI + 0.2 * BEAM_STEP));
    expect(told).toBe(1);
    expect(heroLamp()?.x).toBe(900.2);
    holdLamp(lampAt(901, 500, Math.PI));
    holdLamp(lampAt(901, 500, Math.PI + BEAM_STEP));
    holdLamp(lampAt(901, 500, Math.PI + BEAM_STEP, 0.5));
    expect(told).toBe(4);
    holdLamp(null);
    expect(told).toBe(5);
    stop();
    holdLamp(lampAt(900, 500, Math.PI));
    expect(told).toBe(5);
  });
});

/** The frame a scene lays its beam by: density 1, a tile of 64 px, full motion. */
const FRAME: BeamFrame = { dpr: 1, tile: 64, now: 1000, reduced: false };

/** A scene's beam on fake canvases, every canvas it makes kept with what it was asked. */
function fakeBeam(): { beam: ReturnType<typeof sceneBeam>; made: Entry[][] } {
  const made: Entry[][] = [];
  const beam = sceneBeam((w, h) => {
    const { canvas, log } = fakeCanvas(w, h, `beam ${made.length}`);
    made.push(log);
    return canvas;
  });
  return { beam, made };
}

describe('layBeam — the beam on the scene’s canvas', () => {
  it('lays the turned beam whole at whole pixels, as strong as the lamp is on', () => {
    const scene = fakeCanvas(1440, 820, 'scene');
    const { beam } = fakeBeam();
    layBeam(scene.ctx, beam, lampAt(900.4, 500.6, Math.PI, 0.75), FRAME);
    const [laid] = callEntries(scene.log, 'drawImage');
    expect(laid?.args).toHaveLength(3);
    expect(laid?.alpha).toBe(0.75);
    expect(Number.isInteger(laid?.args[1])).toBe(true);
    expect(Number.isInteger(laid?.args[2])).toBe(true);
    expect(laid?.args[0]).toBe(beam.turned?.canvas);
  });

  it('turns the beam anew only for a new degree, and bakes it anew only for a new reach', () => {
    const scene = fakeCanvas(1440, 820, 'scene');
    const { beam, made } = fakeBeam();
    layBeam(scene.ctx, beam, lampAt(900, 500, Math.PI), FRAME);
    layBeam(scene.ctx, beam, lampAt(903, 497, Math.PI + 0.3 * BEAM_STEP), FRAME);
    expect(beam.turns).toBe(1);
    layBeam(scene.ctx, beam, lampAt(903, 497, Math.PI + BEAM_STEP), FRAME);
    expect(beam.turns).toBe(2);
    expect(made).toHaveLength(2);
    layBeam(scene.ctx, beam, { ...lampAt(903, 497, Math.PI + BEAM_STEP), reach: 300 }, FRAME);
    expect(made).toHaveLength(3);
    expect(beam.turns).toBe(3);
  });

  it('lays a beam on the slant from a box no larger than one pointing straight across', () => {
    const scene = fakeCanvas(1440, 820, 'scene');
    const { beam } = fakeBeam();
    const areaAt = (angle: number): number => {
      layBeam(scene.ctx, beam, lampAt(900, 500, angle), FRAME);
      const turned = beam.turned?.canvas;
      return (turned?.width ?? 0) * (turned?.height ?? 0);
    };
    const across = areaAt(Math.PI);
    // Straight across, its box hugs the cone: as long as it reaches, as tall as it spreads.
    expect(beam.turned?.canvas.width).toBeLessThanOrEqual(400 + 4);
    expect(across).toBeLessThan(404 * (2 * 400 * Math.sin(beamSpread(BEAM_HALF)) + 4));
    expect(areaAt(SWEEP.high)).toBeLessThan(across * 1.1);
    expect(areaAt(SWEEP.low)).toBeLessThan(across * 1.1);
  });

  it('lays nothing without a lamp, or with a lamp not on', () => {
    const scene = fakeCanvas(1440, 820, 'scene');
    const { beam, made } = fakeBeam();
    layBeam(scene.ctx, beam, null, FRAME);
    layBeam(scene.ctx, beam, lampAt(900, 500, Math.PI, 0), FRAME);
    expect(scene.log).toEqual([]);
    expect(made).toEqual([]);
  });

  it('lets its canvases go once no lamp is alight, and bakes anew for the next', () => {
    const scene = fakeCanvas(1440, 820, 'scene');
    const canvases: HTMLCanvasElement[] = [];
    const beam = sceneBeam((w, h) => {
      const { canvas } = fakeCanvas(w, h);
      canvases.push(canvas);
      return canvas;
    });
    layBeam(scene.ctx, beam, lampAt(900, 500, Math.PI), FRAME);
    expect(canvases).toHaveLength(2);
    layBeam(scene.ctx, beam, null, FRAME);
    expect([beam.master, beam.turned]).toEqual([null, null]);
    expect(canvases.map((canvas) => [canvas.width, canvas.height])).toEqual([[0, 0], [0, 0]]);
    layBeam(scene.ctx, beam, lampAt(900, 500, Math.PI), FRAME);
    expect(canvases).toHaveLength(4);
    layBeam(scene.ctx, beam, lampAt(900, 500, Math.PI, 0), FRAME);
    expect([beam.master, beam.turned]).toEqual([null, null]);
  });

  it('bakes a warm cone no stronger than BEAM_LIGHT, fading out along its reach', () => {
    vi.stubGlobal('Path2D', FakePath2D);
    const scene = fakeCanvas(1440, 820, 'scene');
    const { beam, made } = fakeBeam();
    layBeam(scene.ctx, beam, lampAt(900, 500, Math.PI), FRAME);
    const [master] = made;
    if (master === undefined) throw new Error('no beam baked');
    const fills = master.filter((e) => e.kind === 'set' && e.name === 'fillStyle');
    const [across, along] = fills.map((e) => (e.kind === 'set' ? e.value : null));
    expect(across).toBeInstanceOf(FakeGradient);
    const alphaOf = (colour: string): number => Number(/,\s*([\d.]+)\)$/.exec(colour)?.[1]);
    const alphas = (across as FakeGradient).stops.map(([, colour]) => alphaOf(colour));
    expect(Math.max(...alphas)).toBeCloseTo(BEAM_LIGHT, 6);
    expect((along as FakeGradient).stops.map(([offset]) => offset)).toEqual(
      OWN_BEAM_STOPS.map(([offset]) => offset),
    );
    vi.unstubAllGlobals();
  });

  it('shows the dust in the beam only inside its cone, and none under reduced motion', () => {
    const scene = fakeCanvas(1440, 820, 'scene');
    const { beam } = fakeBeam();
    let now = 0;
    for (; now < 6000; now += 1000 / 30) {
      layBeam(scene.ctx, beam, lampAt(900, 500, Math.PI), { ...FRAME, now });
    }
    expect(callEntries(scene.log, 'fillRect').length).toBeGreaterThan(100);
    // Turned a quarter: the motes born in the cone before lie outside it now.
    const turned = lampAt(900, 500, Math.PI / 2);
    const before = scene.log.length;
    for (const end = now + 300; now < end; now += 1000 / 30) {
      layBeam(scene.ctx, beam, turned, { ...FRAME, now });
    }
    for (const { args } of callEntries(scene.log.slice(before), 'fillRect')) {
      const [x = 0, y = 0] = args as number[];
      expect(Math.abs(Math.atan2(y - turned.y, x - turned.x) - turned.angle)).toBeLessThan(0.3);
      expect(Math.hypot(x - turned.x, y - turned.y)).toBeLessThan(turned.reach);
    }
    const still = scene.log.length;
    layBeam(scene.ctx, beam, turned, { ...FRAME, now, reduced: true });
    expect(callEntries(scene.log.slice(still), 'fillRect')).toEqual([]);
  });
});

/** What the hero's painter needs on a fake page, at 1440 × 820. */
const paintingOf = (reduced: boolean): HeroPainting => painting({ reduced });

/** The lamp the hero holds out now, there by the test's word. */
function lampHeld(): HeroLamp {
  const lamp = heroLamp();
  if (lamp === null) throw new Error('the hero holds no lamp');
  return lamp;
}

describe('the hero’s painter and its lamp', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
    vi.stubGlobal('window', { devicePixelRatio: 1 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    holdLamp(null);
  });

  it('holds its lamp out to the scene, its beam stopping short of the menu’s column', () => {
    const on = paintingOf(false);
    heroPainter(on, 0)(100);
    const lamp = lampHeld();
    expect(lamp.on).toBe(1);
    expect(lamp.reach).toBeCloseTo(REACH_SHARE * FIGURE_TALL * PLACE.scale, 6);
    expect(lamp.x - lamp.reach).toBeGreaterThan(DESKTOP.menuRight);
  });

  it('holds the beam a beat on the item hovered, pointing at its middle', () => {
    const on = paintingOf(false);
    const paint = heroPainter(on, 0);
    paint(0);
    const lens = heroLamp();
    if (lens === null) throw new Error('no lamp');
    // Beitreten, at the menu's left, a little over the lens.
    const item = { id: 'join', x: 300, y: lens.y - 120 };
    on.attends.current = item;
    const angle = Math.atan2(item.y - lens.y, item.x - lens.x) + 2 * Math.PI;
    let holding = 0;
    for (let now = 0; now <= 2 * SWEEP_MS; now += 1000 / 30) {
      paint(now);
      if (on.probe.beam?.holding === true) {
        holding += 1;
        expect(heroLamp()?.angle).toBeCloseTo(angle, 1);
      }
    }
    expect(holding).toBeGreaterThan(20);
    expect(on.probe.attends).toBe('join');
  });

  it('stands its beam still under reduced motion, whatever is hovered', () => {
    const on = paintingOf(true);
    on.attends.current = { id: 'join', x: 300, y: 400 };
    const paint = heroPainter(on, 0);
    for (const now of [0, 3000, 7000, 15_000]) {
      paint(now);
      expect(heroLamp()?.angle).toBe(STILL_ANGLE);
      expect(on.probe.beam?.holding).toBe(false);
    }
  });

  it('lets its lamp go where the stage leaves it no room', () => {
    const on = paintingOf(false);
    heroPainter(on, 0)(0);
    expect(heroLamp()).not.toBeNull();
    on.standing.place = null;
    heroPainter(on, 0)(100);
    expect(heroLamp()).toBeNull();
  });
});

describe('what of the menu the player attends to', () => {
  /** An element of the menu at `box`, its item id `item`; `card` for a run's card. */
  function element(item: string | null, box: { left: number; top: number }): Element {
    class Fake {
      dataset = item === null ? {} : { item };
      closest(selector: string): Fake | null {
        return selector.includes(item === null ? '.bound' : '.menu-item') ? this : null;
      }
      getBoundingClientRect() {
        return { ...box, width: 200, height: 46 };
      }
    }
    vi.stubGlobal('Element', Fake);
    vi.stubGlobal('HTMLElement', Fake);
    return new Fake() as unknown as Element;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is the menu’s item by its id, or a run’s card, at its middle', () => {
    expect(attendedOf(element('join', { left: 72, top: 286 }))).toEqual({
      id: 'join',
      x: 172,
      y: 309,
    });
    expect(attendedOf(element(null, { left: 72, top: 200 }))?.id).toBe('card');
    expect(attendedOf(null)).toBeNull();
  });
});

/** Blackout as GET /missions/blackout answers it. */
const BLACKOUT: unknown = JSON.parse(
  readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8'),
);

describe('the scene lays the hero’s beam', () => {
  /** The canvases the page has made, in order. */
  let made: HTMLCanvasElement[] = [];
  let clock = 1000;
  let queued = new Map<number, FrameRequestCallback>();

  beforeEach(() => {
    vi.resetModules();
    made = [];
    clock = 1000;
    queued = new Map();
    let next = 1;
    vi.stubGlobal('Path2D', FakePath2D);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('devicePixelRatio', 1);
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => BLACKOUT }));
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      createElement: () => {
        const { canvas } = fakeCanvas(300, 150, `made ${made.length}`);
        made.push(canvas);
        return canvas;
      },
    });
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      queued.set(next, run);
      return next++;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => queued.delete(handle));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Runs the page's frames for `ms` at 60 Hz. */
  const run = (ms: number): void => {
    for (let n = Math.round((ms * 60) / 1000); n > 0; n -= 1) {
      clock += 1000 / 60;
      const due = [...queued.values()];
      queued = new Map();
      for (const frame of due) frame(clock);
    }
  };

  it('over its lab while a hero holds a lamp, its still drawn anew as it moves', async () => {
    const { openStage } = await import('../src/world/menu/stage.js');
    const lamps = await import('../src/world/menu/lamp.js');
    const scene = fakeCanvas(300, 150, 'scene');
    Object.assign(scene.canvas, { clientWidth: 160, clientHeight: 90 });
    let reduced = true;
    const motion = { reduced: () => reduced, watch: () => () => undefined };
    const stage = openStage(scene.canvas, motion);
    stage.show('blackout');
    await new Promise((resolve) => setTimeout(resolve, 0));
    run(1000);
    const beams = (): number =>
      callEntries(scene.log, 'drawImage').filter((e) => e.alpha === 0.8).length;
    expect(beams()).toBe(0);
    expect(queued.size).toBe(0);
    const baked = made.length;
    lamps.holdLamp({ x: 120, y: 60, angle: Math.PI, reach: 80, on: 0.8 });
    expect(queued.size).toBe(1);
    run(100);
    expect(beams()).toBe(1);
    lamps.holdLamp({ x: 120, y: 60, angle: Math.PI + 0.2, reach: 80, on: 0.8 });
    run(100);
    expect(beams()).toBe(2);
    lamps.holdLamp(null);
    const copies = callEntries(scene.log, 'drawImage').length;
    run(100);
    expect(callEntries(scene.log, 'drawImage').length).toBe(copies + 1);
    expect(beams()).toBe(2);
    // The beam's canvases go with the lamp: the lobby's scene drifts on without them.
    const sprites = made.slice(baked);
    expect(sprites).toHaveLength(2);
    expect(sprites.map((canvas) => [canvas.width, canvas.height])).toEqual([[0, 0], [0, 0]]);
    reduced = false;
    stage.close();
  });
});
