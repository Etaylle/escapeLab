import { audioEngine, CAPS, inUse } from './audio.js';
import { decodedBytes, type Holder } from './audioMemory.js';
import { duckLevels } from './mix.js';
import { reverbProbe } from './reverb.js';
import type { FloorKind } from './surfaces.js';

/**
 * soundProbe.ts: what the mix holds and does now, for the walkthrough's probe
 * (`window.__escapelab.audio`, GameWorld.tsx): the PCM the page keeps (audioMemory.ts), the
 * budget's voices and loops given out against their caps (audio.ts `CAPS`), the room answering
 * (reverb.ts), how far the music and the beds are pulled down (mix.ts) and how far the brickwall
 * holds the master down. Pure reading; nothing here changes the sound.
 */
export interface SoundProbe {
  /** every buffer of samples the page keeps, bytes: decoded recordings and what is made */
  readonly decodedBytes: number;
  /** the same by who holds it */
  readonly decoded: Record<Holder, number>;
  /** the voices and loops given out now, against their caps */
  readonly budget: { voice: number; loop: number; caps: { voice: number; loop: number } };
  /** the room answering now, and whether another still fades */
  readonly reverb: { room: FloorKind | null; crossing: boolean };
  /** how far the music and the beds are pulled down now, linear */
  readonly ducks: { music: number; ambience: number };
  /** how far the brickwall holds the master down now, dB (0 or less) */
  readonly limiterDb: number;
}

export function soundProbe(): SoundProbe {
  const { total, ...decoded } = decodedBytes();
  const engine = audioEngine();
  const now = engine?.ctx.currentTime ?? 0;
  return {
    decodedBytes: total,
    decoded,
    budget: { ...inUse(), caps: { ...CAPS } },
    reverb: reverbProbe(),
    ducks: engine === null ? { music: 1, ambience: 1 } : duckLevels(engine, now),
    limiterDb: engine?.limiter.reduction ?? 0,
  };
}
