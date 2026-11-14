import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountView } from '@escapelab/core';
import { TopBar } from '../src/App.js';
import { DEFAULT_KEYS, DEFAULT_PAD } from '../src/input/bindings.js';
import { controlsOf } from '../src/screens/InfoPanel.js';
import {
  resetOf,
  resetTab,
  SettingsPanel,
  tabsOf,
  tabStep,
  type SettingsTab,
} from '../src/screens/Settings.js';
import { SoundSwitch } from '../src/screens/SoundSwitch.js';
import { changeSettings, DEFAULT_SETTINGS, getSettings, type Settings } from '../src/settings.js';
import { isMuted, setMuted } from '../src/world/audio.js';
import { buttonsOf, elementsOf, press, type Rendered } from './probe.js';

const noop = (): void => undefined;

afterEach(() => {
  changeSettings(DEFAULT_SETTINGS);
  setMuted(false);
  vi.unstubAllGlobals();
});

/** An option lit, and its text; an option the browser cannot take stands disabled. */
const LIT = /aria-checked="true"(?: disabled="")? class="settings-option settings-option--on">([^<]+)</g;
/** A volume's row: its name, and its slider's value. */
const SLIDER = /<span class="settings-label">([^<]+)<\/span><input type="range"[^>]*value="(\d+)"/g;
/** A tab of the bar: its id, and whether it is the one open. */
const TAB = /data-tab="(\w+)" aria-selected="(true|false)"/g;
/** A bus's mute: whether it holds the bus silent, and the bus's name. */
const MUTE = /class="settings-mute" aria-pressed="(true|false)" aria-label="([^"]+) stumm"/g;

/** The texts of the options lit in `html`, in order. */
const lit = (html: string): string[] => [...html.matchAll(LIT)].map((m) => m[1] ?? '');
/** The sliders in `html` as „Name value". */
const sliders = (html: string): string[] =>
  [...html.matchAll(SLIDER)].map((m) => `${m[1]} ${m[2]}`);
/** The tabs in `html`, the open one marked with a star. */
const tabs = (html: string): string[] =>
  [...html.matchAll(TAB)].map((m) => `${m[1]}${m[2] === 'true' ? '*' : ''}`);

/** An account, as the server tells it. */
const ANNA: AccountView = {
  name: 'Anna',
  color: '#2dd4bf',
  since: Date.UTC(2026, 9, 1),
  runs: 3,
  achievements: {},
  store: 'database',
};

/** The panel open on `tab`, as markup: with the pass's account where `account` is given. */
function panel(tab: SettingsTab, account?: AccountView): string {
  const own = account === undefined ? {} : { account, onDeleteAccount: noop };
  return renderToStaticMarkup(<SettingsPanel onClose={noop} tab={tab} {...own} />);
}

/** Everything the panel opened on `tab` comes to, for a test to press its controls. */
const controls = (tab?: SettingsTab): Rendered[] =>
  elementsOf(() => <SettingsPanel onClose={noop} {...(tab === undefined ? {} : { tab })} />);

/** The tab button `id` among `elements`. */
function tabButton(elements: readonly Rendered[], id: SettingsTab): Rendered {
  const found = elements.find((el) => el.props['data-tab'] === id);
  if (found === undefined) {
    throw new Error(`no tab ${id}`);
  }
  return found;
}

describe('the settings panel', () => {
  it('stands in tabs: Ton, Bild, Steuerung, Zugang — and Konto with the pass’s account', () => {
    const html = panel('ton');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('<h2 class="settings-title">Einstellungen</h2>');
    expect(html).toContain('Schließen [Esc]');
    expect(html).toContain('role="tablist"');
    expect(tabs(html)).toEqual(['ton*', 'bild', 'steuerung', 'zugang']);
    expect(tabs(panel('konto', ANNA))).toEqual(['ton', 'bild', 'steuerung', 'zugang', 'konto*']);
    expect(tabsOf(false)).toEqual(['ton', 'bild', 'steuerung', 'zugang']);
    // Only the open tab is on the Tab key's way; the arrows step along the bar.
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('>Zurücksetzen</button>');
  });

  it('holds in „Ton" the whole lab’s volume and each bus’s, a mute each, and the talk key', () => {
    const html = panel('ton');
    expect(sliders(html)).toEqual([
      'Gesamt 100',
      'Musik 70',
      'Effekte 100',
      'Funk 100',
      'Umgebung 100',
    ]);
    expect([...html.matchAll(MUTE)].map((m) => `${m[2]} ${m[1]}`)).toEqual([
      'Gesamt false',
      'Musik false',
      'Effekte false',
      'Funk false',
      'Umgebung false',
    ]);
    expect(html).toContain('<legend>Sprechtaste</legend>');
    expect(html).toContain('<kbd class="settings-kbd">V</kbd>');
    expect(html.match(/class="settings-kbd"/g)).toHaveLength(1);
  });

  it('holds in „Bild" the text, the motion, the light and the full screen', () => {
    const html = panel('bild');
    for (const legend of ['Textgröße', 'Weniger Bewegung', 'Licht', 'Vollbild']) {
      expect(html).toContain(`<legend>${legend}</legend>`);
    }
    for (const option of ['Klein', 'Normal', 'Groß', 'Aus', 'An', 'System', 'Einfach']) {
      expect(html).toContain(`>${option}</button>`);
    }
    // Where the browser cannot fill the screen, „Vollbild" stands, and takes no press.
    expect(lit(html)).toEqual(['Normal', 'System', 'Automatisch', 'Aus']);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it('holds in „Steuerung" the keys, the controller, its symbols and the dead zone', () => {
    const html = panel('steuerung');
    for (const legend of ['Tastenbelegung', 'Controller', 'Controller-Symbole']) {
      expect(html).toContain(`<legend>${legend}</legend>`);
    }
    expect(html.match(/class="settings-kbd"/g)).toHaveLength(12);
    expect(lit(html)).toEqual(['Automatisch']);
    expect(sliders(html)).toEqual(['Stick-Totzone 20']);
    // A touch screen keeps its buttons; the game's own keys keep their task.
    expect(html).toContain('Touch-Geräte behalten ihre Knöpfe.');
    expect(html).toContain('↑ ↓ ← →, Enter, Leertaste, Esc behalten ihre Aufgabe');
  });

  it('holds in „Zugang" the colour patterns and the spoken lines’ size, saying what they do', () => {
    const html = panel('zugang');
    expect(lit(html)).toEqual(['Aus', 'Normal']);
    expect(html).toContain('Die Punkte neben den Namen tragen je Farbe ein Zeichen.');
    expect(html).toContain('Die Zeilen von Funk und Durchsagen; auf dem Handy behalten sie');
  });

  it('holds in „Konto" the name, the colour and the account — and nothing to put back', () => {
    const html = panel('konto', ANNA);
    expect(html).toContain('value="Anna"');
    expect(html).toContain('Türkis · gewählt in der Lobby');
    expect(html).toContain('Konto · 3 Einsätze');
    expect(html).toContain('>Konto löschen</button>');
    expect(html).not.toContain('Zurücksetzen');
  });

  it('shows what is set, each in its tab', () => {
    changeSettings({
      volumes: { master: 80, music: 90, effects: 0, voice: 35, ambience: 55 },
      muted: { music: true, effects: false, voice: false, ambience: false },
      keys: { ...DEFAULT_KEYS, talk: 'g' },
      textSize: 'large',
      motion: 'on',
      light: 'canvas',
      glyphs: 'playstation',
      deadzone: 35,
      patterns: true,
      subtitles: 'larger',
    });
    setMuted(true);
    const sound = panel('ton');
    expect(sliders(sound)).toEqual([
      'Gesamt 80',
      'Musik 90',
      'Effekte 0',
      'Funk 35',
      'Umgebung 55',
    ]);
    expect([...sound.matchAll(MUTE)].map((m) => m[1])).toEqual([
      'true',
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(sound).toContain('<kbd class="settings-kbd">G</kbd>');
    expect(lit(panel('bild'))).toEqual(['Groß', 'An', 'Einfach', 'Aus']);
    const steering = panel('steuerung');
    expect(lit(steering)).toEqual(['PlayStation']);
    expect(sliders(steering)).toEqual(['Stick-Totzone 35']);
    expect(lit(panel('zugang'))).toEqual(['An', 'Sehr groß']);
  });
});

describe('the tab bar', () => {
  it('steps along by the arrows, round at the ends, and to an end by Home and End', () => {
    expect(tabStep(0, 'ArrowRight', 5)).toBe(1);
    expect(tabStep(4, 'ArrowRight', 5)).toBe(0);
    expect(tabStep(0, 'ArrowLeft', 4)).toBe(3);
    expect(tabStep(2, 'ArrowLeft', 4)).toBe(1);
    expect(tabStep(3, 'Home', 4)).toBe(0);
    expect(tabStep(0, 'End', 5)).toBe(4);
    expect(tabStep(1, 'ArrowDown', 5)).toBeNull();
    expect(tabStep(1, 'Enter', 5)).toBeNull();
  });

  it('opens a tab the focus comes to — as a controller’s D-pad brings it — and again next time', () => {
    const elements = controls('ton');
    (tabButton(elements, 'steuerung').props['onFocus'] as () => void)();
    expect(tabs(renderToStaticMarkup(<SettingsPanel onClose={noop} />))).toEqual([
      'ton',
      'bild',
      'steuerung*',
      'zugang',
    ]);
    press(tabButton(controls(), 'zugang'));
    expect(tabs(renderToStaticMarkup(<SettingsPanel onClose={noop} />))).toContain('zugang*');
  });

  it('opens on „Ton" where the tab opened last is not there: „Konto" without an account', () => {
    const own = elementsOf(() => (
      <SettingsPanel onClose={noop} account={ANNA} onDeleteAccount={noop} tab="ton" />
    ));
    press(tabButton(own, 'konto'));
    expect(tabs(renderToStaticMarkup(<SettingsPanel onClose={noop} />))).toEqual([
      'ton*',
      'bild',
      'steuerung',
      'zugang',
    ]);
  });
});

/** Every setting moved off its default. */
const MOVED: Settings = {
  volumes: { master: 40, music: 10, effects: 20, voice: 30, ambience: 50 },
  muted: { music: true, effects: true, voice: true, ambience: true },
  keys: { ...DEFAULT_KEYS, talk: 'g', interact: 'f' },
  pad: { ...DEFAULT_PAD, notes: 'r2', minimap: 'x' },
  deadzone: 35,
  glyphs: 'playstation',
  textSize: 'large',
  motion: 'on',
  light: 'canvas',
  patterns: true,
  subtitles: 'larger',
};

describe('„Zurücksetzen", a tab at a time', () => {
  it('puts back the volumes, the mutes and the talk key in „Ton" — and the sound switch on', () => {
    changeSettings(MOVED);
    setMuted(true);
    resetTab('ton');
    expect(getSettings()).toEqual({
      ...MOVED,
      volumes: DEFAULT_SETTINGS.volumes,
      muted: DEFAULT_SETTINGS.muted,
      keys: { ...MOVED.keys, talk: 'v' },
    });
    expect(isMuted()).toBe(false);
  });

  it('leaves the talk key where another action holds V meanwhile', () => {
    const keys = { ...DEFAULT_KEYS, talk: 'g', notes: 'v' };
    expect(resetOf('ton', { ...MOVED, keys }).keys).toEqual(keys);
  });

  it('puts back the text, the motion and the light in „Bild"', () => {
    changeSettings(MOVED);
    resetTab('bild');
    expect(getSettings()).toEqual({ ...MOVED, textSize: 'normal', motion: 'system', light: 'auto' });
  });

  it('puts back the keys, the controller, its symbols and the dead zone in „Steuerung"', () => {
    changeSettings(MOVED);
    resetTab('steuerung');
    expect(getSettings()).toEqual({
      ...MOVED,
      keys: DEFAULT_KEYS,
      pad: DEFAULT_PAD,
      glyphs: 'auto',
      deadzone: 20,
    });
  });

  it('puts back the patterns and the spoken lines’ size in „Zugang"; „Konto" holds nothing', () => {
    changeSettings(MOVED);
    resetTab('zugang');
    expect(getSettings()).toEqual({ ...MOVED, patterns: false, subtitles: 'normal' });
    expect(resetOf('konto', MOVED)).toEqual({});
  });

  it('stands at the foot of the tab open, and puts back that tab’s at a press', () => {
    changeSettings(MOVED);
    press(buttonsOf(controls('zugang'), 'settings-reset')[0]);
    expect(getSettings()).toEqual({ ...MOVED, patterns: false, subtitles: 'normal' });
  });
});

describe('„Ton"’s mutes', () => {
  it('mute the whole lab at the sound switch, a bus in the settings, and hear it again', () => {
    const mutes = (): Rendered[] => buttonsOf(controls('ton'), 'settings-mute');
    press(mutes()[0]);
    expect(isMuted()).toBe(true);
    expect(getSettings().muted).toEqual(DEFAULT_SETTINGS.muted);
    press(mutes()[2]);
    expect(getSettings().muted).toEqual({ ...DEFAULT_SETTINGS.muted, effects: true });
    press(mutes()[2]);
    press(mutes()[0]);
    expect(isMuted()).toBe(false);
    expect(getSettings().muted).toEqual(DEFAULT_SETTINGS.muted);
  });
});

describe('the sound switch in the top bar', () => {
  it('is „Gesamt"’s mute: each shows what the other set', () => {
    const lab = (): Rendered | undefined =>
      buttonsOf(controls('ton'), 'settings-mute').find(
        (el) => el.props['aria-label'] === 'Gesamt stumm',
      );
    press(lab());
    expect(renderToStaticMarkup(<SoundSwitch menu={false} />)).toContain('aria-pressed="false"');
    const toggle = elementsOf(() => <SoundSwitch menu={false} />).find(
      (el) => el.type === 'button',
    );
    press(toggle);
    expect(isMuted()).toBe(false);
    expect(lab()?.props['aria-pressed']).toBe(false);
  });
});

describe('the settings’ styles', () => {
  const css = readFileSync(new URL('../src/styles/settings.css', import.meta.url), 'utf8');

  it('keep the tab bar whole and still while the tab’s controls scroll under it', () => {
    expect(css).toMatch(/\n\.settings-card \{[^}]*max-height: calc\(100dvh - 32px\);/);
    expect(css).toMatch(/\n\.settings-card \{[^}]*overflow: hidden;/);
    expect(css).toMatch(/\n\.settings-tabs \{[^}]*flex: none;/);
    expect(css).toMatch(/\n\.settings-body \{[^}]*overflow-y: auto;/);
    expect(css).not.toMatch(/\.settings-tabs \{[^}]*overflow/);
  });

  it('give every tab, option, key, mute and reset a fingertip’s height', () => {
    for (const rule of ['.settings-tab', '.settings-mute']) {
      const body = css.slice(css.indexOf(`\n${rule} {`)).split('}')[0] ?? '';
      expect(body).toContain('min-height: var(--target);');
    }
    expect(css).toMatch(
      /\.settings-foot \.settings-reset,\s*\.settings-card \.settings-option,\s*\.settings-card \.settings-rebind \{\s*min-height: var\(--target\);/,
    );
  });

  it('grow the spoken lines by „Untertitel": the radio’s banner, the opening’s subtitles', () => {
    const ui = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');
    const intro = readFileSync(new URL('../src/styles/intro.css', import.meta.url), 'utf8');
    const scaled = (px: number): string =>
      `font-size: calc(${px}px * var(--text-scale) * var(--subtitle-scale));`;
    expect(ui).toMatch(/:root \{[^}]*--subtitle-scale: 1;/);
    const banner = ui.slice(ui.indexOf('\n.radio-banner {')).split('}')[0] ?? '';
    expect(banner).toContain(scaled(14));
    const subtitle = intro.slice(intro.indexOf('\n.intro-subtitle {')).split('}')[0] ?? '';
    expect(subtitle).toContain(scaled(16));
  });

  it('mark each crew colour but the first with a pattern of its own, where asked', () => {
    const marks = [...css.matchAll(/:root\[data-patterns='on'\] \.crew-dot--(\d) \{/g)];
    expect(marks.map((m) => m[1])).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });
});

describe('the gear in the top bar', () => {
  it('sits beside the sound switch, which stays the quick way to silence', () => {
    vi.stubGlobal('window', { location: { origin: 'http://lab', pathname: '/' } });
    const html = renderToStaticMarkup(
      <TopBar
        roomCode={null}
        seed={null}
        running={null}
        status="open"
        toEditor={null}
        onGear={noop}
      />,
    );
    const sound = html.indexOf('class="sound-toggle"');
    const gear = html.indexOf('class="settings-toggle"');
    expect(sound).toBeGreaterThan(0);
    expect(gear).toBeGreaterThan(sound);
    expect(html).toMatch(
      /<button class="settings-toggle" title="Einstellungen" aria-label="Einstellungen">/,
    );
  });

  it('opens the room’s menu in a room, and says so', () => {
    vi.stubGlobal('window', { location: { origin: 'http://lab', pathname: '/' } });
    const html = renderToStaticMarkup(
      <TopBar
        roomCode="ABCD"
        seed={null}
        running={null}
        status="open"
        toEditor={null}
        onGear={noop}
        inRoom
      />,
    );
    expect(html).toMatch(/<button class="settings-toggle" title="Menü" aria-label="Menü">/);
  });
});

describe('the Info panel’s keys', () => {
  const keyboard = {
    keys: DEFAULT_KEYS,
    pad: DEFAULT_PAD,
    device: 'keys',
    family: 'xbox',
  } as const;

  it('lists the sprint, the talk key as set, and the settings', () => {
    const keys = new Map(controlsOf(keyboard));
    expect(keys.get('W A S D / Pfeile')).toBe('Laufen');
    expect(keys.get('Shift halten')).toMatch(/^Sprinten/);
    expect(keys.get('V halten')).toMatch(/^Sprechen/);
    expect(keys.get('Esc oder ⚙ in der Kopfleiste')).toMatch(/^Menü: Einstellungen/);
    const rebound = new Map(controlsOf({ ...keyboard, keys: { ...DEFAULT_KEYS, talk: 'g' } }));
    expect(rebound.has('V halten')).toBe(false);
    expect(rebound.get('G halten')).toMatch(/^Sprechen/);
  });

  it('names the controller’s buttons where one was used last, Start for the menu', () => {
    const pad = new Map(controlsOf({ ...keyboard, device: 'pad', family: 'playstation' }));
    expect(pad.get('R1 halten')).toMatch(/^Sprinten/);
    expect(pad.get('L1 halten')).toMatch(/^Sprechen/);
    expect(pad.get('✕')).toMatch(/^Bedienen/);
    expect(pad.get('□')).toMatch(/^Notizblock/);
    expect(pad.get('Options')).toMatch(/^Menü: Einstellungen/);
    expect(pad.get('Steuerkreuz, dann ✕')).toMatch(/Pulten und Fenstern/);
    // The stick walks; the D-pad's ◀ pings where the lamp points, its ▶ opens the quick chat.
    expect(pad.get('Stick')).toBe('Laufen');
    expect(pad.get('◀')).toBe('Ping für alle setzen, wohin die Lampe zeigt');
    expect(pad.get('▶, dann Steuerkreuz und ✕')).toBe('Schnellchat');
    const keys = new Map(controlsOf(keyboard));
    expect(keys.get('Klick auf die Welt')).toBe('Ping für alle setzen');
    expect(keys.get('C, dann 1–8, bei „…" noch 1–9')).toBe('Schnellchat');
  });

  it('tells every row apart by what it does, though a controller works two with B', () => {
    const pad = controlsOf({ ...keyboard, device: 'pad' });
    expect(pad.filter(([control]) => control === 'B')).toHaveLength(2);
    for (const rows of [controlsOf(keyboard), pad]) {
      expect(new Set(rows.map(([, what]) => what)).size).toBe(rows.length);
    }
  });
});

describe('the sprint on a touch screen', () => {
  it('shows „Sprint" under a finger only: a keyboard has Shift for it', () => {
    const css = readFileSync(new URL('../src/styles/world.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\n\.world-sprint \{\s*display: none;/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.world-sprint \{[^}]*display: grid;/);
  });
});
