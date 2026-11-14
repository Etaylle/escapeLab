import {
  alarmSting,
  audioEngine,
  biquad,
  claim,
  EFFECTS_LEVEL,
  fadeTo,
  levelAt,
  LOOKAHEAD,
  outlet,
  playingEngine,
  release,
  still,
  type Engine,
  type Fade,
} from './audio.js';
import {
  closeStream,
  openStream,
  rewindStream,
  startStream,
  steer,
  type Stream,
} from './audioStream.js';
import { chosenFor, entryOf, type Chosen, type MusicPiece } from './musicPacks.js';
import { holdMusic, musicFrom } from './musicTurn.js';
import { crossfadePeriod } from './packFile.js';
import {
  MUSIC_BASE,
  musicEntry,
  musicListed,
  RETRY_MS,
  type MusicId,
  type SampleEntry,
} from './samples.js';

/**
 * Music that breathes: three recorded stems, between which one pressure value, 0 to 1,
 * crossfades — by default pieces of the score (samples.ts, docs/sound.md „Score": Eleven Music
 * composed them in one generation, in A minor at one tempo on one bar grid, so that one crosses
 * into the next), or the pieces the music pack the player picked has for them (musicPacks.ts):
 *
 *   calm      the motif in fragments, low piano, a dark pad, a muted synth bass, no percussion;
 *   tense     from 0.35: an analog ostinato from the motif, a bass pulse on every beat, a tick;
 *   critical  from 0.8: low drums, strings in sixteenths, horns hammering the motif's leap.
 *
 * The pressure follows the clock (the tension curve the lab always had: nothing in the first
 * half, then rising to 1 as it runs out — and at least 0.8 in the last minute), every alarm
 * (+0.15 for 20 s, each answered by the alarm's sting on the effects' bus) and the escape (at
 * least 0.8). No music while the lab has its power: it starts under the blackout 2 s after the
 * click, and its first bar is where its bars are counted from. A change of stem waits for the
 * next bar: the stem coming in starts from its beginning on it and crosses with the one going
 * over CROSSFADE_S — at once where the stems go round by crossfades, whose bars nobody counts. A
 * stem plays round and round (`roundOf`): a piece of the score on bars, its next pass starting
 * from its beginning on a bar line — as many bars after the last as its manifest names
 * (`loopPeriod`) — one bar before it comes in over the last SEAM_S of the pass before; a piece of
 * a pack by its crossfade, its next pass silent from its start until the crossfade's start and
 * coming in over its fade. Either way the two passes cross equal in power, and the time a pass
 * plays silent is the time it has to be caught up in. A stem chosen anew — the player picked
 * another pack — takes over at the next loop point of the one playing, crossing with it over
 * CROSSFADE_S; a silent one at once. The stems are never decoded: each streams from its file
 * (audioStream.ts) on two <audio> elements taking turns, every stem's file fetched once as the
 * music starts; an element that came in late is caught up by playing it a little faster. While a
 * stem is heard it takes one loop of the budget of audio.ts (`CAPS`), and it stops once it has
 * faded out. A run won fades the music out before the end card's sting (`playSting`); a run lost
 * drains it, its lowpass closing and the stems slowing, with the power. Like every piece of music
 * it waits for the bus — the menu's theme fading out (musicTurn.ts) — and holds it while it
 * fades. `setTension` is its one input, ten times a second. Pure up to `setTension`.
 */

/** A stem's loudness and a sting's, after the gain of each (scripts/sfx.ts), RMS. */
const STEM_RMS = 10 ** (-20 / 20);
const STING_RMS = 10 ** (-14 / 20);
/**
 * The music at full: a stem's RMS 26 dB under the effects' level (audio.ts EFFECTS_LEVEL) at
 * the master gain — about where the synthesised pad before it sat.
 */
export const MUSIC_LEVEL = (EFFECTS_LEVEL * 10 ** (-26 / 20)) / STEM_RMS;
/** The end card's sting: its RMS 8 dB under the effects' level, the music gone by then. */
export const STING_LEVEL = (EFFECTS_LEVEL * 10 ** (-8 / 20)) / STING_RMS;
/** The music starts this long after the click of the blackout, ms (coldOpen.ts REVEAL_MS). */
export const MUSIC_AFTER_CLICK_MS = 2000;
/** The last minute, s. */
export const LAST_MINUTE_S = 60;
/** What an alarm adds to the pressure, and for how long, ms. */
export const ALARM_PUSH = 0.15;
export const ALARM_HOLD_MS = 20_000;
/** The pressure in the escape, at least; in the last minute, at least as much. */
export const ESCAPE_FLOOR = 0.8;
/** A bar of the stems, in beats. */
export const BEATS_PER_BAR = 4;
/** The score's tempo, beats a minute: a piece on bars whose entry names none goes round at it. */
export const SCORE_BPM = 90;
/** A stem crosses into the next over this long, from the bar the new one starts on, s. */
export const CROSSFADE_S = 2;
/** The next pass of a stem comes in over this long at the end of the one before, s. */
export const SEAM_S = 3;
/** A stem's next pass starts this many bars before it comes in: caught up meanwhile, unheard. */
export const SEAM_LEAD_BARS = 1;
/** A pass is caught up, its lag what the probe reports, once it has played this long, s. */
export const SETTLED_S = 1;
/** How far ahead a pass's element is told when to start, s. */
const READY_S = 1;
/** How far ahead a change of stem is laid on its bar, at the least, s: its timer must make it. */
const PREPARE_S = 0.3;
/** The tense stem comes in at PRESSURE_ON and goes below PRESSURE_OFF; the critical as well. */
const PRESSURE_ON = 0.35;
const PRESSURE_OFF = 0.3;
const LAST_ON = 0.8;
const LAST_OFF = 0.75;
/** A run's end: the music fades or drains over this long, s; a lost run's in this many steps. */
const END_S = 1.5;
const DRAIN_STEPS = 6;
/** The drain's lowpass, open until a run is lost. */
const OPEN_HZ = 20000;

/** The three stems, quietest first. */
export const STEMS = ['calm', 'tense', 'critical'] as const;
export type Stem = (typeof STEMS)[number];

/** Whether each layer is in: the calm, the pressure, the last minute's. */
export interface Layers {
  readonly calm: boolean;
  readonly pressure: boolean;
  readonly last: boolean;
}

/**
 * The bars: where the first started on the audio clock, and the stems' tempo — null where the
 * stem playing goes round by a crossfade, whose bars nobody counts: a change then falls where it
 * is asked for, no sooner than the origin.
 */
export interface Grid {
  readonly origin: number;
  readonly bpm: number | null;
}

/**
 * The clock's tension, the lab's curve since its first ambience: 0 while half the time or more
 * is left, then rising to 1 as `left` (s) runs out of the mission's `budget` (s).
 */
export function clockTension(left: number, budget: number): number {
  return Math.min(1, Math.max(0, 1 - left / (Math.max(1, budget) * 0.5)));
}

/**
 * The pressure, 0 to 1: the clock's tension — at least ESCAPE_FLOOR and rising to 1 in the last
 * minute — at least ESCAPE_FLOOR in the escape, and ALARM_PUSH more for each of the `alarms`
 * that came in the last ALARM_HOLD_MS.
 */
export function pressureOf(input: {
  left: number;
  budget: number;
  alarms: number;
  escaping: boolean;
}): number {
  const { left, budget, alarms, escaping } = input;
  const run = 1 - Math.max(0, left) / LAST_MINUTE_S;
  const lastMinute = left < LAST_MINUTE_S ? ESCAPE_FLOOR + (1 - ESCAPE_FLOOR) * run : 0;
  const floor = Math.max(clockTension(left, budget), lastMinute, escaping ? ESCAPE_FLOOR : 0);
  return Math.min(1, floor + ALARM_PUSH * alarms);
}

/**
 * Which layers are in at `pressure`, from those that were (`was`): each comes in at its
 * threshold and only goes a little under it, so that the pressure wavering never flips it; the
 * siren (`siren`) takes the calm away.
 */
export function layersFor(pressure: number, siren: boolean, was: Layers): Layers {
  return {
    calm: !siren,
    pressure: pressure >= (was.pressure ? PRESSURE_OFF : PRESSURE_ON),
    last: pressure >= (was.last ? LAST_OFF : LAST_ON),
  };
}

/** The stem that plays with `layers` in: the last minute's critical, the pressure's tense, calm. */
export function stemFor(layers: Layers): Stem {
  if (layers.last) return 'critical';
  return layers.pressure ? 'tense' : 'calm';
}

/** A bar at `bpm`, s. */
export function barOf(bpm: number): number {
  return (60 / bpm) * BEATS_PER_BAR;
}

/** The first bar line of `grid` at or after the audio time `t`; without bars, `t` or its origin. */
export function nextBar(t: number, grid: Grid): number {
  if (grid.bpm === null) return Math.max(t, grid.origin);
  const bar = barOf(grid.bpm);
  return grid.origin + Math.max(0, Math.ceil((t - grid.origin) / bar - 1e-9)) * bar;
}

/**
 * How long after a pass starts the next one does, s: whole bars, as many as leave a pass of
 * `seconds` room for the next one's lead bar and the seam over its end.
 */
export function passPeriod(seconds: number, bpm: number): number {
  const bar = barOf(bpm);
  return Math.max(1, Math.floor((seconds - SEAM_S) / bar) - SEAM_LEAD_BARS) * bar;
}

/**
 * How long after a pass of `entry` starts the next one does, s: the bars its manifest names as
 * going round — a piece of the score's, cut with a tail for its lead bar and its seam — as far as
 * its file holds them with those; else as many whole bars as its file holds (`passPeriod`).
 */
export function loopPeriod(
  entry: Pick<SampleEntry, 'ms' | 'startMs' | 'bars'>,
  bpm: number,
): number {
  const holds = passPeriod((entry.ms - entry.startMs) / 1000, bpm);
  return entry.bars === undefined ? holds : Math.min(entry.bars * barOf(bpm), holds);
}

/**
 * How a piece goes round, s: how long after a pass starts the next one does, how long the next
 * plays silent before it comes in — the time it is caught up in — and how long the two cross.
 */
export interface Round {
  readonly period: number;
  readonly lead: number;
  readonly seam: number;
}

/**
 * How `entry` goes round: by its crossfade (packFile.ts) — the next pass from its start, silent
 * until the crossfade's start, coming in over its fade — or on bars at its own tempo, else at
 * `bpm`: the next pass SEAM_LEAD_BARS ahead of a seam of SEAM_S, `loopPeriod` after the last.
 */
export function roundOf(
  entry: Pick<MusicPiece, 'ms' | 'startMs' | 'bars' | 'bpm' | 'crossfade'>,
  bpm: number,
): Round {
  if (entry.crossfade !== undefined) {
    const { startMs, fadeMs } = entry.crossfade;
    return { period: crossfadePeriod(entry.crossfade), lead: startMs / 1000, seam: fadeMs / 1000 };
  }
  const tempo = entry.bpm ?? bpm;
  return { period: loopPeriod(entry, tempo), lead: SEAM_LEAD_BARS * barOf(tempo), seam: SEAM_S };
}

/** The tempo `entry` goes round on bars at: its own, else the score's; null by a crossfade. */
export function barsOf(entry: Pick<MusicPiece, 'bpm' | 'crossfade'>): number | null {
  return entry.crossfade === undefined ? (entry.bpm ?? SCORE_BPM) : null;
}

/** The music's input, ten times a second (GameWorld.tsx). */
export interface Tension {
  /** the run, by its start: a new run starts the music over */
  readonly run: number | null;
  /** from when the music may play, epoch ms: 2 s after the click; null while the power is on */
  readonly startAt: number | null;
  /** seconds left on the clock; Infinity without one */
  readonly left: number;
  /** the seconds the mission gives */
  readonly budget: number;
  /** the run's alarms so far */
  readonly alarms: number;
  /** the hatch stands open: the siren sounds */
  readonly escaping: boolean;
  /** how the run ended, once it has */
  readonly ending: 'won' | 'lost' | null;
}

// --- a piece going round, as the stems and the menu's music play one -------------------------

/** One pass of a piece: the element playing it, and when its sound starts on the audio clock. */
export interface Pass {
  readonly stream: Stream;
  readonly zero: number;
}

/**
 * What a piece going round keeps: its two elements taking turns, its passes — the one playing
 * and the one it crosses from — and where its next pass starts; `next` is null while silent.
 */
export interface Turns {
  decks: Stream[];
  passes: Pass[];
  next: number | null;
}

/**
 * The next pass of `turns`, playing `entry`, on the element not playing: started from its file's
 * start so that its sound starts at `next`; where a pass plays already, the new one comes in its
 * round's lead later over the round's seam as the old one goes out under it, equal in power, and
 * the old one is stopped after (`roundOf`, a piece on bars at `bpm` where it names no tempo).
 */
export function layPass(ctx: AudioContext, turns: Turns, entry: MusicPiece, bpm: number): void {
  const zero = turns.next ?? ctx.currentTime;
  const previous = turns.passes.at(-1);
  const deck = turns.decks.find((each) => each !== previous?.stream) ?? turns.decks[0];
  if (deck === undefined) return;
  startStream(deck, ctx, zero - entry.startMs / 1000);
  const round = roundOf(entry, bpm);
  if (previous === undefined) {
    deck.out.gain.setValueAtTime(1, ctx.currentTime);
  } else {
    const cross = zero + round.lead;
    deck.out.gain.setValueAtTime(0, ctx.currentTime);
    deck.out.gain.setValueCurveAtTime(SEAM_IN, cross, round.seam);
    previous.stream.out.gain.setValueCurveAtTime(SEAM_OUT, cross, round.seam);
    rewindStream(previous.stream, ctx, cross + round.seam + 0.05);
  }
  const pass = { stream: deck, zero };
  turns.passes = previous === undefined ? [pass] : [previous, pass];
  turns.next = zero + round.period;
}

// --- the runtime -------------------------------------------------------------------------

/**
 * A stem: the piece it plays (musicPacks.ts), its file (fetched once, played from memory), how
 * loud the pressure has it, its two elements and its passes (`Turns`) — `next` null while it is
 * silent and holds no loop of the budget — the bar a change brings its first pass in on, and
 * whether it has been let go.
 */
interface Track extends Turns {
  readonly stem: Stem;
  readonly chosen: Chosen;
  readonly bus: GainNode;
  readonly level: GainNode;
  fade: Fade;
  file: string | null;
  /** when its file was last asked for, epoch ms */
  tried: number;
  /** the bar its first pass starts on, once a change brings it in */
  first: number | null;
  gone: boolean;
}

interface Music {
  readonly run: number | null;
  readonly engine: Engine;
  /** the music's level, MUSIC_LEVEL, and how it ends */
  readonly out: GainNode;
  outFade: Fade;
  /** the drain's lowpass */
  readonly drain: BiquadFilterNode;
  /** each stem's track, as it plays */
  readonly tracks: Record<Stem, Track>;
  /** a stem's piece chosen anew, its file fetched while the one before plays to its loop point */
  readonly coming: Partial<Record<Stem, Track>>;
  /** the tracks a piece chosen anew took over from, playing out under it */
  leaving: Track[];
  /** where the music starts, audio time; its bars, once the stems' pieces are known */
  readonly at: number;
  grid: Grid | null;
  layers: Layers;
  siren: boolean;
  pressure: number;
  /** the run's alarms counted so far, and when the recent ones came in, epoch ms */
  alarms: number;
  readonly alarmsAt: number[];
  ended: boolean;
  /** how late the passes came in, s, the worst; how far one caught up by now lags, the worst */
  late: number;
  lag: number;
}

const NO_LAYERS: Layers = { calm: false, pressure: false, last: false };
/** The seam's curves: in, a quarter sine, and out, its mirror — equal in power throughout. */
const SEAM_POINTS = 32;
export const SEAM_IN = Float32Array.from({ length: SEAM_POINTS }, (_, i) =>
  Math.sin((Math.PI / 2) * (i / (SEAM_POINTS - 1))),
);
export const SEAM_OUT = Float32Array.from(SEAM_IN).reverse();

let music: Music | null = null;

/**
 * The music follows the run: starts once `startAt` has come, moves its stems with the pressure
 * and with the pieces chosen, starts and steers what is due, ends with the run. Called ten times
 * a second; only a real change moves a stem.
 */
export function setTension(input: Tension): void {
  try {
    if (music !== null && music.run !== input.run) stopMusic();
    if (music === null) {
      if (input.startAt === null || input.ending !== null) return;
      music = startMusic(input, input.startAt);
      if (music === null) return;
    }
    if (music.ended) return;
    if (input.ending !== null) {
      endMusic(music, input.ending);
      return;
    }
    follow(music, input);
    if (music.engine.ctx.state === 'running') tendAll(music);
  } catch {
    // Deliberately silent: the music is flavour, never required.
  }
}

/** A stem's track on `ctx` into `drain`, playing the piece `chosen`: silent, its file not had. */
function trackOn(ctx: AudioContext, drain: AudioNode, stem: Stem, chosen: Chosen): Track {
  const level = outlet(ctx, drain, 1);
  const bus = outlet(ctx, level, 0);
  const none = { file: null, tried: -Infinity, decks: [], passes: [], next: null, first: null };
  return { stem, chosen, bus, level, fade: still(0), gone: false, ...none };
}

/**
 * The music for the input's run, starting at the epoch time `startAt` (or now, where that has
 * passed); every stem's file fetched as it starts. The run's alarms so far came before it.
 */
function startMusic(input: Tension, startAt: number): Music | null {
  const engine = audioEngine();
  if (engine === null) return null;
  const { ctx } = engine;
  const at = musicFrom(ctx.currentTime + LOOKAHEAD + Math.max(0, (startAt - Date.now()) / 1000));
  const out = outlet(ctx, engine.music, MUSIC_LEVEL);
  const drain = biquad(ctx, 'lowpass', OPEN_HZ, 0);
  drain.connect(out);
  const track = (stem: Stem): Track => trackOn(ctx, drain, stem, chosenFor(stem));
  const m: Music = {
    run: input.run,
    engine,
    out,
    outFade: still(MUSIC_LEVEL),
    drain,
    tracks: { calm: track('calm'), tense: track('tense'), critical: track('critical') },
    coming: {},
    leaving: [],
    at,
    grid: null,
    layers: NO_LAYERS,
    siren: false,
    pressure: 0,
    alarms: input.alarms,
    alarmsAt: [],
    ended: false,
    late: 0,
    lag: 0,
  };
  void fetchStems(m);
  return m;
}

/** How the piece `track` plays: null while the music's manifest is not here (musicPacks.ts). */
const entryOfTrack = (track: Track): MusicPiece | null =>
  entryOf(track.chosen.pack, track.chosen.piece);

/**
 * Every stem's file fetched into memory, once: its elements play it from there. Each counts as
 * asked for from the start, so that a stem heard before the music's manifest is here — a pack's
 * piece needs none — is not asked for twice.
 */
async function fetchStems(m: Music): Promise<void> {
  for (const stem of STEMS) m.tracks[stem].tried = Date.now();
  await musicListed();
  for (const stem of STEMS) await fetchStem(m, m.tracks[stem]);
}

/**
 * A track's file fetched into memory and named by a blob address; tried again RETRY_MS on. A
 * track let go meanwhile lets its file go as it comes.
 */
async function fetchStem(m: Music, track: Track): Promise<void> {
  track.tried = Date.now();
  const entry = entryOfTrack(track);
  if (entry === null || track.file !== null) return;
  const res = await fetch(`${MUSIC_BASE}${entry.file}`).catch(() => null);
  const blob = res?.ok === true ? await res.blob().catch(() => null) : null;
  if (blob === null || m.ended || track.file !== null) return;
  track.file = URL.createObjectURL(blob);
  track.level.gain.value = entry.gain;
  if (track.gone) letTrackGo(track);
}

/** A track whose file — or the music's manifest — could not be had asks for it again. */
async function retryStem(m: Music, track: Track): Promise<void> {
  track.tried = Date.now();
  await musicListed();
  await fetchStem(m, track);
}

/**
 * The music takes in this call's input: the alarms — each answered by the alarm's sting
 * (audio.ts) — the clock, the escape, its layers, and the pieces chosen.
 */
function follow(m: Music, input: Tension): void {
  const now = Date.now();
  if (input.alarms > m.alarms) alarmSting();
  for (; m.alarms < input.alarms; m.alarms++) m.alarmsAt.push(now);
  while ((m.alarmsAt[0] ?? now) <= now - ALARM_HOLD_MS) m.alarmsAt.shift();
  m.pressure = pressureOf({ ...input, alarms: m.alarmsAt.length });
  const layers = layersFor(m.pressure, input.escaping, m.layers);
  const was = m.layers;
  const changed =
    layers.calm !== was.calm || layers.pressure !== was.pressure || layers.last !== was.last;
  if (changed || input.escaping !== m.siren) {
    retarget(m, layers, input.escaping);
  }
  STEMS.forEach((stem) => followChoice(m, stem));
}

/** Whether `track` is heard now, or comes in: its fade goes up, or has not died yet. */
const heard = (track: Track, now: number): boolean =>
  track.fade.to > 0 || levelAt(track.fade, now) > 0.001;

/**
 * The piece chosen for `stem` (musicPacks.ts) as the music has it: the same as its track plays,
 * nothing to do; another, a track for it made and its file fetched (`coming`) — taking over at
 * once where the stem plays nothing yet, else at its next loop point (`tendTrack`).
 */
function followChoice(m: Music, stem: Stem): void {
  const want = chosenFor(stem);
  if (want.key === m.tracks[stem].chosen.key) {
    dropComing(m, stem);
    return;
  }
  bringComing(m, stem, want);
  const playing = m.tracks[stem];
  if (playing.passes.length === 0 || playing.fade.to === 0) takeOver(m, stem, null);
}

/**
 * The track of `want`, the piece chosen anew for `stem`: made and its file fetched where none comes
 * for it yet — one coming for another piece let go — and its file asked for again RETRY_MS on.
 */
function bringComing(m: Music, stem: Stem, want: Chosen): void {
  const coming = m.coming[stem];
  if (coming?.chosen.key === want.key) {
    if (coming.file === null && Date.now() - coming.tried >= RETRY_MS) void retryStem(m, coming);
    return;
  }
  dropComing(m, stem);
  const fresh = trackOn(m.engine.ctx, m.drain, stem, want);
  m.coming[stem] = fresh;
  void retryStem(m, fresh);
}

/** The piece chosen before for `stem`, never heard, let go: another was chosen since. */
function dropComing(m: Music, stem: Stem): void {
  const coming = m.coming[stem];
  delete m.coming[stem];
  if (coming !== undefined) letTrackGo(coming);
}

/**
 * The track chosen anew for `stem` takes over, the one before playing out under it: at `at` —
 * the loop point of the one playing — crossing with it over CROSSFADE_S, its first pass on it and
 * the music's bars counted from it; at null, in the place the one before stood — silent, or
 * coming in on its change's bar before any pass of it was laid — the one before playing out any
 * fade it is in.
 */
function takeOver(m: Music, stem: Stem, at: number | null): void {
  const coming = m.coming[stem];
  if (coming === undefined) return;
  const before = m.tracks[stem];
  const now = m.engine.ctx.currentTime;
  delete m.coming[stem];
  m.tracks[stem] = coming;
  m.leaving.push(before);
  if (at === null) {
    const { start, end, to } = before.fade;
    coming.first = before.first;
    coming.fade = fadeTo(coming.bus.gain, still(0), now, [start, end], to);
    if (to > 0) before.fade = fadeTo(before.bus.gain, before.fade, now, [now, now + 0.05], 0);
    return;
  }
  const entry = entryOfTrack(coming);
  coming.first = at;
  coming.fade = fadeTo(coming.bus.gain, still(0), now, [at, at + CROSSFADE_S], 1);
  before.fade = fadeTo(before.bus.gain, before.fade, now, [at, at + CROSSFADE_S], 0);
  m.grid = { origin: at, bpm: entry === null ? null : barsOf(entry) };
}

/**
 * The bars of the stems, counted from the music's start — or from as soon as a stem's timer can
 * make it, where that start has passed — at the tempo of `stem`'s piece where it goes round on
 * bars; none where it goes by a crossfade. Null while its piece is not known.
 */
function gridOf(m: Music, now: number, stem: Stem): Grid | null {
  if (m.grid !== null) return m.grid;
  const entry = entryOfTrack(m.tracks[stem]);
  if (entry === null) return null;
  m.grid = { origin: Math.max(m.at, now + PREPARE_S), bpm: barsOf(entry) };
  return m.grid;
}

/**
 * The stems move to what `layers` plays: the stem coming in from its start on the next bar — the
 * first at the music's start — crossing with the one going over CROSSFADE_S.
 */
function retarget(m: Music, layers: Layers, siren: boolean): void {
  const now = m.engine.ctx.currentTime;
  const playing = stemFor(layers);
  const grid = gridOf(m, now, playing);
  if (grid === null) return;
  const start = nextBar(now + PREPARE_S, grid);
  for (const stem of STEMS) {
    const track = m.tracks[stem];
    const to = stem === playing ? 1 : 0;
    if (track.fade.to === to) continue;
    track.fade = fadeTo(track.bus.gain, track.fade, now, [start, start + CROSSFADE_S], to);
    if (to === 1 && track.next === null) track.first = start;
  }
  m.layers = layers;
  m.siren = siren;
}

/** The stem's elements, opened as it is first heard: two, taking turns. */
function decksOf(m: Music, track: Track, file: string): Stream[] {
  if (track.decks.length === 0) {
    const { ctx } = m.engine;
    track.decks = [0, 1].map(() => openStream(ctx, file, track.bus, 0));
  }
  return track.decks;
}

/** Every track tended: the stems', then those playing out — let go once they have. */
function tendAll(m: Music): void {
  m.lag = 0;
  for (const stem of STEMS) tendTrack(m, m.tracks[stem]);
  for (const track of m.leaving) tendTrack(m, track);
  m.leaving = m.leaving.filter((track) => !track.gone);
}

/**
 * A stem as its fade has it: while it is heard its elements stand ready and its passes go on —
 * the first on the bar its change brought it in on, once its file is here and the budget has a
 * loop for it — each next one told READY_S ahead when to start, unless a piece chosen anew takes
 * over there, all of them steered; once it has faded out it stops, lets its elements go and gives
 * its loop back. A track playing out lays no pass and is let go once silent.
 */
function tendTrack(m: Music, track: Track): void {
  const now = m.engine.ctx.currentTime;
  const playing = m.tracks[track.stem] === track;
  if (!heard(track, now)) {
    silence(m, track, now + 0.05);
    if (!playing) letTrackGo(track);
    return;
  }
  const entry = entryOfTrack(track);
  const grid = gridOf(m, now, track.stem);
  if (track.file === null && Date.now() - track.tried >= RETRY_MS) void retryStem(m, track);
  if (track.file === null || entry === null || grid === null) return;
  decksOf(m, track, track.file);
  if (playing) passOn(m, track, entry, grid, now);
  for (const pass of track.passes) {
    const lag = steer(pass.stream, m.engine.ctx);
    if (now - pass.zero >= SETTLED_S) m.lag = Math.max(m.lag, Math.abs(lag));
    m.late = Math.max(m.late, pass.stream.lateBy ?? 0);
  }
}

/**
 * The playing `track`'s passes go on: its first laid where it has none, its next started
 * READY_S ahead — or, where a piece chosen anew has its file, that one takes over on the loop
 * point the next pass would have come in on.
 */
function passOn(m: Music, track: Track, entry: MusicPiece, grid: Grid, now: number): void {
  if (track.next === null) {
    if (!claim({ loop: 1 })) return;
    track.next = Math.max(track.first ?? 0, nextBar(now + PREPARE_S, grid));
  }
  if (track.next - now >= READY_S) return;
  const bpm = grid.bpm ?? SCORE_BPM;
  if (takesOverNext(m, track)) {
    takeOver(m, track.stem, track.next + roundOf(entry, bpm).lead);
    return;
  }
  layPass(m.engine.ctx, track, entry, bpm);
}

/** Whether a piece chosen anew for `track`'s stem has its file, to take over at the next pass. */
function takesOverNext(m: Music, track: Track): boolean {
  const coming = m.coming[track.stem];
  return coming !== undefined && coming.file !== null && track.passes.length > 0;
}

/** The stem stops at `at` and gives its loop back: faded out, or the music is over. */
function silence(m: Music, track: Track, at: number): void {
  if (track.next === null) return;
  const decks = track.decks;
  for (const deck of decks) rewindStream(deck, m.engine.ctx, at);
  const wait = Math.max(0, (at - m.engine.ctx.currentTime) * 1000);
  setTimeout(() => decks.forEach(closeStream), wait + 50);
  track.decks = [];
  track.passes = [];
  track.next = null;
  track.first = null;
  release({ loop: 1 });
}

/** A track no longer played let go: its nodes unwired and its file's blob given back, once. */
function letTrackGo(track: Track): void {
  track.gone = true;
  track.decks.forEach(closeStream);
  track.level.disconnect();
  if (track.file !== null) URL.revokeObjectURL(track.file);
  track.file = null;
}

/** Every track of the music: the stems', those chosen anew and those playing out. */
const tracksOf = (m: Music): Track[] => [
  ...STEMS.map((stem) => m.tracks[stem]),
  ...STEMS.flatMap((stem) => m.coming[stem] ?? []),
  ...m.leaving,
];

/**
 * The run is over: won, the music fades out before the end card's sting; lost, it drains — its
 * lowpass closing and every stem slowing — as the power does. Then it stops.
 */
function endMusic(m: Music, ending: 'won' | 'lost'): void {
  m.ended = true;
  const now = m.engine.ctx.currentTime;
  const end = now + END_S;
  m.outFade = fadeTo(m.out.gain, m.outFade, now, [now, end], 0);
  holdMusic(end);
  if (ending === 'lost') {
    m.drain.frequency.setValueAtTime(OPEN_HZ, now);
    m.drain.frequency.exponentialRampToValueAtTime(120, end);
    const elements = tracksOf(m).flatMap((track) => track.passes.map((p) => p.stream.element));
    for (let step = 1; step <= DRAIN_STEPS; step++) {
      setTimeout(() => {
        for (const element of elements) element.playbackRate = 1 - (0.5 * step) / DRAIN_STEPS;
      }, (step * END_S * 1000) / DRAIN_STEPS);
    }
  }
  letGo(m, end + 0.05);
}

/** Stops every stem at `at` and lets the music's nodes and files go then. */
function letGo(m: Music, at: number): void {
  const tracks = tracksOf(m);
  for (const track of tracks) silence(m, track, at);
  const wait = Math.max(0, (at - m.engine.ctx.currentTime) * 1000);
  setTimeout(() => {
    m.out.disconnect();
    for (const track of tracks) {
      if (track.file !== null) URL.revokeObjectURL(track.file);
    }
  }, wait + 100);
}

/** Stops the music at once (a fade of 0.3 s): the world is gone, or another run begins. */
export function stopMusic(): void {
  try {
    const m = music;
    music = null;
    if (m === null) return;
    m.ended = true;
    const now = m.engine.ctx.currentTime;
    m.outFade = fadeTo(m.out.gain, m.outFade, now, [now, now + 0.3], 0);
    holdMusic(now + 0.3);
    letGo(m, now + 0.35);
  } catch {
    // Deliberately silent: the music's nodes are released with the context at the latest.
  }
}

/**
 * The end card's sting for a run won or lost, once, streamed on the music's bus at STING_LEVEL
 * as soon as the bus is free, and let go once it has played. Resolves to the audio time it will
 * have ended at — when the end card's theme may follow (endTheme.ts); to the time it would have
 * started where its manifest names none; to null while the context is held back.
 */
export function playSting(ending: 'won' | 'lost'): Promise<number | null> {
  try {
    const engine = playingEngine();
    if (engine === null) return Promise.resolve(null);
    return musicListed()
      .then(() => stingOnce(engine, ending))
      .catch(() => null);
  } catch {
    // Deliberately silent: the card says it as well.
    return Promise.resolve(null);
  }
}

/** The sting `id` streamed once from when the bus is free, its element let go as it ends. */
function stingOnce(engine: Engine, id: MusicId): number {
  const { ctx } = engine;
  const at = musicFrom(ctx.currentTime + LOOKAHEAD);
  const entry = musicEntry(id);
  if (entry === null) return at;
  const file = `${MUSIC_BASE}${entry.file}`;
  const sting = openStream(ctx, file, engine.music, STING_LEVEL * entry.gain);
  sting.element.addEventListener('ended', () => closeStream(sting), { once: true });
  startStream(sting, ctx, at);
  return at + entry.ms / 1000;
}

/**
 * The music now, 0 to 1: the calm stem's level, the pressure stems' — the tense or the critical
 * — the critical's alone, and the pressure value the stems follow; how many elements play, how
 * late the latest came in, and how far one that has played SETTLED_S and more lags now, ms; and
 * the piece each stem plays, by its pack and place (musicPacks.ts).
 */
export interface MusicProbe {
  calm: number;
  pressure: number;
  last: number;
  level: number;
  streams: number;
  lateMs: number;
  lagMs: number;
  pieces: Partial<Record<Stem, string>>;
}

export function musicProbe(): MusicProbe {
  const m = music;
  const none = { calm: 0, pressure: 0, last: 0, level: 0, streams: 0, lateMs: 0, lagMs: 0 };
  if (m === null) return { ...none, pieces: {} };
  const now = m.engine.ctx.currentTime;
  const at = (stem: Stem): number => levelAt(m.tracks[stem].fade, now);
  const streams = tracksOf(m)
    .flatMap((track) => track.passes)
    .filter((pass) => pass.stream.state === 'playing').length;
  return {
    calm: at('calm'),
    pressure: Math.min(1, at('tense') + at('critical')),
    last: at('critical'),
    level: m.pressure,
    streams,
    lateMs: Math.round(m.late * 1000 * 10) / 10,
    lagMs: Math.round(m.lag * 1000 * 10) / 10,
    pieces: Object.fromEntries(STEMS.map((stem) => [stem, m.tracks[stem].chosen.key])),
  };
}
