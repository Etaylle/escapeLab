import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicSettings, SlotPicker, withPack, withPiece } from '../src/screens/MusicSettings.js';
import { SettingsPanel } from '../src/screens/Settings.js';
import { changeSettings, DEFAULT_SETTINGS, getSettings } from '../src/settings.js';
import { audioEngine, type Engine } from '../src/world/audio.js';
import { duckLevels, DUCK_DB } from '../src/world/mix.js';
import { chosenFor, installedPacks } from '../src/world/musicPacks.js';
import { MUSIC_LEVEL } from '../src/world/music.js';
import {
  previewing,
  PREVIEW_FADE_S,
  stopPreview,
  togglePreview,
} from '../src/world/musicPreview.js';
import { SLOTS, type Slot } from '../src/world/packFile.js';
import {
  downstream,
  fakeGraph,
  type FakeContext,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';
import { elements, fakeMedia } from './fakeMedia.js';
import { serveSamples } from './fakeSamples.js';
import { buttonsOf, elementsOf, press, type Rendered } from './probe.js';

/**
 * „Musik" in the settings' „Ton" (screens/MusicSettings.tsx): the packs, the Feinwahl, a piece
 * played for the ear beside each, and the Nennungen of the music in play — against the packs the
 * game ships.
 */

const noop = (): void => undefined;

beforeEach(() => {
  fakeGraph();
  fakeMedia();
  vi.useFakeTimers();
});

afterEach(() => {
  stopPreview();
  changeSettings(DEFAULT_SETTINGS);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The control among `found` whose data attribute `name` reads `value`. */
function controlOf(found: readonly Rendered[], name: string, value: string): Rendered {
  const control = found.find((element) => element.props[name] === value);
  if (control === undefined) throw new Error(`no control ${name}=${value}`);
  return control;
}

/** The Feinwahl's place `slot` as it stands with the music chosen now. */
function pickerOf(slot: Slot): Rendered[] {
  return elementsOf(() => (
    <SlotPicker slot={slot} packs={installedPacks()} chosen={getSettings().music} />
  ));
}

/** The ▶ beside the piece of the pack `pack` in the Feinwahl's place `slot`. */
function playOf(slot: Slot, pack: string): Rendered | undefined {
  const row = installedPacks().findIndex((each) => each.id === pack);
  return buttonsOf(pickerOf(slot), 'music-play')[row];
}

/** The engine the sound is made on, and its context, as the fakes made them. */
function engineNow(): { engine: Engine; ctx: FakeContext } {
  const engine = audioEngine();
  if (engine === null) throw new Error('no engine');
  return { engine, ctx: engine.ctx as unknown as FakeContext };
}

describe('the packs in „Ton"', () => {
  it('stand under the talk key by their titles, the one in force lit', () => {
    const html = renderToStaticMarkup(<SettingsPanel onClose={noop} tab="ton" />);
    expect(html).toContain('<legend>Musik</legend>');
    for (const pack of installedPacks()) expect(html).toContain(pack.title);
    expect(html).toMatch(/aria-checked="true" data-pack="nachtschicht"/);
    expect(html.indexOf('Sprechtaste')).toBeLessThan(html.indexOf('<legend>Musik</legend>'));
  });

  it('take another pack at a press, and what plays with it — the Feinwahl kept but for it', () => {
    changeSettings({
      music: { pack: 'nachtschicht', pieces: { lobby: 'yalciner', calm: 'macleod' } },
    });
    press(controlOf(elementsOf(() => <MusicSettings />), 'data-pack', 'yalciner'));
    expect(getSettings().music).toEqual({ pack: 'yalciner', pieces: { calm: 'macleod' } });
    expect(chosenFor('menu-theme').key).toBe('yalciner/menu-theme');
    expect(chosenFor('lobby').key).toBe('yalciner/lobby');
    expect(chosenFor('calm').key).toBe('macleod/calm');
    expect(withPack({ pack: 'a', pieces: { lobby: 'b' } }, 'b')).toEqual({ pack: 'b', pieces: {} });
  });
});

describe('the Feinwahl', () => {
  it('stands closed at first, and lists for a place the piece of every pack, one lit', () => {
    const toggle = buttonsOf(elementsOf(() => <MusicSettings />), 'music-fine-toggle')[0];
    expect(toggle?.props['aria-expanded']).toBe(false);
    expect(renderToStaticMarkup(<MusicSettings />)).not.toContain('data-piece=');
    const chosen = { pack: 'cheremisinov', pieces: {} };
    const html = renderToStaticMarkup(
      <SlotPicker slot="lobby" packs={installedPacks()} chosen={chosen} />,
    );
    expect(html).toContain('<legend>Lobby</legend>');
    for (const pack of installedPacks()) {
      expect(html).toContain(`data-piece="${pack.id}/lobby"`);
      expect(html).toContain(pack.pieces.lobby.title);
    }
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true" data-piece="cheremisinov\/lobby"/);
    const own = 'Way To Silence · Sergey Cheremisinov · Schicht C · Kammerklang (Paket)';
    expect(html).toContain(own);
  });

  it('plays a piece picked in its place, and the pack’s own again clears the pick', () => {
    press(controlOf(pickerOf('lobby'), 'data-piece', 'zhelanov/lobby'));
    expect(getSettings().music).toEqual({ pack: 'nachtschicht', pieces: { lobby: 'zhelanov' } });
    expect(chosenFor('lobby').key).toBe('zhelanov/lobby');
    const lit = renderToStaticMarkup(
      <SlotPicker slot="lobby" packs={installedPacks()} chosen={getSettings().music} />,
    );
    expect(lit).toMatch(/aria-checked="true" data-piece="zhelanov\/lobby"/);
    press(controlOf(pickerOf('lobby'), 'data-piece', 'nachtschicht/lobby'));
    expect(getSettings().music).toEqual({ pack: 'nachtschicht', pieces: {} });
    expect(chosenFor('lobby').key).toBe('nachtschicht/lobby');
    expect(withPiece({ pack: 'a', pieces: { calm: 'b' } }, 'calm', 'a')).toEqual({
      pack: 'a',
      pieces: {},
    });
  });
});

describe('a piece played for the ear', () => {
  it('streams beside its ▶ on the preview’s bus, the music under it 24 dB down', async () => {
    serveSamples();
    press(playOf('calm', 'yalciner'));
    expect(previewing()).toBe('yalciner/calm');
    await vi.advanceTimersByTimeAsync(20);
    const element = elements.at(-1);
    expect(element?.src).toBe('/music/packs/yalciner/calm.m4a');
    expect(element?.paused).toBe(false);
    const { engine, ctx } = engineNow();
    const media = ctx.all<FakeNode>('media').at(-1);
    const reached = media === undefined ? new Set<FakeNode>() : downstream(media);
    expect(reached.has(engine.preview as unknown as FakeNode)).toBe(true);
    expect(reached.has(engine.musicDuck as unknown as FakeNode)).toBe(false);
    ctx.currentTime += 0.1;
    const pulled = 10 ** ((DUCK_DB.music.preview ?? 0) / 20);
    expect(duckLevels(engine, ctx.currentTime).music).toBeCloseTo(pulled, 6);
    expect(playOf('calm', 'yalciner')?.props['aria-pressed']).toBe(true);
    expect(playOf('calm', 'macleod')?.props['aria-pressed']).toBe(false);
    // Pressed again, it stops, and the music comes back up.
    press(playOf('calm', 'yalciner'));
    expect(previewing()).toBeNull();
    ctx.currentTime += 1;
    expect(duckLevels(engine, ctx.currentTime).music).toBe(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(element?.src).toBe('');
  });

  it('stops for another, at its end, and as the settings close', async () => {
    serveSamples();
    press(playOf('tense', 'cheremisinov'));
    await vi.advanceTimersByTimeAsync(20);
    expect(previewing()).toBe('cheremisinov/tense');
    press(playOf('tense', 'macleod'));
    await vi.advanceTimersByTimeAsync(400);
    expect(previewing()).toBe('macleod/tense');
    const open = elements.filter((element) => element.src !== '');
    expect(open.map((element) => element.src)).toEqual(['/music/packs/macleod/tense.m4a']);
    elements.at(-1)?.fire('ended');
    expect(previewing()).toBeNull();
    press(playOf('tense', 'zhelanov'));
    await vi.advanceTimersByTimeAsync(20);
    expect(previewing()).toBe('zhelanov/tense');
    const panel = elementsOf(() => <SettingsPanel onClose={noop} tab="ton" />);
    press(buttonsOf(panel, 'link')[0]);
    expect(previewing()).toBeNull();
  });
});

describe('the Nennungen', () => {
  it('name every piece in play with its attribution, its addresses linked', () => {
    changeSettings({ music: { pack: 'macleod', pieces: { lobby: 'yalciner' } } });
    const html = renderToStaticMarkup(<MusicSettings />);
    expect(html).toContain('Nennungen');
    expect(html.match(/data-credit="/g)).toHaveLength(SLOTS.length);
    expect(html).toContain('„At Rest“ – Kevin MacLeod (incompetech.com)');
    expect(html).toContain('„One Last Try“ – İlker Yalçıner');
    expect(html).toContain(
      '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">',
    );
    // MacLeod's lobby piece is not in play: Yalçıner's stands in its place.
    expect(html).not.toContain('Water Lily');
  });
});

describe('the music’s styles', () => {
  const css = readFileSync(new URL('../src/styles/settings.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* ── Ton: the music'));

  it('read at 14 px or more, and give every press a fingertip’s 44 px', () => {
    const sizes = [...block.matchAll(/font-size: (\d+)px;/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    for (const rule of ['.music-pack', '.music-fine-toggle', '.music-piece', '.music-play']) {
      const body = block.slice(block.indexOf(`\n${rule} {`)).split('}')[0] ?? '';
      expect(body, rule).toContain('min-height: 44px;');
    }
  });
});

describe('a piece played for the ear, as the game plays it', () => {
  /** The level the stream playing `src` comes in at: its own gain, where the media meets it. */
  const levelOf = (ctx: FakeContext, src: string): FakeGain => {
    const element = elements.find((each) => each.src === src);
    const media = ctx
      .all<FakeNode & { mediaElement: unknown }>('media')
      .find((node) => node.mediaElement === element);
    return media?.outputs[0] as FakeGain;
  };

  it('plays at the stems’ level by its gain, from where its sound starts', async () => {
    serveSamples();
    const title = installedPacks().find((pack) => pack.id === 'zhelanov')?.pieces.title;
    if (title === undefined || !('startMs' in title)) throw new Error('no found title');
    togglePreview('zhelanov', 'title');
    await vi.advanceTimersByTimeAsync(0);
    const { ctx } = engineNow();
    const src = '/music/packs/zhelanov/title.m4a';
    expect(levelOf(ctx, src).gain.value).toBeCloseTo(MUSIC_LEVEL * title.gain, 9);
    expect(title.startMs).toBeGreaterThan(0);
    const element = elements.find((each) => each.src === src);
    expect(element?.currentTime).toBeCloseTo(title.startMs / 1000, 9);
  });

  it('plays the piece asked for last where two are pressed before the list is here', async () => {
    serveSamples();
    togglePreview('yalciner', 'lobby');
    togglePreview('macleod', 'lobby');
    await vi.advanceTimersByTimeAsync(20);
    expect(previewing()).toBe('macleod/lobby');
    expect(elements.map((each) => each.src)).toEqual(['/music/packs/macleod/lobby.m4a']);
  });

  it('stops where its file fails or stalls, the music let back up', async () => {
    serveSamples();
    for (const [slot, type] of [['calm', 'error'], ['tense', 'stalled']] as const) {
      togglePreview('yalciner', slot);
      await vi.advanceTimersByTimeAsync(20);
      expect(previewing()).toBe(`yalciner/${slot}`);
      elements.find((each) => each.src === `/music/packs/yalciner/${slot}.m4a`)?.fire(type);
      expect(previewing()).toBeNull();
      const { engine, ctx } = engineNow();
      ctx.currentTime += 1;
      expect(duckLevels(engine, ctx.currentTime).music).toBe(1);
    }
  });

  it('goes out over PREVIEW_FADE_S as it stops', async () => {
    serveSamples();
    togglePreview('yalciner', 'tense');
    await vi.advanceTimersByTimeAsync(20);
    const { ctx } = engineNow();
    const level = levelOf(ctx, '/music/packs/yalciner/tense.m4a');
    stopPreview();
    expect(level.gain.events.at(-1)).toEqual(['linear', 0, ctx.currentTime + PREVIEW_FADE_S]);
  });
});

describe('a piece of the score that awaits its render', () => {
  it('offers no ▶ and is named in no Nennung: what plays there is another’s', async () => {
    vi.resetModules();
    serveSamples({ lobby: { listed: false }, title: { listed: false } });
    const server = await import('react-dom/server');
    await (await import('../src/world/samples.js')).musicListed();
    const view = await import('../src/screens/MusicSettings.js');
    const { installedPacks: shipped } = await import('../src/world/musicPacks.js');
    const score = { pack: 'nachtschicht', pieces: {} };
    const lobby = server.renderToStaticMarkup(
      <view.SlotPicker slot="lobby" packs={shipped()} chosen={score} />,
    );
    expect(lobby).toContain('aria-label="Zwischenspiel anhören" disabled=""');
    expect(lobby).not.toContain('aria-label="One Last Try anhören" disabled=""');
    const block = server.renderToStaticMarkup(<view.MusicSettings />);
    expect(block.match(/data-credit="/g)).toHaveLength(SLOTS.length - 2);
    expect(block).not.toContain('Zwischenspiel');
    expect(block).not.toContain('Eröffnung');
  });
});
