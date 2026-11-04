import { biquad, chain, gain } from '../world/audio.js';

/**
 * One crew voice on its way to the ear, and the station's intercom on it (voice/mesh.ts).
 * Between the places of the armed station — its consoles and the open sources that cover it
 * (core map.ts `intercomOf`) — a voice plays in full however far apart the two stand
 * (rules.ts `crewGain`), as a console's speaker gives it: a high-pass at 400 Hz and a low-pass
 * at 4 kHz, each second order, and a touch of the room's answer — the reverb the plant's
 * loudspeakers ring in (world/reverb.ts), fed 14 dB under the voice, as the lab's effects feed
 * it. No squelch, no static, no shaper: the speaker is no radio. Everywhere else the voice
 * plays plain, as loud as the distance and the walls let it, as it did before the intercom.
 * Going on the intercom or off it takes LINK_RAMP_S: the volume moves on a straight line and
 * the plain way and the speaker's cross on two more, so that nothing clicks.
 *
 *   voice ─ volume ─┬─ plain ──────────────────────────────── output
 *                   └─ 400 Hz ─ 4 kHz ─ speaker ─┬─────────── output
 *                                                └─ −14 dB ── the room's reverb
 */

/** The speaker's band, Hz: a console's small speaker, narrower than the plant's horns. */
export const INTERCOM_LOW = 400;
export const INTERCOM_HIGH = 4000;
/** How far under the voice the speaker feeds the room's reverb, dB: the effects' send. */
export const INTERCOM_SEND_DB = -14;
/** How long going on the intercom or off it takes, s. */
export const LINK_RAMP_S = 0.15;
/** A Butterworth edge of second order, as Web Audio takes a high- or low-pass's Q: in dB. */
const BUTTERWORTH_DB = 20 * Math.log10(Math.SQRT1_2);

/** The nodes one crew voice plays through. */
export interface VoicePath {
  /** the voice's volume: by the distance and the walls, or in full over the intercom */
  readonly volume: GainNode;
  /** the plain way to the output: open under the proximity rule, shut over the intercom */
  readonly plain: GainNode;
  /** the speaker's band: the high-pass, then the low-pass */
  readonly filters: readonly [BiquadFilterNode, BiquadFilterNode];
  /** the speaker's way to the output: open over the intercom, shut under the proximity rule */
  readonly speaker: GainNode;
  /** the speaker's send into the room's reverb; null where the lab has no reverb to feed */
  readonly send: GainNode | null;
}

/**
 * The way `voice` takes to `out` at `level`: over the intercom (`linked`) or plain, the
 * speaker's send into `reverb` where there is one. On any context: the live one, or an offline
 * one to measure it.
 */
export function voicePath(
  ctx: BaseAudioContext,
  voice: AudioNode,
  out: AudioNode,
  reverb: AudioNode | null,
  level: number,
  linked: boolean,
): VoicePath {
  const volume = gain(ctx, level);
  const plain = gain(ctx, linked ? 0 : 1);
  const low = biquad(ctx, 'highpass', INTERCOM_LOW, BUTTERWORTH_DB);
  const high = biquad(ctx, 'lowpass', INTERCOM_HIGH, BUTTERWORTH_DB);
  const speaker = gain(ctx, linked ? 1 : 0);
  chain(voice, volume, plain, out);
  chain(volume, low, high, speaker, out);
  let send: GainNode | null = null;
  if (reverb !== null) {
    send = gain(ctx, 10 ** (INTERCOM_SEND_DB / 20));
    chain(speaker, send, reverb);
  }
  return { volume, plain, filters: [low, high], speaker, send };
}

/** `param` on a straight line from where it stands at `now` to `value`, LINK_RAMP_S later. */
function rampTo(param: AudioParam, value: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + LINK_RAMP_S);
}

/**
 * Takes `path` on to the intercom (`linked`) or off it from `now` (audio time): its volume to
 * `level`, the plain way and the speaker's across, each on a straight line over LINK_RAMP_S.
 */
export function switchPath(path: VoicePath, level: number, linked: boolean, now: number): void {
  rampTo(path.volume.gain, level, now);
  rampTo(path.plain.gain, linked ? 0 : 1, now);
  rampTo(path.speaker.gain, linked ? 1 : 0, now);
}

/** Unwires `path` from the output and the reverb: the voice it carried is gone. */
export function dropPath(path: VoicePath): void {
  for (const node of [path.volume, path.plain, path.speaker, path.send]) {
    node?.disconnect();
  }
}
