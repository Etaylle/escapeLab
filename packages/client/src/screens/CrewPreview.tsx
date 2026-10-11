import { useEffect, useRef } from 'react';
import { drawScientist } from '../world/art.js';

interface Props {
  color: string;
  name: string;
  /** keeps the figure walking on the spot */
  animated?: boolean;
}

const TILE = 72;

/** Lobby portrait of your crew member, drawn with the in-game art. */
export function CrewPreview({ color, name, animated = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorRef = useRef(color);
  colorRef.current = color;
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) {
      return undefined;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = TILE * 1.6 * dpr;
    canvas.height = TILE * 1.6 * dpr;

    let raf = 0;
    const start = performance.now();
    const frame = (now: number): void => {
      const t = (now - start) / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = TILE * dpr;
      ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height * 0.78);
      drawScientist(ctx, {
        color: colorRef.current,
        name: nameRef.current.trim() === '' ? '…' : nameRef.current,
        facing: Math.sin(t * 0.8) * 1.4,
        moving: animated,
        walkPhase: (t * 1.6) % 1,
        isYou: true,
        connected: true,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [animated]);

  return <canvas ref={canvasRef} className="crew-preview" aria-hidden="true" />;
}
