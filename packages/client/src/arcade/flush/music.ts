/**
 * The tune of Ferret Flush's modern rules (the reference's src/music.js), made in code like every
 * other sound: a plucked marsh tune in C over four chords, a soft bass and a reed shaker, played
 * a little ahead of time on the clock of the audio. After dark it is muffled; on the decoy line
 * it hurries. It plays on the context it is given, into the node it is given.
 */

const BEAT = 60 / 96 / 2;
const AHEAD = 0.35;
/** Four bars of eighths: the chord of each bar and the tune, as semitones above middle C. */
const CHORDS: readonly (readonly [number, number, number])[] = [
  [0, 4, 7],
  [-3, 0, 4],
  [-7, -3, 0],
  [-5, -1, 2],
];
const TUNE: readonly (readonly (number | null)[])[] = [
  [7, null, 9, 7, 4, null, 2, 4],
  [0, null, 2, 4, 7, null, 4, null],
  [5, null, 4, 2, 0, null, 2, 4],
  [2, null, 7, null, 11, 9, 7, null],
  [7, null, 9, 12, 9, null, 7, 4],
  [4, null, 7, 9, 12, null, 9, null],
  [5, null, 9, 7, 5, 4, 2, null],
  [7, null, 2, null, 0, null, null, null],
];
const ARPEGGIO = [0, 1, 2, 1, 0, 1, 2, 1] as const;
const C4 = 261.63;

const pitch = (semitones: number): number => C4 * 2 ** (semitones / 12);

interface Pluck {
  type: OscillatorType;
  frequency: number;
  at: number;
  length: number;
  volume: number;
}

/** A plucked note: a quick rise and a fall, through the music bus. */
function pluck(context: BaseAudioContext, out: AudioNode, { type, frequency, at, length, volume }: Pluck): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(gain).connect(out);
  oscillator.start(at);
  oscillator.stop(at + length + 0.02);
}

function shake(context: BaseAudioContext, out: AudioNode, grain: AudioBuffer, at: number, volume: number): void {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = grain;
  filter.type = 'highpass';
  filter.frequency.value = 6000;
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  source.connect(filter).connect(gain).connect(out);
  source.start(at, Math.random() * 1.5);
  source.stop(at + 0.07);
}

/** One eighth of the loop: the tune, the arpeggio of the bar, the bass and the shaker. */
function eighth(
  context: BaseAudioContext,
  out: AudioNode,
  grain: AudioBuffer,
  step: number,
  at: number,
  beat: number,
): void {
  const bar = Math.floor(step / 8) % TUNE.length;
  const slot = step % 8;
  const chord = CHORDS[bar % CHORDS.length] ?? [0, 4, 7];
  const note = TUNE[bar]?.[slot] ?? null;
  if (note !== null) {
    const frequency = pitch(note + 12);
    pluck(context, out, { type: 'triangle', frequency, at, length: beat * 1.8, volume: 0.11 });
  }
  const tone = pitch(chord[ARPEGGIO[slot] ?? 0] ?? 0);
  pluck(context, out, { type: 'sine', frequency: tone, at, length: beat * 0.9, volume: 0.05 });
  bassAndShaker(context, out, grain, { root: chord[0], slot, at, beat });
}

/** The bass on the first and fifth eighth (root, then fifth), the shaker on the offbeats. */
function bassAndShaker(
  context: BaseAudioContext,
  out: AudioNode,
  grain: AudioBuffer,
  { root, slot, at, beat }: { root: number; slot: number; at: number; beat: number },
): void {
  if (slot % 4 === 0) {
    const frequency = pitch(root - 24 + (slot === 4 ? 7 : 0));
    pluck(context, out, { type: 'triangle', frequency, at, length: beat * 3, volume: 0.14 });
  }
  if (slot % 2 === 1) shake(context, out, grain, at, 0.025);
}

/** 'day', 'night' (muffled) or 'bonus' (faster). */
export type MusicMood = 'day' | 'night' | 'bonus';

export interface FlushMusic {
  /** Keeps the tune going (or lets it stop), called each frame. */
  play(on: boolean, mood: MusicMood): void;
}

/** The tune on `out`; `play(true or false, mood)` each frame keeps it going or lets it stop. */
export function createMusic(context: BaseAudioContext, out: AudioNode, grain: AudioBuffer): FlushMusic {
  const tone = context.createBiquadFilter();
  const level = context.createGain();
  tone.type = 'lowpass';
  tone.frequency.value = 9000;
  level.gain.value = 0;
  tone.connect(level).connect(out);
  let step = 0;
  let next = 0;
  let playing = false;
  /** Starts the loop a moment ahead, or fades it in or out. */
  const turn = (on: boolean, now: number): void => {
    if (on && !playing) next = now + 0.05;
    if (on !== playing) level.gain.setTargetAtTime(on ? 1 : 0, now, on ? 0.4 : 0.25);
    playing = on;
  };
  return {
    play(on, mood) {
      const now = context.currentTime;
      turn(on, now);
      tone.frequency.setTargetAtTime(mood === 'night' ? 1400 : 9000, now, 0.8);
      if (!on) return;
      const beat = mood === 'bonus' ? BEAT * 0.8 : BEAT;
      while (next < now + AHEAD) {
        eighth(context, tone, grain, step, next, beat);
        step = (step + 1) % (TUNE.length * 8);
        next += beat;
      }
    },
  };
}
