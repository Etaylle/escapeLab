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

/** The sound's modules afresh, the theme 60 s and the hum, both rendered, served. */
async function fresh() {
  vi.resetModules();
  serveSamples({ 'menu-theme': { seconds: 60 } });
  const sound = await import('../src/world/menuSound.js');
  const audio = await import('../src/world/audio.js');
  const mix = await import('../src/world/mix.js');
  const turn = await import('../src/world/musicTurn.js');
  return { sound, audio, mix, turn };
}

/** The theme's out on the music's bus: the gain its fades move. */
const themeOut = (music: FakeNode): FakeGain | undefined =>
  lastContext()
    .all<FakeGain>('gain')
    .find((node) => node.outputs.includes(music));

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
    sound.wantMenuSound('menu');
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
    sound.wantMenuSound('menu');
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
    sound.wantMenuSound('menu');
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

  it('comes back at once as the sound is switched on again, its context running', async () => {
    const page = fakeWindow();
    const { sound, audio } = await fresh();
    sound.wantMenuSound('menu');
    page.fire('keydown');
    await vi.advanceTimersByTimeAsync(600);
    audio.setMuted(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(streaming()).toHaveLength(0);
    audio.setMuted(false);
    // No key waited for: the context the first one made runs on.
    expect(sound.menuSoundState()).toBe('playing');
    expect(page.count('keydown') + page.count('pointerdown')).toBe(0);
    // Its first pass waits out the 0.6 s the theme before held the music's bus to fade.
    await vi.advanceTimersByTimeAsync(1000);
    expect(streaming()).toHaveLength(1);
    expect(FakeContext.made).toHaveLength(1);
  });

  it('tends no theme that is not rendered yet: no timer runs for it, the hum plays alone', async () => {
    const page = fakeWindow();
    vi.resetModules();
    serveSamples({ 'menu-theme': { listed: false } });
    const sound = await import('../src/world/menuSound.js');
    const tending = vi.spyOn(globalThis, 'setInterval');
    sound.wantMenuSound('menu');
    page.fire('keydown');
    await vi.advanceTimersByTimeAsync(600);
    expect(sound.menuSoundProbe()).toMatchObject({ state: 'playing', theme: false, hum: true });
    expect(tending).not.toHaveBeenCalled();
  });
});

describe('the menu’s sound in the lobby and at the run’s start', () => {
  it('keeps the theme into the lobby 6 dB down over 1.5 s, and brings it back up', async () => {
    const page = fakeWindow();
    const { sound, audio } = await fresh();
    sound.wantMenuSound('menu');
    page.fire('keydown');
    await vi.advanceTimersByTimeAsync(600);
    const engine = audio.audioEngine() as unknown as { music: FakeNode };
    const out = themeOut(engine.music);
    lastContext().currentTime = 20;
    sound.wantMenuSound('lobby');
    expect(sound.LOBBY_WEIGHT).toBe(0.5);
    expect(out?.gain.ramps().at(-1)).toEqual([MUSIC_LEVEL * 0.5, 20 + sound.WEIGHT_S]);
    expect(sound.menuSoundProbe()).toMatchObject({ state: 'playing', place: 'lobby' });
    // The same theme plays on: nothing starts anew.
    expect(streaming()).toHaveLength(1);
    lastContext().currentTime = 30;
    sound.wantMenuSound('menu');
    expect(out?.gain.ramps().at(-1)).toEqual([MUSIC_LEVEL, 30 + sound.WEIGHT_S]);
  });

  it('comes in at once in a lobby after a run, the context awake, no gesture waited', async () => {
    fakeWindow();
    const { sound, audio } = await fresh();
    // The run before made the context and woke it.
    const engine = audio.audioEngine() as unknown as { music: FakeNode };
    sound.wantMenuSound('lobby');
    expect(sound.menuSoundState()).toBe('playing');
    const now = lastContext().currentTime;
    expect(themeOut(engine.music)?.gain.ramps()).toEqual([[MUSIC_LEVEL * 0.5, now + 2]]);
  });

  it('fades out and lets everything go as the run starts, its loops given back', async () => {
    const page = fakeWindow();
    const { sound, audio } = await fresh();
    sound.wantMenuSound('menu');
    page.fire('pointerdown');
    await vi.advanceTimersByTimeAsync(600);
    expect(audio.inUse().loop).toBe(2);
    sound.wantMenuSound(null);
    expect(sound.menuSoundState()).toBe('off');
    await vi.advanceTimersByTimeAsync(1000);
    expect(streaming()).toHaveLength(0);
    expect(audio.inUse().loop).toBe(0);
    expect(sound.menuSoundProbe()).toMatchObject({ theme: false, hum: false });
    // Nothing tends the theme any more.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stands pulled down while the crew speaks in the lobby, and comes back after', async () => {
    const page = fakeWindow();
    const { sound, audio, mix } = await fresh();
    sound.wantMenuSound('menu');
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

  it('ticks, clacks, chimes and clicks only while it plays, a tick no oftener than 50 ms', async () => {
    const page = fakeWindow();
    const { sound } = await fresh();
    sound.wantMenuSound('menu');
    page.fire('pointerdown');
    await vi.advanceTimersByTimeAsync(600);
    sound.uiSound('select');
    sound.uiSound('back');
    sound.uiSound('opened');
    sound.uiSound('ready');
    sound.uiSound('lamp');
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
      lamp: 1,
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
    sound.wantMenuSound('menu');
    expect(bar(true)).toContain(
      `<button class="sound-toggle sound-toggle--waiting" title="${SOUND_WAITS}"`,
    );
    expect(bar(false)).toContain('<button class="sound-toggle" title="Ton ausschalten"');
  });
});
