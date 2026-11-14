import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  initialState,
  parseMission,
  scaleMission,
  viewFor,
  type Action,
  type GameState,
  type PlayerView,
} from '@escapelab/core';
import { offVoice, WORLD } from '../../core/test/voice.js';
import { StageTop, type ColdOpen, type RowParts } from '../src/screens/Game.js';
import { handsLine } from '../src/screens/hands.js';

const T0 = 1_700_000_000_000;

const blackout = scaleMission(
  parseMission(
    JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
  ),
  'normal',
);

/** Blackout on the harness's seed for `names` — p1, p2, … — its lights out. */
function blackoutFor(names: string[]): GameState {
  const ids = names.map((_, i) => `p${i + 1}`);
  const actions: Action[] = [
    ...names.map((name, i): Action => ({ type: 'player-join', playerId: ids[i] ?? '', name })),
    ...ids.slice(1).map((playerId): Action => ({ type: 'set-ready', playerId, ready: true })),
    { type: 'start-mission', playerId: 'p1', at: T0, seed: 5 },
    { type: 'lights-out', at: T0 + 5000 },
  ];
  return actions.reduce(applyAction, initialState(blackout));
}

/** Who stands where and what they have found, as the room reports it, at the station `id`. */
type Standing = Partial<Omit<Extract<Action, { type: 'set-presence' }>, 'type' | 'at'>>;

/**
 * Anna (p1), Ben (p2) and Cleo (p3) at Blackout's station `puzzleId` — as if every one before
 * it were solved — standing as `where` says.
 */
function three(puzzleId: string, where: Standing = {}): GameState {
  const state = blackoutFor(['Anna', 'Ben', 'Cleo']);
  const at = { ...state, currentPuzzleIndex: blackout.puzzles.findIndex((p) => p.id === puzzleId) };
  return applyAction(at, {
    type: 'set-presence',
    stations: {},
    manuals: {},
    notes: {},
    plates: {},
    signSeen: [],
    found: {},
    sight: {},
    exit: [],
    at: T0 + 6000,
    ...where,
  });
}

/** `playerId`'s view of `state`, with its map. */
function viewOf(state: GameState, playerId: string): PlayerView & { map: NonNullable<PlayerView['map']> } {
  const view = viewFor(state, playerId);
  if (view.map === null) {
    throw new Error('the run has no map');
  }
  return { ...view, map: view.map };
}

/** The hands line as `playerId`'s screen says it. */
const lineOf = (state: GameState, playerId: string): string | undefined => {
  const view = viewOf(state, playerId);
  return handsLine(view, view.map)?.line;
};

/** The Signalkette worked for three: Anna at A, Ben at B, Cleo reading the Klemmbrett. */
const SIGNALKETTE: Standing = {
  stations: { signalkette: ['p1'], 'signalkette/b': ['p2'] },
  manuals: { klemmbrett: ['p3'] },
  found: { p3: ['source:klemmbrett'] },
};

describe('the hands line', () => {
  it('names each hand at the Signalkette, this screen’s player first', () => {
    const state = three('signalkette', SIGNALKETTE);
    expect(lineOf(state, 'p3')).toBe('Cleo: Klemmbrett · Anna: Pult A · Ben: Pult B');
    expect(lineOf(state, 'p1')).toBe('Anna: Pult A · Ben: Pult B · Cleo: Klemmbrett');
    expect(lineOf(state, 'p2')).toBe('Ben: Pult B · Anna: Pult A · Cleo: Klemmbrett');
  });

  it('names the places nobody holds beside a hand without one: the book once it is known', () => {
    const manned = { stations: { notstrom: ['p1'], 'notstrom/b': ['p2'] } };
    expect(lineOf(three('notstrom', manned), 'p3')).toBe(
      'Cleo: frei — HALTEN · Anna: Pult A · Ben: Pult B',
    );
    const known = three('notstrom', { ...manned, found: { p2: ['source:buch-archiv'] } });
    expect(lineOf(known, 'p3')).toBe('Cleo: frei — Handbuch, HALTEN · Anna: Pult A · Ben: Pult B');
    const held = three('notstrom', { ...manned, plates: { flurplatte: ['p3'] } });
    expect(lineOf(held, 'p1')).toBe('Anna: Pult A · Ben: Pult B · Cleo: HALTEN');
  });

  it('names the open places once, beside the first hand without a place', () => {
    const one = three('notstrom', { stations: { 'notstrom/b': ['p2'] } });
    expect(lineOf(one, 'p3')).toBe('Cleo: frei — Pult A, HALTEN · Anna: frei · Ben: Pult B');
    expect(lineOf(one, 'p2')).toBe('Ben: Pult B · Anna: frei — Pult A, HALTEN · Cleo: frei');
  });

  it('puts the whole crew at the main switch, and names it to whoever is not there yet', () => {
    const all = three('notlicht', { stations: { notlicht: ['p1', 'p2', 'p3'] } });
    expect(lineOf(all, 'p1')).toBe(
      'Anna: Hauptschalter · Ben: Hauptschalter · Cleo: Hauptschalter',
    );
    const late = three('notlicht', { stations: { notlicht: ['p1', 'p3'] } });
    expect(lineOf(late, 'p2')).toBe(
      'Ben: frei — Hauptschalter · Anna: Hauptschalter · Cleo: Hauptschalter',
    );
  });

  it('names a part in hand by its label, and a station of one console by its title', () => {
    const state = three('frequenz', { stations: { frequenz: ['p1'] } });
    const fuse = state.items['ersatzsicherung'] ?? { x: 0, y: 0, carriedBy: null, delivered: false };
    const carrying = { ...state, items: { ...state.items, ersatzsicherung: { ...fuse, carriedBy: 'p3' } } };
    expect(lineOf(carrying, 'p3')).toBe(
      'Cleo: SICHERUNG holen · Anna: Frequenz-Abgleich · Ben: frei',
    );
  });

  it('stays out for a crew of two', () => {
    const view = viewFor(blackoutFor(['Anna', 'Ben']), 'p1');
    expect(view.map).not.toBeNull();
    expect(view.map === null ? 'no map' : handsLine(view, view.map)).toBeNull();
  });

  it('speaks in the world’s voice: names and devices, nobody addressed or ordered', () => {
    const lines = [
      lineOf(three('signalkette', SIGNALKETTE), 'p3'),
      lineOf(three('notstrom', { found: { p2: ['source:buch-archiv'] } }), 'p1'),
      lineOf(three('notlicht'), 'p2'),
    ].filter((line): line is string => line !== undefined);
    expect(lines).toHaveLength(3);
    expect(offVoice(lines, WORLD)).toEqual([]);
  });
});

const DARK: ColdOpen = {
  darkSince: T0,
  dark: true,
  intro: true,
  flashUntil: null,
  gates: { sign: T0, line: T0 },
};

const PARTS: RowParts = {
  crew: <span className="probe-crew" />,
  tools: <span className="probe-tools" />,
};

/** The objective bar on `playerId`'s screen, folded into the phone's row where `row`. */
function bar(state: GameState, playerId: string, row: RowParts | null): string {
  const view = viewOf(state, playerId);
  return renderToStaticMarkup(
    <StageTop
      view={view}
      map={view.map}
      coldOpen={DARK}
      notice={null}
      alarmVisible={false}
      row={row}
    />,
  );
}

describe('the hands on the objective bar', () => {
  it('stand under the goal’s title, before what is still missing', () => {
    const html = bar(three('signalkette', SIGNALKETTE), 'p3', null);
    const hands = html.indexOf('<span class="stage-sub stage-hands">Cleo: Klemmbrett · Anna');
    expect(hands).toBeGreaterThan(html.indexOf('</h1>'));
    expect(html).not.toContain('hands-chip');
  });

  it('fold to the own job alone as a chip in the phone’s row, the whole line hidden there', () => {
    const html = bar(three('signalkette', SIGNALKETTE), 'p3', PARTS);
    expect(html).toContain('<span class="hands-chip">Cleo: Klemmbrett</span>');
    expect(html.indexOf('hands-chip')).toBeLessThan(html.indexOf('probe-crew'));
    const css = readFileSync(new URL('../src/styles/gameplay.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.stage-row \.stage-hands \{\s*display: none;/);
  });

  it('give way to an open device, whose Laborkennung row lies over them, keeping their place', () => {
    const css = readFileSync(new URL('../src/styles/gameplay.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.game:has\(\.station-modal\) \.stage-hands \{\s*visibility: hidden;/);
  });

  it('leave the bar of a crew of two as it was', () => {
    for (const row of [null, PARTS]) {
      const html = bar(blackoutFor(['Anna', 'Ben']), 'p1', row);
      expect(html).not.toContain('stage-hands');
      expect(html).not.toContain('hands-chip');
    }
  });
});
