import { biquad, chain, gain, LOOKAHEAD, outlet, playingEngine, type Engine } from './audio.js';
import { paSchedule } from './intro/sequence.js';
import { clipOf, recordedMs, SPEECH_PEAK, voiceReady, type Clip } from './radioVoice.js';

/**
 * The lab's loudspeakers: mission control's announcement while an intro keeps the power on
 * (intro/sequence.ts), the same voice as the radio's, recorded with it (scripts/voice.ts,
 * public/voice/). Not a handset but a horn on a wall: a wider band, 300 Hz to 5 kHz, each edge
 * second order — no squelch, no static, no shaper — into the loudspeakers' bus at the Funk
 * volume (mix.ts `announce`), whose send the room the player stands in answers with its own
 * impulse response (reverb.ts); nothing ducks under it. Each line comes as its moment on the
 * sequence's clock comes (its
 * place from `paSchedule`); a line without a recording ready is left out, its subtitle still
 * shown. When the lights fail the power under the loudspeakers goes with them: the line on now
 * breaks off and nothing more comes (`cutAnnouncement`). Nothing here throws.
 */

/** The loudspeakers' band, Hz: wider than the radio's handset, still a horn's. */
export const PA_LOW = 300;
export const PA_HIGH = 5000;
/** A Butterworth edge of second order, as Web Audio takes a high- or low-pass's Q: in dB. */
const BUTTERWORTH_DB = 20 * Math.log10(Math.SQRT1_2);
/** The announcement at the master gain: a step under the radio's voice, heard across a room. */
export const PA_LEVEL = 0.1;
/** A line whose moment passed longer ago than this is left out: the screen came too late. */
const LATE_MS = 1000;
/** How fast a line breaks off as the power goes, s: the time constant of its fall. */
const CUT_TAU = 0.012;

/** The loudspeakers' chain: in at `input`, out of `out` at its level. */
export interface PaChain {
  readonly input: GainNode;
  readonly filters: readonly BiquadFilterNode[];
  readonly out: GainNode;
}

/**
 * A loudspeaker into `dest` at `level`: high-pass at 300 Hz and low-pass at 5 kHz, each second
 * order; the room it hangs in answers it on `dest`'s send (reverb.ts). On any context: the live
 * one, or an offline one to measure it.
 */
export function paChain(ctx: BaseAudioContext, dest: AudioNode, level: number): PaChain {
  const input = gain(ctx, 1);
  const low = biquad(ctx, 'highpass', PA_LOW, BUTTERWORTH_DB);
  const high = biquad(ctx, 'lowpass', PA_HIGH, BUTTERWORTH_DB);
  const out = outlet(ctx, dest, level);
  chain(input, low, high, out);
  return { input, filters: [low, high], out };
}

/** The line on the loudspeakers: what it says, when it ends (audio time), how it breaks off. */
interface Speaking {
  readonly text: string;
  readonly end: number;
  readonly stop: (at: number) => void;
}

/** An announcement under way on this screen. */
interface Announcement {
  timers: ReturnType<typeof setTimeout>[];
  speaking: Speaking | null;
  lastLine: string | null;
  played: number;
  cut: boolean;
}

let current: Announcement | null = null;

/**
 * Starts the announcement `lines` on a sequence that began at `since` (epoch ms): once the voice
 * manifest is here, every line is put in its place on the sequence's clock by its length, and
 * each speaks as its moment comes. One already under way stops.
 */
export function startAnnouncement(lines: readonly string[], since: number): void {
  stopAnnouncement();
  const run: Announcement = { timers: [], speaking: null, lastLine: null, played: 0, cut: false };
  current = run;
  void voiceReady().then(() => {
    if (current !== run) return;
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
    run.speaking = speak(engine, clip, text);
    run.played += 1;
  } catch {
    // Deliberately silent: the subtitle shows the line as well.
  }
}

/**
 * The recording `clip` through a loudspeaker's chain into the loudspeakers' bus, from now on;
 * the chain goes as the line ends — the room's answer rings on in the reverb.
 */
function speak(engine: Engine, clip: Clip, text: string): Speaking {
  const { ctx } = engine;
  const pa = paChain(ctx, engine.announce, PA_LEVEL);
  const speech = ctx.createBufferSource();
  speech.buffer = clip.buffer;
  chain(speech, gain(ctx, SPEECH_PEAK / clip.peak), pa.input);
  const at = ctx.currentTime + LOOKAHEAD;
  speech.start(at);
  speech.addEventListener('ended', () => pa.out.disconnect());
  const stop = (when: number): void => {
    pa.out.gain.setTargetAtTime(0, when, CUT_TAU);
    speech.stop(when + CUT_TAU * 5);
  };
  return { text, end: at + clip.buffer.duration, stop };
}

/** The power goes under the loudspeakers: the line on now breaks off, and nothing more comes. */
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
}

/** The screen is gone: the announcement breaks off and is forgotten. */
export function stopAnnouncement(): void {
  cutAnnouncement();
  current = null;
}

/**
 * The announcement now, for the walkthrough: whether a line speaks, the line said last, how
 * many have spoken, and whether the power cut it off.
 */
export interface PaProbe {
  playing: boolean;
  lastLine: string | null;
  played: number;
  cut: boolean;
}

export function paProbe(): PaProbe {
  const run = current;
  const now = playingEngine()?.ctx.currentTime ?? 0;
  return {
    playing: run?.speaking != null && now < run.speaking.end,
    lastLine: run?.lastLine ?? null,
    played: run?.played ?? 0,
    cut: run?.cut ?? false,
  };
}
