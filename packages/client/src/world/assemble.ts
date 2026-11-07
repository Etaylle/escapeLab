import type { DronePosition, PartKind, PlayerView, Sight } from '@escapelab/core';
import { timeLeft } from '../clock.js';
import type { VoiceMesh } from '../voice/mesh.js';
import type { Alarm } from './alarm.js';
import { worldText, type WorldText } from './art.js';
import { coldOpenFrame, FLICKER_MS, type ColdOpenFrame } from './coldOpen.js';
import { exitOpening, redShift } from './escape.js';
import { dangerMarker } from './danger.js';
import { turnOf, shownFacing, type FigureMood, type FigureTask } from './figure.js';
import { finaleFrame, type FinaleCue, type FinaleFrame } from './finale.js';
import { frameLight, mountedLamps } from './frameLight.js';
import { gradeAt, gradePhase, type Wash } from './grade.js';
import { flashAt, holding, solvesAt } from './hitStop.js';
import { contextAction } from './interact.js';
import { hudAt, litWhole, shotProgress, type IntroCue } from './intro/sequence.js';
import { known } from './known.js';
import { labelAlpha } from './labelFade.js';
import { SHOT_WIDE, shotPoint, shotStart } from './intro/shot.js';
import { markerTargets } from './markers.js';
import { positionsOf, type KnownPositions } from './movement.js';
import { presenceNear, type Whereabouts } from './presence.js';
import { refusalAt } from './press.js';
import type { ChatLine, Frame, MapPing, RenderKit, WorldMap } from './render/frame.js';
import { gridOf, sameGrid, snapCamera } from './render/grid.js';
import { minimapBox, minimapLayout } from './render/hud.js';
import { CAPTION_SECONDS, CHAT_LIFETIME_MS } from './render/overlays.js';
import type { Sim } from './sim.js';
import { clampCamera, liftAbove, tileCss, type Box, type Viewport } from './viewport.js';
import { shortOf } from './particles.js';

/**
 * One frame of the world, assembled before anything is drawn (GameWorld.tsx
 * calls this on every frame it draws, then render/pipeline.ts): the camera
 * pointed, the clocks read once, this frame's light worked out, the crew as
 * this screen eases them, and what lies over the picture — the chat lines
 * and captions gone dropped. The camera and the light's memory are kept in
 * the simulation; nothing here makes a sound.
 */

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
  /** the reader's text size (settings.ts TEXT_SCALE): the canvas's own text follows it */
  textScale: number;
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
  /**
   * how far the objective bar reaches into the canvas — now, and with a line on the air (`bar`,
   * what the zoom keeps the band below) — and the controls up from its foot, the highest of
   * them, and where each group of the controls lies on it; CSS pixels
   */
  insets: { top: number; bar: number; bottom: number; controls: readonly Box[] };
  live: React.MutableRefObject<Latest>;
  alarm: React.MutableRefObject<Alarm | null>;
  positions: React.MutableRefObject<KnownPositions>;
  drones: React.MutableRefObject<Record<string, DronePosition>>;
  chats: React.MutableRefObject<ChatLine[]>;
  /** clip paths in tiles, by the sight they were made from: a lamp standing still reuses its own */
  clips: WeakMap<Sight, Path2D>;
  /**
   * the world's text at the zoom and the text size it was last worked out for; neither
   * changes often
   */
  texts: { s: number; dpr: number; scale: number; styles: WorldText };
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
  return held(source, {
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
    labels: (find) => labelAlpha(sim.labels, find, sim.time, live.reduced),
    touch: source.touchPad.matches,
    kit: source.kit,
    missionId: live.view.missionId,
    short: shortOf(live.view, source.alarm.current),
    ...figuresOf(source, map),
    ...impactOf(source, now),
  });
}

/**
 * The solves this screen sees (hitStop.ts), kept in the kit: the run a puzzle further on than
 * the frame before saw lands one — and how strongly its white flash lies over the world now.
 */
function impactOf(source: FrameSource, now: number): Pick<Frame, 'flash'> {
  const { kit } = source;
  const { view, reduced } = source.live.current;
  kit.solves = solvesAt(kit.solves, view.currentPuzzleIndex, now);
  return { flash: flashAt(kit.solves.at, now, reduced) };
}

/**
 * `frame`, or for HIT_STOP_MS after a solve the frame it came on, as far as the hit-stop holds
 * it (render/frame.ts HeldFrame): the camera, the world's clocks and the crew as they were.
 */
function held(source: FrameSource, frame: Frame): Frame {
  const { kit } = source;
  if (!holding(kit.solves?.at ?? null, frame.now, frame.reduced)) {
    kit.held = null;
    return frame;
  }
  if (kit.held === null) {
    // The simulation moves you and the rest in place: what is held is a copy of where they were.
    const { camera, grid, steady, time, pulse, burn, walkPhase, facings } = frame;
    const self = { ...frame.self };
    const others = new Map([...frame.others].map(([id, other]) => [id, { ...other }]));
    kit.held = { camera, grid, steady, time, pulse, burn, self, walkPhase, others, facings };
  }
  return { ...frame, ...kit.held };
}

/** Device pixels per tile with the whole lab in the picture. */
function wholeZoom(map: WorldMap, w: number, h: number): number {
  return Math.max(14, Math.min(w / (map.width + 0.5), h / (map.height + 0.5)));
}

/** Device pixels per tile with the lab covering the canvas: no black beside it. */
function coverZoom(map: WorldMap, w: number, h: number): number {
  return Math.max(w / map.width, h / map.height);
}

/**
 * Device pixels per tile at `dpr` device pixels a CSS pixel: the audience sees the whole lab, a
 * player the frame set in CSS pixels (viewport.ts `tileCss`), the same at every density — the
 * band below the objective bar holding the drones' reach on a touch screen as on any other.
 */
function zoomFor(source: FrameSource, map: WorldMap, dpr: number): number {
  const { canvas, insets } = source;
  if (source.spectator) {
    return wholeZoom(map, canvas.width, canvas.height);
  }
  const framing = { height: canvas.height / dpr, bar: insets.bar, touch: source.touchPad.matches };
  return tileCss(framing) * dpr;
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
  const near = zoomFor(source, map, dpr);
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
  const top = sim.topCss * dpr * (1 - pull);
  // On a touch screen the avatar stands clear above the pad and the buttons in the corners.
  const touch = source.touchPad.matches && !spectator;
  const lift = touch ? liftAbove(source.insets.bottom * dpr, h, top, s) * (1 - pull) : 0;
  sim.draw = clampCamera(map, pulledBack(sim, map, pull), { scale: s, w, h, top, lift });
  sim.scale = s;
  return s;
}

/** The world's text at this zoom and text size, worked out again only where either changed. */
function textAt(source: FrameSource, s: number, dpr: number): WorldText {
  const { texts } = source;
  const scale = source.live.current.textScale;
  if (texts.s !== s || texts.dpr !== dpr || texts.scale !== scale) {
    Object.assign(texts, { s, dpr, scale, styles: worldText(s, dpr, scale) });
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
  const controls = insets.controls.map((box) => scaled(box, dpr));
  const viewport: Viewport = {
    w,
    h,
    dpr,
    textScale: source.live.current.textScale,
    top: insets.top * dpr,
    boxes: minimap === null ? controls : [minimapBox(minimap, dpr), ...controls],
  };
  const text = textAt(source, scale, dpr);
  return { viewport, ...framing(source, scale, pull), minimap, text };
}

/** `box`, CSS pixels, in device pixels at `dpr`. */
function scaled(box: Box, dpr: number): Box {
  return {
    left: box.left * dpr,
    top: box.top * dpr,
    right: box.right * dpr,
    bottom: box.bottom * dpr,
  };
}

/** How far the light has turned red on this screen: from the escape's start; warm once won. */
function escapeRed(live: Latest, now: number): number {
  const since = live.escapeSince;
  if (since === null || live.finale?.ending === 'won') {
    return 0;
  }
  return redShift(now - since);
}

/**
 * The colour grade of this frame (grade.ts), turning in the kit from the phase the frame before
 * stood in: the lab with its power, the blackout, the escape, a run won.
 */
function gradeOf(source: FrameSource, scene: ColdOpenFrame, now: number): Wash {
  const live = source.live.current;
  const phase = gradePhase({
    powered: scene.lit,
    escaping: live.escapeSince !== null,
    won: live.finale?.ending === 'won',
  });
  const { turn, wash } = gradeAt(source.kit.grade, phase, now);
  source.kit.grade = turn;
  return wash;
}

/** The frame's light and what it follows. */
type Lighting =
  | 'scene'
  | 'blackoutAt'
  | 'whole'
  | 'escapeSince'
  | 'red'
  | 'hatch'
  | 'grade'
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
  const { clips } = source;
  const { census } = source.kit;
  const reduced = live.reduced;
  const lights = { map, sim, drones, spectator, run, now, hatch, mounts, clips, reduced, census };
  const light = frameLight(lights, scene.lit, whole > 0);
  const red = escapeRed(live, now);
  const litTiles = sim.litTiles;
  const blackoutAt = live.darkSince === null ? null : live.darkSince + FLICKER_MS;
  const lit = sim.lit;
  const grade = gradeOf(source, scene, now);
  return { scene, blackoutAt, whole, escapeSince, red, hatch, grade, light, mounts, litTiles, lit };
}

/** The view's people and the drones, as this frame draws them. */
type Crew =
  | 'youId'
  | 'youName'
  | 'players'
  | 'signSeen'
  | 'timeLeft'
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
    timeLeft: timeLeft(view),
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
): Pick<Frame, 'perf' | 'chats' | 'captions' | 'markers' | 'action' | 'refusal'> {
  if (ending !== null || hud === 0) {
    return { perf, chats: [], captions: [], markers: [], action: null, refusal: null };
  }
  const { sim } = source;
  const { view, locked } = source.live.current;
  sim.captions = sim.captions.filter((c) => sim.time - c.at < CAPTION_SECONDS);
  const chats = liveChats(source, perf);
  const crew = positionsOf(source.positions.current, sim.run);
  // A drone closing in glows at the edge toward it (danger.ts), beside the places to walk to.
  const danger = dangerMarker();
  const targets = markerTargets(map, view.you.id, sim.self, crew);
  const markers = danger === null ? targets : [...targets, danger];
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
  const refusal = locked ? null : refusalAt(sim.presses, perf);
  return { perf, chats, captions: sim.captions, markers, action, refusal };
}

/** How the crew stands for an ending on screen: celebrating a run won, slumped over one lost. */
function moodOf(finale: FinaleCue | null): FigureMood {
  if (finale === null) {
    return 'play';
  }
  return finale.ending === 'won' ? 'celebrate' : 'slump';
}

/** How long one of the crew stands still at a station or a source before it shows them busy. */
const BUSY_AFTER_MS = 300;

/**
 * What each of the crew is busy with where they stand (figure.ts FigureTask): you as the view
 * tells it — reading a source with its pages open, at a station's console standing still — the
 * rest as their place says (presence.ts presenceNear), once they have stood still a moment.
 */
function tasksOf(source: FrameSource, map: WorldMap): Map<string, FigureTask> {
  const { sim, kit } = source;
  const { view, locked } = source.live.current;
  const busy: [string, FigureTask][] = [[view.you.id, yourTask(view.presence, sim, locked)]];
  const now = sim.time * 1000;
  for (const [id, other] of sim.others) {
    const still = kit.still.get(id);
    if (still !== undefined && now - still >= BUSY_AFTER_MS && !other.moving) {
      busy.push([id, taskAt(presenceNear(map, { x: other.rx, y: other.ry }))]);
    }
  }
  return new Map(busy.filter(([, task]) => task !== null));
}

/** What you are busy with as the view tells it: your pages open at a source, at a console. */
function yourTask(presence: Whereabouts, sim: Sim, locked: boolean): FigureTask {
  if (presence.manualId !== null && locked && presence.stationId === null) {
    return 'reading';
  }
  return presence.stationId !== null && !sim.self.moving ? 'console' : null;
}

/** What somebody standing still where `at` says is busy with: reading at a source, a console. */
function taskAt(at: Whereabouts): FigureTask {
  if (at.manualId !== null) {
    return 'reading';
  }
  return at.stationId !== null ? 'console' : null;
}

/**
 * The way each of the crew shows itself facing (figure.ts turnOf): turning round in steps where
 * one came to face the other side of the picture, kept in the kit from frame to frame.
 */
function facingsOf(source: FrameSource, youId: string): Map<string, number> {
  const { sim, kit } = source;
  const now = sim.time * 1000;
  const reduced = source.live.current.reduced;
  const facings = new Map<string, number>();
  const crew: [string, number][] = [[youId, sim.self.facing]];
  for (const [id, other] of sim.others) {
    crew.push([id, other.facing]);
  }
  for (const [id, facing] of crew) {
    const turn = turnOf(kit.turns.get(id) ?? null, facing, now, reduced);
    kit.turns.set(id, turn);
    facings.set(id, shownFacing(turn, now));
  }
  return facings;
}

/**
 * What the crew's figures stand by this frame (figure.ts): what each of the
 * crew carries, by the view's items; since when each has stood still, kept
 * in the kit from frame to frame — you as you steer yourself, the rest as
 * they stream in; the mood the run's end puts them in; what each is busy
 * with, and the way each shows itself facing.
 */
function figuresOf(
  source: FrameSource,
  map: WorldMap,
): Pick<Frame, 'carrying' | 'stillSince' | 'mood' | 'tasks' | 'facings'> {
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
  const carrying = new Map<string, PartKind>();
  for (const item of map.items.filter(known)) {
    if (item.carriedBy !== null && !item.delivered) {
      carrying.set(item.carriedBy, item.kind);
    }
  }
  const tasks = tasksOf(source, map);
  const facings = facingsOf(source, view.you.id);
  return { carrying, stillSince: kit.still, mood: moodOf(finale), tasks, facings };
}
