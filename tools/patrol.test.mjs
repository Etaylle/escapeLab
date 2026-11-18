import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { URL } from 'node:url';
import {
  arrivals,
  canSee,
  cornersOf,
  DRONE_TICK_S,
  flights,
  flyOn,
  havens,
  headings,
  progressAt,
  spots,
  spottedOn,
  stretchOf,
} from './patrol.mjs';

/** A room with a pillar at 4,3. */
const PILLAR = {
  tiles: ['#########', '#.......#', '#.......#', '#...#...#', '#.......#', '#########'],
  shut: new Set(),
};
/** A long open hall, three tiles high. */
const HALL = {
  tiles: ['############', '#..........#', '#..........#', '#..........#', '############'],
  shut: new Set(),
};
/** A corridor on row 1, and below it a room it opens into through a door at 4,2. */
const WINGS = {
  tiles: ['##########', '#........#', '####.#####', '#........#', '##########'],
  shut: new Set(),
};

const watcher = { range: 4, halfAngleDeg: 30 };
const tiles = (...xy) => xy.map(([x, y]) => ({ x, y }));
const near = (a, b) => Math.abs(a - b) < 1e-9;

describe('canSee — core’s sight rule', () => {
  it('sees across open floor, both ways', () => {
    assert.equal(canSee(PILLAR, { x: 1.5, y: 1.5 }, { x: 7.5, y: 1.5 }), true);
    assert.equal(canSee(PILLAR, { x: 7.5, y: 1.5 }, { x: 1.5, y: 1.5 }), true);
  });

  it('is blocked by a wall and by a shut door between', () => {
    assert.equal(canSee(PILLAR, { x: 1.5, y: 3.5 }, { x: 7.5, y: 3.5 }), false);
    const door = { ...PILLAR, shut: new Set(['4,1']) };
    assert.equal(canSee(door, { x: 1.5, y: 1.5 }, { x: 7.5, y: 1.5 }), false);
  });

  it('does not squeeze past a corner it only touches, from either end', () => {
    // The line runs exactly through the pillar's corner at 5,3.
    assert.equal(canSee(PILLAR, { x: 3.5, y: 1.5 }, { x: 6.5, y: 4.5 }), false);
    assert.equal(canSee(PILLAR, { x: 6.5, y: 4.5 }, { x: 3.5, y: 1.5 }), false);
  });

  it('never lets the tiles at its ends block it', () => {
    const shutOnEnd = { ...PILLAR, shut: new Set(['1,1']) };
    assert.equal(canSee(shutOnEnd, { x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 }), true);
  });
});

describe('spots — the server’s cone, widened by the margins', () => {
  const east = { x: 1.5, y: 1.5, facing: 0 };

  it('spots ahead within range, not beside it', () => {
    assert.equal(spots(watcher, east, { x: 4.5, y: 1.5 }, HALL), true);
    assert.equal(spots(watcher, east, { x: 1.5, y: 3.5 }, HALL), false);
  });

  it('reaches a little past its range, but no further', () => {
    assert.equal(spots(watcher, east, { x: 5.7, y: 1.5 }, HALL), true);
    assert.equal(spots(watcher, east, { x: 5.9, y: 1.5 }, HALL), false);
  });

  it('leaves the walker in its blind spot unseen', () => {
    assert.equal(spots(watcher, east, { x: 1.55, y: 1.5 }, HALL), false);
  });

  it('does not see through a wall', () => {
    assert.equal(spots(watcher, { x: 1.5, y: 3.5, facing: 0 }, { x: 6.5, y: 3.5 }, PILLAR), false);
  });
});

describe('headings and flyOn — the server’s patrol foretold', () => {
  const beat = { waypoints: tiles([1, 1], [6, 1]), speed: 1.25 };

  it('heads for the end of the leg it faces along', () => {
    assert.deepEqual(headings(beat, { x: 3.5, y: 1.5, facing: 0 }), [1]);
    assert.deepEqual(headings(beat, { x: 3.5, y: 1.5, facing: Math.PI }), [0]);
  });

  it('may head for either waypoint while it stands on one', () => {
    assert.deepEqual(headings(beat, { x: 6.5, y: 1.5, facing: 0 }).sort(), [0, 1]);
  });

  it('flies a tenth of a tile a tick at 1.25 tiles a second, and turns back at the end', () => {
    const track = flyOn(beat, { x: 1.5, y: 1.5, facing: 0 }, 1, 6);
    assert.ok(near(track[1].time, DRONE_TICK_S));
    assert.ok(near(track[1].x, 1.6));
    assert.ok(Math.max(...track.map((at) => at.x)) <= 6.5 + 1e-9);
    const back = track.findIndex((at) => near(at.facing, Math.PI));
    assert.ok(back > 0 && track[back].x < 6.5);
  });

  it('looks east on a waypoint, whichever way it came', () => {
    const corner = { waypoints: tiles([3, 1], [3, 3], [1, 3]), speed: 1.25 };
    const track = flyOn(corner, { x: 3.5, y: 1.5, facing: Math.PI / 2 }, 1, 3);
    const there = track.filter((at) => near(at.x, 3.5) && near(at.y, 3.5));
    assert.ok(there.length > 0);
    assert.ok(there.every((at) => at.facing === 0));
  });

  it('gives a flight for every waypoint a drone may be heading for', () => {
    const drone = { ...watcher, beat, at: { x: 6.5, y: 1.5, facing: 0 } };
    assert.equal(flights([drone], 1).length, 2);
  });
});

describe('a run timed along its path', () => {
  const straight = tiles([0, 0], [1, 0], [2, 0], [3, 0]);
  const bent = tiles([0, 0], [1, 0], [2, 0], [2, 1], [2, 2]);

  it('takes a tile’s time per tile along a straight', () => {
    assert.deepEqual(arrivals(straight, 0.25, 0.5), [0, 0.25, 0.5, 0.75]);
    assert.equal(progressAt(arrivals(straight, 0.25, 0.5), 0.375), 1.5);
  });

  it('stops at each turn, and at the end', () => {
    assert.deepEqual(cornersOf(bent), [2, 4]);
    assert.deepEqual(arrivals(bent, 0.25, 0.5), [0, 0.25, 0.5, 1.25, 1.5]);
  });

  it('stands at the start before it sets off and at the end after it arrives', () => {
    const times = arrivals(straight, 0.25, 0.5);
    assert.equal(progressAt(times, -1), 0);
    assert.equal(progressAt(times, 9), 3);
  });
});

describe('spottedOn — a run past a drone', () => {
  const beat = { waypoints: tiles([1, 2], [10, 2]), speed: 1 };
  const eastbound = [{ ...watcher, beat, at: { x: 2.5, y: 2.5, facing: 0 } }];

  it('is spotted crossing in front of the drone', () => {
    const path = tiles([5, 1], [5, 2], [5, 3]);
    assert.notEqual(spottedOn(path, flights(eastbound, 5), HALL), null);
  });

  it('is not spotted behind it', () => {
    const path = tiles([1, 1], [1, 2], [1, 3]);
    assert.equal(spottedOn(path, flights(eastbound, 5), HALL), null);
  });

  it('counts the time it stands at the end', () => {
    const westbound = [{ ...watcher, beat, at: { x: 9.5, y: 2.5, facing: Math.PI } }];
    const path = tiles([1, 1], [2, 1]);
    assert.equal(spottedOn(path, flights(westbound, 6), HALL, { hold: 0 }), null);
    const time = spottedOn(path, flights(westbound, 6), HALL, { hold: 4 });
    assert.ok(time !== null && time > 2);
  });

  it('counts the time it waits before it sets off', () => {
    const westbound = [{ ...watcher, beat, at: { x: 9.5, y: 2.5, facing: Math.PI } }];
    const path = tiles([2, 1], [2, 2], [2, 3]);
    assert.equal(spottedOn(path, flights(westbound, 6), HALL, { delay: 0 }), null);
    assert.notEqual(spottedOn(path, flights(westbound, 6), HALL, { delay: 3 }), null);
  });
});

describe('havens and stretches', () => {
  const corridor = [{ ...watcher, beat: { waypoints: tiles([1, 1], [8, 1]), speed: 1 } }];

  it('finds no haven on the beat, and havens in the room round the corner', () => {
    const safe = havens(corridor, WINGS);
    for (let x = 1; x <= 8; x++) {
      assert.equal(safe.has(`${x},1`), false, `${x},1 lies on the beat`);
    }
    assert.equal(safe.has('1,3'), true);
    assert.equal(safe.has('8,3'), true);
  });

  it('counts the room behind a shut door as safe, all of it', () => {
    const shut = { ...WINGS, shut: new Set(['4,2']) };
    const safe = havens(corridor, shut);
    for (let x = 1; x <= 8; x++) {
      assert.equal(safe.has(`${x},3`), true, `${x},3 lies behind the door`);
    }
  });

  it('crosses up to the first haven after the start, or to the end', () => {
    const path = tiles([0, 0], [1, 0], [2, 0], [3, 0]);
    assert.deepEqual(stretchOf(path, new Set(['0,0', '2,0'])), path.slice(0, 3));
    assert.deepEqual(stretchOf(path, new Set()), path);
  });
});

describe('Blackout’s patrols, as the walkthrough plays its plans past them', () => {
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const { map, puzzles } = read('../missions/blackout.json');
  const plans = read('fixtures/blackout-plan.json').runs;
  const decor = new Set(map.decor.map((piece) => `${piece.x},${piece.y}`));
  const walkable = (x, y) => map.tiles[y]?.[x] === '.' && !decor.has(`${x},${y}`);
  const opener = ({ opensBy }) =>
    opensBy.kind === 'puzzle' ? opensBy.puzzleId : opensBy.untilSolved;
  /**
   * The stations of a run that draws `drawn` at the Wechselplatz, in the run's order: the pool
   * stands where its first member stands in the file, as the drawn one.
   */
  function runOf(drawn) {
    const first = puzzles.findIndex((puzzle) => puzzle.pool !== undefined);
    return puzzles
      .map((puzzle, i) => (i === first ? puzzles.find((p) => p.id === drawn) : puzzle))
      .filter((puzzle, i) => i === first || puzzle.pool === undefined);
  }
  /**
   * The doors shut and the drones awake while station `index` (0 the first) of the run drawing
   * `drawn` is up: a door opens with the station it names, or with the pool that station has.
   */
  function stage(index, drawn = plans[0].drawn) {
    const solved = runOf(drawn)
      .slice(0, index)
      .flatMap((puzzle) => [puzzle.id, puzzle.pool]);
    const shut = new Set(
      map.doors.filter((door) => !solved.includes(opener(door))).map((d) => `${d.x},${d.y}`),
    );
    const drones = map.drones
      .filter((drone) => drone.activeAfterSolved <= index)
      .map((d) => ({ beat: d, range: d.range, halfAngleDeg: d.halfAngleDeg }));
    return { sight: { tiles: map.tiles, shut }, drones };
  }
  const station = (puzzleId, console) =>
    map.stations.find((s) => s.puzzleId === puzzleId && s.console === console);
  const key = map.items.find((item) => map.manuals.some((m) => m.needsKey === item.id));
  /** Where the plan works and reads at the station `plan` has at the Wechselplatz. */
  const wechselOf = (plan) =>
    ({
      signalkette: {
        'console A': station('signalkette', 'a'),
        'console B': station('signalkette', 'b'),
        clipboard: plan.places.klemmbrett,
      },
      frequenz: { radio: station('frequenz'), cabinet: plan.places.aktenschrank, key },
      notstrom: {
        box: station('notstrom', 'a'),
        meter: station('notstrom', 'b'),
        book: plan.places.wartungsbuch,
      },
    })[plan.drawn];

  it('takes the run’s stations in the run’s order, whichever the Wechselplatz has', () => {
    const drawn = plans.map((plan) => plan.drawn).sort();
    assert.deepEqual(drawn, ['frequenz', 'notstrom', 'signalkette']);
    for (const plan of plans) {
      assert.deepEqual(
        runOf(plan.drawn).map((puzzle) => puzzle.id),
        ['notlicht', 'anlauf', 'paketfilter', 'subsysteme', plan.drawn, 'reaktorstart'],
      );
    }
    // The reactor's doors open with the Wechselplatz, not before.
    const reactor = map.doors.find((door) => door.id === 'reaktortuer');
    for (const plan of plans) {
      assert.equal(stage(4, plan.drawn).sight.shut.has(`${reactor.x},${reactor.y}`), true);
      assert.equal(stage(5, plan.drawn).sight.shut.has(`${reactor.x},${reactor.y}`), false);
    }
  });

  it('lets the crew work each station from the Serverraum on from a haven, and fetch parts', () => {
    // Where each plan works, reads and fetches while each station is up: the Serverraum (3), the
    // station its seed draws at the Wechselplatz (4), the reactor (5).
    for (const plan of plans) {
      const places = [
        [3, { terminal: station('subsysteme', 'a'), rack: station('subsysteme', 'b') }],
        [3, { locker: plan.places.spind }],
        [4, wechselOf(plan)],
        [5, { reactor: station('reaktorstart'), ...plan.ersatzsicherung }],
      ];
      for (const [index, spots] of places) {
        const { sight, drones } = stage(index, plan.drawn);
        const safe = havens(drones, sight);
        for (const [what, spot] of Object.entries(spots)) {
          const round = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({
            x: spot.x + dx,
            y: spot.y + dy,
          }));
          assert.ok(
            round.some((t) => walkable(t.x, t.y) && safe.has(`${t.x},${t.y}`)),
            `no haven by the ${what} at ${spot.x},${spot.y} while station ${index + 1} is up ` +
              `(seed ${plan.seed}, ${plan.drawn})`,
          );
        }
      }
    }
  });

  it('lays the clipboard and the cabinet where no patrol looks, wherever a seed puts them', () => {
    // Both are read with both patrols out: every spot one may lie on is a haven, and so is
    // every tile beside it a reader may stand on (the server's blackoutParked test holds the
    // whole reach to it) — the clipboard at the Flur's west end, past the Flurwache's reach.
    const { sight, drones } = stage(4, 'signalkette');
    const safe = havens(drones, sight);
    for (const station of ['signalkette', 'frequenz']) {
      const source = map.manuals.find((manual) => manual.puzzleIds.includes(station));
      assert.ok(source.spots.length > 1);
      for (const spot of source.spots) {
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const [x, y] = [spot.x + dx, spot.y + dy];
          assert.equal(!walkable(x, y) || safe.has(`${x},${y}`), true, `${x},${y} is watched`);
        }
      }
    }
  });

  it('sleeps till the Serverraum is solved, then watches the way out of it and the south way', () => {
    // Nobody is caught at the Paketfilter's consoles in the Flur, nor on the way in.
    assert.deepEqual(stage(3).drones, []);
    const schott = map.doors.find((door) => door.id === 'serverschott');
    const flur = havens(stage(4).drones, stage(4).sight);
    // The Flur's middle in front of the Serverschott, and the camera plate beside it.
    assert.equal(flur.has(`${schott.x},${schott.y + 1}`), false);
    const plate = map.plates.find((p) => p.id === 'kameraplatte');
    assert.equal(flur.has(`${plate.x},${plate.y}`), false);
    // Through the Süd-Flur to the reactor's door, every tile in a drone's eye.
    const south = havens(stage(5).drones, stage(5).sight);
    const door = map.doors.find((d) => d.id === 'reaktortuer');
    const corridor = [0, 1, 2, 3].map((dx) => `${door.x - 1 - dx},${door.y}`);
    assert.deepEqual(corridor.filter((tile) => south.has(tile)), []);
  });
});
