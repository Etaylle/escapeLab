import type { FigureProbe } from './screens/CrewFigure.js';
import type { VoiceProbe } from './voice/mesh.js';
import type { BedProbe } from './world/ambience.js';
import type { SoundSystem } from './world/audio.js';
import type { GraphCensus } from './world/audioCount.js';
import type { LightProbe } from './world/gl/path.js';
import type { MusicProbe } from './world/music.js';
import type { RadioRender, VoiceProbe as RadioProbe } from './world/radioVoice.js';
import type { MinimapLayout } from './world/render/frame.js';
import type { GoalDot } from './world/render/hud.js';
import type { PassStats } from './world/render/profile.js';
import type { SpatialProbe } from './world/spatial.js';

/**
 * The minimap as the frame draws it (world/render/hud.ts): its corner, cell and size in device
 * pixels, the density, and the goal it points at, in tiles.
 */
export interface MinimapProbe extends MinimapLayout {
  dpr: number;
  goal: GoalDot[];
}

/**
 * What the lab sounds like now: the beds of the rooms round the player (world/ambience.ts),
 * the music's layers and pressure (music.ts), mission control's voice (radioVoice.ts) and
 * where the nearest partner sounds from (spatial.ts) — and the radio's chain rendered offline,
 * on white noise or on a recorded line.
 */
export interface AudioProbe extends BedProbe {
  readonly music: MusicProbe;
  readonly voice: RadioProbe;
  readonly spatial: SpatialProbe;
  /** what the audio thread renders now (world/audioCount.ts), and the beds built */
  readonly nodes: Partial<GraphCensus> & { beds: number };
  /** the main thread's time each sound system has taken so far, ms (world/audio.ts `timed`) */
  readonly spent: Partial<Record<SoundSystem, number>>;
  /**
   * renders the radio's chain once on white noise — or on the recording `id`: what went in and
   * what came out
   */
  readonly renderRadio: (id?: string) => Promise<RadioRender>;
}

/**
 * Where the world's camera looks as its last frame drew it: the world point at the canvas's
 * middle, in tiles, and the canvas pixels per tile — what maps a tile to its pixels.
 */
export interface CameraProbe {
  x: number;
  y: number;
  scale: number;
  /** how far it looks ahead of the avatar as it walks, in tiles (world/sim.ts `leadOn`) */
  lead: { x: number; y: number };
}

/**
 * The page's probes for the walkthrough harness (`tools/shots.mjs`), there
 * only when the URL asks for them with `?trace=1` (world/frameTrace.ts): the
 * world's last frame durations and its camera while a world is up, the voice
 * links while the page is in a room, the crew figures while any are painted.
 * Each part comes and goes on its own.
 */
export interface Probes {
  /** the world's last frame durations, oldest first (world/frameTrace.ts) */
  readonly frames?: number[];
  /** forgets them: what is read next was recorded after this */
  resetFrames?: () => void;
  /** the world's camera, for what a tile looks like on the canvas */
  readonly camera?: CameraProbe;
  /** where your avatar stands as this page steers it, in tiles (world/sim.ts) */
  readonly self?: { x: number; y: number };
  /** the avatar's footfalls so far, walking and sprinting (world/sim.ts): their pace is timed */
  readonly footfalls?: number;
  /** the minimap and the goal it points at; null while it is off */
  readonly minimap?: MinimapProbe | null;
  /** the voice links, their states and who speaks (voice/mesh.ts) */
  readonly voice?: VoiceProbe;
  /** the way the world's light takes, WebGL or Canvas, and the picture's luma (world/gl/path.ts) */
  readonly light?: LightProbe;
  /** what the lab sounds like, while a world is up */
  readonly audio?: AudioProbe;
  /** the crew figures in the lobby or on a title card, each with its last pose (CrewFigure.tsx) */
  readonly figures?: FigureProbe[];
  /**
   * what each pass of the world's picture costs a frame, ms, p50 and p95 over the last frames
   * — there only with `?profile=1` (world/render/profile.ts)
   */
  readonly passes?: PassStats;
  /** forgets the frames the pass costs were taken over */
  resetPasses?: () => void;
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
