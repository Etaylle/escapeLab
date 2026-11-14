import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ManualHere, PlayerView } from '@escapelab/core';
import { roomMission } from '../src/App.js';
import {
  escapeOpensMenu,
  gearOpens,
  markedAtMenu,
  menuNews,
  NOTHING_OPEN,
  pausePhaseOf,
  startPressed,
} from '../src/menuLayer.js';
import { crewTags } from '../src/screens/Crew.js';
import { escapeStep } from '../src/screens/Game.js';
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

  it('names the room’s mission: the run’s, the lobby’s, the audience’s', () => {
    expect(roomMission({ view: runView(), spectatorView: null })).toEqual({
      id: 'blackout',
      title: 'Blackout im Labor',
    });
    expect(roomMission({ view: null, spectatorView: null })).toBeNull();
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
