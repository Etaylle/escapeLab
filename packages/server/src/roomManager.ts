import type { Mission, RoomSummary } from '@escapelab/core';
import { Room, type RunListener } from './room.js';

/** Room codes avoid ambiguous characters (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

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
   * `allowSeed` (`seedsAllowed`) lets a new room be pinned to a seed.
   */
  constructor(
    private readonly onRunFinished: RunListener = () => undefined,
    private readonly allowSeed = false,
  ) {}

  /**
   * A new room for `mission`. Where seeds are allowed, `seed` pins its runs
   * (run n plays seed + n); elsewhere the room rolls every run anew, and the
   * log says the seed went unused.
   */
  create(mission: Mission, seed: number | null = null): Room {
    const code = this.freshCode();
    const pinned = this.allowSeed ? seed : null;
    if (seed !== null && pinned === null) {
      console.warn(
        `[escapelab] room ${code}: seed ${seed} ignored — rooms take a seed only with ALLOW_SEED=1`,
      );
    } else if (pinned !== null) {
      console.log(`[escapelab] room ${code}: pinned to seed ${pinned}, run n plays seed + n`);
    }
    const room = new Room(code, mission, this.onRunFinished, pinned);
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
