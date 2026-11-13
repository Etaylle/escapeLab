import {
  audioEngine,
  claim,
  fadeTo,
  gain,
  isMuted,
  liveEngine,
  LOOKAHEAD,
  outlet,
  playLoop,
  release,
  startSample,
  still,
  subscribeMuted,
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
import { duck, unduck } from './mix.js';
import { holdMusic, musicFrom } from './musicTurn.js';
import {
  barOf,
  MUSIC_LEVEL,
  passPeriod,
  SEAM_IN,
  SEAM_LEAD_BARS,
  SEAM_OUT,
  SEAM_S,
} from './music.js';
import {
  loadSample,
  MUSIC_BASE,
  musicEntry,
  musicListed,
  releaseSample,
  type Sample,
  type SampleEntry,
  type SfxId,
} from './samples.js';

/**
 * menuSound.ts: what the menu sounds like (screens/Join.tsx), and the lobby after it — the title
 * theme, a stem of the music's (audio/catalog.json `menu-theme`), streamed and looped on whole
 * bars as the run's stems are (music.ts), on the music's bus at the stems' level; the facility's
 * hum under it, a bed of its own (`bed-facility`) on the rooms' bus; and the interface's sounds,
 * recordings the lab has already: a tick as an item lights, a clack as one is taken, a detent as
 * a panel is stepped out of, the stage's chime as a round opens, a console's chirp as somebody
 * of the crew says ready. The lobby keeps the theme and the hum, the theme LOBBY_WEIGHT down
 * over WEIGHT_S: from the menu to the lobby the music only changes its weight. No sound may
 * start before a gesture: the first click, tap or key makes the context and brings the theme and
 * the hum in over FADE_IN_S — at once where a run before has woken the context — and until then
 * the menu says it waits (`menuSoundState`), which the top bar's speaker shows. The theme waits
 * for the music's bus, as every piece of music does, and holds it while it goes (musicTurn.ts):
 * it never plays over the end card's theme, the opening's cue or the run's stems. With the
 * sound switched off nothing streams. The crew's voice in the lobby pulls both down as mission
 * control's pulls the run's music; the run's start ends them. An entry not rendered yet plays
 * nothing. Nothing here throws.
 */

/** The title theme, by its id in the catalog and the music's manifest. */
export const THEME = 'menu-theme';
/** The facility's hum under the menu, by its id. */
export const HUM: SfxId = 'bed-facility';

/** The interface's sounds: the lab's own recordings. */
export const UI = {
  hover: 'ui-tick',
  select: 'toggle-clack',
  back: 'dial-detent',
  opened: 'stage-chime',
  ready: 'console-ready',
} as const satisfies Readonly<Record<string, SfxId>>;

/** What the interface sounds as. */
export type UiSound = keyof typeof UI;

/** Each of the interface's sounds at its peak, at the master gain: under the theme, a touch. */
const UI_LEVEL: Readonly<Record<UiSound, number>> = {
  hover: 0.012,
  select: 0.03,
  back: 0.024,
  opened: 0.035,
  ready: 0.03,
};
/** A tick sounds no oftener than this, s: an arrow held down ticks along, never buzzes. */
const TICK_GAP_S = 0.05;

/** The theme at the stems' level (a stem at −20 dBFS RMS); the hum a little under a room's bed. */
const THEME_LEVEL = MUSIC_LEVEL;
const HUM_LEVEL = 0.02;
/** How long the theme and the hum take to come in, and to go, s. */
export const FADE_IN_S = 2;
export const FADE_OUT_S = 0.6;
/** The theme's weight in the lobby against the menu's: 6 dB down. */
export const LOBBY_WEIGHT = 0.5;
/** How long the theme takes to change its weight between the menu and the lobby, s. */
export const WEIGHT_S = 1.5;
/** How often the theme's passes are tended, ms; how far ahead a pass is told to start, s. */
const TEND_MS = 100;
const READY_S = 1;
/** The first pass starts this far after the gesture, s: its element has time to begin. */
const PREPARE_S = 0.3;
/** The theme's tempo where its entry names none: the music's own. */
const BPM = 90;
/** The gestures the browser lets sound start at. */
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

/** Where the menu's sound stands: not wanted, waiting for a gesture, playing, or switched off. */
export type MenuSoundState = 'off' | 'waiting' | 'playing' | 'muted';

/** Where the menu's sound is wanted: on the menu, or in the lobby at the lobby's weight. */
export type MenuPlace = 'menu' | 'lobby';

/** The theme as it plays: its level, its file once fetched, its two elements and their passes. */
interface Theme {
  readonly out: GainNode;
  /** the entry's gain, under the fade */
  readonly level: GainNode;
  fade: Fade;
  entry: SampleEntry | null;
  file: string | null;
  decks: Stream[];
  passes: { stream: Stream; zero: number }[];
  next: number | null;
}

/**
 * The menu's sound playing: the engine, the theme, the hum once loaded, the tending timer, and
 * whether the budget gave its two loops (audio.ts `claim`).
 */
interface Playing {
  readonly engine: Engine;
  readonly theme: Theme;
  hum: { source: AudioBufferSourceNode; level: GainNode; out: GainNode } | null;
  readonly timer: ReturnType<typeof setInterval>;
  readonly loops: boolean;
}

/** Where the sound is wanted; null where it is not. */
let place: MenuPlace | null = null;
let state: MenuSoundState = 'off';
let playing: Playing | null = null;
let armed = false;
let ducked = false;
let lastTick = Number.NEGATIVE_INFINITY;
let unmute: (() => void) | null = null;
const listeners = new Set<() => void>();
/** The interface's recordings, once loaded. */
const uiSamples = new Map<SfxId, Sample>();
/** How often each of the interface's sounds has played on this page, for the walkthrough. */
const played: Record<UiSound, number> = { hover: 0, select: 0, back: 0, opened: 0, ready: 0 };

function setState(next: MenuSoundState): void {
  if (next === state) return;
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Where the menu's sound stands now. */
export function menuSoundState(): MenuSoundState {
  return state;
}

/** Tells `listener` of every change of the menu's sound's state; returns what stops it. */
export function subscribeMenuSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The menu's sound is wanted where `where` says — on the menu, or in the lobby at its weight —
 * or nowhere (null: a run, the audience): it waits for a gesture, plays, moves its weight, or
 * fades out and lets everything go.
 */
export function wantMenuSound(where: MenuPlace | null): void {
  try {
    unmute ??= subscribeMuted(muteChanged);
    const was = place;
    place = where;
    if (where === null) {
      end();
      setState('off');
      return;
    }
    if (playing !== null && was !== where) weigh(playing, where);
    begin();
  } catch {
    // Deliberately silent: the menu's sound is flavour.
  }
}

/** The theme's level where the sound is wanted at `where`. */
function levelOf(where: MenuPlace | null): number {
  return where === 'lobby' ? THEME_LEVEL * LOBBY_WEIGHT : THEME_LEVEL;
}

/** The theme moves to the weight of `where` over WEIGHT_S — after its coming in, if still due. */
function weigh(p: Playing, where: MenuPlace): void {
  const { theme } = p;
  const now = p.engine.ctx.currentTime;
  const start = Math.max(now, theme.fade.start);
  const end = Math.max(start + WEIGHT_S, theme.fade.end);
  theme.fade = fadeTo(theme.out.gain, theme.fade, now, [start, end], levelOf(where));
}

/** The sound switch moved: off ends the sound, on brings it back where it is wanted. */
function muteChanged(): void {
  if (isMuted()) {
    end();
    if (place !== null) setState('muted');
  } else if (place !== null) {
    begin();
  }
}

/** Starts the sound where the context runs already — a run woke it; else waits for a gesture. */
function begin(): void {
  if (playing !== null) return;
  if (isMuted()) {
    setState('muted');
    return;
  }
  const live = liveEngine();
  if (live !== null) {
    start(live);
    return;
  }
  setState('waiting');
  armGestures(true);
}

/** Listens for the first gesture (`on`), or no longer. */
function armGestures(on: boolean): void {
  if (on === armed || typeof window === 'undefined') return;
  armed = on;
  for (const type of GESTURES) {
    if (on) window.addEventListener(type, onGesture, { capture: true, passive: true });
    else window.removeEventListener(type, onGesture, { capture: true });
  }
}

/** The first gesture: the context made — within it, so that it may run — and the sound started. */
function onGesture(): void {
  armGestures(false);
  if (place === null || isMuted() || playing !== null) return;
  const engine = audioEngine();
  if (engine === null) return;
  const go = (): void => {
    if (place !== null && !isMuted() && playing === null) start(engine);
  };
  if (engine.ctx.state === 'running') go();
  else void engine.ctx.resume().then(go, () => undefined);
}

/**
 * The theme and the hum coming in on `engine` — the theme once the music's bus is free — and the
 * interface's recordings asked for.
 */
function start(engine: Engine): void {
  armGestures(false);
  const { ctx } = engine;
  const level = gain(ctx, 1);
  const out = outlet(ctx, engine.music, 0);
  level.connect(out);
  const now = ctx.currentTime;
  const from = musicFrom(now);
  const fade = fadeTo(out.gain, still(0), now, [from, from + FADE_IN_S], levelOf(place));
  const none = { entry: null, file: null, decks: [], passes: [], next: null };
  const theme: Theme = { out, level, fade, ...none };
  const timer = setInterval(() => tendTheme(), TEND_MS);
  playing = { engine, theme, hum: null, timer, loops: claim({ loop: 2 }) };
  setState('playing');
  void fetchTheme(playing);
  void startHum(playing);
  for (const id of Object.values(UI)) {
    void loadSample(id).then((recording) => recording !== null && uiSamples.set(id, recording));
  }
}

/** The theme's file fetched into memory and named by a blob address; nothing where none is. */
async function fetchTheme(p: Playing): Promise<void> {
  await musicListed();
  const entry = musicEntry(THEME);
  if (entry === null) return;
  const res = await fetch(`${MUSIC_BASE}${entry.file}`).catch(() => null);
  const blob = res?.ok === true ? await res.blob().catch(() => null) : null;
  if (blob === null || playing !== p) return;
  p.theme.entry = entry;
  p.theme.file = URL.createObjectURL(blob);
  p.theme.level.gain.value = entry.gain;
}

/** The hum looped on the rooms' bus, coming in over FADE_IN_S once its recording is here. */
async function startHum(p: Playing): Promise<void> {
  const recording = await loadSample(HUM);
  if (recording === null || playing !== p) return;
  const { ctx } = p.engine;
  const out = outlet(ctx, p.engine.ambience, HUM_LEVEL);
  const level = gain(ctx, 0);
  level.connect(out);
  const now = ctx.currentTime;
  level.gain.setValueAtTime(0, now);
  level.gain.linearRampToValueAtTime(1, now + FADE_IN_S);
  p.hum = { source: playLoop(ctx, recording.buffer, level, now), level, out };
}

/** The theme's two elements on its file `file`, opened as its passes are first tended. */
function openDecks(theme: Theme, ctx: AudioContext, file: string): void {
  if (theme.decks.length > 0) return;
  theme.decks = [0, 1].map(() => openStream(ctx, file, theme.level, 0));
}

/** The theme's passes: the next one told READY_S ahead to start, every one steered. */
function tendTheme(): void {
  const p = playing;
  if (p === null) return;
  const { theme } = p;
  const { ctx } = p.engine;
  if (theme.file === null || theme.entry === null || ctx.state !== 'running') return;
  openDecks(theme, ctx, theme.file);
  const now = ctx.currentTime;
  theme.next ??= musicFrom(now + PREPARE_S);
  if (theme.next - now < READY_S) startPass(p, theme.entry);
  for (const pass of theme.passes) steer(pass.stream, ctx);
}

/**
 * The theme's next pass, on the element not playing, from its file's start; where a pass plays
 * already, the new one comes in over SEAM_S a bar later as the old goes out under it, equal in
 * power — as the run's stems take turns (music.ts).
 */
function startPass(p: Playing, entry: SampleEntry): void {
  const { theme } = p;
  const { ctx } = p.engine;
  const zero = theme.next ?? ctx.currentTime;
  const previous = theme.passes.at(-1);
  const deck = theme.decks.find((each) => each !== previous?.stream) ?? theme.decks[0];
  if (deck === undefined) return;
  startStream(deck, ctx, zero - entry.startMs / 1000);
  const bpm = entry.bpm ?? BPM;
  if (previous === undefined) {
    deck.out.gain.setValueAtTime(1, ctx.currentTime);
  } else {
    const cross = zero + SEAM_LEAD_BARS * barOf(bpm);
    deck.out.gain.setValueAtTime(0, ctx.currentTime);
    deck.out.gain.setValueCurveAtTime(SEAM_IN, cross, SEAM_S);
    previous.stream.out.gain.setValueCurveAtTime(SEAM_OUT, cross, SEAM_S);
    rewindStream(previous.stream, ctx, cross + SEAM_S + 0.05);
  }
  const pass = { stream: deck, zero };
  theme.passes = previous === undefined ? [pass] : [previous, pass];
  theme.next = zero + passPeriod((entry.ms - entry.startMs) / 1000, bpm);
}

/** The theme and the hum fade out over FADE_OUT_S and are let go, their loops given back. */
function end(): void {
  armGestures(false);
  const p = playing;
  if (p === null) return;
  playing = null;
  clearInterval(p.timer);
  crewSpeaks(false, p);
  const { ctx } = p.engine;
  const now = ctx.currentTime;
  p.theme.fade = fadeTo(p.theme.out.gain, p.theme.fade, now, [now, now + FADE_OUT_S], 0);
  holdMusic(now + FADE_OUT_S);
  p.hum?.level.gain.cancelScheduledValues(now);
  p.hum?.level.gain.setTargetAtTime(0, now, FADE_OUT_S / 4);
  p.hum?.source.stop(now + FADE_OUT_S + 0.05);
  setTimeout(() => letGo(p), (FADE_OUT_S + 0.1) * 1000);
}

/** What `p` held let go: its elements, its blob, its nodes, the hum's recording, its loops. */
function letGo(p: Playing): void {
  p.theme.decks.forEach(closeStream);
  if (p.theme.file !== null) URL.revokeObjectURL(p.theme.file);
  p.theme.out.disconnect();
  p.hum?.out.disconnect();
  releaseSample(HUM);
  if (p.loops) release({ loop: 2 });
}

/**
 * The crew's voice in the lobby: while anybody speaks (`speaking`), the theme and the hum stand
 * pulled down as mission control's voice pulls the run's music, and come back as it ends.
 */
export function crewSpeaks(speaking: boolean, p: Playing | null = playing): void {
  try {
    if (p === null || speaking === ducked) return;
    ducked = speaking;
    const now = p.engine.ctx.currentTime;
    if (speaking) duck(p.engine, 'crew', now, Infinity, now);
    else unduck(p.engine, 'crew', now, now);
  } catch {
    // Deliberately silent: a duck missed is a little loud, nothing more.
  }
}

/** One of the interface's sounds, now — while the menu's sound plays, else nothing. */
export function uiSound(kind: UiSound): void {
  try {
    const p = playing;
    const recording = uiSamples.get(UI[kind]);
    if (p === null || recording === undefined || p.engine.ctx.state !== 'running') return;
    const { ctx } = p.engine;
    const now = ctx.currentTime;
    if (kind === 'hover' && now - lastTick < TICK_GAP_S) return;
    if (kind === 'hover') lastTick = now;
    const out = outlet(ctx, p.engine.sfx, UI_LEVEL[kind]);
    const source = startSample(ctx, recording, out, now + LOOKAHEAD);
    source.onended = () => out.disconnect();
    played[kind] += 1;
  } catch {
    // Deliberately silent: what the sound marks shows on screen as well.
  }
}

/** What the walkthrough reads of the menu's sound (`window.__escapelab.menuSound`). */
export interface MenuSoundProbe {
  state: MenuSoundState;
  /** where it is wanted: the menu, the lobby at its weight; null where it is not */
  place: MenuPlace | null;
  /** a pass of the theme plays; false while it is not rendered, or not yet in */
  theme: boolean;
  hum: boolean;
  ducked: boolean;
  /** how often each of the interface's sounds has played on this page */
  played: Record<UiSound, number>;
}

/** The menu's sound as it stands, for the walkthrough. */
export function menuSoundProbe(): MenuSoundProbe {
  return {
    state,
    place,
    theme: (playing?.theme.passes.length ?? 0) > 0,
    hum: playing?.hum != null,
    ducked,
    played: { ...played },
  };
}
