import type { ParticleKind } from '../particles.js';
import type { Sim } from '../sim.js';
import { groundAt } from './actors.js';
import { conesOf, motesLit } from './atmosphere.js';
import type { Frame, RenderKit } from './frame.js';

/**
 * What the walkthrough (`?trace=1`, tools/shots.mjs) reads of the world's
 * picture to prove the graphics package's captures: your figure's walk cycle
 * and the light its shadow follows, the hatch's opening, the particles alive
 * and the motes lit in the cones, and the canvas's backing store against its
 * box.
 */
export interface GraphicsProbe {
  /** your figure's walk: where in its cycle (0 to 1), and whether it walks */
  gait: { phase: number; moving: boolean };
  /** the light your figure stands in as the last frame drew it; null before the first */
  ground: 'lit' | 'dark' | 'plain' | null;
  /** how far the hatch stood open as the last frame drew it, 0 to 1 */
  hatch: number;
  /** the particles alive by kind, and how many motes the cones light */
  particles: Partial<Record<ParticleKind, number>> & { litMotes: number };
  /** the canvas: its backing store, device pixels, and its box, CSS pixels */
  backing: { width: number; height: number; cssWidth: number; cssHeight: number };
}

/** What the probe reads of a mounted world. */
export interface ProbedWorld {
  canvas: HTMLCanvasElement;
  kit: RenderKit;
  sim: Sim;
  drawn: Frame | null;
}

/** The graphics probe of `world` now. */
export function graphicsProbe(world: ProbedWorld): GraphicsProbe {
  const { canvas, kit, sim, drawn } = world;
  const particles: GraphicsProbe['particles'] = { litMotes: 0 };
  for (const particle of kit.art.particles.live) {
    particles[particle.kind] = (particles[particle.kind] ?? 0) + 1;
  }
  if (drawn !== null) {
    const cones = conesOf(drawn);
    particles.litMotes = kit.art.particles.live.filter(
      (p) => p.kind === 'dust' && motesLit(cones, p.x, p.y),
    ).length;
  }
  return {
    gait: { phase: sim.walkPhase, moving: sim.self.moving },
    ground: drawn === null ? null : groundAt(drawn, sim.self.x, sim.self.y),
    hatch: drawn?.hatch ?? 0,
    particles,
    backing: {
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
    },
  };
}
