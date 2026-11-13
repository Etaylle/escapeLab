import { createHash, timingSafeEqual } from 'node:crypto';
import { GameError, type CrewPass } from '@escapelab/core';

/** A seat's binding: the id of the pass it belongs to and the hash of that pass's secret. */
interface Binding {
  passId: string;
  hash: Buffer;
}

const hashOf = (secret: string): Buffer => createHash('sha256').update(secret).digest();

/**
 * Whether `pass` shows the secret `binding` was made with: compared in constant time, so the
 * answer's timing tells nothing about the secret.
 */
const sameSecret = (binding: Binding, pass: CrewPass): boolean =>
  timingSafeEqual(binding.hash, hashOf(pass.secret));

/**
 * Which crew pass each seat of a room belongs to, by player id (core protocol.ts `CrewPass`):
 * the pass's id and a hash of its secret — the secret itself is never kept. A pass shown with
 * the wrong secret holds no seat.
 */
export class SeatBook {
  private readonly bindings = new Map<string, Binding>();
  /** the passes whose seat another device took over (`takeOver`), by pass id */
  private readonly lost = new Set<string>();

  /**
   * Throws where `pass` may bind no seat here: its id binds one already, under another secret —
   * a pass made up after another's id, which must not take that seat from it.
   */
  check(pass: CrewPass): void {
    for (const binding of this.bindings.values()) {
      if (binding.passId === pass.id && !sameSecret(binding, pass)) {
        throw new GameError('Dieser Ausweis gilt hier nicht.');
      }
    }
  }

  /**
   * Binds the seat of `playerId` to `pass`, in place of whatever pass held it; a seat the pass
   * held before lets go of it: a pass holds one seat at a time. Refused, before anything is let
   * go of, for a pass whose id binds a seat under another secret (`check`).
   */
  bind(playerId: string, pass: CrewPass): void {
    this.check(pass);
    for (const [seat, binding] of this.bindings) {
      if (binding.passId === pass.id) {
        this.bindings.delete(seat);
      }
    }
    this.lost.delete(pass.id);
    this.bindings.set(playerId, { passId: pass.id, hash: hashOf(pass.secret) });
  }

  /**
   * The seat of `playerId` goes to `pass`, another device's: the pass that held it holds it no
   * more, and it is told so when it comes back (`lostSeat`).
   */
  takeOver(playerId: string, pass: CrewPass): void {
    const before = this.bindings.get(playerId);
    this.bind(playerId, pass);
    if (before !== undefined && before.passId !== pass.id) {
      this.lost.add(before.passId);
    }
  }

  /** Whether another device took over the seat `pass` held here. */
  lostSeat(pass: CrewPass): boolean {
    return this.lost.has(pass.id);
  }

  /** The seat `pass` holds, by player id; null where it holds none or shows the wrong secret. */
  seatOf(pass: CrewPass): string | null {
    for (const [playerId, binding] of this.bindings) {
      if (binding.passId === pass.id) {
        return sameSecret(binding, pass) ? playerId : null;
      }
    }
    return null;
  }

  /** The id of the pass the seat of `playerId` is bound to; null for a seat bound to none. */
  passOf(playerId: string): string | null {
    return this.bindings.get(playerId)?.passId ?? null;
  }

  /** Lets go of the seat of `playerId`: no pass holds it any more. */
  free(playerId: string): void {
    this.bindings.delete(playerId);
  }

  /**
   * Every seat's binding, as a room's snapshot keeps it: the pass's id and the hash of its
   * secret (hex) by player id; and the passes whose seat another device took over.
   */
  snapshot(): { bound: { playerId: string; passId: string; hash: string }[]; lost: string[] } {
    const bound = [...this.bindings].map(([playerId, { passId, hash }]) => ({
      playerId,
      passId,
      hash: hash.toString('hex'),
    }));
    return { bound, lost: [...this.lost] };
  }

  /** The book as a snapshot kept it (`snapshot`), in place of whatever it held. */
  restore(
    bound: readonly { playerId: string; passId: string; hash: string }[],
    lost: readonly string[],
  ): void {
    this.bindings.clear();
    for (const { playerId, passId, hash } of bound) {
      this.bindings.set(playerId, { passId, hash: Buffer.from(hash, 'hex') });
    }
    this.lost.clear();
    for (const passId of lost) {
      this.lost.add(passId);
    }
  }
}
