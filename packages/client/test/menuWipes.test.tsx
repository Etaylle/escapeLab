import { afterEach, describe, expect, it, vi } from 'vitest';
import { shutteredMenus, waysBack } from '../src/App.js';
import { WIPE_MS, type WipeKind } from '../src/screens/DoorWipe.js';
import { leaveFor, pagesOf } from '../src/screens/Join.js';
import { menuItems, opensPanel } from '../src/screens/MainMenu.js';

/**
 * The wipe before every change of the menu's (screens/DoorWipe.tsx), as the menu, the top bar and
 * the pages ask for it: the lab's doors before the editor and on the way back from it, the short
 * shutter before every other page of the menu's and on the way back — the settings too, by the
 * gear, a controller's Start or the account —, each after the hero's beat where it is taken from
 * the menu; in a room the settings open over it at once. The wipe stands in for itself here: what
 * is asked of it is kept.
 */

const wipe = vi.hoisted(() => ({ doors: vi.fn(), shutter: vi.fn() }));

vi.mock('../src/screens/DoorWipe.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  doorsThen: wipe.doors,
  shutterThen: wipe.shutter,
}));

afterEach(() => {
  wipe.doors.mockReset();
  wipe.shutter.mockReset();
});

const noop = (): void => undefined;

/** The one wipe asked for since the last: its leaves, what it runs, and whether after a beat. */
function asked(): { kind: WipeKind; after: unknown; beat: boolean } {
  const calls = [
    ...wipe.doors.mock.calls.map((args) => ['door' as const, args] as const),
    ...wipe.shutter.mock.calls.map((args) => ['shutter' as const, args] as const),
  ];
  expect(calls).toHaveLength(1);
  const [kind, [after, beat]] = calls[0] ?? ['door', []];
  wipe.doors.mockReset();
  wipe.shutter.mockReset();
  return { kind, after, beat: beat === true };
}

/** How long the leaves of `kind` take to close and open. */
const lengthOf = (kind: WipeKind): number => WIPE_MS[kind].close + WIPE_MS[kind].open;

describe('the menu left for a page of its own', () => {
  it('goes to the editor behind the doors, to every other page behind the shutter', () => {
    const openers = { openHandbook: noop, openMyRuns: noop, openEditor: noop, openSettings: noop };
    const pages = pagesOf({ ...openers, openHistory: noop }, 'blackout');
    const ways: Record<string, { kind: WipeKind; ms: number }> = {};
    for (const item of menuItems(true).filter((it) => !opensPanel(it))) {
      const open = pages[item];
      if (open === undefined) throw new Error(`no page for ${item}`);
      leaveFor(item, open);
      const { kind, after, beat } = asked();
      expect([after, beat]).toEqual([open, true]);
      ways[item] = { kind, ms: lengthOf(kind) };
    }
    const shutter = { kind: 'shutter', ms: lengthOf('shutter') };
    expect(ways).toEqual({
      handbook: shutter,
      history: shutter,
      myruns: shutter,
      editor: { kind: 'door', ms: lengthOf('door') },
      settings: shutter,
    });
    expect(shutter.ms).toBeGreaterThanOrEqual(120);
    expect(shutter.ms).toBeLessThanOrEqual(200);
    expect(lengthOf('door')).toBeGreaterThan(shutter.ms);
  });
});

describe('the way back from a page of the menu’s', () => {
  it('comes from the booklet, the Bestenliste and the account’s runs behind the shutter', () => {
    const pages = { setHandbook: vi.fn(), setHistory: vi.fn(), setMyRuns: vi.fn() };
    const back = waysBack(pages, { close: noop });
    for (const [page, set, closed] of [
      [back.handbook, pages.setHandbook, null],
      [back.history, pages.setHistory, null],
      [back.myRuns, pages.setMyRuns, false],
    ] as const) {
      page();
      const { kind, after, beat } = asked();
      expect([kind, beat]).toEqual(['shutter', false]);
      expect(set).not.toHaveBeenCalled();
      (after as () => void)();
      expect(set).toHaveBeenCalledWith(closed);
    }
  });

  it('comes from the editor behind the lab’s doors', () => {
    const close = vi.fn();
    waysBack({ setHandbook: noop, setHistory: noop, setMyRuns: noop }, { close }).editor();
    expect(asked()).toEqual({ kind: 'door', after: close, beat: false });
  });
});

describe('the settings off any room and in one', () => {
  /** A layer of menus whose ways each tell they were taken. */
  const layer = () => ({ gear: vi.fn(), start: vi.fn(), openAccount: vi.fn(), closeSettings: vi.fn() });

  it('open and close behind the shutter off any room: the gear, Start, the account', () => {
    const menus = layer();
    const reached = shutteredMenus(menus, true);
    for (const way of ['gear', 'start', 'openAccount', 'closeSettings'] as const) {
      reached[way]();
      expect(asked()).toEqual({ kind: 'shutter', after: menus[way], beat: false });
      expect(menus[way]).not.toHaveBeenCalled();
    }
  });

  it('open over a room at once', () => {
    const menus = layer();
    const reached = shutteredMenus(menus, false);
    expect(reached).toEqual(menus);
  });
});
