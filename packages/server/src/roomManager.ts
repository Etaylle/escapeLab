import {
  GameError,
  type CrewPass,
  type Difficulty,
  type Mission,
  type RoomSummary,
  type Seat,
} from '@escapelab/core';
import { Room, type RunListener, type Sealer } from './room.js';
import { seal } from './seal.js';

/** Room codes avoid ambiguous characters (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

/** The rooms by count, as /health says them: no code and no name. */
export interface RoomCounts {
  total: number;
  /** runs on, paused or not */
  running: number;
  /** runs on that stand paused, waiting for somebody away */
  paused: number;
  /** players on the line: their seats each played on a connection */
  players: number;
  /** audience connections */
  spectators: number;
}

/**
 * Whether a new room may be pinned to a seed, so that its runs repeat: with
 * ALLOW_SEED=1, as `pnpm dev` and CI set it; not with 0 or unset. Throws for
 * anything else, so that a misspelt switch cannot leave a test run to chance.
 */
export function seedsAllowed(env: NodeJS.ProcessEnv): boolean {
  const flag = env['ALLOW_SEED'] ?? '';
  if (flag === '1') {
    return true;
  }
  if (flag === '' || flag === '0') {
    return false;
  }
  throw new Error(
    `ALLOW_SEED=${flag} versteht der Server nicht — ALLOW_SEED=1 lässt Räume einen festen ` +
      'Seed tragen, ohne bleibt es beim Zufall',
  );
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  /**
   * `onRunFinished` hears of every run that ends in any of these rooms;
   * `allowSeed` (`seedsAllowed`) lets a new room be pinned to a seed;
   * `dailySalt` (dailySalt.ts) makes the Tagesschicht's seeds in every room;
   * `sealKey` (seal.ts `roomKey`) seals the snapshots every room sends its crew — none without.
   */
  constructor(
    private readonly onRunFinished: RunListener = () => undefined,
    private readonly allowSeed = false,
    private readonly dailySalt: string | null = null,
    private readonly sealKey: Buffer | null = null,
  ) {}

  /** What seals the snapshots of the room `code` for its crew; null without a key. */
  private sealerFor(code: string): Sealer | null {
    const key = this.sealKey;
    return key === null ? null : (snapshot) => seal(snapshot, code, key);
  }

  /**
   * A new room for `mission`, already scaled to `difficulty`, which it opens on. Where seeds
   * are allowed, `seed` pins its runs (run n plays seed + n); elsewhere the room rolls every
   * run anew, and the log says the seed went unused.
   */
  create(mission: Mission, seed: number | null = null, difficulty: Difficulty = 'normal'): Room {
    const code = this.freshCode();
    const pinned = this.allowSeed ? seed : null;
    if (seed !== null && pinned === null) {
      console.warn(
        `[escapelab] room ${code}: seed ${seed} ignored — rooms take a seed only with ALLOW_SEED=1`,
      );
    } else if (pinned !== null) {
      console.log(`[escapelab] room ${code}: pinned to seed ${pinned}, run n plays seed + n`);
    }
    const room = new Room(
      code,
      mission,
      this.onRunFinished,
      pinned,
      difficulty,
      this.dailySalt,
      this.sealerFor(code),
    );
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room {
    const room = this.rooms.get(code.toUpperCase());
    if (room === undefined) {
      throw new Error(`Raum "${code.toUpperCase()}" existiert nicht (mehr).`);
    }
    return room;
  }

  /**
   * Rooms worth showing in the lobby browser: ones somebody is actually
   * sitting in, open lobbies first, then the runs you could watch.
   */
  list(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((room) => room.occupied)
      .map((room) => room.summary())
      .sort((a, b) => {
        const openness = Number(b.free > 0) - Number(a.free > 0);
        return openness !== 0 ? openness : a.code.localeCompare(b.code);
      });
  }

  /** The rooms by count (`RoomCounts`): how many, the runs on and paused, who is on the line. */
  counts(): RoomCounts {
    const counts: RoomCounts = { total: 0, running: 0, paused: 0, players: 0, spectators: 0 };
    for (const room of this.rooms.values()) {
      counts.total += 1;
      counts.running += Number(room.phase === 'playing');
      counts.paused += Number(room.phase === 'playing' && room.paused);
      counts.players += room.playersOnTheLine;
      counts.spectators += room.watching;
    }
    return counts;
  }

  /**
   * Where `pass` sits, as its join screen shows it: in a run on — live or paused — before
   * anything else, else in a lobby; null for neither.
   */
  whereIs(pass: CrewPass): Seat | null {
    let lobby: Seat | null = null;
    for (const room of this.rooms.values()) {
      const seat = room.seatSummary(pass);
      if (seat?.phase === 'playing') {
        return seat;
      }
      lobby ??= seat;
    }
    return lobby;
  }

  /**
   * Whether `pass` may sit down in another room than its own (`staying`, the room it sits down
   * in where it exists already): a run on elsewhere binds it, so that is refused, naming the
   * run.
   */
  checkWay(pass: CrewPass, staying: Room | null): void {
    const bound = this.elsewhere(pass, staying).find((room) => room.phase === 'playing');
    if (bound !== undefined) {
      throw new GameError(
        `Gebunden an den Einsatz „${bound.missionTitle}“ in Raum ${bound.code}.`,
      );
    }
  }

  /**
   * `pass` sat down in `staying`: a seat it holds in a lobby or after a run elsewhere it gives
   * up — only now, so that a join refused keeps the seat it had.
   */
  leaveOthers(pass: CrewPass, staying: Room): void {
    for (const room of this.elsewhere(pass, staying)) {
      room.abandon(pass);
    }
  }

  /** The rooms but `staying` where `pass` holds a seat. */
  private elsewhere(pass: CrewPass, staying: Room | null): Room[] {
    return [...this.rooms.values()].filter(
      (room) => room !== staying && room.seatOf(pass) !== null,
    );
  }

  /**
   * The server goes down for a restart at `now` (shutdown.ts): every room stands its run still
   * and tells every seat on the line its last snapshot (`Room.goDown`); the log says so of each.
   */
  shutDown(now: number): void {
    for (const room of this.rooms.values()) {
      const told = room.goDown(now);
      const what =
        told === null
          ? 'no snapshot to send'
          : `snapshot seq ${told.seq} sent to ${told.seats} seat${told.seats === 1 ? '' : 's'}`;
      console.log(`[escapelab] room ${room.code}: going down for a restart, ${what}`);
    }
  }

  /** Drop rooms that have been empty for a while; call periodically. */
  sweep(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }

  private freshCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new Error('Keine freien Raumcodes — Server ist voll.');
  }
}
