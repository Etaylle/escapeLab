import type { DronePosition, PlayerView, Sight } from '@escapelab/core';
import type { VoiceMesh } from '../voice/mesh.js';
import type { Alarm } from './alarm.js';
import { worldText, type WorldText } from './art.js';
import { coldOpenFrame } from './coldOpen.js';
import { exitOpening, redShift } from './escape.js';
import type { FigureMood } from './figure.js';
import { finaleFrame, type FinaleCue, type FinaleFrame } from './finale.js';
import { frameLight, mountedLamps } from './frameLight.js';
import { contextAction } from './interact.js';
import { hudAt, litWhole, shotProgress, type IntroCue } from './intro/sequence.js';
import { SHOT_WIDE, shotPoint, shotStart } from './intro/shot.js';
import { markerTargets } from './markers.js';
import { positionsOf, type KnownPositions } from './movement.js';
import type { ChatLine, Frame, MapPing, RenderKit, WorldMap } from './render/frame.js';
import { gridOf, sameGrid, snapCamera } from './render/grid.js';
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
  /** the run's opening on this screen (intro/sequence.ts); null where it plays none */
  intro: IntroCue | null;
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
  const hud = hudOf(source, now);
  return {
    ...stage(source, map, dpr, ending?.pull ?? 0, now, hud),
    ...lighting(source, map, now, ending),
    ...crewOf(source),
    ...overlaysOf(source, map, ending, perf, hud),
    hud,
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
    ...figuresOf(source, map),
  };
}

/** Device pixels per tile with the whole lab in the picture. */
function wholeZoom(map: WorldMap, w: number, h: number): number {
  return Math.max(14, Math.min(w / (map.width + 0.5), h / (map.height + 0.5)));
}

/** Device pixels per tile with the lab covering the canvas: no black beside it. */
function coverZoom(map: WorldMap, w: number, h: number): number {
  return Math.max(w / map.width, h / map.height);
}

/** Device pixels per tile: the audience sees the whole lab, a player what covers the canvas. */
function zoomFor(map: WorldMap, w: number, h: number, spectator: boolean): number {
  if (spectator) {
    return wholeZoom(map, w, h);
  }
  // Zoom so the lab always covers the canvas: no black bars beside it — but
  // stop before the lab turns into giant tiles on very wide windows.
  return Math.min(170, Math.max(coverZoom(map, w, h), Math.min(88, h / 10.5)));
}

/** The opening's shot at a moment: from the reactor end to this player's spawn, how far along. */
interface Shot {
  from: { x: number; y: number };
  to: { x: number; y: number };
  progress: number;
}

/**
 * The opening's shot at `now`, tiles (intro/shot.ts); null where the camera follows the
 * avatar.
 */
function shotOf(source: FrameSource, map: WorldMap, now: number): Shot | null {
  const { intro, reduced } = source.live.current;
  const progress = intro === null || source.spectator ? null : shotProgress(intro, now, reduced);
  if (progress === null) {
    return null;
  }
  const to = { x: map.yourSpawn.x + 0.5, y: map.yourSpawn.y + 0.5 };
  return { from: shotStart(map, to), to, progress };
}

/** Where the camera looks as it pulls back from the avatar to the middle of the lab. */
function pulledBack(sim: Sim, map: WorldMap, pull: number): { x: number; y: number } {
  return {
    x: sim.cam.x + (map.width / 2 - sim.cam.x) * pull,
    y: sim.cam.y + (map.height / 2 - sim.cam.y) * pull,
  };
}

/**
 * Points the camera for this frame — along the opening's shot, a little wider than play, with
 * nothing of the HUD to keep clear of; at your avatar, pulling back over the whole lab as a run
 * won ends (`pull`, 0 to 1) — and keeps it in the simulation, where a click and the trace read
 * it. Returns the zoom.
 */
function aim(source: FrameSource, map: WorldMap, dpr: number, pull: number, now: number): number {
  const { sim, canvas, spectator } = source;
  const w = canvas.width;
  const h = canvas.height;
  const near = zoomFor(map, w, h, spectator);
  const shot = shotOf(source, map, now);
  if (shot !== null) {
    const wide = Math.max(coverZoom(map, w, h), near * SHOT_WIDE);
    // Both ends where the camera can look: the shot moves from its first frame to its last.
    const lens = { scale: wide, w, h, top: 0, lift: 0 };
    const [from, to] = [shot.from, shot.to].map((end) => clampCamera(map, end, lens));
    sim.draw = shotPoint(from ?? shot.from, to ?? shot.to, shot.progress);
    sim.scale = wide;
    return wide;
  }
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

/**
 * The camera of this frame and the pixel grid it puts the world on
 * (render/grid.ts): the camera following you on whole pixels, the audience's
 * and the one pulling back at the end where it is; and whether the grid is
 * the one the frame before was drawn on — kept in the kit for the next.
 */
function framing(
  source: FrameSource,
  scale: number,
  pull: number,
): Pick<Frame, 'camera' | 'grid' | 'steady'> {
  const { sim, canvas, kit } = source;
  const exact = { x: sim.draw.x, y: sim.draw.y, scale };
  const follows = !source.spectator && pull === 0;
  const camera = follows ? snapCamera(exact, canvas.width, canvas.height) : exact;
  const grid = gridOf(camera, canvas.width, canvas.height);
  const steady = kit.grid !== null && sameGrid(kit.grid, grid);
  kit.grid = grid;
  return { camera, grid, steady };
}

/**
 * How much of the HUD shows on this screen at `now`, 0 to 1: none while the run's opening keeps
 * it out, then fading in with the page's (intro/sequence.ts `hudAt`); all of it without one.
 */
function hudOf(source: FrameSource, now: number): number {
  const intro = source.live.current.intro;
  return intro === null ? 1 : hudAt(intro, now);
}

/**
 * The canvas and what lies over it this frame, the camera, the minimap — none while the run's
 * opening keeps the HUD out (`hud`, 0 to 1) — and the text's size.
 */
function stage(
  source: FrameSource,
  map: WorldMap,
  dpr: number,
  pull: number,
  now: number,
  hud: number,
): Pick<Frame, 'viewport' | 'camera' | 'grid' | 'steady' | 'minimap' | 'text'> {
  const { sim, canvas, insets } = source;
  const w = canvas.width;
  const h = canvas.height;
  const scale = aim(source, map, dpr, pull, now);
  const mapless = source.spectator || !sim.minimap || hud === 0;
  const minimap = mapless ? null : minimapLayout(map, w, h, dpr, insets);
  const viewport: Viewport = {
    w,
    h,
    dpr,
    top: insets.top * dpr,
    bottom: insets.bottom * dpr,
    boxes: minimap === null ? [] : [minimapBox(minimap, dpr)],
  };
  const text = textAt(source, scale, dpr);
  return { viewport, ...framing(source, scale, pull), minimap, text };
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
type Lighting =
  | 'scene'
  | 'whole'
  | 'escapeSince'
  | 'red'
  | 'hatch'
  | 'light'
  | 'mounts'
  | 'litTiles'
  | 'lit';

/**
 * This frame's light (frameLight.ts), and what it follows: the opening's shot, which shows the
 * lab lit whole, the cold open, the escape, the end.
 */
function lighting(
  source: FrameSource,
  map: WorldMap,
  now: number,
  ending: FinaleFrame | null,
): Pick<Frame, Lighting> {
  const { sim, spectator } = source;
  const live = source.live.current;
  const scene = coldOpenFrame(live.darkSince === null ? null : now - live.darkSince, live.reduced);
  const shot = live.intro !== null && litWhole(live.intro, now);
  const whole = shot ? 1 : (ending?.lit ?? 0);
  const { escapeSince } = live;
  // The hatch grinds open on this screen from the escape's start.
  const hatch =
    map.exit?.open === true && escapeSince !== null ? exitOpening(now - escapeSince) : 0;
  const mounts = mountedLamps(map);
  const drones = source.drones.current;
  const run = live.view.startedAt;
  const lights = { map, sim, drones, spectator, run, now, hatch, mounts, clips: source.clips };
  const light = frameLight(lights, scene.lit, whole > 0);
  const red = escapeRed(live, now);
  const litTiles = sim.litTiles;
  return { scene, whole, escapeSince, red, hatch, light, mounts, litTiles, lit: sim.lit };
}

/** The view's people and the drones, as this frame draws them. */
type Crew =
  | 'youId'
  | 'youName'
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
    youName: view.you.name,
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
 * none of it while the run's opening keeps the HUD out (`hud` 0) or the run
 * ends on screen.
 */
function overlaysOf(
  source: FrameSource,
  map: WorldMap,
  ending: FinaleFrame | null,
  perf: number,
  hud: number,
): Pick<Frame, 'perf' | 'chats' | 'captions' | 'markers' | 'action'> {
  if (ending !== null || hud === 0) {
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
    : contextAction(
        map,
        sim.self,
        view.you.id,
        view.sourcesHere,
        view.puzzle !== null,
        view.noteHere,
      );
  return { perf, chats, captions: sim.captions, markers, action };
}

/** How the crew stands for an ending on screen: celebrating a run won, slumped over one lost. */
function moodOf(finale: FinaleCue | null): FigureMood {
  if (finale === null) {
    return 'play';
  }
  return finale.ending === 'won' ? 'celebrate' : 'slump';
}

/**
 * What the crew's figures stand by this frame (figure.ts): what each of the
 * crew carries, by the view's items; since when each has stood still, kept
 * in the kit from frame to frame — you as you steer yourself, the rest as
 * they stream in; and the mood the run's end puts them in.
 */
function figuresOf(
  source: FrameSource,
  map: WorldMap,
): Pick<Frame, 'carrying' | 'stillSince' | 'mood'> {
  const { sim, kit } = source;
  const { view, finale } = source.live.current;
  const now = sim.time * 1000;
  for (const { id } of view.players) {
    const walking = id === view.you.id ? sim.self.moving : sim.others.get(id)?.moving === true;
    if (walking) {
      kit.still.delete(id);
    } else if (!kit.still.has(id)) {
      kit.still.set(id, now);
    }
  }
  const carrying = new Map<string, string>();
  for (const item of map.items) {
    if (item.carriedBy !== null && !item.delivered) {
      carrying.set(item.carriedBy, item.label);
    }
  }
  return { carrying, stillSince: kit.still, mood: moodOf(finale) };
}
