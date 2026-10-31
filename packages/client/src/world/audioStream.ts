/**
 * audioStream.ts: a recording played from its file as it streams — an <audio> element whose sound
 * Web Audio takes in (MediaElementAudioSourceNode) — so that none of it is decoded ahead: the
 * music's stems (music.ts), the end card's stings and the opening's cue (intro/cue.ts). Measured
 * in Chromium (docs/sound.md): an element started by play() at the moment its timer comes sounds
 * within 1–8 ms of that moment, and its currentTime stands within 2 ms of what is heard, without
 * drifting; a seek in an MP3 is 17–26 ms off. So nothing is ever placed in time by a seek: an
 * element is started from its file's start as its moment comes, and one that came in late is
 * caught up by playing it a little faster, its pitch kept (`steer`) — a change of speed takes
 * hold within a tenth of a second. An element the browser will not play yet (the autoplay rule)
 * is tried again at the next click, tap or key. Nothing here throws.
 */

/** How far a stream may play faster or slower to catch up, a share of its speed. */
export const STEER_MAX = 0.03;
/** It catches up its lag over about this long, s: the speed is the lag over it, capped. */
export const STEER_S = 0.5;
/** A lag under this is nothing to catch up, s. */
export const ON_TIME_S = 0.002;
/** The clicks and keys a stream the browser held back is tried again at. */
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

/** A recording streaming into the lab's graph. */
export interface Stream {
  readonly element: HTMLAudioElement;
  readonly source: MediaElementAudioSourceNode;
  /** its level, which its fades move */
  readonly out: GainNode;
  /** the audio time its file's start sounds at, as it was asked to; null before it is started */
  zero: number | null;
  state: 'idle' | 'starting' | 'playing' | 'blocked' | 'closed';
  timer: ReturnType<typeof setTimeout> | null;
  /** how late it came in, s, measured as it first played; null before */
  lateBy: number | null;
}

/** Opens `url` as a stream on `ctx` into `dest` at `level`: loading, silent, not started. */
export function openStream(
  ctx: AudioContext,
  url: string,
  dest: AudioNode,
  level: number,
): Stream {
  const element = new Audio();
  element.preload = 'auto';
  element.src = url;
  const source = ctx.createMediaElementSource(element);
  const out = ctx.createGain();
  out.gain.value = level;
  source.connect(out);
  out.connect(dest);
  return { element, source, out, zero: null, state: 'idle', timer: null, lateBy: null };
}

/** An element's readyState once it holds enough of its file to play through (HAVE_ENOUGH_DATA). */
const ENOUGH_DATA = 4;

/** Whether `stream` holds enough of its file to start at once. */
export function streamReady(stream: Stream): boolean {
  return stream.element.readyState >= ENOUGH_DATA;
}

/** Plays `stream` now; where the browser holds it back, again at the next gesture. */
function play(stream: Stream, ctx: AudioContext): void {
  if (stream.state === 'closed') return;
  stream.state = 'starting';
  stream.element.play().then(
    () => {
      if (stream.state !== 'starting') return;
      stream.state = 'playing';
      stream.lateBy = lagOf(stream, ctx);
    },
    () => {
      if (stream.state !== 'starting') return;
      stream.state = 'blocked';
      if (typeof window === 'undefined') return;
      for (const type of GESTURES) {
        window.addEventListener(type, () => stream.state === 'blocked' && play(stream, ctx), {
          once: true,
          capture: true,
        });
      }
    },
  );
}

/**
 * Starts `stream` so that its file's start sounds at audio time `zero`, `from` s into it where
 * it comes in after its start (a seek: where it comes in matters, not the beat): play() as
 * that moment comes on the audio clock.
 */
export function startStream(stream: Stream, ctx: AudioContext, zero: number, from = 0): void {
  if (stream.state === 'closed') return;
  if (stream.timer !== null) clearTimeout(stream.timer);
  stream.zero = zero;
  stream.lateBy = null;
  if (from > 0) stream.element.currentTime = from;
  const wait = (zero + from - ctx.currentTime) * 1000;
  stream.state = 'starting';
  stream.timer = setTimeout(() => {
    stream.timer = null;
    play(stream, ctx);
  }, Math.max(0, wait));
}

/** How far `stream` lags where its zero puts it now, s; 0 where it is not playing. */
export function lagOf(stream: Stream, ctx: AudioContext): number {
  if (stream.zero === null || stream.state !== 'playing') return 0;
  return ctx.currentTime - stream.zero - stream.element.currentTime;
}

/**
 * Catches `stream` up with where its zero puts it: faster while it lags, slower while it runs
 * ahead — the lag over STEER_S, capped at STEER_MAX — at its own speed once within ON_TIME_S.
 * Returns the lag it found, s.
 */
export function steer(stream: Stream, ctx: AudioContext): number {
  const lag = lagOf(stream, ctx);
  const push = Math.max(-STEER_MAX, Math.min(STEER_MAX, lag / STEER_S));
  const rate = Math.abs(lag) < ON_TIME_S ? 1 : 1 + push;
  if (stream.element.playbackRate !== rate) stream.element.playbackRate = rate;
  return lag;
}

/** Stops `stream` at audio time `at` and puts it back at its file's start, ready to go again. */
export function rewindStream(stream: Stream, ctx: AudioContext, at: number): void {
  if (stream.timer !== null) clearTimeout(stream.timer);
  stream.timer = setTimeout(
    () => {
      stream.timer = null;
      if (stream.state === 'closed') return;
      stream.element.pause();
      stream.element.playbackRate = 1;
      stream.element.currentTime = 0;
      stream.state = 'idle';
      stream.zero = null;
    },
    Math.max(0, (at - ctx.currentTime) * 1000),
  );
}

/** Lets `stream` go: stopped, its file let go, its nodes unwired. */
export function closeStream(stream: Stream): void {
  if (stream.timer !== null) clearTimeout(stream.timer);
  stream.timer = null;
  stream.state = 'closed';
  try {
    stream.element.pause();
    stream.element.removeAttribute('src');
    stream.element.load();
    stream.source.disconnect();
    stream.out.disconnect();
  } catch {
    // Deliberately silent: the element goes with the page at the latest.
  }
}
