import { chatText } from '@escapelab/core';
import { carriedItem, carryLine, promptText } from '../interact.js';
import {
  glowSpot,
  markerBoxes,
  placeMarkers,
  type MarkerPlacement,
  type MarkerTarget,
} from '../markers.js';
import {
  ALARM,
  AMBER,
  css,
  DONE_GREEN,
  INK,
  LABEL,
  lift,
  NIGHT,
  READ_BLUE,
  rgba,
  TEAL,
} from '../palette.js';
import {
  namePlate,
  placeRoomNames,
  roomNamePx,
  shiftClear,
  type Box,
  type Viewport,
} from '../viewport.js';
import { FALLBACK_COLOR, toScreen, type ChatLine, type Frame } from './frame.js';
import { propLabels } from './labels.js';

/**
 * What lies over the world and its light, screen space: the pings' rings
 * and edge arrows, the screen's own text — room names, the arrows to what to
 * walk to, the hatch's sign, the E prompt, captions, chat — and the light
 * failing (the cold open, a run lost). The red edge of the clock's last
 * minute and of the escape lies over the canvas as an element of its own
 * (vignette.ts).
 */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  drawPings(ctx, frame);
  drawScreenText(ctx, frame);
  drawCover(ctx, frame);
}

/** How long a ping shows, ms. */
export const PING_LIFETIME_MS = 3200;
/** How long a chat line's bubble stays up, ms. */
export const CHAT_LIFETIME_MS = 4200;
/** How long „… entdeckt" stays over a find of this player's that matters (finds.ts), s. */
export const CAPTION_SECONDS = 2;
/** How far round your figure the edge arrows keep off, in tiles. */
const KEEP_OUT_TILES = 1.5;
/** Air between two tags on the screen — a caption and the E prompt — CSS pixels. */
const TAG_AIR = 4;
/**
 * The screen's own text at the normal text size, CSS pixels; the reader's text size scales
 * it (`Viewport.textScale`), boxes and all: the E prompt's and the captions' tags, the arrows'
 * captions, the chat bubbles, the carry line and the hatch's sign. Room names: viewport.ts.
 */
const TAG_PX = 12;
const ARROW_PX = 11;
const BUBBLE_PX = 12;
const CARRY_PX = 12;
const EXIT_PX = 12;

/**
 * A room name's letters and the dark plate under them, as colour and opacity: over the
 * brightest lit floor the letters still stand out from the plate at 4.5:1 or more (WCAG 2.2).
 */
export const NAME_INK = { rgb: lift(LABEL, 0.15), alpha: 0.8 } as const;
export const NAME_PLATE = { rgb: NIGHT, alpha: 0.9 } as const;

const C = {
  tag: rgba(INK, 0.88),
  exit: css(DONE_GREEN),
  nameHalo: rgba(NIGHT, 0.85),
  name: rgba(NAME_INK.rgb, NAME_INK.alpha),
  namePlate: rgba(NAME_PLATE.rgb, NAME_PLATE.alpha),
  locked: css(AMBER),
  action: css(TEAL),
  caption: css(lift(READ_BLUE, 0.3)),
  bubble: rgba(lift(LABEL, 0.82), 0.95),
  bubbleInk: css(INK),
  carrying: css(READ_BLUE),
} as const;

/** `px` CSS pixels of text at `view`'s text size, in device pixels. */
function textPx(px: number, view: Pick<Viewport, 'dpr' | 'textScale'>): number {
  return px * view.textScale * view.dpr;
}

/** An arrow at the screen's edge: what it points at, its caption and where it sits. */
interface EdgeMarker {
  target: MarkerTarget;
  caption: string;
  captionWidth: number;
  at: MarkerPlacement;
}

/** Expanding rings for recent pings, plus an edge arrow for off-screen ones. */
function drawPings(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { dpr } = frame.viewport;
  const s = frame.camera.scale;
  const colorOf = new Map(frame.players.map((p) => [p.id, p.color]));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const ping of frame.pings) {
    const age = (frame.perf - ping.at) / PING_LIFETIME_MS;
    const color = colorOf.get(ping.playerId) ?? FALLBACK_COLOR;
    const [px, py] = toScreen(frame, ping.x, ping.y);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 1 - age;
    for (const phase of [0, 0.33, 0.66]) {
      const t = (age * 2.2 + phase) % 1;
      ctx.lineWidth = 2.5 * dpr * (1 - t);
      ctx.beginPath();
      ctx.arc(px, py, (0.25 + t * 1.3) * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawPingArrow(ctx, frame.viewport, px, py, color);
  }
  ctx.globalAlpha = 1;
}

/** Where a ping at (px, py) lies off the screen's middle, an arrow at the edge points to it. */
function drawPingArrow(
  ctx: CanvasRenderingContext2D,
  { w, h, dpr }: Viewport,
  px: number,
  py: number,
  color: string,
): void {
  const margin = 26 * dpr;
  if (px < margin || px > w - margin || py < margin || py > h - margin) {
    const cx = Math.min(w - margin, Math.max(margin, px));
    const cy = Math.min(h - margin, Math.max(margin, py));
    const angle = Math.atan2(py - h / 2, px - w / 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(10 * dpr, 0);
    ctx.lineTo(-7 * dpr, 7 * dpr);
    ctx.lineTo(-7 * dpr, -7 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/**
 * The box a tag like the E prompt covers with `text` centred on (sx, sy), at `view`'s text
 * size; device pixels. Its measures are in device pixels per CSS pixel of the normal size.
 */
function tagBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  sx: number,
  sy: number,
  view: Viewport,
): Box {
  const k = textPx(1, view);
  ctx.font = `700 ${TAG_PX * k}px ui-monospace, Menlo, monospace`;
  const half = (ctx.measureText(text).width + 16 * k) / 2;
  return { left: sx - half, top: sy - 11 * k, right: sx + half, bottom: sy + 9 * k };
}

/** A tag on the screen like the E prompt: a dark pill with rim and text in `tint`, in `box`. */
function drawTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: Box,
  tint: string,
  view: Viewport,
): void {
  const k = textPx(1, view);
  ctx.font = `700 ${TAG_PX * k}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = C.tag;
  ctx.strokeStyle = tint;
  ctx.lineWidth = view.dpr;
  ctx.beginPath();
  ctx.roundRect(box.left, box.top, box.right - box.left, box.bottom - box.top, 5 * k);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = tint;
  ctx.fillText(text, (box.left + box.right) / 2, box.top + 15 * k);
}

/** `box` moved down by `dy`, device pixels. */
function moved(box: Box, dy: number): Box {
  return { ...box, top: box.top + dy, bottom: box.bottom + dy };
}

/**
 * The screen's own text over the world: room names, the arrows to what
 * to walk to, the hatch's sign, the E prompt, captions and chat — the marks
 * of play fading in with the HUD after the run's opening (`frame.hud`). While
 * the run ends on screen only the room names stay: the lab is all there is to
 * see.
 */
function drawScreenText(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const view = frame.viewport;
  // The room names keep off the labels under the things, which matter more to play.
  const named = [...view.boxes, ...labelsOnScreen(ctx, frame)];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = 'center';
  if (frame.ending !== null) {
    drawRoomNames(ctx, frame, { ...view, boxes: named });
    return;
  }
  // Anything you need to walk to gets an arrow at the screen edge while
  // it is out of sight — in the dark that is the only way to find it. The
  // arrows keep off your figure, and the room names off the arrows, as
  // off the minimap.
  const figure = frame.spectator ? null : figureOn(frame);
  const shunned = figure === null ? view.boxes : [...view.boxes, figure.keepOut];
  const markers = edgeMarkers(ctx, frame, { ...view, boxes: shunned });
  const arrows = markers.flatMap(({ at, captionWidth }) => markerBoxes(at, captionWidth, view));
  drawRoomNames(ctx, frame, { ...view, boxes: [...named, ...arrows] });
  drawExitSign(ctx, frame);
  ctx.globalAlpha = frame.hud;
  drawDangerGlows(ctx, frame);
  drawEdgeMarkers(ctx, markers, view);
  const prompt = drawPrompt(ctx, frame, figure?.body ?? null);
  drawCaptions(ctx, frame, prompt);
  drawChatBubbles(ctx, frame);
  drawCarrying(ctx, frame);
  ctx.globalAlpha = 1;
}

/** The boxes the labels under the things cover this frame (labels.ts), device pixels. */
function labelsOnScreen(ctx: CanvasRenderingContext2D, frame: Frame): Box[] {
  return propLabels(ctx, frame).boxes.map((box) => {
    const [left, top] = toScreen(frame, box.left, box.top);
    const [right, bottom] = toScreen(frame, box.right, box.bottom);
    return { left, top, right, bottom };
  });
}

/** The open hatch's sign over it. */
function drawExitSign(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const exit = frame.map.exit;
  if (exit !== null && exit.open) {
    const [ex, ey] = toScreen(frame, exit.x + 0.5, exit.y - 0.5);
    ctx.font = `700 ${textPx(EXIT_PX, frame.viewport)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = C.exit;
    ctx.fillText('NOTAUSGANG', ex, ey);
  }
}

/**
 * Your figure on the canvas, device pixels: what it covers, from its name
 * tag over its head down to its feet (`body`), and the stretch of about a
 * tile and a half round it the edge arrows keep off (`keepOut`) — on a
 * phone held sideways the canvas is low, and an arrow would lie on you.
 */
function figureOn(frame: Frame): { body: Box; keepOut: Box } {
  const { dpr } = frame.viewport;
  const s = frame.camera.scale;
  const [sx, sy] = toScreen(frame, frame.self.x, frame.self.y);
  const half = Math.max(0.6 * s, 30 * dpr);
  const body = {
    left: sx - half,
    top: sy - 0.62 * s - 16 * dpr,
    right: sx + half,
    bottom: sy + 0.5 * s,
  };
  const r = KEEP_OUT_TILES * s;
  return { body, keepOut: { left: sx - r, top: sy - r, right: sx + r, bottom: sy + r } };
}

/** The arrows due at the screen's edge this frame, each with its caption, placed in `view`. */
function edgeMarkers(ctx: CanvasRenderingContext2D, frame: Frame, view: Viewport): EdgeMarker[] {
  ctx.font = `700 ${textPx(ARROW_PX, view)}px ui-monospace, Menlo, monospace`;
  const marks = frame.markers.filter((target) => target.glow === undefined).map((target) => {
    const [px, py] = toScreen(frame, target.x, target.y);
    const tiles = Math.round(Math.hypot(target.x - frame.self.x, target.y - frame.self.y));
    const caption = `${target.label} ${tiles}m`;
    return { target, caption, px, py, captionWidth: ctx.measureText(caption).width };
  });
  const placements = placeMarkers(marks, view);
  return marks.flatMap(({ target, caption, captionWidth }, i) => {
    const at = placements[i];
    return at == null ? [] : [{ target, caption, captionWidth, at }];
  });
}

function drawEdgeMarkers(
  ctx: CanvasRenderingContext2D,
  markers: readonly EdgeMarker[],
  view: Viewport,
): void {
  const { dpr } = view;
  ctx.font = `700 ${textPx(ARROW_PX, view)}px ui-monospace, Menlo, monospace`;
  for (const { target, caption, at } of markers) {
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(at.angle);
    ctx.fillStyle = target.color;
    ctx.beginPath();
    ctx.moveTo(13 * dpr, 0);
    ctx.lineTo(-8 * dpr, 9 * dpr);
    ctx.lineTo(-8 * dpr, -9 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = target.color;
    ctx.fillText(caption, at.x, at.captionY);
  }
}

/**
 * Room names are signage, not world objects: a size above every prop's
 * label at the reader's text size, each on a dark plate that keeps it
 * readable over lit floor as in the dark, nudged in rather than cut off at a
 * side, and left out where they would lie off screen or under something else
 * in `view`.
 */
function drawRoomNames(ctx: CanvasRenderingContext2D, frame: Frame, view: Viewport): void {
  const { dpr } = view;
  const size = roomNamePx(view);
  ctx.save();
  ctx.font = `700 ${size}px ui-monospace, Menlo, monospace`;
  const names = frame.map.labels.map((label) => {
    const [x, y] = toScreen(frame, label.x + 0.5, label.y + 0.5);
    return { text: label.text, x, y, width: ctx.measureText(label.text).width };
  });
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = C.nameHalo;
  for (const name of placeRoomNames(names, view)) {
    const plate = namePlate(name, size);
    ctx.fillStyle = C.namePlate;
    ctx.beginPath();
    const { left, top, right, bottom } = plate;
    ctx.roundRect(left, top, right - left, bottom - top, 3 * dpr);
    ctx.fill();
    ctx.fillStyle = C.name;
    ctx.strokeText(name.text, name.x, name.y);
    ctx.fillText(name.text, name.x, name.y);
  }
  ctx.restore();
}

/**
 * What E does here, over the thing it works on — amber where E does
 * nothing yet — and clear of your figure (`figure`), above it where there
 * is room: standing beside a station, its prompt would lie on your name.
 * While the server's refusal of a press is up (`frame.refusal`), the pill
 * where that press was made says the server's words instead, in amber.
 * Returns where it went, or null for none.
 */
function drawPrompt(ctx: CanvasRenderingContext2D, frame: Frame, figure: Box | null): Box | null {
  const { action, refusal } = frame;
  const shown =
    refusal !== null
      ? { x: refusal.x, y: refusal.y, text: refusal.text, tint: C.locked }
      : action === null
        ? null
        : {
            x: action.x,
            y: action.y,
            text: promptText(action, !frame.touch),
            tint: action.kind === 'locked' ? C.locked : C.action,
          };
  if (shown === null) {
    return null;
  }
  const view = frame.viewport;
  const { dpr } = view;
  const [sx, rawY] = toScreen(frame, shown.x, shown.y);
  // Like the edge arrows: the prompt must stay below the objective bar.
  const box = tagBox(ctx, shown.text, sx, Math.max(rawY, lowestTag(view)), view);
  const ceiling = view.top + 13 * dpr;
  const at = moved(box, figure === null ? 0 : shiftClear(box, figure, TAG_AIR * dpr, ceiling));
  drawTag(ctx, shown.text, at, shown.tint, view);
  return at;
}

/** Where a tag's middle may lie highest on `view`: its top 13 CSS px below the objective bar. */
function lowestTag(view: Viewport): number {
  return view.top + 13 * view.dpr + 11 * textPx(1, view);
}

/**
 * „Spind entdeckt" over a find of this player's that matters (finds.ts), rising
 * as it fades — above the E prompt (`prompt`, its box), never on it — as far
 * as the alpha it is drawn under lets it.
 */
function drawCaptions(ctx: CanvasRenderingContext2D, frame: Frame, prompt: Box | null): void {
  const view = frame.viewport;
  const { dpr } = view;
  const under = ctx.globalAlpha;
  for (const caption of frame.captions) {
    const age = (frame.time - caption.at) / CAPTION_SECONDS;
    const [sx, rawY] = toScreen(frame, caption.x, caption.y - 1 - 0.3 * age);
    const box = tagBox(ctx, caption.text, sx, Math.max(rawY, lowestTag(view)), view);
    const ceiling = view.top + 13 * dpr;
    const dy = prompt === null ? 0 : shiftClear(box, prompt, TAG_AIR * dpr, ceiling);
    ctx.globalAlpha = under * Math.min(1, age * 10, (1 - age) * 4);
    drawTag(ctx, caption.text, moved(box, dy), C.caption, view);
  }
  ctx.globalAlpha = under;
}

/** Where the speech bubble of `playerId` hangs, in tiles: over their head; none for nobody. */
function bubbleSpot(frame: Frame, playerId: string): [number, number] | undefined {
  const at =
    playerId === frame.youId ? { x: frame.self.x, y: frame.self.y } : frame.others.get(playerId);
  if (at === undefined) {
    return undefined;
  }
  const wx = 'rx' in at ? at.rx : at.x;
  const wy = ('ry' in at ? at.ry : at.y) - 1.15;
  return [wx, wy];
}

/** Speech bubbles above whoever just said something. */
function drawChatBubbles(ctx: CanvasRenderingContext2D, frame: Frame): void {
  // Only the newest line per speaker, so spam cannot stack up.
  const newest = new Map<string, ChatLine>();
  for (const line of frame.chats) {
    newest.set(line.playerId, line);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = 'center';
  for (const [playerId, line] of newest) {
    const spot = bubbleSpot(frame, playerId);
    if (spot === undefined) {
      continue;
    }
    const [sx, sy] = toScreen(frame, spot[0], spot[1]);
    drawBubble(ctx, frame, line, sx, sy);
  }
}

/**
 * One speech bubble over (sx, sy), its tail's tip 16 CSS px under that point whatever the text
 * size — the bubble grows upward from there — fading out over the last fifth of its life, as
 * far as the alpha it is drawn under lets it.
 */
function drawBubble(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  line: ChatLine,
  sx: number,
  sy: number,
): void {
  const view = frame.viewport;
  const k = textPx(1, view);
  const tip = sy + 16 * view.dpr;
  const text = chatText(line.phrase);
  ctx.font = `600 ${BUBBLE_PX * k}px system-ui, sans-serif`;
  const tw = ctx.measureText(text).width + 18 * k;
  const age = (frame.perf - line.at) / CHAT_LIFETIME_MS;
  const under = ctx.globalAlpha;
  ctx.globalAlpha = under * (age > 0.8 ? (1 - age) / 0.2 : 1);
  ctx.fillStyle = C.bubble;
  ctx.beginPath();
  ctx.roundRect(sx - tw / 2, tip - 28 * k, tw, 22 * k, 7 * k);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(sx - 5 * k, tip - 7 * k);
  ctx.lineTo(sx + 5 * k, tip - 7 * k);
  ctx.lineTo(sx, tip);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.bubbleInk;
  ctx.fillText(text, sx, tip - 12 * k);
  ctx.globalAlpha = under;
}

/**
 * A standing reminder of the Q key while hands are full. A touch screen has
 * its 📦 button for that instead, and its crew strip says what you carry.
 */
function drawCarrying(ctx: CanvasRenderingContext2D, frame: Frame): void {
  if (frame.touch) {
    return;
  }
  const carrying = carriedItem(frame.map, frame.youId);
  if (carrying !== undefined) {
    const view = frame.viewport;
    ctx.font = `700 ${textPx(CARRY_PX, view)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = C.carrying;
    ctx.fillText(carryLine(carrying.label), view.w / 2, view.h - 16 * view.dpr);
  }
}

/** The light failing: the whole picture drops by the cold open's or the ending's cover. */
function drawCover(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const cover = Math.max(frame.scene.cover, frame.ending?.dark ?? 0);
  if (cover <= 0) {
    return;
  }
  const { w, h } = frame.viewport;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = rgba(NIGHT, cover);
  ctx.fillRect(0, 0, w, h);
}

/**
 * A danger sensed (world/danger.ts) glows softly at the screen's edge toward it, red, as
 * strong as it is near (markers.ts `glowSpot`): on screen or off, the glow keeps to the edge,
 * where nothing of the world's own lies. Only while a drone closes in; nothing else draws it.
 */
function drawDangerGlows(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const view = frame.viewport;
  for (const target of frame.markers) {
    const [px, py] = toScreen(frame, target.x, target.y);
    const spot = target.glow === undefined ? null : glowSpot(px, py, view);
    if (spot === null || target.glow === undefined) {
      continue;
    }
    const fill = ctx.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, spot.r);
    fill.addColorStop(0, rgba(ALARM, 0.5 * target.glow));
    fill.addColorStop(1, rgba(ALARM, 0));
    ctx.fillStyle = fill;
    // Only the part of the circle on the screen is filled.
    const left = Math.max(0, spot.x - spot.r);
    const top = Math.max(0, spot.y - spot.r);
    const right = Math.min(view.w, spot.x + spot.r);
    const bottom = Math.min(view.h, spot.y + spot.r);
    ctx.fillRect(left, top, right - left, bottom - top);
  }
}
