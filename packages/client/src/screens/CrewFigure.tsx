import { useEffect, useRef } from 'react';
import { drawScientist } from '../world/art.js';

/** Which way a crew member looks: toward the middle of the row, or out of the room. */
export type Facing = 'left' | 'right' | 'front';

interface Props {
  color: string;
  facing: Facing;
  isYou: boolean;
  connected: boolean;
  /** offsets this figure's glances from its neighbours', in radians */
  phase: number;
}

/**
 * Tiles the canvas reaches above and below the feet: up past the dome, down
 * past the shadow and the ring under your own figure. Its width is 0.9 tiles,
 * and lobby.css sizes the canvas in that proportion.
 */
const ABOVE = 0.9;
const BELOW = 0.16;

/** Facing angles as the art takes them (0 right, PI/2 toward the viewer) and how far each sways. */
const BASE: Record<Facing, number> = { right: 0.55, left: Math.PI - 0.55, front: Math.PI / 2 };
const SWAY: Record<Facing, number> = { right: 0.3, left: 0.3, front: 0.95 };
/** Radians per second of the sway: a slow look around. */
const GLANCE_SPEED = 0.7;

/**
 * A crew member standing in the lobby, drawn with the in-game art at the size
 * the stylesheet gives the canvas. The name is not drawn: the room shows it as
 * a tag above. Under reduced motion the figure holds still.
 */
export function CrewFigure({ color, facing, isYou, connected, phase }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const look = useRef({ color, facing, isYou, connected, phase });
  look.current = { color, facing, isYou, connected, phase };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) {
      return undefined;
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    let drawn = '';
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      const o = look.current;
      const key = `${o.color} ${o.facing} ${o.isYou} ${o.connected} ${width}x${height}`;
      if (still && key === drawn) {
        return;
      }
      drawn = key;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const t = still ? 0 : (now - start) / 1000;
      const scale = height / (ABOVE + BELOW);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(scale, 0, 0, scale, width / 2, ABOVE * scale);
      drawScientist(ctx, {
        color: o.color,
        name: '',
        facing: BASE[o.facing] + SWAY[o.facing] * Math.sin(t * GLANCE_SPEED + o.phase),
        moving: false,
        walkPhase: 0,
        isYou: o.isYou,
        connected: o.connected,
      });
    };
    frame(start);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="seat-figure" aria-hidden="true" />;
}
