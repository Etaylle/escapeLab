import { addProbes } from '../../probes.js';
import { TAU } from '../brush.js';
import { figurePhase, type FigurePose } from '../figure.js';
import { traceRequested } from '../frameTrace.js';
import { MAX_DENSITY } from '../render/backing.js';
import {
  FIGURE_TALL,
  heroPlace,
  heroPose,
  HERO_FACING,
  stepped,
  type HeroPlace,
  type StageFacts,
} from './hero.js';
import { freeHero, heroCanvas, paintHero, type HeroCanvas } from './heroArt.js';
import {
  holdLamp,
  LAMP_STEP,
  lensAt,
  newSweep,
  reachOf,
  stepSweep,
  STILL_ANGLE,
  tiltOf,
  type Sweep,
} from './lamp.js';
import { runScene, type SceneHost } from './loop.js';

/**
 * The hero on the menu's stage (screens/MenuHero.tsx): its canvas placed on the stage as it is
 * measured (hero.ts), what the player attends to of the menu — the item hovered or in the focus
 * — the loop that paints it (heroArt.ts), the lamp it holds out to the scene's canvas (lamp.ts),
 * and what the walkthrough reads of it.
 */

/** What the walkthrough reads of the hero (`window.__escapelab.hero`, under `?trace=1`). */
export interface HeroProbe {
  /** whether it stands on the stage: false where the stage leaves it no room */
  shown: boolean;
  /** how tall it stands, scene tiles, and CSS px a figure unit */
  tiles: number;
  scale: number;
  /** its canvas's box and its feet in the window, CSS px; null while it is not shown */
  box: { left: number; top: number; width: number; height: number } | null;
  feet: { x: number; y: number } | null;
  /** how far its look is turned from its facing, radians, and its breath, tiles up */
  glance: number;
  bob: number;
  waving: boolean;
  speaking: boolean;
  /** what of the menu the player attends to: an item by its id, `card`; null for nothing */
  attends: string | null;
  /**
   * its lamp's beam: its lens in the window and how far its light reaches, CSS px; where it
   * points, holding a beat or sweeping; how far it is on
   */
  beam: {
    lens: { x: number; y: number };
    reach: number;
    angle: number;
    holding: boolean;
    on: number;
  } | null;
  /** how often its canvas changed, and each of its layers was drawn anew */
  laid: number;
  drawn: { legs: number; upper: number };
}

/** What the hero shows besides the clock, as the menu has it on each render. */
export interface HeroLook {
  /** the colour the profile shows */
  color: string;
  /** the microphone is on and sends */
  speaking: boolean;
  /** when the name last settled anew, ms by the page's clock; null for never */
  waveAt: number | null;
}

/** The stage `stage` and what stands on it, CSS px; null while it has no box or no menu. */
export function stageFacts(stage: HTMLElement): StageFacts | null {
  const box = stage.getBoundingClientRect();
  const body = stage.querySelector('.menu-body')?.getBoundingClientRect();
  const chip = stage.querySelector('.profile-chip')?.getBoundingClientRect();
  if (body === undefined || chip === undefined || box.width === 0 || box.height === 0) {
    return null;
  }
  return {
    w: box.width,
    h: box.height,
    windowH: window.innerHeight,
    padBottom: parseFloat(getComputedStyle(stage).paddingBottom) || 0,
    menuRight: body.right - box.left,
    chipBottom: chip.bottom - box.top,
  };
}

/** Puts the hero's canvas on its box in the stage, or hides it where it stands nowhere. */
function placeCanvas(canvas: HTMLCanvasElement, place: HeroPlace | null): void {
  canvas.hidden = place === null;
  if (place !== null) {
    const { left, top, width, height } = place.box;
    Object.assign(canvas.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  }
}

/** Where the hero stands, kept as the stage is measured: its place, the stage in the window. */
export interface Standing {
  place: HeroPlace | null;
  /** the stage's corner in the window, CSS px */
  at: { x: number; y: number };
  /** where the menu's column ends, from the stage's left, CSS px: the beam stops short of it */
  menuRight: number;
}

/**
 * Measures the stage the hero's canvas stands on, and again whenever it or the profile change
 * size or the window does: the hero placed anew, `changed` told.
 */
function watchStage(
  canvas: HTMLCanvasElement,
  standing: Standing,
  changed: () => void,
): () => void {
  const stage = canvas.parentElement;
  if (stage === null) {
    return () => undefined;
  }
  const measure = (): void => {
    const facts = stageFacts(stage);
    const box = stage.getBoundingClientRect();
    standing.place = facts === null ? null : heroPlace(facts);
    standing.at = { x: box.left, y: box.top };
    standing.menuRight = facts?.menuRight ?? 0;
    placeCanvas(canvas, standing.place);
    changed();
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  observer?.observe(stage);
  const chip = stage.querySelector('.profile-chip');
  if (chip !== null) observer?.observe(chip);
  window.addEventListener('resize', measure);
  measure();
  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', measure);
  };
}

/** Something of the menu the player attends to: what it is, and its middle in the window. */
export interface Attended {
  /** a menu item by its id (MainMenu.tsx `data-item`), or `card`: a run's card */
  id: string;
  x: number;
  y: number;
}

/** The menu's item or card `target` lies in, as attended; null where it lies in neither. */
export function attendedOf(target: EventTarget | null): Attended | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const found = target.closest('.menu-item, .bound');
  if (found === null) {
    return null;
  }
  const box = found.getBoundingClientRect();
  const id = found instanceof HTMLElement ? (found.dataset['item'] ?? 'card') : 'card';
  return { id, x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/**
 * Follows what of the menu on `stage` the player attends to — the item or card the pointer is
 * over, else the one in the focus — and tells `changed` of it as it changes.
 */
function watchAttention(
  stage: HTMLElement,
  changed: (attended: Attended | null) => void,
): () => void {
  let hovered: Attended | null = null;
  let focused: Attended | null = null;
  const tell = (): void => changed(hovered ?? focused);
  const over = (e: Event): void => {
    hovered = attendedOf(e.target);
    tell();
  };
  const left = (): void => {
    hovered = null;
    tell();
  };
  const focus = (e: Event): void => {
    focused = attendedOf(e.target);
    tell();
  };
  const blurred = (): void => {
    focused = null;
    tell();
  };
  const events = [
    ['pointerover', over],
    ['pointerleave', left],
    ['focusin', focus],
    ['focusout', blurred],
  ] as const;
  for (const [type, listener] of events) stage.addEventListener(type, listener);
  focused = attendedOf(document.activeElement);
  tell();
  return () => {
    for (const [type, listener] of events) stage.removeEventListener(type, listener);
  };
}

/** The angle from the window's point `from` to `to`, 0 to a full turn, as the sweep counts. */
function angleTo(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  return angle < 0 ? angle + TAU : angle;
}

/** What a hero's painter draws on and reads. */
export interface HeroPainting {
  hero: HeroCanvas;
  standing: Standing;
  look: { readonly current: HeroLook };
  /** what of the menu the player attends to now; null for nothing */
  attends: { current: Attended | null };
  sweep: Sweep;
  probe: HeroProbe;
  /** its own offset into its loops (figure.ts figurePhase of the pass's id) */
  phase: number;
  /** whether the player asks for less motion now */
  reduced: () => boolean;
}

/** The lamp `on` the hero holds at `now`: where it points and how it is turned in the hands. */
interface LampFrame {
  angle: number;
  tilt: number;
  /** its lens in the window, CSS px */
  lens: { x: number; y: number };
  holding: boolean;
}

/**
 * Where the lamp of `on`'s hero points at `now`, standing `place` with its body `bob` figure
 * units up: along its sweep, holding a beat where it comes to the item attended — or still under
 * reduced motion — turned in the hands to the nearest of its steps.
 */
function lampAt(on: HeroPainting, place: HeroPlace, bob: number, now: number): LampFrame {
  const { at } = on.standing;
  const reduced = on.reduced();
  const grip = lensAt(place, tiltOf(STILL_ANGLE), bob);
  const from = { x: grip.x + at.x, y: grip.y + at.y };
  const attended = on.attends.current;
  const target = attended === null ? null : angleTo(from, attended);
  const angle = reduced ? STILL_ANGLE : stepSweep(on.sweep, now, target);
  const tilt = stepped(tiltOf(angle), LAMP_STEP);
  const lens = lensAt(place, tilt, bob);
  const holding = !reduced && on.sweep.hold !== null;
  return { angle, tilt, lens: { x: lens.x + at.x, y: lens.y + at.y }, holding };
}

/** Notes on the probe how the hero stands (`pose`) and where its lamp points (`lamp`). */
function probePose(on: HeroPainting, pose: FigurePose, lamp: LampFrame, reach: number): void {
  Object.assign(on.probe, {
    glance: pose.look - HERO_FACING,
    bob: pose.bob,
    waving: pose.arms !== null && pose.arms.front > 1.4,
    speaking: pose.shimmer !== null,
    attends: on.attends.current?.id ?? null,
    beam: { lens: lamp.lens, reach, angle: lamp.angle, holding: lamp.holding, on: 1 },
    drawn: { ...on.hero.drawn },
  });
}

/**
 * What paints the hero on each frame of its loop, up `since` (ms, the page's clock): its pose as
 * it stands now, laid from its layers (heroArt.ts), and the lamp it holds out to the scene's
 * canvas. Says whether it moves on: never under reduced motion, which holds it still until
 * something it shows changes and wakes it.
 */
export function heroPainter(on: HeroPainting, since: number): (now: number) => boolean {
  return (now) => {
    const { place } = on.standing;
    if (place === null) {
      holdLamp(null);
      return false;
    }
    const look = on.look.current;
    const reduced = on.reduced();
    const cues = { phase: on.phase, speaking: look.speaking, waveAt: look.waveAt, reduced };
    const pose = heroPose(cues, now, since);
    const lamp = lampAt(on, place, pose.bob, now);
    const dpr = Math.min(MAX_DENSITY, window.devicePixelRatio || 1);
    const frame = { place, pose, color: look.color, dpr, lamp: { tilt: lamp.tilt, on: 1 } };
    if (paintHero(on.hero, frame)) {
      on.probe.laid += 1;
    }
    const lensX = lamp.lens.x - on.standing.at.x;
    const reach = reachOf(FIGURE_TALL * place.scale, lensX, on.standing.menuRight);
    holdLamp({ ...lamp.lens, angle: lamp.angle, reach, on: 1 });
    probePose(on, pose, lamp, reach);
    return !reduced;
  };
}

/** The hero as it stands for the probe: nothing shown yet. */
function emptyProbe(): HeroProbe {
  return {
    shown: false,
    tiles: 0,
    scale: 0,
    box: null,
    feet: null,
    glance: 0,
    bob: 0,
    waving: false,
    speaking: false,
    attends: null,
    beam: null,
    laid: 0,
    drawn: { legs: 0, upper: 0 },
  };
}

/** Notes where the hero stands (`standing`) on the probe. */
function probePlace(probe: HeroProbe, { place, at }: Standing): void {
  if (place === null) {
    Object.assign(probe, { shown: false, tiles: 0, scale: 0, box: null, feet: null, beam: null });
    return;
  }
  const { box, feet } = place;
  Object.assign(probe, {
    shown: true,
    tiles: place.tiles,
    scale: place.scale,
    box: { ...box, left: box.left + at.x, top: box.top + at.y },
    feet: { x: feet.x + at.x, y: feet.y + at.y },
  });
}

/** Puts `probe` on the page under `?trace=1`; returns what takes it off again. */
function probed(probe: HeroProbe): () => void {
  if (!traceRequested(location.search)) {
    return () => undefined;
  }
  return addProbes({
    get hero() {
      return structuredClone(probe);
    },
  });
}

/** A canvas `width` × `height` of the page's own: the hero's layers. */
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** A hero started on its canvas: what wakes its loop, and its end. */
export interface HeroRun {
  wake: () => void;
  stop: () => void;
}

/**
 * Starts the hero on `canvas` as the menu shows it: measured on its stage, painted by a loop of
 * its own no more than 30 times a second while its canvas shows (loop.ts), woken as the stage,
 * the motion, what the player attends to or what the menu hands it (`look`) change. `pass` is
 * the browser's pass's id: the hero's own offset into its loops. Null where the browser gives
 * no 2D canvas.
 */
export function startHero(
  canvas: HTMLCanvasElement,
  [look, pass]: readonly [{ readonly current: HeroLook }, string],
  host: SceneHost,
  motion: { reduced: () => boolean; watch: (changed: () => void) => () => void },
): HeroRun | null {
  const hero = heroCanvas(canvas, makeCanvas);
  const stage = canvas.parentElement;
  if (hero === null || stage === null) {
    return null;
  }
  const probe = emptyProbe();
  const standing: Standing = { place: null, at: { x: 0, y: 0 }, menuRight: 0 };
  const attends: { current: Attended | null } = { current: null };
  const phase = figurePhase(pass);
  const on = { hero, standing, look, attends, sweep: newSweep(), probe, phase };
  const loop = runScene(heroPainter({ ...on, reduced: motion.reduced }, performance.now()), host);
  const unprobe = probed(probe);
  const unwatch = [
    watchStage(canvas, standing, () => {
      probePlace(probe, standing);
      loop.wake();
    }),
    watchAttention(stage, (attended) => {
      attends.current = attended;
      loop.wake();
    }),
    motion.watch(() => loop.wake()),
  ];
  return {
    wake: loop.wake,
    stop: () => {
      loop.stop();
      unwatch.forEach((stop) => stop());
      unprobe();
      holdLamp(null);
      freeHero(hero);
    },
  };
}
