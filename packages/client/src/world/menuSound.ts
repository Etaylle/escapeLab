import {
  audioEngine,
  claim,
  fadeTo,
  gain,
  isMuted,
  levelAt,
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
  CROSSFADE_S,
  loopPeriod,
  MUSIC_LEVEL,
  nextBar,
  SEAM_IN,
  SEAM_LEAD_BARS,
  SEAM_OUT,
  SEAM_S,
  type Grid,
} from './music.js';
import {
  loadSample,
  MUSIC_BASE,
  musicEntry,
  musicListed,
  releaseSample,
  type MusicId,
  type Sample,
  type SampleEntry,
  type SfxId,
} from './samples.js';

/**
 * menuSound.ts: what the menu sounds like (screens/Join.tsx), and the lobby after it — the title
 * theme, a piece of the score (audio/catalog.json `menu-theme`), streamed and looped on whole
 * bars as the run's stems are (music.ts), on the music's bus at the stems' level; the lobby's own
 * piece of the score (`lobby`), the motif thinner, where it is rendered; the facility's hum under
 * them, a bed of its own (`bed-facility`) on the rooms' bus, where it is rendered; and the
 * interface's sounds, recordings the lab has already: a tick as an item lights, a clack as one is
 * taken, a detent as a panel is stepped out of, the stage's chime as a round opens, a console's
 * chirp as somebody of the crew says ready. From the menu to the lobby the lobby's piece comes in
 * from its start on the theme's next bar, crossing with it over CROSSFADE_S as the run's stems
 * cross, as loud as the theme — the score's pieces are brought to one loudness; where it is not
 * rendered the lobby keeps the theme, LOBBY_WEIGHT down over WEIGHT_S. No sound may start before
 * a gesture: the first click, tap or key makes the context and brings the music and the hum in
 * over FADE_IN_S — at once where a run before has woken the context — and until then the menu
 * says it waits (`menuSoundState`), which the top bar's speaker shows. The music waits for the
 * music's bus, as every piece of music does, and holds it while it goes (musicTurn.ts): it never
 * plays over the end card's theme, the opening's cue or the run's stems. With the sound switched
 * off nothing streams. The crew's voice in the lobby pulls both down as mission control's pulls
 * the run's music; the run's start ends them. An entry not rendered yet plays nothing, takes no
 * loop of the budget, and no timer runs for it. Nothing here throws.
 */

/** The title theme, by its id in the catalog and the music's manifest. */
export const THEME: MusicId = 'menu-theme';
/** The lobby's piece, by its id: the score's motif again, thinner (audio/catalog.json). */
export const LOBBY: MusicId = 'lobby';
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

/** The music at the stems' level (a piece at its loudness); the hum a little under a room's bed. */
const THEME_LEVEL = MUSIC_LEVEL;
const HUM_LEVEL = 0.02;
/** How long the music and the hum take to come in, and to go, s. */
export const FADE_IN_S = 2;
export const FADE_OUT_S = 0.6;
/** The theme's weight in the lobby against the menu's, where the lobby has no piece: 6 dB down. */
export const LOBBY_WEIGHT = 0.5;
/** How long the theme takes to change its weight between the menu and the lobby, s. */
export const WEIGHT_S = 1.5;
/** How often the pieces' passes are tended, ms; how far ahead a pass is told to start, s. */
const TEND_MS = 100;
const READY_S = 1;
/** The first pass starts this far after the gesture, s: its element has time to begin. */
const PREPARE_S = 0.3;
/** A piece's tempo where its entry names none: the music's own. */
const BPM = 90;
/** The gestures the browser lets sound start at. */
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

/** Where the menu's sound stands: not wanted, waiting for a gesture, playing, or switched off. */
export type MenuSoundState = 'off' | 'waiting' | 'playing' | 'muted';

/** Where the menu's sound is wanted: on the menu, or in the lobby. */
export type MenuPlace = 'menu' | 'lobby';
const PLACES: readonly MenuPlace[] = ['menu', 'lobby'];

/**
 * A piece of the menu's music as it plays — the theme, or the lobby's — the gain it crosses in
 * and out by and its fade, its level (the entry's gain), its entry and its file once fetched, its
 * two elements and their passes, when its next pass starts, and the bar a change of place brings
 * its first pass in on; `next` is null while it is silent, and then it holds no loop.
 */
interface Piece {
  readonly id: MusicId;
  readonly cross: GainNode;
  fade: Fade;
  readonly level: GainNode;
  entry: SampleEntry | null;
  file: string | null;
  decks: Stream[];
  passes: { stream: Stream; zero: number }[];
  next: number | null;
  first: number | null;
}

/**
 * The menu's sound playing: the engine, its level and its fade — in and out, and the lobby's
 * weight — its two pieces and the one heard, the bars they keep once a first pass has started,
 * the hum once it plays, and the timer tending the pieces once one of them is to be heard.
 */
interface Playing {
  readonly engine: Engine;
  readonly out: GainNode;
  outFade: Fade;
  readonly pieces: Readonly<Record<MenuPlace, Piece>>;
  heard: MenuPlace;
  grid: Grid | null;
  hum: { source: AudioBufferSourceNode; level: GainNode; out: GainNode } | null;
  timer: ReturnType<typeof setInterval> | null;
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
 * The menu's sound is wanted where `where` says — on the menu, or in the lobby — or nowhere
 * (null: a run, the audience): it waits for a gesture, plays, moves to the place's piece or
 * weight, or fades out and lets everything go.
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
    if (playing !== null && was !== where) moveTo(playing);
    begin();
  } catch {
    // Deliberately silent: the menu's sound is flavour.
  }
}

/** The piece to be heard now: the lobby's in the lobby where it is rendered, else the theme. */
function heardOf(p: Playing): MenuPlace {
  return place === 'lobby' && p.pieces.lobby.file !== null ? 'lobby' : 'menu';
}

/** The music's level where the sound is wanted: the theme's lobby weight where it stands in. */
function levelOf(p: Playing): number {
  return place === 'lobby' && heardOf(p) === 'menu' ? THEME_LEVEL * LOBBY_WEIGHT : THEME_LEVEL;
}

/** The music moves to the level of where it is wanted over WEIGHT_S — after its coming in. */
function weigh(p: Playing): void {
  const now = p.engine.ctx.currentTime;
  const start = Math.max(now, p.outFade.start);
  const end = Math.max(start + WEIGHT_S, p.outFade.end);
  p.outFade = fadeTo(p.out.gain, p.outFade, now, [start, end], levelOf(p));
}

/** The place changed: the music's weight follows, and the piece of the place is tended. */
function moveTo(p: Playing): void {
  weigh(p);
  tendIfHeard(p);
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

/** A piece of the menu's music on `ctx` into `out`, silent until its place is heard. */
function pieceOf(ctx: AudioContext, out: AudioNode, id: MusicId): Piece {
  const level = gain(ctx, 1);
  const cross = outlet(ctx, out, 0);
  level.connect(cross);
  const none = { entry: null, file: null, decks: [], passes: [], next: null, first: null };
  return { id, cross, fade: still(0), level, ...none };
}

/**
 * The music and the hum coming in on `engine` — the music once the music's bus is free — and the
 * interface's recordings asked for.
 */
function start(engine: Engine): void {
  armGestures(false);
  const { ctx } = engine;
  const out = outlet(ctx, engine.music, 0);
  const pieces = { menu: pieceOf(ctx, out, THEME), lobby: pieceOf(ctx, out, LOBBY) };
  const p: Playing = {
    engine,
    out,
    outFade: still(0),
    pieces,
    heard: 'menu',
    grid: null,
    hum: null,
    timer: null,
  };
  const now = ctx.currentTime;
  const from = musicFrom(now);
  p.outFade = fadeTo(out.gain, still(0), now, [from, from + FADE_IN_S], levelOf(p));
  playing = p;
  setState('playing');
  void fetchPieces(p);
  void startHum(p);
  for (const id of Object.values(UI)) {
    void loadSample(id).then((recording) => recording !== null && uiSamples.set(id, recording));
  }
}

/** The piece's file fetched into memory and named by a blob address; nothing where none is. */
async function fetchPiece(p: Playing, piece: Piece): Promise<void> {
  const entry = musicEntry(piece.id);
  if (entry === null) return;
  const res = await fetch(`${MUSIC_BASE}${entry.file}`).catch(() => null);
  const blob = res?.ok === true ? await res.blob().catch(() => null) : null;
  if (blob === null || playing !== p) return;
  piece.entry = entry;
  piece.file = URL.createObjectURL(blob);
  piece.level.gain.value = entry.gain;
}

/**
 * Both pieces' files fetched; then the piece of the place is the one heard — the theme where the
 * lobby has none — at its level, and tended from then on.
 */
async function fetchPieces(p: Playing): Promise<void> {
  await musicListed();
  await Promise.all(PLACES.map((where) => fetchPiece(p, p.pieces[where])));
  if (playing !== p) return;
  turnTo(p, heardOf(p));
  if (levelOf(p) !== p.outFade.to) weigh(p);
  tendIfHeard(p);
}

/** Tends the pieces ten times a second from when the piece to be heard has its file. */
function tendIfHeard(p: Playing): void {
  if (p.timer !== null || p.pieces[heardOf(p)].file === null) return;
  p.timer = setInterval(() => tend(p), TEND_MS);
}

/** The pieces' passes: the place's piece brought in where it changed, each piece tended. */
function tend(p: Playing): void {
  if (playing !== p || p.engine.ctx.state !== 'running') return;
  const want = heardOf(p);
  if (want !== p.heard) turnTo(p, want);
  for (const where of PLACES) tendPiece(p, p.pieces[where]);
}

/**
 * The piece of `to` comes in from its start on the next bar of the music's bars, the other going
 * out under it over CROSSFADE_S, equal in their sum; before any pass has started, at once.
 */
function turnTo(p: Playing, to: MenuPlace): void {
  const now = p.engine.ctx.currentTime;
  const at = p.grid === null ? now : nextBar(now + PREPARE_S, p.grid);
  const span: [number, number] = [at, p.grid === null ? at : at + CROSSFADE_S];
  for (const where of PLACES) {
    const piece = p.pieces[where];
    const level = where === to ? 1 : 0;
    piece.fade = fadeTo(piece.cross.gain, piece.fade, now, span, level);
    if (level === 1 && piece.next === null && p.grid !== null) piece.first = at;
  }
  p.heard = to;
}

/** The theme's two elements on its file `file`, opened as its passes are first tended. */
function openDecks(piece: Piece, ctx: AudioContext, file: string): void {
  if (piece.decks.length > 0) return;
  piece.decks = [0, 1].map(() => openStream(ctx, file, piece.level, 0));
}

/** The tempo a piece's bars are counted in: its entry's, else the music's own. */
const bpmOf = (entry: SampleEntry): number => entry.bpm ?? BPM;

/** Whether `piece` is going, or gone, out of hearing at audio time `now`. */
const fadedOut = (piece: Piece, now: number): boolean =>
  piece.fade.to === 0 && levelAt(piece.fade, now) <= 0.001;

/**
 * A piece as its fade has it: while it is heard its elements stand ready and its passes go on —
 * the first on the bar a change of place brought it in on, or as soon as it can, once the budget
 * has a loop for it — each next one told READY_S ahead, all of them steered; once it has faded
 * out it stops, lets its elements go and gives its loop back.
 */
function tendPiece(p: Playing, piece: Piece): void {
  const { ctx } = p.engine;
  const now = ctx.currentTime;
  if (fadedOut(piece, now)) {
    hush(ctx, piece, now + 0.05);
    return;
  }
  const { entry, file } = piece;
  if (entry === null || file === null) return;
  openDecks(piece, ctx, file);
  const next = piece.next ?? firstPass(p, piece, entry, now);
  if (next === null) return;
  if (next - now < READY_S) startPass(p, piece, entry);
  for (const pass of piece.passes) steer(pass.stream, ctx);
}

/**
 * Lays `piece`'s first pass and returns when it starts: on the bar it was brought in on, or as
 * soon as the bus lets it; the music's bars counted from the first pass of all. Null where the
 * budget has no loop for it yet.
 */
function firstPass(p: Playing, piece: Piece, entry: SampleEntry, now: number): number | null {
  if (!claim({ loop: 1 })) return null;
  const next = piece.first ?? musicFrom(now + PREPARE_S);
  piece.next = next;
  p.grid ??= { origin: next, bpm: bpmOf(entry) };
  return next;
}

/**
 * The piece's next pass, on the element not playing, from its file's start; where a pass plays
 * already, the new one comes in over SEAM_S a bar later as the old goes out under it, equal in
 * power — as the run's stems take turns (music.ts) — on the bars its manifest names.
 */
function startPass(p: Playing, piece: Piece, entry: SampleEntry): void {
  const { ctx } = p.engine;
  const zero = piece.next ?? ctx.currentTime;
  const previous = piece.passes.at(-1);
  const deck = piece.decks.find((each) => each !== previous?.stream) ?? piece.decks[0];
  if (deck === undefined) return;
  startStream(deck, ctx, zero - entry.startMs / 1000);
  const bpm = bpmOf(entry);
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
  piece.passes = previous === undefined ? [pass] : [previous, pass];
  piece.next = zero + loopPeriod(entry, bpm);
}

/** The piece stops at `at` and gives its loop back: faded out, or the sound is over. */
function hush(ctx: AudioContext, piece: Piece, at: number): void {
  if (piece.next === null) return;
  const decks = piece.decks;
  for (const deck of decks) rewindStream(deck, ctx, at);
  const wait = Math.max(0, (at - ctx.currentTime) * 1000);
  setTimeout(() => decks.forEach(closeStream), wait + 50);
  piece.decks = [];
  piece.passes = [];
  piece.next = null;
  piece.first = null;
  release({ loop: 1 });
}

/**
 * The hum looped on the rooms' bus, coming in over FADE_IN_S once its recording is here — the
 * loader keeps one brought up more than a bed may be (samples.ts BED_GAIN_MAX) silent — taking a
 * loop of the budget only while it plays.
 */
async function startHum(p: Playing): Promise<void> {
  const recording = await loadSample(HUM);
  if (recording === null || playing !== p || !claim({ loop: 1 })) return;
  const { ctx } = p.engine;
  const out = outlet(ctx, p.engine.ambience, HUM_LEVEL);
  const level = gain(ctx, 0);
  level.connect(out);
  const now = ctx.currentTime;
  level.gain.setValueAtTime(0, now);
  level.gain.linearRampToValueAtTime(1, now + FADE_IN_S);
  p.hum = { source: playLoop(ctx, recording.buffer, level, now), level, out };
}

/** The music and the hum fade out over FADE_OUT_S and are let go, their loops given back. */
function end(): void {
  armGestures(false);
  const p = playing;
  if (p === null) return;
  playing = null;
  if (p.timer !== null) clearInterval(p.timer);
  crewSpeaks(false, p);
  const { ctx } = p.engine;
  const now = ctx.currentTime;
  p.outFade = fadeTo(p.out.gain, p.outFade, now, [now, now + FADE_OUT_S], 0);
  holdMusic(now + FADE_OUT_S);
  p.hum?.level.gain.cancelScheduledValues(now);
  p.hum?.level.gain.setTargetAtTime(0, now, FADE_OUT_S / 4);
  p.hum?.source.stop(now + FADE_OUT_S + 0.05);
  setTimeout(() => letGo(p), (FADE_OUT_S + 0.1) * 1000);
}

/** What `p` held let go: its pieces, their blobs, its nodes, the hum's recording, its loops. */
function letGo(p: Playing): void {
  for (const where of PLACES) {
    const piece = p.pieces[where];
    hush(p.engine.ctx, piece, p.engine.ctx.currentTime);
    piece.decks.forEach(closeStream);
    if (piece.file !== null) URL.revokeObjectURL(piece.file);
  }
  p.out.disconnect();
  p.hum?.out.disconnect();
  releaseSample(HUM);
  if (p.hum !== null) release({ loop: 1 });
}

/**
 * The crew's voice in the lobby: while anybody speaks (`speaking`), the music and the hum stand
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
  /** where it is wanted: the menu, the lobby; null where it is not */
  place: MenuPlace | null;
  /**
   * the music sounds: an element of the piece heard plays — not a pass laid for later; false
   * while none is rendered, or not yet in
   */
  theme: boolean;
  /** the piece heard, by its id, once its sound plays: the theme, or the lobby's */
  piece: MusicId | null;
  /** how many of the music's elements play now: one, two while a seam or a crossing lasts */
  sounding: number;
  hum: boolean;
  ducked: boolean;
  /** how often each of the interface's sounds has played on this page */
  played: Record<UiSound, number>;
}

/** How many of `piece`'s elements play now: their play() taken, not stopped. */
const soundingOf = (piece: Piece): number =>
  piece.decks.filter((deck) => deck.state === 'playing').length;

/** The pieces of the music as they stand: none before it starts or after it ends. */
function piecesNow(): Piece[] {
  const p = playing;
  return p === null ? [] : PLACES.map((where) => p.pieces[where]);
}

/** The piece heard, once an element of it plays; null before, and while none is rendered. */
function soundingPiece(): Piece | null {
  const heard = playing === null ? null : playing.pieces[playing.heard];
  return heard !== null && soundingOf(heard) > 0 ? heard : null;
}

/** The menu's sound as it stands, for the walkthrough: what sounds, not what is laid. */
export function menuSoundProbe(): MenuSoundProbe {
  const heard = soundingPiece();
  return {
    state,
    place,
    theme: heard !== null,
    piece: heard?.id ?? null,
    sounding: piecesNow().reduce((sum, piece) => sum + soundingOf(piece), 0),
    hum: playing?.hum != null,
    ducked,
    played: { ...played },
  };
}
