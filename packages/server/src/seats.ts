import { createHash, timingSafeEqual } from 'node:crypto';
import { GameError, type CrewPass } from '@escapelab/core';
import { PARKED, type SeatPass } from './store/store.js';

/**
 * A seat's binding: the id of the pass it belongs to and the hash of that pass's secret — and the
 * account of the pass that sat down on it, once the server knows it (`bindAccount`).
 */
interface Binding {
  passId: string;
  hash: Buffer;
  accountId: string | null;
}

/** A seat's binding as a room's snapshot keeps it (core snapshot.ts `SeatSnapshot`). */
interface BoundSeat {
  playerId: string;
  passId: string;
  hash: string;
  accountId?: string;
}

const hashOf = (secret: string): Buffer => createHash('sha256').update(secret).digest();

/** What a seat parked for its account is bound to in place of a pass's hash (store.ts PARKED). */
const PARKED_HASH = Buffer.from(PARKED, 'hex');

/**
 * Whether `pass` shows the secret `binding` was made with: compared in constant time, so the
 * answer's timing tells nothing about the secret.
 */
const sameSecret = (binding: Binding, pass: CrewPass): boolean =>
  timingSafeEqual(binding.hash, hashOf(pass.secret));

/**
 * Which crew pass each seat of a room belongs to, by player id (core protocol.ts `CrewPass`):
 * the pass's id and a hash of its secret — the secret itself is never kept — and the account
 * that pass led into, which any other pass of the account takes the seat back on (`takeBack`).
 * A pass shown with the wrong secret holds no seat.
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
    this.bindings.set(playerId, { passId: pass.id, hash: hashOf(pass.secret), accountId: null });
  }

  /**
   * The seat `pass` holds is bound to `accountId` from now on, the account the server found for
   * the pass; nothing where it holds none or shows the wrong secret.
   */
  bindAccount(pass: CrewPass, accountId: string): void {
    const playerId = this.seatOf(pass);
    const binding = playerId === null ? undefined : this.bindings.get(playerId);
    if (binding !== undefined) {
      binding.accountId = accountId;
    }
  }

  /** The seats bound to `accountId` but the one of the pass `staying`, by player id. */
  seatsOfAccount(accountId: string, staying: string): string[] {
    return [...this.bindings]
      .filter(([, binding]) => binding.accountId === accountId && binding.passId !== staying)
      .map(([playerId]) => playerId);
  }

  /** The seat bound to `accountId`, by player id; null for none. */
  seatOfAccount(accountId: string): string | null {
    for (const [playerId, binding] of this.bindings) {
      if (binding.accountId === accountId) {
        return playerId;
      }
    }
    return null;
  }

  /** Whether any seat is bound to an account: only then may a pass take one back by its account. */
  get holdsAccounts(): boolean {
    return [...this.bindings.values()].some((binding) => binding.accountId !== null);
  }

  /**
   * The seat of `playerId`, bound to an account, goes to `pass`, another pass of that account: the
   * account stays, and the pass that held it is told, when it comes back, that the seat went to
   * another device (`lostSeat`). Refused, before anything changes, as `bind` refuses.
   */
  takeBack(playerId: string, pass: CrewPass): void {
    const before = this.bindings.get(playerId);
    this.bind(playerId, pass);
    const now = this.bindings.get(playerId);
    if (before !== undefined && now !== undefined) {
      now.accountId = before.accountId;
      if (before.passId !== pass.id) {
        this.lost.add(before.passId);
      }
    }
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

  /**
   * The seat of `playerId`, its pass signed out (rule 4): bound from now on to PARKED, which no
   * secret's hash is, under its pass's id — so that the run credits its account still, whose
   * store keeps the same (store.ts `Leaving`) — and to `accountId`, whose other devices take it
   * back (`takeBack`).
   */
  park(playerId: string, accountId: string): void {
    const binding = this.bindings.get(playerId);
    if (binding !== undefined) {
      this.bindings.set(playerId, { passId: binding.passId, hash: PARKED_HASH, accountId });
    }
  }

  /** Whether another device took over the seat `pass` held here. */
  lostSeat(pass: CrewPass): boolean {
    return this.lost.has(pass.id);
  }

  /**
   * The seat bound to the pass `pass` — its id, and the hash of its secret as a store keeps it —
   * by player id; null for none.
   */
  seatOfPass(pass: SeatPass): string | null {
    const kept = Buffer.from(pass.secretHash, 'hex');
    for (const [playerId, binding] of this.bindings) {
      if (binding.passId === pass.id) {
        return binding.hash.equals(kept) ? playerId : null;
      }
    }
    return null;
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

  /**
   * The pass the seat of `playerId` is bound to: its id and the hash of its secret, hex — the
   * hash an account's identity keeps of it (store.ts `secretHashOf`); null for a seat bound to
   * none.
   */
  passOf(playerId: string): SeatPass | null {
    const binding = this.bindings.get(playerId);
    return binding === undefined
      ? null
      : { id: binding.passId, secretHash: binding.hash.toString('hex') };
  }

  /** Lets go of the seat of `playerId`: no pass holds it any more. */
  free(playerId: string): void {
    this.bindings.delete(playerId);
  }

  /**
   * Every seat's binding, as a room's snapshot keeps it: the pass's id, the hash of its secret
   * (hex) and its account where it has one, by player id; and the passes whose seat another
   * device took over.
   */
  snapshot(): { bound: BoundSeat[]; lost: string[] } {
    const bound = [...this.bindings].map(([playerId, { passId, hash, accountId }]) => ({
      playerId,
      passId,
      hash: hash.toString('hex'),
      ...(accountId === null ? {} : { accountId }),
    }));
    return { bound, lost: [...this.lost] };
  }

  /** The book as a snapshot kept it (`snapshot`), in place of whatever it held. */
  restore(bound: readonly BoundSeat[], lost: readonly string[]): void {
    this.bindings.clear();
    for (const { playerId, passId, hash, accountId } of bound) {
      const binding = { passId, hash: Buffer.from(hash, 'hex'), accountId: accountId ?? null };
      this.bindings.set(playerId, binding);
    }
    this.lost.clear();
    for (const passId of lost) {
      this.lost.add(passId);
    }
  }
}
