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
import { closeStream, openStream, rewindStream, steer } from './audioStream.js';
import { duck, duckLevels, unduck } from './mix.js';
import {
  barsOf,
  CROSSFADE_S,
  layPass,
  MUSIC_LEVEL,
  nextBar,
  SCORE_BPM,
  type Grid,
  type Turns,
} from './music.js';
import {
  chosenFor,
  entryOf,
  subscribeMusicChoice,
  type Chosen,
  type MusicPiece,
} from './musicPacks.js';
import { previewing } from './musicPreview.js';
import { holdMusic, musicFrom } from './musicTurn.js';
import type { Slot } from './packFile.js';
import {
  loadSample,
  MUSIC_BASE,
  musicListed,
  releaseSample,
  type Sample,
  type SfxId,
} from './samples.js';

/**
 * menuSound.ts: what the menu sounds like (screens/Join.tsx), and the lobby after it — the title
 * theme (`menu-theme`), by default the score's main theme (audio/catalog.json), else the piece
 * the music pack the player picked has for it (musicPacks.ts), streamed and looped as the run's
 * stems are (music.ts `layPass`: on bars, or by a crossfade), on the music's bus at the stems'
 * level; the lobby's own piece (`lobby`), the motif thinner, where it is rendered; the facility's
 * hum under them, a bed of its own (`bed-facility`) on the rooms' bus, where it is rendered; and
 * the interface's sounds, recordings the lab has already: a tick as an item lights, a clack as one
 * is taken, a detent as a panel is stepped out of, the stage's chime as a round opens, a console's
 * chirp as somebody of the crew says ready. From the menu to the lobby the lobby's piece comes in
 * from its start on the theme's next bar, crossing with it over CROSSFADE_S as the run's stems
 * cross, as loud as the theme — every piece is brought to one loudness; where it is not rendered
 * the lobby keeps the theme, LOBBY_WEIGHT down over WEIGHT_S. Another pack picked brings its
 * theme in at once, crossing with the one playing, and its lobby's piece on the next bar. No sound
 * may start before a gesture: the first click, tap or key makes the context and brings the music
 * and the hum in over FADE_IN_S — at once where a run before has woken the context — and until then
 * the menu says it waits (`menuSoundState`), which the top bar's speaker shows. The music waits for
 * the music's bus, as every piece of music does, and holds it while it goes (musicTurn.ts): it
 * never plays over the end card's theme, the opening's cue or the run's stems. With the sound
 * switched off nothing streams. The crew's voice in the lobby pulls both down as mission control's
 * pulls the run's music; the run's start ends them. An entry not rendered yet plays nothing, takes
 * no loop of the budget, and no timer runs for it. Nothing here throws.
 */

/** The title theme, by its place in the music (packFile.ts SLOTS, audio/catalog.json). */
export const THEME: Slot = 'menu-theme';
/** The lobby's piece, by its place: the score's motif again, thinner (audio/catalog.json). */
export const LOBBY: Slot = 'lobby';
/** The facility's hum under the menu, by its id. */
export const HUM: SfxId = 'bed-facility';

/**
 * The interface's sounds: the lab's own recordings — and the cold open's click as the menu's hero
 * switches its lamp on (world/menu/heroStage.ts), the relay the run's flashlights come on with.
 */
export const UI = {
  hover: 'ui-tick',
  select: 'toggle-clack',
  back: 'dial-detent',
  opened: 'stage-chime',
  ready: 'console-ready',
  lamp: 'relay-click',
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
  lamp: 0.04,
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
/** The gestures the browser lets sound start at. */
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

/** Where the menu's sound stands: not wanted, waiting for a gesture, playing, or switched off. */
export type MenuSoundState = 'off' | 'waiting' | 'playing' | 'muted';

/** Where the menu's sound is wanted: on the menu, or in the lobby. */
export type MenuPlace = 'menu' | 'lobby';
const PLACES: readonly MenuPlace[] = ['menu', 'lobby'];
/** The music's place each of the menu's places plays. */
const SLOT_OF: Readonly<Record<MenuPlace, Slot>> = { menu: THEME, lobby: LOBBY };

/**
 * A piece of the menu's music as it plays — the theme, or the lobby's — the piece it is
 * (musicPacks.ts), the gain it crosses in and out by and its fade, its level (the entry's gain),
 * its entry and its file once fetched, its two elements and their passes (music.ts `Turns`), and
 * the bar a change of place brings its first pass in on; `next` is null while it is silent, and
 * then it holds no loop.
 */
interface Piece extends Turns {
  readonly id: Slot;
  readonly chosen: Chosen;
  readonly cross: GainNode;
  fade: Fade;
  readonly level: GainNode;
  entry: MusicPiece | null;
  file: string | null;
  first: number | null;
  gone: boolean;
}

/**
 * The menu's sound playing: the engine, its level and its fade — in and out, and the lobby's
 * weight — its two pieces and the one heard, a piece chosen anew for a place while its file comes,
 * the pieces it took over from playing out, the bars they keep once a first pass has started, the
 * hum once it plays, the timer tending the pieces once one of them is to be heard, and what stops
 * it hearing of the music chosen.
 */
interface Playing {
  readonly engine: Engine;
  readonly out: GainNode;
  outFade: Fade;
  readonly pieces: Record<MenuPlace, Piece>;
  heard: MenuPlace;
  readonly coming: Partial<Record<MenuPlace, Piece>>;
  leaving: Piece[];
  grid: Grid | null;
  hum: { source: AudioBufferSourceNode; level: GainNode; out: GainNode } | null;
  timer: ReturnType<typeof setInterval> | null;
  unchoose: () => void;
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
const played: Record<UiSound, number> = {
  hover: 0,
  select: 0,
  back: 0,
  opened: 0,
  ready: 0,
  lamp: 0,
};

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

/** The piece `chosen` for the music's place `id` on `ctx` into `out`, silent until it is heard. */
function pieceOf(ctx: AudioContext, out: AudioNode, id: Slot, chosen: Chosen): Piece {
  const level = gain(ctx, 1);
  const cross = outlet(ctx, out, 0);
  level.connect(cross);
  const none = { entry: null, file: null, decks: [], passes: [], next: null, first: null };
  return { id, chosen, cross, fade: still(0), level, gone: false, ...none };
}

/**
 * The music and the hum coming in on `engine` — the music once the music's bus is free — and the
 * interface's recordings asked for.
 */
function start(engine: Engine): void {
  armGestures(false);
  const { ctx } = engine;
  const out = outlet(ctx, engine.music, 0);
  const piece = (where: MenuPlace): Piece => {
    const slot = SLOT_OF[where];
    return pieceOf(ctx, out, slot, chosenFor(slot));
  };
  const p: Playing = {
    engine,
    out,
    outFade: still(0),
    pieces: { menu: piece('menu'), lobby: piece('lobby') },
    heard: 'menu',
    coming: {},
    leaving: [],
    grid: null,
    hum: null,
    timer: null,
    unchoose: () => undefined,
  };
  const now = ctx.currentTime;
  const from = musicFrom(now);
  p.outFade = fadeTo(out.gain, still(0), now, [from, from + FADE_IN_S], levelOf(p));
  p.unchoose = subscribeMusicChoice(() => {
    if (playing === p) chooseAnew(p);
  });
  playing = p;
  setState('playing');
  void fetchPieces(p);
  void startHum(p);
  for (const id of Object.values(UI)) {
    void loadSample(id).then((recording) => recording !== null && uiSamples.set(id, recording));
  }
}

/**
 * The piece's file fetched into memory and named by a blob address; nothing where none is. A
 * piece let go meanwhile lets its file go as it comes.
 */
async function fetchPiece(p: Playing, piece: Piece): Promise<void> {
  const entry = entryOf(piece.chosen.pack, piece.chosen.piece);
  if (entry === null) return;
  const res = await fetch(`${MUSIC_BASE}${entry.file}`).catch(() => null);
  const blob = res?.ok === true ? await res.blob().catch(() => null) : null;
  if (blob === null || playing !== p) return;
  piece.entry = entry;
  piece.file = URL.createObjectURL(blob);
  piece.level.gain.value = entry.gain;
  if (piece.gone) letPieceGo(p, piece);
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

/**
 * The music chosen anew (musicPacks.ts): for each place whose piece is another now, that piece
 * made and its file fetched — taking over as it comes (`arrive`); one chosen before and not yet
 * come let go.
 */
function chooseAnew(p: Playing): void {
  for (const where of PLACES) {
    const want = chosenFor(SLOT_OF[where]);
    const coming = p.coming[where];
    if (coming?.chosen.key === want.key) continue;
    if (coming !== undefined) letPieceGo(p, coming);
    delete p.coming[where];
    if (want.key === p.pieces[where].chosen.key) continue;
    const fresh = pieceOf(p.engine.ctx, p.out, SLOT_OF[where], want);
    p.coming[where] = fresh;
    void musicListed()
      .then(() => fetchPiece(p, fresh))
      .then(() => arrive(p, where, fresh));
  }
}

/**
 * The piece chosen anew for `where` takes over as its file has come: heard, the theme at once and
 * the lobby's piece on the next bar, crossing with the one before over CROSSFADE_S; silent, in
 * its place as it stands. The one before plays out and is let go.
 */
function arrive(p: Playing, where: MenuPlace, fresh: Piece): void {
  if (playing !== p || p.coming[where] !== fresh || fresh.file === null) return;
  delete p.coming[where];
  const before = p.pieces[where];
  p.pieces[where] = fresh;
  p.leaving.push(before);
  const now = p.engine.ctx.currentTime;
  const going = levelAt(before.fade, now) > 0.001 || before.fade.to > 0;
  if (going) {
    const soon = now + PREPARE_S;
    const at = where === 'menu' || p.grid === null ? musicFrom(soon) : nextBar(soon, p.grid);
    fresh.first = at;
    fresh.fade = fadeTo(fresh.cross.gain, still(0), now, [at, at + CROSSFADE_S], 1);
    before.fade = fadeTo(before.cross.gain, before.fade, now, [at, at + CROSSFADE_S], 0);
  } else if (heardOf(p) !== p.heard) {
    turnTo(p, heardOf(p));
  }
  weigh(p);
  tendIfHeard(p);
}

/** Tends the pieces ten times a second from when the piece to be heard has its file. */
function tendIfHeard(p: Playing): void {
  if (p.timer !== null || p.pieces[heardOf(p)].file === null) return;
  p.timer = setInterval(() => tend(p), TEND_MS);
}

/**
 * The pieces' passes: the place's piece brought in where it changed, each piece tended — and
 * those playing out, let go once they have.
 */
function tend(p: Playing): void {
  if (playing !== p || p.engine.ctx.state !== 'running') return;
  const want = heardOf(p);
  if (want !== p.heard) turnTo(p, want);
  for (const where of PLACES) tendPiece(p, p.pieces[where]);
  for (const piece of p.leaving) tendPiece(p, piece);
  p.leaving = p.leaving.filter((piece) => !piece.gone);
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

/** The piece's two elements on its file `file`, opened as its passes are first tended. */
function openDecks(piece: Piece, ctx: AudioContext, file: string): void {
  if (piece.decks.length > 0) return;
  piece.decks = [0, 1].map(() => openStream(ctx, file, piece.level, 0));
}

/** Whether `piece` is going, or gone, out of hearing at audio time `now`. */
const fadedOut = (piece: Piece, now: number): boolean =>
  piece.fade.to === 0 && levelAt(piece.fade, now) <= 0.001;

/** Whether `piece` plays out what another took over from it. */
const leavingNow = (p: Playing, piece: Piece): boolean => p.leaving.includes(piece);

/**
 * A piece as its fade has it: while it is heard its elements stand ready and its passes go on —
 * the first on the bar a change of place brought it in on, or as soon as it can, once the budget
 * has a loop for it — each next one told READY_S ahead, all of them steered; once it has faded
 * out it stops, lets its elements go and gives its loop back. A piece playing out lays no pass,
 * and is let go once silent.
 */
function tendPiece(p: Playing, piece: Piece): void {
  const { ctx } = p.engine;
  const now = ctx.currentTime;
  const leaving = leavingNow(p, piece);
  if (fadedOut(piece, now)) {
    hush(ctx, piece, now + 0.05);
    if (leaving) letPieceGo(p, piece);
    return;
  }
  const { entry, file } = piece;
  if (entry === null || file === null) return;
  openDecks(piece, ctx, file);
  if (!leaving) passOn(p, piece, entry, now);
  for (const pass of piece.passes) steer(pass.stream, ctx);
}

/** The piece's passes go on: its first laid where it has none, each next one READY_S ahead. */
function passOn(p: Playing, piece: Piece, entry: MusicPiece, now: number): void {
  const next = piece.next ?? firstPass(p, piece, entry, now);
  if (next === null) return;
  if (next - now < READY_S) layPass(p.engine.ctx, piece, entry, barsOf(entry) ?? SCORE_BPM);
}

/**
 * Lays `piece`'s first pass and returns when it starts: on the bar it was brought in on, or as
 * soon as the bus lets it; the music's bars counted from it — its tempo's, or none where it goes
 * round by a crossfade. Null where the budget has no loop for it yet.
 */
function firstPass(p: Playing, piece: Piece, entry: MusicPiece, now: number): number | null {
  if (!claim({ loop: 1 })) return null;
  const next = piece.first ?? musicFrom(now + PREPARE_S);
  piece.next = next;
  p.grid = { origin: next, bpm: barsOf(entry) };
  return next;
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

/** A piece no longer played let go: its elements, its nodes and its file's blob, once. */
function letPieceGo(p: Playing, piece: Piece): void {
  hush(p.engine.ctx, piece, p.engine.ctx.currentTime);
  piece.gone = true;
  piece.decks.forEach(closeStream);
  piece.cross.disconnect();
  if (piece.file !== null) URL.revokeObjectURL(piece.file);
  piece.file = null;
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
  p.unchoose();
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

/**
 * What `p` held let go: its pieces — those chosen anew and those playing out with them — their
 * blobs, its nodes, the hum's recording, its loops.
 */
function letGo(p: Playing): void {
  const pieces = [
    ...PLACES.map((where) => p.pieces[where]),
    ...PLACES.flatMap((where) => p.coming[where] ?? []),
    ...p.leaving,
  ];
  for (const piece of pieces) letPieceGo(p, piece);
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
  /** the piece heard, by its place in the music, once its sound plays: the theme, or the lobby's */
  piece: Slot | null;
  /** the music pack whose piece is heard (musicPacks.ts), once its sound plays */
  pack: string | null;
  /** how many of the music's elements play now: one, two while a seam or a crossing lasts */
  sounding: number;
  hum: boolean;
  ducked: boolean;
  /** how far the music stands pulled down now, linear (mix.ts): 1 where nothing pulls it */
  musicDuck: number;
  /** the piece the settings play for the ear (musicPreview.ts), by its key; null for none */
  preview: string | null;
  /** how often each of the interface's sounds has played on this page */
  played: Record<UiSound, number>;
}

/** How many of `piece`'s elements play now: their play() taken, not stopped. */
const soundingOf = (piece: Piece): number =>
  piece.decks.filter((deck) => deck.state === 'playing').length;

/** The pieces of the music as they stand: none before it starts or after it ends. */
function piecesNow(): Piece[] {
  const p = playing;
  return p === null ? [] : [...PLACES.map((where) => p.pieces[where]), ...p.leaving];
}

/** The piece heard, once an element of it plays; null before, and while none is rendered. */
function soundingPiece(): Piece | null {
  const heard = playing === null ? null : playing.pieces[playing.heard];
  return heard !== null && soundingOf(heard) > 0 ? heard : null;
}

/** How far the menu's music stands pulled down now, linear; 1 while it does not play. */
function musicDuckNow(): number {
  const engine = playing?.engine;
  return engine === undefined ? 1 : duckLevels(engine, engine.ctx.currentTime).music;
}

/** The menu's sound as it stands, for the walkthrough: what sounds, not what is laid. */
export function menuSoundProbe(): MenuSoundProbe {
  const heard = soundingPiece();
  return {
    state,
    place,
    theme: heard !== null,
    piece: heard?.id ?? null,
    pack: heard?.chosen.pack ?? null,
    sounding: piecesNow().reduce((sum, piece) => sum + soundingOf(piece), 0),
    hum: playing?.hum != null,
    ducked,
    musicDuck: musicDuckNow(),
    preview: previewing(),
    played: { ...played },
  };
}
