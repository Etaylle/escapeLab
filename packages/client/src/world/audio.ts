/**
 * audio.ts: procedural ambience and sound effects for EscapeLab.
 *
 * Everything is synthesised at runtime from oscillators, filters and one shared noise buffer;
 * there are no audio files. All levels are deliberately quiet because this plays under the
 * players' voice chat, and every sound passes through a single master gain, so the whole
 * module can be muted or scaled in one place.
 *
 * Audio is decorative, so no public function ever throws: errors are swallowed on purpose.
 * The one shared AudioContext is created lazily on first use. While browser autoplay policy
 * keeps it suspended, one-shot effects are skipped (so they cannot queue up and all fire at
 * once later) and the next user gesture resumes it. Ambience started while suspended is
 * built anyway and becomes audible as soon as the context resumes.
 */

type AudioContextCtor = new () => AudioContext;

interface Engine {
  readonly ctx: AudioContext;
  /** Every sound in the module passes through this gain: the single mute/volume point. */
  readonly master: GainNode;
}

/** Gain envelope: linear attack to `peak`, flat hold, then exponential decay to silence. */
interface Envelope {
  readonly peak: number;
  readonly attack: number;
  readonly hold: number;
  readonly decay: number;
}

/** An enveloped oscillator whose pitch glides exponentially from `from` to `to`. */
interface ToneSpec extends Envelope {
  readonly type: OscillatorType;
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/** All nodes of one ambience run, so it can be faded, stopped and disconnected as a unit. */
interface Ambience {
  readonly nodes: AudioNode[];
  readonly sources: AudioScheduledSourceNode[];
  /** Fade-out stage, separate from the fade-in so stopping never has to cancel a ramp. */
  readonly fade: GainNode;
  /** Input for the distant clanks and creaks, which get muffled and echoed. */
  readonly distant: GainNode;
}

const MASTER_LEVEL = 1;
const AMBIENCE_LEVEL = 0.025;
const FOOTSTEP_LEVEL = 0.02;
const DOOR_LEVEL = 0.04;
const CHIRP_LEVEL = 0.03;
const DRAIN_LEVEL = 0.05;

/** Exponential ramps cannot reach zero; this is -80 dB. */
const SILENCE = 0.0001;
/** Scheduling headroom so main-thread jitter never clips the start of an envelope. */
const LOOKAHEAD = 0.01;
const NOISE_SECONDS = 2;

const AMBIENCE_FADE_IN = 3;
const AMBIENCE_FADE_OUT = 0.5;
const AIR_LEVEL = 0.5;
const DISTANT_MIN_MS = 7000;
const DISTANT_MAX_MS = 15000;
const CREAK_CHANCE = 0.35;
const DOOR_SLIDE_SECONDS = 0.25;
const DRAIN_SECONDS = 0.8;

/** [frequency in Hz, level]: unequal levels keep the slow beat a swell rather than a dropout. */
const HUM_VOICES = [
  [55, 0.5],
  [55.4, 0.3],
] as const;
/** [frequency ratio, level, decay in s] of the partials of a struck free metal bar. */
const CLANK_PARTIALS = [
  [1, 0.4, 1.1],
  [2.76, 0.28, 0.7],
  [5.4, 0.18, 0.4],
  [8.93, 0.1, 0.22],
] as const;
const DRAIN_DETUNE = [1, 1.012] as const;
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const;

let engine: Engine | null = null;
let engineUnavailable = false;
let noise: AudioBuffer | null = null;
let ambience: Ambience | null = null;
let distantTimer: ReturnType<typeof setTimeout> | undefined;
let unlockArmed = false;

/**
 * Idempotent. Starts a very quiet lab ambience: a low detuned hum, a whisper of ventilation
 * noise and, every 7-15 s, a faint distant metallic clank or creak.
 */
export function startAmbience(): void {
  try {
    if (ambience !== null) return;
    const audio = getEngine();
    if (audio === null || audio.ctx.state === 'closed') return;
    unlock();
    ambience = buildAmbience(audio);
    scheduleDistantSound(audio.ctx, ambience);
  } catch {
    // Deliberately silent: a quiet lab is better than a broken game.
  }
}

/** Fades the ambience out over ~0.5 s and stops its nodes. Safe when not running. */
export function stopAmbience(): void {
  try {
    clearTimeout(distantTimer);
    distantTimer = undefined;
    const current = ambience;
    ambience = null;
    if (current !== null && engine !== null) releaseAmbience(engine.ctx, current);
  } catch {
    // Deliberately silent: the clank scheduler is already cancelled at this point.
  }
}

/** Soft ~60 ms footstep tap with ±10% pitch variation; cheap enough for ~3 calls per second. */
export function footstep(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const pitch = rand(0.9, 1.1);
    const out = outlet(ctx, audio.master, FOOTSTEP_LEVEL);
    // A sine falling an octave reads as a soft heel thump rather than as a pitched tone.
    const thump = tone(ctx, out, {
      type: 'sine',
      at: t,
      from: 150 * pitch,
      to: 70 * pitch,
      peak: 0.7,
      attack: 0.004,
      hold: 0,
      decay: 0.075,
    });
    const scuff = noiseBurst(ctx, t, 0.025);
    const scuffLevel = gain(ctx, 0);
    applyEnvelope(scuffLevel.gain, t, { peak: 0.45, attack: 0.001, hold: 0, decay: 0.02 });
    chain(scuff, biquad(ctx, 'bandpass', 2500 * pitch, 0.9), scuffLevel, out);
    onAllEnded([thump, scuff], () => out.disconnect());
  } catch {
    // Deliberately silent: a missed footstep is harmless.
  }
}

/** Pneumatic door slide: a ~0.25 s filtered-noise whoosh ending in a soft metallic click. */
export function doorSlide(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const end = t + DOOR_SLIDE_SECONDS;
    const out = outlet(ctx, audio.master, DOOR_LEVEL);
    // The band sweeps down while the panel travels: a bright hiss settling into a whoosh.
    const hiss = noiseBurst(ctx, t, DOOR_SLIDE_SECONDS);
    const band = biquad(ctx, 'bandpass', 2400, 0.8);
    band.frequency.setValueAtTime(2400, t);
    band.frequency.exponentialRampToValueAtTime(600, end);
    const swell = gain(ctx, 0);
    swell.gain.setValueAtTime(0, t);
    swell.gain.linearRampToValueAtTime(0.8, t + 0.03);
    swell.gain.linearRampToValueAtTime(0.35, t + 0.18);
    swell.gain.linearRampToValueAtTime(0, end);
    chain(hiss, band, swell, out);
    const clickAt = end - 0.015;
    const click = tone(ctx, out, {
      type: 'triangle',
      at: clickAt,
      from: 1700,
      to: 1600,
      peak: 0.35,
      attack: 0.001,
      hold: 0,
      decay: 0.04,
    });
    const ping = tone(ctx, out, {
      type: 'sine',
      at: clickAt,
      from: 4300,
      to: 4300,
      peak: 0.12,
      attack: 0.001,
      hold: 0,
      decay: 0.02,
    });
    onAllEnded([hiss, click, ping], () => out.disconnect());
  } catch {
    // Deliberately silent: the door still opens without its sound.
  }
}

/** Rising two-tone 'station ready' chirp, ~0.3 s. */
export function stationChirp(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, CHIRP_LEVEL);
    const low = tone(ctx, out, {
      type: 'triangle',
      at: t,
      from: 680,
      to: 720,
      peak: 0.85,
      attack: 0.01,
      hold: 0.05,
      decay: 0.06,
    });
    const high = tone(ctx, out, {
      type: 'triangle',
      at: t + 0.13,
      from: 1020,
      to: 1090,
      peak: 0.85,
      attack: 0.01,
      hold: 0.07,
      decay: 0.09,
    });
    onAllEnded([low, high], () => out.disconnect());
  } catch {
    // Deliberately silent: the station state is shown visually as well.
  }
}

/**
 * Short bright blip marking a map ping, pitched above the station chirp so the two
 * never get confused.
 */
export function pingBlip(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, CHIRP_LEVEL);
    const blip = tone(ctx, out, {
      type: 'sine',
      at: t,
      from: 1560,
      to: 1960,
      peak: 0.8,
      attack: 0.005,
      hold: 0.03,
      decay: 0.12,
    });
    onAllEnded([blip], () => out.disconnect());
  } catch {
    // Deliberately silent: pings are shown on the map as well.
  }
}

/**
 * Deep red-alert swell for penalties (~0.8 s): detuned saws sagging in pitch behind a closing
 * lowpass, so it reads as power draining away rather than as a klaxon.
 */
export function powerDrain(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const end = t + DRAIN_SECONDS;
    const out = outlet(ctx, audio.master, DRAIN_LEVEL);
    const lowpass = biquad(ctx, 'lowpass', 1400, 4);
    lowpass.frequency.setValueAtTime(1400, t);
    lowpass.frequency.exponentialRampToValueAtTime(150, end);
    const swell = gain(ctx, 0);
    swell.gain.setValueAtTime(0, t);
    swell.gain.linearRampToValueAtTime(0.4, t + 0.2);
    swell.gain.linearRampToValueAtTime(0.28, t + 0.5);
    swell.gain.linearRampToValueAtTime(0, end);
    chain(lowpass, swell, out);
    const saws = DRAIN_DETUNE.map((ratio) => {
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(130 * ratio, t);
      saw.frequency.exponentialRampToValueAtTime(40 * ratio, end);
      saw.connect(lowpass);
      saw.start(t);
      saw.stop(end + 0.02);
      return saw;
    });
    onAllEnded(saws, () => out.disconnect());
  } catch {
    // Deliberately silent: the penalty is shown visually as well.
  }
}

function getEngine(): Engine | null {
  if (engine === null && !engineUnavailable) {
    engine = createEngine();
    engineUnavailable = engine === null;
    syncUnlockListeners();
  }
  return engine;
}

function createEngine(): Engine | null {
  try {
    const scope: { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor } =
      globalThis;
    const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
    if (Ctor === undefined) return null;
    const ctx = new Ctor();
    ctx.onstatechange = syncUnlockListeners;
    return { ctx, master: outlet(ctx, ctx.destination, MASTER_LEVEL) };
  } catch {
    return null;
  }
}

/** The engine when it can play right now; otherwise null, after nudging a resume. */
function runningEngine(): Engine | null {
  const audio = getEngine();
  if (audio === null) return null;
  if (audio.ctx.state === 'running') return audio;
  unlock();
  return null;
}

/** Asks a suspended context to resume; autoplay policy lets this succeed after a gesture. */
function unlock(): void {
  try {
    if (engine !== null && engine.ctx.state !== 'running') {
      engine.ctx.resume().catch(() => undefined);
    }
  } catch {
    // Deliberately silent: legacy contexts without resume() simply stay locked.
  }
}

/** Listens for user gestures only while the context is locked, to resume it from one. */
function syncUnlockListeners(): void {
  try {
    if (engine === null || typeof window === 'undefined') return;
    const { state } = engine.ctx;
    const locked = state !== 'running' && state !== 'closed';
    if (locked === unlockArmed) return;
    unlockArmed = locked;
    for (const type of UNLOCK_EVENTS) {
      if (locked) window.addEventListener(type, unlock, { capture: true, passive: true });
      else window.removeEventListener(type, unlock, { capture: true });
    }
  } catch {
    // Deliberately silent: sound calls still nudge a resume on their own.
  }
}

function buildAmbience(audio: Engine): Ambience {
  const { ctx } = audio;
  const t = ctx.currentTime;
  const amb: Ambience = { nodes: [], sources: [], fade: gain(ctx, 1), distant: gain(ctx, 1) };
  const level = gain(ctx, 0);
  level.gain.setValueAtTime(0, t);
  level.gain.linearRampToValueAtTime(AMBIENCE_LEVEL, t + AMBIENCE_FADE_IN);
  chain(level, amb.fade, audio.master);
  amb.nodes.push(level, amb.fade, amb.distant);
  addHum(ctx, amb, level);
  addAir(ctx, amb, level);
  addDistance(ctx, amb, level);
  for (const source of amb.sources) source.start(t);
  return amb;
}

/** Two slightly detuned sines beating slowly against each other, like a mains hum. */
function addHum(ctx: AudioContext, amb: Ambience, dest: AudioNode): void {
  const lowpass = biquad(ctx, 'lowpass', 120, 0);
  lowpass.connect(dest);
  amb.nodes.push(lowpass);
  for (const [frequency, level] of HUM_VOICES) {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    const voice = gain(ctx, level);
    chain(osc, voice, lowpass);
    amb.nodes.push(osc, voice);
    amb.sources.push(osc);
  }
}

/** Ventilation whisper: looped noise in a wide band whose centre drifts very slowly. */
function addAir(ctx: AudioContext, amb: Ambience, dest: AudioNode): void {
  const air = ctx.createBufferSource();
  air.buffer = noiseBuffer(ctx);
  air.loop = true;
  const band = biquad(ctx, 'bandpass', 600, 0.7);
  const level = gain(ctx, AIR_LEVEL);
  chain(air, band, level, dest);
  const drift = ctx.createOscillator();
  drift.frequency.value = 0.06;
  // Modulation depth in Hz applied to the band centre, not an audio level.
  const depth = gain(ctx, 200);
  drift.connect(depth);
  depth.connect(band.frequency);
  amb.nodes.push(air, band, level, drift, depth);
  amb.sources.push(air, drift);
}

/** Distant sounds lose their highs and pick up a dark, decaying echo from the corridors. */
function addDistance(ctx: AudioContext, amb: Ambience, dest: AudioNode): void {
  const muffle = biquad(ctx, 'lowpass', 1800, 0);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.23;
  const darken = biquad(ctx, 'lowpass', 1100, 0);
  const feedback = gain(ctx, 0.35);
  const wet = gain(ctx, 0.4);
  chain(amb.distant, muffle, dest);
  chain(amb.distant, delay, darken, feedback, delay);
  chain(darken, wet, dest);
  amb.nodes.push(muffle, delay, darken, feedback, wet);
}

function releaseAmbience(ctx: AudioContext, amb: Ambience): void {
  const disconnectAll = (): void => {
    for (const node of amb.nodes) node.disconnect();
  };
  if (ctx.state !== 'running') {
    // Nothing is audible, so tear down now instead of fading out after a later resume.
    for (const source of amb.sources) source.stop();
    disconnectAll();
    return;
  }
  const t = ctx.currentTime;
  amb.fade.gain.setValueAtTime(1, t);
  amb.fade.gain.linearRampToValueAtTime(0, t + AMBIENCE_FADE_OUT);
  for (const source of amb.sources) source.stop(t + AMBIENCE_FADE_OUT + 0.05);
  onAllEnded(amb.sources, disconnectAll);
}

/** One link of the clank/creak timer chain; stopAmbience() cancels the pending link. */
function scheduleDistantSound(ctx: AudioContext, amb: Ambience): void {
  distantTimer = setTimeout(() => {
    try {
      if (ambience !== amb) return;
      scheduleDistantSound(ctx, amb);
      if (ctx.state !== 'running') return;
      if (Math.random() < CREAK_CHANCE) creak(ctx, amb.distant);
      else clank(ctx, amb.distant);
    } catch {
      // Deliberately silent: only this one sound is lost, the next is already scheduled.
    }
  }, rand(DISTANT_MIN_MS, DISTANT_MAX_MS));
}

/** Struck metal, sometimes followed by a softer rebound. */
function clank(ctx: AudioContext, dest: AudioNode): void {
  const t = ctx.currentTime + LOOKAHEAD;
  const base = rand(170, 320);
  const level = rand(0.3, 0.5);
  strike(ctx, dest, t, base, level);
  if (Math.random() < 0.5) {
    strike(ctx, dest, t + rand(0.08, 0.2), base * rand(0.97, 1.03), level * 0.4);
  }
}

function strike(ctx: AudioContext, dest: AudioNode, at: number, base: number, level: number): void {
  const out = outlet(ctx, dest, level);
  const sources: AudioScheduledSourceNode[] = CLANK_PARTIALS.map(([ratio, peak, decay]) =>
    tone(ctx, out, {
      type: 'sine',
      at,
      from: base * ratio,
      to: base * ratio,
      peak,
      attack: 0.002,
      hold: 0,
      decay,
    }),
  );
  const impact = noiseBurst(ctx, at, 0.04);
  const impactLevel = gain(ctx, 0);
  applyEnvelope(impactLevel.gain, at, { peak: 0.3, attack: 0.001, hold: 0, decay: 0.03 });
  chain(impact, biquad(ctx, 'bandpass', base * 6, 1.2), impactLevel, out);
  sources.push(impact);
  onAllEnded(sources, () => out.disconnect());
}

/** Strained metal: a tone chopped into irregular stick-slip friction pulses. */
function creak(ctx: AudioContext, dest: AudioNode): void {
  const t = ctx.currentTime + LOOKAHEAD;
  const length = rand(0.8, 1.5);
  const end = t + length;
  const pitch = rand(380, 560);
  const voice = ctx.createOscillator();
  voice.type = 'triangle';
  voice.frequency.setValueAtTime(pitch, t);
  voice.frequency.linearRampToValueAtTime(pitch * 0.92, end);
  // Gain 0.5 - 0.5 * saw jumps to 1 and decays linearly each cycle: one pulse per 'slip'.
  const slip = ctx.createOscillator();
  slip.type = 'sawtooth';
  slip.frequency.setValueAtTime(rand(12, 20), t);
  slip.frequency.linearRampToValueAtTime(rand(24, 34), t + length * 0.4);
  slip.frequency.linearRampToValueAtTime(rand(9, 16), end);
  const depth = gain(ctx, -0.5);
  const chopper = gain(ctx, 0.5);
  slip.connect(depth);
  depth.connect(chopper.gain);
  const swell = gain(ctx, 0);
  swell.gain.setValueAtTime(0, t);
  swell.gain.linearRampToValueAtTime(rand(0.2, 0.35), t + length * 0.3);
  swell.gain.linearRampToValueAtTime(0, end);
  chain(voice, chopper, swell, dest);
  for (const osc of [voice, slip]) {
    osc.start(t);
    osc.stop(end + 0.02);
  }
  onAllEnded([voice, slip], () => swell.disconnect());
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function gain(ctx: AudioContext, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

/** A gain stage at `level` feeding `dest`; a sound's outlet level is its ceiling. */
function outlet(ctx: AudioContext, dest: AudioNode, level: number): GainNode {
  const node = gain(ctx, level);
  node.connect(dest);
  return node;
}

/** `q` is a linear Q for bandpass but a resonance in dB for lowpass (a Web Audio quirk). */
function biquad(
  ctx: AudioContext,
  type: BiquadFilterType,
  frequency: number,
  q: number,
): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  return filter;
}

function chain(first: AudioNode, ...rest: AudioNode[]): void {
  let previous = first;
  for (const node of rest) {
    previous.connect(node);
    previous = node;
  }
}

/** Schedules `env` on `param` starting at `at` and returns the time it reaches silence. */
function applyEnvelope(param: AudioParam, at: number, env: Envelope): number {
  const peakAt = at + env.attack;
  const end = peakAt + env.hold + env.decay;
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(env.peak, peakAt);
  param.setValueAtTime(env.peak, peakAt + env.hold);
  param.exponentialRampToValueAtTime(SILENCE, end);
  return end;
}

function tone(ctx: AudioContext, dest: AudioNode, spec: ToneSpec): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = spec.type;
  const level = gain(ctx, 0);
  const end = applyEnvelope(level.gain, spec.at, spec);
  osc.frequency.setValueAtTime(spec.from, spec.at);
  osc.frequency.exponentialRampToValueAtTime(spec.to, end);
  chain(osc, level, dest);
  osc.start(spec.at);
  osc.stop(end + 0.01);
  return osc;
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise === null) {
    const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise = buffer;
  }
  return noise;
}

/** A one-shot slice of the shared noise; the random offset keeps repeats from sounding alike. */
function noiseBurst(ctx: AudioContext, at: number, duration: number): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  const buffer = noiseBuffer(ctx);
  source.buffer = buffer;
  source.start(at, Math.random() * Math.max(0, buffer.duration - duration), duration);
  return source;
}

function onAllEnded(sources: readonly AudioScheduledSourceNode[], done: () => void): void {
  let pending = sources.length;
  for (const source of sources) {
    source.onended = () => {
      pending -= 1;
      if (pending === 0) done();
    };
  }
}
