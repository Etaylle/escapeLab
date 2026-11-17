import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  armedPuzzleIds,
  checkMission,
  doorOpen,
  drawPools,
  emergenciesDue,
  everyDraw,
  GameError,
  inEscapePhase,
  labLit,
  moduleFor,
  outOfService,
  parseMission,
  patrollingDrones,
  placesOf,
  runOrder,
  runReport,
  scaleMission,
  sealedSnapshotSchema,
  stationCount,
  stationsOfRun,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { GameState, Mission, PlayerView } from '../src/index.js';
import { standing, started, T0 } from './lab.js';
import {
  playProbe,
  PROBE_POOL,
  probeSeeds,
  rotationPlan,
  rotationProbe,
  seedDrawing,
} from './rotationPlan.js';

/**
 * A corridor lab in a chain of three places — Eins (3,1), the pool „mitte" of Xa (6,1), Xb
 * (9,1) and Xc (12,1), Drei (19,1) behind a door (16,1…2 walled, door at 16,2) the pool opens —
 * every station pressed by the whole crew, so that a test solves one with two presses.
 *
 *   0123456789012345678901
 * 0 ######################
 * 1 #..1..a..b..c...#..3.#   spawns (1,1) and (1,2)
 * 2 #...............D....#   door (16,2)
 * 3 ######################
 */
function turnLabData(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'wechsel',
    title: 'Wechsel',
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [
      { type: 'button-sync', id: 'eins', title: 'Eins' },
      { type: 'button-sync', id: 'xa', title: 'Anlage A', pool: 'mitte', lights: ['HALLE'] },
      { type: 'button-sync', id: 'xb', title: 'Anlage B', pool: 'mitte' },
      { type: 'button-sync', id: 'xc', title: 'Anlage C', pool: 'mitte' },
      { type: 'button-sync', id: 'drei', title: 'Drei' },
    ],
    map: turnMap(),
    ...changes,
  };
}

function turnMap(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tiles: [
      '######################',
      '#...............#....#',
      '#....................#',
      '######################',
    ],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    doors: [{ id: 'tor', x: 16, y: 2, opensBy: { kind: 'puzzle', puzzleId: 'mitte' } }],
    stations: [
      { puzzleId: 'eins', x: 3, y: 1 },
      { puzzleId: 'xa', x: 6, y: 1 },
      { puzzleId: 'xb', x: 9, y: 1 },
      { puzzleId: 'xc', x: 12, y: 1 },
      { puzzleId: 'drei', x: 19, y: 1 },
    ],
    labels: [{ text: 'HALLE', x: 8, y: 2 }],
    ...changes,
  };
}

const turnLab = (changes: Record<string, unknown> = {}): Mission =>
  parseMission(turnLabData(changes));

const MEMBERS = ['xa', 'xb', 'xc'];

/** The issues the validation finds in mission data, one a line. */
function issuesOf(data: unknown): string {
  const checked = checkMission(data);
  return checked.ok ? '' : checked.issues.join('\n');
}

/** A run of `mission` whose pool draws `puzzleId`. */
const drawing = (mission: Mission, puzzleId: string): GameState =>
  started(mission, seedDrawing(mission, puzzleId));

/** Both of the crew at station `id`, E pressed there at `at`. */
function switchOn(state: GameState, id: string, at: number): GameState {
  const here = standing(state, { stations: { [id]: ['p1', 'p2'] } });
  return applyAction(here, { type: 'interact', playerId: 'p1', at });
}

/** The station `id` switched on and solved by both pressing at `at`. */
function take(state: GameState, id: string, at: number): GameState {
  return ['p1', 'p2'].reduce(
    (next, playerId) =>
      applyAction(next, { type: 'puzzle-input', playerId, at, input: { press: true } }),
    switchOn(state, id, at),
  );
}

const order = (state: GameState): string[] => state.mission.puzzles.map((p) => p.id);

/** The status of every station on the audience's map, by puzzle id. */
function statuses(state: GameState): Record<string, string> {
  const stations = viewForSpectator(state).map?.stations ?? [];
  return Object.fromEntries(
    stations.map((s) => [s.puzzleId, 'status' in s ? s.status : 'glimpsed']),
  );
}

describe('rotation: the draw', () => {
  it('is the seed’s: the same seed draws the same station, whatever the order or level', () => {
    const mission = turnLab();
    for (let seed = 0; seed < 50; seed++) {
      const drawn = drawPools(mission.puzzles, seed);
      expect(MEMBERS).toContain(drawn['mitte']);
      expect(drawPools(mission.puzzles, seed)).toEqual(drawn);
      expect(drawPools([...mission.puzzles].reverse(), seed)).toEqual(drawn);
      expect(drawPools(scaleMission(mission, 'hart').puzzles, seed)).toEqual(drawn);
      expect(started(mission, seed).drawn).toEqual(drawn);
    }
  });

  it('gives every member its turn, roughly evenly over 300 seeds', () => {
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 300; seed++) {
      const drawn = drawPools(turnLab().puzzles, seed)['mitte'] ?? '';
      counts.set(drawn, (counts.get(drawn) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(MEMBERS);
    for (const [id, count] of counts) {
      expect(count, id).toBeGreaterThan(70);
      expect(count, id).toBeLessThan(130);
    }
  });

  it('draws each pool on its own', () => {
    const puzzles = [
      { id: 'a1', pool: 'a' },
      { id: 'a2', pool: 'a' },
      { id: 'b1', pool: 'b' },
      { id: 'b2', pool: 'b' },
      { id: 'fest' },
    ];
    expect(everyDraw(puzzles)).toHaveLength(4);
    expect(stationCount(puzzles)).toBe(3);
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const { a, b } = drawPools(puzzles, seed);
      seen.add(`${a}/${b}`);
    }
    expect(seen.size).toBe(4);
    expect(everyDraw([{ id: 'fest' }])).toEqual([{}]);
  });

  it('puts the drawn station where the pool’s first member stands, the others last', () => {
    const puzzles = turnLab().puzzles;
    expect(runOrder(puzzles, { mitte: 'xc' }).map((p) => p.id)).toEqual([
      'eins',
      'xc',
      'drei',
      'xa',
      'xb',
    ]);
    // A run's order drawn anew, as a rematch does: the pool keeps its place in the chain.
    const again = runOrder(runOrder(puzzles, { mitte: 'xc' }), { mitte: 'xa' });
    expect(again.map((p) => p.id)).toEqual(['eins', 'xa', 'drei', 'xc', 'xb']);
  });
});

describe('rotation: a run of a chain', () => {
  it.each(MEMBERS)('has %s at the pool’s place, armed after the first station', (drawn) => {
    const mission = turnLab();
    let state = drawing(mission, drawn);
    expect(state.drawn).toEqual({ mitte: drawn });
    expect(order(state).slice(0, 3)).toEqual(['eins', drawn, 'drei']);
    expect([...outOfService(state)].sort()).toEqual(MEMBERS.filter((id) => id !== drawn));
    expect(stationsOfRun(state)).toBe(3);
    expect(armedPuzzleIds(state)).toEqual(['eins']);
    state = take(state, 'eins', T0 + 1000);
    expect(armedPuzzleIds(state)).toEqual([drawn]);
    expect(doorOpen(state.mission.map, state, 'tor')).toBe(false);
    state = take(state, drawn, T0 + 2000);
    expect(doorOpen(state.mission.map, state, 'tor')).toBe(true);
    expect(armedPuzzleIds(state)).toEqual(['drei']);
    state = take(state, 'drei', T0 + 3000);
    expect(state.phase).toBe('won');
    expect(statuses(state)).toEqual({});
    // A station out of service is never solved, a run won or not: nothing it named would open.
    const { map } = state.mission;
    const named = (puzzleId: string): typeof map => ({
      ...map,
      doors: [{ id: 'tor', x: 16, y: 2, opensBy: { kind: 'puzzle', puzzleId } }],
    });
    for (const resting of MEMBERS.filter((id) => id !== drawn)) {
      expect(doorOpen(named(resting), state, 'tor')).toBe(false);
    }
    expect(doorOpen(named(drawn), state, 'tor')).toBe(true);
  });

  it('counts the pool as one station in the lobby, in the run and on the map', () => {
    const mission = turnLab();
    const lobby = applyAction(
      { ...started(mission), phase: 'lost', finishedAt: T0 },
      { type: 'back-to-lobby', playerId: 'p1' },
    );
    expect(lobby.drawn).toEqual({});
    expect(viewFor(lobby, 'p1').puzzleCount).toBe(3);
    const state = drawing(mission, 'xb');
    expect(viewFor(state, 'p1').puzzleCount).toBe(3);
    expect(viewForSpectator(state).puzzleCount).toBe(3);
    expect(viewFor(switchOn(state, 'eins', T0 + 500), 'p1').puzzle).toMatchObject({
      index: 0,
      total: 3,
    });
    expect(statuses(state)).toEqual({
      eins: 'armed',
      xa: 'out',
      xb: 'locked',
      xc: 'out',
      drei: 'locked',
    });
  });

  it('lights the rooms of the drawn station alone', () => {
    const lit = (drawn: string): string[] => {
      const state = take(take(drawing(turnLab(), drawn), 'eins', T0 + 1000), drawn, T0 + 2000);
      return viewFor(state, 'p1').map?.litRooms ?? [];
    };
    expect(lit('xa')).toEqual(['HALLE']);
    expect(lit('xb')).toEqual([]);
  });

  it('draws anew for a rematch, from the run’s own order', () => {
    const mission = turnLab();
    const first = drawing(mission, 'xc');
    const seed = seedDrawing(mission, 'xa');
    const lost = applyAction(first, { type: 'time-expired', at: T0 + 601_000 });
    expect(lost.phase).toBe('lost');
    const ready = applyAction(lost, { type: 'set-ready', playerId: 'p2', ready: true });
    const again = applyAction(ready, { type: 'rematch', playerId: 'p1', at: T0 + 700_000, seed });
    expect(again.drawn).toEqual({ mitte: 'xa' });
    expect(order(again).slice(0, 3)).toEqual(['eins', 'xa', 'drei']);
    expect([...order(again)].sort()).toEqual(['drei', 'eins', 'xa', 'xb', 'xc']);
  });
});

describe('rotation: free order', () => {
  it('arms the drawn station with the rest, and wins with the run’s stations', () => {
    const mission = turnLab({ order: 'free', map: turnMap({ doors: [] }) });
    let state = drawing(mission, 'xc');
    expect([...armedPuzzleIds(state)].sort()).toEqual(['drei', 'eins', 'xc']);
    state = take(state, 'xc', T0 + 1000);
    state = take(state, 'drei', T0 + 2000);
    expect([...armedPuzzleIds(state)]).toEqual(['eins']);
    const atRest = standing(state, { stations: { xa: ['p1', 'p2'] } });
    const press = (): GameState =>
      applyAction(atRest, { type: 'interact', playerId: 'p1', at: T0 + 2500 });
    expect(press).toThrow(GameError);
    expect(press).toThrow('Außer Betrieb.');
    state = take(state, 'eins', T0 + 3000);
    expect(state.phase).toBe('won');
    expect(runReport(state, 'ROOM').stations.map((s) => s.puzzleId)).toEqual([
      'xc',
      'drei',
      'eins',
    ]);
  });
});

describe('rotation: what counts solved stations', () => {
  const guarded = (changes: Record<string, unknown>): Record<string, unknown> =>
    turnLabData({ map: turnMap(changes) });
  const drone = (activeAfterSolved: number): Record<string, unknown> => ({
    drones: [
      {
        id: 'd1',
        waypoints: [
          { x: 2, y: 2 },
          { x: 14, y: 2 },
        ],
        activeAfterSolved,
      },
    ],
  });

  it('holds a drone’s activeAfterSolved to the stations of a run', () => {
    expect(issuesOf(guarded(drone(2)))).toBe('');
    expect(issuesOf(guarded(drone(3)))).toMatch(/activeAfterSolved must be below/);
  });

  it('wakes a drone and the emergencies by the stations solved in the run', () => {
    const sabotage = {
      label: 'Leck',
      afterSolved: 2,
      panels: [
        { id: 'v1', x: 2, y: 1 },
        { id: 'v2', x: 4, y: 2 },
      ],
    };
    const exit = { x: 20, y: 2 };
    const mission = parseMission(guarded({ ...drone(2), sabotage, exit }));
    let state = take(drawing(mission, 'xb'), 'eins', T0 + 1000);
    expect(patrollingDrones(state.mission.map, state)).toHaveLength(0);
    expect(emergenciesDue(state)).toBe(false);
    state = take(state, 'xb', T0 + 2000);
    expect(patrollingDrones(state.mission.map, state)).toHaveLength(1);
    expect(emergenciesDue(state)).toBe(true);
    // Solved, every station of the run, though the file has five: the hatch opens, the lab is
    // lit for the way out, no emergency comes any more, and the crew on the hatch wins.
    state = take(state, 'drei', T0 + 3000);
    expect([state.phase, state.currentPuzzleIndex]).toEqual(['playing', 3]);
    expect(emergenciesDue(state)).toBe(false);
    expect(inEscapePhase(state)).toBe(true);
    expect(labLit(state)).toBe(true);
    expect(viewFor(state, 'p1').map?.exit).toMatchObject({ open: true });
    expect(applyAction(state, { type: 'escaped', at: T0 + 4000 }).phase).toBe('won');
  });
});

describe('rotation: the validation', () => {
  it('takes the lab as it is', () => {
    expect(issuesOf(turnLabData())).toBe('');
  });

  it('wants two members at least', () => {
    const puzzles = [
      { type: 'button-sync', id: 'eins', title: 'Eins', pool: 'allein' },
      { type: 'button-sync', id: 'drei', title: 'Drei' },
    ];
    const map = turnMap({
      doors: [],
      stations: [
        { puzzleId: 'eins', x: 3, y: 1 },
        { puzzleId: 'drei', x: 19, y: 1 },
      ],
    });
    expect(issuesOf(turnLabData({ puzzles, map }))).toMatch(
      /^puzzles\.0\.pool: pool "allein" has "eins" alone/m,
    );
  });

  it('refuses a pool under a puzzle’s id', () => {
    const data = turnLabData();
    const puzzles = (data['puzzles'] as { pool?: string }[]).map((p) =>
      p.pool === undefined ? p : { ...p, pool: 'eins' },
    );
    const map = turnMap({
      doors: [{ id: 'tor', x: 16, y: 2, opensBy: { kind: 'puzzle', puzzleId: 'eins' } }],
    });
    expect(issuesOf({ ...data, puzzles, map })).toMatch(/pool "eins" is also a puzzle's id/);
  });

  it('refuses a door that waits for a single member, naming the pool', () => {
    const byMember = { kind: 'puzzle', puzzleId: 'xa' };
    const doors = (opensBy: object): Record<string, unknown> => ({
      doors: [{ id: 'tor', x: 16, y: 2, opensBy }],
    });
    expect(issuesOf(turnLabData({ map: turnMap(doors(byMember)) }))).toMatch(
      /door "tor" waits for puzzle "xa", which takes turns in pool "mitte".*name the pool "mitte"/,
    );
    const plate = { plates: [{ id: 'platte', x: 14, y: 2 }] };
    const held = { kind: 'plate', plateId: 'platte', untilSolved: 'xb' };
    expect(issuesOf(turnLabData({ map: turnMap({ ...doors(held), ...plate }) }))).toMatch(
      /door "tor" stays open once puzzle "xb" is solved, which takes turns in pool "mitte"/,
    );
    const byPool = { kind: 'plate', plateId: 'platte', untilSolved: 'mitte' };
    const heldForPool = turnLabData({ map: turnMap({ ...doors(byPool), ...plate }) });
    expect(issuesOf(heldForPool)).toBe('');
    // The plate is a place of whichever station the run has there, and of no other.
    const mission = parseMission(heldForPool);
    expect(placesOf(mission, 'xb')).toContainEqual({ kind: 'plate', id: 'platte' });
    expect(placesOf(mission, 'eins')).not.toContainEqual({ kind: 'plate', id: 'platte' });
    const unknown = { kind: 'puzzle', puzzleId: 'nichts' };
    expect(issuesOf(turnLabData({ map: turnMap(doors(unknown)) }))).toMatch(
      /door "tor" references unknown puzzle "nichts"/,
    );
  });

  it('proves every draw, and names the one that fails', () => {
    // Xc walled in at (12,1): the runs drawing xa and xb are sound, the one drawing xc is not.
    const tiles = [
      '######################',
      '#..........#.#..#....#',
      '#..........###.......#',
      '#...............#....#',
      '######################',
    ];
    const issues = issuesOf(turnLabData({ map: turnMap({ tiles }) }));
    expect(issues).toMatch(/station "xc".*— in a run with pool "mitte" drawing "xc"/);
    expect(issues).not.toMatch(/drawing "xa"/);
    expect(issues).not.toMatch(/drawing "xb"/);
  });

  it('proves the chain behind the pool’s door for every draw', () => {
    // Without the pool's door the last place is walled off in every run.
    const walled = turnLabData({ map: turnMap({ doors: [] }) });
    const tiles = [
      '######################',
      '#...............#....#',
      '#...............#....#',
      '######################',
    ];
    const issues = issuesOf({ ...walled, map: turnMap({ doors: [], tiles }) });
    for (const drawn of MEMBERS) {
      expect(issues).toMatch(new RegExp(`station "drei".*drawing "${drawn}"`));
    }
  });

  it('takes the probe, whose pool mixes stations of one console and of two', () => {
    const mission = rotationProbe();
    expect(stationCount(mission.puzzles)).toBe(3);
    expect(everyDraw(mission.puzzles)).toHaveLength(3);
    const types = mission.puzzles.filter((p) => p.pool === PROBE_POOL).map((p) => p.type);
    expect(types.map((type) => moduleFor(type).consoles ?? 1).sort()).toEqual([1, 2, 2]);
  });

  it('wants two different players at the consoles of a member with two, in its draw', () => {
    const file = new URL('../../../tools/fixtures/rotation-probe.json', import.meta.url);
    const data = JSON.parse(readFileSync(file, 'utf8')) as { map: { stations: object[] } };
    // Console b of the Notstromkasten moved into the room behind the pool's own door.
    const stations = data.map.stations.map((s) =>
      JSON.stringify(s).includes('"notstrom"') && JSON.stringify(s).includes('"b"')
        ? { puzzleId: 'notstrom', x: 22, y: 5, console: 'b' }
        : s,
    );
    const issues = issuesOf({ ...data, map: { ...data.map, stations } });
    expect(issues).toMatch(/console b of station "notstrom".*drawing "notstrom"/);
    expect(issues).not.toMatch(/drawing "funkfeuer"/);
  });
});

describe('rotation: parts', () => {
  /** A part lying at (x,2), to be carried four tiles east. */
  const at = (x: number): object => ({ x, y: 2, deliverTo: { x: x + 4, y: 2 } });
  const parts = {
    items: [
      { ...at(2), id: 'fuer-a', label: 'SICHERUNG A', requiredFor: 'xa' },
      { ...at(4), id: 'fuer-platz', label: 'KISTE', requiredFor: 'mitte' },
    ],
  };
  const withParts = (): Mission => turnLab({ map: turnMap(parts) });
  const partsOnMap = (state: GameState): string[] =>
    (viewForSpectator(state).map?.items ?? []).map((item) => item.id);

  it('puts out no part a station out of service waits for', () => {
    const out = drawing(withParts(), 'xb');
    expect(Object.keys(out.items)).toEqual(['fuer-platz']);
    expect(partsOnMap(out)).toEqual(['fuer-platz']);
    expect(() =>
      applyAction(out, { type: 'pick-item', playerId: 'p1', itemId: 'fuer-a', at: T0 }),
    ).toThrow(GameError);
    const inService = drawing(withParts(), 'xa');
    expect(Object.keys(inService.items).sort()).toEqual(['fuer-a', 'fuer-platz']);
  });

  it('keeps the drawn station inert until the part named for the pool arrives', () => {
    const state = take(drawing(withParts(), 'xc'), 'eins', T0 + 1000);
    expect(() => switchOn(state, 'xc', T0 + 2000)).toThrow('Der Station fehlt noch: KISTE.');
    const part = viewForSpectator(state).map?.items.find((item) => item.id === 'fuer-platz');
    expect(part).toMatchObject({ requiredFor: { title: 'Anlage C', ahead: 0 } });
    expect(placesOf(state.mission, 'xc')).toContainEqual({ kind: 'part', id: 'fuer-platz' });
  });
});

describe('rotation: the run report and the snapshot', () => {
  it('names the drawn station and lists the stations of the run alone', () => {
    let state = drawing(turnLab(), 'xb');
    for (const [i, id] of ['eins', 'xb', 'drei'].entries()) {
      state = take(state, id, T0 + 1000 * (i + 1));
    }
    const report = runReport(state, 'ROOM');
    expect(report.version).toBe(2);
    expect(report.drawn).toEqual({ mitte: 'xb' });
    expect(report.stations.map((s) => s.puzzleId)).toEqual(['eins', 'xb', 'drei']);
    expect(report.stations.every((s) => s.solvedAt !== null)).toBe(true);
  });

  it('leaves the draw out of the report of a mission without pools', () => {
    const data = turnLabData();
    const puzzles = (data['puzzles'] as { id: string }[]).filter((p) => p.id !== 'xb');
    const plain = parseMission({
      ...data,
      puzzles: puzzles.map((p) => ({ ...p, pool: undefined })),
      map: turnMap({
        doors: [],
        stations: (turnMap()['stations'] as { puzzleId: string }[]).filter(
          (s) => s.puzzleId !== 'xb',
        ),
      }),
    });
    const lost = applyAction(started(plain), { type: 'time-expired', at: T0 + 601_000 });
    expect('drawn' in runReport(lost, 'ROOM')).toBe(false);
    expect(runReport(lost, 'ROOM').stations).toHaveLength(4);
  });

  /** A room's sealed snapshot around `state`, as a server reads it back. */
  const sealed = (state: GameState): unknown =>
    JSON.parse(
      JSON.stringify({
        code: 'ABCD',
        missionId: state.mission.id,
        seed: state.roomSeed,
        difficulty: state.difficulty,
        daily: state.dailyOn,
        createdAt: T0,
        state,
        seats: [],
        lostPasses: [],
        keeping: {
          positions: {},
          drones: null,
          closedClean: [],
          askAgainAt: {},
          lastPingAt: {},
          lastChatAt: {},
          signalAllowance: {},
          refusedSteps: 0,
        },
        seq: 1,
        at: T0,
        instance: 'eins',
        final: true,
      }),
    );

  it('restores the draw from a snapshot, the run’s order with it', () => {
    const state = take(drawing(turnLab(), 'xc'), 'eins', T0 + 1000);
    const back = sealedSnapshotSchema.parse(sealed(state)).state;
    expect(back.drawn).toEqual({ mitte: 'xc' });
    expect(back.mission.puzzles.map((p) => p.id)).toEqual(order(state));
    expect(armedPuzzleIds(back)).toEqual(['xc']);
    expect([...outOfService(back)].sort()).toEqual(['xa', 'xb']);
  });

  it('restores a snapshot from before the pools as before: nothing drawn', () => {
    const data = sealed(started(turnLab({ puzzles: [turnLabPuzzle()], map: plainMap() })));
    const { state } = data as { state: Record<string, unknown> };
    const before = Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'drawn'));
    const back = sealedSnapshotSchema.parse({ ...(data as object), state: before }).state;
    expect(back.drawn).toEqual({});
    expect(armedPuzzleIds(back)).toEqual(['eins']);
  });
});

const turnLabPuzzle = (): object => ({ type: 'button-sync', id: 'eins', title: 'Eins' });
const plainMap = (): object =>
  turnMap({ doors: [], stations: [{ puzzleId: 'eins', x: 3, y: 1 }] });

/**
 * Everything a station out of service could give away, as text a view would carry: its printed
 * rules, its notes, mission control's lines about it.
 */
function secretsOf(mission: Mission, puzzleId: string): string[] {
  const def = mission.puzzles.find((p) => p.id === puzzleId);
  if (def === undefined) {
    throw new Error(`no puzzle "${puzzleId}"`);
  }
  const rules = moduleFor(def.type)
    .manual(def)
    .map((section) => JSON.stringify(section));
  const lines = [def.onSolved, ...def.nudges].flatMap((line) =>
    line === undefined ? [] : [JSON.stringify(line)],
  );
  return [...rules, ...def.hints.map((hint) => JSON.stringify(hint)), ...lines];
}

describe('rotation: the probe, station by station', () => {
  const seeds = probeSeeds();

  it('draws a different station on the walkthrough’s two seeds', () => {
    const mission = rotationProbe();
    expect(drawPools(mission.puzzles, seeds.played)).toEqual({ [PROBE_POOL]: 'funkfeuer' });
    expect(drawPools(mission.puzzles, seeds.other)).toEqual({ [PROBE_POOL]: 'signalkette' });
  });

  it('is won on every draw by the solvers, the door opening with the drawn station', () => {
    const mission = rotationProbe();
    for (const member of ['funkfeuer', 'signalkette', 'notstrom']) {
      const { state, stations } = playProbe(seedDrawing(mission, member));
      expect(state.phase, member).toBe('won');
      expect(stations.map((s) => s.id)).toEqual(['tastenfeld', member, 'leitungsnetz']);
      expect(state.penaltySeq).toBe(0);
      expect(doorOpen(state.mission.map, state, 'schleuse')).toBe(true);
      const said = state.events.filter((e) => e.kind === 'radio').map((e) => e.label);
      expect(said.filter((line) => line.includes('Die Schleuse ist frei'))).toHaveLength(1);
    }
  });

  /**
   * The crew at every place a station out of service has — p1 at its consoles, p2 at its
   * source, then the other way round — at every stage of the run: armed, open, solved.
   */
  function everywhereAt(state: GameState, puzzleId: string): GameState[] {
    const { stations, manuals } = state.mission.map;
    const spots = stations
      .filter((s) => s.puzzleId === puzzleId)
      .map((s) => (s.console === 'b' ? `${s.puzzleId}/b` : s.puzzleId));
    const sources = manuals.filter((m) => m.puzzleIds.includes(puzzleId)).map((m) => m.id);
    const at = (consoles: string, books: string): GameState =>
      standing(state, {
        stations: Object.fromEntries(spots.map((key) => [key, [consoles]])),
        manuals: Object.fromEntries(sources.map((id) => [id, [books]])),
        signSeen: ['p1', 'p2'],
      });
    return [at('p1', 'p2'), at('p2', 'p1')];
  }

  it('gives nothing of a station out of service to any view, wherever its player stands', () => {
    const fresh = started(rotationProbe(), seeds.played);
    const open = applyAction(standing(fresh, { stations: { tastenfeld: ['p1'] } }), {
      type: 'interact',
      playerId: 'p1',
      at: T0 + 1000,
    });
    const won = playProbe(seeds.played).state;
    for (const resting of ['signalkette', 'notstrom']) {
      const secrets = secretsOf(fresh.mission, resting);
      expect(secrets.length).toBeGreaterThan(1);
      for (const stage of [fresh, open]) {
        for (const state of everywhereAt(stage, resting)) {
          for (const playerId of ['p1', 'p2']) {
            const view = viewFor(state, playerId);
            const text = JSON.stringify(view);
            for (const secret of secrets) {
              expect(text, `${resting} for ${playerId}`).not.toContain(secret);
            }
            expect(view.manualsHere.flatMap((m) => m.sections.map((s) => s.puzzleId))).toEqual(
              [],
            );
            expect(view.puzzle?.title ?? '').not.toBe(
              fresh.mission.puzzles.find((p) => p.id === resting)?.title,
            );
          }
        }
      }
      expect(JSON.stringify(viewFor(won, 'p1'))).not.toContain(secrets[0]);
    }
  });

  /** p1's view with p1 at the source `manualId`. */
  const atSource = (state: GameState, manualId: string): PlayerView =>
    viewFor(standing(state, { manuals: { [manualId]: ['p1'] } }), 'p1');

  it('marks the consoles and sources out of service, for the world to show them so', () => {
    const state = standing(started(rotationProbe(), seeds.played), {
      found: { p1: ['source:buch-signalkette', 'source:buch-funkfeuer'] },
    });
    expect(statuses(state)).toEqual({
      tastenfeld: 'armed',
      funkfeuer: 'locked',
      signalkette: 'out',
      notstrom: 'out',
      leitungsnetz: 'locked',
    });
    const sources = viewFor(state, 'p1').map?.manuals ?? [];
    const known = Object.fromEntries(sources.map((m) => [m.id, m.known ? m : null]));
    expect(known['buch-signalkette']).toMatchObject({ puzzleIds: [], outOfService: true });
    expect(known['buch-funkfeuer']).toMatchObject({ puzzleIds: ['funkfeuer'] });
    expect(known['buch-funkfeuer']).not.toHaveProperty('outOfService');
    expect(atSource(state, 'buch-signalkette').sourcesHere).toEqual([
      expect.objectContaining({ id: 'buch-signalkette', outOfService: true }),
    ]);
    expect(atSource(state, 'buch-signalkette').manualsHere).toEqual([]);
    expect(atSource(state, 'buch-funkfeuer').sourcesHere[0]).not.toHaveProperty('outOfService');
    expect(atSource(state, 'buch-funkfeuer').manualsHere).toHaveLength(1);
  });

  it('keeps the plan the walkthrough plays the draw’s and the solvers’ own', () => {
    const file = new URL('../../../tools/fixtures/rotation-plan.json', import.meta.url);
    const fixture: unknown = JSON.parse(readFileSync(file, 'utf8'));
    // Regenerate the file with writeRotation.ts when the probe or one of its modules changes.
    expect(fixture).toEqual(rotationPlan());
  });
});

describe('rotation: sources', () => {
  /** The lab with a wiring box in the pool beside two buttons, one book covering box and Drei. */
  function bookLab(kind = 'book', extra: Record<string, unknown> = {}): Mission {
    const data = turnLabData();
    const puzzles = (data['puzzles'] as { id: string }[]).map((p) =>
      p.id === 'xa' ? { type: 'wiring', id: 'xa', title: 'Kasten', pool: 'mitte' } : p,
    );
    const drei = { type: 'keypad', id: 'drei', title: 'Drei' };
    const source = { id: 'quelle', kind, label: 'QUELLE', spots: [{ x: 5, y: 2 }], ...extra };
    return parseMission({
      ...data,
      puzzles: puzzles.map((p) => (p.id === 'drei' ? drei : p)),
      map: turnMap({
        manuals: [
          { ...source, id: 'nur-a', puzzleIds: ['xa'] },
          { ...source, id: 'beide', spots: [{ x: 7, y: 2 }], puzzleIds: ['xa', 'drei'] },
        ],
        edgeworkSign: { x: 2, y: 2 },
        ...(kind === 'cabinet'
          ? { items: [{ id: 'schluessel', label: 'SCHLÜSSEL', x: 3, y: 2 }] }
          : {}),
      }),
    });
  }

  it('shows only the pages of the run at a source that also covers one out of service', () => {
    const state = standing(drawing(bookLab(), 'xb'), { manuals: { beide: ['p1'] } });
    const [book] = viewFor(state, 'p1').manualsHere;
    expect(book?.sections.map((s) => s.puzzleId)).toEqual(['drei']);
    expect(viewFor(state, 'p1').sourcesHere[0]).not.toHaveProperty('outOfService');
    const inService = standing(drawing(bookLab(), 'xa'), { manuals: { beide: ['p1'] } });
    expect(viewFor(inService, 'p1').manualsHere[0]?.sections.map((s) => s.puzzleId)).toEqual([
      'xa',
      'drei',
    ]);
  });

  it('opens no locker that holds only the rules of a station out of service', () => {
    const state = standing(drawing(bookLab('locker'), 'xb'), { manuals: { 'nur-a': ['p1'] } });
    const search = (): GameState =>
      applyAction(state, { type: 'open-source', playerId: 'p1', manualId: 'nur-a', at: T0 + 500 });
    expect(search).toThrow(GameError);
    expect(search).toThrow('Zu einer Anlage außer Betrieb.');
    const inService = standing(drawing(bookLab('locker'), 'xa'), {
      manuals: { 'nur-a': ['p1'] },
    });
    const opened = applyAction(inService, {
      type: 'open-source',
      playerId: 'p1',
      manualId: 'nur-a',
      at: T0 + 500,
    });
    expect(opened.opened).toEqual(['nur-a']);
  });

  it('puts out no key for a cabinet of a station out of service alone', () => {
    const data = turnLabData();
    const puzzles = (data['puzzles'] as { id: string }[]).map((p) =>
      p.id === 'xa' ? { type: 'wiring', id: 'xa', title: 'Kasten', pool: 'mitte' } : p,
    );
    const mission = parseMission({
      ...data,
      puzzles,
      map: turnMap({
        manuals: [
          {
            id: 'schrank',
            kind: 'cabinet',
            label: 'SCHRANK',
            puzzleIds: ['xa'],
            spots: [{ x: 5, y: 2 }],
            needsKey: 'schluessel',
          },
        ],
        items: [{ id: 'schluessel', label: 'SCHLÜSSEL', x: 3, y: 2 }],
        edgeworkSign: { x: 2, y: 2 },
      }),
    });
    expect(Object.keys(drawing(mission, 'xb').items)).toEqual([]);
    expect(Object.keys(drawing(mission, 'xa').items)).toEqual(['schluessel']);
  });
});
