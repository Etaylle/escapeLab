import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  armedStations,
  checkMission,
  emergenciesDue,
  LEVER_FIGURE,
  MAX_LAMPS,
  parseMission,
  patrollingDrones,
  POWER_OUT,
  runReport,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { GameState, Mission } from '../src/index.js';
import { buttonSyncModule } from '../src/puzzles/buttonSync.js';
import { canGather, crewsOf, tileKey, type Spot } from '../src/reach.js';
import { lightsOut, started, standing, T0 } from './lab.js';

/**
 * A corridor lab that opens with the power on for three seconds: three
 * stations where the whole crew presses, (3,1), (5,1) and (7,1), a lamp on
 * the wall above the first, a drone on the south row and two valves.
 *
 *   0123456789
 * 0 ####L#####
 * 1 #..1.2.3.#   spawns (1,1) and (1,2)
 * 2 #.v.....v#   valves (2,2) and (8,2); the drone flies (1,2) to (8,2)
 * 3 ##########
 */
const raw = {
  id: 'kaltstart',
  title: 'Kaltstart',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  intro: { lightsSec: 3 },
  radio: { start: 'Strom weg.' },
  players: { min: 2, max: 2 },
  puzzles: ['eins', 'zwei', 'drei'].map((id) => ({ type: 'button-sync', id, title: id })),
  map: {
    tiles: ['##########', '#........#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    stations: [
      { puzzleId: 'eins', x: 3, y: 1 },
      { puzzleId: 'zwei', x: 5, y: 1 },
      { puzzleId: 'drei', x: 7, y: 1 },
    ],
    lamps: [{ x: 4, y: 0 }],
    drones: [
      {
        id: 'wache',
        waypoints: [
          { x: 1, y: 2 },
          { x: 8, y: 2 },
        ],
      },
    ],
    sabotage: {
      label: 'KÜHLUNG',
      panels: [
        { id: 'links', x: 2, y: 2 },
        { id: 'rechts', x: 8, y: 2 },
      ],
    },
  },
};
const mission: Mission = parseMission(raw);
const OUT_AT = T0 + 3000;
const LIMIT_MS = 600_000;

/** The same lab without an intro: its lights are out from the start. */
function withoutIntro(): Mission {
  const { intro, ...rest } = raw;
  void intro;
  return parseMission(rest);
}

/** The whole crew at the armed station, switched on, everyone presses. */
function solveNext(state: GameState, at: number): GameState {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (def === undefined) {
    throw new Error('solveNext: every station is solved');
  }
  const here = standing(state, { stations: { [def.id]: ['p1', 'p2'] } });
  const open = applyAction(here, { type: 'interact', playerId: 'p1', at });
  return ['p1', 'p2'].reduce(
    (next, playerId) =>
      applyAction(next, { type: 'puzzle-input', playerId, at, input: { press: true } }),
    open,
  );
}

describe('the intro: the power is on', () => {
  const state = started(mission);

  it('starts the run with no clock, no armed station and no radio line yet', () => {
    expect(state.lightsOutAt).toBeNull();
    expect(state.lightsDueAt).toBe(OUT_AT);
    expect(state.deadlineAt).toBeNull();
    expect(state.events).toEqual([]);
    expect(armedStations(mission.map, state)).toEqual([]);
  });

  it('shows players and audience the lights on and every station still to come', () => {
    const view = viewFor(state, 'p1');
    expect(view.lights).toEqual({ out: false, outAt: null });
    expect(view.deadlineAt).toBeNull();
    expect(view.map?.stations.map((s) => s.status)).toEqual(['locked', 'locked', 'locked']);
    const audience = viewForSpectator(state);
    expect(audience.lights).toEqual({ out: false, outAt: null });
    expect(audience.deadlineAt).toBeNull();
    expect(audience.map?.stations.every((s) => s.status === 'locked')).toBe(true);
  });

  it('turns a switch-on at the first station away until the lights fail', () => {
    const here = standing(state, { stations: { eins: ['p1', 'p2'] } });
    expect(() => applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 1000 })).toThrow(
      /nichts zu aktivieren/,
    );
  });

  it('keeps the drones asleep and the emergencies away, however eager the mission', () => {
    const eager = parseMission({
      ...raw,
      map: { ...raw.map, sabotage: { ...raw.map.sabotage, afterSolved: 0 } },
    });
    expect(patrollingDrones(mission.map, state)).toEqual([]);
    expect(emergenciesDue(started(eager))).toBe(false);
    expect(emergenciesDue(lightsOut(started(eager), OUT_AT))).toBe(true);
  });
});

describe('the lights going out', () => {
  const out = lightsOut(started(mission), OUT_AT);

  it('starts the clock with the full limit from that moment', () => {
    expect(out.lightsOutAt).toBe(OUT_AT);
    expect(out.lightsDueAt).toBeNull();
    expect(out.deadlineAt).toBe(OUT_AT + LIMIT_MS);
    expect(viewFor(out, 'p2').deadlineAt).toBe(OUT_AT + LIMIT_MS);
  });

  it('logs the blackout for the end screen, then mission control’s opener', () => {
    expect(POWER_OUT).toBe('Stromausfall');
    expect(out.events).toEqual([
      { at: OUT_AT, kind: 'power', label: 'Stromausfall', seconds: null },
      { at: OUT_AT, kind: 'radio', label: 'Strom weg.', seconds: null },
    ]);
  });

  it('arms the first station, so that the crew can switch it on', () => {
    expect(armedStations(mission.map, out)).toEqual([{ x: 3, y: 1, console: null }]);
    expect(viewFor(out, 'p1').map?.stations.map((s) => s.status)).toEqual([
      'armed',
      'locked',
      'locked',
    ]);
    const opened = solveNext(out, OUT_AT + 1000);
    expect(opened.currentPuzzleIndex).toBe(1);
  });

  it('tells players and audience alike when it happened', () => {
    expect(viewFor(out, 'p1').lights).toEqual({ out: true, outAt: OUT_AT });
    expect(viewForSpectator(out).lights).toEqual({ out: true, outAt: OUT_AT });
  });

  it('sends the drones out, those whose stations are solved', () => {
    expect(patrollingDrones(mission.map, out).map((d) => d.id)).toEqual(['wache']);
    const later = parseMission({
      ...raw,
      map: { ...raw.map, drones: [{ ...raw.map.drones[0], activeAfterSolved: 1 }] },
    });
    const dark = lightsOut(started(later), OUT_AT);
    expect(patrollingDrones(later.map, dark)).toEqual([]);
    expect(patrollingDrones(later.map, solveNext(dark, OUT_AT + 1000))).toHaveLength(1);
  });

  it('lets emergencies come once the stations of `afterSolved` are solved, two by default', () => {
    expect(mission.map.sabotage?.afterSolved).toBe(2);
    const one = solveNext(out, OUT_AT + 1000);
    const two = solveNext(one, OUT_AT + 2000);
    expect([out, one, two].map(emergenciesDue)).toEqual([false, false, true]);
    // On the way to the hatch nothing interrupts anymore.
    expect(emergenciesDue(solveNext(two, OUT_AT + 3000))).toBe(false);
  });

  it('happens once: a second one changes nothing', () => {
    expect(lightsOut(out, OUT_AT + 9000)).toBe(out);
  });
});

describe('a pause during the intro', () => {
  const paused = applyAction(started(mission), { type: 'set-paused', paused: true, at: T0 + 1000 });

  it('holds the lights on while it lasts', () => {
    expect(lightsOut(paused, OUT_AT)).toBe(paused);
  });

  it('moves the moment they fail on by the time it took, like every deadline', () => {
    const resumed = applyAction(paused, { type: 'set-paused', paused: false, at: T0 + 11_000 });
    expect(resumed.lightsDueAt).toBe(OUT_AT + 10_000);
    expect(resumed.deadlineAt).toBeNull();
  });
});

describe('a mission without an intro', () => {
  const plain = started(withoutIntro());

  it('plays as ever: lights out, clock running and the opener on the air from the start', () => {
    expect(plain.lightsOutAt).toBe(T0);
    expect(plain.lightsDueAt).toBeNull();
    expect(plain.deadlineAt).toBe(T0 + LIMIT_MS);
    expect(plain.events).toEqual([{ at: T0, kind: 'radio', label: 'Strom weg.', seconds: null }]);
    expect(armedStations(plain.mission.map, plain)).toHaveLength(1);
    expect(viewFor(plain, 'p1').lights).toEqual({ out: true, outAt: T0 });
  });

  it('takes no lights-out: there is none to come', () => {
    expect(lightsOut(plain, OUT_AT)).toBe(plain);
  });
});

describe('after the run', () => {
  const lost = applyAction(lightsOut(started(mission), OUT_AT), {
    type: 'time-expired',
    at: OUT_AT + LIMIT_MS,
  });

  it('opens the rematch with the power on again', () => {
    const ready = applyAction(lost, { type: 'set-ready', playerId: 'p2', ready: true });
    const again = applyAction(ready, { type: 'rematch', playerId: 'p1', at: T0 + 1e6, seed: 3 });
    expect(again.phase).toBe('playing');
    expect(again.lightsOutAt).toBeNull();
    expect(again.lightsDueAt).toBe(T0 + 1e6 + 3000);
    expect(again.deadlineAt).toBeNull();
    expect(again.events).toEqual([]);
  });

  it('forgets the lights in the lobby', () => {
    const lobby = applyAction(lost, { type: 'back-to-lobby', playerId: 'p1' });
    expect([lobby.lightsOutAt, lobby.lightsDueAt]).toEqual([null, null]);
    expect(viewFor(lobby, 'p1').lights).toEqual({ out: false, outAt: null });
  });

  it('reports when the lights went out; every time still counts from the start', () => {
    let won = lightsOut(started(mission), OUT_AT);
    for (const at of [OUT_AT + 10_000, OUT_AT + 20_000, OUT_AT + 30_000]) {
      won = solveNext(won, at);
    }
    expect(won.phase).toBe('won');
    const report = runReport(won, 'RAUM');
    expect(report.startedAt).toBe(T0);
    expect(report.lightsOutAt).toBe(OUT_AT);
    expect(report.stations[0]).toMatchObject({ openedAt: T0, solvedAt: OUT_AT + 10_000 });
  });
});

describe('emergency lamps', () => {
  const withLamps = (lamps: Spot[]) => checkMission({ ...raw, map: { ...raw.map, lamps } });
  const issuesOf = (lamps: Spot[]): string[] => {
    const checked = withLamps(lamps);
    return checked.ok ? [] : checked.issues;
  };

  it('hang on the floor or on a wall beside it, and reach the views', () => {
    const lamps = [
      { x: 4, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 2 },
    ];
    expect(issuesOf(lamps)).toEqual([]);
    const hung = parseMission({ ...raw, map: { ...raw.map, lamps } });
    expect(viewFor(started(hung), 'p1').map?.lamps).toEqual(lamps);
    expect(viewForSpectator(started(hung)).map?.lamps).toEqual(lamps);
  });

  it('turn away a lamp with no floor beside it, one off the map and a second on a tile', () => {
    expect(issuesOf([{ x: 0, y: 0 }])).toEqual([
      expect.stringMatching(/lamp at 0,0 lights nothing/),
    ]);
    expect(issuesOf([{ x: 12, y: 1 }])).toEqual([
      expect.stringMatching(/lamp at 12,1 lights nothing/),
    ]);
    expect(issuesOf([{ x: 2, y: 1 }, { x: 2, y: 1 }])).toEqual([
      expect.stringMatching(/two lamps hang at 2,1/),
    ]);
  });

  it(`come ${MAX_LAMPS} at most to a map`, () => {
    const floor = Array.from({ length: 16 }, (_, i) => ({ x: 1 + (i % 8), y: 1 + (i >> 3) }));
    expect(issuesOf(floor)).toEqual([]);
    expect(issuesOf([...floor, { x: 4, y: 0 }])).toEqual([expect.stringMatching(/^map\.lamps/)]);
  });

  it('default to none', () => {
    expect(withoutIntro().map.lamps).toEqual(mission.map.lamps);
    const { lamps, ...bare } = raw.map;
    void lamps;
    expect(parseMission({ ...raw, map: bare }).map.lamps).toEqual([]);
  });
});

describe('the lever: a sync station drawn as a main switch', () => {
  const lever = parseMission({
    ...raw,
    puzzles: raw.puzzles.map((p, i) => (i === 0 ? { ...p, style: 'lever' } : p)),
  });

  it('is drawn as the button unless the mission says lever', () => {
    const def = { type: 'button-sync', id: 's', title: 'S' };
    expect(buttonSyncModule.defSchema.parse(def).style).toBe('button');
    expect(buttonSyncModule.defSchema.parse({ ...def, style: 'lever' }).style).toBe('lever');
    expect(() => buttonSyncModule.defSchema.parse({ ...def, style: 'kurbel' })).toThrow();
  });

  it('shows its look and how many of the crew stand at it, from where they stand', () => {
    const dark = lightsOut(started(lever), OUT_AT);
    const alone = applyAction(standing(dark, { stations: { eins: ['p1'] } }), {
      type: 'interact',
      playerId: 'p1',
      at: OUT_AT + 1000,
    });
    expect(viewFor(alone, 'p1').puzzle).toMatchObject({
      kind: 'button-sync',
      style: 'lever',
      requiredCount: 2,
      here: 1,
    });
    const both = standing(alone, { stations: { eins: ['p1', 'p2'] } });
    for (const id of ['p1', 'p2']) {
      expect(viewFor(both, id).puzzle).toMatchObject({ style: 'lever', here: 2 });
    }
    expect(viewForSpectator(both).puzzle).toMatchObject({ style: 'lever', here: 2 });
    // Somebody who left the crew is not counted at the station.
    const gone = applyAction(both, { type: 'player-disconnected', playerId: 'p2' });
    expect(viewFor(gone, 'p1').puzzle).toMatchObject({ here: 1, requiredCount: 1 });
  });

  it('prints its rules under a drawing of the main switch, the button under the button', () => {
    const def = { type: 'button-sync', id: 's', title: 'S' };
    const opening = (raw: object) =>
      buttonSyncModule.manual(buttonSyncModule.defSchema.parse(raw))[0]?.blocks.slice(0, 2);
    expect(opening({ ...def, style: 'lever' })).toEqual([
      { kind: 'figure', of: LEVER_FIGURE, caption: 'Abb. 1 — Hauptschalter mit Hebeln' },
      {
        kind: 'p',
        text:
          'Ein Hebel je Crewmitglied: Jedes Crewmitglied steht dabei am Schalter und legt ' +
          'seinen Hebel einmal um.',
      },
    ]);
    expect(opening(def)?.[0]).toEqual({
      kind: 'figure',
      of: 'button-sync',
      caption: 'Abb. 1 — Pult mit Synchrontaste',
    });
    expect(LEVER_FIGURE).not.toBe('button-sync');
  });
});

const blackout = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

/** The floor of the room a label names, up to its walls and doors. */
function roomOf(map: Mission['map'], label: Spot): Set<string> {
  const doors = new Set(map.doors.map((d) => tileKey(d.x, d.y)));
  const room = new Set([tileKey(label.x, label.y)]);
  const queue = [label];
  for (const { x, y } of queue) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = { x: x + dx, y: y + dy };
      const k = tileKey(next.x, next.y);
      if (map.tiles[next.y]?.charAt(next.x) === '.' && !doors.has(k) && !room.has(k)) {
        room.add(k);
        queue.push(next);
      }
    }
  }
  return room;
}

describe('Blackout opens on its lever', () => {
  const [first] = blackout.puzzles;
  const lever = blackout.map.stations.find((s) => s.puzzleId === first?.id);

  it('keeps the power on for three seconds, then the lever is station one', () => {
    expect(blackout.intro).toEqual({ lightsSec: 3 });
    expect(first).toMatchObject({ type: 'button-sync', style: 'lever', id: 'notlicht' });
    expect(lever).toEqual({ puzzleId: 'notlicht', x: 7, y: 5 });
    expect(blackout.map.manuals.some((m) => m.puzzleIds.includes('notlicht'))).toBe(false);
  });

  it('gathers every crew at the lever, from every choice of spawns', () => {
    const crews = crewsOf(blackout.map.spawns, blackout.players.min, blackout.players.max);
    expect(crews).toHaveLength(4);
    for (const crew of crews) {
      expect(lever !== undefined && canGather(blackout.map, crew, new Set(), lever)).toBe(true);
    }
  });

  it('keeps every source out of reach of whoever stands at the lever', () => {
    // A player counts at a spot within 1.6 tiles of its middle: no point an avatar can stand
    // on — 0.28 tiles clear of the walls all round, as the client walks — sampled every tenth
    // of a tile, lies that close to the lever and to any spot a source may be drawn to.
    // (Other stations need no such room: only one station is armed at a time.)
    const near = (p: Spot, spot: Spot): boolean =>
      Math.hypot(p.x - (spot.x + 0.5), p.y - (spot.y + 0.5)) <= 1.6;
    const onFloor = (x: number, y: number): boolean =>
      blackout.map.tiles[Math.floor(y)]?.charAt(Math.floor(x)) === '.';
    const fits = (p: Spot): boolean =>
      [-0.28, 0.28].every((dx) => [-0.28, 0.28].every((dy) => onFloor(p.x + dx, p.y + dy)));
    const points = blackout.map.tiles.flatMap((row, y) =>
      Array.from({ length: row.length * 100 }, (_, i) => ({
        x: Math.floor(i / 100) + (i % 10) / 10,
        y: y + Math.floor((i % 100) / 10) / 10,
      })),
    );
    const atLever = points.filter((p) => fits(p) && lever !== undefined && near(p, lever));
    expect(atLever.length).toBeGreaterThan(0);
    for (const spot of blackout.map.manuals.flatMap((m) => m.spots)) {
      expect(atLever.some((p) => near(p, spot)), `${spot.x},${spot.y}`).toBe(false);
    }
  });

  it('lights the Flur and the Archiv first, then each time the room the next step lies in', () => {
    expect(blackout.puzzles.map((p) => p.lights)).toEqual([
      ['FLUR', 'ARCHIV'],
      ['MASCHINENRAUM'],
      ['SERVERRAUM'],
      ['LABOR'],
      ['REAKTOR'],
      [],
    ]);
    const map = blackout.map;
    // The Archiv opens on the Flur through an archway, no door: the Flur's light floods it,
    // and the lever names both — the book the first-timer needs next lies there.
    const label = (text: string): Spot =>
      map.labels.find((l) => l.text === text) ?? { x: -1, y: -1 };
    const flur = label('FLUR');
    expect(roomOf(map, label('ARCHIV')).has(tileKey(flur.x, flur.y))).toBe(true);
    expect(map.manuals.find((m) => m.puzzleIds.includes('notstrom'))?.spots.every(
      (spot) => roomOf(map, label('ARCHIV')).has(tileKey(spot.x, spot.y)),
    )).toBe(true);
    for (const [i, def] of blackout.puzzles.slice(0, -1).entries()) {
      const next = blackout.puzzles[i + 1];
      const lit = map.labels
        .filter((label) => def.lights.includes(label.text))
        .flatMap((label) => [...roomOf(map, label)]);
      const spots = [
        ...map.stations.filter((s) => s.puzzleId === next?.id),
        ...map.manuals.filter((m) => next !== undefined && m.puzzleIds.includes(next.id))
          .flatMap((m) => m.spots),
      ];
      expect(
        spots.some((s) => lit.includes(tileKey(s.x, s.y))),
        `${def.id} lights nothing the next station needs`,
      ).toBe(true);
    }
  });

  it('wakes its drones and emergencies one station later than before the lever came', () => {
    expect(blackout.map.drones.map((d) => d.activeAfterSolved)).toEqual([3, 4]);
    expect(blackout.map.sabotage?.afterSolved).toBe(3);
    expect(blackout.map.lamps).toHaveLength(5);
  });
});
