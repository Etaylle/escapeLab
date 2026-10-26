import { isHorizontalDoor } from '../doors.js';
import { carriedItem, coversArmed } from '../interact.js';
import {
  ALARM,
  AMBER,
  css,
  DONE_GREEN,
  INK,
  LABEL,
  lift,
  mix,
  READ_BLUE,
  rgba,
  sink,
  STEEL,
  TEAL,
  WHITE,
} from '../palette.js';
import type { Box } from '../viewport.js';
import { FALLBACK_COLOR, type Frame, type MinimapLayout, type WorldMap } from './frame.js';

/**
 * What the canvas draws of the HUD: the corner minimap — the layout, the
 * doors as the view knows them, the stations and sources, the goal pulsing,
 * the exit glowing once unlocked, and everyone's dot — over the world and its
 * light, gone while the run ends on screen. The screen's text keeps off it.
 */

/** The dark frame round the minimap's map, CSS pixels. */
const MINIMAP_FRAME = 5;

/** The minimap's blue-grey: steel with a cold cast. */
const CHART = mix(STEEL, READ_BLUE, 0.2);
const C = {
  panel: css(INK),
  rim: css(sink(CHART, 0.6)),
  floor: css(sink(CHART, 0.76)),
  decor: css(sink(CHART, 0.62)),
  doorOpen: css(sink(TEAL, 0.78)),
  doorShut: css(AMBER),
  plateIdle: css(sink(CHART, 0.55)),
  teal: css(TEAL),
  done: css(sink(TEAL, 0.5)),
  locked: css(sink(CHART, 0.66)),
  read: css(READ_BLUE),
  unread: css(sink(READ_BLUE, 0.6)),
  sign: css(lift(AMBER, 0.2)),
  exit: css(DONE_GREEN),
  frozen: css(sink(LABEL, 0.1)),
  alerted: css(ALARM),
  patrol: css(AMBER),
  you: css(WHITE),
} as const;

/**
 * Where the corner minimap goes: top right, below the objective bar — the
 * clock, and a radio line while one is up (`insets.top`, CSS pixels). It
 * scales with the window, but never so small it stops being readable or so
 * large it eats a phone screen.
 */
export function minimapLayout(
  map: WorldMap,
  w: number,
  h: number,
  dpr: number,
  insets: { top: number; bottom: number },
): MinimapLayout {
  const targetCss = Math.min(190, Math.max(110, (w / dpr) * 0.16));
  const oy = Math.max(84, insets.top) * dpr;
  // A short window has less room below the clock than beside it, and both
  // the minimap and the control cluster hug the right edge.
  const roomBelow = (h - oy - (insets.bottom + 2 * MINIMAP_FRAME) * dpr) / map.height;
  const fit = Math.round((targetCss * dpr) / map.width);
  const cell = Math.max(3, Math.min(fit, Math.floor(roomBelow)));
  const mw = map.width * cell;
  const mh = map.height * cell;
  return { ox: w - mw - 14 * dpr, oy, cell, mw, mh };
}

/** What the minimap covers, its frame included: the arrows and room names keep off it. */
export function minimapBox({ ox, oy, mw, mh }: MinimapLayout, dpr: number): Box {
  const edge = MINIMAP_FRAME * dpr;
  return { left: ox - edge, top: oy - edge, right: ox + mw + edge, bottom: oy + mh + edge };
}

export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const layout = frame.minimap;
  if (layout === null || frame.ending !== null) {
    return;
  }
  drawPanel(ctx, layout, frame.viewport.dpr);
  drawFloor(ctx, frame.map, layout);
  drawDecor(ctx, frame.map, layout);
  drawDoors(ctx, frame.map, layout);
  drawPlates(ctx, frame.map, layout);
  drawStationsAndSources(ctx, frame.map, layout);
  drawLandmarks(ctx, frame, layout);
  drawGoal(ctx, frame, layout);
  drawDrones(ctx, frame, layout);
  drawCrew(ctx, frame, layout);
  ctx.globalAlpha = 1;
}

/** A goal on the minimap: where, in tiles — a tile's middle — and in the goal's colour. */
export interface GoalDot {
  x: number;
  y: number;
  color: string;
}

/**
 * What the minimap points at, as the goal line has it: with a part in this player's hands,
 * where it goes — a drop-off, or for a key the cabinet it opens, a source — once the view
 * names the place; else the station up next, at both its consoles where it has two. Nothing
 * while the hatch stands open — the exit glows instead — and nothing the view keeps back.
 */
export function minimapGoal(map: WorldMap, youId: string): GoalDot[] {
  if (map.exit !== null && map.exit.open) {
    return [];
  }
  const goal = carriedItem(map, youId)?.deliverTo ?? null;
  if (goal !== null) {
    return [{ x: goal.x + 0.5, y: goal.y + 0.5, color: C.read }];
  }
  return map.stations
    .filter((station) => station.status === 'armed')
    .map((station) => ({ x: station.x + 0.5, y: station.y + 0.5, color: C.teal }));
}

/**
 * The goal's dots, pulsing: a ring swelling out past its cell and fading as it goes, over a
 * dot rimmed dark, so that it shows on a station's own teal cell. Under reduced motion the
 * ring holds still.
 */
function drawGoal(ctx: CanvasRenderingContext2D, frame: Frame, layout: MinimapLayout): void {
  const { ox, oy, cell } = layout;
  const { dpr } = frame.viewport;
  const beat = frame.reduced ? 0.4 : frame.pulse;
  for (const dot of minimapGoal(frame.map, frame.youId)) {
    const cx = ox + dot.x * cell;
    const cy = oy + dot.y * cell;
    ctx.strokeStyle = dot.color;
    ctx.lineWidth = Math.max(dpr, cell * 0.18);
    ctx.globalAlpha = 0.9 - 0.6 * beat;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * (0.75 + 0.5 * beat), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = dot.color;
    ctx.strokeStyle = C.panel;
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** The minimap's dark panel and its rim. */
function drawPanel(ctx: CanvasRenderingContext2D, layout: MinimapLayout, dpr: number): void {
  const { left, top, right, bottom } = minimapBox(layout, dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.86;
  ctx.fillStyle = C.panel;
  ctx.strokeStyle = C.rim;
  ctx.lineWidth = dpr;
  ctx.beginPath();
  ctx.roundRect(left, top, right - left, bottom - top, 6 * dpr);
  ctx.fill();
  ctx.stroke();
}

/** A cell for every floor tile. */
function drawFloor(ctx: CanvasRenderingContext2D, map: WorldMap, layout: MinimapLayout): void {
  const { ox, oy, cell } = layout;
  ctx.fillStyle = C.floor;
  for (let ty = 0; ty < map.height; ty++) {
    const row = map.tiles[ty] ?? '';
    for (let tx = 0; tx < map.width; tx++) {
      if (row.charAt(tx) === '.') {
        ctx.fillRect(ox + tx * cell, oy + ty * cell, cell, cell);
      }
    }
  }
}

/** The furniture: a darker cell inset in the floor, solid as it is in the lab. */
function drawDecor(ctx: CanvasRenderingContext2D, map: WorldMap, layout: MinimapLayout): void {
  const { ox, oy, cell } = layout;
  ctx.fillStyle = C.decor;
  for (const piece of map.decor) {
    const inset = cell / 6;
    const size = cell - 2 * inset;
    ctx.fillRect(ox + piece.x * cell + inset, oy + piece.y * cell + inset, size, size);
  }
}

/** How thick a shut door's bar is, and an open one's jambs, against a cell. */
const DOOR_BAR = 0.4;
const DOOR_JAMB = 0.2;

/**
 * The doors as the view knows them now: an open one a gap in its wall — its floor, drawn
 * with the rest, between two jambs — and a shut one an amber bar across the doorway, along
 * its wall.
 */
function drawDoors(ctx: CanvasRenderingContext2D, map: WorldMap, layout: MinimapLayout): void {
  const { ox, oy, cell } = layout;
  for (const door of map.doors) {
    const x = ox + door.x * cell;
    const y = oy + door.y * cell;
    // A wall running left to right: the way through goes up and down.
    const along = isHorizontalDoor(map, door);
    if (door.open) {
      const jamb = Math.max(1, cell * DOOR_JAMB);
      ctx.fillStyle = C.doorOpen;
      if (along) {
        ctx.fillRect(x, y, jamb, cell);
        ctx.fillRect(x + cell - jamb, y, jamb, cell);
      } else {
        ctx.fillRect(x, y, cell, jamb);
        ctx.fillRect(x, y + cell - jamb, cell, jamb);
      }
    } else {
      const bar = Math.max(2, cell * DOOR_BAR);
      ctx.fillStyle = C.doorShut;
      if (along) {
        ctx.fillRect(x, y + (cell - bar) / 2, cell, bar);
      } else {
        ctx.fillRect(x + (cell - bar) / 2, y, bar, cell);
      }
    }
  }
}

/** Plates, teal while pressed, half a cell. */
function drawPlates(ctx: CanvasRenderingContext2D, map: WorldMap, layout: MinimapLayout): void {
  const { ox, oy, cell } = layout;
  for (const plate of map.plates) {
    ctx.fillStyle = plate.pressed ? C.teal : C.plateIdle;
    ctx.fillRect(
      ox + plate.x * cell + cell / 4,
      oy + plate.y * cell + cell / 4,
      cell / 2,
      cell / 2,
    );
  }
}

/** Stations, the armed one bright, and the sources, bright where they print its rules. */
function drawStationsAndSources(
  ctx: CanvasRenderingContext2D,
  map: WorldMap,
  { ox, oy, cell }: MinimapLayout,
): void {
  for (const station of map.stations) {
    ctx.fillStyle =
      station.status === 'armed' ? C.teal : station.status === 'done' ? C.done : C.locked;
    ctx.fillRect(ox + station.x * cell, oy + station.y * cell, cell, cell);
  }
  for (const manual of map.manuals) {
    ctx.fillStyle = coversArmed(map, manual) ? C.read : C.unread;
    ctx.fillRect(ox + manual.x * cell, oy + manual.y * cell, cell, cell);
  }
}

/** The Laborkennung until read, and the exit, green and glowing once unlocked. */
function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  { ox, oy, cell }: MinimapLayout,
): void {
  const { map } = frame;
  // Half a cell, so it does not pass for a closed door; gone once read.
  if (map.edgeworkSign !== null && !frame.signSeen) {
    const { x, y } = map.edgeworkSign;
    ctx.fillStyle = C.sign;
    ctx.fillRect(ox + x * cell + cell / 4, oy + y * cell + cell / 4, cell / 2, cell / 2);
  }
  if (map.exit !== null) {
    const x = ox + map.exit.x * cell;
    const y = oy + map.exit.y * cell;
    if (map.exit.open) {
      drawExitGlow(ctx, frame, x + cell / 2, y + cell / 2, cell);
    }
    ctx.fillStyle = map.exit.open ? C.exit : C.locked;
    ctx.fillRect(x, y, cell, cell);
  }
}

/**
 * The unlocked exit's glow round (cx, cy), its cell's middle: breathing, or still where
 * motion is reduced.
 */
function drawExitGlow(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  cx: number,
  cy: number,
  cell: number,
): void {
  const beat = frame.reduced ? 0.5 : frame.pulse;
  const reach = cell * (1.3 + 0.6 * beat);
  const glow = ctx.createRadialGradient(cx, cy, cell * 0.3, cx, cy, reach);
  glow.addColorStop(0, rgba(DONE_GREEN, 0.8));
  glow.addColorStop(1, rgba(DONE_GREEN, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(cx - reach, cy - reach, 2 * reach, 2 * reach);
}

/** The drones: grey while frozen, red once alerted, amber on patrol. */
function drawDrones(ctx: CanvasRenderingContext2D, frame: Frame, layout: MinimapLayout): void {
  const { ox, oy, cell } = layout;
  for (const drone of Object.values(frame.drones)) {
    ctx.fillStyle = drone.frozen ? C.frozen : drone.alerted ? C.alerted : C.patrol;
    ctx.beginPath();
    ctx.arc(ox + drone.x * cell, oy + drone.y * cell, cell * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Everyone's dot in their colour, yours ringed in white. */
function drawCrew(ctx: CanvasRenderingContext2D, frame: Frame, layout: MinimapLayout): void {
  const { ox, oy, cell } = layout;
  const { dpr } = frame.viewport;
  const colorOf = new Map(frame.players.map((p) => [p.id, p.color]));
  const dot = (x: number, y: number, color: string, ring: boolean): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ox + x * cell, oy + y * cell, cell * 0.55, 0, Math.PI * 2);
    ctx.fill();
    if (ring) {
      ctx.strokeStyle = C.you;
      ctx.lineWidth = dpr;
      ctx.stroke();
    }
  };
  for (const [id, other] of frame.others) {
    dot(other.rx, other.ry, colorOf.get(id) ?? FALLBACK_COLOR, false);
  }
  dot(frame.self.x, frame.self.y, colorOf.get(frame.youId) ?? FALLBACK_COLOR, true);
}
