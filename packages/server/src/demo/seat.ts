import type {
  ClientMessage,
  DronePosition,
  MapView,
  PlayerView,
  ServerMessage,
} from '@escapelab/core';
import { distance, middleOf, type Spot } from './route.js';

/**
 * A seat of the demo crew as a page holds one: what its line heard last — its view, where the
 * room has it, where the drones fly — and what it sends: positions, E, the moves of the game.
 * It has the line and nothing else of the room: every word it says is a client's message, and
 * all it knows came over the line.
 */

/** A seat's line to its room: what a page's socket takes. */
export interface Line {
  send(msg: ClientMessage): void;
}

/** What a seat says of the game, beside where it stands: the messages a room acts on. */
type Said = Exclude<ClientMessage, { kind: 'pos' | 'interact' }>;

/** How far the room may have a seat from where it walked itself before it takes the room's word. */
const THROWN_BACK = 0.05;

export class Seat {
  /** the latest view the line carried; null before the first */
  view: PlayerView | null = null;
  /** where the seat's figure stands, as it walked it */
  at: Spot = { x: 0, y: 0 };
  /** the way it looks, rad */
  facing = 0;
  /** the drones awake as the stream last had them, by id, and when (epoch ms) */
  drones: Readonly<Record<string, DronePosition>> = {};
  dronesAt = 0;
  /** the run the figure stands in, by its `startedAt`; null for none */
  private run: number | null = null;

  /** `refused` hears what the room refused of the seat's words, for the log. */
  constructor(
    private readonly line: Line,
    private readonly refused: (why: string) => void = () => undefined,
    private readonly clock: () => number = Date.now,
  ) {}

  /** A message of the room, as the line carries it. */
  hear(msg: ServerMessage): void {
    if (msg.kind === 'view') {
      this.take(msg.view);
    } else if (msg.kind === 'positions') {
      this.drones = msg.drones;
      this.dronesAt = this.clock();
      this.standAs(msg);
    } else if (msg.kind === 'error') {
      this.refused(`${this.name}: ${msg.of ?? 'a word'} refused, ${msg.message}`);
    }
  }

  /** Where the room has the figure, where that is not where the seat walked it: a step refused. */
  private standAs(msg: Extract<ServerMessage, { kind: 'positions' }>): void {
    const mine = msg.players[this.id];
    if (mine !== undefined && msg.run === this.run && distance(mine, this.at) > THROWN_BACK) {
      this.at = { x: mine.x, y: mine.y };
    }
  }

  /** `view` is the seat's latest: a new run stands its figure on the spawn it drew. */
  private take(view: PlayerView): void {
    this.view = view;
    const run = view.phase === 'playing' ? view.startedAt : null;
    if (run !== this.run && view.map !== null) {
      this.at = middleOf(view.map.yourSpawn);
      this.drones = {};
    }
    this.run = run;
  }

  /** The seat's id in its room; '' before its first view. */
  get id(): string {
    return this.view?.you.id ?? '';
  }

  /** The seat's name in its room. */
  get name(): string {
    return this.view?.you.name ?? '';
  }

  /** The map of the run on; throws outside one. */
  get map(): MapView {
    const map = this.view?.map ?? null;
    if (map === null) {
      throw new Error(`${this.name || 'a seat'} has no map: no run is on`);
    }
    return map;
  }

  /** The figure steps to `to`, looking where it goes: walking on (`moving`), or come to rest. */
  stepTo(to: Spot, moving: boolean): void {
    if (distance(to, this.at) > 0) {
      this.facing = Math.atan2(to.y - this.at.y, to.x - this.at.x);
    }
    this.at = { x: to.x, y: to.y };
    this.report(moving);
  }

  /** The figure turns to look at `target`, standing where it stands. */
  lookAt(target: Spot): void {
    if (distance(target, this.at) > 0) {
      this.facing = Math.atan2(target.y - this.at.y, target.x - this.at.x);
      this.report(false);
    }
  }

  /** Where the figure stands goes to the room, as a page streams it. */
  private report(moving: boolean): void {
    if (this.run === null) {
      return;
    }
    const { at, facing, run } = this;
    this.line.send({ kind: 'pos', run, x: at.x, y: at.y, facing, moving, t: this.clock() });
  }

  /** E, pressed where the figure stands. */
  press(): void {
    this.line.send({ kind: 'interact', x: this.at.x, y: this.at.y, t: this.clock() });
  }

  /** A word of the game: a move at the open station, a source opened, a yes to the next run. */
  say(msg: Said): void {
    this.line.send(msg);
  }
}
