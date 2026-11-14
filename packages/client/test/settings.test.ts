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
import { DEFAULT_KEYS, DEFAULT_PAD } from '../src/input/bindings.js';

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
  it('starts from the defaults: every bus full but the music, V, Normal, System', async () => {
    const { settings } = await fresh();
    expect(settings.readSettings(memory())).toEqual({
      volumes: { master: 100, music: 70, effects: 100, voice: 100, ambience: 100 },
      muted: { music: false, effects: false, voice: false, ambience: false },
      keys: DEFAULT_KEYS,
      pad: DEFAULT_PAD,
      deadzone: 20,
      glyphs: 'auto',
      textSize: 'normal',
      motion: 'system',
      light: 'auto',
      patterns: false,
      subtitles: 'normal',
    });
    expect(settings.readSettings(null)).toEqual(settings.DEFAULT_SETTINGS);
  });

  it('keeps what is set under its key, and reads it back', async () => {
    const { settings } = await fresh();
    const store = memory();
    const chosen = {
      volumes: { master: 80, music: 0, effects: 85, voice: 40, ambience: 55 },
      muted: { music: true, effects: false, voice: false, ambience: true },
      keys: { ...DEFAULT_KEYS, talk: 'g', interact: 'f' },
      pad: { interact: 'b', drop: 'a', notes: 'x', minimap: 'r2' },
      deadzone: 35,
      glyphs: 'playstation',
      textSize: 'large',
      motion: 'on',
      light: 'canvas',
      patterns: true,
      subtitles: 'larger',
    } as const;
    expect(settings.writeSettings(store, chosen)).toBe(true);
    expect(JSON.parse(store.items.get('escapelab.settings') ?? 'null')).toEqual(chosen);
    expect(settings.readSettings(store)).toEqual(chosen);
  });

  it('holds a volume to 0–100, and takes a setting it cannot read at its default', async () => {
    const { settings } = await fresh();
    const odd = {
      volumes: { master: 140, effects: -5.4, music: 'laut' },
      muted: { music: 'ja', voice: 1 },
      // Two actions on one key, a key the game keeps, a button that is none.
      keys: { talk: 'w', info: 'escape' },
      pad: { notes: 'a', minimap: 'start' },
      deadzone: 90,
      glyphs: 'sega',
      textSize: 'riesig',
      motion: 'vielleicht',
      light: 'laser',
      patterns: 'gern',
      subtitles: 'riesig',
    };
    const store = memory({ 'escapelab.settings': JSON.stringify(odd) });
    expect(settings.readSettings(store)).toEqual({
      ...settings.DEFAULT_SETTINGS,
      volumes: { master: 100, music: 70, effects: 0, voice: 100, ambience: 0 },
      deadzone: 40,
    });
    const rounded = memory({
      'escapelab.settings': '{"volumes":{"music":33.6},"keys":{"talk":"F4"}}',
    });
    expect(settings.readSettings(rounded)).toMatchObject({
      volumes: { music: 34 },
      keys: { talk: 'f4', interact: 'e' },
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
    const store = memory({ 'escapelab.settings': '{"keys":{"talk":"b"},"textSize":"small"}' });
    windowWith(store);
    const { settings } = await fresh();
    settings.startSettings();
    expect(settings.getSettings()).toMatchObject({ keys: { talk: 'b' }, textSize: 'small' });
    settings.changeSettings({ motion: 'off' });
    expect(JSON.parse(store.items.get('escapelab.settings') ?? '{}')).toMatchObject({
      keys: { talk: 'b' },
      textSize: 'small',
      motion: 'off',
    });
  });
});

describe('settings kept before every bus had a volume', () => {
  it('give the radio’s volume to the voice’s bus, and the effects’ to the beds too', async () => {
    const { settings } = await fresh();
    const kept = { volumes: { radio: 35, effects: 60, music: 20 } };
    const store = memory({ 'escapelab.settings': JSON.stringify(kept) });
    expect(settings.readSettings(store).volumes).toEqual({
      master: 100,
      music: 20,
      effects: 60,
      voice: 35,
      ambience: 60,
    });
  });
});

describe('settings kept before every action had its key', () => {
  it('keep the talk key they named, the other keys at their defaults', async () => {
    windowWith(memory({ 'escapelab.settings': '{"talkKey":"b","motion":"off"}' }));
    const { settings } = await fresh();
    settings.startSettings();
    expect(settings.getSettings().keys).toEqual({ ...DEFAULT_KEYS, talk: 'b' });
    expect(settings.getSettings().motion).toBe('off');
  });

  it('give way to the keys kept since', async () => {
    const kept = JSON.stringify({ keys: { ...DEFAULT_KEYS, talk: 'g' }, talkKey: 'b' });
    windowWith(memory({ 'escapelab.settings': kept }));
    const { settings } = await fresh();
    settings.startSettings();
    expect(settings.getSettings().keys.talk).toBe('g');
  });
});

describe('the talk key', () => {
  /** A key as a keyboard sends it: a letter sits at Key<letter>, whatever case it comes in. */
  const key = (name: string, parts: Partial<KeyboardEvent> = {}) => ({
    key: name,
    code: `Key${name.toUpperCase()}`,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    ...parts,
  });

  it('talks on the key the settings name, and no longer on V once rebound', async () => {
    windowWith(memory());
    const { settings, voice } = await fresh();
    const talkKey = (): string => settings.getSettings().keys.talk;
    expect(voice.talksOnDown(key('V'), talkKey(), false)).toBe(true);
    settings.changeSettings({ keys: { ...DEFAULT_KEYS, talk: 'g' } });
    expect(voice.talksOnDown(key('v'), talkKey(), false)).toBe(false);
    expect(voice.talksOnDown(key('g'), talkKey(), false)).toBe(true);
    expect(voice.talksOnDown(key('G'), talkKey(), false)).toBe(true);
    // Talking stops at the key that started it, by where it sits.
    expect(voice.stopsOnUp(key('g'), 'KeyG')).toBe(true);
    expect(voice.stopsOnUp(key('v'), 'KeyG')).toBe(false);
    expect(voice.stopsOnUp(key('g'), null)).toBe(false);
  });

  it('stops talking at the key held, whatever Shift or a rebinding made of its name', async () => {
    const { settings, voice } = await fresh();
    settings.changeSettings({ keys: { ...DEFAULT_KEYS, talk: '9' } });
    const nine = key('9', { code: 'Digit9' });
    expect(voice.talksOnDown(nine, settings.getSettings().keys.talk, false)).toBe(true);
    // Shift went down meanwhile: the 9 comes up as „)".
    expect(voice.stopsOnUp(key(')', { code: 'Digit9' }), 'Digit9')).toBe(true);
    settings.changeSettings({ keys: { ...DEFAULT_KEYS, talk: 'g' } });
    expect(voice.stopsOnUp(nine, 'Digit9')).toBe(true);
    // A key a controller sends sits nowhere: it goes by its name.
    expect(voice.stopsOnUp({ key: 'v', code: '' }, 'key:v')).toBe(true);
  });

  it('talks on nothing while typing or rebinding, with a modifier, or on auto-repeat', async () => {
    const { settings, voice } = await fresh();
    expect(settings.isRebinding()).toBe(false);
    // The keys' table and the controller's wait each on their own: one ending ends not both.
    const endKeys = settings.startRebinding();
    const endPad = settings.startRebinding();
    endKeys();
    endKeys();
    expect(settings.isRebinding()).toBe(true);
    endPad();
    expect(settings.isRebinding()).toBe(false);
    settings.startRebinding();
    expect(settings.isRebinding()).toBe(true);
    expect(voice.talksOnDown(key('v'), 'v', true)).toBe(false);
    for (const held of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { repeat: true }]) {
      expect(voice.talksOnDown(key('v', held), 'v', false)).toBe(false);
    }
    // Let go however it comes up: a modifier pressed meanwhile keeps nobody talking.
    expect(voice.stopsOnUp(key('V', { shiftKey: true }), 'KeyV')).toBe(true);
  });
});

/** The engine's buses by their names in the mix (mix.ts), and what feeds a node. */
function busesOf(engine: unknown, ctx: FakeContext) {
  type Bus = 'master' | 'sfx' | 'ambience' | 'music' | 'voice' | 'announce';
  const buses = engine as Record<Bus, FakeGain>;
  const into = (target: FakeNode | undefined): FakeGain[] =>
    ctx.all<FakeGain>('gain').filter((g) => target !== undefined && g.outputs.includes(target));
  return { ...buses, into };
}

/** The value last aimed at on a bus, or its value where nothing was scheduled. */
const aimedAt = (bus: FakeGain | undefined): number | undefined => {
  const last = bus?.gain.events.at(-1);
  return last?.[0] === 'target' ? last[1] : bus?.gain.value;
};

describe('the volumes on the audio’s buses', () => {
  it('sets each bus as a share of full, the whole lab’s at the master', async () => {
    fakeGraph();
    const { settings, audio } = await fresh();
    const engine = audio.audioEngine();
    settings.applyVolumes({ master: 60, music: 0, effects: 20, voice: 50, ambience: 30 });
    const buses = busesOf(engine, lastContext());
    expect(aimedAt(buses.voice)).toBe(0.5);
    expect(aimedAt(buses.announce)).toBe(0.5);
    expect(aimedAt(buses.sfx)).toBe(0.2);
    expect(aimedAt(buses.ambience)).toBe(0.3);
    expect(aimedAt(buses.music)).toBe(0);
    expect(aimedAt(buses.master)).toBe(0.6);
    // The sound switch mutes the master, whatever its volume; on again, the volume holds.
    audio.setMuted(true);
    expect(aimedAt(buses.master)).toBe(0);
    audio.setMuted(false);
    expect(aimedAt(buses.master)).toBe(0.6);
  });

  it('builds an engine made later at the volumes already set', async () => {
    fakeGraph();
    const { settings, audio } = await fresh();
    settings.applyVolumes(settings.DEFAULT_SETTINGS.volumes);
    const buses = busesOf(audio.audioEngine(), lastContext());
    expect(buses.voice.gain.value).toBe(1);
    expect(buses.sfx.gain.value).toBe(1);
    expect(buses.ambience.gain.value).toBe(1);
    expect(buses.music.gain.value).toBe(0.7);
    expect(buses.master.gain.value).toBe(1);
  });

  it('plays a step through the effects’ bus and the chirp through the radio’s', async () => {
    fakeGraph();
    const { audio } = await fresh();
    await loadedSamples();
    audio.footstep();
    const buses = busesOf(audio.audioEngine(), lastContext());
    expect(buses.into(buses.sfx)).toHaveLength(1);
    expect(buses.into(buses.voice)).toHaveLength(0);
    audio.radioChirp();
    expect(buses.into(buses.voice)).toHaveLength(1);
    expect(buses.into(buses.sfx)).toHaveLength(1);
  });

  it('lands a sprinted step a little louder than a walked one', async () => {
    fakeGraph();
    const { audio } = await fresh();
    await loadedSamples();
    audio.footstep(false);
    audio.footstep(true);
    const buses = busesOf(audio.audioEngine(), lastContext());
    const [walked, sprinted] = buses.into(buses.sfx);
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

  it('sets the spoken lines’ scale and the colour patterns on the root', async () => {
    const { settings } = await fresh();
    const looks = (['normal', 'large', 'larger'] as const).map((subtitles) => {
      const page = root();
      settings.applyLook({ ...settings.DEFAULT_SETTINGS, subtitles, patterns: true }, page, false);
      return [page.properties.get('--subtitle-scale'), page.dataset['patterns']];
    });
    expect(looks).toEqual([
      ['1', 'on'],
      ['1.25', 'on'],
      ['1.5', 'on'],
    ]);
    const plain = root();
    settings.applyLook(settings.DEFAULT_SETTINGS, plain, false);
    expect(plain.dataset['patterns']).toBe('off');
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

/** A window whose motion query the test answers, and which counts how often it is made. */
function windowAsking() {
  const made: string[] = [];
  const heard = new Set<(e: { matches: boolean }) => void>();
  const query = {
    matches: false,
    addEventListener: (_: string, listener: (e: { matches: boolean }) => void) => heard.add(listener),
    removeEventListener: (_: string, listener: (e: { matches: boolean }) => void) =>
      heard.delete(listener),
  };
  const matchMedia = (asked: string) => {
    made.push(asked);
    return query;
  };
  vi.stubGlobal('window', { localStorage: memory(), matchMedia });
  return {
    made,
    /** The browser comes to ask for less motion, or no longer. */
    turn: (matches: boolean) => {
      query.matches = matches;
      heard.forEach((listener) => listener({ matches }));
    },
  };
}

describe('the browser’s ask for less motion', () => {
  it('is asked once a page, and followed as it changes', async () => {
    const page = windowAsking();
    const { settings } = await fresh();
    for (let frame = 0; frame < 5; frame += 1) {
      expect(settings.reducedMotion()).toBe(false);
    }
    page.turn(true);
    expect(settings.reducedMotion()).toBe(true);
    expect(page.made).toEqual(['(prefers-reduced-motion: reduce)']);
  });

  it('tells whoever watches the motion of each change, the settings’ and the browser’s', async () => {
    const page = windowAsking();
    const { settings } = await fresh();
    let told = 0;
    const stop = settings.watchMotion(() => {
      told += 1;
    });
    settings.changeSettings({ motion: 'on' });
    page.turn(true);
    expect(told).toBe(2);
    stop();
    settings.changeSettings({ motion: 'off' });
    page.turn(false);
    expect(told).toBe(2);
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
    const page = /\.page-in \{[^}]*font-size: calc\(var\(--sheet-em\) \* var\(--text-scale\)\);/;
    expect(read('styles/book.css')).toMatch(page);
    const pad = /\n\.notepad \{[^}]*--rule: calc\(28px \* var\(--text-scale\)\);/;
    expect(read('styles/notepad.css')).toMatch(pad);
  });

  it('set the HUD’s smallest words at 12 px or more: the chip’s heads, ALARME, unterwegs', () => {
    const smallest: [string, string][] = [
      ['ui.css', '.edgework-label'],
      ['styles/ux2.css', '.alarm-marks-label'],
      ['ui.css', '.hud-idle'],
    ];
    for (const [sheet, selector] of smallest) {
      const opens = new RegExp(`\\n${selector.replace(/\./g, '\\.')} \\{([^}]*)\\}`);
      const rule = opens.exec(read(sheet))?.[1] ?? '';
      const px = /font-size: calc\((\d+(?:\.\d+)?)px \* var\(--text-scale\)\);/.exec(rule);
      expect(Number(px?.[1]), selector).toBeGreaterThanOrEqual(12);
    }
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
