import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseMission,
  SPRINT_FACTOR,
  STEP_MARGIN,
  UPDATES_PER_SECOND,
  WALK_SPEED,
  walkable,
  type Mission,
  type ServerMessage,
} from '@escapelab/core';
import { Room } from '../src/room.js';
import { walkTo, type Walker } from './walk.js';

/**
 * Blackout: the Serverschott in the Flur's north wall, into the Serverraum, opens
 * with station 3; the Maschinenraum door in its south wall while the Flur plate
 * is held. Of its spawns, the first lies in the Archiv and the second at the
 * Flur's west end. Its clock starts once the lights have gone out,
 * `intro.lightsSec` in.
 */
const blackout: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);
const [ARCHIV = { x: 0, y: 0 }, FLUR = { x: 0, y: 0 }] = blackout.map.spawns;
/** A door of Blackout by its id; throws where it has none. */
function doorOf(id: string): { x: number; y: number } {
  const door = blackout.map.doors.find((d) => d.id === id);
  if (door === undefined) {
    throw new Error(`Blackout has no door ${id}`);
  }
  return door;
}
const SCHOTT = doorOf('serverschott');
const MASCHINENTUER = doorOf('maschinentuer');
/** In front of the Serverschott, in the Flur, the tile below it. */
const BY_THE_SCHOTT = { x: SCHOTT.x + 0.5, y: SCHOTT.y + 1.5 };
/** In front of the Maschinenraum door, in the Flur, the tile above it. */
const BY_THE_DOOR = { x: MASCHINENTUER.x + 0.5, y: MASCHINENTUER.y - 0.4 };
/** Through the Maschinenraum door, in the Maschinenraum: 1.45 tiles on, one step. */
const THROUGH_THE_DOOR = { x: MASCHINENTUER.x + 0.5, y: MASCHINENTUER.y + 1.05 };
const flurplatte = blackout.map.plates.find((p) => p.id === 'flurplatte') ?? { x: 0, y: 0 };
/** On the Flur plate that holds the Maschinenraum door. */
const ON_THE_PLATE = { x: flurplatte.x + 0.5, y: flurplatte.y + 0.5 };

type Player = Walker & {
  token: string;
  listen: (m: ServerMessage) => void;
  /** lets go of the connection, as its socket closing does */
  detach: () => void;
};

function join(room: Room, name: string): Player {
  const messages: ServerMessage[] = [];
  const player = { ...room.join(name), messages, listen: (m: ServerMessage) => messages.push(m) };
  return { ...player, detach: room.attach(player.playerId, player.listen) };
}

function lastView(walker: Walker) {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected a view message');
  }
  return last.view;
}

function lastPositions(walker: Walker) {
  const last = walker.messages.filter((m) => m.kind === 'positions').at(-1);
  if (last?.kind !== 'positions') {
    throw new Error('expected a positions message');
  }
  return last;
}

function runOf(walker: Walker): number {
  return lastView(walker).startedAt ?? Number.NaN;
}

/** Where `walker`'s own spawn of this run lies, as a spot in the middle of its tile. */
function spawnOf(walker: Walker): { x: number; y: number } {
  const spawn = lastView(walker).map?.yourSpawn;
  if (spawn === undefined) {
    throw new Error('expected a run with a drawn spawn');
  }
  return { x: spawn.x + 0.5, y: spawn.y + 0.5 };
}

/**
 * A first step off a spawn: half a tile towards the first neighbouring tile that is floor no
 * furniture takes — south, east, north or west. The rematch draws its spawns at random, and
 * from (3,3) in the Archiv the way south runs into a shelf.
 */
function stepOff(spot: { x: number; y: number }): { x: number; y: number } {
  const floor = (x: number, y: number): boolean =>
    walkable(blackout.map, Math.floor(x), Math.floor(y));
  const ways = [
    [0, 0.5],
    [0.5, 0],
    [0, -0.5],
    [-0.5, 0],
  ] as const;
  const [dx, dy] = ways.find(([wx, wy]) => floor(spot.x + 2 * wx, spot.y + 2 * wy)) ?? [0, 0];
  return { x: spot.x + dx, y: spot.y + dy };
}

/** One position update, as a client streams it. */
function send(room: Room, walker: Walker, run: number, x: number, y: number): void {
  room.updatePosition(walker.playerId, run, { x, y, facing: 0, moving: true });
}

describe('Room movement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * A run with Anna on the Flur spawn and Ben in the Archiv. The room draws
   * the spawns, so runs are started until it draws that way.
   */
  function started() {
    for (let attempt = 0; attempt < 128; attempt++) {
      const room = new Room('TEST', blackout);
      const anna = join(room, 'Anna');
      const ben = join(room, 'Ben');
      room.setReady(ben.playerId, true);
      room.act(anna.playerId, { kind: 'start-mission' });
      const drew = (walker: Walker, spot: { x: number; y: number }): boolean =>
        JSON.stringify(lastView(walker).map?.yourSpawn) === JSON.stringify(spot);
      if (drew(anna, FLUR) && drew(ben, ARCHIV)) {
        return { room, anna, ben };
      }
      room.dispose();
    }
    throw new Error('128 runs, and the spawns never fell that way');
  }

  /** Where the positions broadcast to `to` has `who`, once the fan-out has caught up. */
  function broadcastSpot(to: Walker, who: Walker): { x: number; y: number } | undefined {
    vi.advanceTimersByTime(100);
    const at = lastPositions(to).players[who.playerId];
    return at === undefined ? undefined : { x: at.x, y: at.y };
  }

  it('starts everybody on the spawn just drawn after a rematch, and drops the run before', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { room, anna, ben } = started();
    walkTo(room, anna, BY_THE_SCHOTT.x, BY_THE_SCHOTT.y);
    const lastRun = runOf(anna);
    vi.advanceTimersByTime(((blackout.intro?.lightsSec ?? 0) + blackout.timeLimitSec) * 1000 + 1);
    expect(lastView(anna).phase).toBe('lost');

    room.setReady(ben.playerId, true);
    room.setReady(anna.playerId, true);
    const run = runOf(anna);
    expect(lastView(anna).phase).toBe('playing');
    expect(run).not.toBe(lastRun);
    // The view of the new run comes first; once the fan-out has caught up, it
    // carries the new run with everybody on the spawn just drawn.
    for (const player of [anna, ben]) {
      expect(broadcastSpot(anna, player)).toEqual(spawnOf(player));
    }
    expect(lastPositions(anna).run).toBe(run);

    // A step stamped with the run before is dropped, though this run would take it.
    const spawn = spawnOf(anna);
    send(room, anna, lastRun, spawn.x, spawn.y + 0.5);
    expect(broadcastSpot(ben, anna)).toEqual(spawn);
    // A client still where the last run left it is refused: too far from its spawn.
    send(room, anna, run, BY_THE_SCHOTT.x, BY_THE_SCHOTT.y);
    expect(broadcastSpot(ben, anna)).toEqual(spawn);
    expect(warn).toHaveBeenCalledTimes(1);
    // The first step of the run sets out from the spawn, onto open floor.
    const first = stepOff(spawn);
    expect(first).not.toEqual(spawn);
    send(room, anna, run, first.x, first.y);
    expect(broadcastSpot(ben, anna)).toEqual(first);
    room.dispose();
  });

  it('refuses a step through the shut Serverschott, keeps the old spot and logs it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { room, anna, ben } = started();
    walkTo(room, anna, BY_THE_SCHOTT.x, BY_THE_SCHOTT.y);
    expect(lastView(anna).map?.doors.find((d) => d.id === 'serverschott')?.open).toBe(false);
    // 1.5 tiles north: into the Serverschott's tile, shut.
    send(room, anna, runOf(anna), BY_THE_SCHOTT.x, SCHOTT.y);
    expect(broadcastSpot(ben, anna)).toEqual(BY_THE_SCHOTT);
    expect(broadcastSpot(anna, anna)).toEqual(BY_THE_SCHOTT);
    expect(warn).toHaveBeenCalledTimes(1);
    const from = `${BY_THE_SCHOTT.x.toFixed(2)},${BY_THE_SCHOTT.y.toFixed(2)}`;
    const to = `${BY_THE_SCHOTT.x.toFixed(2)},${SCHOTT.y.toFixed(2)}`;
    expect(warn.mock.calls[0]?.[0]).toContain(
      `refused Anna's step from ${from} to ${to} (1 refused here so far)`,
    );
    room.dispose();
  });

  it('takes a normal step', () => {
    const { room, anna, ben } = started();
    walkTo(room, anna, BY_THE_SCHOTT.x, BY_THE_SCHOTT.y);
    const step = { x: BY_THE_SCHOTT.x - 0.6, y: BY_THE_SCHOTT.y };
    send(room, anna, runOf(anna), step.x, step.y);
    expect(broadcastSpot(ben, anna)).toEqual(step);
    room.dispose();
  });

  it('takes a sprint down the Flur and its burst after lag, but no jump at twice the walk', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { room, anna, ben } = started();
    walkTo(room, anna, BY_THE_SCHOTT.x, BY_THE_SCHOTT.y);
    const run = runOf(anna);
    /** A spot as the client streams it, to the hundredth of a tile. */
    const sent = (x: number): number => Math.round(x * 100) / 100;
    const stepAt = (factor: number): number => (WALK_SPEED * factor) / UPDATES_PER_SECOND;
    // Six sprinted updates west along the Flur, about 12 a second.
    const y = BY_THE_SCHOTT.y;
    let x = BY_THE_SCHOTT.x;
    for (let i = 0; i < 6; i++) {
      x = sent(x - stepAt(SPRINT_FACTOR));
      send(room, anna, run, x, y);
    }
    expect(broadcastSpot(ben, anna)).toEqual({ x, y });
    // A lag burst at the sprint, 1.6 tiles: within its step and the margin, past the walk's 1.5.
    expect(stepAt(SPRINT_FACTOR) + STEP_MARGIN).toBeGreaterThanOrEqual(1.6);
    x = sent(x - 1.6);
    send(room, anna, run, x, y);
    expect(broadcastSpot(ben, anna)).toEqual({ x, y });
    expect(warn).not.toHaveBeenCalled();
    // Twice the walk with the same burst is a teleport: refused, the old spot kept.
    send(room, anna, run, sent(x - (stepAt(2) + STEP_MARGIN)), y);
    expect(broadcastSpot(ben, anna)).toEqual({ x, y });
    expect(warn).toHaveBeenCalledTimes(1);
    room.dispose();
  });

  it('takes a step through the Maschinenraum door only while its plate is held', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { room, anna, ben } = started();
    walkTo(room, anna, BY_THE_DOOR.x, BY_THE_DOOR.y);
    send(room, anna, runOf(anna), THROUGH_THE_DOOR.x, THROUGH_THE_DOOR.y);
    expect(broadcastSpot(ben, anna)).toEqual(BY_THE_DOOR);
    walkTo(room, ben, ON_THE_PLATE.x, ON_THE_PLATE.y);
    expect(lastView(anna).map?.doors.find((d) => d.id === 'maschinentuer')?.open).toBe(true);
    send(room, anna, runOf(anna), THROUGH_THE_DOOR.x, THROUGH_THE_DOOR.y);
    expect(broadcastSpot(ben, anna)).toEqual(THROUGH_THE_DOOR);
    room.dispose();
  });

  it('keeps the spot of a player who comes back, and takes their next step from it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { room, anna, ben } = started();
    walkTo(room, anna, BY_THE_SCHOTT.x, BY_THE_SCHOTT.y);
    anna.detach();
    expect(lastView(ben).pausedFor).toEqual(['Anna']);

    const back: Walker = { playerId: anna.playerId, messages: [] };
    room.resume(anna.playerId, anna.token);
    room.attach(anna.playerId, (m) => back.messages.push(m));
    expect(lastView(back).pausedFor).toBeNull();
    const kept = lastPositions(back);
    expect(kept.run).toBe(runOf(back));
    expect(kept.players[anna.playerId]).toMatchObject(BY_THE_SCHOTT);

    walkTo(room, back, ON_THE_PLATE.x, ON_THE_PLATE.y);
    expect(broadcastSpot(ben, back)).toEqual(ON_THE_PLATE);
    expect(lastView(ben).map?.plates.find((p) => p.id === 'flurplatte')?.pressed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    room.dispose();
  });
});

describe('Room positions as they fan out', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A Blackout run of two: what Ben's screen is sent while Anna walks the Flur. */
  function walkingRun() {
    const room = new Room('TEST', blackout);
    const anna = join(room, 'Anna');
    const ben = join(room, 'Ben');
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben, run: runOf(anna) };
  }

  it('carry when each position was true by its sender and when the room took it', () => {
    const { room, anna, ben, run } = walkingRun();
    const from = spawnOf(anna);
    const to = stepOff(from);
    vi.advanceTimersByTime(500);
    room.updatePosition(anna.playerId, run, { ...to, facing: 0, moving: true }, 4_242.5);
    const relayed = lastPositions(ben).players;
    const sample = { ...to, facing: 0, moving: true, t: 4_242.5, rt: Date.now() };
    expect(relayed[anna.playerId]).toEqual(sample);
    // A spawn the room placed itself has no sender's moment: its receipt is all it has.
    expect(relayed[ben.playerId]).toMatchObject({ t: null, rt: 1_700_000_000_000 });
    room.dispose();
  });

  it('go out only with something new — a sample never twice — and once a second else', () => {
    const { room, anna, ben, run } = walkingRun();
    // Past the intro: the lights out, the patrols' clock ticking, every drone still asleep.
    vi.advanceTimersByTime((blackout.intro?.lightsSec ?? 0) * 1000 + 2_000);
    expect(lastView(anna).lights.out).toBe(true);
    const heard = ben.messages.length;
    // Anna walks on the spot's tile and back for 2 s, a position every 80 ms; nothing else moves.
    const from = spawnOf(anna);
    const to = stepOff(from);
    for (let i = 0; i < 25; i++) {
      const k = (i % 10) / 10;
      const at = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
      room.updatePosition(anna.playerId, run, { ...at, facing: 0, moving: true }, 10_000 + i * 80);
      vi.advanceTimersByTime(80);
    }
    const walked = ben.messages.slice(heard).filter((m) => m.kind === 'positions');
    const tOf = (m: ServerMessage): number | null | undefined =>
      m.kind === 'positions' ? m.players[anna.playerId]?.t : null;
    const samples = walked.map(tOf);
    expect(walked).toHaveLength(25);
    expect(samples.filter((t, i) => i > 0 && t === samples[i - 1])).toEqual([]);
    // Then she stands: the positions go out once a second.
    const stood = ben.messages.length;
    vi.advanceTimersByTime(3_000);
    expect(ben.messages.slice(stood).filter((m) => m.kind === 'positions')).toHaveLength(3);
    room.dispose();
  });
});
