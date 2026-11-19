import { randomBytes } from 'node:crypto';
import {
  DEMO_CODE,
  GameError,
  poolsOf,
  drawPools,
  scaleMission,
  type ClientMessage,
  type CrewPass,
  type DemoPin,
  type DemoShot,
  type Mission,
  type PlayerView,
  type ServerMessage,
} from '@escapelab/core';
import { GAME_KINDS, Room, type GameMessage } from '../room.js';
import type { FinishedRun } from '../store/store.js';
import { DemoCrew } from './crew.js';
import { direct, type Cut, type Scene, type SeatScene } from './director.js';
import { handsOf, Seat, type CrewSeat, type Line } from './seat.js';

/**
 * The demo room: one room the server plays itself, for whoever wants to watch. Two seats of a
 * crew of its own (crew.ts) play the mission to its end, rest, and play the next seed — each
 * seat on a line as a page's socket has one, saying what a page says. The room is no room of
 * the manager's: nobody joins it, no list shows it, its runs are kept nowhere. It plays while
 * somebody watches, and for a while after; then it is closed and stands in its lobby, without a
 * timer, until the next of the audience comes — who sees a run from its start.
 *
 * Its audience is shown more than any other room's: beside the audience's view of the whole lab
 * it is sent the own view of the seat the director has on air (director.ts), or of the seat a
 * viewer pinned (`demo-view`). That gives away nobody's view: both seats are this server's own
 * machines, and what they see no person plays by. No other room sends its audience a seat's view
 * — `Room` has no way to; the host sends it here, over the lines its own seats hold.
 */

export { DEMO_CODE };

/** The names of the demo crew's two seats, as Uros named them (2026-11-19). */
export const DEMO_NAMES = ['HCW Bachelor', 'HCW Master'] as const;

/** How often the crew takes its next step, ms: about a page's twelve position updates a second. */
const TICK_MS = 80;

/** How long the room plays on with nobody watching before it is closed, ms. */
export const DEMO_IDLE_MS = 60_000;

/**
 * How long a run may go without getting on — no station solved, no hatch opened, no end —
 * before its host gives it up, ms. Over the demo's hundred seeds the longest a crew that plays
 * goes without getting on is 157 s, 191 s where its lines hang for 8 s every minute: five
 * minutes leave it well over a minute and a half.
 */
export const DEMO_STALL_MS = 300_000;

/** How many times in a row the crew may start over, getting nowhere, before the run is given up. */
export const DEMO_COMPLAINTS = 30;

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

/** How far a run is, as `view` has it: its phase, its start, the station up, the hatch. */
function farOf(view: PlayerView | null): string {
  if (view === null) {
    return '';
  }
  const hatch = view.map?.exit?.open === true ? 'open' : 'shut';
  return [view.phase, view.startedAt, view.currentPuzzleIndex, hatch].join('|');
}

/**
 * What stands between a seat and the room: each message that goes up to the room or down to the
 * seat passes it, and what it hands back goes on. A test copies each, and notes what was said.
 */
export interface Wire {
  up: (msg: ClientMessage) => ClientMessage;
  down: (msg: ServerMessage) => ServerMessage;
}

/** One of the demo's audience: its line, and what it pinned its screen to. */
interface Viewer {
  tell: (msg: ServerMessage) => void;
  pin: DemoPin;
}

/** An audience connection on the demo room: `Room.attachSpectator`'s, and its pin. */
export type DemoWatch = ReturnType<Room['attachSpectator']> & {
  /** pins what this connection is shown (`DemoPin`): answered with the seat's view at once */
  pin: (pin: DemoPin) => void;
};

/** A wire that hands on what it is given. */
const PLAIN: Wire = { up: (msg) => msg, down: (msg) => msg };

export class DemoHost {
  private live: Room;
  private crew: DemoCrew;
  /** the crew's seats as it has them in hand: the watchdog reads how far the run is off them */
  private seats: readonly [CrewSeat, CrewSeat];
  /** how far the run was when it last got on, and when that was (epoch ms): `watchdog` */
  private gotOn = { as: '', at: 0 };
  /** how many times the crew has started over since the run last got on */
  private complaints = 0;
  /** who watches, by spectator id */
  private viewers = new Map<string, Viewer>();
  /** what the director has on air; null before its first cut */
  private cut: Cut | null = null;
  /** the seat last on air, by its place in the crew: the lab is heard from where it stands */
  private ear: 0 | 1 = 0;
  /** what the audience was last told is on air, and that as it was sent */
  private shot: DemoShot | null = null;
  private told = '';
  /** the view of each seat as it was last sent on to the audience, by player id */
  private relayed = new Map<string, string>();
  /** when each seat last made a move at a console, epoch ms */
  private acted: [number, number] = [0, 0];
  /** the run and station the director last saw up, and when a station of that run was solved */
  private solved = { run: null as number | null, index: 0, at: null as number | null };
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
    [this.live, this.crew, this.seats] = this.open();
  }

  /** The demo room as it stands now: another one after it was closed for nobody watching. */
  get room(): Room {
    return this.live;
  }

  /** A fresh room in its lobby, the crew's two seats in it on their lines. */
  private open(): [Room, DemoCrew, readonly [CrewSeat, CrewSeat]] {
    const room = new Room(DEMO_CODE, this.mission, (run) => this.ran(run));
    room.seedsFrom(() => this.nextSeed());
    room.onAudience((watching) => this.watched(watching));
    const complain = (why: string): void => {
      this.complaints += 1;
      console.warn(`[escapelab] demo: ${why}`);
    };
    this.viewers = new Map();
    this.relayed = new Map();
    this.cut = null;
    const seats = DEMO_NAMES.map((name, index) => {
      const { playerId } = room.join(name, mintPass());
      const line: Line = {
        send: (msg) => {
          if (msg.kind === 'puzzle-input') {
            this.acted[index as 0 | 1] = Date.now();
          }
          try {
            carry(room, playerId, this.wire.up(msg));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            seat.hear({ kind: 'error', message, of: msg.kind });
          }
        },
      };
      const seat = new Seat(line, complain);
      room.attach(playerId, (msg) => {
        const heard = this.wire.down(msg);
        seat.hear(heard);
        if (heard.kind === 'view') {
          this.relay(heard.view);
        }
      });
      return handsOf(seat);
    }) as [CrewSeat, CrewSeat];
    return [room, new DemoCrew(this.mission, seats, complain), seats];
  }

  /**
   * The crew's next step, and a look at how its run gets on: one that has not got on for
   * DEMO_STALL_MS, or whose crew has started over DEMO_COMPLAINTS times in a row, is given up —
   * lost as by its clock (`Room.runOut`), counted, and the next seed follows after the
   * Auswertung as after any run. Without it a crew that is stuck would stand for the rest of the
   * mission's sixteen minutes, saying so every other second.
   */
  private tick(now: number): void {
    this.crew.tick(now);
    this.directAt(now);
    const view = this.seats[0].view;
    const as = farOf(view);
    if (as !== this.gotOn.as) {
      this.gotOn = { as, at: now };
      this.complaints = 0;
    }
    const stuck = now - this.gotOn.at > DEMO_STALL_MS || this.complaints >= DEMO_COMPLAINTS;
    if (view?.phase === 'playing' && stuck) {
      const waited = ((now - this.gotOn.at) / 1000).toFixed(0);
      console.warn(
        `[escapelab] demo: the run got no further for ${waited} s ` +
          `(${this.complaints} starts over): given up, the next follows`,
      );
      this.gotOn = { as, at: now };
      this.complaints = 0;
      this.live.runOut();
    }
  }

  /** One of the crew's seats as the director sees it at this moment. */
  private seatScene(index: 0 | 1): SeatScene {
    const seat = this.seats[index];
    return {
      id: seat.id,
      doing: this.crew.doing(seat),
      actedAt: this.acted[index],
      drones: Object.keys(seat.drones).length > 0,
    };
  }

  /**
   * When a station of the run on `view` was last solved, as of `now`: this moment, where the
   * station up is a later one than at the last look; null for none yet, and in a new run.
   */
  private solvedBy(view: PlayerView | null, now: number): number | null {
    const run = view?.phase === 'playing' ? view.startedAt : null;
    const index = view?.currentPuzzleIndex ?? 0;
    if (run !== this.solved.run) {
      this.solved = { run, index, at: null };
      this.acted = [0, 0];
    } else if (index > this.solved.index) {
      this.solved = { run, index, at: now };
    }
    return this.solved.at;
  }

  /** The demo as the director sees it at `now` (`Scene`). */
  private sceneAt(now: number): Scene {
    const view = this.seats[0].view;
    const playing = view?.phase === 'playing';
    return {
      now,
      phase: view?.phase ?? 'lobby',
      opening: playing && !view.lights.out,
      solvedAt: this.solvedBy(view, now),
      seats: [this.seatScene(0), this.seatScene(1)],
    };
  }

  /**
   * The director's look at `now`: what is on air, told everybody who watches whenever it or what
   * the crew is doing changed — and, on a cut to a seat, that seat's view to whoever follows the
   * director.
   */
  private directAt(now: number): void {
    const scene = this.sceneAt(now);
    const before = this.cut?.onAir;
    this.cut = direct(scene, this.cut);
    const [a, b] = scene.seats;
    this.ear = this.cut.onAir === b.id ? 1 : this.cut.onAir === a.id ? 0 : this.ear;
    const shot: DemoShot = {
      onAir: this.cut.onAir,
      ear: scene.seats[this.ear].id,
      doing: { [a.id]: a.doing, [b.id]: b.doing },
      caption: this.crew.saying(now),
    };
    const said = JSON.stringify(shot);
    if (said === this.told) {
      return;
    }
    this.told = said;
    this.shot = shot;
    for (const viewer of this.viewers.values()) {
      viewer.tell({ kind: 'demo-shot', shot, at: now });
      if (this.cut.onAir !== before && this.follows(viewer)) {
        this.show(viewer);
      }
    }
  }

  /** Whether `viewer` pinned no seat: it is sent the seat the director has on air, or had. */
  private follows(viewer: Viewer): boolean {
    return viewer.pin === 'regie' || viewer.pin === 'overview';
  }

  /**
   * The seat whose view `viewer` is sent, by its player id: the one it pinned, else the one on
   * air — and while the whole lab is on air, or pinned, the seat last on air (`ear`), by whose
   * view the page keeps its sound.
   */
  private shownTo(viewer: Viewer): string {
    if (this.follows(viewer)) {
      return this.cut?.onAir ?? this.seats[this.ear].id;
    }
    return this.seats[viewer.pin === 'one' ? 0 : 1].id;
  }

  /** `viewer` is sent the view of the seat it is shown, as that seat last had it. */
  private show(viewer: Viewer): void {
    const id = this.shownTo(viewer);
    const view = this.seats.find((seat) => seat.id === id)?.view ?? null;
    if (view !== null) {
      viewer.tell({ kind: 'demo-view', seat: id, view, at: Date.now() });
    }
  }

  /**
   * A seat's view as its line just carried it, on to everybody who is shown that seat — unless
   * it is the view they were sent last: a room tells every seat of each step, and one seat in
   * five of those sees nothing new.
   */
  private relay(view: PlayerView): void {
    const text = JSON.stringify(view);
    if (this.relayed.get(view.you.id) === text) {
      return;
    }
    this.relayed.set(view.you.id, text);
    for (const viewer of this.viewers.values()) {
      if (this.shownTo(viewer) === view.you.id) {
        viewer.tell({ kind: 'demo-view', seat: view.you.id, view, at: Date.now() });
      }
    }
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
   * An audience connection on the demo room, as `Room.attachSpectator` gives one — told at once
   * what is on air and sent that seat's view — with its pin; refused with DEMO_FULL where
   * DEMO_MAX_WATCHING watch already.
   */
  watch(listener: (msg: ServerMessage) => void): DemoWatch {
    if (this.live.watching >= DEMO_MAX_WATCHING) {
      throw new GameError(DEMO_FULL);
    }
    const { spectatorId, detach } = this.live.attachSpectator(listener);
    const viewer: Viewer = { tell: listener, pin: 'regie' };
    const viewers = this.viewers;
    const at = Date.now();
    // The director looks before the newcomer is on the list: it is told once, right here.
    this.directAt(at);
    viewers.set(spectatorId, viewer);
    if (this.shot !== null) {
      listener({ kind: 'demo-shot', shot: this.shot, at });
    }
    this.show(viewer);
    return {
      spectatorId,
      detach: () => {
        viewers.delete(spectatorId);
        detach();
      },
      pin: (pin) => {
        viewer.pin = pin;
        this.show(viewer);
      },
    };
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
      this.ticking = setInterval(() => this.tick(Date.now()), TICK_MS);
      this.ticking.unref();
    }
  }

  /**
   * Nobody has watched for DEMO_IDLE_MS: the room is let go, and a fresh one stands in its
   * lobby. Whoever comes to watch meanwhile calls this off (`watched`).
   */
  private close(): void {
    this.closing = null;
    this.stop();
    console.log('[escapelab] demo: nobody watches, the room rests until somebody does');
    [this.live, this.crew, this.seats] = this.open();
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
