import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '../src/App.js';
import { DEFAULT_KEYS, DEFAULT_PAD } from '../src/input/bindings.js';
import { controlsOf } from '../src/screens/InfoPanel.js';
import { SettingsPanel } from '../src/screens/Settings.js';
import { changeSettings, DEFAULT_SETTINGS } from '../src/settings.js';

const noop = (): void => undefined;

afterEach(() => {
  changeSettings(DEFAULT_SETTINGS);
  vi.unstubAllGlobals();
});

/** An option lit, and its text. */
const LIT = /aria-checked="true" class="settings-option settings-option--on">([^<]+)</g;
/** A volume's row: its name, and its slider's value. */
const SLIDER = /<span class="settings-label">([^<]+)<\/span><input type="range"[^>]*value="(\d+)"/g;

/** The texts of the options lit in `html`, in order. */
const lit = (html: string): string[] => [...html.matchAll(LIT)].map((m) => m[1] ?? '');

describe('the settings panel', () => {
  it('offers the three volumes, the keys, the controller, the text size and less motion', () => {
    const html = renderToStaticMarkup(<SettingsPanel onClose={noop} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('<h2>Einstellungen</h2>');
    expect(html).toContain('Schließen [Esc]');
    const legends = ['Lautstärke', 'Tastenbelegung', 'Controller', 'Textgröße', 'Weniger Bewegung'];
    for (const legend of legends) {
      expect(html).toContain(`<legend>${legend}</legend>`);
    }
    const sliders = [...html.matchAll(SLIDER)].map((m) => `${m[1]} ${m[2]}`);
    expect(sliders).toEqual(['Funk 100', 'Effekte 100', 'Musik 70']);
    expect(html).toContain('<kbd class="settings-kbd">V</kbd>');
    expect(html).toContain('>Ändern</button>');
    for (const option of ['Klein', 'Normal', 'Groß', 'Aus', 'An', 'System']) {
      expect(html).toContain(`>${option}</button>`);
    }
    expect(lit(html)).toEqual(['Normal', 'System']);
  });

  it('shows what is set: the talk key rebound, the volumes moved, the choices lit', () => {
    changeSettings({
      volumes: { radio: 35, effects: 0, music: 90 },
      keys: { ...DEFAULT_KEYS, talk: 'g' },
      textSize: 'large',
      motion: 'on',
    });
    const html = renderToStaticMarkup(<SettingsPanel onClose={noop} />);
    expect(html).toContain('<kbd class="settings-kbd">G</kbd>');
    expect([...html.matchAll(/type="range"[^>]*value="(\d+)"/g)].map((m) => m[1])).toEqual([
      '35',
      '0',
      '90',
    ]);
    expect(lit(html)).toEqual(['Groß', 'An']);
  });

  it('keeps its touch line plain: a touch screen keeps its buttons', () => {
    const html = renderToStaticMarkup(<SettingsPanel onClose={noop} />);
    expect(html).toContain('Touch-Geräte behalten ihre Knöpfe.');
    expect(html).toContain('↑ ↓ ← →, Enter, Leertaste, Esc behalten ihre Aufgabe');
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
        onSettings={noop}
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
    expect(keys.get('⚙ in der Kopfleiste')).toMatch(/^Einstellungen/);
    const rebound = new Map(controlsOf({ ...keyboard, keys: { ...DEFAULT_KEYS, talk: 'g' } }));
    expect(rebound.has('V halten')).toBe(false);
    expect(rebound.get('G halten')).toMatch(/^Sprechen/);
  });

  it('names the controller’s buttons where one was used last, Start for the settings', () => {
    const pad = new Map(controlsOf({ ...keyboard, device: 'pad', family: 'playstation' }));
    expect(pad.get('R1 halten')).toMatch(/^Sprinten/);
    expect(pad.get('L1 halten')).toMatch(/^Sprechen/);
    expect(pad.get('✕')).toMatch(/^Bedienen/);
    expect(pad.get('□')).toMatch(/^Notizblock/);
    expect(pad.get('Options')).toMatch(/^Einstellungen/);
    expect(pad.get('Steuerkreuz, dann ✕')).toMatch(/Pulten und Fenstern/);
  });
});

describe('the sprint on a touch screen', () => {
  it('shows „Sprint" under a finger only: a keyboard has Shift for it', () => {
    const css = readFileSync(new URL('../src/styles/world.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\n\.world-sprint \{\s*display: none;/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.world-sprint \{[^}]*display: grid;/);
  });
});
