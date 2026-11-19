import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD, offVoice } from '../../core/test/voice.js';
import { RoomCode } from '../src/App.js';
import { qrOf, QUIET_MODULES } from '../src/qr.js';
import { MENU_LABELS, menuItems, opensPanel } from '../src/screens/MainMenu.js';
import { QR_PANEL_LINE, QrPanel } from '../src/screens/MenuPanels.js';
import {
  addressText,
  inviteLink,
  InviteQr,
  QrCode,
  qrFits,
  siteAddress,
} from '../src/screens/QrCode.js';

/**
 * The QR codes on the screens: the site's address large in the menu's panel, a lobby's invite
 * beside its code, black on white whatever the palette, with the address as text.
 */

vi.mock('../src/world/menuSound.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uiSound: () => undefined,
}));

const noop = (): void => undefined;
const sheet = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');

/** The body of the first rule of the sheet whose selector line is `selector`. */
function ruleOf(selector: string): string {
  const at = sheet.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThan(0);
  return sheet.slice(sheet.indexOf('{', at) + 1, sheet.indexOf('}', at));
}

beforeEach(() => {
  const location = { origin: 'https://escapelab.test', pathname: '/', search: '', hash: '' };
  vi.stubGlobal('window', { location, addEventListener: noop, removeEventListener: noop });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a QR code on the screen', () => {
  it('is black on white with its quiet zone, a module a unit, its edges sharp', () => {
    const html = renderToStaticMarkup(<QrCode text="HCW" label="Probe" />);
    const side = qrOf('HCW').length + 2 * QUIET_MODULES;
    expect(html).toContain(`viewBox="0 0 ${side} ${side}"`);
    expect(html).toContain('role="img" aria-label="Probe" shape-rendering="crispEdges"');
    expect(html).toContain(`<rect width="${side}" height="${side}" fill="#ffffff"></rect>`);
    expect(html).toMatch(/<path d="M4 4h1v1h-1z[^"]+" fill="#000000"><\/path>/);
    // The sheet gives it its size and no colour: the night's palette never reaches it.
    expect(ruleOf('.qr')).not.toMatch(/color|fill|filter|opacity/);
  });

  it('shows nothing for a text too long for it', () => {
    expect(qrFits('x'.repeat(106))).toBe(true);
    expect(qrFits('x'.repeat(107))).toBe(false);
    expect(renderToStaticMarkup(<QrCode text={'x'.repeat(107)} label="Probe" />)).toBe('');
  });
});

describe('„QR-Code" in the main menu', () => {
  it('stands after „Demo" and opens a panel of its own', () => {
    const items = menuItems(false);
    expect(items.indexOf('qr')).toBe(items.indexOf('demo') + 1);
    expect(MENU_LABELS.qr).toBe('QR-Code');
    expect(opensPanel('qr')).toBe(true);
  });

  it('shows the site’s own address large, and as text under it', () => {
    expect(siteAddress()).toBe('https://escapelab.test');
    const html = renderToStaticMarkup(<QrPanel onClose={noop} />);
    expect(html).toContain('>Zutritt per QR-Code</h2>');
    expect(html).toContain(`<p class="muted">${QR_PANEL_LINE}</p>`);
    expect(html).toContain('<div class="qr-large"><svg class="qr"');
    expect(html).toContain('aria-label="QR-Code der Adresse escapelab.test"');
    expect(html).toContain('<p class="qr-address">escapelab.test</p>');
    // The code is the address's: the same modules as the address alone makes.
    const path = renderToStaticMarkup(<QrCode text="https://escapelab.test" label="x" />);
    expect(html).toContain(/<path d="[^"]+"/.exec(path)?.[0] ?? 'no path');
    expect(offVoice([QR_PANEL_LINE], WORLD)).toEqual([]);
  });

  it('is as large as the window lets it be, 480 px at most, the address at 16 px', () => {
    expect(ruleOf('.qr-large')).toContain('width: min(100%, 100vh - 320px, 480px);');
    expect(ruleOf('.menu-panel.menu-panel--qr')).toContain('grid-area: 1 / 1 / -1 / -1;');
    expect(ruleOf('.qr-address')).toContain('font-size: calc(16px * var(--text-scale));');
  });
});

describe('a lobby’s invite as a QR code', () => {
  it('leads into the join step of the room, its code in the link', () => {
    expect(inviteLink('QX7R')).toBe('https://escapelab.test/?room=QX7R');
    expect(addressText(inviteLink('QX7R'))).toBe('escapelab.test/?room=QX7R');
  });

  it('stands beside the room’s code as a chip, shut until it is pressed, in a lobby alone', () => {
    const lobby = renderToStaticMarkup(<RoomCode code="QX7R" qr />);
    expect(lobby).toContain(
      '<button class="invite-qr-chip" aria-expanded="false" ' +
        'title="QR-Code der Einladung zeigen">QR</button>',
    );
    expect(lobby).not.toContain('invite-qr-sheet');
    expect(renderToStaticMarkup(<RoomCode code="QX7R" />)).not.toContain('invite-qr');
  });

  it('shows no chip where the link is too long for a code', () => {
    window.location.pathname = `/${'p'.repeat(90)}`;
    expect(renderToStaticMarkup(<InviteQr code="QX7R" />)).toBe('');
  });
});
