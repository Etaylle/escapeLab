import { useEffect, useRef, useState, type RefObject } from 'react';
import { crewPass } from '../pass.js';
import { addProbes } from '../probes.js';
import { reducedMotion, watchMotion } from '../settings.js';
import { useVoice } from '../voice/useVoice.js';
import { figurePhase } from '../world/figure.js';
import { traceRequested } from '../world/frameTrace.js';
import {
  heroPlace,
  heroPose,
  HERO_FACING,
  type HeroPlace,
  type StageFacts,
} from '../world/menu/hero.js';
import { freeHero, heroCanvas, paintHero, type HeroCanvas } from '../world/menu/heroArt.js';
import { browserSceneHost, runScene, type SceneHost } from '../world/menu/loop.js';
import { MAX_DENSITY } from '../world/render/backing.js';
import { WAVE_SETTLE_MS } from './ProfileChip.js';

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
  /** how often its canvas changed, and each of its layers was drawn anew */
  laid: number;
  drawn: { legs: number; upper: number };
}

/** What the hero shows besides the clock, as the menu has it on each render. */
interface HeroLook {
  /** the colour the profile shows */
  color: string;
  /** the microphone is on and sends */
  speaking: boolean;
  /** when the name last settled anew, ms by the page's clock; null for never */
  waveAt: number | null;
}

/** `value` once it has stood still for `ms`; as it was first, until then. */
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** When `settled` last changed, by the page's clock — not as the hero came up; null for never. */
function useChangedAt(settled: string): RefObject<number | null> {
  const at = useRef<number | null>(null);
  const was = useRef(settled);
  useEffect(() => {
    if (settled !== was.current) {
      was.current = settled;
      at.current = performance.now();
    }
  }, [settled]);
  return at;
}

/** Whether the microphone is on and sends: open, or the talk key held. */
function useSends(): boolean {
  const state = useVoice()?.state;
  return state !== undefined && state.mic === 'on' && (state.open || state.held);
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

/** A canvas `width` × `height` of the page's own: the hero's layers. */
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
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
    laid: 0,
    drawn: { legs: 0, upper: 0 },
  };
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

/** Where the hero stands, kept as the stage is measured, and the stage's corner in the window. */
interface Standing {
  place: HeroPlace | null;
  at: { x: number; y: number };
}

/** Notes where the hero stands (`standing`) on the probe. */
function probePlace(probe: HeroProbe, { place, at }: Standing): void {
  if (place === null) {
    Object.assign(probe, { shown: false, tiles: 0, scale: 0, box: null, feet: null });
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

/** What a hero's painter draws on and reads. */
export interface HeroPainting {
  hero: HeroCanvas;
  standing: Standing;
  look: { readonly current: HeroLook };
  probe: HeroProbe;
  /** its own offset into its loops (figure.ts figurePhase of the pass's id) */
  phase: number;
  /** whether the player asks for less motion now */
  reduced: () => boolean;
}

/**
 * What paints the hero on each frame of its loop, up `since` (ms, the page's clock): its pose as
 * it stands now, laid from its layers (heroArt.ts). Says whether it moves on: never under
 * reduced motion, which holds it still until something it shows changes and wakes it.
 */
export function heroPainter(on: HeroPainting, since: number): (now: number) => boolean {
  return (now) => {
    const { place } = on.standing;
    if (place === null) {
      return false;
    }
    const look = on.look.current;
    const reduced = on.reduced();
    const cues = { phase: on.phase, speaking: look.speaking, waveAt: look.waveAt, reduced };
    const pose = heroPose(cues, now, since);
    const dpr = Math.min(MAX_DENSITY, window.devicePixelRatio || 1);
    if (paintHero(on.hero, { place, pose, color: look.color, dpr })) {
      on.probe.laid += 1;
    }
    Object.assign(on.probe, {
      glance: pose.look - HERO_FACING,
      bob: pose.bob,
      waving: pose.arms !== null,
      speaking: pose.shimmer !== null,
      drawn: { ...on.hero.drawn },
    });
    return !reduced;
  };
}

/**
 * Starts the hero on `canvas` as the menu shows it: measured on its stage, painted by a loop of
 * its own no more than 30 times a second while its canvas shows (world/menu/loop.ts), woken as
 * the stage, the motion or what the menu hands it change. Returns its end and its waking.
 */
function startHero(
  canvas: HTMLCanvasElement,
  look: { readonly current: HeroLook },
  host: SceneHost,
): { stop: () => void; wake: () => void } | null {
  const hero = heroCanvas(canvas, makeCanvas);
  if (hero === null) {
    return null;
  }
  const probe = emptyProbe();
  const standing: Standing = { place: null, at: { x: 0, y: 0 } };
  const phase = figurePhase(crewPass().id);
  const on = { hero, standing, look, probe, phase, reduced: reducedMotion };
  const loop = runScene(heroPainter(on, performance.now()), host);
  const unprobe = probed(probe);
  const unwatchStage = watchStage(canvas, standing, () => {
    probePlace(probe, standing);
    loop.wake();
  });
  const unwatchMotion = watchMotion(() => loop.wake());
  return {
    wake: loop.wake,
    stop: () => {
      loop.stop();
      unwatchStage();
      unwatchMotion();
      unprobe();
      freeHero(hero);
    },
  };
}

/**
 * The hero (docs/art-bible.md „The hero"): the player's own crew figure standing large at the
 * right of the menu's stage, in front of the drifting lab, in the colour the profile shows — the
 * profile's own small figure stays, standing for it where the stage leaves no room — facing the
 * menu: breathing, glancing round now and then, a light across its visor while the microphone
 * sends, waving as a new name settles in the profile. Its canvas lies over the stage at the
 * stage's density, under every panel, catching no pointer; it moves no more than 30 times a
 * second, only while it shows, and holds one still pose under reduced motion.
 */
export function MenuHero({ name, color }: { name: string; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wake = useRef<(() => void) | null>(null);
  const waveAt = useChangedAt(useSettled(name.trim(), WAVE_SETTLE_MS));
  const speaking = useSends();
  const look = useRef<HeroLook>({ color, speaking, waveAt: null });
  useEffect(() => {
    look.current = { color, speaking, waveAt: waveAt.current };
    wake.current?.();
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    const started = canvas === null ? null : startHero(canvas, look, browserSceneHost(canvas));
    wake.current = started?.wake ?? null;
    return () => {
      wake.current = null;
      started?.stop();
    };
  }, []);
  return <canvas ref={canvasRef} className="menu-hero" aria-hidden="true" hidden />;
}
