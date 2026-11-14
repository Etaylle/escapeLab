import { biquad, chain, gain, LOOKAHEAD, outlet, playingEngine, type Engine } from './audio.js';
import { paSchedule } from './intro/sequence.js';
import {
  clipOf,
  lineClip,
  preloadLines,
  recordedMs,
  releaseLine,
  SPEECH_PEAK,
  voiceReady,
  type Clip,
} from './radioVoice.js';

/**
 * The lab's loudspeakers: the plant's announcement system (scripts/voice.ts, its own voice),
 * recorded with mission control's lines into public/voice/. Not a handset but a horn on a wall:
 * a wider band, 300 Hz to 5 kHz, each edge second order — no squelch, no static, no shaper —
 * into the loudspeakers' bus at the Funk volume (mix.ts `announce`), whose send the room the
 * player stands in answers with its own impulse response (reverb.ts); nothing ducks under it.
 * While an intro keeps the power on they make the shift's announcement (intro/sequence.ts):
 * each line comes as its moment on the sequence's clock comes (its place from `paSchedule`); a
 * line without a recording ready is left out, its subtitle still shown. When the lights fail the
 * power under the loudspeakers goes with them: the line on now breaks off and nothing more
 * comes (`cutAnnouncement`). After the blackout they live on the emergency power, weakly: a
 * narrower band that drops out now and then, for the plant's few messages of the run — an
 * emergency's start (`announce`, from the objective bar's queue). Nothing here throws.
 */

/** The loudspeakers' band, Hz: wider than the radio's handset, still a horn's. */
export const PA_LOW = 300;
export const PA_HIGH = 5000;
/** The band on the emergency power, Hz: the horns strained, their lows and highs gone. */
export const WEAK_LOW = 450;
export const WEAK_HIGH = 3200;
/** A Butterworth edge of second order, as Web Audio takes a high- or low-pass's Q: in dB. */
const BUTTERWORTH_DB = 20 * Math.log10(Math.SQRT1_2);
/** The announcement at the master gain: a step under the radio's voice, heard across a room. */
export const PA_LEVEL = 0.1;
/** A line whose moment passed longer ago than this is left out: the screen came too late. */
const LATE_MS = 1000;
/** How fast a line breaks off as the power goes, s: the time constant of its fall. */
const CUT_TAU = 0.012;

/**
 * Where the emergency power drops the loudspeakers out, s from a line's start, and for how
 * long: irregular, as a loose contact is, the same for every line. A dropout that would end
 * within WEAK_TAIL_S of the line's end is left out, so that its last word is heard.
 */
export const DROPOUTS: readonly (readonly [at: number, duration: number])[] = [
  [0.7, 0.09],
  [1.6, 0.13],
  [2.2, 0.06],
  [3.5, 0.11],
  [4.4, 0.08],
  [5.9, 0.12],
  [6.6, 0.07],
];
/** How far a dropout pulls the line down: the horn all but gone for that moment. */
export const DROPOUT_LEVEL = 0.06;
/** How fast a dropout falls and comes back, s: quick, and no click. */
const DROPOUT_EDGE_S = 0.008;
/** The end of a line no dropout reaches into, s. */
const WEAK_TAIL_S = 0.25;

/** The loudspeakers' chain: in at `input`, out of `out` at its level. */
export interface PaChain {
  readonly input: GainNode;
  readonly filters: readonly BiquadFilterNode[];
  readonly out: GainNode;
}

/** The loudspeakers on the emergency power: their chain, a gate in front of it for the dropouts. */
export interface WeakChain extends PaChain {
  readonly gate: GainNode;
}

/** A loudspeaker's band from `input` on into `dest` at `level`, each edge second order. */
function horn(
  ctx: BaseAudioContext,
  input: GainNode,
  [low, high]: readonly [number, number],
  dest: AudioNode,
  level: number,
): PaChain {
  const lows = biquad(ctx, 'highpass', low, BUTTERWORTH_DB);
  const highs = biquad(ctx, 'lowpass', high, BUTTERWORTH_DB);
  const out = outlet(ctx, dest, level);
  chain(input, lows, highs, out);
  return { input, filters: [lows, highs], out };
}

/**
 * A loudspeaker into `dest` at `level`: high-pass at 300 Hz and low-pass at 5 kHz, each second
 * order; the room it hangs in answers it on `dest`'s send (reverb.ts). On any context: the live
 * one, or an offline one to measure it.
 */
export function paChain(ctx: BaseAudioContext, dest: AudioNode, level: number): PaChain {
  return horn(ctx, gain(ctx, 1), [PA_LOW, PA_HIGH], dest, level);
}

/**
 * A loudspeaker on the emergency power into `dest` at `level`: a gate the dropouts are laid on
 * (`dropOut`), then high-pass at 450 Hz and low-pass at 3.2 kHz, each second order.
 */
export function weakChain(ctx: BaseAudioContext, dest: AudioNode, level: number): WeakChain {
  const input = gain(ctx, 1);
  const gate = gain(ctx, 1);
  input.connect(gate);
  return { ...horn(ctx, gate, [WEAK_LOW, WEAK_HIGH], dest, level), input, gate };
}

/**
 * The dropouts of a line of `seconds` laid on `gate` from `at` (audio time): each falls to
 * DROPOUT_LEVEL and comes back, an edge of DROPOUT_EDGE_S either way.
 */
export function dropOut(gate: AudioParam, at: number, seconds: number): void {
  gate.setValueAtTime(1, at);
  for (const [offset, duration] of DROPOUTS) {
    if (offset + duration > seconds - WEAK_TAIL_S) continue;
    const from = at + offset;
    const to = from + duration;
    gate.setValueAtTime(1, from);
    gate.linearRampToValueAtTime(DROPOUT_LEVEL, from + DROPOUT_EDGE_S);
    gate.setValueAtTime(DROPOUT_LEVEL, to);
    gate.linearRampToValueAtTime(1, to + DROPOUT_EDGE_S);
  }
}

/** The line on the loudspeakers: what it says, when it ends (audio time), how it breaks off. */
interface Speaking {
  readonly text: string;
  readonly end: number;
  readonly stop: (at: number) => void;
}

/** An announcement under way on this screen. */
interface Announcement {
  readonly lines: readonly string[];
  timers: ReturnType<typeof setTimeout>[];
  speaking: Speaking | null;
  lastLine: string | null;
  played: number;
  cut: boolean;
}

let current: Announcement | null = null;

/** A message asked of the loudspeakers (`announce`), as it was asked. */
interface Ask {
  readonly text: string;
}

/**
 * The loudspeakers on the emergency power: the line they say now, the one asked for last —
 * whose decoding a newer ask makes moot — and how many they have said.
 */
const weak: { speaking: Speaking | null; asked: Ask | null; said: number } = {
  speaking: null,
  asked: null,
  said: 0,
};

/**
 * Starts the announcement `lines` on a sequence that began at `since` (epoch ms): once the voice
 * manifest is here, every line is decoded (radioVoice.ts `preloadLines`) and put in its place on
 * the sequence's clock by its length, and each speaks as its moment comes, then is let go. One
 * already under way stops.
 */
export function startAnnouncement(lines: readonly string[], since: number): void {
  stopAnnouncement();
  const run: Announcement = {
    lines,
    timers: [],
    speaking: null,
    lastLine: null,
    played: 0,
    cut: false,
  };
  current = run;
  void voiceReady().then(() => {
    if (current !== run) return;
    preloadLines(lines);
    const schedule = paSchedule(lines.map((text) => ({ text, ms: recordedMs(text) })));
    for (const line of schedule) {
      const wait = since + line.at - Date.now();
      if (wait >= -LATE_MS) {
        run.timers.push(setTimeout(() => sayOver(run, line.text), Math.max(0, wait)));
      }
    }
  });
}

/** The line `text` over the loudspeakers, now, where its recording is ready and sound plays. */
function sayOver(run: Announcement, text: string): void {
  if (current !== run || run.cut) return;
  try {
    run.lastLine = text;
    const clip = clipOf(text);
    const engine = playingEngine();
    if (clip === null || engine === null) return;
    run.speaking?.stop(engine.ctx.currentTime);
    run.speaking = speak(engine, clip, text, paChain(engine.ctx, engine.announce, PA_LEVEL));
    run.played += 1;
  } catch {
    // Deliberately silent: the subtitle shows the line as well.
  }
}

/**
 * The recording `clip` through `pa`, a loudspeaker's chain into the loudspeakers' bus, from now
 * on — the emergency power's dropouts on its gate, where it has one; the chain goes as the line
 * ends, the room's answer ringing on in the reverb.
 */
function speak(engine: Engine, clip: Clip, text: string, pa: PaChain | WeakChain): Speaking {
  const { ctx } = engine;
  const speech = ctx.createBufferSource();
  speech.buffer = clip.buffer;
  chain(speech, gain(ctx, SPEECH_PEAK / clip.peak), pa.input);
  const at = ctx.currentTime + LOOKAHEAD;
  if ('gate' in pa) dropOut(pa.gate.gain, at, clip.buffer.duration);
  speech.start(at);
  speech.addEventListener('ended', () => {
    pa.out.disconnect();
    releaseLine(text);
  });
  const stop = (when: number): void => {
    pa.out.gain.setTargetAtTime(0, when, CUT_TAU);
    speech.stop(when + CUT_TAU * 5);
  };
  return { text, end: at + clip.buffer.duration, stop };
}

/**
 * The power goes under the loudspeakers: the line on now breaks off, nothing more comes, and
 * every line of the announcement is let go.
 */
export function cutAnnouncement(): void {
  const run = current;
  if (run === null) return;
  run.cut = true;
  for (const timer of run.timers) clearTimeout(timer);
  run.timers = [];
  try {
    const engine = playingEngine();
    if (engine !== null) run.speaking?.stop(engine.ctx.currentTime);
  } catch {
    // Deliberately silent: the line ends on its own.
  }
  run.speaking = null;
  for (const text of run.lines) releaseLine(text);
}

/** The screen is gone: the announcement breaks off and is forgotten. */
export function stopAnnouncement(): void {
  cutAnnouncement();
  current = null;
}

/**
 * The plant's message `text` over the loudspeakers on their emergency power — now where it is
 * decoded, else as soon as it is — cutting short one they still say; let go once said. Resolves
 * as it sounds, with how long it speaks, ms, by its recording; with null where it never does — it
 * has no recording, nothing can play, its recording failed, or a message asked for after it or
 * the screen going (`stopAnnounce`) made it moot — and then nothing sounds: the loudspeakers
 * have no chirp.
 */
export function announce(text: string): Promise<number | null> {
  try {
    const engine = playingEngine();
    if (engine === null || recordedMs(text) === null) return Promise.resolve(null);
    const ask: Ask = { text };
    weak.asked = ask;
    return lineClip(text)
      .then((clip) => (clip === null ? null : sayAsked(engine, ask, clip)))
      .catch(() => null);
  } catch {
    // Deliberately silent: the objective bar shows the line as well.
    return Promise.resolve(null);
  }
}

/**
 * The message asked for as `ask` said with its decoded `clip`, where nothing made it moot since:
 * how long it speaks, ms. Null where it is moot, its recording let go then — unless a newer ask
 * wants the same words.
 */
function sayAsked(engine: Engine, ask: Ask, clip: Clip): number | null {
  if (weak.asked !== ask) {
    if (weak.asked?.text !== ask.text) releaseLine(ask.text);
    return null;
  }
  weak.speaking?.stop(engine.ctx.currentTime);
  weak.speaking = speak(engine, clip, ask.text, weakChain(engine.ctx, engine.announce, PA_LEVEL));
  weak.said += 1;
  return Math.round(clip.buffer.duration * 1000);
}

/** The game screen is gone: the loudspeakers' message breaks off, and none asked for comes. */
export function stopAnnounce(): void {
  weak.asked = null;
  try {
    const engine = playingEngine();
    if (engine !== null) weak.speaking?.stop(engine.ctx.currentTime);
  } catch {
    // Deliberately silent: the line ends on its own.
  }
  weak.speaking = null;
}

/**
 * The loudspeakers now, for the walkthrough: whether a line of the announcement speaks, the
 * line said last, how many have spoken, whether the power cut it off, and how many messages
 * they have said since on the emergency power.
 */
export interface PaProbe {
  playing: boolean;
  lastLine: string | null;
  played: number;
  cut: boolean;
  announced: number;
}

export function paProbe(): PaProbe {
  const run = current;
  const now = playingEngine()?.ctx.currentTime ?? 0;
  return {
    playing: run?.speaking != null && now < run.speaking.end,
    lastLine: run?.lastLine ?? null,
    played: run?.played ?? 0,
    cut: run?.cut ?? false,
    announced: weak.said,
  };
}
