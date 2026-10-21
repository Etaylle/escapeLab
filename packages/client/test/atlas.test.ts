import { describe, expect, it } from 'vitest';
import { DECOR_KINDS, ROOM_KINDS } from '@escapelab/core';
import {
  atlasLevel,
  ATLAS_LEVELS,
  newAtlas,
  sprite,
  spriteKey,
  type SpriteSpec,
} from '../src/world/atlas.js';
import { WALL_PROP_KINDS } from '../src/world/dress.js';
import { FLOOR_VARIANTS, FLOOR_S } from '../src/world/surfaces.js';
import { callsOf, fakeCanvas, type FakeCanvas } from './fakeCanvas.js';

/** An atlas baking on fake canvases, and the fakes it made, in order. */
function recordingAtlas() {
  const made: FakeCanvas[] = [];
  const atlas = newAtlas((width, height) => {
    const fake = fakeCanvas(width, height, `sprite ${made.length}`);
    made.push(fake);
    return fake.canvas;
  });
  return { atlas, made };
}

describe('the sprite atlas — every kind in every variant, baked once per zoom level', () => {
  it('keys a sprite by its sort, its kind, its variant and its light', () => {
    expect(spriteKey({ floor: 'archive', variant: 3, lit: true })).toBe('floor:archive:3:lit');
    expect(spriteKey({ floor: 'archive', variant: 3, lit: false })).toBe('floor:archive:3:dark');
    expect(spriteKey({ wall: 'server', mask: 5, lit: true, faceLit: false })).toBe(
      'wall:server:5:lit:dark',
    );
    const hung = { wall: 'server', mask: FLOOR_S, lit: false, faceLit: false } as const;
    expect(spriteKey({ ...hung, prop: { kind: 'rack', variant: 2 } })).toBe(
      'wall:server:4:dark:dark:rack2',
    );
    expect(spriteKey({ decor: 'core', variant: 0, lit: true })).toBe('decor:core:0:lit');
  });

  it('gives every kind and variant a key of its own', () => {
    const specs: SpriteSpec[] = [
      ...['plain' as const, ...ROOM_KINDS].flatMap((floor) =>
        Array.from({ length: FLOOR_VARIANTS }, (_, variant) => ({ floor, variant, lit: true })),
      ),
      ...WALL_PROP_KINDS.flatMap((kind) =>
        [0, 1, 2, 3].map((variant) => ({
          wall: 'plain' as const,
          mask: FLOOR_S,
          lit: true,
          faceLit: true,
          prop: { kind, variant },
        })),
      ),
      ...DECOR_KINDS.flatMap((decor) =>
        [0, 1, 2, 3].map((variant) => ({ decor, variant, lit: true })),
      ),
    ];
    expect(new Set(specs.map(spriteKey)).size).toBe(specs.length);
  });

  it('bakes a sprite on first use at its level, and hands the same canvas back after', () => {
    const { atlas, made } = recordingAtlas();
    const spec = { floor: 'lab', variant: 1, lit: true } as const;
    const first = sprite(atlas, 64, spec);
    const again = sprite(atlas, 64, spec);
    expect(again).toBe(first);
    // The sprite, and the grain for tiles of its size.
    expect(made).toHaveLength(2);
    expect([first.canvas.width, first.canvas.height]).toEqual([64, 64]);
    expect(sprite(atlas, 64, { ...spec, lit: false }).canvas).not.toBe(first.canvas);
    expect(made).toHaveLength(3);
  });

  it('grains every tile of a size with one grain, never reading a sprite’s pixels back', () => {
    const { atlas, made } = recordingAtlas();
    sprite(atlas, 32, { floor: 'lab', variant: 0, lit: true });
    sprite(atlas, 32, { wall: 'plain', mask: FLOOR_S, lit: false, faceLit: false });
    sprite(atlas, 48, { floor: 'lab', variant: 0, lit: true });
    expect([...atlas.grains.keys()]).toEqual([32, 48]);
    const grains = new Set<HTMLCanvasElement>(atlas.grains.values());
    const sprites = made.filter((fake) => !grains.has(fake.canvas));
    expect(sprites).toHaveLength(3);
    for (const fake of sprites) {
      const grain = atlas.grains.get(fake.canvas.width);
      expect(callsOf(fake.log, 'drawImage').map(([source]) => source)).toContain(grain);
    }
    const grainLogs = made.filter((fake) => grains.has(fake.canvas)).map((fake) => fake.log);
    expect(grainLogs.every((log) => callsOf(log, 'putImageData').length === 1)).toBe(true);
    expect(made.flatMap((fake) => callsOf(fake.log, 'getImageData'))).toEqual([]);
  });

  it('bakes a wall with a face two tiles tall, its shadow under it', () => {
    const { atlas } = recordingAtlas();
    const face = sprite(atlas, 48, { wall: 'plain', mask: FLOOR_S, lit: true, faceLit: true });
    const crown = sprite(atlas, 48, { wall: 'plain', mask: 2, lit: true, faceLit: true });
    expect([face.tall, face.canvas.height]).toEqual([2, 96]);
    expect([crown.tall, crown.canvas.height]).toEqual([1, 48]);
  });

  it('draws furniture from its tile’s centre, a wall’s prop on its face after the grain', () => {
    const { atlas, made } = recordingAtlas();
    sprite(atlas, 32, { decor: 'barrel', variant: 0, lit: true });
    const wall = { wall: 'plain', mask: FLOOR_S, lit: true, faceLit: true } as const;
    sprite(atlas, 32, { ...wall, prop: { kind: 'clock', variant: 0 } });
    expect(callsOf(made[0]?.log ?? [], 'setTransform')[0]).toEqual([32, 0, 0, 32, 16, 16]);
    const log = made[1]?.log ?? [];
    const grain = log.findIndex(
      (e) => e.kind === 'call' && e.name === 'drawImage' && e.args[0] === atlas.grains.get(32),
    );
    const hung = log.findIndex(
      (e, i) => i > grain && e.kind === 'call' && e.name === 'setTransform',
    );
    expect(grain).toBeGreaterThan(0);
    expect(hung).toBeGreaterThan(grain);
    expect(log[hung]).toMatchObject({ args: [32, 0, 0, 32, 0, 0] });
  });

  it('picks the level a zoom draws from: the first not much smaller, the largest at most', () => {
    expect(atlasLevel(100)).toBe(96);
    expect(atlasLevel(64)).toBe(64);
    expect(atlasLevel(70)).toBe(96);
    expect(atlasLevel(10)).toBe(16);
    expect(atlasLevel(1000)).toBe(ATLAS_LEVELS[ATLAS_LEVELS.length - 1]);
  });

  it('keeps the last two levels asked for: a third lets the oldest go', () => {
    const { atlas } = recordingAtlas();
    const spec = { floor: 'plain', variant: 0, lit: false } as const;
    sprite(atlas, 32, spec);
    sprite(atlas, 48, spec);
    sprite(atlas, 32, spec);
    sprite(atlas, 64, spec);
    expect([...atlas.levels.keys()]).toEqual([32, 64]);
  });
});
