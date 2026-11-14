import { claim, EFFECTS_LEVEL, LOOKAHEAD, playingEngine, release } from '../audio.js';
import { closeStream, openStream, startStream, type Stream } from '../audioStream.js';
import { holdMusic, musicFrom } from '../musicTurn.js';
import type { MusicId } from '../samples.js';

/**
 * The opening's music: one instrumental bed of some 40 s — dark, low, industrial, slowly
 * building — composed once by ElevenLabs Music (scripts/introCue.ts) into public/intro/. It
 * plays from the card on under the announcement, low, into the music's bus at the Musik volume,
 * and counts as one voice of the lab's budget (audio.ts `claim`). It streams from its file
 * (audioStream.ts) rather than being decoded — 40 s in two channels would hold some 15 MB — its
 * level set by the peak its list names. It waits for the bus as all music does — the menu's
 * theme fading out as the run starts (musicTurn.ts) — and comes in where the opening then stands.
 * Skipping the opening fades it out, holding the bus meanwhile; the blackout cuts it off. Where
 * there is no cue — none composed, or the file not to be had — the opening plays without it.
 * Nothing here throws.
 */

/** The opening's piece of the score, by its id in the music's manifest (audio/catalog.json). */
export const TITLE: MusicId = 'title';

/** Where the cue lies, and its list: { file, ms, peak, hash } (scripts/introCue.ts). */
export const CUE_BASE = '/intro/';
export const CUE_MANIFEST = `${CUE_BASE}manifest.json`;

/** The cue's list, as the script writes it. */
export interface CueManifest {
  readonly file: string;
  readonly ms: number;
  /** its peak over both channels, linear */
  readonly peak: number;
  readonly hash: string;
}

/** The cue's peak at the master gain: a room's bed, well under the announcement. */
export const CUE_PEAK = EFFECTS_LEVEL * 0.5;
/** How long the cue fades where the player skips the opening, s. */
export const CUE_FADE_S = 1.5;

/** The cue as it plays: its stream, when it ends on the audio clock, and whether it has gone. */
interface Playing {
  readonly stream: Stream;
  readonly end: number;
  gone: boolean;
}

let listed: Promise<CueManifest | null> | null = null;
let playing: Playing | null = null;
/** The opening that wants the cue, by when it began (epoch ms); null once none does. */
let wanted: number | null = null;

/** The cue's list, fetched once; null where there is none to be had (it is asked again later). */
function cueListed(): Promise<CueManifest | null> {
  listed ??= fetch(CUE_MANIFEST)
    .then((res) => (res.ok ? (res.json() as Promise<CueManifest>) : null))
    .catch(() => null)
    .then((cue) => {
      if (cue === null) listed = null;
      return cue;
    });
  return listed;
}

/**
 * The cue for the opening that began at `since` (epoch ms): from where that opening stands now,
 * once its list is here — unless the opening was skipped or cut meanwhile.
 */
export function startCue(since: number): void {
  wanted = since;
  void cueListed().then((cue) => {
    if (cue !== null && wanted === since) begin(cue, since);
  });
}

/** The cue's stream let go, and its voice given back: once. */
function letGo(cue: Playing): void {
  if (cue.gone) return;
  cue.gone = true;
  closeStream(cue.stream);
  release({ voice: 1 });
}

/**
 * Streams `cue` as one voice, as soon as the music's bus is free, from where the opening that
 * began at `since` stands then.
 */
function begin(cue: CueManifest, since: number): void {
  try {
    const engine = playingEngine();
    if (engine === null || playing !== null) return;
    const { ctx } = engine;
    const soonest = ctx.currentTime + LOOKAHEAD;
    // Where the opening's first moment lies on the audio clock: the cue keeps to it.
    const zero = soonest - Math.max(0, (Date.now() - since) / 1000);
    const at = musicFrom(soonest);
    const from = at - zero;
    if (from >= cue.ms / 1000 || !claim({ voice: 1 })) return;
    const level = CUE_PEAK / (cue.peak > 0 ? cue.peak : 1);
    const stream = openStream(ctx, `${CUE_BASE}${cue.file}`, engine.music, level);
    startStream(stream, ctx, zero, from);
    const now: Playing = { stream, end: zero + cue.ms / 1000, gone: false };
    playing = now;
    stream.element.addEventListener(
      'ended',
      () => {
        if (playing === now) playing = null;
        letGo(now);
      },
      { once: true },
    );
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
    const param = cue.stream.out.gain;
    const now = cue.stream.out.context.currentTime;
    const fade = Math.max(0.02, fadeS);
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(0, now + fade);
    holdMusic(now + fade);
    setTimeout(() => letGo(cue), (fade + 0.05) * 1000);
  } catch {
    // Deliberately silent: the cue ends on its own.
  }
}

/** Whether the cue plays now, for the walkthrough. */
export function cueProbe(): { playing: boolean } {
  const now = playingEngine()?.ctx.currentTime ?? 0;
  return { playing: playing !== null && now < playing.end };
}
