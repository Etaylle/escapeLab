import { canSee, type MapView } from '@escapelab/core';

/**
 * The lab with its power on, as the cold open shows the whole of it before
 * the blackout (coldOpen.ts) and as a room lit again by a solved station
 * shows it after: the floor and walls in their lit colours (art.ts), and
 * over them the soft pools of the ceiling lights, baked once per map into a
 * layer the world adds on top.
 */

type Spot = { x: number; y: number };
type PowerMap = Pick<MapView, 'tiles' | 'width' | 'height'>;

/** A ceiling light every this many tiles, both ways. */
const FIXTURE_SPACING = 3;
/** How far a ceiling light reaches, in tiles; walls stop it. */
export const POOL_REACH = 3.2;
/** The warm light of the lamps, and how strong it falls on the floor between them and under one. */
const WARM = [255, 214, 168] as const;
const WASH_ALPHA = 0.04;
const POOL_ALPHA = 0.16;

const STEPS = [
  [0, 0],
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
] as const;

/**
 * Where the ceiling lights hang: on a grid every FIXTURE_SPACING tiles,
 * each point moved onto the floor beside it where it falls on a wall, and
 * left out where there is none.
 */
export function ceilingLights(map: PowerMap): Spot[] {
  const floor = (x: number, y: number): boolean => map.tiles[y]?.charAt(x) === '.';
  const lights: Spot[] = [];
  for (let gy = 2; gy < map.height; gy += FIXTURE_SPACING) {
    for (let gx = 2; gx < map.width; gx += FIXTURE_SPACING) {
      const step = STEPS.find(([dx, dy]) => floor(gx + dx, gy + dy));
      if (step !== undefined) {
        lights.push({ x: gx + step[0] + 0.5, y: gy + step[1] + 0.5 });
      }
    }
  }
  return lights;
}

/**
 * How brightly the ceiling lights light each tile, 0 to 1, row by row: a
 * floor tile by every light that can see its middle, the more the nearer;
 * a wall not at all — drawn smoothly, the light softens onto its edge.
 */
export function lightLevels(map: PowerMap): number[][] {
  const lights = ceilingLights(map);
  const none = new Set<string>();
  return map.tiles.map((row, y) =>
    [...row].map((tile, x) => {
      if (tile !== '.') {
        return 0;
      }
      const middle = { x: x + 0.5, y: y + 0.5 };
      const sum = lights.reduce((total, light) => {
        const away = Math.hypot(light.x - middle.x, light.y - middle.y);
        if (away >= POOL_REACH || !canSee(map, light, middle, none)) {
          return total;
        }
        return total + (1 - away / POOL_REACH) ** 1.5;
      }, 0);
      return Math.min(1, sum);
    }),
  );
}

/**
 * The ceiling lights' pools for a map, one pixel a tile: a faint warm wash
 * over the floor and more under every light. Drawn scaled up over the
 * world, smoothly, with 'lighter'.
 */
export function warmLayer(map: PowerMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.width;
  canvas.height = map.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('power: canvas.getContext("2d") returned null; cannot bake the lights.');
  }
  const image = ctx.createImageData(map.width, map.height);
  lightLevels(map).forEach((row, y) => {
    row.forEach((level, x) => {
      const i = (y * map.width + x) * 4;
      const floor = map.tiles[y]?.charAt(x) === '.';
      image.data[i] = WARM[0];
      image.data[i + 1] = WARM[1];
      image.data[i + 2] = WARM[2];
      image.data[i + 3] = floor ? Math.round(255 * (WASH_ALPHA + POOL_ALPHA * level)) : 0;
    });
  });
  ctx.putImageData(image, 0, 0);
  return canvas;
}
