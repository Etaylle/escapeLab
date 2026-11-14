import { claim, EFFECTS_LEVEL, LOOKAHEAD, playingEngine, release } from '../audio.js';
import { closeStream, openStream, startStream, type Stream } from '../audioStream.js';
import { MUSIC_LEVEL } from '../music.js';
import { holdMusic, musicFrom } from '../musicTurn.js';
import { MUSIC_BASE, musicEntry, musicListed, type MusicId } from '../samples.js';

/**
 * The opening's music: the score's title (audio/catalog.json `title`, the motif's first phrase
 * alone on a piano) where the music's manifest has it, at the stems' level as every piece of the
 * score — the score's pieces are brought to one loudness, so that the run's music after it does
 * not jump; else the older cue, one instrumental bed of some 40 s composed by ElevenLabs Music
 * (scripts/introCue.ts) into public/intro/, its level set by the peak its list names. It plays
 * from the card on under the announcement into the music's bus at the Musik volume, and counts
 * as one voice of the lab's budget (audio.ts `claim`). It streams from its file (audioStream.ts)
 * rather than being decoded — 40 s in two channels would hold some 15 MB. It waits for the bus
 * as all music does — the menu's theme fading out as the run starts (musicTurn.ts) — and comes in
 * where the opening then stands. Skipping the opening fades it out, holding the bus meanwhile;
 * the blackout cuts it off. Where there is neither — none made, or no file to be had — the
 * opening plays without music. Nothing here throws.
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

/**
 * What the opening streams: its address, how long it lasts and the silence it opens with, s, and
 * the level it comes in at.
 */
interface Source {
  readonly url: string;
  readonly seconds: number;
  readonly lead: number;
  readonly level: number;
}

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
 * What the opening plays: the score's title where the music's manifest names it, at the stems'
 * level times its gain; else the older cue, at CUE_PEAK by its peak; null where there is neither.
 */
async function sourceOf(): Promise<Source | null> {
  await musicListed();
  const title = musicEntry(TITLE);
  if (title !== null) {
    const url = `${MUSIC_BASE}${title.file}`;
    const level = MUSIC_LEVEL * title.gain;
    return { url, seconds: title.ms / 1000, lead: title.startMs / 1000, level };
  }
  const cue = await cueListed();
  if (cue === null) return null;
  const level = CUE_PEAK / (cue.peak > 0 ? cue.peak : 1);
  return { url: `${CUE_BASE}${cue.file}`, seconds: cue.ms / 1000, lead: 0, level };
}

/**
 * The music for the opening that began at `since` (epoch ms): from where that opening stands
 * now, once its lists are here — unless the opening was skipped or cut meanwhile.
 */
export function startCue(since: number): void {
  wanted = since;
  void sourceOf().then((source) => {
    if (source !== null && wanted === since) begin(source, since);
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
 * Streams `source` as one voice, as soon as the music's bus is free, from where the opening that
 * began at `since` stands then: its sound — past the silence it opens with — from the opening's
 * first moment.
 */
function begin(source: Source, since: number): void {
  try {
    const engine = playingEngine();
    if (engine === null || playing !== null) return;
    const { ctx } = engine;
    const soonest = ctx.currentTime + LOOKAHEAD;
    // Where the opening's first moment lies on the audio clock: the music keeps to it.
    const zero = soonest - Math.max(0, (Date.now() - since) / 1000) - source.lead;
    const at = musicFrom(soonest);
    const from = at - zero;
    if (from >= source.seconds || !claim({ voice: 1 })) return;
    const stream = openStream(ctx, source.url, engine.music, source.level);
    startStream(stream, ctx, zero, from);
    const now: Playing = { stream, end: zero + source.seconds, gone: false };
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
