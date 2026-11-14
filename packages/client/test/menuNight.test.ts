import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawScientist } from '../src/world/art.js';
import { restingPose } from '../src/world/figure.js';
import { HERO_FACING } from '../src/world/menu/hero.js';
import {
  FRONT_RIM,
  HERO_NIGHT,
  heroCanvas,
  paintHero,
  VISOR_GLOW,
  type HeroCanvas,
  type HeroFrame,
} from '../src/world/menu/heroArt.js';
import { heroPainter } from '../src/world/menu/heroStage.js';
import {
  holdLamp,
  holdNight,
  labAtNight,
  watchLamp,
  type HeroLamp,
} from '../src/world/menu/lamp.js';
import { FLARE_LIGHT, layBeam, sceneBeam } from '../src/world/menu/lampArt.js';
import { NIGHT_SINK, nightTo, type SceneBake } from '../src/world/menu/scene.js';
import { css, parseHex, rgba, sink } from '../src/world/palette.js';
import { callEntries, fakeCanvas, FakeGradient, FakePath2D, type Entry } from './fakeCanvas.js';
import { DESKTOP_STAGE, painting, placedOn } from './heroPage.js';

/**
 * The menu's lab at night and the light in it (docs/art-bible.md „The hero"): the lab baked sunk
 * to night once, in place, while a hero stands on the stage, and lit again for the lobby or a
 * stage without one; the beam laid as light added onto it, its motes and its flare; the hero in
 * its colour sunk for the night, an edge of its lamp's light down its front, its visor catching
 * the glow of the item it looks at — and nothing of it on a figure of the world.
 */

/** A bake of `w` × `h` on a fake canvas, as the scene keeps it. */
function bakeOf(w = 400, h = 200): { bake: SceneBake; log: Entry[] } {
  const { canvas, log } = fakeCanvas(w, h, 'bake');
  const bake: SceneBake = {
    canvas,
    shot: { from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, scale: 50 },
    box: { left: 0, top: 0, width: w, height: h },
    w: w / 2,
    h,
    night: false,
    spots: {},
    dark: { at: { x: 0, y: 100 }, colour: '#1a1716' },
  };
  return { bake, log };
}

describe('the lab at night', () => {
  it('sinks the bake once, on its own pixels alone, and lets it be while it stays night', () => {
    const { bake, log } = bakeOf();
    nightTo(bake, true);
    const [sunk, ...more] = callEntries(log, 'fillRect');
    expect(more).toEqual([]);
    expect(sunk?.op).toBe('source-atop');
    expect(sunk?.args).toEqual([0, 0, 400, 200]);
    // The dark round the lab read again as the night has it, once the night has fallen on it.
    const reads = callEntries(log, 'getImageData');
    expect(reads.map((e) => e.args)).toEqual([[0, 100, 1, 1]]);
    expect(log.at(-1)).toMatchObject({ kind: 'call', name: 'getImageData' });
    expect(bake.dark?.colour).toBe('#000000');
    const style = log.filter((e) => e.kind === 'set' && e.name === 'fillStyle').at(-1);
    expect(style?.kind === 'set' && style.value).toBe(`rgba(0, 0, 0, ${NIGHT_SINK})`);
    expect(bake.night).toBe(true);
    const calls = log.length;
    nightTo(bake, true);
    expect(log).toHaveLength(calls);
  });

  it('lights it again by adding it onto itself until its light is back', () => {
    const { bake, log } = bakeOf();
    nightTo(bake, true);
    log.length = 0;
    nightTo(bake, false);
    const added = callEntries(log, 'drawImage');
    expect(added.every((e) => e.op === 'lighter' && e.args[0] === bake.canvas)).toBe(true);
    // Each copy adds its share of what stands: the light multiplied back to before the night.
    const times = added.reduce((light, e) => light * (1 + e.alpha), 1);
    expect(times).toBeCloseTo(1 / (1 - NIGHT_SINK), 6);
    expect(bake.night).toBe(false);
  });

  it('falls and lifts over the whole canvas, whatever the passes left on its context', () => {
    // The world's passes leave the bake's context moved to the box's corner and half strong.
    for (const night of [true, false]) {
      const { bake, log } = bakeOf();
      bake.night = !night;
      const g = bake.canvas.getContext('2d');
      g?.setTransform(1, 0, 0, 1, 65, 65);
      if (g !== null) g.globalAlpha = 0.5;
      log.length = 0;
      nightTo(bake, night);
      const drawn = log.findIndex((e) => e.kind === 'call' && /fillRect|drawImage/.test(e.name));
      const before = log.slice(0, drawn);
      const reset = { name: 'setTransform', args: [1, 0, 0, 1, 0, 0] };
      expect(before).toContainEqual(expect.objectContaining(reset));
      expect(log[drawn]?.kind === 'call' && log[drawn]?.alpha).toBeGreaterThan(0.5);
    }
  });
});

describe('the night the hero holds', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
    vi.stubGlobal('window', { devicePixelRatio: 1, innerWidth: 1440, innerHeight: 820 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    holdLamp(null);
    holdNight(false);
  });

  it('falls with the hero standing on the stage, and lifts where the stage leaves it none', () => {
    const on = painting();
    heroPainter(on, 0)(100);
    expect(labAtNight()).toBe(true);
    on.standing.place = null;
    heroPainter(on, 0)(200);
    expect(labAtNight()).toBe(false);
  });

  it('tells the scene only as it falls or lifts', () => {
    const told = vi.fn();
    const stop = watchLamp(told);
    holdNight(true);
    holdNight(true);
    holdNight(false);
    stop();
    expect(told).toHaveBeenCalledTimes(2);
  });

  it('tells the scene of a flare of the lamp alone', () => {
    holdLamp(lampOf());
    const told = vi.fn();
    const stop = watchLamp(told);
    holdLamp(lampOf());
    holdLamp(lampOf(1, 0.5));
    stop();
    expect(told).toHaveBeenCalledTimes(1);
  });
});

/** A lamp at (900, 500) pointing left, 400 px long, burning `on`, flaring `flare`. */
const lampOf = (on = 1, flare = 0): HeroLamp => ({
  x: 900,
  y: 500,
  angle: Math.PI,
  reach: 400,
  on,
  flare,
});

const FRAME = { dpr: 1, tile: 64, now: 0, reduced: false };

describe('the beam over the lab at night', () => {
  it('lays its haze over the lab, the motes as well, and a second haze as it flares', () => {
    const scene = fakeCanvas(1440, 820, 'scene');
    const beam = sceneBeam((w, h) => fakeCanvas(w, h).canvas);
    for (let now = 0; now < 3000; now += 1000 / 30) {
      layBeam(scene.ctx, beam, lampOf(), { ...FRAME, now });
    }
    const laid = callEntries(scene.log, 'drawImage');
    expect(laid.length).toBeGreaterThan(90);
    expect(laid.every((e) => e.op === 'source-over')).toBe(true);
    expect(laid.some((e) => e.args[0] === beam.mote)).toBe(true);
    scene.log.length = 0;
    layBeam(scene.ctx, beam, lampOf(1, 0.5), { ...FRAME, now: 3000 });
    const laidTurned = callEntries(scene.log, 'drawImage');
    const turned = laidTurned.filter((e) => e.args[0] === beam.turned?.canvas);
    expect(turned.map((e) => e.alpha)).toEqual([1, 0.5 * FLARE_LIGHT]);
    // Back at full strength for the scene's next copy once the beam is laid.
    const strength = scene.log.filter((e) => e.kind === 'set' && e.name === 'globalAlpha');
    expect(strength.at(-1)?.kind === 'set' && strength.at(-1)).toMatchObject({ value: 1 });
  });
});

/** The colours `log` filled the figure's body with: the gradient of its body's stops. */
function bodyStops(log: readonly Entry[]): string[] {
  const fills = log.filter((e) => e.kind === 'set' && e.name === 'fillStyle');
  const gradients = fills.flatMap((e) =>
    e.kind === 'set' && e.value instanceof FakeGradient && e.value.gradient === 'linear'
      ? [e.value]
      : [],
  );
  return gradients[0]?.stops.map(([, colour]) => colour) ?? [];
}

describe('the hero in the lab at night', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A hero's canvas whose layers' drawings are kept in `logs`. */
  function loggedHero(): { hero: HeroCanvas; logs: Entry[][] } {
    const logs: Entry[][] = [];
    const hero = heroCanvas(fakeCanvas(0, 0, 'hero').canvas, (w, h) => {
      const made = fakeCanvas(w, h);
      logs.push(made.log);
      return made.canvas;
    });
    if (hero === null) throw new Error('no hero canvas');
    return { hero, logs };
  }

  /** A frame of the hero standing at 1440 × 820, its lamp `on`, its visor's `glow`. */
  function frameOf(on: number, glow: boolean): HeroFrame {
    const place = placedOn(DESKTOP_STAGE);
    const motion = { offset: 0, moving: false, walk: 0, facing: HERO_FACING, look: null };
    const pose = { ...restingPose(HERO_FACING), arms: { front: 1.35, back: 1.45 }, holding: true };
    const lamp = { tilt: 0, on, flare: 0 };
    return { place, box: place.box, motion, pose, color: '#2dd4bf', dpr: 1, lamp, glow };
  }

  /** What one frame of the hero (`frameOf`) draws. */
  function painted(on: number, glow: boolean): Entry[] {
    const { hero, logs } = loggedHero();
    paintHero(hero, frameOf(on, glow));
    return logs.flat();
  }

  /** Whether `log` fills the visor with the glow it catches. */
  const warm = (log: Entry[]): boolean =>
    log.some(
      (e) =>
        e.kind === 'set' &&
        e.name === 'fillStyle' &&
        e.value instanceof FakeGradient &&
        e.value.stops[0]?.[1] === rgba(VISOR_GLOW.rgb, VISOR_GLOW.alpha),
    );

  it('wears its colour sunk for the night, and an edge of its lamp’s light while it burns', () => {
    const lit = painted(1, false);
    const night = css(sink(parseHex('#2dd4bf'), HERO_NIGHT));
    expect(bodyStops(lit)).toContain(night);
    const rim = (log: Entry[]): number =>
      log.filter(
        (e) =>
          e.kind === 'set' &&
          e.name === 'strokeStyle' &&
          e.value instanceof FakeGradient &&
          e.value.stops.some(([, colour]) => colour === rgba(FRONT_RIM.rgb, FRONT_RIM.alpha)),
      ).length;
    expect(FRONT_RIM.alpha).toBeGreaterThan(0.5);
    expect(rim(lit)).toBeGreaterThan(0);
    // With its lamp out no edge is drawn at all: nothing clipped to the body for it.
    const out = painted(0, false);
    expect(rim(out)).toBe(0);
    expect(callEntries(out, 'clip')).toHaveLength(0);
  });

  it('catches the glow of the item it looks at on its visor', () => {
    expect(warm(painted(1, true))).toBe(true);
    expect(warm(painted(1, false))).toBe(false);
  });

  it('draws its upper layer anew as its visor catches the glow, its pose the same', () => {
    const { hero, logs } = loggedHero();
    paintHero(hero, frameOf(1, false));
    const upper = hero.drawn.upper;
    paintHero(hero, frameOf(1, true));
    expect(hero.drawn.upper).toBe(upper + 1);
    expect(warm(logs.flat())).toBe(true);
  });

  it('leaves the world’s figures as they were: no edge light, no glow on a visor', () => {
    const plain = fakeCanvas(64, 64);
    const options = {
      color: '#2dd4bf',
      name: '',
      facing: 0.4,
      moving: false,
      walkPhase: 0,
      isYou: false,
      connected: true,
    };
    drawScientist(plain.ctx, options);
    const lit = fakeCanvas(64, 64);
    drawScientist(lit.ctx, { ...options, rim: { front: null, back: null }, visorGlow: null });
    expect(lit.log).toEqual(plain.log);
    expect(callEntries(plain.log, 'clip')).toHaveLength(0);
  });
});
