import { audioEngine, LOOKAHEAD, type Engine } from './audio.js';
import { closeStream, openStream, startStream, type Stream } from './audioStream.js';
import { duck, unduck } from './mix.js';
import { MUSIC_LEVEL } from './music.js';
import { entryOf, packById } from './musicPacks.js';
import type { Slot } from './packFile.js';
import { MUSIC_BASE, musicListed } from './samples.js';

/**
 * musicPreview.ts: a piece of a music pack played for the ear in the settings (screens/
 * MusicSettings.tsx), the ▶ beside it — streamed from where its sound starts, at the stems' level
 * by its gain, on the preview's bus at the Musik volume (mix.ts), the music playing pulled down
 * under it as long as it plays. One at a time: another piece played stops it, and so does its
 * own ▶ pressed again, its end, its file failing — or stalling, once it plays no more — or the
 * settings closing (`stopPreview`). The press is the gesture the browser wants: the context is
 * made or woken within it. Nothing here throws.
 */

/** How long a piece played for the ear takes to go when it is stopped, s. */
export const PREVIEW_FADE_S = 0.3;
/** How long a piece whose file stalls may stand without playing on before it stops, ms. */
export const STALL_MS = 1000;

/** The piece played now: its key (pack and place), its stream and its engine. */
interface Playing {
  readonly key: string;
  readonly engine: Engine;
  readonly stream: Stream;
}

let playing: Playing | null = null;
/** The key of the piece asked for last, while its file comes; null for none. */
let asked: string | null = null;
const listeners = new Set<() => void>();

function told(): void {
  for (const listener of [...listeners]) listener();
}

/** The piece played for the ear now — or asked for, its file on the way — by its key; null. */
export function previewing(): string | null {
  return playing?.key ?? asked;
}

/** Calls `listener` whenever the piece played for the ear changes; returns what stops it. */
export function subscribePreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The piece played for the ear stops: faded out over PREVIEW_FADE_S, the music let up. */
export function stopPreview(): void {
  asked = null;
  const was = playing;
  playing = null;
  if (was !== null) {
    try {
      const { ctx } = was.engine;
      const now = ctx.currentTime;
      const level = was.stream.out.gain;
      level.cancelScheduledValues(now);
      level.setValueAtTime(level.value, now);
      level.linearRampToValueAtTime(0, now + PREVIEW_FADE_S);
      unduck(was.engine, 'preview', now, now);
      setTimeout(() => closeStream(was.stream), (PREVIEW_FADE_S + 0.05) * 1000);
    } catch {
      // Deliberately silent: the stream goes with the page at the latest.
      closeStream(was.stream);
    }
  }
  told();
}

/**
 * The piece of `slot` in the pack `pack` played for the ear — or stopped, where it plays already.
 * Its file streams once the music's list is here; another asked for meanwhile wins.
 */
export function togglePreview(pack: string, slot: Slot): void {
  const key = `${pack}/${slot}`;
  const again = previewing() === key;
  stopPreview();
  if (again) return;
  try {
    const engine = audioEngine();
    if (engine === null || packById(pack)?.pieces[slot] === undefined) return;
    void engine.ctx.resume().catch(() => undefined);
    asked = key;
    told();
    void musicListed().then(() => {
      if (asked === key) play(engine, key, pack, slot);
    });
  } catch {
    // Deliberately silent: a piece that cannot be played for the ear stays silent.
    stopPreview();
  }
}

/** Streams the piece `key` from where its sound starts, the music pulled under it. */
function play(engine: Engine, key: string, pack: string, slot: Slot): void {
  const piece = packById(pack)?.pieces[slot];
  const entry = piece === undefined ? null : entryOf(pack, piece);
  asked = null;
  if (entry === null) {
    told();
    return;
  }
  const { ctx } = engine;
  const level = MUSIC_LEVEL * entry.gain;
  const stream = openStream(ctx, `${MUSIC_BASE}${entry.file}`, engine.preview, level);
  const now = ctx.currentTime;
  startStream(stream, ctx, now + LOOKAHEAD - entry.startMs / 1000, entry.startMs / 1000);
  duck(engine, 'preview', now, Infinity, now);
  const mine: Playing = { key, engine, stream };
  playing = mine;
  stopsWith(mine);
  told();
}

/**
 * The piece `mine` stops at its end and where its file fails — the music comes back up — and
 * where its file stalls only once it plays no more: a browser says it stalls on a slow line while
 * it still plays from what it has. Paused, or no further on STALL_MS later, it plays no more.
 */
function stopsWith(mine: Playing): void {
  const { element } = mine.stream;
  const over = (): void => {
    if (playing === mine) stopPreview();
  };
  element.addEventListener('ended', over);
  element.addEventListener('error', over);
  element.addEventListener('stalled', () => {
    if (element.paused) {
      over();
    } else {
      const at = element.currentTime;
      setTimeout(() => {
        if (element.paused || element.currentTime === at) over();
      }, STALL_MS);
    }
  });
}
