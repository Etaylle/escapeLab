import { claim, LOOKAHEAD, playingEngine, release } from './audio.js';
import { closeStream, openStream, startStream, type Stream } from './audioStream.js';
import { MUSIC_LEVEL, playSting } from './music.js';
import { holdMusic } from './musicTurn.js';
import { airtimeMs, preloadLines, releaseLine, sayLine, stopVoice } from './radioVoice.js';
import { MUSIC_BASE, musicEntry, type MusicId } from './samples.js';

/**
 * The end card's sound (screens/End.tsx `TitleCard`, docs/sound.md „The end cards"): the run's
 * sting first (music.ts `playSting`), then the operator's last word on the run over the radio
 * (core actions.ts `wonNow`, `lostNow`) where it has a recording, then the ending's theme half a
 * second after whichever came last — for a run won `end-won`, the title theme's motif resolved
 * into a brighter key, for a run lost `end-lost`, a low, slow drone — 32 s each, played once,
 * not looped. The theme streams on the music's bus at the stems' level, so the Leitstelle's
 * voice pulls it down as it does the run's music (mix.ts `DUCK_DB`), and takes one voice of the
 * budget while it plays (audio.ts `CAPS`). It goes with the card, fading out over END_FADE_S and
 * holding the bus until then (musicTurn.ts), so the lobby's theme comes in only after it, and
 * the last word with it. An ending whose theme is not rendered yet plays the sting and the word
 * alone; nothing plays while the context is held back. Nothing here throws.
 */

/** Each ending's theme, by its id in the catalog and the music's manifest. */
export const THEMES = {
  won: 'end-won',
  lost: 'end-lost',
} as const satisfies Readonly<Record<'won' | 'lost', MusicId>>;
/** The last word comes this long after the sting has ended, s, and the theme after the word. */
export const THEME_GAP_S = 0.5;
/** The theme goes with its card over this long, s. */
export const END_FADE_S = 1;

/** The theme as it plays: its stream, and whether it has been let go. */
interface Playing {
  readonly stream: Stream;
  gone: boolean;
}

/** The card that asked for its sound, by its ending and the moment it came up. */
interface Card {
  readonly ending: 'won' | 'lost';
  readonly since: number;
  /** the operator's last word the card asked for; null where the run has none */
  readonly line: string | null;
}

let playing: Playing | null = null;
/** The card that is up; null once none is. */
let wanted: Card | null = null;
/** The timer that brings the last word on, until it has come. */
let wordTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The end card's sound for a run that ended so: its sting now, then `line` — the operator's last
 * word on it, its recording fetched and decoded while the sting plays — and its theme.
 */
export function playEnding(ending: 'won' | 'lost', line: string | null = null): void {
  const card: Card = { ending, since: Date.now(), line };
  wanted = card;
  if (line !== null) preloadLines([line]);
  void playSting(ending).then((stingEnd) => {
    if (stingEnd === null || wanted !== card) return;
    const said = line === null ? null : sayAfter(line, stingEnd + THEME_GAP_S, card);
    startTheme(ending, (said ?? stingEnd) + THEME_GAP_S);
  });
}

/**
 * The last word `text` over the radio from `at` (audio time), while `card` stands; returns when
 * it ends, audio time — by its airtime (radioVoice.ts `airtimeMs`) — or null where it has no
 * recording to be said with, or nothing plays.
 */
function sayAfter(text: string, at: number, card: Card): number | null {
  const engine = playingEngine();
  const ms = airtimeMs(text);
  if (engine === null || ms === null) return null;
  clearTimeout(wordTimer ?? undefined);
  wordTimer = setTimeout(
    () => {
      wordTimer = null;
      if (wanted === card) sayLine(text);
    },
    Math.max(0, (at - engine.ctx.currentTime) * 1000),
  );
  return at + ms / 1000;
}

/** The theme's stream let go, and its voice given back: once. */
function letGo(theme: Playing): void {
  if (theme.gone) return;
  theme.gone = true;
  closeStream(theme.stream);
  release({ voice: 1 });
}

/**
 * Streams the theme of `ending` once, from `at` — after its sting, which waited for the music's
 * bus (music.ts `playSting`), and the last word — as one voice.
 */
function startTheme(ending: 'won' | 'lost', at: number): void {
  try {
    const engine = playingEngine();
    const entry = musicEntry(THEMES[ending]);
    if (engine === null || entry === null || playing !== null || !claim({ voice: 1 })) return;
    const { ctx } = engine;
    const file = `${MUSIC_BASE}${entry.file}`;
    const stream = openStream(ctx, file, engine.music, MUSIC_LEVEL * entry.gain);
    const start = Math.max(at, ctx.currentTime + LOOKAHEAD);
    // Where its sound starts lands on `start`: the silence its file opens with is skipped.
    startStream(stream, ctx, start - entry.startMs / 1000, entry.startMs / 1000);
    const theme: Playing = { stream, gone: false };
    playing = theme;
    stream.element.addEventListener(
      'ended',
      () => {
        if (playing === theme) playing = null;
        letGo(theme);
      },
      { once: true },
    );
  } catch {
    // Deliberately silent: the card stands without its theme.
  }
}

/**
 * The card goes: the last word breaks off, or never comes, its recording let go; its theme fades
 * out over END_FADE_S and is let go, the bus held till then.
 */
export function stopEnding(): void {
  const card = wanted;
  wanted = null;
  if (wordTimer !== null) {
    clearTimeout(wordTimer);
    wordTimer = null;
  }
  if (card?.line != null) {
    stopVoice();
    releaseLine(card.line);
  }
  const theme = playing;
  playing = null;
  if (theme === null) return;
  try {
    const param = theme.stream.out.gain;
    const now = theme.stream.out.context.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(0, now + END_FADE_S);
    holdMusic(now + END_FADE_S);
    setTimeout(() => letGo(theme), (END_FADE_S + 0.05) * 1000);
  } catch {
    // Deliberately silent: the theme ends on its own.
    letGo(theme);
  }
}

/** What the walkthrough reads of the end card's sound (`window.__escapelab.endTheme`). */
export interface EndThemeProbe {
  /** the ending whose card asked for its music; null while no card is up */
  asked: 'won' | 'lost' | null;
  /** the operator's last word the card asked for; null where none, or no card is up */
  line: string | null;
  /** the theme playing or due; null where none is — not rendered yet, played out, or gone */
  playing: MusicId | null;
}

/** The end card's sound as it stands, for the walkthrough. */
export function endThemeProbe(): EndThemeProbe {
  const card = wanted;
  const theme = playing !== null && card !== null ? THEMES[card.ending] : null;
  return { asked: card?.ending ?? null, line: card?.line ?? null, playing: theme };
}
