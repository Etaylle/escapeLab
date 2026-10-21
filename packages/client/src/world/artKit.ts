import { newAtlas, spriteKey, type Atlas, type CanvasMaker, type SpriteSpec } from './atlas.js';
import type { Baked } from './baked.js';
import { dressMap, seedOf, type DressMap, type Dressing } from './dress.js';
import { newParticles, type Particles } from './particles.js';
import { hasFace } from './surfaces.js';

/**
 * What the art keeps between frames for one world (RenderKit.art): the
 * dressing of the map on show and the sprites its tiles are drawn with,
 * the atlas they are baked into, the particles, and the faint lights' glow
 * as last baked. Worked out anew only when the map or the mission changes.
 */

/** A sprite to draw, and its key in the atlas, worked out once. */
export interface Keyed {
  key: string;
  spec: SpriteSpec;
}

/**
 * The sprites a tile is drawn with, by its light (spriteFor): a floor's and a
 * plain wall's dark and lit; a wall with a face also by the light of the
 * floor below, which its face takes.
 */
export interface TileSprites {
  byLight: readonly Keyed[];
  /** a wall showing its face: four sprites, crown light by face light */
  face: boolean;
}

/** The dressing of a map and the sprites of its tiles, row by row. */
export interface Dressed {
  dressing: Dressing;
  tiles: (TileSprites | null)[];
}

export interface ArtKit {
  /** the map last dressed, what it was dressed for, and its dressing */
  dressed: { map: DressMap; key: string; dressed: Dressed } | null;
  atlas: Atlas;
  particles: Particles;
  /** the faint lights' glow as last baked, and what it was baked for */
  pools: { key: string; baked: Baked | null } | null;
  /** each pulsing light's glow at full strength, by the light and the doors shut */
  livePools: Map<string, Baked | null>;
  /** where each light may fall, as a path in tiles, by its spot, its reach and the doors shut */
  clips: Map<string, Path2D>;
}

/** A fresh kit baking its sprites on canvases from `make` (the DOM's by default). */
export function artKit(make?: CanvasMaker): ArtKit {
  return {
    dressed: null,
    atlas: newAtlas(make),
    particles: newParticles(),
    pools: null,
    livePools: new Map(),
    clips: new Map(),
  };
}

const keyed = (spec: SpriteSpec): Keyed => ({ key: spriteKey(spec), spec });

/** The sprite of `sprites` for a tile lit or not, whose floor below is lit or not. */
export function spriteFor(sprites: TileSprites, lit: boolean, belowLit: boolean): Keyed {
  const at = sprites.face ? Number(lit) * 2 + Number(belowLit) : Number(lit);
  return sprites.byLight[at] ?? sprites.byLight[0] ?? keyed({ floor: 'plain', variant: 0, lit });
}

/** The sprites every tile of a dressed map is drawn with, a wall's prop baked into it. */
function tileSprites(map: DressMap, dressing: Dressing): (TileSprites | null)[] {
  const hung = new Map(
    dressing.props.map((p) => [p.y * map.width + p.x, { kind: p.kind, variant: p.variant }]),
  );
  return dressing.kinds.map((kind, i) => {
    const tile = map.tiles[Math.floor(i / map.width)]?.charAt(i % map.width);
    if (tile === '.') {
      const variant = dressing.floor[i] ?? 0;
      const byLight = [false, true].map((lit) => keyed({ floor: kind, variant, lit }));
      return { byLight, face: false };
    }
    if (tile === '#') {
      const mask = dressing.walls[i] ?? 0;
      const face = hasFace(mask);
      const wall = face ? kind : 'plain';
      const lights = face ? [false, true] : [false];
      const prop = hung.get(i);
      const byLight = [false, true].flatMap((lit) =>
        lights.map((below) =>
          keyed({
            wall,
            mask,
            lit,
            faceLit: face ? below : lit,
            ...(prop === undefined ? {} : { prop }),
          }),
        ),
      );
      return { byLight, face };
    }
    return null;
  });
}

/** What a dressing depends on, as text: two maps alike dress alike. */
function dressKey(map: DressMap, missionId: string): string {
  const doors = map.doors.map((d) => [d.x, d.y]);
  return JSON.stringify([missionId, map.tiles, map.labels, doors, map.lamps, map.decor]);
}

/**
 * The dressing of `map` for the mission `missionId`, from the kit where it
 * was worked out for this map before — by the same object, or one alike.
 */
export function dressedFor(art: ArtKit, map: DressMap, missionId: string): Dressed {
  const known = art.dressed;
  if (known !== null && known.map === map) {
    return known.dressed;
  }
  const key = dressKey(map, missionId);
  if (known !== null && known.key === key) {
    art.dressed = { map, key, dressed: known.dressed };
    return known.dressed;
  }
  const dressing = dressMap(map, seedOf(missionId));
  const dressed = { dressing, tiles: tileSprites(map, dressing) };
  art.dressed = { map, key, dressed };
  return dressed;
}
