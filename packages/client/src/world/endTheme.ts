import { claim, LOOKAHEAD, playingEngine, release } from './audio.js';
import { closeStream, openStream, startStream, type Stream } from './audioStream.js';
import { MUSIC_LEVEL, playSting } from './music.js';
import { holdMusic } from './musicTurn.js';
import { MUSIC_BASE, musicEntry, type MusicId } from './samples.js';

/**
 * The end card's music (screens/End.tsx `TitleCard`, docs/sound.md „The end cards"): the run's
 * sting first (music.ts `playSting`), then the ending's theme half a second after it — for a run
 * won `end-won`, the title theme's motif resolved into a brighter key, for a run lost
 * `end-lost`, a low, slow drone — 32 s each, played once, not looped. It streams on the music's
 * bus at the stems' level, so the Leitstelle's voice pulls it down as it does the run's music
 * (mix.ts `DUCK_DB`), and takes one voice of the budget while it plays (audio.ts `CAPS`). It goes
 * with the card, fading out over END_FADE_S and holding the bus until then (musicTurn.ts), so the
 * lobby's theme comes in only after it. An ending whose theme is not rendered yet plays the sting
 * alone; nothing plays while the context is held back. Nothing here throws.
 */

/** Each ending's theme, by its id in the catalog and the music's manifest. */
export const THEMES = {
  won: 'end-won',
  lost: 'end-lost',
} as const satisfies Readonly<Record<'won' | 'lost', MusicId>>;
/** The theme starts this long after its sting has ended, s. */
export const THEME_GAP_S = 0.5;
/** The theme goes with its card over this long, s. */
export const END_FADE_S = 1;

/** The theme as it plays: its stream, and whether it has been let go. */
interface Playing {
  readonly stream: Stream;
  gone: boolean;
}

let playing: Playing | null = null;
/** The ending whose card is up, by the time it came up; null once none is. */
let wanted: { ending: 'won' | 'lost'; since: number } | null = null;

/** The end card's music for a run that ended so: its sting now, then its theme. */
export function playEnding(ending: 'won' | 'lost'): void {
  const card = { ending, since: Date.now() };
  wanted = card;
  void playSting(ending).then((stingEnd) => {
    if (stingEnd !== null && wanted === card) startTheme(ending, stingEnd + THEME_GAP_S);
  });
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
 * bus (music.ts `playSting`) — as one voice.
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

/** The card goes: its theme fades out over END_FADE_S and is let go, the bus held till then. */
export function stopEnding(): void {
  wanted = null;
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

/** What the walkthrough reads of the end card's music (`window.__escapelab.endTheme`). */
export interface EndThemeProbe {
  /** the ending whose card asked for its music; null while no card is up */
  asked: 'won' | 'lost' | null;
  /** the theme playing or due; null where none is — not rendered yet, played out, or gone */
  playing: MusicId | null;
}

/** The end card's music as it stands, for the walkthrough. */
export function endThemeProbe(): EndThemeProbe {
  const card = wanted;
  const theme = playing !== null && card !== null ? THEMES[card.ending] : null;
  return { asked: card?.ending ?? null, playing: theme };
}
