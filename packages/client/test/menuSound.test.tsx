import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_LEVEL } from '../src/world/music.js';
import {
  downstream,
  FakeContext,
  fakeGraph,
  lastContext,
  type FakeBufferSource,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';
import { elements, fakeMedia } from './fakeMedia.js';
import { serveSamples } from './fakeSamples.js';

/** The page's window as the menu's sound reaches it: its listeners, which a test fires. */
function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal('window', {
    location: { search: '', origin: 'http://lab', pathname: '/' },
    addEventListener: (type: string, listener: () => void) => {
      const kept = listeners.get(type) ?? new Set<() => void>();
      kept.add(listener);
      listeners.set(type, kept);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
  });
  return {
    fire: (type: string) => [...(listeners.get(type) ?? [])].forEach((listener) => listener()),
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

/** The sound's modules afresh, the theme 72 s and the hum, both rendered, served. */
async function fresh() {
  vi.resetModules();
  serveSamples({ 'menu-theme': { seconds: 72 } });
  const sound = await import('../src/world/menuSound.js');
  const audio = await import('../src/world/audio.js');
  const mix = await import('../src/world/mix.js');
  return { sound, audio, mix };
}

/** The sources started of the recording `id`. */
const sourcesOf = (id: string): FakeBufferSource[] =>
  lastContext()
    .all<FakeBufferSource>('buffer')
    .filter((source) => (source.buffer as { tag?: string } | null)?.tag === id);

/** The elements streaming now. */
const streaming = () => elements.filter((element) => !element.paused && element.src !== '');

beforeEach(() => {
  fakeGraph();
  fakeMedia();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the menu’s sound', () => {
  it('waits for the first click or key — no context made before — and comes in at it', async () => {
    const page = fakeWindow();
    const { sound } = await fresh();
    sound.wantMenuSound(true);
    expect(sound.menuSoundState()).toBe('waiting');
    sound.uiSound('select');
    expect(FakeContext.made).toHaveLength(0);
    page.fire('pointerdown');
    expect(FakeContext.made).toHaveLength(1);
    expect(sound.menuSoundState()).toBe('playing');
    expect(page.count('pointerdown') + page.count('keydown')).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    const [hum] = sourcesOf(sound.HUM);
    expect(hum?.loop).toBe(true);
    expect(streaming()).toHaveLength(1);
    expect(sound.menuSoundProbe()).toMatchObject({
      state: 'playing',
      theme: true,
      hum: true,
      ducked: false,
    });
  });

  it('brings the theme in on the music’s bus, the hum on the rooms’, over 2 s each', async () => {
    const page = fakeWindow();
    const { sound, audio } = await fresh();
    sound.wantMenuSound(true);
    page.fire('keydown');
    await vi.advanceTimersByTimeAsync(600);
    const engine = audio.audioEngine() as unknown as { music: FakeNode; ambience: FakeNode };
    const media = lastContext().all<FakeNode>('media');
    expect(media.some((node) => downstream(node).has(engine.music))).toBe(true);
    const [hum] = sourcesOf(sound.HUM);
    expect(hum !== undefined && downstream(hum).has(engine.ambience)).toBe(true);
    // Both rise from nothing to their level over FADE_IN_S from the gesture.
    const now = lastContext().currentTime;
    const gains = lastContext().all<FakeGain>('gain');
    const theme = gains.find((node) => node.outputs.includes(engine.music));
    expect(theme?.gain.ramps()).toEqual([[MUSIC_LEVEL, now + 2]]);
    const humFade = gains.find((node) => hum !== undefined && hum.outputs.includes(node));
    expect(humFade?.gain.ramps()).toEqual([[1, now + 2]]);
    expect(sound.FADE_IN_S).toBe(2);
  });

  it('starts nothing while the sound is off, and comes in once it is on again', async () => {
    const page = fakeWindow();
    const { sound, audio } = await fresh();
    audio.setMuted(true);
    sound.wantMenuSound(true);
    expect(sound.menuSoundState()).toBe('muted');
    page.fire('keydown');
    expect(FakeContext.made).toHaveLength(0);
    audio.setMuted(false);
    expect(sound.menuSoundState()).toBe('waiting');
    page.fire('keydown');
    expect(sound.menuSoundState()).toBe('playing');
    await vi.advanceTimersByTimeAsync(600);
    expect(streaming()).toHaveLength(1);
    audio.setMuted(true);
    expect(sound.menuSoundState()).toBe('muted');
    await vi.advanceTimersByTimeAsync(1000);
    expect(streaming()).toHaveLength(0);
    sound.uiSound('select');
    expect(sourcesOf('toggle-clack')).toHaveLength(0);
  });
});

describe('the menu’s sound in the lobby and at the run’s start', () => {
  it('fades out and lets everything go as the run starts, its loops given back', async () => {
    const page = fakeWindow();
    const { sound, audio } = await fresh();
    sound.wantMenuSound(true);
    page.fire('pointerdown');
    await vi.advanceTimersByTimeAsync(600);
    expect(audio.inUse().loop).toBe(2);
    sound.wantMenuSound(false);
    expect(sound.menuSoundState()).toBe('off');
    await vi.advanceTimersByTimeAsync(1000);
    expect(streaming()).toHaveLength(0);
    expect(audio.inUse().loop).toBe(0);
    expect(sound.menuSoundProbe()).toMatchObject({ theme: false, hum: false });
  });

  it('stands pulled down while the crew speaks in the lobby, and comes back after', async () => {
    const page = fakeWindow();
    const { sound, audio, mix } = await fresh();
    sound.wantMenuSound(true);
    page.fire('pointerdown');
    await vi.advanceTimersByTimeAsync(600);
    const engine = audio.audioEngine();
    if (engine === null) throw new Error('no engine');
    const now = engine.ctx.currentTime;
    sound.crewSpeaks(true);
    expect(sound.menuSoundProbe().ducked).toBe(true);
    expect(mix.duckLevels(engine, now + 0.1).music).toBeCloseTo(10 ** (-8 / 20), 6);
    expect(mix.duckLevels(engine, now + 0.1).ambience).toBeCloseTo(10 ** (-4 / 20), 6);
    sound.crewSpeaks(false);
    expect(mix.duckLevels(engine, now + 1).music).toBeCloseTo(1, 6);
  });

  it('ticks, clacks and chimes only while it plays, a tick no oftener than 50 ms', async () => {
    const page = fakeWindow();
    const { sound } = await fresh();
    sound.wantMenuSound(true);
    page.fire('pointerdown');
    await vi.advanceTimersByTimeAsync(600);
    sound.uiSound('select');
    sound.uiSound('back');
    sound.uiSound('opened');
    sound.uiSound('ready');
    sound.uiSound('hover');
    sound.uiSound('hover');
    for (const id of Object.values(sound.UI)) {
      expect(sourcesOf(id), id).toHaveLength(1);
    }
    expect(sound.menuSoundProbe().played).toEqual({
      hover: 1,
      select: 1,
      back: 1,
      opened: 1,
      ready: 1,
    });
  });
});

describe('the sound switch on the menu', () => {
  it('shows that the sound waits for the first click or key, on the menu alone', async () => {
    fakeWindow();
    const { sound } = await fresh();
    // The switch as the top bar draws it (App.tsx `TopBar`), off the modules just made afresh.
    const { SoundSwitch, SOUND_WAITS } = await import('../src/screens/SoundSwitch.js');
    const bar = (menu: boolean): string => renderToStaticMarkup(<SoundSwitch menu={menu} />);
    sound.wantMenuSound(true);
    expect(bar(true)).toContain(
      `<button class="sound-toggle sound-toggle--waiting" title="${SOUND_WAITS}"`,
    );
    expect(bar(false)).toContain('<button class="sound-toggle" title="Ton ausschalten"');
  });
});
