import type { DronePosition, PlayerView, Sight } from '@escapelab/core';
import type { VoiceMesh } from '../voice/mesh.js';
import type { Alarm } from './alarm.js';
import { worldText, type WorldText } from './art.js';
import { coldOpenFrame } from './coldOpen.js';
import { exitOpening, redShift } from './escape.js';
import { finaleFrame, type FinaleCue, type FinaleFrame } from './finale.js';
import { frameLight, mountedLamps } from './frameLight.js';
import { contextAction } from './interact.js';
import { markerTargets } from './markers.js';
import { positionsOf, type KnownPositions } from './movement.js';
import type { ChatLine, Frame, MapPing, RenderKit, WorldMap } from './render/frame.js';
import { minimapBox, minimapLayout } from './render/hud.js';
import { CAPTION_SECONDS, CHAT_LIFETIME_MS } from './render/overlays.js';
import type { Sim } from './sim.js';
import { clampCamera, type Viewport } from './viewport.js';
import { shortOf } from './particles.js';

/**
 * One frame of the world, assembled before anything is drawn (GameWorld.tsx
 * calls this on every frame it draws, then render/pipeline.ts): the camera
 * pointed, the clocks read once, this frame's light worked out, the crew as
 * this screen eases them, and what lies over the picture — the chat lines
 * and captions gone dropped. The camera and the light's memory are kept in
 * the simulation; nothing here makes a sound.
 */

/** On a touch screen the pad would sit on the avatar: it is lifted this far, CSS pixels. */
const PAD_LIFT = 60;

/** What a frame reads of the component's latest render. */
export interface Latest {
  view: PlayerView;
  darkSince: number | null;
  /** input is locked: a panel, pages or the pause lie over the world */
  locked: boolean;
  finale: FinaleCue | null;
  /** when the escape began on this screen (escape.ts); null before it */
  escapeSince: number | null;
  reduced: boolean;
  /** the crew's voice, read on every frame for who speaks; none outside the app */
  voice: VoiceMesh | null;
}

/** What one mounted world assembles its frames from. */
export interface FrameSource {
  canvas: HTMLCanvasElement;
  kit: RenderKit;
  sim: Sim;
  spectator: boolean;
  /** same condition the stylesheet uses to show the on-screen pad */
  touchPad: MediaQueryList;
  /** how far the objective bar and the control cluster reach into the canvas, CSS pixels */
  insets: { top: number; bottom: number };
  live: React.MutableRefObject<Latest>;
  alarm: React.MutableRefObject<Alarm | null>;
  positions: React.MutableRefObject<KnownPositions>;
  drones: React.MutableRefObject<Record<string, DronePosition>>;
  chats: React.MutableRefObject<ChatLine[]>;
  /** clip paths in tiles, by the sight they were made from: a lamp standing still reuses its own */
  clips: WeakMap<Sight, Path2D>;
  /** the world's text at the zoom it was last worked out for; the zoom seldom changes */
  texts: { s: number; dpr: number; styles: WorldText };
}

/**
 * This frame of the world at `dpr` device pixels a CSS pixel, the canvas
 * sized already: the page's clock read at `perf` (performance.now()), the
 * pings still showing `pings`.
 */
export function assembleFrame(
  source: FrameSource,
  map: WorldMap,
  dpr: number,
  perf: number,
  pings: readonly MapPing[],
): Frame {
  const { sim } = source;
  const live = source.live.current;
  const now = Date.now();
  const cue = live.finale;
  const ending = cue === null ? null : finaleFrame(cue.ending, now - cue.since, live.reduced);
  return {
    ...stage(source, map, dpr, ending?.pull ?? 0),
    ...lighting(source, map, now, ending),
    ...crewOf(source),
    ...overlaysOf(source, map, ending, perf),
    pings,
    time: sim.time,
    now,
    pulse: (Math.sin(sim.time * 4) + 1) / 2,
    burn: 0.7 + 0.3 * Math.sin(sim.time * 2.4),
    map,
    ending,
    spectator: source.spectator,
    reduced: live.reduced,
    touch: source.touchPad.matches,
    kit: source.kit,
    missionId: live.view.missionId,
    short: shortOf(live.view, source.alarm.current),
  };
}

/** Device pixels per tile with the whole lab in the picture. */
function wholeZoom(map: WorldMap, w: number, h: number): number {
  return Math.max(14, Math.min(w / (map.width + 0.5), h / (map.height + 0.5)));
}

/** Device pixels per tile: the audience sees the whole lab, a player what covers the canvas. */
function zoomFor(map: WorldMap, w: number, h: number, spectator: boolean): number {
  if (spectator) {
    return wholeZoom(map, w, h);
  }
  // Zoom so the lab always covers the canvas: no black bars beside it — but
  // stop before the lab turns into giant tiles on very wide windows.
  const cover = Math.max(w / map.width, h / map.height);
  return Math.min(170, Math.max(cover, Math.min(88, h / 10.5)));
}

/** Where the camera looks as it pulls back from the avatar to the middle of the lab. */
function pulledBack(sim: Sim, map: WorldMap, pull: number): { x: number; y: number } {
  return {
    x: sim.cam.x + (map.width / 2 - sim.cam.x) * pull,
    y: sim.cam.y + (map.height / 2 - sim.cam.y) * pull,
  };
}

/**
 * Points the camera for this frame — at your avatar, pulling back over the
 * whole lab as a run won ends (`pull`, 0 to 1) — and keeps it in the
 * simulation, where a click and the trace read it. Returns the zoom.
 */
function aim(source: FrameSource, map: WorldMap, dpr: number, pull: number): number {
  const { sim, canvas, spectator } = source;
  const w = canvas.width;
  const h = canvas.height;
  const near = zoomFor(map, w, h, spectator);
  const s = near + (wholeZoom(map, w, h) - near) * pull;
  sim.draw = clampCamera(map, pulledBack(sim, map, pull), {
    scale: s,
    w,
    h,
    top: sim.topCss * dpr * (1 - pull),
    lift: source.touchPad.matches && !spectator ? PAD_LIFT * dpr * (1 - pull) : 0,
  });
  sim.scale = s;
  return s;
}

/** The world's text at the zoom it was last worked out for; the zoom seldom changes. */
function textAt(source: FrameSource, s: number, dpr: number): WorldText {
  const { texts } = source;
  if (texts.s !== s || texts.dpr !== dpr) {
    Object.assign(texts, { s, dpr, styles: worldText(s, dpr) });
  }
  return texts.styles;
}

/** The canvas and what lies over it this frame, the camera, the minimap and the text's size. */
function stage(
  source: FrameSource,
  map: WorldMap,
  dpr: number,
  pull: number,
): Pick<Frame, 'viewport' | 'camera' | 'minimap' | 'text'> {
  const { sim, canvas, insets } = source;
  const w = canvas.width;
  const h = canvas.height;
  const scale = aim(source, map, dpr, pull);
  const minimap = source.spectator || !sim.minimap ? null : minimapLayout(map, w, h, dpr, insets);
  const viewport: Viewport = {
    w,
    h,
    dpr,
    top: insets.top * dpr,
    bottom: insets.bottom * dpr,
    boxes: minimap === null ? [] : [minimapBox(minimap, dpr)],
  };
  const camera = { x: sim.draw.x, y: sim.draw.y, scale };
  return { viewport, camera, minimap, text: textAt(source, scale, dpr) };
}

/** How far the light has turned red on this screen: from the escape's start; warm once won. */
function escapeRed(live: Latest, now: number): number {
  const since = live.escapeSince;
  if (since === null || live.finale?.ending === 'won') {
    return 0;
  }
  return redShift(now - since);
}

/** The frame's light and what it follows. */
type Lighting = 'scene' | 'escapeSince' | 'red' | 'hatch' | 'light' | 'mounts' | 'litTiles' | 'lit';

/** This frame's light (frameLight.ts), and what it follows: the cold open, the escape. */
function lighting(
  source: FrameSource,
  map: WorldMap,
  now: number,
  ending: FinaleFrame | null,
): Pick<Frame, Lighting> {
  const { sim, spectator } = source;
  const live = source.live.current;
  const scene = coldOpenFrame(live.darkSince === null ? null : now - live.darkSince, live.reduced);
  const { escapeSince } = live;
  // The hatch grinds open on this screen from the escape's start.
  const hatch =
    map.exit?.open === true && escapeSince !== null ? exitOpening(now - escapeSince) : 0;
  const mounts = mountedLamps(map);
  const drones = source.drones.current;
  const run = live.view.startedAt;
  const lights = { map, sim, drones, spectator, run, now, hatch, mounts, clips: source.clips };
  const light = frameLight(lights, scene.lit, (ending?.lit ?? 0) > 0);
  const red = escapeRed(live, now);
  return { scene, escapeSince, red, hatch, light, mounts, litTiles: sim.litTiles, lit: sim.lit };
}

/** The view's people and the drones, as this frame draws them. */
type Crew =
  | 'youId'
  | 'players'
  | 'signSeen'
  | 'deadlineAt'
  | 'self'
  | 'walkPhase'
  | 'others'
  | 'speaking'
  | 'drones'
  | 'doors'
  | 'alarm';

/** You, the crew and the drones as this frame draws them, and what the view says about them. */
function crewOf(source: FrameSource): Pick<Frame, Crew> {
  const { sim } = source;
  const { view, voice } = source.live.current;
  return {
    youId: view.you.id,
    players: view.players,
    signSeen: view.presence.signSeen,
    deadlineAt: view.deadlineAt,
    self: sim.self,
    walkPhase: sim.walkPhase,
    others: sim.others,
    speaking: voice?.getState().speaking,
    drones: source.drones.current,
    doors: sim.doors,
    alarm: source.alarm.current,
  };
}

/** The chat lines still up at `perf`: a line only lives as long as its bubble. */
function liveChats(source: FrameSource, perf: number): ChatLine[] {
  const chats = source.chats;
  const live = chats.current.filter((c) => perf - c.at < CHAT_LIFETIME_MS);
  if (live.length !== chats.current.length) {
    chats.current = live;
  }
  return live;
}

/**
 * What lies over the picture this frame while the run goes on: the chat
 * lines and captions still up, what to walk to and what E does here —
 * none of it while the run ends on screen.
 */
function overlaysOf(
  source: FrameSource,
  map: WorldMap,
  ending: FinaleFrame | null,
  perf: number,
): Pick<Frame, 'perf' | 'chats' | 'captions' | 'markers' | 'action'> {
  if (ending !== null) {
    return { perf, chats: [], captions: [], markers: [], action: null };
  }
  const { sim } = source;
  const { view, locked } = source.live.current;
  sim.captions = sim.captions.filter((c) => sim.time - c.at < CAPTION_SECONDS);
  const chats = liveChats(source, perf);
  const crew = positionsOf(source.positions.current, sim.run);
  const markers = markerTargets(map, view.you.id, sim.self, crew);
  const action = locked
    ? null
    : contextAction(map, sim.self, view.you.id, view.sourcesHere, view.puzzle !== null);
  return { perf, chats, captions: sim.captions, markers, action };
}
