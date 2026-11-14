import { useEffect, useRef } from 'react';
import { addProbes } from '../probes.js';
import { reducedMotion } from '../settings.js';
import { drawScientist } from '../world/art.js';
import {
  figurePhase,
  figurePose,
  type FigureMood,
  type FigurePose,
  type FigureState,
} from '../world/figure.js';
import { traceRequested } from '../world/frameTrace.js';

/** Which way a crew member looks: toward the middle of the row, or out of the room. */
export type Facing = 'left' | 'right' | 'front';

interface Props {
  /** the player's id: their own offset into the figure's loops */
  id: string;
  color: string;
  facing: Facing;
  isYou: boolean;
  connected: boolean;
  /** how the figure stands: in the lobby, outside after a run won, in the dark after one lost */
  mood: FigureMood;
  /** they talk right now: a light sweeps across the visor */
  speaking?: boolean;
  /** they have said they are ready: the figure waves as it turns true */
  ready?: boolean;
}

/**
 * Tiles the canvas reaches above and below the feet: up past the dome and,
 * in the lobby, the hand raised in a wave — on a won card past a jump with
 * the arms up — and down past the shadow and the ring under your own
 * figure. lobby.css makes a seat's canvas 0.85 times as wide as it is tall:
 * a hand waving stays inside it.
 */
const ABOVE: Readonly<Record<FigureMood, number>> = { play: 0.95, slump: 0.9, celebrate: 1.13 };
const BELOW = 0.16;

/** Facing angles as the art takes them: 0 right, PI/2 toward the viewer. */
const FACING: Readonly<Record<Facing, number>> = {
  right: 0.55,
  left: Math.PI - 0.55,
  front: Math.PI / 2,
};

/** The longest a figure's loop goes between two drawings: no more than 30 a second. */
export const FIGURE_FRAME_MS = 1000 / 30;
/** A frame of a 60 Hz screen may come this much early and still count as the next. */
const FRAME_SLACK_MS = 1;

/** What the figure shows, as its loop reads it on each drawing. */
export interface FigureLook {
  color: string;
  facing: Facing;
  isYou: boolean;
  connected: boolean;
  mood: FigureMood;
  speaking: boolean;
  /** its offset into the loops (figurePhase of the player's id) */
  phase: number;
}

/**
 * How a figure standing in the lobby or on a title card is, `ms` after it
 * came up: standing still since then — so it looks round after a while —
 * waving `readyAgoMs` after its player said ready, never carrying, never
 * flinching.
 */
export function figureStateOf(
  look: FigureLook,
  ms: number,
  readyAgoMs: number | null,
  reduced: boolean,
): FigureState {
  return {
    moving: false,
    facing: FACING[look.facing],
    carrying: null,
    speaking: look.speaking,
    alarmAgoMs: null,
    readyAgoMs,
    mood: look.mood,
    t: ms,
    idleMs: ms,
    phase: look.phase,
    walk: 0,
    task: null,
    reduced,
  };
}

/** What a figure's loop needs of the page; the component hands it the browser's. */
export interface FigureHost {
  /** asks for the next animation frame, as requestAnimationFrame does */
  frame: (run: (now: number) => void) => number;
  cancel: (handle: number) => void;
  /** reports whether the canvas shows on screen, now and on every change; returns the stop */
  watch: (seen: (shown: boolean) => void) => () => void;
}

/** A figure's loop at work: what starts it again once the figure has held still, and its end. */
export interface FigureLoop {
  /** asks for frames again — what the figure shows may have changed — wherever it shows */
  wake(): void;
  stop(): void;
}

/**
 * Runs a figure's canvas: while it shows on screen an animation loop paints
 * it, no more than 30 times a second. `paint` says whether the figure moves
 * on: once it holds still, under reduced motion, the loop asks no more frames
 * until it is woken. Hidden, the loop stops too, and it starts again when the
 * canvas shows.
 */
export function runFigure(paint: (now: number) => boolean, host: FigureHost): FigureLoop {
  let handle: number | null = null;
  let shown = false;
  let last = Number.NEGATIVE_INFINITY;
  const start = (): void => {
    if (shown && handle === null) {
      handle = host.frame(tick);
    }
  };
  const tick = (now: number): void => {
    handle = null;
    const due = now - last >= FIGURE_FRAME_MS - FRAME_SLACK_MS;
    if (due) {
      last = now;
    }
    if (!due || paint(now)) {
      start();
    }
  };
  const halt = (): void => {
    if (handle !== null) {
      host.cancel(handle);
      handle = null;
    }
  };
  const unwatch = host.watch((seen) => {
    shown = seen;
    if (seen) {
      start();
    } else {
      halt();
    }
  });
  return {
    wake: start,
    stop: () => {
      unwatch();
      shown = false;
      halt();
    },
  };
}

/** The browser's frames, and whether `canvas` lies in the window (shown where nobody can tell). */
function browserHost(canvas: HTMLCanvasElement): FigureHost {
  return {
    frame: (run) => requestAnimationFrame(run),
    cancel: (handle) => cancelAnimationFrame(handle),
    watch: (seen) => {
      if (typeof IntersectionObserver === 'undefined') {
        seen(true);
        return () => undefined;
      }
      const observer = new IntersectionObserver((entries) => {
        seen(entries.at(-1)?.isIntersecting === true);
      });
      observer.observe(canvas);
      return () => observer.disconnect();
    },
  };
}

/** What the walkthrough reads of a figure on the page (`?trace=1`): its last pose. */
export interface FigureProbe {
  color: string;
  mood: FigureMood;
  /** how far it was off the ground, tiles */
  rise: number;
  /** how far its look was turned from its facing by a glance, radians */
  glance: number;
}

/** The figures painted on this page, for the probe; the probe while there are any. */
const painted = new Set<FigureProbe>();
let dropProbe: (() => void) | null = null;

/** Puts `entry` on the page's probe under `?trace=1`; returns what takes it off again. */
function probed(entry: FigureProbe): () => void {
  if (!traceRequested(location.search)) {
    return () => undefined;
  }
  painted.add(entry);
  dropProbe ??= addProbes({
    get figures() {
      return [...painted].map((figure) => ({ ...figure }));
    },
  });
  return () => {
    painted.delete(entry);
    if (painted.size === 0) {
      dropProbe?.();
      dropProbe = null;
    }
  };
}

/** Paints `pose` on `canvas`, sized to its box at the device's pixel ratio. */
function paintFigure(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  look: FigureLook,
  pose: FigurePose,
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(canvas.clientWidth * dpr);
  const height = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const above = ABOVE[look.mood];
  const scale = height / (above + BELOW);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(scale, 0, 0, scale, width / 2, above * scale);
  drawScientist(ctx, {
    color: look.color,
    name: '',
    facing: FACING[look.facing],
    moving: false,
    walkPhase: 0,
    isYou: look.isYou,
    connected: look.connected,
    pose,
  });
}

/** What a figure's painter draws on and reads: its canvas, its look and wave as they stand. */
export interface FigureCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  look: { readonly current: FigureLook };
  /** when the figure last began to wave, by the page's clock; null for never */
  waveAt: { readonly current: number | null };
  probe: FigureProbe;
}

/**
 * What paints a figure on each frame of its loop, `since` it came up: its pose as it stands —
 * under reduced motion only where what it shows has changed, its look or its canvas's size.
 * Says whether the figure moves on: never under reduced motion, which holds it still.
 */
export function figurePainter(
  on: FigureCanvas,
  since: number,
  reduced: boolean,
): (now: number) => boolean {
  let drawn = '';
  return (now) => {
    const o = on.look.current;
    if (reduced) {
      const size = `${on.canvas.clientWidth}x${on.canvas.clientHeight}`;
      const key = `${o.color} ${o.facing} ${o.isYou} ${o.connected} ${o.mood} ${size}`;
      if (key === drawn) {
        return false;
      }
      drawn = key;
    }
    const waved = on.waveAt.current === null ? null : now - on.waveAt.current;
    const pose = figurePose(figureStateOf(o, now - since, waved, reduced));
    paintFigure(on.canvas, on.ctx, o, pose);
    on.probe.color = o.color;
    on.probe.mood = o.mood;
    on.probe.rise = pose.rise;
    on.probe.glance = pose.look - FACING[o.facing];
    return !reduced;
  };
}

/** Whether a figure begins to wave as its player's ready goes from `was` to `now`: turning true. */
export function wavesAnew(was: boolean, now: boolean): boolean {
  return now && !was;
}

/**
 * When the figure last began to wave, by the page's clock: as `ready` turns true while it is
 * up — not when it came up ready.
 */
function useWaveAt(ready: boolean): React.MutableRefObject<number | null> {
  const at = useRef<number | null>(null);
  const was = useRef(ready);
  useEffect(() => {
    if (wavesAnew(was.current, ready)) {
      at.current = performance.now();
    }
    was.current = ready;
  }, [ready]);
  return at;
}

/**
 * A crew member standing in the lobby or on a title card, drawn with the
 * in-game art at the size the stylesheet gives the canvas, as figure.ts poses
 * it: breathing and looking round in the lobby, waving as they say ready, a
 * light across the visor while they speak; jumping on a won card, slumped on
 * a lost one. It moves only while it shows on screen, 30 times a second at
 * most; under reduced motion it holds still, its loop asleep until a render
 * or a new size of its canvas may have changed what it shows. The name is not
 * drawn: the room shows it as a tag above.
 */
export function CrewFigure(props: Props) {
  const { id, color, facing, isYou, connected, mood, speaking = false, ready = false } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const readyAt = useWaveAt(ready);
  const look = useRef<FigureLook>({ color, facing, isYou, connected, mood, speaking, phase: 0 });
  look.current = { color, facing, isYou, connected, mood, speaking, phase: figurePhase(id) };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) {
      return undefined;
    }
    const probe: FigureProbe = { color: '', mood: 'play', rise: 0, glance: 0 };
    const unprobe = probed(probe);
    const on = { canvas, ctx, look, waveAt: readyAt, probe };
    const paint = figurePainter(on, performance.now(), reducedMotion());
    const loop = runFigure(paint, browserHost(canvas));
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(loop.wake);
    resized?.observe(canvas);
    wake.current = loop.wake;
    return () => {
      wake.current = null;
      resized?.disconnect();
      loop.stop();
      unprobe();
    };
  }, [readyAt]);

  // A render may change what a figure holding still shows: it looks again.
  useEffect(() => {
    wake.current?.();
  });

  return <canvas ref={canvasRef} className="seat-figure" aria-hidden="true" />;
}
