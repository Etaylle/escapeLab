import { useEffect, useRef } from 'react';
import { addProbes } from '../probes.js';
import { drawScientist } from '../world/art.js';
import {
  figurePhase,
  figurePose,
  type FigureMood,
  type FigurePose,
  type FigureState,
} from '../world/figure.js';
import { REDUCED_MOTION } from '../world/finale.js';
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

/**
 * Runs a figure's canvas: while it shows on screen an animation loop paints
 * it, no more than 30 times a second; hidden, the loop stops, and it starts
 * again when the canvas shows. Returns what stops it for good.
 */
export function runFigure(paint: (now: number) => void, host: FigureHost): () => void {
  let handle: number | null = null;
  let last = Number.NEGATIVE_INFINITY;
  const tick = (now: number): void => {
    handle = host.frame(tick);
    if (now - last >= FIGURE_FRAME_MS - FRAME_SLACK_MS) {
      last = now;
      paint(now);
    }
  };
  const halt = (): void => {
    if (handle !== null) {
      host.cancel(handle);
      handle = null;
    }
  };
  const unwatch = host.watch((shown) => {
    if (!shown) {
      halt();
    } else if (handle === null) {
      handle = host.frame(tick);
    }
  });
  return () => {
    unwatch();
    halt();
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

declare module '../probes.js' {
  interface Probes {
    /** the crew figures in the lobby or on a title card, each with its last pose */
    readonly figures?: FigureProbe[];
  }
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

/**
 * When its player last said ready, by the page's clock: as `ready` turns
 * true while the figure is up — not when it came up ready.
 */
function useReadyAt(ready: boolean): React.MutableRefObject<number | null> {
  const at = useRef<number | null>(null);
  const was = useRef(ready);
  useEffect(() => {
    if (ready && !was.current) {
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
 * most; under reduced motion it holds still. The name is not drawn: the room
 * shows it as a tag above.
 */
export function CrewFigure(props: Props) {
  const { id, color, facing, isYou, connected, mood, speaking = false, ready = false } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readyAt = useReadyAt(ready);
  const look = useRef<FigureLook>({ color, facing, isYou, connected, mood, speaking, phase: 0 });
  look.current = { color, facing, isYou, connected, mood, speaking, phase: figurePhase(id) };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) {
      return undefined;
    }
    const reduced = window.matchMedia(REDUCED_MOTION).matches;
    const since = performance.now();
    const probe: FigureProbe = { color: '', mood: 'play', rise: 0, glance: 0 };
    const unprobe = probed(probe);
    let drawn = '';
    const paint = (now: number): void => {
      const o = look.current;
      if (reduced) {
        // Holding still, the figure is painted again only when what it shows changes.
        const size = `${canvas.clientWidth}x${canvas.clientHeight}`;
        const key = `${o.color} ${o.facing} ${o.isYou} ${o.connected} ${o.mood} ${size}`;
        if (key === drawn) {
          return;
        }
        drawn = key;
      }
      const waved = readyAt.current === null ? null : now - readyAt.current;
      const pose = figurePose(figureStateOf(o, now - since, waved, reduced));
      paintFigure(canvas, ctx, o, pose);
      probe.color = o.color;
      probe.mood = o.mood;
      probe.rise = pose.rise;
      probe.glance = pose.look - FACING[o.facing];
    };
    const stop = runFigure(paint, browserHost(canvas));
    return () => {
      stop();
      unprobe();
    };
  }, [readyAt]);

  return <canvas ref={canvasRef} className="seat-figure" aria-hidden="true" />;
}
