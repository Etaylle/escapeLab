import {
  audioEngine,
  capped,
  chain,
  EFFECTS_LEVEL,
  gain,
  LOOKAHEAD,
  playingEngine,
} from '../audio.js';

/**
 * The opening's music: one instrumental bed of some 40 s — dark, low, industrial, slowly
 * building — composed once by ElevenLabs Music (scripts/introCue.ts) into public/intro/. It
 * plays from the card on under the announcement, low, into the music's bus at the Musik
 * volume, and counts as one voice of the lab's budget (audio.ts `capped`). Skipping the
 * opening fades it out; the blackout cuts it off. Where there is no cue — none composed, or the
 * file not to be had — the opening plays without it. Nothing here throws.
 */

/** Where the cue lies, and its list: { file, ms, hash } (scripts/introCue.ts). */
export const CUE_BASE = '/intro/';
export const CUE_MANIFEST = `${CUE_BASE}manifest.json`;

/** The cue's list, as the script writes it. */
export interface CueManifest {
  readonly file: string;
  readonly ms: number;
  readonly hash: string;
}

/** The cue's peak at the master gain: a room's bed, well under the announcement. */
export const CUE_PEAK = EFFECTS_LEVEL * 0.5;
/** How long the cue fades where the player skips the opening, s. */
export const CUE_FADE_S = 1.5;

/** A decoded cue and its peak. */
interface Cue {
  readonly buffer: AudioBuffer;
  readonly peak: number;
}

/** The cue as it plays: its level, its source, and when it ends on the audio clock. */
interface Playing {
  readonly level: GainNode;
  readonly source: AudioBufferSourceNode;
  readonly end: number;
}

let loading: Promise<Cue | null> | null = null;
let playing: Playing | null = null;
/** The opening that wants the cue, by when it began (epoch ms); null once none does. */
let wanted: number | null = null;

/** The loudest sample of the cue's first channel; 1 for a silent one. */
function peakOf(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] ?? 0));
  return peak > 0 ? peak : 1;
}

/** Fetches and decodes the cue the list names, once; null where there is none to be had. */
export function loadCue(): Promise<Cue | null> {
  loading ??= fetch(CUE_MANIFEST)
    .then((res) => (res.ok ? (res.json() as Promise<CueManifest>) : null))
    .then(async (manifest) => {
      const ctx = audioEngine()?.ctx;
      if (manifest === null || ctx === undefined) return null;
      const res = await fetch(`${CUE_BASE}${manifest.file}`);
      if (!res.ok) return null;
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      return { buffer, peak: peakOf(buffer) };
    })
    .catch(() => null)
    .then((cue) => {
      if (cue === null) loading = null;
      return cue;
    });
  return loading;
}

/**
 * The cue for the opening that began at `since` (epoch ms): from where that opening stands now,
 * once it is loaded — unless the opening was skipped or cut meanwhile.
 */
export function startCue(since: number): void {
  wanted = since;
  void loadCue().then((cue) => {
    if (cue !== null && wanted === since) begin(cue, since);
  });
}

/** Plays `cue` from where the opening that began at `since` stands, as one voice. */
function begin(cue: Cue, since: number): void {
  try {
    const engine = playingEngine();
    const offset = (Date.now() - since) / 1000;
    if (engine === null || playing !== null || offset >= cue.buffer.duration) return;
    const { ctx } = engine;
    capped(ctx, engine.music, { voice: 1 }, (out) => {
      const level = gain(ctx, CUE_PEAK / cue.peak);
      const source = ctx.createBufferSource();
      source.buffer = cue.buffer;
      chain(source, level, out);
      const at = ctx.currentTime + LOOKAHEAD;
      const from = Math.max(0, offset);
      source.start(at, from);
      const now: Playing = { level, source, end: at + cue.buffer.duration - from };
      playing = now;
      source.addEventListener('ended', () => {
        if (playing === now) playing = null;
      });
      return [source];
    });
  } catch {
    // Deliberately silent: the opening plays on without its music.
  }
}

/** The cue stops: faded out over `fadeS` (a skip), or at once (0: the blackout). */
export function stopCue(fadeS: number): void {
  wanted = null;
  const cue = playing;
  playing = null;
  if (cue === null) return;
  try {
    const now = cue.level.context.currentTime;
    const param = cue.level.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(0, now + Math.max(0.02, fadeS));
    cue.source.stop(now + Math.max(0.02, fadeS) + 0.05);
  } catch {
    // Deliberately silent: the cue ends on its own.
  }
}

/** Whether the cue plays now, for the walkthrough. */
export function cueProbe(): { playing: boolean } {
  const now = playingEngine()?.ctx.currentTime ?? 0;
  return { playing: playing !== null && now < playing.end };
}
