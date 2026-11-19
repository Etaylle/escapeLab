import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_CODE } from '@escapelab/core';
import { asksForDemo, readDemoLink, takeDemoLink } from '../src/demoLink.js';
import { demoWay, leaveFor, pickOf } from '../src/screens/Join.js';
import { MENU_LABELS, menuItems, opensPanel } from '../src/screens/MainMenu.js';
import { KEEP_AWAKE_MS, keepAwake } from '../src/keepAwake.js';

/**
 * „Demo" in the main menu and the demo's link: the way into the room the server plays itself
 * (server demo/host.ts), with no name and no code. The demo's own screen is demoScreen.test.tsx's.
 */

const wipe = vi.hoisted(() => ({ doors: vi.fn(), shutter: vi.fn() }));
vi.mock('../src/screens/DoorWipe.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  doorsThen: wipe.doors,
  shutterThen: wipe.shutter,
}));

const noop = (): void => undefined;
const css = (file: string): string =>
  readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

/** The body of the first rule of `sheet` whose selector line is `selector`. */
function ruleOf(sheet: string, selector: string): string {
  const at = sheet.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThan(0);
  return sheet.slice(sheet.indexOf('{', at) + 1, sheet.indexOf('}', at));
}

/** A page at `address`: its location, and every address its history was given since. */
function pageAt(address: string) {
  const url = new URL(address, 'https://escapelab.test');
  const { origin, pathname, search, hash } = url;
  const location = { origin, pathname, search, hash };
  const replaced: string[] = [];
  const history = {
    state: null,
    replaceState: (_state: unknown, _title: string, to: string) => void replaced.push(to),
  };
  vi.stubGlobal('window', { location, history });
  return { replaced };
}

afterEach(() => {
  vi.unstubAllGlobals();
  wipe.doors.mockReset();
  wipe.shutter.mockReset();
});

describe('„Demo" in the main menu', () => {
  it('stands after the ways into a round, opens no panel and is a target of 46 px', () => {
    const items = menuItems(false);
    expect(items.indexOf('demo')).toBe(items.indexOf('rounds') + 1);
    expect(MENU_LABELS.demo).toBe('Demo');
    expect(opensPanel('demo')).toBe(false);
    const item = ruleOf(css('styles/menu.css'), '.menu-list .menu-item');
    expect(Number(/min-height: (\d+)px;/.exec(item)?.[1])).toBeGreaterThanOrEqual(44);
  });

  it('asks for the demo room by its code alone, at once: the room’s own doors do the rest', () => {
    const send = vi.fn();
    const taken = vi.fn();
    pickOf(demoWay(send, true), noop, taken)('demo');
    expect(send.mock.calls).toEqual([[{ kind: 'spectate', code: DEMO_CODE }]]);
    expect(DEMO_CODE).toBe('DEMO');
    expect(taken).toHaveBeenCalledWith({ at: expect.any(Number), toward: true });
    expect(wipe.doors).not.toHaveBeenCalled();
    expect(wipe.shutter).not.toHaveBeenCalled();
    // Any other page waits behind its shutter.
    leaveFor('handbook', noop);
    expect(wipe.shutter).toHaveBeenCalledTimes(1);
  });

  it('stays on a phone held sideways, where the editor, QR code, machine and settings go', () => {
    const menu = css('styles/menu.css');
    const sideways = menu.slice(
      menu.indexOf('@media (orientation: landscape) and (max-height: 500px) {'),
    );
    const hidden = (item: string): string => `li:has\\(> \\.menu-item\\[data-item='${item}'\\]\\)`;
    const list = ['settings', 'editor', 'qr', 'arcade'].map(hidden).join(',\\s*\\.menu-list ');
    expect(sideways).toMatch(new RegExp(`${list} \\{\\s*display: none;`));
    expect(menu).not.toContain("data-item='demo'");
    // Seven of the eleven are left: what a window 390 px high holds at 44 px each.
    const gone = ['settings', 'editor', 'qr', 'arcade'];
    expect(menuItems(true).filter((item) => !gone.includes(item))).toHaveLength(7);
  });

  it('leads nowhere while the line is down', () => {
    const send = vi.fn();
    const taken = vi.fn();
    pickOf(demoWay(send, false), noop, taken)('demo');
    expect(send).not.toHaveBeenCalled();
    expect(taken).toHaveBeenCalledWith({ at: expect.any(Number), toward: false });
  });
});

describe('the demo’s link', () => {
  it('is ?demo=1, and nothing else', () => {
    expect(asksForDemo('?demo=1')).toBe(true);
    expect(asksForDemo('?gl=off&demo=1')).toBe(true);
    for (const search of ['', '?demo=0', '?demo', '?demo=true', '?room=DEMO']) {
      expect(asksForDemo(search), search).toBe(false);
    }
  });

  it('is taken off the address as the page reads it, the rest of the address kept', () => {
    const { replaced } = pageAt('/?gl=off&demo=1#x');
    expect(readDemoLink().asked).toBe(true);
    expect(replaced).toEqual(['/?gl=off#x']);
    // Read once a page: the address is cleaned no second time.
    readDemoLink();
    expect(replaced).toHaveLength(1);
  });

  it('is taken by the first menu of the page alone', () => {
    pageAt('/?demo=1');
    expect(takeDemoLink()).toBe(true);
    expect(takeDemoLink()).toBe(false);
  });

  it('is none on a plain address, which stays as it is', () => {
    const { replaced } = pageAt('/?seed=12');
    expect(takeDemoLink()).toBe(false);
    expect(replaced).toEqual([]);
    // A demo switched off in the address is no link, and goes off the address all the same.
    const off = pageAt('/?demo=0');
    expect(takeDemoLink()).toBe(false);
    expect(off.replaced).toEqual(['/']);
  });
});

describe('the audience on a phone', () => {
  const sheet = css('ui.css');
  /** The block of the sheet that opens with `media`, to its end. */
  const block = (media: string): string => {
    const at = sheet.indexOf(`${media} {\n  .content--stage`);
    expect(at, media).toBeGreaterThan(0);
    return sheet.slice(at, sheet.indexOf('\n}\n', at));
  };

  it('scrolls down when held upright: the world in the lab’s shape, the panels under it', () => {
    const upright = block('@media (max-width: 560px)');
    expect(upright).toMatch(/\.content--stage:has\(> \.spectate\) \{\s*overflow-y: auto;/);
    expect(upright).toMatch(/\.spectate-world \{\s*flex: none;\s*height: 62vw;/);
    expect(upright).toMatch(
      /\.spectate-panels \{\s*flex-direction: column;\s*max-height: none;\s*overflow: visible;/,
    );
  });

  it('stands the panels beside the world when held sideways, under a head of one line', () => {
    const sideways = block('@media (orientation: landscape) and (max-height: 500px)');
    expect(sideways).toMatch(/\.spectate-head \.kicker \{\s*display: none;/);
    expect(sideways).toMatch(/\.spectate-body \{\s*flex-direction: row;/);
    expect(sideways).toMatch(/\.spectate-panels \{\s*width: min\(300px, 38vw\);/);
    // After the narrow window's rule, which it takes back for a phone held sideways.
    const held = '@media (orientation: landscape) and (max-height: 500px) {\n  .content--stage';
    const narrow = '@media (max-width: 900px) {\n  .content--stage .spectate-body';
    expect(sheet.indexOf(held)).toBeGreaterThan(sheet.indexOf(narrow));
  });

  it('cuts no name under a figure of the end card: a long one breaks into lines', () => {
    const name = ruleOf(css('styles/finale.css'), '.end-mate-name');
    expect(name).toContain('overflow-wrap: break-word;');
    expect(name).not.toContain('ellipsis');
    expect(name).not.toContain('nowrap');
  });
});

describe('the demo room’s audience keeping its server awake', () => {
  it('asks /health every four minutes, whatever becomes of a request, until it stops', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const asked: string[] = [];
    const page = {
      fetch: (address: string, init: { cache: 'no-store' }) => {
        asked.push(`${address} ${init.cache}`);
        return asked.length === 1 ? Promise.reject(new Error('offline')) : Promise.resolve();
      },
      setInterval: (run: () => void, ms: number) => setInterval(run, ms),
      clearInterval: (timer: never) => clearInterval(timer),
    };
    const unhandled: unknown[] = [];
    const note = (why: unknown): void => void unhandled.push(why);
    process.on('unhandledRejection', note);
    const stop = keepAwake(page);
    expect(asked).toEqual([]);
    await vi.advanceTimersByTimeAsync(KEEP_AWAKE_MS * 3);
    // The first ask failed, the line down: it fails quietly, nothing left unhandled.
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', note);
    expect(unhandled).toEqual([]);
    expect(asked).toEqual(Array.from({ length: 3 }, () => '/health no-store'));
    // Well inside the quarter of an hour after which a sleeping host puts its instance down.
    expect(KEEP_AWAKE_MS).toBeLessThanOrEqual(5 * 60_000);
    stop();
    await vi.advanceTimersByTimeAsync(KEEP_AWAKE_MS * 3);
    expect(asked).toHaveLength(3);
    vi.useRealTimers();
  });
});
