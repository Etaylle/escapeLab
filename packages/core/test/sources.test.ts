import { describe, expect, it } from 'vitest';
import { applyAction, parseMission, viewFor, viewForSpectator } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { standing, started, T0 } from './lab.js';

/**
 * A corridor with the wiring box and the keypad at its west end, and at its
 * east end the sources: a chart for the wiring that may hang on any of three
 * spots, a locker and a cabinet for the keypad. The cabinet's key lies at
 * the west end, by the spawns.
 *
 *   0123456789012345
 * 0 ################
 * 1 #..............#   stations (3,1) and (5,1); chart on (10,1), (11,1) or (12,1)
 * 2 #..............#   key (1,2); locker (10,2); cabinet (12,2); sign (14,2)
 * 3 ################
 */
function raw(overrides: { map?: object; puzzles?: object[] } = {}) {
  return {
    id: 'quellen',
    title: 'Quellen',
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: overrides.puzzles ?? [
      { type: 'wiring', id: 'kabel', title: 'Kabel' },
      { type: 'keypad', id: 'code', title: 'Code' },
    ],
    map: {
      tiles: ['################', '#..............#', '#..............#', '################'],
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      stations: [
        { puzzleId: 'kabel', x: 3, y: 1 },
        { puzzleId: 'code', x: 5, y: 1 },
      ],
      manuals: [
        {
          id: 'tafel',
          kind: 'chart',
          label: 'TAFEL',
          puzzleIds: ['kabel'],
          spots: [
            { x: 10, y: 1 },
            { x: 11, y: 1 },
            { x: 12, y: 1 },
          ],
        },
        {
          id: 'spind',
          kind: 'locker',
          label: 'SPIND',
          puzzleIds: ['code'],
          spots: [{ x: 10, y: 2 }],
        },
        {
          id: 'schrank',
          kind: 'cabinet',
          label: 'SCHRANK',
          puzzleIds: ['code'],
          spots: [{ x: 12, y: 2 }],
          needsKey: 'schluessel',
        },
      ],
      items: [{ id: 'schluessel', label: 'SCHLÜSSEL', x: 1, y: 2 }],
      edgeworkSign: { x: 14, y: 2 },
      labels: [
        { text: 'WERKSTATT', x: 2, y: 2 },
        { text: 'LAGER', x: 11, y: 2 },
      ],
      ...overrides.map,
    },
  };
}

const mission: Mission = parseMission(raw());

const open = (playerId: string, manualId: string, at = T0 + 1000): Action => ({
  type: 'open-source',
  playerId,
  manualId,
  at,
});

/** The keypad switched on with p1 at it; the wiring before it solved by a shortcut. */
function atKeypad(state: GameState): GameState {
  const keypad: GameState = { ...state, currentPuzzleIndex: 1 };
  const here = standing(keypad, { stations: { code: ['p1'] } });
  return applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
}

describe('where the sources lie', () => {
  it('puts every source on one of its spots, drawn from the seed', () => {
    const tafel = (seed: number) => started(mission, seed).places['tafel'];
    const spots = mission.map.manuals[0]?.spots ?? [];
    const drawn = Array.from({ length: 40 }, (_, seed) => tafel(seed));
    expect(spots).toEqual(expect.arrayContaining(drawn));
    expect(new Set(drawn.map((spot) => JSON.stringify(spot))).size).toBe(spots.length);
    expect(tafel(5)).toEqual(tafel(5));
    expect(started(mission).places).toMatchObject({
      spind: { x: 10, y: 2 },
      schrank: { x: 12, y: 2 },
    });
  });

  it('shows the crew only what somebody came close to, for good; the audience sees all', () => {
    const state = started(mission);
    expect(viewFor(state, 'p1').map?.manuals).toEqual([]);
    const found = standing(standing(state, { seen: ['tafel', 'spind'] }), { seen: [] });
    expect(found.discovered).toEqual(['spind', 'tafel']);
    expect(viewFor(found, 'p2').map?.manuals).toEqual([
      {
        ...state.places['tafel'],
        id: 'tafel',
        kind: 'chart',
        label: 'TAFEL',
        puzzleIds: ['kabel'],
        opened: true,
        needsKey: null,
      },
      {
        x: 10,
        y: 2,
        id: 'spind',
        kind: 'locker',
        label: 'SPIND',
        puzzleIds: ['code'],
        opened: false,
        needsKey: null,
      },
    ]);
    expect(viewForSpectator(state).map?.manuals.map((m) => m.id)).toEqual([
      'tafel',
      'spind',
      'schrank',
    ]);
  });
});

describe('a locker', () => {
  it('is read only once it is searched, by a player standing at it', () => {
    const state = standing(started(mission), { manuals: { spind: ['p2'] } });
    const closed = viewFor(state, 'p2');
    expect(closed.sourcesHere).toEqual([
      { id: 'spind', kind: 'locker', label: 'SPIND', opened: false, needsKey: null },
    ]);
    expect(closed.manualsHere).toEqual([]);
    expect(closed.presence.manualId).toBeNull();
    const searched = applyAction(state, open('p2', 'spind'));
    expect(searched.opened).toEqual(['spind']);
    expect(viewFor(searched, 'p2').sourcesHere[0]?.opened).toBe(true);
    expect(viewFor(searched, 'p2').manualsHere.map((m) => m.id)).toEqual(['spind']);
    expect(searched.events.at(-1)).toEqual({
      at: T0 + 1000,
      kind: 'find',
      label: 'Spind durchsucht: SPIND',
      seconds: null,
    });
    expect(searched.credits['p2']?.found).toBe(1);
  });

  it('turns away a player who is not at it, a second search and what needs no opening', () => {
    const state = standing(started(mission), { manuals: { spind: ['p2'], tafel: ['p1'] } });
    expect(() => applyAction(state, open('p1', 'spind'))).toThrow(
      'Nur direkt davor.',
    );
    const searched = applyAction(state, open('p2', 'spind'));
    expect(() => applyAction(searched, open('p2', 'spind'))).toThrow('Das ist schon offen.');
    expect(() => applyAction(state, open('p1', 'tafel'))).toThrow('Das ist schon offen.');
    expect(() => applyAction(state, open('p1', 'gibtsnicht'))).toThrow('Das gibt es hier nicht.');
  });

  it('gives its rules to whoever stands at it once searched, while the station is open', () => {
    const state = atKeypad(started(mission));
    const here = standing(state, { stations: { code: ['p1'] }, manuals: { spind: ['p2'] } });
    expect(viewFor(here, 'p2').puzzle?.manual).toBeNull();
    const searched = applyAction(here, open('p2', 'spind', T0 + 2000));
    expect(viewFor(searched, 'p2').puzzle?.manual).not.toBeNull();
    expect(searched.credits['p2']).toMatchObject({ found: 1, read: 1 });
  });
});

describe('a cabinet', () => {
  const pick: Action = { type: 'pick-item', playerId: 'p1', itemId: 'schluessel', at: T0 + 100 };

  it('opens only for the player who brings its key, and keeps the key in its lock', () => {
    const state = standing(started(mission), { manuals: { schrank: ['p1'] } });
    expect(viewFor(state, 'p1').sourcesHere).toEqual([
      { id: 'schrank', kind: 'cabinet', label: 'SCHRANK', opened: false, needsKey: 'schluessel' },
    ]);
    expect(() => applyAction(state, open('p1', 'schrank'))).toThrow(
      'Abgeschlossen — es fehlt SCHLÜSSEL.',
    );
    const unlocked = applyAction(applyAction(state, pick), open('p1', 'schrank'));
    expect(unlocked.opened).toEqual(['schrank']);
    expect(unlocked.items['schluessel']).toEqual({
      x: 12.5,
      y: 2.5,
      carriedBy: null,
      delivered: true,
    });
    expect(unlocked.events.at(-1)?.label).toBe('Schrank aufgeschlossen: SCHRANK');
    expect(unlocked.credits['p1']).toMatchObject({ found: 1, delivered: 1 });
    expect(viewFor(unlocked, 'p1').manualsHere.map((m) => m.id)).toEqual(['schrank']);
  });

  it('leads its key nowhere until the crew has found it, and is no drop-off of its own', () => {
    const carrying = applyAction(started(mission), pick);
    const key = (state: GameState) => viewFor(state, 'p1').map?.items[0]?.deliverTo;
    expect(key(carrying)).toBeNull();
    expect(key(standing(carrying, { seen: ['schrank'] }))).toEqual({ x: 12, y: 2 });
    expect(viewForSpectator(carrying).map?.items[0]?.deliverTo).toEqual({ x: 12, y: 2 });
    expect(() =>
      applyAction(carrying, { type: 'deliver-item', playerId: 'p1', itemId: 'schluessel', at: T0 }),
    ).toThrow(/gehört in ein Schloss/);
  });
});

describe('sources in the mission format', () => {
  const manuals = mission.map.manuals;
  const withManuals = (list: unknown[]) => raw({ map: { manuals: list } });

  it('takes a key on a cabinet only, which needs one, and only an item the map has', () => {
    const [tafel, spind, schrank] = manuals;
    const keyed = { ...tafel, needsKey: 'schluessel' };
    expect(() => parseMission(withManuals([keyed, spind, schrank]))).toThrow(
      /only a cabinet takes a key, but "tafel" is a chart/,
    );
    const keyless = { ...schrank, needsKey: undefined };
    expect(() => parseMission(withManuals([tafel, spind, keyless]))).toThrow(
      /cabinet "schrank" needs a key/,
    );
    const strange = { ...schrank, needsKey: 'nix' };
    expect(() => parseMission(withManuals([tafel, spind, strange]))).toThrow(
      /"schrank" needs unknown item "nix" as its key/,
    );
    const second = { ...schrank, id: 'schrank2', spots: [{ x: 13, y: 2 }] };
    expect(() => parseMission(withManuals([tafel, spind, schrank, second]))).toThrow(
      /item "schluessel" cannot unlock both "schrank" and "schrank2"/,
    );
  });

  it('sends a key into its cabinet and nowhere else, and every other item somewhere', () => {
    const key = { id: 'schluessel', label: 'SCHLÜSSEL', x: 1, y: 2 };
    expect(() =>
      parseMission(raw({ map: { items: [{ ...key, deliverTo: { x: 2, y: 2 } }] } })),
    ).toThrow(/item "schluessel" is a key and goes into its cabinet/);
    expect(() =>
      parseMission(raw({ map: { items: [key, { ...key, id: 'kiste', label: 'KISTE' }] } })),
    ).toThrow(/item "kiste" has no deliverTo/);
  });

  it('lets no two sources be drawn to the same tile', () => {
    const [tafel, spind, schrank] = manuals;
    const crowded = { ...spind, spots: [{ x: 11, y: 1 }] };
    expect(() => parseMission(withManuals([tafel, crowded, schrank]))).toThrow(
      /manual objects "tafel" and "spind" may both be drawn to 11,1/,
    );
  });

  it('checks every spot a source may be drawn to, and the key on the way to a cabinet', () => {
    // A door the wiring opens cuts the east end off; the chart's spots lie behind it.
    const door = [{ id: 'tuer', x: 7, y: 1, opensBy: { kind: 'puzzle', puzzleId: 'kabel' } }];
    const wall = ['################', '#..............#', '#......#.......#', '################'];
    expect(() => parseMission(raw({ map: { tiles: wall, doors: door } }))).toThrow(
      /nobody can reach manual object "tafel" at 10,1 while puzzle "kabel" is open/,
    );
    // Behind the door the cabinet waits for the keypad — but its key lies behind a second door.
    const keyed = {
      tiles: wall,
      doors: [
        { id: 'tuer', x: 7, y: 1, opensBy: { kind: 'puzzle', puzzleId: 'code' } },
      ],
      manuals: [
        { ...manuals[0], spots: [{ x: 2, y: 2 }, { x: 3, y: 2 }] },
        { ...manuals[1], spots: [{ x: 4, y: 2 }] },
        { ...manuals[2], puzzleIds: ['code'], spots: [{ x: 6, y: 2 }] },
      ],
      items: [{ id: 'schluessel', label: 'SCHLÜSSEL', x: 9, y: 2 }],
      edgeworkSign: { x: 1, y: 2 },
    };
    expect(() => parseMission(raw({ map: keyed }))).toThrow(
      /nobody can carry "schluessel" to cabinet "schrank" at 6,2 while puzzle "code" is open/,
    );
  });
});

describe('rooms that light up', () => {
  const lit = (lights: string[]) =>
    raw({
      puzzles: [
        { type: 'wiring', id: 'kabel', title: 'Kabel', lights },
        { type: 'keypad', id: 'code', title: 'Code', lights: ['LAGER', 'WERKSTATT'] },
      ],
    });

  it('lists the rooms each solved station lights, each once, first lit first', () => {
    const state = started(parseMission(lit(['WERKSTATT'])));
    expect(viewFor(state, 'p1').map?.litRooms).toEqual([]);
    expect(viewFor({ ...state, currentPuzzleIndex: 1 }, 'p1').map?.litRooms).toEqual(['WERKSTATT']);
    expect(viewFor({ ...state, currentPuzzleIndex: 2 }, 'p1').map?.litRooms).toEqual([
      'WERKSTATT',
      'LAGER',
    ]);
  });

  it('only lights rooms a label on the map names', () => {
    expect(() => parseMission(lit(['KELLER']))).toThrow(
      /puzzle "kabel" lights "KELLER", but no label on the map reads so/,
    );
  });
});
