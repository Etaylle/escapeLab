import { randomBytes } from 'node:crypto';
import {
  DEMO_CODE,
  GameError,
  poolsOf,
  drawPools,
  scaleMission,
  type ClientMessage,
  type CrewPass,
  type Mission,
  type ServerMessage,
} from '@escapelab/core';
import { GAME_KINDS, Room, type GameMessage } from '../room.js';
import type { FinishedRun } from '../store/store.js';
import { DemoCrew } from './crew.js';
import { Seat, type Line } from './seat.js';

/**
 * The demo room: one room the server plays itself, for whoever wants to watch. Two seats of a
 * crew of its own (crew.ts) play the mission to its end, rest, and play the next seed — each
 * seat on a line as a page's socket has one, saying what a page says. The room is no room of
 * the manager's: nobody joins it, no list shows it, its runs are kept nowhere. It plays while
 * somebody watches, and for a while after; then it is closed and stands in its lobby, without a
 * timer, until the next of the audience comes — who sees a run from its start.
 */

export { DEMO_CODE };

/** The names of the demo crew's two seats, as Uros named them (2026-11-19). */
export const DEMO_NAMES = ['HCW Bachelor', 'HCW Master'] as const;

/** How often the crew takes its next step, ms: about a page's twelve position updates a second. */
const TICK_MS = 80;

/** How long the room plays on with nobody watching before it is closed, ms. */
export const DEMO_IDLE_MS = 60_000;

/** How many may watch the demo at once. */
export const DEMO_MAX_WATCHING = 150;

/** What somebody is told who would watch a demo that many watch already. */
export const DEMO_FULL =
  'Die Vorführung ist voll besetzt. In ein paar Minuten ist wieder ein Platz frei.';

/** How many seeds, from 0, the demo's runs are taken from (`demoSeeds`). */
const SEEDS = 100;

/** The demo room by count, as /health says it apart from the rooms. */
export interface DemoCounts {
  /** a run is on in it */
  running: boolean;
  /** audience connections watching it */
  spectators: number;
  /** its runs that ended since the server started, won and lost */
  won: number;
  lost: number;
}

/**
 * The seeds the demo plays, in turn: of the first `upTo` seeds, as many rounds as go of one seed
 * for each station of the mission's first Wechselplatz, in the file's order — so that every run
 * shows the next of them. Every seed in turn for a mission without one.
 */
export function demoSeeds(mission: Mission, upTo = SEEDS): number[] {
  const all = Array.from({ length: upTo }, (_, seed) => seed);
  const [pool] = [...poolsOf(mission.puzzles)];
  if (pool === undefined) {
    return all;
  }
  const [poolId, members] = pool;
  const drawing = members.map((id) =>
    all.filter((seed) => drawPools(mission.puzzles, seed)[poolId] === id),
  );
  const rounds = Math.min(...drawing.map((seeds) => seeds.length));
  return Array.from({ length: rounds }, (_, round) =>
    drawing.map((seeds) => seeds[round] as number),
  ).flat();
}

/** A pass of this boot alone, for a seat nobody else ever sits on. */
const mintPass = (): CrewPass => ({
  id: randomBytes(16).toString('hex'),
  secret: randomBytes(32).toString('hex'),
});

const FOR_THE_GAME: ReadonlySet<ClientMessage['kind']> = new Set(GAME_KINDS);

/** Whether the room acts on `msg` as a move of the game (`Room.act`). */
const forTheGame = (msg: ClientMessage): msg is GameMessage => FOR_THE_GAME.has(msg.kind);

/** `msg` of the seat of `playerId` carried out in `room`, as a socket's is (sockets.ts). */
function carry(room: Room, playerId: string, msg: ClientMessage): void {
  if (msg.kind === 'pos') {
    const { x, y, facing, moving } = msg;
    room.updatePosition(playerId, msg.run, { x, y, facing, moving }, msg.t);
  } else if (msg.kind === 'interact') {
    room.interact(playerId, { x: msg.x, y: msg.y }, msg.t);
  } else if (msg.kind === 'set-ready') {
    room.setReady(playerId, msg.ready);
  } else if (forTheGame(msg)) {
    room.act(playerId, msg);
  } else {
    throw new Error(`a seat of the demo crew does not say "${msg.kind}"`);
  }
}

/**
 * What stands between a seat and the room: each message that goes up to the room or down to the
 * seat passes it, and what it hands back goes on. A test copies each, and notes what was said.
 */
export interface Wire {
  up: (msg: ClientMessage) => ClientMessage;
  down: (msg: ServerMessage) => ServerMessage;
}

/** A wire that hands on what it is given. */
const PLAIN: Wire = { up: (msg) => msg, down: (msg) => msg };

export class DemoHost {
  private live: Room;
  private crew: DemoCrew;
  private ticking: NodeJS.Timeout | null = null;
  private closing: NodeJS.Timeout | null = null;
  /** the runs the demo started so far: the next plays the next of its seeds */
  private started = 0;
  private won = 0;
  private lost = 0;
  private readonly mission: Mission;

  /**
   * `mission` as its file has it; `seeds` are played in turn, round and round; `wire` stands
   * between the seats and the room (`Wire`).
   */
  constructor(
    mission: Mission,
    private readonly seeds: readonly number[] = demoSeeds(mission),
    private readonly wire: Wire = PLAIN,
  ) {
    this.mission = scaleMission(mission, 'normal');
    [this.live, this.crew] = this.open();
  }

  /** The demo room as it stands now: another one after it was closed for nobody watching. */
  get room(): Room {
    return this.live;
  }

  /** A fresh room in its lobby, the crew's two seats in it on their lines. */
  private open(): [Room, DemoCrew] {
    const room = new Room(DEMO_CODE, this.mission, (run) => this.ran(run));
    room.seedsFrom(() => this.nextSeed());
    room.onAudience((watching) => this.watched(watching));
    const complain = (why: string): void => console.warn(`[escapelab] demo: ${why}`);
    const seats = DEMO_NAMES.map((name) => {
      const { playerId } = room.join(name, mintPass());
      const line: Line = {
        send: (msg) => {
          try {
            carry(room, playerId, this.wire.up(msg));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            seat.hear({ kind: 'error', message, of: msg.kind });
          }
        },
      };
      const seat = new Seat(line, complain);
      room.attach(playerId, (msg) => seat.hear(this.wire.down(msg)));
      return seat;
    }) as [Seat, Seat];
    return [room, new DemoCrew(this.mission, seats, complain)];
  }

  /** The seed of the run starting now: the next of the demo's list. */
  private nextSeed(): number {
    const seed = this.seeds[this.started % this.seeds.length] ?? 0;
    this.started += 1;
    console.log(`[escapelab] demo: run ${this.started} plays seed ${seed}`);
    return seed;
  }

  /** A run of the demo ended: counted here, and kept nowhere. */
  private ran({ report }: FinishedRun): void {
    if (report.outcome === 'won') {
      this.won += 1;
    } else {
      this.lost += 1;
    }
  }

  /**
   * An audience connection on the demo room, as `Room.attachSpectator` gives one; refused with
   * DEMO_FULL where DEMO_MAX_WATCHING watch already.
   */
  watch(listener: (msg: ServerMessage) => void): ReturnType<Room['attachSpectator']> {
    if (this.live.watching >= DEMO_MAX_WATCHING) {
      throw new GameError(DEMO_FULL);
    }
    return this.live.attachSpectator(listener);
  }

  /** `watching` watch now: the crew plays while anybody does, and DEMO_IDLE_MS longer. */
  private watched(watching: number): void {
    if (this.closing !== null) {
      clearTimeout(this.closing);
      this.closing = null;
    }
    if (watching > 0) {
      this.play();
    } else if (this.ticking !== null) {
      this.closing = setTimeout(() => this.close(), DEMO_IDLE_MS);
      this.closing.unref();
    }
  }

  /** The crew takes its steps from now on. */
  private play(): void {
    if (this.ticking === null) {
      this.ticking = setInterval(() => this.crew.tick(Date.now()), TICK_MS);
      this.ticking.unref();
    }
  }

  /** Nobody watches any more: the room is let go, and a fresh one stands in its lobby. */
  private close(): void {
    this.closing = null;
    if (this.live.watching > 0) {
      return;
    }
    this.stop();
    console.log('[escapelab] demo: nobody watches, the room rests until somebody does');
    [this.live, this.crew] = this.open();
  }

  /** The crew's steps stop, and every timer of the room with them. */
  stop(): void {
    clearInterval(this.ticking ?? undefined);
    clearTimeout(this.closing ?? undefined);
    this.ticking = null;
    this.closing = null;
    this.live.dispose();
  }

  /** The demo room by count (`DemoCounts`). */
  counts(): DemoCounts {
    return {
      running: this.live.phase === 'playing',
      spectators: this.live.watching,
      won: this.won,
      lost: this.lost,
    };
  }
}
