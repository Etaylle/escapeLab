/**
 * mix.ts: the buses every sound of the lab goes through, what the settings bind them to, how one
 * pulls another down, and the brickwall on the master that keeps them from clipping.
 *
 *   music ───── musicDuck ────┐
 *   sfx ──────────────────────┤
 *   ambience ── ambienceDuck ─┼── master (the mute) ── limiter ── trim ── output
 *   voice ────────────────────┤      (the radio: dry)
 *   announce ─────────────────┤      (the loudspeakers)
 *   reverb's return ──────────┘
 *   sfx, ambience after its duck, announce ── a send each ── reverb (reverb.ts)
 *
 * The settings' volumes set the buses (settings.ts): Musik the music, Effekte the effects,
 * Umgebung the rooms' beds, Funk mission control's voice and the plant's loudspeakers; Gesamt
 * sets the master gain, which the sound switch mutes (audio.ts). Behind it a
 * DynamicsCompressorNode stands as a brickwall — threshold −3 dB, no knee, 20:1, 1 ms attack,
 * 100 ms release — so that effects stacked on one another never clip; Web Audio raises
 * everything after it by a makeup gain worked out from those settings (`limiterMakeup`), which
 * the trim takes back, so the mix under the threshold plays as loud as before. Ducking (`duck`):
 * mission control's voice pulls the music 8 dB and the beds 4 dB down, the klaxon and the siren
 * pull the music 6 dB down; where several pull at once the deepest holds. A bus goes down over
 * DUCK_ATTACK_S and comes back over DUCK_RELEASE_S, in straight lines on the audio clock
 * (`duckKnots`, pure).
 */

/** The volumes, each a share of full (0 to 1): the master's and the buses'. */
export interface BusVolumes {
  /** the whole lab at the master gain (Gesamt), under the sound switch's mute (audio.ts) */
  readonly master: number;
  readonly music: number;
  /** every sound of the lab but its beds, the radio and the music (Effekte) */
  readonly effects: number;
  /** mission control's voice, the radio's key and the plant's loudspeakers (Funk) */
  readonly voice: number;
  /** the rooms' beds (Umgebung) */
  readonly ambience: number;
}

/** The mix's nodes on one context. */
export interface Mix {
  /** every bus's sum, the single mute point: into the brickwall */
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  /** after the brickwall: takes its makeup gain back */
  readonly trim: GainNode;
  /** the effects (Effekte): every sound of the lab but its beds, the radio and the music */
  readonly sfx: GainNode;
  /** the rooms' beds (Umgebung), in front of their duck */
  readonly ambience: GainNode;
  readonly ambienceDuck: GainNode;
  /** the music (Musik), in front of its duck */
  readonly music: GainNode;
  readonly musicDuck: GainNode;
  /** mission control's voice and the radio's key (Funk): dry, the radio stays out of the room */
  readonly voice: GainNode;
  /** the plant's loudspeakers (Funk): heard in the room, its reverb and all */
  readonly announce: GainNode;
  /** where the sends into the room's reverb meet (reverb.ts) */
  readonly sends: GainNode;
}

/** The brickwall on the master. */
export const LIMITER = { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1 } as const;

/**
 * The makeup gain Web Audio's compressor puts after itself, dB: the gain its curve has at full
 * scale, inverted and raised to 0.6 (the spec's „makeup gain"), for a curve with no knee.
 */
export function limiterMakeup(threshold: number, ratio: number): number {
  const fullRange = threshold * (1 - 1 / ratio);
  return -0.6 * fullRange;
}

/** Each bus's send into the room's reverb, dB: the effects, the beds, the loudspeakers. */
export const SEND_DB = { sfx: -14, ambience: -18, announce: -6 } as const;

/** How quickly a bus follows its volume as a slider moves, s. */
export const VOLUME_GLIDE = 0.05;

/** A gain stage at `value` feeding `dest`. */
function stage(ctx: BaseAudioContext, dest: AudioNode, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  node.connect(dest);
  return node;
}

/** The brickwall into `dest`: the limiter at LIMITER, the trim behind it. */
function brickwall(
  ctx: BaseAudioContext,
  dest: AudioNode,
): { limiter: DynamicsCompressorNode; trim: GainNode } {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.threshold;
  limiter.knee.value = LIMITER.knee;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;
  const makeup = limiterMakeup(LIMITER.threshold, LIMITER.ratio);
  const trim = stage(ctx, dest, 10 ** (-makeup / 20));
  limiter.connect(trim);
  return { limiter, trim };
}

/** The mix on `ctx` into its output, at `volumes`, the master at `master` (0: muted). */
export function buildMix(ctx: BaseAudioContext, volumes: BusVolumes, master: number): Mix {
  const { limiter, trim } = brickwall(ctx, ctx.destination);
  const out = stage(ctx, limiter, master);
  const sends = ctx.createGain();
  const musicDuck = stage(ctx, out, 1);
  const ambienceDuck = stage(ctx, out, 1);
  const mix: Mix = {
    master: out,
    limiter,
    trim,
    sfx: stage(ctx, out, volumes.effects),
    ambience: stage(ctx, ambienceDuck, volumes.ambience),
    ambienceDuck,
    music: stage(ctx, musicDuck, volumes.music),
    musicDuck,
    voice: stage(ctx, out, volumes.voice),
    announce: stage(ctx, out, volumes.voice),
    sends,
  };
  for (const [bus, db] of [
    [mix.sfx, SEND_DB.sfx],
    [mix.ambienceDuck, SEND_DB.ambience],
    [mix.announce, SEND_DB.announce],
  ] as const) {
    bus.connect(stage(ctx, sends, 10 ** (db / 20)));
  }
  return mix;
}

/**
 * Sets the buses to `volumes` from `now`, gliding: Funk, Effekte, Umgebung, Musik; the master
 * gain is the sound switch's to set (audio.ts).
 */
export function setBusVolumes(mix: Mix, volumes: BusVolumes, now: number): void {
  const set = (bus: GainNode, value: number): void => {
    bus.gain.setTargetAtTime(value, now, VOLUME_GLIDE);
  };
  set(mix.voice, volumes.voice);
  set(mix.announce, volumes.voice);
  set(mix.sfx, volumes.effects);
  set(mix.ambience, volumes.ambience);
  set(mix.music, volumes.music);
}

// --- ducking ---------------------------------------------------------------------------------

/**
 * What pulls a bus down: mission control's voice, the klaxon, the siren — and the crew's own voice
 * in the lobby, over the menu's theme and hum (menuSound.ts).
 */
export type DuckSource = 'voice' | 'alarm' | 'siren' | 'crew';

/** How far each source pulls a bus down, dB; a source with none for the bus leaves it be. */
export type Depths = Readonly<Partial<Record<DuckSource, number>>>;

/** How far the sources pull the music and the beds down, dB. */
export const DUCK_DB: Readonly<Record<'music' | 'ambience', Depths>> = {
  music: { voice: -8, alarm: -6, siren: -6, crew: -8 },
  ambience: { voice: -4, crew: -4 },
};
/** A bus goes down over this long, s… */
export const DUCK_ATTACK_S = 0.05;
/** …and comes back over this long, s. */
export const DUCK_RELEASE_S = 0.4;

/** A source pulling: from when until when, audio time; Infinity until it is let go. */
export interface Dip {
  readonly from: number;
  readonly until: number;
}

/** A point the bus's level passes, on a straight line from the one before: when, and how far. */
export interface Knot {
  readonly at: number;
  readonly level: number;
}

/** The deepest of the `dips` in force at `t`, as a level, linear; 1 where none is. */
function deepestAt(dips: ReadonlyMap<DuckSource, Dip>, depths: Depths, t: number): number {
  let level = 1;
  for (const [source, dip] of dips) {
    const db = depths[source];
    const inForce = dip.from <= t && t < dip.until;
    if (db !== undefined && inForce) level = Math.min(level, 10 ** (db / 20));
  }
  return level;
}

/**
 * The way a bus moves from `now` on, standing at `level` then, under `dips` pulling as deep as
 * `depths` say: at every moment one starts or ends, the bus heads for the deepest in force —
 * down over DUCK_ATTACK_S, up over DUCK_RELEASE_S — a move cut short where the next begins.
 * Returns its knots, the first at `now`.
 */
export function duckKnots(
  dips: ReadonlyMap<DuckSource, Dip>,
  depths: Depths,
  now: number,
  level: number,
): Knot[] {
  const moments = [...dips.values()]
    .flatMap(({ from, until }) => [from, until])
    .filter((t) => t > now && Number.isFinite(t));
  const times = [now, ...new Set(moments)].sort((a, b) => a - b);
  const knots: Knot[] = [{ at: now, level }];
  let at = level;
  times.forEach((start, i) => {
    const next = times[i + 1] ?? Infinity;
    const goal = deepestAt(dips, depths, start);
    const take = goal < at ? DUCK_ATTACK_S : DUCK_RELEASE_S;
    if (goal === at) {
      if (Number.isFinite(next)) knots.push({ at: next, level: at });
      return;
    }
    const end = start + take;
    at = end <= next ? goal : at + ((goal - at) * (next - start)) / take;
    knots.push({ at: Math.min(end, next), level: at });
    if (end < next && Number.isFinite(next)) knots.push({ at: next, level: at });
  });
  return knots;
}

/** Where knots put a bus at audio time `t`. */
export function levelOn(knots: readonly Knot[], t: number): number {
  let before: Knot = knots[0] ?? { at: 0, level: 1 };
  for (const knot of knots) {
    if (knot.at > t) {
      const span = knot.at - before.at;
      if (!(span > 0)) return knot.level;
      return before.level + ((knot.level - before.level) * (t - before.at)) / span;
    }
    before = knot;
  }
  return before.level;
}

/** What each mix is pulled by now, and the knots each of its ducks was last set on. */
const pulls = new WeakMap<Mix, Map<DuckSource, Dip>>();
const laid = new WeakMap<AudioParam, Knot[]>();

/** Lays the knots of `dips` on the duck `param` from `now`, from where its last ones had it. */
function lay(
  param: AudioParam,
  dips: ReadonlyMap<DuckSource, Dip>,
  depths: Depths,
  now: number,
): void {
  const from = levelOn(laid.get(param) ?? [], now);
  const knots = duckKnots(dips, depths, now, from);
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  for (const knot of knots.slice(1)) param.linearRampToValueAtTime(knot.level, knot.at);
  laid.set(param, knots);
}

/** `source` pulls the buses of `mix` as `dip` says; the ducks are laid anew from `now`. */
function pull(mix: Mix, source: DuckSource, dip: Dip, now: number): void {
  const dips = pulls.get(mix) ?? new Map<DuckSource, Dip>();
  dips.set(source, dip);
  for (const [each, { until }] of dips) {
    if (until + DUCK_RELEASE_S < now) dips.delete(each);
  }
  pulls.set(mix, dips);
  lay(mix.musicDuck.gain, dips, DUCK_DB.music, now);
  lay(mix.ambienceDuck.gain, dips, DUCK_DB.ambience, now);
}

/**
 * `source` pulls the buses of `mix` down from `from` until `until` (audio time; Infinity until
 * `unduck` lets go) — joined to what it pulls already where the two meet or overlap, so that one
 * line straight after another keeps the music down between them.
 */
export function duck(mix: Mix, source: DuckSource, from: number, until: number, now: number): void {
  const was = pulls.get(mix)?.get(source);
  const meets = was !== undefined && was.until >= from && was.from <= until;
  const dip = meets
    ? { from: Math.min(was.from, from), until: Math.max(was.until, until) }
    : { from, until };
  pull(mix, source, dip, now);
}

/** `source` lets the buses of `mix` go at `at`, where it pulls past it. */
export function unduck(mix: Mix, source: DuckSource, at: number, now: number): void {
  const dip = pulls.get(mix)?.get(source);
  if (dip === undefined || dip.until <= at) return;
  pull(mix, source, { from: Math.min(dip.from, at), until: at }, now);
}

/** How far the music and the beds are pulled down now, linear: 1 where nothing pulls. */
export function duckLevels(mix: Mix, now: number): { music: number; ambience: number } {
  return {
    music: levelOn(laid.get(mix.musicDuck.gain) ?? [], now),
    ambience: levelOn(laid.get(mix.ambienceDuck.gain) ?? [], now),
  };
}
