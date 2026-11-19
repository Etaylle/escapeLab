import { describe, expect, it } from 'vitest';
import {
  WALK_SPEED,
  type ClientMessage,
  type DronePosition,
  type MapDef,
  type MapView,
  type Mission,
  type PlayerView,
} from '@escapelab/core';
import { both, Dice, pause, type Clock, type Script } from '../src/demo/script.js';
import { Seat } from '../src/demo/seat.js';
import { NoWay, Walks } from '../src/demo/walks.js';

/**
 * A seat of the demo crew on a line of its own, and its walk: what it says is what a page says,
 * where it stands is where it walked itself — until the room says otherwise — and it walks at a
 * player's pace, waiting on a haven for the patrol to pass.
 *
 *   #############
 *   #...........#   y 1: the corridor, the drone's beat from x 1 to x 11 and back
 *   #####.#######
 *   #...........#   y 3: the room below it, a door at (6,3)
 *   #############
 */
const TILES = ['#############', '#...........#', '#####.#######', '#...........#', '#############'];

const DRONE = {
  id: 'wache',
  waypoints: [
    { x: 1, y: 1 },
    { x: 11, y: 1 },
  ],
  speed: 2,
  range: 4,
  halfAngleDeg: 30,
  penaltySec: 15,
  activeAfterSolved: 0,
} as MapDef['drones'][number];

const mission = { map: { drones: [DRONE] } } as unknown as Mission;

/** The view of a run begun at `startedAt`, the seat's spawn at (1,3), the door open or shut. */
function viewOf(startedAt: number, doorOpen = true): PlayerView {
  const map = {
    tiles: TILES,
    yourSpawn: { x: 1, y: 3 },
    doors: [{ id: 'tuer', x: 6, y: 3, open: doorOpen }],
    plates: [],
    decor: [],
  } as unknown as MapView;
  const you = { id: 'a', name: 'Automat A' };
  return { phase: 'playing', startedAt, you, map } as unknown as PlayerView;
}

/** A seat on a line that keeps what it sent, its clock the test's. */
function seated(clock: Clock) {
  const sent: ClientMessage[] = [];
  const refused: string[] = [];
  const seat = new Seat(
    { send: (msg) => void sent.push(msg) },
    (why) => void refused.push(why),
    () => clock.now,
  );
  return { seat, sent, refused };
}

/** `script` run on `clock`, a tick of 80 ms at a time, for `seconds` at most: whether it ended. */
function run(script: Script, clock: Clock, seconds: number): boolean {
  for (let tick = 0; tick * 80 < seconds * 1000; tick++) {
    if (script.next().done === true) {
      return true;
    }
    clock.now += 80;
  }
  return false;
}

const drones = (x: number, facing: number): Record<string, DronePosition> => ({
  wache: { x, y: 1.5, facing, range: 4, halfAngleDeg: 30, alerted: false, frozen: false },
});

describe('a seat of the demo crew', () => {
  it('stands on the spawn its run drew, and steps as a page streams it', () => {
    const clock = { now: 5000 };
    const { seat, sent } = seated(clock);
    seat.hear({ kind: 'view', view: viewOf(1000), at: 0 });
    expect(seat.at).toEqual({ x: 1.5, y: 3.5 });
    expect([seat.id, seat.name]).toEqual(['a', 'Automat A']);
    seat.stepTo({ x: 1.5, y: 3.9 }, true);
    expect(sent).toEqual([
      { kind: 'pos', run: 1000, x: 1.5, y: 3.9, facing: Math.PI / 2, moving: true, t: 5000 },
    ]);
    seat.lookAt({ x: 0.5, y: 3.9 });
    expect(sent.at(-1)).toMatchObject({ kind: 'pos', facing: Math.PI, moving: false });
    seat.press();
    expect(sent.at(-1)).toEqual({ kind: 'interact', x: 1.5, y: 3.9, t: 5000 });
  });

  it('takes the room’s word where a step was refused, and for no other run than its own', () => {
    const { seat, refused } = seated({ now: 0 });
    seat.hear({ kind: 'view', view: viewOf(1000), at: 0 });
    seat.stepTo({ x: 2.5, y: 3.5 }, true);
    const thrown = { x: 1.5, y: 3.5, facing: 0, moving: false, t: null, rt: 0 };
    seat.hear({ kind: 'positions', run: 999, players: { a: thrown }, drones: {} });
    expect(seat.at).toEqual({ x: 2.5, y: 3.5 });
    seat.hear({ kind: 'positions', run: 1000, players: { a: thrown }, drones: drones(4, 0) });
    expect(seat.at).toEqual({ x: 1.5, y: 3.5 });
    expect(Object.keys(seat.drones)).toEqual(['wache']);
    seat.hear({ kind: 'error', message: 'Zu weit weg.', of: 'interact' });
    expect(refused).toEqual(['Automat A: interact refused, Zu weit weg.']);
    // The next run stands it on its spawn again, the last run's drones gone.
    seat.stepTo({ x: 4.5, y: 3.5 }, true);
    seat.hear({ kind: 'view', view: viewOf(2000), at: 0 });
    expect(seat.at).toEqual({ x: 1.5, y: 3.5 });
    expect(seat.drones).toEqual({});
  });
});

describe('a walk of the demo crew', () => {
  it('goes at a player’s pace, through every corner, and ends on the point asked for', () => {
    const clock = { now: 0 };
    const { seat, sent } = seated(clock);
    seat.hear({ kind: 'view', view: viewOf(1000), at: 0 });
    const walks = new Walks(mission, clock, () => false);
    const walk = walks.to(seat, { x: 5.5, y: 1.25 });
    expect(run(walk, clock, 1)).toBe(false);
    // A second in — thirteen ticks, the first of which it set out on — it is twelve steps on.
    const walked = Math.abs(seat.at.x - 1.5) + Math.abs(seat.at.y - 3.5);
    expect(walked).toBeCloseTo(WALK_SPEED * 0.08 * 12, 6);
    expect(run(walk, clock, 2)).toBe(true);
    expect(seat.at).toEqual({ x: 5.5, y: 1.25 });
    const steps = sent.flatMap((msg) => (msg.kind === 'pos' ? [msg] : []));
    expect(steps.some((step) => step.x === 5.5 && step.y === 3.5)).toBe(true);
    expect(steps.some((step) => step.x === 5.5 && step.y === 2.5)).toBe(true);
    const longest = Math.max(
      ...steps.slice(1).map((step, i) => {
        const before = steps[i] ?? step;
        return Math.hypot(step.x - before.x, step.y - before.y);
      }),
    );
    expect(longest).toBeLessThanOrEqual(WALK_SPEED * 0.08 + 1e-9);
    expect(steps.at(-1)?.moving).toBe(false);
  });

  it('goes on from where the room threw it back to, with no leap', () => {
    const clock = { now: 0 };
    const { seat, sent } = seated(clock);
    seat.hear({ kind: 'view', view: viewOf(1000), at: 0 });
    const walks = new Walks(mission, clock, () => false);
    const walk = walks.to(seat, { x: 9.5, y: 3.5 });
    expect(run(walk, clock, 1)).toBe(false);
    expect(seat.at.x).toBeGreaterThan(5);
    // The room refused its last steps: it has the figure two tiles back.
    const back = { x: 3.5, y: 3.5, facing: 0, moving: false, t: null, rt: 0 };
    seat.hear({ kind: 'positions', run: 1000, players: { a: back }, drones: {} });
    const from = sent.length;
    expect(run(walk, clock, 3)).toBe(true);
    expect(seat.at).toEqual({ x: 9.5, y: 3.5 });
    const first = sent[from];
    expect(first?.kind === 'pos' ? first.x - back.x : null).toBeCloseTo(WALK_SPEED * 0.08, 6);
  });

  it('finds no way through a shut door', () => {
    const clock = { now: 0 };
    const { seat } = seated(clock);
    seat.hear({ kind: 'view', view: viewOf(1000, false), at: 0 });
    const walks = new Walks(mission, clock, () => false);
    expect(walks.reaches(seat, { x: 9.5, y: 3.5 })).toBe(false);
    expect(walks.reaches(seat, { x: 5.5, y: 1.5 })).toBe(true);
    expect(() => run(walks.to(seat, { x: 9.5, y: 3.5 }), clock, 1)).toThrow(NoWay);
  });

  it('waits on its haven while the drone looks down the corridor, then sets out', () => {
    const clock = { now: 0 };
    const { seat } = seated(clock);
    seat.hear({ kind: 'view', view: viewOf(1000), at: 0 });
    const walks = new Walks(mission, clock, () => false);
    // The room below is no drone's to look at: the walk to the gap under the corridor is free.
    seat.hear({ kind: 'positions', run: 1000, players: {}, drones: drones(1.5, 0) });
    expect(run(walks.to(seat, { x: 5.5, y: 2.5 }), clock, 3)).toBe(true);
    // Out into the corridor and west, before the drone flying at it: not while it comes.
    const out = walks.to(seat, { x: 3.5, y: 1.5 });
    for (let x = 1.5; x < 4; x += 0.16) {
      seat.hear({ kind: 'positions', run: 1000, players: {}, drones: drones(x, 0) });
      expect(out.next().done).toBe(false);
      clock.now += 80;
    }
    expect(seat.at).toEqual({ x: 5.5, y: 2.5 });
    // Flown past and off towards the east end, its back to the gap: out, and there in a second.
    seat.hear({ kind: 'positions', run: 1000, players: {}, drones: drones(10.5, 0) });
    expect(run(out, clock, 1.2)).toBe(true);
    expect(seat.at).toEqual({ x: 3.5, y: 1.5 });
  });

  it('stands still for an emergency that finds it on a haven, the drones about', () => {
    const clock = { now: 0 };
    const { seat } = seated(clock);
    seat.hear({ kind: 'view', view: viewOf(1000), at: 0 });
    let emergency = true;
    const walks = new Walks(mission, clock, () => emergency);
    seat.hear({ kind: 'positions', run: 1000, players: {}, drones: drones(10.5, 0) });
    const walk = walks.to(seat, { x: 5.5, y: 1.5 });
    expect(run(walk, clock, 2)).toBe(false);
    expect(seat.at).toEqual({ x: 1.5, y: 3.5 });
    emergency = false;
    expect(run(walk, clock, 3)).toBe(true);
  });
});

describe('the crew’s scripts', () => {
  it('pause on the crew’s clock, and run side by side until both are done', () => {
    const clock = { now: 0 };
    const done: string[] = [];
    function* note(ms: number, what: string): Script {
      yield* pause(clock, ms);
      done.push(what);
    }
    expect(run(both(note(400, 'long'), note(160, 'short')), clock, 1)).toBe(true);
    expect(done).toEqual(['short', 'long']);
    expect(clock.now).toBe(400);
  });

  it('throw the same dice again for every run', () => {
    const dice = new Dice(1);
    const first = [dice.between([1000, 2000]), dice.between([1000, 2000])];
    expect(first[0]).not.toBe(first[1]);
    expect(first.every((n) => n >= 1000 && n <= 2000)).toBe(true);
    dice.again();
    expect([dice.between([1000, 2000]), dice.between([1000, 2000])]).toEqual(first);
  });
});
