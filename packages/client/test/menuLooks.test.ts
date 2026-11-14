import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELD_SCALE } from '../src/world/art.js';
import type * as Looks from '../src/world/menu/looks.js';
import { rgba } from '../src/world/palette.js';
import {
  callEntries,
  fakeCanvas,
  FakeGradient,
  FakePath2D,
  strip,
  type Entry,
} from './fakeCanvas.js';
import { DESKTOP_STAGE, placedOn } from './heroPage.js';

/**
 * The owner's three looks for the menu's hero (world/menu/looks.ts): each switch, set as the
 * still it stands for was shot, changes what the hero's layers draw — B its light, sunk further
 * and a cold edge down its back; C its arms and the lamp held out, and the lens with them —, and
 * the switches as they stand draw look A.
 */

/** The hero standing still in its place at 1440 × 820, as the page would draw it with `set`. */
async function drawnWith(set: (looks: typeof Looks) => Partial<typeof Looks> = () => ({})) {
  vi.resetModules();
  vi.doMock('../src/world/menu/looks.js', async (importOriginal) => {
    const looks = await importOriginal<typeof Looks>();
    return { ...looks, ...set(looks) };
  });
  const { heroPose, STANDING_STILL } = await import('../src/world/menu/hero.js');
  const { heroCanvas, paintHero } = await import('../src/world/menu/heroArt.js');
  const { lensAt } = await import('../src/world/menu/lamp.js');
  const layers: Entry[][] = [];
  const hero = heroCanvas(fakeCanvas(0, 0, 'hero').canvas, (w, h) => {
    const made = fakeCanvas(w, h);
    layers.push(made.log);
    return made.canvas;
  });
  if (hero === null) throw new Error('no hero canvas');
  const place = placedOn(DESKTOP_STAGE);
  const pose = heroPose({ phase: 0.3, speaking: false, waveAt: null, reduced: true }, [0, 0]);
  const lamp = { tilt: 0, on: 1, flare: 0 };
  const box = place.box;
  paintHero(hero, { place, box, motion: STANDING_STILL, pose, color: '#2dd4bf', dpr: 1, lamp, glow: false });
  const [legs = [], upper = []] = layers;
  return { legs, upper, arms: pose.arms, lens: lensAt(place, 0, 0) };
}

/** How many edges `log` strokes in a light whose stops name `colour`. */
const edgesIn = (log: readonly Entry[], colour: string): number =>
  log.filter(
    (e) =>
      e.kind === 'set' &&
      e.name === 'strokeStyle' &&
      e.value instanceof FakeGradient &&
      e.value.stops.some(([, stop]) => stop === colour),
  ).length;

beforeEach(() => {
  vi.stubGlobal('Path2D', FakePath2D);
});

afterEach(() => {
  vi.doUnmock('../src/world/menu/looks.js');
  vi.unstubAllGlobals();
});

describe('the hero’s looks', () => {
  it('stand at look A: the warm edge alone, the lamp at rest', async () => {
    const looks = await import('../src/world/menu/looks.js');
    expect(looks.HERO_LIGHT).toBe(looks.WARM_EDGE);
    expect(looks.LAMP_RAISE).toBe(looks.LAMP_AT_REST);
  });

  it('B: its back light on sinks the figure further and lays a cold edge down its back', async () => {
    const a = await drawnWith();
    const b = await drawnWith((looks) => ({ HERO_LIGHT: looks.COLD_BACK }));
    const { COLD_BACK } = await import('../src/world/menu/looks.js');
    const cold = COLD_BACK.back;
    if (cold === null) throw new Error('look B without its back light');
    expect(edgesIn(a.upper, rgba(cold.rgb, cold.alpha))).toBe(0);
    expect(edgesIn(b.upper, rgba(cold.rgb, cold.alpha))).toBeGreaterThan(0);
    expect(strip(b.legs)).not.toEqual(strip(a.legs));
    // The lamp and the pose stay as A has them.
    expect([b.arms, b.lens]).toEqual([a.arms, a.lens]);
  });

  it('C: the lamp held out raises the arms and the lamp in the hands, and the lens with them', async () => {
    const a = await drawnWith();
    const c = await drawnWith((looks) => ({ LAMP_RAISE: looks.LAMP_HELD_OUT }));
    const { LAMP_HELD_OUT } = await import('../src/world/menu/looks.js');
    expect(strip(c.upper)).not.toEqual(strip(a.upper));
    expect(strip(c.legs)).toEqual(strip(a.legs));
    // The lamp drawn higher in the hands, as far as the lens is held up.
    const lifted = (log: readonly Entry[]): unknown[][] =>
      callEntries(log, 'translate').map((e) => e.args).filter(([x, y]) => x === 0 && y !== 0);
    expect(lifted(a.upper)).toEqual([]);
    expect(lifted(c.upper)).toContainEqual([0, -LAMP_HELD_OUT.up / HELD_SCALE]);
    expect(c.arms?.front).toBeCloseTo((a.arms?.front ?? 0) + LAMP_HELD_OUT.arms, 9);
    const place = placedOn(DESKTOP_STAGE);
    expect(a.lens.y - c.lens.y).toBeCloseTo(LAMP_HELD_OUT.up * place.scale, 9);
  });
});
