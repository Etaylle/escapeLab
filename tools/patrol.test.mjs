import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
