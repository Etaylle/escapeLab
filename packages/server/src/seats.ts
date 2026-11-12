import { createHash, timingSafeEqual } from 'node:crypto';
import type { CrewPass } from '@escapelab/core';

/** A seat's binding: the id of the pass it belongs to and the hash of that pass's secret. */
interface Binding {
  passId: string;
  hash: Buffer;
}

const hashOf = (secret: string): Buffer => createHash('sha256').update(secret).digest();

/**
 * Which crew pass each seat of a room belongs to, by player id (core protocol.ts `CrewPass`):
 * the pass's id and a hash of its secret — the secret itself is never kept. A pass shown with
 * the wrong secret holds no seat.
 */
export class SeatBook {
  private readonly bindings = new Map<string, Binding>();

  /** Binds the seat of `playerId` to `pass`, in place of whatever pass held it. */
  bind(playerId: string, pass: CrewPass): void {
    this.bindings.set(playerId, { passId: pass.id, hash: hashOf(pass.secret) });
  }

  /** The seat `pass` holds, by player id; null where it holds none or shows the wrong secret. */
  seatOf(pass: CrewPass): string | null {
    for (const [playerId, binding] of this.bindings) {
      if (binding.passId === pass.id) {
        // Compared in constant time, so the answer's timing tells nothing about the secret.
        return timingSafeEqual(binding.hash, hashOf(pass.secret)) ? playerId : null;
      }
    }
    return null;
  }

  /** Lets go of the seat of `playerId`: no pass holds it any more. */
  free(playerId: string): void {
    this.bindings.delete(playerId);
  }
}
