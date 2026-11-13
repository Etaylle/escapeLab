import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerView, SpectatorView } from '@escapelab/core';
import { backdropOf, menuPlaceOf, placeOf } from '../src/App.js';
import {
  bootWipe,
  CLOSE_MS,
  closeDoorsThen,
  closedOver,
  DOORS_FRESH_MS,
  DOORS_KEY,
  DoorWipe,
  doorsMark,
  noteDoors,
  OPEN_MS,
  wipeOn,
  wipes,
  wipeTo,
  type Wipe,
} from '../src/screens/DoorWipe.js';
import { storage } from './page.js';

const SHEET = readFileSync(new URL('../src/styles/menu.css', import.meta.url), 'utf8');

/** The window standing at `place`, no doors moving. */
const standing = (place: Wipe<string>['place']): Wipe<string> => ({
  place,
  doors: null,
  held: null,
  after: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The rule of `selector` in the menu's sheet, its declarations as written. */
function ruleOf(selector: string): string {
  const at = SHEET.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return SHEET.slice(at, SHEET.indexOf('}', at));
}

/** How long the animation of `selector` runs, ms, as the sheet says. */
const lengthOf = (selector: string): number =>
  Number(/animation: [\w-]+ (\d+)ms/.exec(ruleOf(selector))?.[1]);

describe('the door wipe between the menu and the lobby', () => {
  it('wipes from the menu to the lobby and back, and nowhere else', () => {
    expect(wipes('menu', 'lobby')).toBe(true);
    expect(wipes('lobby', 'menu')).toBe(true);
    expect(wipes('lobby', 'elsewhere')).toBe(false);
    expect(wipes('elsewhere', 'lobby')).toBe(false);
    expect(wipes('menu', 'menu')).toBe(false);
  });

  it('closes its doors over the screen left, held on, as the lobby comes up', () => {
    const wipe = wipeTo(standing('menu'), 'lobby', 'the menu', false);
    expect(wipe).toEqual({
      place: 'lobby',
      doors: 'closing',
      held: { value: 'the menu' },
      after: null,
    });
    // Closed, the doors open on the window's own screen; open, they are gone.
    const opening = wipeOn(wipe);
    expect(opening).toEqual({ place: 'lobby', doors: 'opening', held: null, after: null });
    expect(wipeOn(opening)).toEqual(standing('lobby'));
  });

  it('closes them over the lobby as the window goes back to the menu', () => {
    const wipe = wipeTo(standing('lobby'), 'menu', 'the lobby', false);
    expect(wipe).toMatchObject({ place: 'menu', doors: 'closing', held: { value: 'the lobby' } });
  });

  it('leaves a wipe standing where the window has not moved', () => {
    const wipe = wipeTo(standing('menu'), 'lobby', 'the menu', false);
    expect(wipeTo(wipe, 'lobby', 'the lobby', false)).toBe(wipe);
  });

  it('keeps what it closes over where the window turns back before the doors have shut', () => {
    const closing = wipeTo(standing('menu'), 'lobby', 'the menu', false);
    expect(wipeTo(closing, 'menu', 'the lobby', false).held).toEqual({ value: 'the menu' });
    // Opening, it closes over the screen now shown.
    const opening = wipeOn(closing);
    expect(wipeTo(opening, 'menu', 'the lobby', false).held).toEqual({ value: 'the lobby' });
  });

  it('cuts under reduced motion, and wherever a run starts or the audience watches', () => {
    expect(wipeTo(standing('menu'), 'lobby', 'the menu', true)).toEqual(standing('lobby'));
    const closing = wipeTo(standing('menu'), 'lobby', 'the menu', false);
    expect(wipeTo(closing, 'elsewhere', 'the menu', false)).toEqual(standing('elsewhere'));
    expect(wipeTo(standing('lobby'), 'elsewhere', 'the lobby', false).doors).toBeNull();
  });

});

describe('the door wipe as the lobby is left, the page loaded anew', () => {
  it('shuts over the lobby before it is left, and stays shut while the page loads anew', () => {
    const leave = (): void => undefined;
    const closing = closedOver(standing('lobby'), 'the lobby', leave);
    expect(closing).toEqual({
      place: 'lobby',
      doors: 'closing',
      held: { value: 'the lobby' },
      after: leave,
    });
    const shut = wipeOn(closing);
    expect(shut).toEqual({
      place: 'lobby',
      doors: 'shut',
      held: { value: 'the lobby' },
      after: null,
    });
    expect(wipeOn(shut)).toBe(shut);
    // The seat freed, the window is off any room before the page goes: the doors stay shut.
    expect(wipeTo(shut, 'menu', 'the menu', false)).toEqual({ ...shut, place: 'menu' });
    // Doors already closing go on closing over what they hold.
    const turning = wipeTo(standing('menu'), 'lobby', 'the menu', false);
    expect(closedOver(turning, 'the lobby', leave).held).toEqual({ value: 'the menu' });
  });

  it('opens on the page loaded next where the page before shut them as it went', () => {
    const now = 1_000_000;
    expect(bootWipe('menu', now - 900, now, false).doors).toBe('opening');
    expect(bootWipe('menu', now - DOORS_FRESH_MS, now, false).doors).toBeNull();
    expect(bootWipe('menu', now + 50, now, false).doors).toBeNull();
    expect(bootWipe('menu', null, now, false)).toEqual(standing('menu'));
    expect(bootWipe('menu', now - 900, now, true).doors).toBeNull();
  });

  it('notes in the tab when its doors shut, reads it back, and forgets it', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('window', { sessionStorage: storage(kept) });
    expect(doorsMark()).toBeNull();
    noteDoors(1234);
    expect(kept.get(DOORS_KEY)).toBe('1234');
    expect(doorsMark()).toBe(1234);
    noteDoors(null);
    expect(kept.has(DOORS_KEY)).toBe(false);
    kept.set(DOORS_KEY, 'soon');
    expect(doorsMark()).toBeNull();
  });

  it('leaves at once where no wipe is mounted', () => {
    const leave = vi.fn();
    closeDoorsThen(leave);
    expect(leave).toHaveBeenCalledOnce();
  });

});

describe('the door wipe’s doors', () => {
  it('draws two leaves while its doors move, nothing while they stand open', () => {
    expect(renderToStaticMarkup(<DoorWipe doors={null} />)).toBe('');
    const closing = renderToStaticMarkup(<DoorWipe doors="closing" />);
    expect(closing).toMatch(/^<div class="door-wipe door-wipe--closing" aria-hidden="true">/);
    expect(closing.match(/class="door-leaf door-leaf--(left|right)"/g)).toHaveLength(2);
    expect(closing.match(/class="door-chevrons"/g)).toHaveLength(2);
    expect(renderToStaticMarkup(<DoorWipe doors="opening" />)).toContain('door-wipe--opening');
    expect(renderToStaticMarkup(<DoorWipe doors="shut" />)).toContain('door-wipe--shut');
  });

  it('takes 400 ms at most: its close and its open in the sheet as the hook times them', () => {
    for (const side of ['left', 'right']) {
      expect(lengthOf(`.door-wipe--closing .door-leaf--${side}`)).toBe(CLOSE_MS);
      expect(lengthOf(`.door-wipe--opening .door-leaf--${side}`)).toBe(OPEN_MS);
    }
    expect(CLOSE_MS + OPEN_MS).toBeLessThanOrEqual(400);
  });

  it('lies over the bar and its banners, under the scanlines', () => {
    expect(ruleOf('.door-wipe')).toMatch(/position: fixed;\s+inset: 0;\s+z-index: 45;/);
    const ui = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');
    expect(ui).toMatch(/\.scanlines \{[^}]*z-index: 50;/);
    expect(ui).toMatch(/\.topbar \{[^}]*z-index: 20;/);
  });
});

describe('the panels over the menu', () => {
  it('slide in from the menu’s side as they fade up, and under reduced motion only fade', () => {
    expect(ruleOf('.menu-panel')).toContain('animation: menu-panel-in 200ms');
    expect(SHEET).toMatch(
      /@keyframes menu-panel-in \{\s+from \{\s+opacity: 0;\s+transform: translateX\(-32px\);/,
    );
    expect(SHEET).toMatch(/@keyframes menu-panel-fade \{\s+from \{\s+opacity: 0;\s+\}\s+\}/);
    const reduced = SHEET.slice(SHEET.indexOf(":where([data-motion='reduce']) {"));
    expect(reduced).toMatch(/\.menu-panel \{\s+animation-name: menu-panel-fade;/);
  });
});

describe('the scene behind the lobby', () => {
  const lobby = { phase: 'lobby', missionId: 'notstrom' } as PlayerView;
  const running = { phase: 'playing', missionId: 'notstrom' } as PlayerView;

  it('is the room’s lab behind the crew room, the menu’s picked one off any room', () => {
    expect(backdropOf({ view: lobby, spectatorView: null }, false, 'blackout')).toEqual({
      missionId: 'notstrom',
      shown: true,
      lobby: true,
    });
    expect(backdropOf({ view: null, spectatorView: null }, true, 'blackout')).toEqual({
      missionId: 'blackout',
      shown: true,
      lobby: false,
    });
    // Under the booklet, the Bestenliste or the editor it stays, hidden.
    expect(backdropOf({ view: null, spectatorView: null }, false, 'blackout')?.shown).toBe(false);
  });

  it('is gone in a run and for the audience', () => {
    expect(backdropOf({ view: running, spectatorView: null }, false, 'blackout')).toBeNull();
    const watching = { phase: 'lobby' } as SpectatorView;
    expect(backdropOf({ view: null, spectatorView: watching }, false, 'blackout')).toBeNull();
  });

  it('wants the menu’s sound under the booklet and the Bestenliste, not in the editor', () => {
    const offRoom = { view: null, spectatorView: null };
    expect(menuPlaceOf(offRoom, false)).toBe('menu');
    expect(menuPlaceOf(offRoom, true)).toBeNull();
    // A test run's lobby is a lobby, its editor kept open behind it.
    expect(menuPlaceOf({ view: lobby, spectatorView: null }, true)).toBe('lobby');
    expect(menuPlaceOf({ view: running, spectatorView: null }, false)).toBeNull();
    const watching = { phase: 'lobby' } as SpectatorView;
    expect(menuPlaceOf({ view: null, spectatorView: watching }, false)).toBeNull();
  });

  it('tells the door wipe where the window is', () => {
    expect(placeOf({ view: null, spectatorView: null })).toBe('menu');
    expect(placeOf({ view: lobby, spectatorView: null })).toBe('lobby');
    expect(placeOf({ view: running, spectatorView: null })).toBe('elsewhere');
    expect(placeOf({ view: null, spectatorView: { phase: 'lobby' } as SpectatorView })).toBe(
      'elsewhere',
    );
  });

  it('lies under the lobby in a stacking context of its own, evenly dimmed', () => {
    expect(ruleOf('.content--stage:has(> .lobby)')).toContain('isolation: isolate;');
    expect(ruleOf('.menu-backdrop--lobby::after')).toContain('background: rgba(5, 8, 12, 0.5);');
  });
});
