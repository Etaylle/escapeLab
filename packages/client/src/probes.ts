import type { VoiceProbe } from './voice/mesh.js';
import type { LightProbe } from './world/gl/path.js';

/**
 * Where the world's camera looks as its last frame drew it: the world point at the canvas's
 * middle, in tiles, and the canvas pixels per tile — what maps a tile to its pixels.
 */
export interface CameraProbe {
  x: number;
  y: number;
  scale: number;
}

/**
 * The page's probes for the walkthrough harness (`tools/shots.mjs`), there
 * only when the URL asks for them with `?trace=1` (world/frameTrace.ts): the
 * world's last frame durations and its camera while a world is up, the voice
 * links while the page is in a room. Each part comes and goes on its own.
 */
export interface Probes {
  /** the world's last frame durations, oldest first (world/frameTrace.ts) */
  readonly frames?: number[];
  /** forgets them: what is read next was recorded after this */
  resetFrames?: () => void;
  /** the world's camera, for what a tile looks like on the canvas */
  readonly camera?: CameraProbe;
  /** the voice links, their states and who speaks (voice/mesh.ts) */
  readonly voice?: VoiceProbe;
  /** the way the world's light takes, WebGL or Canvas, and the picture's luma (world/gl/path.ts) */
  readonly light?: LightProbe;
}

declare global {
  interface Window {
    /** Probes for the walkthrough harness, only there when the URL asks for them. */
    __escapelab?: Probes;
  }
}

/** Puts `part` on the page's probes, getters and all; what it returns takes them off again. */
export function addProbes(part: Probes): () => void {
  const probes = (window.__escapelab ??= {});
  const own = Object.getOwnPropertyDescriptors(part);
  Object.defineProperties(probes, own);
  return () => {
    for (const key of Object.keys(own)) {
      Reflect.deleteProperty(probes, key);
    }
  };
}
