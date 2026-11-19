import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  initialState,
  parseMission,
  viewFor,
  type Action,
  type GameState,
  type PlayerView,
} from '@escapelab/core';
import { RESTING_GOAL, StageTop, type ColdOpen } from '../src/screens/Game.js';
import { contextAction, promptText, RESTING_PROMPT } from '../src/world/interact.js';
import { restingTitle } from '../src/world/known.js';
import { iconsAsWords, mapWith, type Station } from './fixtures.js';

/**
 * A station that was switched on rests through an emergency and comes back with what the crew
 * had done at it (core state.ts `resting`): what its console and the goal line say meanwhile.
 */

const T0 = 1_700_000_000_000;

/** The Paketfilter's probe (tools/fixtures), an emergency at two valves added to its map. */
const mission = (() => {
  const file = new URL('../../../tools/fixtures/firewall-probe.json', import.meta.url);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const sabotage = {
    label: 'KÜHLUNG AUSGEFALLEN',
    afterSolved: 0,
    panels: [
      { id: 'links', x: 1, y: 5 },
      { id: 'rechts', x: 17, y: 5 },
    ],
  };
  return parseMission({ ...raw, map: { ...raw.map, sabotage } });
})();

const NOBODY = { manuals: {}, notes: {}, plates: {}, signSeen: [], found: {}, sight: {}, exit: [] };
const begun: Action[] = [
  { type: 'player-join', playerId: 'p1', name: 'Anna' },
  { type: 'player-join', playerId: 'p2', name: 'Ben' },
  { type: 'set-ready', playerId: 'p2', ready: true },
  { type: 'start-mission', playerId: 'p1', at: T0, seed: 3 },
  { type: 'lights-out', at: T0 },
  { type: 'set-presence', ...NOBODY, stations: { filter: ['p1'] }, at: T0 + 100 },
];
const on: Action = { type: 'interact', playerId: 'p1', at: T0 + 500 };
const emergency: Action = { type: 'sabotage-start', at: T0 + 5000 };
const over: Action = { type: 'sabotage-cleared', at: T0 + 20_000 };

const run = (actions: Action[]): GameState => actions.reduce(applyAction, initialState(mission));
const anna = (actions: Action[]): PlayerView => viewFor(run(actions), 'p1');

const LIT: ColdOpen = {
  darkSince: T0,
  dark: true,
  intro: false,
  flashUntil: null,
  gates: { sign: T0, line: T0 },
};

/** The goal line's title as Anna's objective bar draws it. */
function goalTitle(view: PlayerView): string {
  if (view.map === null) {
    throw new Error('the run has no map');
  }
  const bar = (
    <StageTop
      view={view}
      map={view.map}
      coldOpen={LIT}
      notice={null}
      alarmVisible={false}
      row={null}
    />
  );
  const html = iconsAsWords(renderToStaticMarkup(bar));
  return /<h1>(.*?)<\/h1>/.exec(html)?.[1] ?? '';
}

describe('the goal line while a station rests', () => {
  it('names the station and says that what was done at it stands', () => {
    const view = anna([...begun, on, emergency]);
    expect(view.puzzle).toBeNull();
    expect(goalTitle(view)).toBe('Paketfilter ruht — Stand gehalten');
    expect(RESTING_GOAL).toBe('ruht — Stand gehalten');
  });

  it('says so of no station that was not switched on, and of none once it is over', () => {
    expect(goalTitle(anna([...begun, emergency]))).toBe('Paketfilter');
    expect(goalTitle(anna([...begun, on, emergency, over]))).toBe('Paketfilter');
    expect(goalTitle(anna([...begun, on]))).toBe('Paketfilter');
  });

  it('stands in the title, 14 px at least on the bar and in a phone’s row', () => {
    const px = (sheet: string, rule: string): number => {
      const css = readFileSync(new URL(`../src/${sheet}`, import.meta.url), 'utf8');
      const body = css.slice(css.indexOf(`${rule} {`)).split('}')[0] ?? '';
      return Number(/font-size: calc\((\d+)px \* var\(--text-scale\)\)/.exec(body)?.[1]);
    };
    expect(px('ui.css', '\n.stage-goal h1')).toBe(20);
    expect(px('styles/pwa.css', '.stage-row .stage-goal h1')).toBe(16);
  });
});

describe('the console of a station that rests', () => {
  const armed: Station = {
    puzzleId: 'filter',
    x: 5,
    y: 5,
    title: 'Paketfilter',
    status: 'armed',
    found: true,
    known: true,
  };
  const at = { x: 5.5, y: 6.2 };
  const here = (station: Station) =>
    contextAction(mapWith({ stations: [station] }), at, 'p1', [], false, null);

  it('says until when, and E does nothing at it', () => {
    const action = here({ ...armed, resting: true });
    expect(action).toMatchObject({ kind: 'locked', label: RESTING_PROMPT });
    expect(RESTING_PROMPT).toBe('Ruht, bis der Notfall behoben ist');
    // a thing E does nothing at carries no key
    expect(action === null ? '' : promptText(action, true)).toBe(RESTING_PROMPT);
  });

  it('is worked as ever where the station does not rest', () => {
    expect(here(armed)).toMatchObject({ kind: 'operate', label: 'Bedienen' });
  });

  it('reads „Bedienen" again once the emergency is over, and E opens the device', () => {
    const console = { x: 4.5, y: 2.2 };
    const prompt = (actions: Action[]) => {
      const view = anna(actions);
      const map = view.map ?? mapWith({});
      const action = contextAction(map, console, view.you.id, [], view.puzzle !== null, null);
      return action === null ? null : [action.kind, promptText(action, false)];
    };
    expect(prompt([...begun, on, emergency])).toEqual(['locked', RESTING_PROMPT]);
    expect(prompt([...begun, on, emergency, over])).toEqual(['operate', 'Bedienen']);
    expect(anna([...begun, on, emergency, over]).puzzle?.kind).toBe('firewall');
  });

  it('is told from the server’s view: both consoles of the resting station, nothing of it', () => {
    const view = anna([...begun, on, emergency]);
    const spots = view.map?.stations ?? [];
    expect(spots.map((s) => s.known && s.resting)).toEqual([true, true]);
    expect(restingTitle({ stations: spots })).toBe('Paketfilter');
    expect(restingTitle({ stations: anna([...begun, emergency]).map?.stations ?? [] })).toBeNull();
    expect(restingTitle({ stations: anna([...begun, on]).map?.stations ?? [] })).toBeNull();
  });
});
