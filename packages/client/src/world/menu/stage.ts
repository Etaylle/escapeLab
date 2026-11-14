import { addProbes } from '../../probes.js';
import { domCanvas } from '../atlas.js';
import { frameTrace, traceRequested } from '../frameTrace.js';
import { censusTrace, lightCensus, type LightCensus } from '../render/census.js';
import { cameraAt, newCamera, travelling, type SceneCamera } from './camera.js';
import { driftAt } from './drift.js';
import { heroTile } from './hero.js';
import { heroLamp, labAtNight, lampKey, watchLamp } from './lamp.js';
import { freeBeam, layBeam, sceneBeam, type SceneBeam } from './lampArt.js';
import { browserSceneHost, runScene } from './loop.js';
import { heldPlace, watchPlace } from './places.js';
import {
  bakeScene,
  clearShow,
  freeCanvas,
  goalCorner,
  needsPaint,
  nightTo,
  paintShow,
  sceneBacking,
  sceneLab,
  showBake,
  type SceneBake,
  type SceneLab,
  type SceneShow,
} from './scene.js';

/**
 * The menu's scene on its canvas (screens/MenuScene.tsx): the lab of the mission asked for,
 * fetched and baked (scene.ts), drawn by the scene's loop (loop.ts) as the drift goes — or the
 * camera travels to the place of the menu's item attended (places.ts, camera.ts) —, coming in
 * over the lab before, and baked anew once the canvas has held a new size for a moment; over it
 * the beam of the lamp the menu's hero holds, where one does (lamp.ts, lampArt.ts), the lab sunk
 * to night while a hero stands on the stage (scene.ts `nightTo`). Under reduced motion the loop
 * stops once the still is drawn, until a lab is baked anew, the hero's lamp moves, the place
 * changes — a cut — or the motion does. Under `?trace=1` the walkthrough reads the frames off the
 * page as it does a run's (frameTrace.ts), what the scene shows (`SceneProbe`), and what its light
 * worked out a frame (render/census.ts): no sight ever — a frame copies its bake — and a bake
 * only as one is made.
 */

/** How long the canvas's box holds still before the scene is baked anew for it, ms. */
const SETTLE_MS = 150;

/** The scene on its canvas: what it shows, and its end. */
export interface SceneStage {
  /** brings mission `missionId`'s lab in over the one shown; null keeps that one */
  show(missionId: string | null): void;
  /**
   * the scene stands behind the lobby (`behind`), which lights its lab — no night there — and
   * shows the drift; the camera cuts there and back, as the doors stand shut over the change
   */
  lobby(behind: boolean): void;
  close(): void;
}

/** What the walkthrough reads of the scene (`window.__escapelab.scene`). */
export interface SceneProbe {
  /** the mission whose lab shows; null before the first */
  missionId: string | null;
  /** the canvas the lab is baked for and the box of it baked, device pixels; null before */
  baked: { w: number; h: number; boxW: number; boxH: number } | null;
  /** how long the last bake took, ms */
  bakeMs: number | null;
  /** how far along the opening's shot the drift stood at the last frame drawn, 0 to 1 */
  progress: number;
  /** the frames drawn so far */
  paints: number;
  /** the hero's beam: laid on the last frame drawn, and turned anew so often so far */
  beam: { laid: boolean; turns: number };
  /** the camera: the item whose place it goes to or stands at — null for the drift — and
   * whether it is on its way there */
  camera: { aimed: string | null; travelling: boolean };
  /** whether the lab stood at night at the last frame drawn */
  night: boolean;
}

/** The canvas's size changes: the scene is baked anew once it has held still SETTLE_MS. */
function onSettledResize(canvas: HTMLCanvasElement, settled: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(settled, SETTLE_MS);
        });
  observer?.observe(canvas);
  return () => {
    observer?.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
}

/** The size and density `canvas` draws `lab`'s scene at; null while it has no box. */
function backingOf(
  canvas: HTMLCanvasElement,
  lab: SceneLab,
): ReturnType<typeof sceneBacking> | null {
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    return null;
  }
  return sceneBacking(lab, canvas.clientWidth, canvas.clientHeight, devicePixelRatio);
}

/** Whether `kept` was baked for a canvas `size`: a box that has not changed bakes nothing anew. */
function bakedFor(kept: SceneBake | null, size: { w: number; h: number }): boolean {
  return kept !== null && kept.w === size.w && kept.h === size.h;
}

/** Sizes `canvas`'s backing store to `size` where it differs, as sizing clears it. */
function fitCanvas(canvas: HTMLCanvasElement, size: { w: number; h: number }): void {
  if (canvas.width !== size.w || canvas.height !== size.h) {
    canvas.width = size.w;
    canvas.height = size.h;
  }
}

/** What the scene's trace takes: each animation frame's length, each frame drawn. */
interface SceneTrace {
  record?: (ms: number) => void;
  drawn: () => void;
  drop: () => void;
}

/**
 * Puts the scene's frames, `probe` and the census its light keeps (`census`) on the page under
 * `?trace=1`; returns what records them, and what stops it.
 */
function traceScene(probe: SceneProbe, census: LightCensus): SceneTrace {
  if (!traceRequested(location.search)) {
    return { drawn: () => undefined, drop: () => undefined };
  }
  const trace = frameTrace();
  const work = censusTrace();
  const drop = addProbes({
    get frames() {
      return trace.frames;
    },
    resetFrames: () => trace.resetFrames(),
    get lightWork() {
      return work.work;
    },
    resetLightWork: () => work.reset(),
    get scene() {
      return { ...probe };
    },
  });
  return { record: (ms) => trace.record(ms), drawn: () => work.record(census), drop };
}

/** Whether the player asks for less motion (settings.ts), and its changes. */
export interface StageMotion {
  /** whether things move less now: asked frame by frame, so cheap to ask */
  reduced: () => boolean;
  /** calls `changed` whenever that may have turned; returns the stop */
  watch: (changed: () => void) => () => void;
}

/** What the scene keeps between its frames. */
interface StageState {
  show: SceneShow;
  probe: SceneProbe;
  beam: SceneBeam;
  camera: SceneCamera;
  /** when the drift began, ms (performance.now) */
  driftFrom: number;
  /** the light and the place the last frame was drawn with (`sceneKey`); null before any */
  drawnWith: string | null;
  /** the scene stands behind the lobby: lit, and drifting */
  behindLobby: boolean;
}

/** A stage's state before its first lab. */
function stageState(): StageState {
  const probe: SceneProbe = {
    missionId: null,
    baked: null,
    bakeMs: null,
    progress: 0,
    paints: 0,
    beam: { laid: false, turns: 0 },
    camera: { aimed: null, travelling: false },
    night: false,
  };
  const show = { bake: null, from: null, since: 0, drawn: null };
  const camera = newCamera();
  const beam = sceneBeam(domCanvas);
  return { show, probe, beam, camera, driftFrom: 0, drawnWith: null, behindLobby: false };
}

/** Whether the lab stands at night now: a hero has made it so, and no lobby stands over it. */
const nightNow = (state: StageState): boolean => labAtNight() && !state.behindLobby;

/** The item whose place the scene goes to now: the menu's; none behind the lobby. */
const placeNow = (state: StageState): string | null => (state.behindLobby ? null : heldPlace());

/** What a frame is drawn with besides the clock: the hero's beam, the night, the place. */
const sceneKey = (state: StageState): string =>
  `${lampKey(heroLamp())} ${nightNow(state)} ${placeNow(state)}`;

/** Device px a CSS px of `canvas`: 1 while it has no box. */
const densityOf = (canvas: HTMLCanvasElement): number =>
  canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;

/** Lays the hero's beam over the lab just drawn on `ctx`, as its lamp is now. */
function layLamp(ctx: CanvasRenderingContext2D, state: StageState, now: number, still: boolean) {
  const lamp = heroLamp();
  const dpr = densityOf(ctx.canvas);
  const tile = heroTile(ctx.canvas.clientHeight);
  layBeam(ctx, state.beam, lamp, { dpr, tile, now, reduced: still });
  state.probe.beam = { laid: lamp !== null && lamp.on > 0, turns: state.beam.turns };
}

/**
 * One frame of the scene on `ctx` at `now`: each lab it shows at night or lit, as the hero has
 * it; the camera at the drift or on its way to a place, a cut under less motion (`still`); the
 * lab copied from there, the beam over it.
 */
function drawFrame(ctx: CanvasRenderingContext2D, state: StageState, now: number, still: boolean) {
  const { show, camera, probe } = state;
  const night = nightNow(state);
  for (const bake of [show.bake, show.from]) {
    if (bake !== null) nightTo(bake, night);
  }
  const progress = driftAt(now - state.driftFrom, still);
  const aim = placeNow(state);
  const goal = show.bake === null ? { x: 0, y: 0 } : goalCorner(show.bake, aim, progress);
  const corner = cameraAt(camera, [aim, goal], now, [densityOf(ctx.canvas), still]);
  paintShow(ctx, show, now, { progress, corner });
  layLamp(ctx, state, now, still);
  state.drawnWith = sceneKey(state);
  Object.assign(probe, { paints: probe.paints + 1, progress, night });
  probe.camera = { aimed: camera.aimed, travelling: travelling(camera) };
}

/**
 * Opens the scene on `canvas`: nothing shows until a mission is asked for; `motion` says,
 * frame by frame, whether the player asked for less motion — the drift then stands still.
 */
export function openStage(canvas: HTMLCanvasElement, motion: StageMotion): SceneStage {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return { show: () => undefined, lobby: () => undefined, close: () => undefined };
  }
  const state = stageState();
  const { show, probe, beam } = state;
  const census = lightCensus();
  let lab: SceneLab | null = null;
  let wanted: string | null = null;
  let closed = false;

  // Draws a frame where one is due; says whether the next would draw anything.
  const paint = (now: number): boolean => {
    const still = motion.reduced();
    // A new light or place draws a frame of its own; the camera travels only while the drift
    // moves, and cuts under less motion.
    const changed = show.bake !== null && sceneKey(state) !== state.drawnWith;
    if (needsPaint(show, now, still) || changed) {
      drawFrame(ctx, state, now, still);
      traced.drawn();
    }
    return needsPaint(show, now, still);
  };

  const traced = traceScene(probe, census);
  const loop = runScene(paint, browserSceneHost(canvas), traced.record);

  // Bakes the lab for the canvas's box as it stands: coming in over what shows, or at once.
  const rebake = (fade: boolean): void => {
    const size = lab === null ? null : backingOf(canvas, lab);
    if (lab === null || size === null || (!fade && bakedFor(show.bake, size))) return;
    fitCanvas(canvas, size);
    const from = performance.now();
    const bake = bakeScene(lab, size.w, size.h, size.dpr);
    const now = performance.now();
    probe.bakeMs = now - from;
    if (bake === null) return;
    census.bakes += 1;
    if (show.bake === null) state.driftFrom = now;
    state.camera = newCamera();
    showBake(show, bake, now, fade);
    probe.missionId = lab.missionId;
    probe.baked = { w: bake.w, h: bake.h, boxW: bake.box.width, boxH: bake.box.height };
    loop.wake();
  };

  const unwatch = onSettledResize(canvas, () => rebake(false));
  const unwatchMotion = motion.watch(() => loop.wake());
  const unwatchLamp = watchLamp(() => loop.wake());
  const unwatchPlace = watchPlace(() => loop.wake());
  return {
    show(missionId) {
      wanted = missionId;
      if (missionId === null || missionId === lab?.missionId) return;
      void sceneLab(missionId).then((next) => {
        if (closed || next === null || wanted !== missionId) return;
        lab = next;
        rebake(true);
      });
    },
    lobby(behind) {
      if (behind !== state.behindLobby) state.camera = newCamera();
      state.behindLobby = behind;
      loop.wake();
    },
    close() {
      closed = true;
      loop.stop();
      unwatch();
      unwatchMotion();
      unwatchLamp();
      unwatchPlace();
      traced.drop();
      clearShow(show);
      freeBeam(beam);
      freeCanvas(canvas);
    },
  };
}
