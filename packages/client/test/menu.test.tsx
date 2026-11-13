import { readFileSync, statSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionInfo, Seat } from '@escapelab/core';
import { WORLD, offVoice } from '../../core/test/voice.js';
import { startPad, type PadProbe } from '../src/input/padRuntime.js';
import { keepColor, lastColor, PASS_KEY } from '../src/pass.js';
import { wavesAnew } from '../src/screens/CrewFigure.js';
import { JoinScreen, MENU_SUBTITLE, panelOnArrival } from '../src/screens/Join.js';
import { MENU_LABELS, menuItems, menuStep } from '../src/screens/MainMenu.js';
import { codeOf, escapeHandler, JoinPanel } from '../src/screens/MenuPanels.js';
import { FIRST_COLOR, ProfileChip } from '../src/screens/ProfileChip.js';
import { storage } from './page.js';

const noop = (): void => undefined;
const CLIENT = new URL('../', import.meta.url);

const blackout: MissionInfo = {
  id: 'blackout',
  title: 'Blackout im Labor',
  subtitle: 'Der Klassiker.',
  players: { min: 2, max: 3 },
  timeLimitSec: 900,
  puzzleCount: 6,
  tiles: [],
};

/** Anna's browser: her pass and name kept, the colour she wore last where `color` is given. */
function stubWindow(search = '', color: string | null = null): Map<string, string> {
  const pass = { id: 'a1'.repeat(16), secret: '0f'.repeat(32), name: 'Anna', color };
  const kept = new Map([[PASS_KEY, JSON.stringify(pass)]]);
  vi.stubGlobal('window', { location: { search }, localStorage: storage(kept) });
  return kept;
}

/** The start screen as the app shows it, the pass sitting as `seat` says. */
function menu(seat: Seat | null = null, rooms = 0): string {
  const room = { code: 'QX7R', missionId: 'blackout', missionTitle: 'Blackout im Labor' };
  return renderToStaticMarkup(
    <JoinScreen
      send={noop}
      connected
      missions={[blackout]}
      rooms={Array.from({ length: rooms }, (_, i) => ({
        ...room,
        code: `QX7${i}`,
        difficulty: 'normal' as const,
        phase: 'lobby' as const,
        players: [],
        capacity: 3,
        free: 3,
      }))}
      seat={seat}
      stats={[]}
      picked={null}
      onPick={noop}
      openHandbook={noop}
      openHistory={noop}
      openEditor={noop}
      openSettings={noop}
    />,
  );
}

const labels = (html: string): string[] =>
  [...html.matchAll(/<span class="menu-label">([^<]*)<\/span>/g)].map((m) => m[1] ?? '');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the menu', () => {
  it('stands one item under the next: a round, a code, the rounds, the booklet, the rest', () => {
    expect(menuItems(true).map((item) => MENU_LABELS[item])).toEqual([
      'Einsatz starten',
      'Beitreten',
      'Offene Runden',
      'Handbuch',
      'Bestenliste',
      'Editor',
      'Einstellungen',
    ]);
    expect(menuItems(false)).not.toContain('editor');
    stubWindow();
    expect(labels(menu())).toEqual(menuItems(true).map((item) => MENU_LABELS[item]));
  });

  it('moves the focus with the arrows: down and up, round at the ends, Home and End', () => {
    expect(menuStep(0, 'ArrowDown', 7)).toBe(1);
    expect(menuStep(6, 'ArrowDown', 7)).toBe(0);
    expect(menuStep(0, 'ArrowUp', 7)).toBe(6);
    expect(menuStep(3, 'Home', 7)).toBe(0);
    expect(menuStep(3, 'End', 7)).toBe(6);
    expect(menuStep(3, 'Enter', 7)).toBeNull();
    expect(menuStep(0, 'ArrowDown', 0)).toBeNull();
  });

  it('carries the game’s title and a line of the world under it', () => {
    stubWindow();
    const html = menu();
    expect(html).toMatch(/<h1 class="menu-title( phosphor-title)?">ESCAPELAB<\/h1>/);
    expect(html).toContain(`<p class="menu-sub">${MENU_SUBTITLE}</p>`);
    expect(offVoice([MENU_SUBTITLE], WORLD)).toEqual([]);
  });

  it('counts the rooms open beside „Offene Runden", and says nothing without any', () => {
    stubWindow();
    expect(menu(null, 2)).toContain('Offene Runden</span><span class="menu-count">2</span>');
    expect(menu(null, 0)).not.toContain('menu-count');
  });

  it('puts the card of a run that binds the pass first, lit, and dims the rest', () => {
    stubWindow();
    const run: Seat = {
      code: 'QX7R',
      missionTitle: 'Blackout im Labor',
      phase: 'playing',
      paused: true,
      crew: ['Anna', 'Ben'],
      leftMs: 600_000,
    };
    const html = menu(run);
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    const lit = '<nav class="menu-list menu-list--bound" aria-label="Hauptmenü">';
    expect(nav.startsWith(`${lit}<section class="bound bound--run">`)).toBe(true);
    expect(nav).toContain('EINSATZ PAUSIERT');
    expect(html).toContain('<p class="bound-line">');
    // A lobby's seat stands first too, but binds nothing: the menu stays lit.
    const lobby = menu({ ...run, phase: 'lobby', paused: false, leftMs: null });
    const open = '<nav class="menu-list" aria-label="Hauptmenü">';
    expect(lobby).toContain(`${open}<section class="bound">`);
  });

  it('opens on „Beitreten" for an invite link, its code filled in', () => {
    expect(panelOnArrival('?room=QX7R')).toBe('join');
    expect(panelOnArrival('?trace=1')).toBeNull();
    stubWindow('?room=qx7r');
    const html = menu();
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('value="QX7R"');
    // The menu waits under its panel: neither the keys nor a controller reach it.
    expect(html).toContain('<div class="menu-body" inert="">');
  });
});

describe('a panel over the menu', () => {
  it('steps back out at Esc — once, and not where something over it took the key', () => {
    const close = vi.fn();
    const onKey = escapeHandler(close);
    const key = (name: string, taken = false) => {
      const event = { key: name, defaultPrevented: taken, preventDefault: vi.fn() };
      onKey(event as unknown as KeyboardEvent);
      return event;
    };
    expect(key('Escape').preventDefault).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    key('Enter');
    key('Escape', true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('takes a room’s code in capitals, its letters and digits alone', () => {
    expect(codeOf('qx7r')).toBe('QX7R');
    expect(codeOf(' qx 7-r ')).toBe('QX7R');
    expect(codeOf('')).toBe('');
  });

  it('asks for the code in a field no browser takes for a password or a one-time code', () => {
    stubWindow();
    const html = renderToStaticMarkup(
      <JoinPanel
        send={noop}
        connected
        name="Anna"
        blocked={false}
        takeover={null}
        waiting={false}
        onClose={noop}
      />,
    );
    const field = html.match(/<input class="join-code"[^>]*>/)?.[0] ?? '';
    for (const attribute of [
      'aria-label="Raumcode"',
      'name="room"',
      'type="text"',
      'autoComplete="off"',
      'autoCorrect="off"',
      'autoCapitalize="characters"',
      'spellCheck="false"',
      'data-1p-ignore="true"',
      'data-lpignore="true"',
      'data-form-type="other"',
    ]) {
      expect(field.toLowerCase()).toContain(attribute.toLowerCase());
    }
    expect(field).not.toMatch(/password|one-time-code/);
    expect(html).not.toContain('<form');
    // „Zuschauen" stands beside „Beitreten".
    expect(html).toMatch(/Beitreten<\/button><button[^>]*>.*Zuschauen<\/button><\/div>/);
  });
});

describe('the profile', () => {
  it('shows the figure, the name to type, the colour last worn and the sign-in’s slot', () => {
    stubWindow('', '#f472b6');
    const html = renderToStaticMarkup(<ProfileChip name="Anna" onName={noop} />);
    const chip = '<section class="profile-chip" aria-label="Profil">';
    expect(html.startsWith(`${chip}<canvas class="seat-figure"`)).toBe(true);
    const field = html.match(/<input class="profile-name"[^>]*>/)?.[0] ?? '';
    expect(field).toContain('value="Anna"');
    expect(field).toContain('placeholder="z. B. Anna"');
    expect(field).toContain('aria-label="Name"');
    expect(field).toContain('autoComplete="off"');
    expect(html).toContain('style="background:#f472b6"');
    expect(html).toContain('Pink</span>');
    expect(html).toContain('<span class="profile-slot">Gast</span>');
  });

  it('waves once a new name has settled, as a figure waves at its player saying ready', () => {
    const named = (wave: string, ready = false) => ({ ready, wave });
    expect(wavesAnew(named('Ann'), named('Anna'))).toBe(true);
    expect(wavesAnew(named('Anna'), named('Anna'))).toBe(false);
    expect(wavesAnew(named('Anna'), named('Anna', true))).toBe(true);
    expect(wavesAnew(named('Anna', true), named('Anna', true))).toBe(false);
    expect(wavesAnew(named('Anna', true), named('Anna'))).toBe(false);
  });

  it('wears the crew’s first colour before any was worn', () => {
    stubWindow();
    const html = renderToStaticMarkup(<ProfileChip name="" onName={noop} />);
    expect(html).toContain(`style="background:${FIRST_COLOR}"`);
    expect(html).toContain('Türkis</span>');
  });

  it('keeps the colour worn in a lobby with the pass, and nothing that is no crew colour', () => {
    const kept = stubWindow();
    expect(lastColor()).toBeNull();
    keepColor('#60a5fa');
    expect(lastColor()).toBe('#60a5fa');
    const pass: unknown = JSON.parse(kept.get(PASS_KEY) ?? '{}');
    expect(pass).toMatchObject({ name: 'Anna', color: '#60a5fa' });
    keepColor('red; background: url(x)');
    expect(lastColor()).toBe('#60a5fa');
  });
});

describe('the game’s title face', () => {
  const fonts = new URL('public/fonts/', CLIENT);

  it('is one woff2 of an OFL face under public/fonts, 60 kB at most, its licence beside it', () => {
    const font = new URL('michroma-latin.woff2', fonts);
    expect(readFileSync(font).subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(statSync(font).size).toBeLessThanOrEqual(60 * 1024);
    const licence = readFileSync(new URL('michroma-OFL.txt', fonts), 'utf8');
    expect(licence).toContain('SIL Open Font License, Version 1.1');
    expect(licence).toContain('The Michroma Project Authors');
    // The copyright statement reserves no name: a subset may keep it.
    expect(licence.split('\n')[0]).not.toMatch(/Reserved Font Name/i);
  });

  it('is loaded by the game itself, its stylesheet and the page’s preload, never a CDN', () => {
    const sheet = readFileSync(new URL('src/styles/menu.css', CLIENT), 'utf8');
    expect(sheet).toMatch(/src: url\('\/fonts\/michroma-latin\.woff2'\) format\('woff2'\);/);
    expect(sheet).toMatch(/--display: 'Michroma', [^;]+;/);
    expect(sheet).not.toMatch(/https?:/);
    const page = readFileSync(new URL('index.html', CLIENT), 'utf8');
    const preload = page.match(
      /<link\s+rel="preload"\s+href="\/fonts\/michroma-latin\.woff2"[^>]*>/,
    );
    expect(preload?.[0].replace(/\s+/g, ' ')).toBe(
      '<link rel="preload" href="/fonts/michroma-latin.woff2" as="font" type="font/woff2" ' +
        'crossorigin />',
    );
  });
});

/** The page as a controller reaches it: its controls, a dialog where one is up, the focus. */
interface FakeMenuPage {
  focus: FakeControl | null;
  dialogs: object[];
}

let page: FakeMenuPage;

/**
 * A control of the fake page, `name` at a row of the menu — one under the next as menu.css lays
 * them out — and what it is pressed and sent; the page's HTMLElement while the tests run.
 */
class FakeControl {
  readonly tagName = 'BUTTON';
  readonly dataset: Record<string, string> = {};
  pressed = 0;
  readonly sent: string[] = [];

  constructor(
    readonly name: string,
    readonly row: number,
  ) {}

  focus(): void {
    page.focus = this;
  }

  click(): void {
    this.pressed += 1;
  }

  getBoundingClientRect() {
    return { left: 80, top: 260 + this.row * 48, right: 520, bottom: 306 + this.row * 48 };
  }

  getClientRects(): object[] {
    return [{}];
  }

  closest(): null {
    return null;
  }

  dispatchEvent(event: { type: string; key: string }): boolean {
    this.sent.push(`${event.type === 'keydown' ? '↓' : '↑'}${event.key}`);
    return true;
  }
}

const control = (name: string, row: number): FakeControl => new FakeControl(name, row);

/** A scope of the page holding `controls`: the app, or a dialog. */
function scopeOf(controls: FakeControl[], doc: () => unknown) {
  return {
    get ownerDocument() {
      return doc();
    },
    querySelectorAll: () => controls,
    contains: (el: unknown) => controls.includes(el as FakeControl),
    classList: { contains: () => false },
    closest: () => null,
    getClientRects: () => [{}],
  };
}

describe('a controller over the menu', () => {
  const items = menuItems(true).map((item, row) => control(MENU_LABELS[item], row));
  const frames: ((now: number) => void)[] = [];
  let now = 0;
  let stop: () => void = noop;
  const frame = (): void => {
    now += 16;
    frames.shift()?.(now);
  };
  const pad = (): PadProbe => {
    const probe = (window as unknown as { __escapelab?: { pad?: PadProbe } }).__escapelab?.pad;
    if (probe === undefined) throw new Error('no fake controller on the page');
    return probe;
  };
  const tap = (button: Parameters<PadProbe['press']>[0]): void => {
    pad().press(button);
    frame();
    pad().release(button);
    frame();
  };

  beforeEach(() => {
    page = { focus: null, dialogs: [] };
    const doc: Record<string, unknown> = {
      get activeElement() {
        return page.focus;
      },
      body: control('body', 99),
      documentElement: { dataset: {}, style: { setProperty: noop } },
      querySelectorAll: (selector: string) =>
        selector === '[aria-modal="true"]' ? page.dialogs : [],
      // No world on the page: the app is the scope, the menu's items its controls.
      querySelector: (selector: string) => (selector === '.app' ? app : null),
    };
    const app = scopeOf(items, () => doc);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('HTMLElement', FakeControl);
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('window', { addEventListener: noop, removeEventListener: noop });
    vi.stubGlobal('KeyboardEvent', class {
      constructor(readonly type: string, readonly init: { key: string }) {}
      get key(): string {
        return this.init.key;
      }
    });
    vi.stubGlobal('navigator', { getGamepads: () => [] });
    vi.stubGlobal('requestAnimationFrame', (run: (now: number) => void) => frames.push(run));
    vi.stubGlobal('cancelAnimationFrame', noop);
    stop = startPad({ onSettings: noop }, '?fakepad=1');
  });

  afterEach(() => {
    stop();
  });

  it('steps down and up the menu with the D-pad, and takes an item with A', () => {
    items[0]?.focus();
    tap('ddown');
    expect(page.focus?.name).toBe('Beitreten');
    tap('ddown');
    expect(page.focus?.name).toBe('Offene Runden');
    tap('dup');
    expect(page.focus?.name).toBe('Beitreten');
    tap('a');
    expect(items[1]?.pressed).toBe(1);
  });

  it('keeps to a panel once one is up, and steps back out of it with B — by Esc', () => {
    const field = control('Raumcode', 1);
    const back = control('Zurück', 0);
    page.dialogs = [scopeOf([back, field], () => document)];
    field.focus();
    tap('dup');
    expect(page.focus?.name).toBe('Zurück');
    tap('b');
    expect(back.sent).toEqual(['↓Escape', '↑Escape']);
  });
});
