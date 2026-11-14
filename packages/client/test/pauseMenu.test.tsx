import { readFileSync } from 'node:fs';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ManualHere, PlayerView } from '@escapelab/core';
import { roomMission, ScreenArea, TopBar } from '../src/App.js';
import { menuScope } from '../src/input/focus.js';
import {
  anyOpen,
  escapeOpensMenu,
  focusBackTo,
  gearOpens,
  markedAtMenu,
  menuNews,
  NOTHING_OPEN,
  pausePhaseOf,
  startPressed,
  usePause,
} from '../src/menuLayer.js';
import { crewTags } from '../src/screens/Crew.js';
import { escapeStep, escapeStepUnder } from '../src/screens/Game.js';
import { worldHears } from '../src/world/GameWorld.js';
import { keyTaken } from '../src/hooks.js';
import { MissionHud } from '../src/screens/MissionHud.js';
import {
  menuKeyHandler,
  menuKeyOf,
  PAUSE_LABELS,
  pauseItems,
  PauseMenu,
  RUN_GOES_ON,
  type MenuNav,
} from '../src/screens/PauseMenu.js';
import { mapWith } from './fixtures.js';

const noop = (): void => undefined;

/** A screen as it hears the menus over it (`usePause`). */
function MenuProbe() {
  return <p>{usePause().open ? 'covered' : 'open'}</p>;
}

/** Ben's view of a run on, Anna beside him — Anna at the menu where `annaAtMenu`. */
function runView(annaAtMenu = false): PlayerView {
  const ben = { id: 'p2', name: 'Ben', color: '#f472b6', ready: true, isHost: false };
  const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: true, isHost: true };
  return {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    crewSize: { min: 2, max: 3 },
    chat: [],
    you: ben,
    players: [
      { ...anna, connected: true, ...(annaAtMenu ? { menu: 'pause' as const } : {}) },
      { ...ben, connected: true },
    ],
    palette: [],
    deadlineAt: null,
    startedAt: null,
    finishedAt: null,
    timeLimitSec: 600,
    lights: { out: true, outAt: 0 },
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    pausedFor: null,
    pausedAt: null,
    events: [],
    grade: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    alarms: { count: 0, limit: 5 },
    hintsUsed: 0,
    credits: {},
    edgework: null,
    presence: { stationId: null, console: null, manualId: null, signSeen: false },
    sourcesHere: [],
    manualsHere: [],
    noteHere: null,
    puzzle: null,
    map: mapWith({}),
  };
}

/** The items a menu at `phase` shows, by their words. */
const itemsSaid = (phase: 'run' | 'lobby' | 'audience'): string[] =>
  pauseItems(phase).map((item) => PAUSE_LABELS[item]);

/** A key going down for a test: its name, and what was done to it. */
function keyDown(key: string) {
  return { key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

describe('the pause menu', () => {
  it('stands over a room: a run on, a lobby, the audience — not off any room or at the end', () => {
    expect(pausePhaseOf({ view: { phase: 'playing' }, spectatorView: null })).toBe('run');
    expect(pausePhaseOf({ view: { phase: 'lobby' }, spectatorView: null })).toBe('lobby');
    expect(pausePhaseOf({ view: null, spectatorView: {} })).toBe('audience');
    expect(pausePhaseOf({ view: { phase: 'won' }, spectatorView: null })).toBeNull();
    expect(pausePhaseOf({ view: { phase: 'lost' }, spectatorView: null })).toBeNull();
    expect(pausePhaseOf({ view: null, spectatorView: null })).toBeNull();
  });

  it('offers „Weiter" first, the settings and the booklet, and last the room’s ways out', () => {
    const shared = ['Weiter', 'Einstellungen', 'Handbuch'];
    expect(itemsSaid('run')).toEqual([...shared, 'Zum Hauptmenü', 'Einsatz aufgeben']);
    expect(itemsSaid('lobby')).toEqual([...shared, 'Zum Hauptmenü', 'Raum verlassen']);
    expect(itemsSaid('audience')).toEqual([
      'Weiter',
      'Einstellungen',
      'Handbuch',
      'Zuschauen beenden',
    ]);
  });

  it('heads its list with the mission in the title’s face, a dialog of its own', () => {
    const html = renderToStaticMarkup(
      <PauseMenu
        phase="lobby"
        missionTitle="Blackout im Labor"
        covered={false}
        last="resume"
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(html).toMatch(/^<div class="overlay pause-menu" role="dialog" aria-modal="true"/);
    expect(html).toContain('<h2 class="pause-menu-title">Blackout im Labor</h2>');
    expect([...html.matchAll(/class="menu-label">([^<]+)</g)].map((m) => m[1])).toEqual(
      itemsSaid('lobby'),
    );
    expect(html).not.toContain(RUN_GOES_ON);
    expect(html).not.toContain('inert');
  });

  it('says over a run that the clock runs on and the crew sees the player at it', () => {
    const html = renderToStaticMarkup(
      <PauseMenu
        phase="run"
        missionTitle="Blackout im Labor"
        covered={false}
        last="resume"
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(html).toContain(`<p class="pause-menu-line">${RUN_GOES_ON}</p>`);
    expect(RUN_GOES_ON).toMatch(/^Die Uhr läuft weiter/);
  });

  it('waits inert under the settings or the booklet opened from it', () => {
    const html = renderToStaticMarkup(
      <PauseMenu
        phase="run"
        missionTitle="X"
        covered
        last="settings"
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(html).toMatch(/^<div class="overlay pause-menu"[^>]* inert=""/);
  });

  it('keeps „Einstellungen" on a phone held sideways, where the main menu gives it up', () => {
    const styles = (name: string): string =>
      readFileSync(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8');
    const settingsItem = ".menu-list li:has(> .menu-item[data-item='settings'])";
    const sideways = (css: string): string =>
      css.slice(css.indexOf('@media (orientation: landscape) and (max-height: 500px) {'));
    const menu = sideways(styles('menu'));
    expect(menu.slice(menu.indexOf(settingsItem))).toMatch(/^[^}]*\{\s*display: none;/);
    const pause = sideways(styles('pause'));
    const kept = pause.slice(pause.indexOf(`.pause-menu ${settingsItem}`));
    expect(kept).toMatch(/^[^}]*\{\s*display: list-item;/);
  });

  it('names the room’s mission: the run’s, the lobby’s, the audience’s', () => {
    expect(roomMission({ view: runView(), spectatorView: null })).toEqual({
      id: 'blackout',
      title: 'Blackout im Labor',
    });
    expect(roomMission({ view: null, spectatorView: null })).toBeNull();
  });
});

describe('the screens under a menu', () => {
  it('take nothing while the pause menu, the settings or the booklet stand open', () => {
    expect(anyOpen(NOTHING_OPEN)).toBe(false);
    expect(anyOpen({ ...NOTHING_OPEN, pause: true })).toBe(true);
    expect(anyOpen({ ...NOTHING_OPEN, settings: true })).toBe(true);
    expect(anyOpen({ ...NOTHING_OPEN, handbook: 'blackout' })).toBe(true);
  });

  it('leave the top bar inert under it', () => {
    vi.stubGlobal('window', { location: { origin: 'http://lab', pathname: '/' } });
    const bar = (covered: boolean): string =>
      renderToStaticMarkup(
        <TopBar
          roomCode="ABCD"
          seed={null}
          running={null}
          status="open"
          toEditor={null}
          onGear={noop}
          covered={covered}
        />,
      );
    expect(bar(true)).toMatch(/^<header class="topbar" inert="">/);
    expect(bar(false)).toMatch(/^<header class="topbar">/);
    vi.unstubAllGlobals();
  });

  it('leave the screens’ area inert under it, its screens told that a menu stands over them', () => {
    const area = (covered: boolean): string =>
      renderToStaticMarkup(
        <ScreenArea ref={createRef()} layout="content--menu" covered={covered} openPause={noop}>
          <MenuProbe />
        </ScreenArea>,
      );
    expect(area(true)).toBe('<main class="content content--menu" inert=""><p>covered</p></main>');
    expect(area(false)).toBe('<main class="content content--menu"><p>open</p></main>');
  });

  it('keep a controller in the menu: a device’s dialog in the inert room is passed over', () => {
    /** A dialog as menuScope reads it: shown, its class, under an inert part or not. */
    const dialog = (name: string, inert: boolean) => ({
      name,
      closest: (selector: string) => (selector === '[inert]' && inert ? {} : null),
      getClientRects: () => ({ length: 1 }),
      classList: { contains: (c: string) => c === name },
    });
    // The menus stand before <main> in the page: the device's dialog comes after the menu's.
    const menu = dialog('pause-menu', false);
    const device = dialog('station-modal', true);
    const page = { querySelectorAll: () => [menu, device], querySelector: () => null };
    expect(menuScope(page as unknown as Document)).toBe(menu);
  });
});

describe('the run’s keys under its menu', () => {
  const plain = { altKey: false, ctrlKey: false, metaKey: false };

  it('reach not the world while a menu stands over it — the settings or the booklet too', () => {
    expect(worldHears(false, false, plain)).toBe(true);
    expect(worldHears(true, false, plain)).toBe(false);
    // As before: nor into a text field, nor with a modifier the browser owns.
    expect(worldHears(false, true, plain)).toBe(false);
    expect(worldHears(false, false, { ...plain, ctrlKey: true })).toBe(false);
  });

  it('reach not the screens: no notepad, no lever, no page turned, no Esc of the run’s own', () => {
    const listened = new Set(['n', 'e', 'arrowright']);
    const key = (name: string) => ({ key: name, ...plain });
    expect(keyTaken(listened, key('N'), false, false)).toBe(true);
    expect(keyTaken(listened, key('n'), false, true)).toBe(false);
    expect(keyTaken(listened, key('e'), false, true)).toBe(false);
    expect(keyTaken(listened, key('ArrowRight'), false, true)).toBe(false);
    // As before: no key not listened for, nor into a text field, nor with a modifier.
    expect(keyTaken(listened, key('m'), false, false)).toBe(false);
    expect(keyTaken(listened, key('n'), true, false)).toBe(false);
    expect(keyTaken(listened, { ...key('n'), metaKey: true }, false, false)).toBe(false);
    const nothing = { info: true, station: null, reading: null, note: null, notes: false };
    expect(escapeStepUnder(false, nothing, false)).toBe('info');
    expect(escapeStepUnder(true, nothing, false)).toBeNull();
  });
});

describe('the focus as the menus close', () => {
  it('goes back to the control that had it, still on the page — off a run', () => {
    const gear = { isConnected: true, focus: vi.fn() };
    expect(focusBackTo(gear, 'lobby')).toBe(gear);
    expect(focusBackTo(gear, 'audience')).toBe(gear);
    expect(focusBackTo(gear, null)).toBe(gear);
    expect(focusBackTo({ ...gear, isConnected: false }, 'lobby')).toBeNull();
    expect(focusBackTo(null, 'lobby')).toBeNull();
  });

  it('stays with the world in a run, where a button in the focus would take Space', () => {
    expect(focusBackTo({ isConnected: true, focus: vi.fn() }, 'run')).toBeNull();
  });
});

describe('opening the pause menu', () => {
  it('is the gear’s in a room, and the settings’ off any room', () => {
    expect(gearOpens(NOTHING_OPEN, 'run')).toEqual({ ...NOTHING_OPEN, pause: true });
    expect(gearOpens(NOTHING_OPEN, 'audience')).toEqual({ ...NOTHING_OPEN, pause: true });
    expect(gearOpens(NOTHING_OPEN, null)).toEqual({ ...NOTHING_OPEN, settings: true });
  });

  it('is a controller’s Start, which closes whatever stands open again', () => {
    const open = startPressed(NOTHING_OPEN, 'lobby');
    expect(open).toEqual({ ...NOTHING_OPEN, pause: true });
    expect(startPressed(open, 'lobby')).toEqual(NOTHING_OPEN);
    const deep = { pause: true, settings: true, handbook: 'blackout' };
    expect(startPressed(deep, 'run')).toEqual(NOTHING_OPEN);
    expect(startPressed(NOTHING_OPEN, null)).toEqual({ ...NOTHING_OPEN, settings: true });
  });

  it('is Esc’s over a run once nothing of the run’s own stands open', () => {
    const nothing = { info: false, station: null, reading: null, note: null, notes: false };
    expect(escapeStep(nothing)).toBe('menu');
    expect(escapeStep({ ...nothing, notes: true })).toBe('notes');
    const pages = { id: 'buch' } as ManualHere;
    expect(escapeStep({ ...nothing, notes: true, reading: pages })).toBe('over');
    expect(escapeStep({ ...nothing, info: true, notes: true })).toBe('info');
    // A panel on its way out — held once solved, or fading — takes the Esc meant for it.
    expect(escapeStep(nothing, true)).toBe('going');
    expect(escapeStep({ ...nothing, notes: true }, true)).toBe('going');
    expect(escapeStep({ ...nothing, reading: pages }, true)).toBe('over');
  });

  it('is Esc’s over a lobby or the audience, where nothing took the key first', () => {
    const open = vi.fn();
    const onKey = escapeOpensMenu(open);
    const esc = { ...keyDown('Escape'), defaultPrevented: false };
    onKey(esc);
    expect(open).toHaveBeenCalledTimes(1);
    expect(esc.preventDefault).toHaveBeenCalled();
    onKey({ ...keyDown('Escape'), defaultPrevented: true });
    onKey({ ...keyDown('a'), defaultPrevented: false });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('is the HUD’s menu button, named with its key', () => {
    const html = renderToStaticMarkup(
      <MissionHud
        view={runView()}
        positionsRef={{ current: { run: null, players: {} } }}
        chatsRef={{ current: [] }}
        onAir={false}
        onOpenInfo={noop}
        onOpenMenu={noop}
        notesOpen={false}
        onToggleNotes={noop}
      />,
    );
    expect(html).toMatch(/<button class="hud-info hud-menu">.*Menü \[Esc\]<\/button>/);
  });
});

describe('the keys over the pause menu', () => {
  /** A list of three items, the focus on `at`; each focus noted. */
  function nav(at: number): { nav: MenuNav; focused: number[] } {
    const focused: number[] = [];
    const items = [0, 1, 2].map((i) => ({ focus: () => focused.push(i) }));
    return { nav: { items: () => items, focused: () => at }, focused };
  }

  it('closes it with Esc, and keeps every key but the voice’s from the world', () => {
    const close = vi.fn();
    const onKey = menuKeyHandler(() => ({ nav: nav(0).nav, covered: false, close, talk: 'v' }));
    const esc = keyDown('Escape');
    onKey(esc);
    expect(close).toHaveBeenCalledTimes(1);
    expect(esc.stopPropagation).toHaveBeenCalled();
    for (const key of ['n', 'e', ' ', 'Enter', 'i']) {
      const down = keyDown(key);
      onKey(down);
      expect(down.stopPropagation, key).toHaveBeenCalled();
    }
    const talk = keyDown('V');
    onKey(talk);
    expect(talk.stopPropagation).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('steps between its items with the arrows, round at the ends', () => {
    const down = nav(2);
    const onKey = menuKeyHandler(() => ({ nav: down.nav, covered: false, close: noop, talk: 'v' }));
    onKey(keyDown('ArrowDown'));
    onKey(keyDown('ArrowUp'));
    expect(down.focused).toEqual([0, 1]);
  });

  it('leaves every key to the settings or the booklet over it', () => {
    const close = vi.fn();
    const onKey = menuKeyHandler(() => ({ nav: nav(0).nav, covered: true, close, talk: 'v' }));
    const esc = keyDown('Escape');
    onKey(esc);
    expect(close).not.toHaveBeenCalled();
    expect(esc.stopPropagation).not.toHaveBeenCalled();
  });

  it('tells its keys apart', () => {
    expect(menuKeyOf('Escape', 'v')).toBe('close');
    expect(['ArrowUp', 'ArrowDown', 'Home', 'End'].map((k) => menuKeyOf(k, 'v'))).toEqual([
      'step',
      'step',
      'step',
      'step',
    ]);
    expect(menuKeyOf('g', 'g')).toBe('voice');
    expect(menuKeyOf('Tab', 'v')).toBe('kept');
  });
});

describe('the crew at the menu', () => {
  it('stands in the strip as „im Menü", before what they do', () => {
    const at = { stationId: null, console: null, manualId: null, signSeen: false };
    const anna = { id: 'p1', connected: true, menu: 'pause' as const };
    expect(crewTags(null, anna, at, undefined).map((tag) => tag.text)).toEqual(['im Menü']);
    expect(crewTags(null, { id: 'p1', connected: true }, at, undefined)).toEqual([]);
    expect(crewTags(null, { ...anna, connected: false }, at, undefined)[0]?.text).toBe(
      'getrennt',
    );
  });

  it('is told the server while the menu stands open over a run, until a view agrees', () => {
    expect(menuNews(runView(), true)).toEqual({ kind: 'pause-menu', open: true });
    expect(menuNews(runView(), false)).toBeNull();
    const ben = runView();
    const marked = { ...ben, players: ben.players.map((p) => ({ ...p, menu: 'pause' as const })) };
    expect(markedAtMenu(marked)).toBe(true);
    expect(menuNews(marked, true)).toBeNull();
    expect(menuNews(marked, false)).toEqual({ kind: 'pause-menu', open: false });
    expect(menuNews({ ...runView(), phase: 'lobby' }, true)).toBeNull();
    expect(menuNews(null, true)).toBeNull();
  });
});
