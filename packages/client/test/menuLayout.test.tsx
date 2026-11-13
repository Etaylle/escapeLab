import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MissionInfo, RoomSummary, Seat } from '@escapelab/core';
import { PASS_KEY } from '../src/pass.js';
import { JoinScreen } from '../src/screens/Join.js';
import { MissionPanel, RoundsPanel } from '../src/screens/MenuPanels.js';
import { elementsOf, Sheets, type Screen, type Styled } from './cascade.js';
import { storage } from './page.js';

/**
 * The menu as the stylesheets lay it out, read the way the bundle orders them (cascade.ts): on a
 * laptop and a desktop the title and the profile over the menu; on a phone upright one column,
 * the profile under the title; on a phone held sideways the menu left, the title and the profile
 * right over the scene, a panel over all of it; every control on the menu and its panels a
 * target — 36 px under a pointer, 44 under a finger — and a phone's safe area kept clear. Whether
 * it all fits a window only a browser measures: the walkthrough does (tools/shots.mjs
 * `checkMenuPhones`).
 */

const sheets = new Sheets();
const noop = (): void => undefined;

/** The windows the menu is laid out for, and the target a control takes in each. */
const SCREENS: { name: string; screen: Screen; target: number }[] = [
  { name: 'a laptop’s 1280×720', screen: { width: 1280, height: 720, coarse: false }, target: 36 },
  { name: 'a desktop’s 1440×820', screen: { width: 1440, height: 820, coarse: false }, target: 36 },
  { name: 'a phone upright', screen: { width: 420, height: 760, coarse: true }, target: 44 },
  { name: 'a large phone sideways', screen: { width: 932, height: 430, coarse: true }, target: 44 },
  { name: 'a phone sideways', screen: { width: 844, height: 390, coarse: true }, target: 44 },
];
const [LAPTOP, DESKTOP, UPRIGHT, SIDEWAYS, SMALL] = SCREENS.map(({ screen }) => screen) as [
  Screen,
  Screen,
  Screen,
  Screen,
  Screen,
];

const mission = (id: string, title: string, stage?: MissionInfo['stage']): MissionInfo => ({
  id,
  title,
  subtitle: 'Der Klassiker.',
  players: { min: 2, max: 3 },
  timeLimitSec: 900,
  puzzleCount: 6,
  tiles: [],
  ...(stage === undefined ? {} : { stage }),
});

const MISSIONS = [
  mission('blackout', 'Blackout im Labor'),
  mission('systemcheck', 'Tutorial: Systemcheck'),
  mission('lager', 'Lager', 'prototype'),
];

/** A room of two for three in its lobby. */
const ROOM: RoomSummary = {
  code: 'QXT4',
  missionId: 'blackout',
  missionTitle: 'Blackout im Labor',
  difficulty: 'normal',
  phase: 'lobby',
  players: [
    { name: 'Anna', color: '#2dd4bf', connected: true },
    { name: 'Ben', color: '#f472b6', connected: true },
  ],
  capacity: 3,
  free: 1,
};

/** A run that binds the pass, standing paused. */
const BOUND: Seat = {
  code: 'QX7R',
  missionTitle: 'Blackout im Labor',
  phase: 'playing',
  paused: true,
  crew: ['Anna', 'Ben'],
  leftMs: 600_000,
};

/** Anna's browser, her name kept, the address asking for `search`. */
function stubWindow(search = ''): void {
  const pass = { id: 'a1'.repeat(16), secret: '0f'.repeat(32), name: 'Anna', color: null };
  const kept = new Map([[PASS_KEY, JSON.stringify(pass)]]);
  vi.stubGlobal('window', { location: { search }, localStorage: storage(kept) });
}

/** The start screen, the pass sitting as `seat` says, the join panel open for `?room=`. */
function menu(seat: Seat | null, search = ''): Styled[] {
  stubWindow(search);
  return elementsOf(
    renderToStaticMarkup(
      <JoinScreen
        send={noop}
        connected
        missions={MISSIONS}
        rooms={[ROOM]}
        seat={seat}
        stats={[]}
        picked={null}
        onPick={noop}
        openHandbook={noop}
        openHistory={noop}
        openEditor={noop}
        openSettings={noop}
      />,
    ),
  );
}

/** „Einsatz starten" and „Offene Runden" over the menu, as its panels stand in it. */
function panels(): Styled[] {
  stubWindow();
  const section = { send: noop, connected: true, name: 'Anna', blocked: false };
  return elementsOf(
    renderToStaticMarkup(
      <div className="menu">
        <MissionPanel
          {...section}
          missions={MISSIONS}
          stats={[]}
          picked={null}
          onPick={noop}
          onClose={noop}
        />
        <RoundsPanel {...section} rooms={[ROOM]} missions={MISSIONS} onClose={noop} />
      </div>,
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The first element of `nodes` with class `name`. */
function first(nodes: readonly Styled[], name: string): Styled {
  const node = nodes.find((each) => each.classes.includes(name));
  if (node === undefined) {
    throw new Error(`no .${name} in the markup`);
  }
  return node;
}

/** What `property` of `node` comes to on `screen`, as written, its spaces made one. */
const valueOf = (node: Styled, property: string, screen: Screen): string =>
  (sheets.declared(node, property, screen)?.value ?? '').replace(/\s+/g, ' ');

const CONTROL_TAGS = new Set(['button', 'input', 'select', 'summary']);

/** The controls among `nodes` that `screen` shows falling short of `target` in height. */
function shortOf(nodes: readonly Styled[], screen: Screen, target: number): string[] {
  return nodes
    .filter((node) => CONTROL_TAGS.has(node.tag) && !sheets.hidden(node, screen))
    .flatMap((node) => {
      const lengths = ['min-height', 'height', 'line-height'].map((property) =>
        sheets.length(node, property, screen),
      );
      const high = Math.max(0, ...lengths.filter((n) => !Number.isNaN(n)));
      return high < target ? [`${node.tag}.${node.classes.join('.')} ${Math.round(high)}`] : [];
    });
}

describe('the menu laid out', () => {
  it('stands the title and the profile over the menu on a laptop and a desktop', () => {
    const stage = first(menu(null), 'menu');
    for (const screen of [LAPTOP, DESKTOP]) {
      expect(valueOf(stage, 'grid-template-areas', screen)).toBe("'head chip' 'body body'");
    }
  });

  it('takes one column on a phone upright, the profile under the title', () => {
    const stage = first(menu(null), 'menu');
    expect(valueOf(stage, 'grid-template-areas', UPRIGHT)).toBe("'head' 'chip' 'body'");
    expect(valueOf(stage, 'grid-template-columns', UPRIGHT)).toBe('minmax(0, 1fr)');
  });

  it('keeps the menu left on a phone held sideways, the title and the profile right', () => {
    const nodes = menu(null);
    const stage = first(nodes, 'menu');
    for (const screen of [SIDEWAYS, SMALL]) {
      expect(valueOf(stage, 'grid-template-areas', screen)).toBe(
        "'body head' 'body chip' 'body .'",
      );
      expect(valueOf(first(nodes, 'menu-head'), 'justify-self', screen)).toBe('end');
      expect(valueOf(first(nodes, 'menu-body'), 'overflow-y', screen)).toBe('auto');
      expect(sheets.length(first(nodes, 'menu-item'), 'min-height', screen)).toBe(44);
    }
    // A panel takes the stage whole there; upright it stands over the menu alone.
    const panel = first(panels(), 'menu-panel');
    expect(valueOf(panel, 'grid-area', SMALL)).toBe('1 / 1 / -1 / -1');
    expect(valueOf(panel, 'grid-area', UPRIGHT)).toBe('body');
  });

  it('keeps a phone’s notch and its home bar clear of the menu', () => {
    const stage = first(menu(null), 'menu');
    for (const screen of [UPRIGHT, SIDEWAYS, SMALL]) {
      const padding = valueOf(stage, 'padding', screen);
      for (const side of ['left', 'right', 'bottom']) {
        expect(padding, `${screen.width}×${screen.height}`).toContain(
          `env(safe-area-inset-${side})`,
        );
      }
    }
  });

  it.each(SCREENS)('makes every control a target on $name', ({ screen, target }) => {
    const screens = [menu(null), menu(BOUND), menu(null, '?room=QXT4'), panels()];
    for (const nodes of screens) {
      expect(shortOf(nodes, screen, target)).toEqual([]);
    }
  });
});
