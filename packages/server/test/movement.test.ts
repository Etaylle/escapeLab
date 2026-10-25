import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, walkable, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { walkTo, type Walker } from './walk.js';

/**
 * Blackout: the Serverschott (15,6) between the Flur and the Serverraum opens
 * with station 3; the Maschinenraum door (4,10) while the Flur plate (6,9) is
 * held. Of its spawns, (1,8) lies at the Flur's west end and (3,3) in the
 * Archiv. Its clock starts once the lights have gone out, `intro.lightsSec` in.
 */
const blackout: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);
const FLUR = { x: 1, y: 8 };
const ARCHIV = { x: 3, y: 3 };
/** In front of the Serverschott, in the Flur. */
const BY_THE_SCHOTT = { x: 15.5, y: 7.5 };

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
    send(room, anna, runOf(anna), 15.5, 6.0);
    expect(broadcastSpot(ben, anna)).toEqual(BY_THE_SCHOTT);
    expect(broadcastSpot(anna, anna)).toEqual(BY_THE_SCHOTT);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(
      /refused Anna's step from 15\.50,7\.50 to 15\.50,6\.00 \(1 refused here so far\)/,
    );
    room.dispose();
  });

  it('takes a normal step', () => {
    const { room, anna, ben } = started();
    walkTo(room, anna, BY_THE_SCHOTT.x, BY_THE_SCHOTT.y);
    send(room, anna, runOf(anna), 14.9, 7.5);
    expect(broadcastSpot(ben, anna)).toEqual({ x: 14.9, y: 7.5 });
    room.dispose();
  });

  it('takes a step through the Maschinenraum door only while its plate is held', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { room, anna, ben } = started();
    walkTo(room, anna, 4.5, 9.6);
    send(room, anna, runOf(anna), 4.5, 11.05);
    expect(broadcastSpot(ben, anna)).toEqual({ x: 4.5, y: 9.6 });
    walkTo(room, ben, 6.5, 9.5);
    expect(lastView(anna).map?.doors.find((d) => d.id === 'maschinentuer')?.open).toBe(true);
    send(room, anna, runOf(anna), 4.5, 11.05);
    expect(broadcastSpot(ben, anna)).toEqual({ x: 4.5, y: 11.05 });
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

    walkTo(room, back, 6.5, 9.5);
    expect(broadcastSpot(ben, back)).toEqual({ x: 6.5, y: 9.5 });
    expect(lastView(ben).map?.plates.find((p) => p.id === 'flurplatte')?.pressed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    room.dispose();
  });
});
