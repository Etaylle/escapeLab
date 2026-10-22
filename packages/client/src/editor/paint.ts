import { CREW_COLORS } from '@escapelab/core';
import {
  drawDoor,
  drawExitHatch,
  drawManualObject,
  drawPinnedNote,
  drawPlate,
  drawScientist,
  drawSign,
  drawStation,
  worldText,
  type WorldText,
} from '../world/art.js';
import { atlasLevel, sprite, type Atlas, type WallSpec } from '../world/atlas.js';
import { decorVariant, drawDecor } from '../world/decor.js';
import { dressMap, seedOf, type DressMap, type Dressing } from '../world/dress.js';
import { drawCarryable, drawDropZone, drawDroneBody, drawSabotagePanel } from '../world/hazards.js';
import { noteMount } from '../world/notes.js';
import { hasFace, type FloorKind } from '../world/surfaces.js';
import { customIdOf, type Draft, type DraftDrone, type Tile } from './draft.js';
import { mapSize, tilesOf, type Pending, type Ref, type Tool } from './tools.js';

/**
 * The editor's map, drawn with the game's own art: its rooms dressed as the
 * game dresses them — each kind of room its floor, its walls and what hangs
 * on them — its furniture and props, a start as a member of the crew in
 * their colour, all in the lit lab's colours.
 * On top the editor's own marks: a faint grid, drone routes, the line from
 * an item to its drop-off, the selection (teal), the tiles a finding points
 * at (red) and the tile under the pointer. A frame is drawn whole whenever
 * anything changes; nothing moves on its own.
 */

/** What the map shows. */
export interface Scene {
  draft: Draft;
  selection: Ref | null;
  /** the tiles the picked finding points at */
  highlight: readonly Tile[];
  hover: Tile | null;
  tool: Tool;
  pending: Pending | null;
}

export interface Textures {
  /** a plain floor and wall: the brushes' glyphs */
  floor: CanvasImageSource;
  wall: CanvasImageSource;
  /** the game's sprites: the dressed floors, walls and wall props */
  atlas: Atlas;
}

const MONO = 'ui-monospace, Menlo, monospace';
const VOID = '#04070a';
/** Wall that touches no floor: solid rock, as dark as the game leaves it, so rooms stand out. */
const ROCK = '#0a0f15';
const TEAL = '#2dd4bf';
const DANGER = '#f87171';
const ROUTE = 'rgba(251, 191, 36, 0.75)';
const DELIVERY = 'rgba(96, 165, 250, 0.7)';
/** Props are drawn as they look in a run, still: no pulse, every glow at rest. */
const STILL = 0.3;

type Ctx = CanvasRenderingContext2D;

/** How the map is drawn: device pixels a tile, and device pixels a CSS pixel. */
interface Zoom {
  scale: number;
  dpr: number;
}

function at(ctx: Ctx, x: number, y: number, draw: () => void): void {
  ctx.save();
  ctx.translate(x, y);
  draw();
  ctx.restore();
}

/** Text `px` CSS pixels high at a tile point, with a dark halo, whatever the zoom. */
function screenText(
  ctx: Ctx,
  text: string,
  point: Tile,
  zoom: Zoom,
  px: number,
  color: string,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `bold ${Math.round(px * zoom.dpr)}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 * zoom.dpr;
  ctx.strokeStyle = 'rgba(3, 6, 10, 0.9)';
  ctx.strokeText(text, point.x * zoom.scale, point.y * zoom.scale);
  ctx.fillStyle = color;
  ctx.fillText(text, point.x * zoom.scale, point.y * zoom.scale);
  ctx.restore();
}

/** Whether a tile or any of its eight neighbours is floor. */
function nearFloor(tiles: readonly string[], x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tiles[y + dy]?.charAt(x + dx) === '.') {
        return true;
      }
    }
  }
  return false;
}

/** The draft's map as the dressing reads it: its doors shut, its lamps, its furniture. */
function dressMapOf(draft: Draft): DressMap {
  const { width, height } = mapSize(draft);
  const map = draft.map;
  return {
    width,
    height,
    tiles: map.tiles,
    labels: map.labels.map((l) => ({
      text: l.text,
      x: l.x,
      y: l.y,
      ...(l.kind === '' ? {} : { kind: l.kind }),
    })),
    doors: map.doors.map((d) => ({ id: d.id, x: d.x, y: d.y, open: false })),
    lamps: map.lamps ?? [],
    decor: map.decor.map((d) => ({
      kind: d.kind,
      x: d.x,
      y: d.y,
      ...(d.variant === null ? {} : { variant: d.variant }),
    })),
  };
}

/** The draft dressed as the game will dress it, seeded by the id it is saved under. */
function dressingOf(draft: Draft): Dressing {
  return dressMap(dressMapOf(draft), seedOf(customIdOf(draft.title)));
}

/**
 * Floor and the walls round it as the game dresses them, from its sprites;
 * deeper wall as rock; the void dark. Floors first, then the walls with their
 * shadows over the floor below, then what hangs on the walls.
 */
function paintTiles(ctx: Ctx, draft: Draft, textures: Textures, zoom: Zoom): void {
  const tiles = draft.map.tiles;
  const dressing = dressingOf(draft);
  const level = atlasLevel(zoom.scale);
  const { atlas } = textures;
  ctx.fillStyle = ROCK;
  for (const walls of [false, true]) {
    tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const i = y * dressing.width + x;
        const kind = dressing.kinds[i] ?? 'plain';
        const tile = row.charAt(x);
        if (!walls && tile === '.') {
          const variant = dressing.floor[i] ?? 0;
          const floor = sprite(atlas, level, { floor: kind, variant, lit: true });
          ctx.drawImage(floor.canvas, x, y, 1, 1);
        } else if (walls && tile === '#' && nearFloor(tiles, x, y)) {
          const wall = sprite(atlas, level, wallSpec(dressing, kind, i));
          ctx.drawImage(wall.canvas, x, y, 1, wall.tall);
        } else if (walls && tile === '#') {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });
  }
}

/** The sprite of the wall at `i`: its crown, its face in its room's kind, what hangs on it. */
function wallSpec(dressing: Dressing, kind: FloorKind, i: number): WallSpec {
  const mask = dressing.walls[i] ?? 0;
  const hung = dressing.props.find((p) => p.y * dressing.width + p.x === i);
  const wall = { wall: hasFace(mask) ? kind : 'plain', mask, lit: true, faceLit: true } as const;
  return hung === undefined ? wall : { ...wall, prop: { kind: hung.kind, variant: hung.variant } };
}

function paintGrid(ctx: Ctx, width: number, height: number, scale: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (let x = 1; x < width; x++) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 1; y < height; y++) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** A door bar runs across when walls (or doors) stand left and right of it, as in a run. */
function horizontal(draft: Draft, x: number, y: number): boolean {
  const barrier = (bx: number, by: number): boolean =>
    draft.map.tiles[by]?.charAt(bx) === '#' ||
    draft.map.doors.some((d) => d.x === bx && d.y === by);
  return barrier(x - 1, y) && barrier(x + 1, y);
}

function paintFixtures(ctx: Ctx, draft: Draft, text: WorldText): void {
  const map = draft.map;
  for (const piece of map.decor) {
    const variant = piece.variant ?? decorVariant({ x: piece.x, y: piece.y });
    at(ctx, piece.x + 0.5, piece.y + 0.5, () => drawDecor(ctx, piece.kind, variant, true));
  }
  for (const plate of map.plates) {
    const camera = map.drones.some((d) => d.extra['frozenByPlate'] === plate.id);
    const look = { pressed: false, label: plate.label, camera, text };
    at(ctx, plate.x + 0.5, plate.y + 0.5, () => drawPlate(ctx, look));
  }
  for (const door of map.doors) {
    const look = { openT: 0, horizontal: horizontal(draft, door.x, door.y) };
    at(ctx, door.x + 0.5, door.y + 0.5, () => drawDoor(ctx, look));
  }
  for (const station of map.stations) {
    const look = { status: 'armed' as const, pulse: STILL, console: station.console ?? null };
    at(ctx, station.x + 0.5, station.y + 0.5, () => drawStation(ctx, look));
  }
  for (const source of map.manuals) {
    source.spots.forEach((spot, i) => {
      // Each run draws one spot; the others stand fainter, as candidates.
      ctx.save();
      ctx.globalAlpha = i === 0 ? 1 : 0.55;
      const look = { kind: source.kind, label: source.label, active: false, opened: false };
      at(ctx, spot.x + 0.5, spot.y + 0.5, () => drawManualObject(ctx, { ...look, pulse: 0, text }));
      ctx.restore();
    });
  }
}

function paintMarks(ctx: Ctx, draft: Draft, text: WorldText): void {
  const map = draft.map;
  const sign = map.edgeworkSign;
  if (sign !== undefined) {
    const look = { label: 'LABORKENNUNG', seen: false, pulse: STILL, text };
    at(ctx, sign.x + 0.5, sign.y + 0.5, () => drawSign(ctx, look));
  }
  const exit = map.exit;
  if (exit !== undefined) {
    at(ctx, exit.x + 0.5, exit.y + 0.5, () => drawExitHatch(ctx, { open: 1, pulse: STILL }));
  }
  for (const panel of map.sabotage?.panels ?? []) {
    at(ctx, panel.x + 0.5, panel.y + 0.5, () => drawSabotagePanel(ctx, false, STILL));
  }
  for (const note of map.notes) {
    // Where nobody could read it, it lies in its tile's middle for the validator to point at.
    const mount = noteMount(map, note) ?? { x: note.x + 0.5, y: note.y + 0.5, facing: null };
    const look = { facing: mount.facing, read: true, pulse: STILL };
    at(ctx, mount.x, mount.y, () => drawPinnedNote(ctx, look));
  }
  for (const item of map.items) {
    const zone = item.deliverTo;
    if (zone !== undefined) {
      at(ctx, zone.x + 0.5, zone.y + 0.5, () => drawDropZone(ctx, false, STILL));
      dashed(ctx, [item, zone], DELIVERY, false);
    }
    const look = { label: item.label, pulse: STILL, carried: false, text };
    at(ctx, item.x + 0.5, item.y + 0.5, () => drawCarryable(ctx, look));
  }
}

/** A dashed line through tile centres; `loop` closes it back to the first. */
function dashed(ctx: Ctx, tiles: readonly Tile[], color: string, loop: boolean): void {
  const [first, ...rest] = tiles;
  if (first === undefined) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.06;
  ctx.setLineDash([0.18, 0.12]);
  ctx.beginPath();
  ctx.moveTo(first.x + 0.5, first.y + 0.5);
  for (const tile of rest) {
    ctx.lineTo(tile.x + 0.5, tile.y + 0.5);
  }
  if (loop) {
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}

function paintDrone(ctx: Ctx, drone: DraftDrone, zoom: Zoom): void {
  const [first, second] = drone.waypoints;
  if (first === undefined) {
    return;
  }
  dashed(ctx, drone.waypoints, ROUTE, drone.waypoints.length > 2);
  drone.waypoints.forEach((point, i) => {
    screenText(ctx, String(i + 1), { x: point.x + 0.82, y: point.y + 0.2 }, zoom, 10, '#fcd34d');
  });
  const facing = second === undefined ? 0 : Math.atan2(second.y - first.y, second.x - first.x);
  const look = { x: first.x, y: first.y, facing, range: 0, halfAngleDeg: 0 };
  at(ctx, first.x + 0.5, first.y + 0.5, () =>
    drawDroneBody(ctx, { ...look, alerted: false, frozen: false }, STILL),
  );
}

/** A start: a member of the crew in the colour that start's player may get, numbered. */
function paintSpawns(ctx: Ctx, draft: Draft, text: WorldText): void {
  draft.map.spawns.forEach((spawn, i) => {
    const look = {
      color: CREW_COLORS[i % CREW_COLORS.length] ?? TEAL,
      name: `START ${i + 1}`,
      facing: Math.PI / 2,
      moving: false,
      walkPhase: 0,
      isYou: false,
      connected: true,
      text,
    };
    at(ctx, spawn.x + 0.5, spawn.y + 0.86, () => drawScientist(ctx, look));
  });
}

function paintRoomNames(ctx: Ctx, draft: Draft, zoom: Zoom): void {
  for (const label of draft.map.labels) {
    const centre = { x: label.x + 0.5, y: label.y + 0.5 };
    screenText(ctx, label.text.toUpperCase(), centre, zoom, 13, '#a5b4c3');
  }
}

function outline(ctx: Ctx, tile: Tile, color: string, width: number, dash: number[]): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.strokeRect(tile.x + width / 2, tile.y + width / 2, 1 - width, 1 - width);
  ctx.restore();
}

/** The selection in teal, the tiles a finding points at in red. */
function paintOverlay(ctx: Ctx, scene: Scene): void {
  const selected = scene.selection === null ? [] : tilesOf(scene.draft, scene.selection);
  for (const tile of selected) {
    outline(ctx, tile, TEAL, 0.07, [0.2, 0.1]);
  }
  for (const tile of scene.highlight) {
    ctx.save();
    ctx.fillStyle = 'rgba(248, 113, 113, 0.16)';
    ctx.fillRect(tile.x, tile.y, 1, 1);
    ctx.restore();
    outline(ctx, tile, DANGER, 0.1, []);
  }
  if (scene.hover !== null) {
    paintHover(ctx, scene, scene.hover);
  }
}

/** The tile under the pointer: tinted with a brush's material, dashed while a press is pending. */
function paintHover(ctx: Ctx, scene: Scene, hover: Tile): void {
  const tint = BRUSH_TINT[scene.tool];
  if (tint !== undefined) {
    ctx.save();
    ctx.fillStyle = tint;
    ctx.fillRect(hover.x, hover.y, 1, 1);
    ctx.restore();
  }
  if (scene.pending === null) {
    outline(ctx, hover, 'rgba(219, 231, 240, 0.7)', 0.04, []);
  } else {
    outline(ctx, hover, '#60a5fa', 0.06, [0.12, 0.08]);
  }
}

const BRUSH_TINT: Readonly<Partial<Record<Tool, string>>> = {
  floor: 'rgba(45, 212, 191, 0.22)',
  wall: 'rgba(10, 15, 20, 0.55)',
};

/**
 * Draws the scene on a canvas `tilePx` CSS pixels a tile, at `dpr` device
 * pixels a CSS pixel; the canvas is sized to the map already.
 */
export function paintScene(
  ctx: Ctx,
  scene: Scene,
  tilePx: number,
  dpr: number,
  textures: Textures,
): void {
  const { width, height } = mapSize(scene.draft);
  const scale = tilePx * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = VOID;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  const text = worldText(scale, dpr);
  const zoom = { scale, dpr };
  paintTiles(ctx, scene.draft, textures, zoom);
  paintGrid(ctx, width, height, scale);
  paintFixtures(ctx, scene.draft, text);
  paintMarks(ctx, scene.draft, text);
  for (const drone of scene.draft.map.drones) {
    paintDrone(ctx, drone, zoom);
  }
  paintSpawns(ctx, scene.draft, text);
  paintRoomNames(ctx, scene.draft, zoom);
  paintOverlay(ctx, scene);
}

/** Props that fill little of their tile, drawn larger on their button. */
const GLYPH_ZOOM: Readonly<Partial<Record<Tool, number>>> = {
  door: 1.5,
  plate: 1.45,
  sign: 1.35,
  item: 1.35,
  drone: 1.7,
  exit: 1.15,
  note: 1.6,
};

type Glyph = (ctx: Ctx, textures: Textures) => void;

/** A prop drawn in the middle of its button, a little low, as it stands in its tile. */
const centred =
  (draw: (ctx: Ctx) => void): Glyph =>
  (ctx) =>
    at(ctx, 0.5, 0.52, () => draw(ctx));

const STILL_DRONE = {
  x: 0,
  y: 0,
  facing: 0,
  range: 0,
  halfAngleDeg: 0,
  alerted: false,
  frozen: false,
};

const GLYPHS: Readonly<Record<Tool, Glyph>> = {
  select: (ctx) => paintGlyphMark(ctx, 'select'),
  floor: (ctx, textures) => ctx.drawImage(textures.floor, 0, 0, 1, 1),
  wall: (ctx, textures) => ctx.drawImage(textures.wall, 0, 0, 1, 1),
  spawn: (ctx) =>
    at(ctx, 0.5, 0.92, () =>
      drawScientist(ctx, {
        color: TEAL,
        name: '',
        facing: Math.PI / 2,
        moving: false,
        walkPhase: 0,
        isYou: false,
        connected: true,
      }),
    ),
  door: centred((ctx) => drawDoor(ctx, { openT: 0, horizontal: true })),
  plate: centred((ctx) => drawPlate(ctx, { pressed: false, label: '', camera: false })),
  station: centred((ctx) => drawStation(ctx, { status: 'armed', pulse: STILL, console: null })),
  source: centred((ctx) =>
    drawManualObject(ctx, { kind: 'book', label: '', active: false, opened: false, pulse: 0 }),
  ),
  sign: centred((ctx) => drawSign(ctx, { label: '', seen: false, pulse: STILL })),
  label: (ctx) => paintGlyphMark(ctx, 'label'),
  exit: centred((ctx) => drawExitHatch(ctx, { open: 1, pulse: STILL })),
  item: centred((ctx) => drawCarryable(ctx, { label: '', pulse: STILL, carried: false })),
  drone: centred((ctx) => drawDroneBody(ctx, STILL_DRONE, STILL)),
  decor: centred((ctx) => drawDecor(ctx, 'shelf', 0, true)),
  note: (ctx) =>
    at(ctx, 0.5, 0.92, () =>
      drawPinnedNote(ctx, { facing: Math.PI / 2, read: true, pulse: STILL }),
    ),
};

/** A tool's picture on its button: the prop it places, as the map shows it. */
export function paintToolGlyph(ctx: Ctx, tool: Tool, sizePx: number, textures: Textures): void {
  ctx.setTransform(sizePx, 0, 0, sizePx, 0, 0);
  ctx.clearRect(0, 0, 1, 1);
  const zoom = GLYPH_ZOOM[tool] ?? 1;
  ctx.translate(0.5, 0.5);
  ctx.scale(zoom, zoom);
  ctx.translate(-0.5, -0.5);
  GLYPHS[tool](ctx, textures);
}

/** The two tools with no prop: a pointer for selecting, letters for a room name. */
function paintGlyphMark(ctx: Ctx, tool: 'label' | 'select'): void {
  ctx.save();
  ctx.fillStyle = '#dbe7f0';
  ctx.strokeStyle = '#05080b';
  ctx.lineWidth = 0.05;
  if (tool === 'select') {
    ctx.beginPath();
    ctx.moveTo(0.3, 0.18);
    ctx.lineTo(0.3, 0.78);
    ctx.lineTo(0.45, 0.63);
    ctx.lineTo(0.56, 0.86);
    ctx.lineTo(0.66, 0.81);
    ctx.lineTo(0.55, 0.59);
    ctx.lineTo(0.75, 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.scale(1 / 32, 1 / 32);
    ctx.font = `bold 15px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ABC', 16, 17);
  }
  ctx.restore();
}
