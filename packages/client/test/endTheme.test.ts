import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOOKAHEAD } from '../src/world/audio.js';
import { DUCK_DB } from '../src/world/mix.js';
import { MUSIC_LEVEL } from '../src/world/music.js';
import { KEY_S, TAIL_S, type VoiceManifest } from '../src/world/radioVoice.js';
import {
  downstream,
  fakeGraph,
  lastContext,
  type FakeBufferSource,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';
import { elements, fakeMedia, type FakeAudio } from './fakeMedia.js';
import { loadedSamples, serveSamples, type Served } from './fakeSamples.js';

/** The end card's music and the one bus it shares (world/endTheme.ts, world/musicTurn.ts). */

beforeEach(() => {
  fakeGraph();
  fakeMedia();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The operator's last word on a won run, and its recording of 3 s in the voice's list. */
const LAST_WORD = 'Alle draußen, und der Trakt hat wieder Strom.';
const VOICE: VoiceManifest = {
  lines: {
    aaaaaaaaaaaa: {
      text: LAST_WORD,
      ms: 3000,
      missions: ['blackout'],
      speaker: 'operator',
      file: 'aaaaaaaaaaaa.mp3',
    },
  },
};

/** The voice's list and its recordings, as the static site serves them; nothing else. */
function serveVoice(url: string): Promise<unknown> {
  if (url === '/voice/manifest.json') return Promise.resolve(Response.json(VOICE));
  if (url.startsWith('/voice/')) return Promise.resolve(new Response('mp3'));
  return Promise.resolve(new Response(null, { status: 404 }));
}

/**
 * The modules afresh, the recordings served as `served` says: the themes 32 s each, and the
 * voice's list of the last word, its recordings fetched as a run's start fetches them.
 */
async function fresh(served: Readonly<Record<string, Served>> = {}) {
  vi.resetModules();
  const recordings = { 'end-won': { seconds: 32 }, 'end-lost': { seconds: 32 }, ...served };
  await loadedSamples(recordings);
  serveSamples(recordings, serveVoice);
  const end = await import('../src/world/endTheme.js');
  const audio = await import('../src/world/audio.js');
  const turn = await import('../src/world/musicTurn.js');
  const radio = await import('../src/world/radioVoice.js');
  radio.preloadVoice('blackout');
  return { end, audio, turn, radio };
}

/** Lets the music's manifest come in. */
const fetchIn = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

/** The level an element's sound goes out at: its stream's own gain. */
const outOf = (element: FakeAudio | undefined): FakeGain => {
  const source = lastContext()
    .all<FakeNode & { mediaElement: unknown }>('media')
    .find((node) => node.mediaElement === element);
  return source?.outputs[0] as FakeGain;
};

describe('the end card’s music', () => {
  it('plays the sting, then the ending’s theme 0.5 s after it, at the stems’ level', async () => {
    const { end, audio } = await fresh({ 'end-won': { seconds: 32, gain: 1.25, startMs: 400 } });
    end.playEnding('won');
    await fetchIn();
    const [sting, theme] = elements;
    expect([sting?.src, theme?.src]).toEqual(['/music/won.mp3', '/music/end-won.mp3']);
    // The silence its file opens with is skipped: its sound starts on its moment.
    expect(theme?.currentTime).toBe(0.4);
    expect(outOf(theme).gain.value).toBeCloseTo(MUSIC_LEVEL * 1.25, 9);
    expect(audio.inUse().voice).toBe(1);
    // The sting lasts 10 s from the start the engine looks ahead to; the theme comes 0.5 s after.
    vi.advanceTimersByTime((LOOKAHEAD + 10.4) * 1000);
    expect(theme?.plays).toBe(0);
    vi.advanceTimersByTime(200);
    expect(theme?.plays).toBe(1);
    expect(end.endThemeProbe()).toEqual({ asked: 'won', line: null, playing: 'end-won' });
    // Played once through: let go, its voice given back.
    theme?.fire('ended');
    expect(theme?.src).toBe('');
    expect(audio.inUse().voice).toBe(0);
    expect(end.endThemeProbe()).toEqual({ asked: 'won', line: null, playing: null });
  });

  it('plays the lost theme for a run lost, the sting alone while no theme is made', async () => {
    const lost = await fresh();
    lost.end.playEnding('lost');
    await fetchIn();
    expect(elements.map((element) => element.src)).toEqual([
      '/music/lost.mp3',
      '/music/end-lost.mp3',
    ]);
    elements.length = 0;
    const unrendered = await fresh({ 'end-won': { listed: false } });
    unrendered.end.playEnding('won');
    await fetchIn();
    expect(elements.map((element) => element.src)).toEqual(['/music/won.mp3']);
    expect(unrendered.audio.inUse().voice).toBe(0);
  });

  it('fades the theme out as its card goes, holding the music’s bus until it has', async () => {
    const { end, audio, turn } = await fresh();
    end.playEnding('won');
    await fetchIn();
    const theme = elements[1];
    const ctx = lastContext();
    ctx.currentTime = 40;
    end.stopEnding();
    expect(outOf(theme).gain.ramps().at(-1)).toEqual([0, 40 + end.END_FADE_S]);
    expect(turn.musicFrom(40)).toBe(40 + end.END_FADE_S);
    vi.advanceTimersByTime(end.END_FADE_S * 1000 + 100);
    expect(theme?.src).toBe('');
    expect(audio.inUse().voice).toBe(0);
    expect(end.endThemeProbe()).toEqual({ asked: null, line: null, playing: null });
  });

  it('starts no theme for a card gone before its sting ended, nor while asleep', async () => {
    const { end, audio } = await fresh();
    end.playEnding('won');
    end.stopEnding();
    await fetchIn();
    expect(elements.map((element) => element.src)).toEqual(['/music/won.mp3']);
    elements.length = 0;
    lastContext().state = 'suspended';
    end.playEnding('lost');
    await fetchIn();
    expect(elements).toHaveLength(0);
    expect(audio.inUse().voice).toBe(0);
  });

  it('goes into the music’s bus, which the Leitstelle’s voice pulls down', async () => {
    const { end, audio } = await fresh();
    end.playEnding('won');
    await fetchIn();
    const engine = audio.audioEngine() as unknown as { music: FakeNode };
    expect(downstream(outOf(elements[1])).has(engine.music)).toBe(true);
    expect(DUCK_DB.music.voice).toBe(-8);
  });
});

describe('the operator’s last word on the end card', () => {
  /** How long the last word keeps the air by the manifest, s: the key, its 3 s, the tail. */
  const AIR_S = KEY_S + 3 + TAIL_S;

  it('comes 0.5 s after the sting, over the radio, and the theme 0.5 s after it', async () => {
    const { end, radio } = await fresh();
    await fetchIn();
    end.playEnding('won', LAST_WORD);
    await fetchIn();
    expect(end.endThemeProbe()).toEqual({ asked: 'won', line: LAST_WORD, playing: 'end-won' });
    const theme = elements[1];
    // The sting ends 10 s past the look-ahead; the word comes half a second later.
    await vi.advanceTimersByTimeAsync((LOOKAHEAD + 10.5) * 1000 - 50);
    expect(radio.voiceProbe().lastId).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(radio.voiceProbe().lastId).toBe('aaaaaaaaaaaa');
    // The theme waits for the word, and half a second more.
    await vi.advanceTimersByTimeAsync((AIR_S + 0.5) * 1000 - 150);
    expect(theme?.plays).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(theme?.plays).toBe(1);
  });

  it('leaves the theme on the sting’s time where the word has no recording, and says nothing', async () => {
    const { end, radio } = await fresh();
    await fetchIn();
    end.playEnding('won', 'Eine Zeile ohne Aufnahme.');
    await fetchIn();
    const theme = elements[1];
    await vi.advanceTimersByTimeAsync((LOOKAHEAD + 10.6) * 1000);
    expect(theme?.plays).toBe(1);
    expect(radio.voiceProbe().lastId).toBeNull();
  });

  it('never brings the word once the card has gone, and breaks it off where it speaks', async () => {
    const gone = await fresh();
    await fetchIn();
    gone.end.playEnding('lost', LAST_WORD);
    await fetchIn();
    gone.end.stopEnding();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(gone.radio.voiceProbe().lastId).toBeNull();
    expect(gone.end.endThemeProbe()).toEqual({ asked: null, line: null, playing: null });
    elements.length = 0;
    const cut = await fresh();
    await fetchIn();
    cut.end.playEnding('won', LAST_WORD);
    await fetchIn();
    await vi.advanceTimersByTimeAsync((LOOKAHEAD + 10.6) * 1000);
    const ctx = lastContext();
    const word = ctx.all<FakeBufferSource>('buffer').find((s) => s.buffer?.duration === 1.5);
    expect(word?.startedAt).not.toBeNull();
    cut.end.stopEnding();
    expect(word?.stoppedAt).toBeLessThan((word?.startedAt ?? 0) + 1.5);
  });
});
