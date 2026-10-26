import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fakeGraph,
  lastContext,
  type FakeContext,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';
import { loadedSamples } from './fakeSamples.js';

/** A storage that keeps what it is given, as the browser's does. */
function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string): string | null => items.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      items.set(key, value);
    },
  };
}

/** A window with `store` for its storage, asking for less motion where `reduce` says so. */
function windowWith(store: ReturnType<typeof memory>, reduce = false) {
  const matchMedia = (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    addEventListener: () => undefined,
  });
  vi.stubGlobal('window', { localStorage: store, matchMedia });
}

/** The settings and the audio modules afresh: nothing set, no engine made. */
async function fresh() {
  vi.resetModules();
  const settings = await import('../src/settings.js');
  const audio = await import('../src/world/audio.js');
  const voice = await import('../src/voice/useVoice.js');
  return { settings, audio, voice };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readSettings and writeSettings — kept on this device', () => {
  it('starts from the defaults: Funk 100, Effekte 100, Musik 70, V, Normal, System', async () => {
    const { settings } = await fresh();
    expect(settings.readSettings(memory())).toEqual({
      volumes: { radio: 100, effects: 100, music: 70 },
      talkKey: 'v',
      textSize: 'normal',
      motion: 'system',
    });
    expect(settings.readSettings(null)).toEqual(settings.DEFAULT_SETTINGS);
  });

  it('keeps what is set under its key, and reads it back', async () => {
    const { settings } = await fresh();
    const store = memory();
    const chosen = {
      volumes: { radio: 40, effects: 85, music: 0 },
      talkKey: 'g',
      textSize: 'large',
      motion: 'on',
    } as const;
    expect(settings.writeSettings(store, chosen)).toBe(true);
    expect(JSON.parse(store.items.get('escapelab.settings') ?? 'null')).toEqual(chosen);
    expect(settings.readSettings(store)).toEqual(chosen);
  });

  it('holds a volume to 0–100, and takes a setting it cannot read at its default', async () => {
    const { settings } = await fresh();
    const odd = {
      volumes: { radio: 140, effects: -5.4, music: 'laut' },
      talkKey: 'w',
      textSize: 'riesig',
      motion: 'vielleicht',
    };
    const store = memory({ 'escapelab.settings': JSON.stringify(odd) });
    expect(settings.readSettings(store)).toEqual({
      volumes: { radio: 100, effects: 0, music: 70 },
      talkKey: 'v',
      textSize: 'normal',
      motion: 'system',
    });
    const rounded = memory({ 'escapelab.settings': '{"volumes":{"music":33.6},"talkKey":"F4"}' });
    expect(settings.readSettings(rounded)).toMatchObject({
      volumes: { music: 34 },
      talkKey: 'f4',
    });
  });

  it('reads what is no JSON as nothing set, and says so', async () => {
    const { settings } = await fresh();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(settings.readSettings(memory({ 'escapelab.settings': 'kaputt{' }))).toEqual(
      settings.DEFAULT_SETTINGS,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(settings.readSettings(memory({ 'escapelab.settings': '[1, 2]' }))).toEqual(
      settings.DEFAULT_SETTINGS,
    );
  });

  it('starts from the defaults where the browser refuses storage, and keeps nothing', async () => {
    const { settings } = await fresh();
    const refusing = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('full');
      },
    };
    expect(settings.readSettings(refusing)).toEqual(settings.DEFAULT_SETTINGS);
    expect(settings.writeSettings(refusing, settings.DEFAULT_SETTINGS)).toBe(false);
    expect(settings.writeSettings(null, settings.DEFAULT_SETTINGS)).toBe(false);
  });

  it('comes back as the page starts, and a change is kept at once', async () => {
    const store = memory({ 'escapelab.settings': '{"talkKey":"b","textSize":"small"}' });
    windowWith(store);
    const { settings } = await fresh();
    settings.startSettings();
    expect(settings.getSettings()).toMatchObject({ talkKey: 'b', textSize: 'small' });
    settings.changeSettings({ motion: 'off' });
    expect(JSON.parse(store.items.get('escapelab.settings') ?? '{}')).toMatchObject({
      talkKey: 'b',
      textSize: 'small',
      motion: 'off',
    });
  });
});

describe('the talk key', () => {
  const key = (name: string, parts: Partial<KeyboardEvent> = {}) => ({
    key: name,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    ...parts,
  });

  it('takes a letter, a digit past the chat’s, F1–F12, refuses what the game holds', async () => {
    const { settings } = await fresh();
    for (const ok of ['v', 'G', 'ö', '9', '0', 'F2', 'f12', 'x']) {
      expect(settings.talkKeyVerdict(ok), ok).toBe('ok');
    }
    for (const taken of ['w', 'A', 'ArrowUp', 'Shift', 'e', ' ', 'Enter', 'q', 'm', 'c', 'i']) {
      expect(settings.talkKeyVerdict(taken), taken).toBe('taken');
    }
    for (const taken of ['h', '?', 'n', 'Escape', 'Tab', '1', '8']) {
      expect(settings.talkKeyVerdict(taken), taken).toBe('taken');
    }
    for (const unfit of ['Control', 'Alt', 'Meta', 'PageUp', 'F13', 'Dead']) {
      expect(settings.talkKeyVerdict(unfit), unfit).toBe('unfit');
    }
    expect(['v', 'f2', 'ö'].map(settings.keyName)).toEqual(['V', 'F2', 'Ö']);
  });

  it('talks on the key the settings name, and no longer on V once rebound', async () => {
    windowWith(memory());
    const { settings, voice } = await fresh();
    const talkKey = (): string => settings.getSettings().talkKey;
    expect(voice.talksOnDown(key('V'), talkKey(), false)).toBe(true);
    settings.changeSettings({ talkKey: 'g' });
    expect(voice.talksOnDown(key('v'), talkKey(), false)).toBe(false);
    expect(voice.talksOnDown(key('g'), talkKey(), false)).toBe(true);
    expect(voice.talksOnDown(key('G'), talkKey(), false)).toBe(true);
    expect(voice.stopsOnUp(key('g'), talkKey())).toBe(true);
    expect(voice.stopsOnUp(key('v'), talkKey())).toBe(false);
  });

  it('talks on nothing while typing or rebinding, with a modifier, or on auto-repeat', async () => {
    const { settings, voice } = await fresh();
    expect(settings.isRebinding()).toBe(false);
    settings.setRebinding(true);
    expect(settings.isRebinding()).toBe(true);
    expect(voice.talksOnDown(key('v'), 'v', true)).toBe(false);
    for (const held of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { repeat: true }]) {
      expect(voice.talksOnDown(key('v', held), 'v', false)).toBe(false);
    }
    // Let go however it comes up: a modifier pressed meanwhile keeps nobody talking.
    expect(voice.stopsOnUp(key('V'), 'v')).toBe(true);
  });
});

/** The engine's buses by their place in the graph. */
function busesOf(ctx: FakeContext) {
  const gains = ctx.all<FakeGain>('gain');
  const into = (target: FakeNode | undefined): FakeGain[] =>
    gains.filter((g) => target !== undefined && g.outputs.includes(target));
  const [master] = into(ctx.destination);
  const [duck, effects, radio] = into(master);
  const [beds, music] = into(duck);
  return { master, duck, effects, radio, beds, music, into };
}

/** The value last aimed at on a bus, or its value where nothing was scheduled. */
const aimedAt = (bus: FakeGain | undefined): number | undefined => {
  const last = bus?.gain.events.at(-1);
  return last?.[0] === 'target' ? last[1] : bus?.gain.value;
};

describe('the volumes on the audio’s buses', () => {
  it('sets each bus as a share of full — the effects on the beds too', async () => {
    fakeGraph();
    const { settings, audio } = await fresh();
    audio.audioEngine();
    settings.applyVolumes({ radio: 50, effects: 20, music: 0 });
    const buses = busesOf(lastContext());
    expect(aimedAt(buses.radio)).toBe(0.5);
    expect(aimedAt(buses.effects)).toBe(0.2);
    expect(aimedAt(buses.beds)).toBe(0.2);
    expect(aimedAt(buses.music)).toBe(0);
    // The sound switch keeps the master gain: no volume touches it.
    expect(buses.master?.gain.events).toEqual([]);
    expect(audio.effectsVolume()).toBe(0.2);
  });

  it('builds an engine made later at the volumes already set', async () => {
    fakeGraph();
    const { settings, audio } = await fresh();
    settings.applyVolumes(settings.DEFAULT_SETTINGS.volumes);
    audio.audioEngine();
    const buses = busesOf(lastContext());
    expect(buses.radio?.gain.value).toBe(1);
    expect(buses.effects?.gain.value).toBe(1);
    expect(buses.beds?.gain.value).toBe(1);
    expect(buses.music?.gain.value).toBe(0.7);
  });

  it('plays a step through the effects’ bus and the chirp through the radio’s', async () => {
    fakeGraph();
    const { audio } = await fresh();
    await loadedSamples();
    audio.footstep();
    const stepped = busesOf(lastContext());
    expect(stepped.into(stepped.effects)).toHaveLength(1);
    expect(stepped.into(stepped.radio)).toHaveLength(0);
    audio.radioChirp();
    const chirped = busesOf(lastContext());
    expect(chirped.into(chirped.radio)).toHaveLength(1);
    expect(chirped.into(chirped.effects)).toHaveLength(1);
  });

  it('lands a sprinted step a little louder than a walked one', async () => {
    fakeGraph();
    const { audio } = await fresh();
    await loadedSamples();
    audio.footstep(false);
    audio.footstep(true);
    const [walked, sprinted] = busesOf(lastContext()).into(busesOf(lastContext()).effects);
    expect(sprinted?.gain.value).toBeCloseTo((walked?.gain.value ?? 0) * audio.SPRINT_STEP_GAIN, 9);
    expect(audio.SPRINT_STEP_GAIN).toBeGreaterThan(1);
    expect(audio.SPRINT_STEP_GAIN).toBeLessThan(1.5);
  });
});

/** A page root that keeps what the settings set on it. */
function root() {
  const properties = new Map<string, string>();
  return {
    properties,
    style: { setProperty: (name: string, value: string) => properties.set(name, value) },
    dataset: {} as DOMStringMap,
  };
}

describe('the look on the page’s root', () => {
  it('sets the text’s scale as --text-scale: Klein 0.9, Normal 1, Groß 1.15', async () => {
    const { settings } = await fresh();
    const scales = (['small', 'normal', 'large'] as const).map((textSize) => {
      const page = root();
      settings.applyLook({ ...settings.DEFAULT_SETTINGS, textSize }, page, false);
      return page.properties.get('--text-scale');
    });
    expect(scales).toEqual(['0.9', '1', '1.15']);
  });

  it('marks the motion reduce or full: An always, Aus never, System as asked', async () => {
    const { settings } = await fresh();
    const motionOf = (motion: 'off' | 'on' | 'system', system: boolean) => {
      const page = root();
      settings.applyLook({ ...settings.DEFAULT_SETTINGS, motion }, page, system);
      return page.dataset['motion'];
    };
    expect([motionOf('on', false), motionOf('on', true)]).toEqual(['reduce', 'reduce']);
    expect([motionOf('off', false), motionOf('off', true)]).toEqual(['full', 'full']);
    expect([motionOf('system', false), motionOf('system', true)]).toEqual(['full', 'reduce']);
  });

  it('lets the settings overrule the browser wherever motion is asked after', async () => {
    windowWith(memory(), true);
    const { settings } = await fresh();
    expect(settings.reducedMotion()).toBe(true);
    settings.changeSettings({ motion: 'off' });
    expect(settings.reducedMotion()).toBe(false);
    windowWith(memory(), false);
    settings.changeSettings({ motion: 'on' });
    expect(settings.reducedMotion()).toBe(true);
  });
});

describe('the stylesheets under the settings', () => {
  const SRC = new URL('../src/', import.meta.url);
  const read = (path: string): string =>
    readFileSync(new URL(path, SRC), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const DEVICE_SHEETS = [
    'styles/devices.css',
    'styles/servers.css',
    ...readdirSync(new URL('puzzles/', SRC))
      .filter((name) => name.endsWith('.css'))
      .map((name) => `puzzles/${name}`),
  ];

  it('start every text at the normal size: --text-scale is 1 on the root', () => {
    expect(read('ui.css')).toMatch(/:root \{[^}]*--text-scale: 1;/);
  });

  it('size every device’s text by the scale, and the book’s pages and the notepad’s', () => {
    for (const sheet of DEVICE_SHEETS) {
      const sizes = [...read(sheet).matchAll(/font-size:\s*([^;]+);/g)].map(([, v]) => v);
      expect(sizes.length, sheet).toBeGreaterThan(0);
      for (const size of sizes) {
        expect(size, `${sheet}: ${size}`).toMatch(/var\(--text-scale\)/);
      }
    }
    const page = /\.page-in \{[^}]*font-size: calc\(100cqw \/ 30 \* var\(--text-scale\)\);/;
    expect(read('styles/book.css')).toMatch(page);
    const pad = /\.notepad-text \{[^}]*--rule: calc\(24px \* var\(--text-scale\)\);/;
    expect(read('ui.css')).toMatch(pad);
  });

  it('size the HUD’s goal, clock, banner and crew strip by it', () => {
    const ui = read('ui.css');
    const hud = ['.stage-goal h1', '.stage-top .countdown', '.radio-banner', '.hud-crew li'];
    for (const selector of hud) {
      const rule = new RegExp(`\\n${selector.replace(/\./g, '\\.')} \\{[^}]*font-size: calc\\(`);
      expect(ui, selector).toMatch(rule);
    }
  });

  it('hang every calmer rule on the root’s motion, none on the browser’s query alone', () => {
    const sheets = ['ui.css', ...DEVICE_SHEETS, 'styles/book.css', 'styles/finale.css'];
    for (const sheet of sheets) {
      expect(read(sheet), sheet).not.toMatch(/prefers-reduced-motion/);
    }
    expect(read('styles/finale.css')).toMatch(/:where\(\[data-motion='reduce'\]\) \{/);
  });
});
