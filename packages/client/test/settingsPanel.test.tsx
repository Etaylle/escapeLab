import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '../src/App.js';
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
  it('offers the three volumes, the talk key, the text size and less motion', () => {
    const html = renderToStaticMarkup(<SettingsPanel onClose={noop} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('<h2>Einstellungen</h2>');
    expect(html).toContain('Schließen [Esc]');
    for (const legend of ['Lautstärke', 'Push-to-Talk-Taste', 'Textgröße', 'Weniger Bewegung']) {
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
      talkKey: 'g',
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

  it('keeps its touch line plain: the talk button stays on a touch screen', () => {
    const html = renderToStaticMarkup(<SettingsPanel onClose={noop} />);
    expect(html).toContain('Gilt für die Tastatur; Touch-Geräte behalten den Sprechknopf.');
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
  it('lists the sprint, the talk key as set, and the settings', () => {
    const keys = new Map(controlsOf('v'));
    expect(keys.get('Shift halten')).toMatch(/^Sprinten/);
    expect(keys.get('V halten')).toMatch(/^Sprechen/);
    expect(keys.get('⚙ in der Kopfleiste')).toMatch(/^Einstellungen/);
    const rebound = new Map(controlsOf('g'));
    expect(rebound.has('V halten')).toBe(false);
    expect(rebound.get('G halten')).toMatch(/^Sprechen/);
  });
});

describe('the sprint on a touch screen', () => {
  it('shows „Sprint" under a finger only: a keyboard has Shift for it', () => {
    const css = readFileSync(new URL('../src/styles/world.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\n\.world-sprint \{\s*display: none;/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.world-sprint \{[^}]*display: grid;/);
  });
});
