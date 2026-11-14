import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUE_FADE_S, type CueManifest } from '../src/world/intro/cue.js';
import { CROSSFADE_S, MUSIC_LEVEL, type Tension } from '../src/world/music.js';
import { fakeGraph, lastContext, type FakeGain, type FakeNode } from './fakeGraph.js';
import { elements, fakeMedia } from './fakeMedia.js';
import { loadedSamples, serveSamples } from './fakeSamples.js';

/**
 * One piece of music at a time on the music's bus (world/musicTurn.ts): a piece going holds the
 * bus until its fade has died — the run's music at its end or as the world goes, the opening's
 * cue skipped, the menu's theme as the run starts — and every piece coming waits for it: the
 * run's stems, the cue, the end card's sting, the menu's theme in a lobby.
 */

const CUE: CueManifest = { file: 'title.mp3', ms: 40_000, peak: 0.8, hash: 'abcdefabcdef' };

beforeEach(() => {
  fakeGraph();
  fakeMedia();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:music');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The music's modules afresh, every recording served — but the lobby's piece and the opening's
 * title, which await their render with the score — and the opening's cue list too.
 */
async function fresh() {
  vi.resetModules();
  const awaiting = { listed: false } as const;
  const served = {
    'menu-theme': { seconds: 60 },
    'end-won': { seconds: 32 },
    lobby: awaiting,
    title: awaiting,
  };
  await loadedSamples(served);
  const other = (url: string): Promise<Response> =>
    Promise.resolve(url === '/intro/manifest.json' ? Response.json(CUE) : new Response(null));
  serveSamples(served, other);
  const turn = await import('../src/world/musicTurn.js');
  const music = await import('../src/world/music.js');
  const audio = await import('../src/world/audio.js');
  return { turn, music, audio };
}

/** Lets the files and lists asked for come in. */
const fetchIn = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

const tension = (over: Partial<Tension> = {}): Tension => ({
  run: 1,
  startAt: Date.now() + 1500,
  left: 600,
  budget: 660,
  alarms: 0,
  escaping: false,
  ending: null,
  ...over,
});

/** The ramps the context's gains are told, to what and when: [to, at] each. */
const rampsTo = (to: number): number[] =>
  lastContext()
    .all<FakeGain>('gain')
    .flatMap((node) => node.gain.ramps())
    .filter(([value]) => value === to)
    .map(([, at]) => at);

describe('the music’s bus', () => {
  it('lets a piece start only once the one going has faded', async () => {
    const { turn } = await fresh();
    expect(turn.musicFrom(5)).toBe(5);
    turn.holdMusic(8);
    expect([turn.musicFrom(5), turn.musicFrom(9)]).toEqual([8, 9]);
    // A shorter hold leaves the longer one standing.
    turn.holdMusic(6);
    expect(turn.musicFrom(5)).toBe(8);
  });

  it('starts the run’s first stem on the bar the bus is free on, not on the due one', async () => {
    const { turn, music } = await fresh();
    turn.holdMusic(13);
    music.setTension(tension());
    await fetchIn();
    music.setTension(tension());
    lastContext().currentTime = 10.6;
    music.setTension(tension());
    // Due at 11.51 (1.5 s on, the lookahead), it comes in from 13 over the crossfade.
    expect(rampsTo(1)).toContain(13 + CROSSFADE_S);
    expect(rampsTo(1)).not.toContain(11.51 + CROSSFADE_S);
  });

  it('holds the bus while the run’s music fades at its end, or as the world goes', async () => {
    const ended = await fresh();
    ended.music.setTension(tension({ startAt: Date.now() - 1000 }));
    await fetchIn();
    ended.music.setTension(tension({ ending: 'won' }));
    expect(ended.turn.musicFrom(10)).toBeCloseTo(11.5, 9);
    const gone = await fresh();
    gone.music.setTension(tension({ startAt: Date.now() - 1000 }));
    await fetchIn();
    lastContext().currentTime = 20;
    gone.music.stopMusic();
    expect(gone.turn.musicFrom(20)).toBeCloseTo(20.3, 9);
  });

  it('holds the end card’s sting back until then, and says when it will have ended', async () => {
    const { turn, music } = await fresh();
    turn.holdMusic(15);
    const ending = music.playSting('won');
    await fetchIn();
    // 10 s of sting from 15: the end card's theme may follow at 25.
    expect(await ending).toBeCloseTo(25, 9);
    const [sting] = elements;
    vi.advanceTimersByTime(4900);
    expect(sting?.plays).toBe(0);
    vi.advanceTimersByTime(200);
    expect(sting?.plays).toBe(1);
    lastContext().state = 'suspended';
    const asleep = music.playSting('lost');
    await fetchIn();
    expect(await asleep).toBeNull();
  });
});

describe('the music that waits for the bus', () => {
  it('brings the opening’s cue in once the bus is free, where the opening stands', async () => {
    const { turn, audio } = await fresh();
    audio.audioEngine();
    const cue = await import('../src/world/intro/cue.js');
    // The menu's theme fades out for another 0.6 s as the run starts.
    turn.holdMusic(10.6);
    cue.startCue(Date.now() - 1000);
    await vi.advanceTimersByTimeAsync(10);
    const [element] = elements;
    expect(element?.src).toBe('/intro/title.mp3');
    // By then the opening stands 1.59 s in — 1 s, the lookahead, 0.6 s held: the cue starts there.
    expect(element?.currentTime).toBeCloseTo(1.59, 9);
    await vi.advanceTimersByTimeAsync(580);
    expect(element?.plays).toBe(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(element?.plays).toBe(1);
    cue.stopCue(CUE_FADE_S);
    expect(turn.musicFrom(10)).toBeCloseTo(10 + CUE_FADE_S, 9);
  });

  it('brings the menu’s theme into a lobby after the end card’s, and holds the bus', async () => {
    const { turn, audio } = await fresh();
    const engine = audio.audioEngine() as unknown as { music: FakeNode };
    const sound = await import('../src/world/menuSound.js');
    // The end card's theme goes for another second: the menu's comes in after it.
    turn.holdMusic(11);
    sound.wantMenuSound('lobby');
    const out = lastContext()
      .all<FakeGain>('gain')
      .find((node) => node.outputs.includes(engine.music));
    expect(out?.gain.ramps()).toEqual([
      [0, 11],
      [MUSIC_LEVEL * sound.LOBBY_WEIGHT, 11 + sound.FADE_IN_S],
    ]);
    // Its first pass is due as the bus is free, not as soon as its file is in.
    await vi.advanceTimersByTimeAsync(600);
    const streaming = (): number => elements.filter((each) => !each.paused).length;
    expect(streaming()).toBe(0);
    // Half a second before it, it is told to start then.
    lastContext().currentTime = 10.5;
    await vi.advanceTimersByTimeAsync(450);
    expect(streaming()).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(streaming()).toBe(1);
    lastContext().currentTime = 15;
    sound.wantMenuSound(null);
    expect(turn.musicFrom(15)).toBe(15 + sound.FADE_OUT_S);
  });
});
