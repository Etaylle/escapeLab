import { addProbes } from '../../probes.js';
import { frameTrace, traceRequested } from '../frameTrace.js';
import { censusTrace, lightCensus, type LightCensus } from '../render/census.js';
import { driftAt } from './drift.js';
import { heroTile } from './hero.js';
import { heroLamp, lampKey, watchLamp } from './lamp.js';
import { freeBeam, layBeam, sceneBeam } from './lampArt.js';
import { browserSceneHost, runScene } from './loop.js';
import {
  bakeScene,
  clearShow,
  freeCanvas,
  needsPaint,
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
 * fetched and baked (scene.ts), drawn by the scene's loop (loop.ts) as the drift goes —
 * coming in over the lab before — and baked anew once the canvas has held a new size for a
 * moment; over it the beam of the lamp the menu's hero holds, where one does (lamp.ts,
 * lampArt.ts). Under reduced motion the loop stops once the still is drawn, until a lab is baked
 * anew, the hero's lamp moves or the motion changes. Under `?trace=1` the walkthrough reads the
 * frames off the page as it does a run's (frameTrace.ts), what the scene shows (`SceneProbe`),
 * and what its light worked out a frame (render/census.ts): no sight ever — a frame copies its
 * bake — and a bake only as one is made.
 */

/** How long the canvas's box holds still before the scene is baked anew for it, ms. */
const SETTLE_MS = 150;

/** The scene on its canvas: what it shows, and its end. */
export interface SceneStage {
  /** brings mission `missionId`'s lab in over the one shown; null keeps that one */
  show(missionId: string | null): void;
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
}

/** A canvas `width` × `height` of the page's own: the beam's. */
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
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

/**
 * Opens the scene on `canvas`: nothing shows until a mission is asked for; `motion` says,
 * frame by frame, whether the player asked for less motion — the drift then stands still.
 */
export function openStage(canvas: HTMLCanvasElement, motion: StageMotion): SceneStage {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return { show: () => undefined, close: () => undefined };
  }
  const show: SceneShow = { bake: null, from: null, since: 0, drawn: null };
  const probe: SceneProbe = {
    missionId: null,
    baked: null,
    bakeMs: null,
    progress: 0,
    paints: 0,
    beam: { laid: false, turns: 0 },
  };
  const census = lightCensus();
  const beam = sceneBeam(makeCanvas);
  let lab: SceneLab | null = null;
  let wanted: string | null = null;
  let closed = false;
  let driftFrom = 0;
  let laidBeam: string | null = null;

  // Lays the hero's beam over the lab just drawn, as its lamp is now.
  const lay = (now: number, still: boolean): void => {
    const lamp = heroLamp();
    const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
    const tile = heroTile(canvas.clientHeight);
    layBeam(ctx, beam, lamp, { dpr, tile, now, reduced: still });
    laidBeam = lampKey(lamp);
    probe.beam = { laid: lamp !== null && lamp.on > 0, turns: beam.turns };
  };

  // Draws a frame where one is due; says whether the next would draw anything.
  const paint = (now: number): boolean => {
    const still = motion.reduced();
    const relit = show.bake !== null && lampKey(heroLamp()) !== laidBeam;
    if (needsPaint(show, now, still) || relit) {
      paintShow(ctx, show, now, now - driftFrom, still);
      lay(now, still);
      probe.paints += 1;
      probe.progress = driftAt(now - driftFrom, still);
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
    if (show.bake === null) driftFrom = now;
    showBake(show, bake, now, fade);
    probe.missionId = lab.missionId;
    probe.baked = { w: bake.w, h: bake.h, boxW: bake.box.width, boxH: bake.box.height };
    loop.wake();
  };

  const unwatch = onSettledResize(canvas, () => rebake(false));
  const unwatchMotion = motion.watch(() => loop.wake());
  const unwatchLamp = watchLamp(() => loop.wake());
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
    close() {
      closed = true;
      loop.stop();
      unwatch();
      unwatchMotion();
      unwatchLamp();
      traced.drop();
      clearShow(show);
      freeBeam(beam);
      freeCanvas(canvas);
    },
  };
}
