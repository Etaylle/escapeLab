import type { Mission, RoomSummary } from '@escapelab/core';
import { Room } from './room.js';

/** Room codes avoid ambiguous characters (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  create(mission: Mission): Room {
    const code = this.freshCode();
    const room = new Room(code, mission);
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
