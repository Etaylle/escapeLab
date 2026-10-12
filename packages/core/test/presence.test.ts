import { describe, expect, it } from 'vitest';
import { applyAction, moduleFor, parseMission, viewFor, viewForSpectator } from '../src/index.js';
import type { Action, GameState, Mission, PuzzleView } from '../src/index.js';
import { labMission, openLab, standing, started, T0 } from './lab.js';

/** Two stations, each with its own book, and the sign; three players. */
const twoBooks: Mission = parseMission({
  id: 'zweibuecher',
  title: 'Zwei Bücher',
  story: { intro: 'i', win: 'w', lose: 'l' },
  players: { min: 3, max: 3 },
  timeLimitSec: 600,
  puzzles: [
    { type: 'wiring', id: 'kabel', title: 'Kabel' },
    { type: 'keypad', id: 'code', title: 'Code' },
  ],
  map: {
    tiles: ['##########', '#........#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
    stations: [
      { puzzleId: 'kabel', x: 3, y: 1 },
      { puzzleId: 'code', x: 5, y: 1 },
    ],
    manuals: [
      {
        id: 'buch-kabel',
        kind: 'book',
        label: 'KABELBUCH',
        puzzleIds: ['kabel'],
        spots: [{ x: 3, y: 2 }],
      },
      {
        id: 'terminal',
        kind: 'terminal',
        label: 'TERMINAL',
        puzzleIds: ['code'],
        spots: [{ x: 7, y: 2 }],
      },
    ],
    edgeworkSign: { x: 8, y: 1 },
  },
});

const input = (playerId: string, value: unknown, at = T0 + 1000): Action => ({
  type: 'puzzle-input',
  playerId,
  at,
  input: value,
});

/** The wiring station switched on with p1 at the box, nobody reading, nobody past the sign. */
function wiringOpen(): GameState {
  const here = standing(started(twoBooks), { stations: { kabel: ['p1'] } });
  return applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
}

function wiringOf(view: PuzzleView | null) {
  if (view?.kind !== 'wiring') {
    throw new Error('expected the wiring station');
  }
  return view;
}

describe('presence from the server', () => {
  it('is kept sorted without empty lists, and ignored outside a run', () => {
    const state = standing(started(twoBooks), {
      stations: { kabel: ['p2', 'p1'], code: [] },
      manuals: { terminal: ['p3'] },
      signSeen: ['p2'],
    });
    expect(state.presence).toEqual({
      stations: { kabel: ['p1', 'p2'] },
      manuals: { terminal: ['p3'] },
      signSeen: ['p2'],
    });
    const ended = applyAction(started(twoBooks), { type: 'time-expired', at: T0 + 600_000 });
    expect(standing(ended, { stations: { kabel: ['p1'] } }).presence).toEqual(ended.presence);
  });

  it('starts every run, rematch and lobby with nobody anywhere and nobody past the sign', () => {
    const seen = standing(started(twoBooks), { manuals: { terminal: ['p1'] }, signSeen: ['p1'] });
    const lost = applyAction(seen, { type: 'time-expired', at: T0 + 600_000 });
    const rematch: Action[] = [
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'set-ready', playerId: 'p3', ready: true },
      { type: 'rematch', playerId: 'p1', at: T0 + 700_000, seed: 3 },
    ];
    const again = rematch.reduce(applyAction, lost);
    const empty = { stations: {}, manuals: {}, signSeen: [] };
    expect(again.presence).toEqual(empty);
    expect(applyAction(lost, { type: 'back-to-lobby', playerId: 'p1' }).presence).toEqual(empty);
  });

  it('tells each player where they stand, the current station first', () => {
    const state = standing(started(twoBooks), {
      stations: { code: ['p1'], kabel: ['p1'] },
      manuals: { terminal: ['p2'], 'buch-kabel': ['p2'] },
      signSeen: ['p3'],
    });
    expect(viewFor(state, 'p1').presence).toEqual({
      stationId: 'kabel',
      console: 'a',
      manualId: null,
      signSeen: false,
    });
    expect(viewFor(state, 'p2').presence).toEqual({
      stationId: null,
      console: null,
      manualId: 'buch-kabel',
      signSeen: false,
    });
    expect(viewFor(state, 'p3').presence).toEqual({
      stationId: null,
      console: null,
      manualId: null,
      signSeen: true,
    });
    expect(viewForSpectator(state).players.map((p) => p.presence.stationId)).toEqual([
      'kabel',
      null,
      null,
    ]);
  });
});

describe('the operator gate', () => {
  it('refuses a move from anyone not standing at the open station', () => {
    const state = wiringOpen();
    const wireId = wiringOf(viewFor(state, 'p1').puzzle).wires?.[0]?.id ?? 'w0';
    expect(() => applyAction(state, input('p2', { wireId }))).toThrow(
      'Dafür musst du am Pult stehen.',
    );
    const there = standing(state, { stations: { kabel: ['p1', 'p2'] } });
    expect(applyAction(there, input('p2', { wireId })).puzzleState).not.toEqual(state.puzzleState);
  });

  it('keeps the station as it is when everybody walks away, and shows it again on return', () => {
    const state = wiringOpen();
    const wires = wiringOf(viewFor(state, 'p1').puzzle).wires ?? [];
    const cut = applyAction(state, input('p1', { wireId: wires[0]?.id ?? '' }));
    const away = standing(cut, {});
    expect(away.puzzleState).toEqual(cut.puzzleState);
    expect(wiringOf(viewFor(away, 'p1').puzzle)).toMatchObject({ wires: null, cutsDone: 1 });
    const back = standing(away, { stations: { kabel: ['p1'] } });
    expect(wiringOf(viewFor(back, 'p1').puzzle).wires?.[0]?.cut).toBe(true);
  });
});

describe('readers', () => {
  it('get the printed rules only at a manual object that covers the open station', () => {
    const state = standing(wiringOpen(), {
      stations: { kabel: ['p1'] },
      manuals: { 'buch-kabel': ['p2'], terminal: ['p3'] },
    });
    const def = state.mission.puzzles[0];
    if (def === undefined) {
      throw new Error('expected the wiring puzzle');
    }
    expect(viewFor(state, 'p2').puzzle?.manual).toEqual(moduleFor(def.type).manual(def));
    expect(viewFor(state, 'p1').puzzle?.manual).toBeNull();
    expect(viewFor(state, 'p3').puzzle?.manual).toBeNull();
  });

  it('read every rule a manual object prints, in mission order, open puzzle or not', () => {
    const state = standing(started(twoBooks), { manuals: { terminal: ['p1'] } });
    const [code] = state.mission.puzzles.slice(1);
    if (code === undefined) {
      throw new Error('expected the keypad puzzle');
    }
    expect(viewFor(state, 'p1').manualsHere).toEqual([
      {
        id: 'terminal',
        label: 'TERMINAL',
        kind: 'terminal',
        sections: [
          {
            puzzleId: 'code',
            index: 1,
            title: 'Code',
            manual: moduleFor(code.type).manual(code),
            notes: [],
            noteReadyAt: null,
            notesLeft: 0,
            costSec: state.mission.hintCostSec,
          },
        ],
      },
    ]);
    expect(viewFor(state, 'p2').manualsHere).toEqual([]);
  });
});

describe('the edgework sign', () => {
  it('reaches nobody before they walk up to it, and stays with whoever did', () => {
    const state = wiringOpen();
    const serial = state.edgework?.serial ?? '?';
    for (const playerId of ['p1', 'p2', 'p3']) {
      expect(viewFor(state, playerId).edgework).toBeNull();
      expect(JSON.stringify(viewFor(state, playerId))).not.toContain(serial);
    }
    const passed = standing(standing(state, { signSeen: ['p2'] }), {});
    expect(viewFor(passed, 'p2').edgework).toEqual(state.edgework);
    expect(JSON.stringify(viewFor(passed, 'p1'))).not.toContain(serial);
  });
});

/** Where each station type keeps the instance only operators may see. */
const INSTANCE: Record<string, keyof PuzzleView | string> = {
  wiring: 'wires',
  keypad: 'keys',
  switches: 'switches',
  simon: 'flashes',
  memory: 'labels',
  morse: 'pattern',
  button: 'colour',
  maze: 'pos',
};

describe.each(Object.entries(INSTANCE))('the %s instance', (type, field) => {
  const mission = labMission([{ type, id: 'x', title: 'X' }], `leak-${type}`, 3);

  it('reaches the operator and the audience, never the reader or a bystander', () => {
    // p1 at the station, p2 at the book, p3 anywhere else; all of them past the sign.
    const state = openLab(started(mission), { signSeen: ['p1', 'p2', 'p3'] });
    const shown = (playerId: string): unknown =>
      (viewFor(state, playerId).puzzle as Record<string, unknown> | null)?.[field];
    const instance = shown('p1');
    expect(instance).not.toBeNull();
    expect((viewForSpectator(state).puzzle as Record<string, unknown> | null)?.[field]).toEqual(
      instance,
    );
    for (const playerId of ['p2', 'p3']) {
      expect(shown(playerId), playerId).toBeNull();
      expect(JSON.stringify(viewFor(state, playerId)), playerId).not.toContain(
        JSON.stringify(instance),
      );
    }
  });
});

describe('the maze plan', () => {
  it('goes to readers only: neither the navigator nor a bystander gets the walls', () => {
    const mission = labMission([{ type: 'maze', id: 'netz', title: 'Netz' }], 'plan', 3);
    // p1 at the navigation desk, p2 at the plan, p3 anywhere else.
    const state = openLab(started(mission));
    const cells = (playerId: string) =>
      (viewFor(state, playerId).puzzle as { cells?: number[] | null } | null)?.cells;
    expect(cells('p2')).toHaveLength(36);
    expect(cells('p1')).toBeNull();
    expect(cells('p3')).toBeNull();
    expect(JSON.stringify(viewFor(state, 'p1'))).not.toContain(JSON.stringify(cells('p2')));
  });
});

describe('button-sync by players', () => {
  const mission = labMission(
    [{ type: 'button-sync', id: 'sync', title: 'Sync', windowMs: 2000 }],
    'sync',
    3,
  );
  const press = (playerId: string, at: number): Action => input(playerId, { press: true }, at);

  function syncOpen(at = T0 + 500): GameState {
    const here = standing(started(mission), { stations: { sync: ['p1', 'p2', 'p3'] } });
    return applyAction(here, { type: 'interact', playerId: 'p1', at });
  }

  it('needs a press from every connected player, each standing at the station', () => {
    let state = syncOpen();
    state = applyAction(applyAction(state, press('p1', T0 + 1000)), press('p2', T0 + 1200));
    expect(state.currentPuzzleIndex).toBe(0);
    expect(viewFor(state, 'p3').puzzle).toMatchObject({
      youPressed: false,
      pressedCount: 2,
      requiredCount: 3,
    });
    expect(viewFor(state, 'p1').puzzle).toMatchObject({ youPressed: true });
    state = applyAction(state, press('p3', T0 + 1500));
    expect(state.phase).toBe('won');
  });

  it('refuses a press from a player away from the station', () => {
    const state = standing(syncOpen(), { stations: { sync: ['p1', 'p2'] } });
    expect(() => applyAction(state, press('p3', T0 + 1000))).toThrow(
      'Dafür musst du am Pult stehen.',
    );
  });

  it('keys the presses by player: a second press from the same player is not another one', () => {
    let state = syncOpen();
    state = applyAction(applyAction(state, press('p1', T0 + 1000)), press('p1', T0 + 1100));
    expect(viewFor(state, 'p2').puzzle).toMatchObject({ pressedCount: 1 });
  });

  it('lets the presses expire outside the window', () => {
    let state = syncOpen();
    state = applyAction(state, press('p1', T0 + 1000));
    state = applyAction(state, press('p2', T0 + 1500));
    state = applyAction(state, press('p3', T0 + 4000));
    expect(state.currentPuzzleIndex).toBe(0);
    expect(viewFor(state, 'p1').puzzle).toMatchObject({ attempts: 1, lastResult: 'missed-window' });
  });
});
