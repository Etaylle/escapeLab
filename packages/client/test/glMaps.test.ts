import { describe, expect, it } from 'vitest';
import {
  ambientOf,
  occupancy,
  occupancyKey,
  poolsOfPixels,
  wallFaces,
  type Pools,
} from '../src/world/gl/maps.js';
import { ALARM_RED, WARM } from '../src/world/power.js';
import { roomKeep } from '../src/world/render/darkness.js';
import type { Frame, LitRoom } from '../src/world/render/frame.js';
import { mapWith } from './fixtures.js';
import { frameWith, lightWith, TILES } from './frames.js';

/** The 10×6 lab of frames.ts: a doorway at (5, 2) between its two rooms. */
const map = mapWith({ width: 10, height: 6, tiles: TILES });
const W = 10;
const at = (x: number, y: number): number => y * W + x;

/** Pools of a light colour: its tint on every floor tile, at `alpha` (per light, by strength). */
function pools(alpha: (light: typeof WARM) => number): Pools {
  return (light) => {
    const rgb = new Float32Array(10 * 6 * 3);
    TILES.forEach((row, y) =>
      [...row].forEach((tile, x) => {
        if (tile === '.') {
          light.tint.forEach((c, i) => {
            rgb[at(x, y) * 3 + i] = (c / 255) * alpha(light);
          });
        }
      }),
    );
    return rgb;
  };
}

const flatPools = pools(() => 0.2);

/** The lab with a shelf at (x, 3). */
function furnished(x: number) {
  return mapWith({ width: 10, height: 6, tiles: TILES, decor: [{ kind: 'shelf', x, y: 3 }] });
}

/** A lit room of `tiles`, its lights on since `since`. */
function room(tiles: { x: number; y: number }[], since: number): LitRoom {
  return { tiles, path: { path: 'room' } as unknown as Path2D, since };
}

/** The light that is no lamp's in `parts`' frame over the lab. */
function ambient(parts: Partial<Frame>) {
  return ambientOf(frameWith({ map, ...parts }), flatPools);
}

describe('occupancy — the tiles that stop light, a byte a tile', () => {
  it('marks walls and the doors shut now, floor and open doors not', () => {
    const data = occupancy(map, new Set(['5,2']));
    expect(data).toHaveLength(60);
    expect(data[at(0, 0)]).toBe(255);
    expect(data[at(1, 1)]).toBe(0);
    expect(data[at(5, 1)]).toBe(255);
    expect(data[at(5, 2)]).toBe(255);
    expect(occupancy(map, new Set())[at(5, 2)]).toBe(0);
  });

  it('stops light at anything that is not floor, as sight does — the void, a short row', () => {
    const odd = mapWith({ width: 3, height: 2, tiles: ['. x', '.'] });
    expect([...occupancy(odd, new Set())]).toEqual([0, 255, 255, 0, 255, 255]);
  });

  it('stops light at furniture, which sight sees past: a shelf throws a shadow', () => {
    const data = occupancy(furnished(2), new Set());
    expect(data[at(2, 3)]).toBe(255);
    expect(data[at(3, 3)]).toBe(0);
    expect(occupancy(map, new Set())[at(2, 3)]).toBe(0);
  });
});

describe('occupancyKey — what the occupancy texture is made for', () => {
  it('changes as a door opens or shuts or the furniture stands elsewhere, else not', () => {
    const key = occupancyKey(furnished(2), new Set(['5,2']));
    expect(occupancyKey(furnished(2), new Set(['5,2']))).toBe(key);
    expect(occupancyKey(furnished(3), new Set(['5,2']))).not.toBe(key);
    expect(occupancyKey(furnished(2), new Set())).not.toBe(key);
    expect(occupancyKey(map, new Set(['5,2']))).not.toBe(key);
  });
});

describe('wallFaces — the faces of each wall that look onto the floor', () => {
  it('opens a wall’s faces towards the floor beside it: north, east, south, west', () => {
    const faces = wallFaces(map);
    const of = (x: number, y: number): number[] => [...faces.slice(at(x, y) * 4, at(x, y) * 4 + 4)];
    // The top wall over the left room looks south only; the wall between the rooms east and
    // west — and north too just below the doorway.
    expect(of(2, 0)).toEqual([0, 0, 255, 0]);
    expect(of(5, 4)).toEqual([0, 255, 0, 255]);
    expect(of(5, 3)).toEqual([255, 255, 0, 255]);
    // Beside the doorway the wall's south face looks onto the door's floor.
    expect(of(5, 1)).toEqual([0, 255, 255, 255]);
    // A corner of the outer wall looks onto no floor at all; floor has no faces.
    expect(of(0, 0)).toEqual([0, 0, 0, 0]);
    expect(of(2, 2)).toEqual([0, 0, 0, 0]);
  });
});

describe('ambientOf — the light that is no lamp’s, a texel a tile', () => {
  it('keeps all of the darkness, and adds nothing, in the dark with no room lit', () => {
    const { keep, over, under } = ambient({});
    expect(new Set(keep)).toEqual(new Set([255]));
    expect([...over].filter((_, i) => i % 4 !== 3).every((v) => v === 0)).toBe(true);
    expect([...under].filter((_, i) => i % 4 !== 3).every((v) => v === 0)).toBe(true);
  });

  it('keeps no darkness in a lit room whose lights are up, some while they come on', () => {
    const tiles = [{ x: 6, y: 2 }, { x: 5, y: 1 }];
    const up = ambient({ time: 10, lit: new Map([['LABOR', room(tiles, -Infinity)]]) });
    expect(up.keep[at(6, 2)]).toBe(0);
    expect(up.keep[at(5, 1)]).toBe(0);
    expect(up.keep[at(2, 2)]).toBe(255);
    const coming = { time: 10, lit: new Map([['LABOR', room(tiles, 10 - 0.25)]]) };
    const keep = roomKeep(frameWith({ map, ...coming }))('LABOR');
    expect(keep).toBeGreaterThan(0);
    expect(ambient(coming).keep[at(6, 2)]).toBe(Math.round(keep * 255));
  });

  it('keeps of a tile two lit rooms light what both leave, on the escape’s alarm lighting', () => {
    const shared = [{ x: 5, y: 2 }];
    const lit = new Map([
      ['ARCHIV', room(shared, -Infinity)],
      ['LABOR', room(shared, -Infinity)],
    ]);
    const parts = { lit, red: 1, time: 0 };
    const keep = roomKeep(frameWith({ map, ...parts }));
    expect(ambient(parts).keep[at(5, 2)]).toBe(Math.round(keep('ARCHIV') * keep('LABOR') * 255));
    expect(keep('ARCHIV')).toBeGreaterThan(0.3);
  });

  it('lays a lit room’s ceiling light over its floor, warm, as far as it has come on', () => {
    const lit = new Map([['LABOR', room([{ x: 6, y: 2 }, { x: 5, y: 1 }], -Infinity)]]);
    const { over } = ambient({ lit, time: 3 });
    expect([...over.slice(at(6, 2) * 4, at(6, 2) * 4 + 4)]).toEqual([
      Math.round(255 * 0.2),
      Math.round(214 * 0.2),
      Math.round(168 * 0.2),
      255,
    ]);
    // The wall has no pool, and a tile of no lit room none either.
    expect(over[at(5, 1) * 4]).toBe(0);
    expect(over[at(2, 2) * 4]).toBe(0);
  });

  it('turns a lit room’s light red as the escape’s siren sounds, by its strength', () => {
    const lit = new Map([['LABOR', room([{ x: 6, y: 2 }], -Infinity)]]);
    const byStrength = pools((light) => 0.1 * light.strength);
    const { over } = ambientOf(frameWith({ map, lit, red: 1 }), byStrength);
    const [r, g, b] = ALARM_RED.tint.map((c) => Math.round(c * 0.1 * ALARM_RED.strength));
    expect([...over.slice(at(6, 2) * 4, at(6, 2) * 4 + 3)]).toEqual([r, g, b]);
  });

  it('lights your room while the lab has its power: no darkness, its ceiling light under', () => {
    const roomLight = {
      light: { keys: new Set(['2,2', '3,2', '2,0']), runs: [] },
      path: { path: 'room' } as unknown as Path2D,
    };
    const light = lightWith({ room: roomLight });
    const { keep, under } = ambient({ light, scene: { lit: true, cover: 0 } });
    expect(keep[at(2, 2)]).toBe(0);
    expect(keep[at(2, 0)]).toBe(0);
    expect(keep[at(6, 2)]).toBe(255);
    expect(under[at(2, 2) * 4]).toBeGreaterThan(under[at(2, 0) * 4] ?? 255);
    expect(under[at(2, 0) * 4]).toBeGreaterThan(0);
    expect(under[at(6, 2) * 4]).toBe(0);
    expect(WARM.tint[0]).toBe(255);
  });

  it('warms the whole lab under the darkness as a run won lights up', () => {
    const half = ambient({ ending: { lit: 0.5, pull: 0, dark: 0 } }).under;
    const full = ambient({ ending: { lit: 1, pull: 0, dark: 0 } }).under;
    expect(half[at(6, 2) * 4]).toBeGreaterThan(0);
    expect(full[at(6, 2) * 4]).toBeGreaterThan(half[at(6, 2) * 4] ?? 255);
    expect(full[at(0, 0) * 4]).toBeGreaterThan(0);
  });
});

describe('poolsOfPixels — a baked ceiling layer read back', () => {
  it('reads what each tile adds: its colour at the strength of its pool', () => {
    const pixels = [255, 214, 168, 51, 0, 0, 0, 0];
    expect([...poolsOfPixels(pixels, 2)].map((v) => Math.round(v * 1000) / 1000)).toEqual([
      0.2,
      Math.round((214 / 255) * 0.2 * 1000) / 1000,
      Math.round((168 / 255) * 0.2 * 1000) / 1000,
      0,
      0,
      0,
    ]);
  });
});
