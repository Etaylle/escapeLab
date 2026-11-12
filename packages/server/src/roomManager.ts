import { randomUUID } from 'node:crypto';
import {
  GameError,
  SNAPSHOT_MAX_AGE_MS,
  viewFor,
  viewForSpectator,
  type CrewPass,
  type Difficulty,
  type Mission,
  type RoomSnapshot,
  type RoomSummary,
  type SealedSnapshot,
  type Seat,
} from '@escapelab/core';
import { Room, type RunListener, type Sealer } from './room.js';
import { open, seal } from './seal.js';

/** Room codes avoid ambiguous characters (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

/** What a resume is told whose snapshot no room can be taken up again from. */
const NOT_RESTORABLE = 'Der Spielstand dieses Raums lässt sich nicht wiederherstellen.';

/** What a resume is told whose snapshot is of an older room of a code another room has now. */
const codeTaken = (code: string): string =>
  `Der Raumcode ${code} gehört inzwischen einem anderen Raum.`;

/** What a resume is told whose snapshot is of a room whose run was over when it was closed. */
const RUN_ENDED = 'Dieser Einsatz ist beendet.';

/** What a resume is told whose snapshot is of a room closed for standing empty (`sweep`). */
const ROOM_CLOSED =
  `Der Raum stand ${EMPTY_ROOM_TTL_MS / 60_000} Minuten leer und wurde geschlossen.`;

/**
 * A room the server closed for standing empty (`sweep`): when, and whether its run was over by
 * then. Its snapshots are refused for as long as one of them could be taken up at all,
 * SNAPSHOT_MAX_AGE_MS: a page that kept one brings back no ghost of the room.
 */
interface Closed {
  at: number;
  over: boolean;
}

/** The key a closed room goes by: its code and when it was opened, as its snapshots name it. */
const closedKey = (code: string, createdAt: number): string => `${code}@${createdAt}`;

/**
 * How long a room this instance does not know waits for its newest snapshot, from the first
 * resume that hands in one that may be behind (`mayBeBehind`), before it is taken up again from
 * the newest it has, ms (`roomFor`). Render switches the traffic to a new instance once it is
 * healthy and keeps the old one up 60 s longer, its sockets with it, before it sends it SIGTERM:
 * whoever's line drops in that minute comes back to the new instance after the switch, with an
 * older snapshot than the run the crew still plays on the old one, whose last snapshots
 * (`final`) come with the SIGTERM some 61 s after the switch at the latest — within the wait,
 * however long the new instance has been up. After a crash none ever comes: the room is back
 * this long after the first of its crew came back.
 */
export const HANDOVER_MS = 90_000;

/** A room this instance waits to take up again (`park`): its newest snapshot so far, who waits. */
interface Parked {
  newest: SealedSnapshot;
  /** epoch ms the room began to wait */
  since: number;
  /** takes the room up again from the newest HANDOVER_MS after it began to wait */
  timer: NodeJS.Timeout;
  /** what each socket waiting for the room does once it is back (`awaitRoom`) */
  waiting: Set<() => void>;
}

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
  /** the rooms this instance waits to take up again, by code (`HANDOVER_MS`) */
  private readonly parked = new Map<string, Parked>();
  /** the rooms this instance closed for standing empty, by `closedKey` (`sweep`) */
  private readonly closed = new Map<string, Closed>();

  /**
   * `onRunFinished` hears of every run that ends in any of these rooms;
   * `allowSeed` (`seedsAllowed`) lets a new room be pinned to a seed;
   * `dailySalt` (dailySalt.ts) makes the Tagesschicht's seeds in every room;
   * `sealKey` (seal.ts `roomKey`) seals the snapshots every room sends its crew — none without;
   * `instanceId` is the server instance the rooms live on, one id per boot (index.ts), as
   * `joined`, every `tick` and every snapshot sealed name it.
   */
  constructor(
    private readonly onRunFinished: RunListener = () => undefined,
    private readonly allowSeed = false,
    private readonly dailySalt: string | null = null,
    private readonly sealKey: Buffer | null = null,
    readonly instanceId: string = randomUUID(),
  ) {}

  /**
   * What seals the snapshots of the room `code` for its crew, each naming this instance; null
   * without a key.
   */
  private sealerFor(code: string): Sealer | null {
    const key = this.sealKey;
    const instance = this.instanceId;
    return key === null
      ? null
      : (snapshot, final) => seal({ ...snapshot, instance, final }, code, key);
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

  /**
   * The room a resume into `code` on `pass` comes back to, carrying the snapshot `blob` where its
   * page keeps one: the room the server has — a newer snapshot replacing the game of one taken
   * up again a moment ago (`Room.replaceFrom`) — or else the room the snapshot takes up again
   * (`takeUp`); null while this instance waits for a newer snapshot of it first (`awaitRoom`).
   * Throws for a code no room has and no snapshot brings back, for a snapshot that is refused,
   * and for a code another room has taken meanwhile.
   */
  roomFor(code: string, pass: CrewPass, blob: string | undefined, now = Date.now()): Room | null {
    const room = this.rooms.get(code.toUpperCase());
    const key = this.sealKey;
    if (blob === undefined || key === null) {
      return this.waitsFor(code) ? null : this.get(code);
    }
    if (room === undefined) {
      return this.takeUp(this.restorable(code, blob, key, now), now);
    }
    // The blob is opened only where it may matter: the room was taken up again from a snapshot,
    // which a newer one may still replace, or have come too late for; or the pass sits nowhere in
    // it — the room's code may have gone to another room meanwhile.
    if (room.takenUpFrom !== null || room.seatOf(pass) === null) {
      this.offer(room, blob, key, now);
    }
    return room;
  }

  /**
   * `blob` handed to `room`, which the server has: a newer snapshot of it replaces its game while
   * it still takes one, and one that comes later is left be, the log saying so with both seqs —
   * the race lost; one of another room of its code means the code went to that one meanwhile —
   * refused. A blob that does not open changes nothing, the log saying why.
   */
  private offer(room: Room, blob: string, key: Buffer, now: number): void {
    let snapshot: RoomSnapshot;
    try {
      snapshot = open(blob, room.code, key);
    } catch (err) {
      const why = String(err);
      console.log(`[escapelab] room ${room.code}: a snapshot handed in was left be, ${why}`);
      return;
    }
    const { code, takenUpFrom } = room;
    if (snapshot.createdAt !== room.createdAt) {
      console.log(`[escapelab] room ${code}: a snapshot of an older room of its code refused`);
      throw new GameError(codeTaken(code));
    }
    if (room.replaceFrom(snapshot, now)) {
      console.log(`[escapelab] room ${code}: taken up again from snapshot seq ${snapshot.seq}`);
    } else if (takenUpFrom !== null && snapshot.seq > takenUpFrom) {
      console.log(
        `[escapelab] room ${code}: snapshot seq ${snapshot.seq} came too late, the room goes ` +
          `on from seq ${takenUpFrom}`,
      );
    }
  }

  /**
   * The room `snapshot` keeps, of a code this instance has no room of: taken up again at once
   * (`restore`) — unless it may be older than the run the instance that sealed it still has
   * (`mayBeBehind`): then the room waits (`park`) until that instance's last snapshot of it
   * comes, HANDOVER_MS from the moment it began to at the most, and is taken up from the newest
   * snapshot handed in meanwhile (`handOver`). Null while it waits; a snapshot of another room of
   * the code than the one it waits for is refused.
   */
  private takeUp(snapshot: SealedSnapshot, now: number): Room | null {
    const { code } = snapshot;
    const parked = this.parked.get(code);
    if (parked === undefined && this.mayBeBehind(snapshot)) {
      this.park(snapshot, now);
      return null;
    }
    if (parked === undefined) {
      return this.restore(snapshot, now);
    }
    if (snapshot.createdAt !== parked.newest.createdAt) {
      console.log(`[escapelab] room ${code}: a snapshot of another room of its code refused`);
      throw new GameError(codeTaken(code));
    }
    if (snapshot.seq > parked.newest.seq) {
      parked.newest = snapshot;
    }
    return this.mayBeBehind(snapshot) ? null : this.handOver(parked, now);
  }

  /**
   * Whether `snapshot` may be older than the run the instance that sealed it still has: not that
   * instance's last (`final`), sealed as it went down. It is another instance's: of a room this
   * one had and closed, it would be refused (`closedFor`).
   */
  private mayBeBehind(snapshot: SealedSnapshot): boolean {
    return !snapshot.final;
  }

  /**
   * The room `snapshot` keeps waits, from `now`, for a newer snapshot of it (`takeUp`):
   * HANDOVER_MS later it is taken up again from the newest handed in, at the latest.
   */
  private park(snapshot: SealedSnapshot, now: number): void {
    const parked: Parked = {
      newest: snapshot,
      since: now,
      timer: setTimeout(() => this.handOverLate(parked), HANDOVER_MS),
      waiting: new Set(),
    };
    parked.timer.unref();
    this.parked.set(snapshot.code, parked);
    console.log(
      `[escapelab] room ${snapshot.code}: snapshot seq ${snapshot.seq} is not the last of ` +
        `instance ${snapshot.instance}, waiting up to ${(HANDOVER_MS / 1000).toFixed(1)} s ` +
        'for a newer one',
    );
  }

  /**
   * The room `parked` holds, taken up again at `now` from the newest snapshot handed in for it
   * (`restore`), and every socket that waited for it told (`awaitRoom`) — even where it cannot be
   * taken up, so that none waits on for nothing.
   */
  private handOver(parked: Parked, now: number): Room {
    this.parked.delete(parked.newest.code);
    clearTimeout(parked.timer);
    try {
      return this.restore(parked.newest, now, now - parked.since);
    } finally {
      parked.waiting.forEach((back) => back());
    }
  }

  /** The room `parked` holds, taken up again HANDOVER_MS after it began to wait (`park`). */
  private handOverLate(parked: Parked): void {
    try {
      this.handOver(parked, Date.now());
    } catch (err) {
      console.error(`[escapelab] room ${parked.newest.code}: not taken up again, ${String(err)}`);
    }
  }

  /** Whether this instance waits to take the room `code` up again (`roomFor`). */
  waitsFor(code: string): boolean {
    return this.parked.has(code.toUpperCase());
  }

  /**
   * `back` runs once the room `code`, which this instance waits to take up again (`waitsFor`), is
   * back, or could not be taken up. Returns how to stop waiting. Throws for a room not waited for.
   */
  awaitRoom(code: string, back: () => void): () => void {
    const parked = this.parked.get(code.toUpperCase());
    if (parked === undefined) {
      throw new Error(`room ${code.toUpperCase()} is not waited for`);
    }
    parked.waiting.add(back);
    return () => parked.waiting.delete(back);
  }

  /**
   * The room `snapshot` keeps, taken up again at `now` (`Room.restore`) under its code: the log
   * says so, from which snapshot, with how many seats and how old it was — and, for a room that
   * waited for it (`park`), how long.
   */
  private restore(snapshot: RoomSnapshot, now: number, waited: number | null = null): Room {
    const room = Room.restore(snapshot, now, {
      onRunFinished: this.onRunFinished,
      dailySalt: this.dailySalt,
      sealer: this.sealerFor(snapshot.code),
    });
    this.rooms.set(snapshot.code, room);
    const age = ((now - snapshot.at) / 1000).toFixed(1);
    const seats = `${snapshot.seats.length} seat${snapshot.seats.length === 1 ? '' : 's'}`;
    const after = waited === null ? '' : `, after ${(waited / 1000).toFixed(1)} s of waiting`;
    console.log(
      `[escapelab] restored room ${snapshot.code} from snapshot seq ${snapshot.seq} ` +
        `(${seats}, ${age} s old${after})`,
    );
    return room;
  }

  /**
   * The snapshot `blob` keeps of the room `code`, fit to be taken up again at `now`: its seal
   * verified under `key` and its content this build's, of that very room — not one this instance
   * closed (`closedFor`) — no older than SNAPSHOT_MAX_AGE_MS, of no ended run, and its game
   * showing every seat a view. Refused in one line otherwise, the log saying why.
   */
  private restorable(code: string, blob: string, key: Buffer, now: number): SealedSnapshot {
    const refuse = (why: string, message = NOT_RESTORABLE): never => {
      console.log(`[escapelab] room ${code.toUpperCase()}: not taken up again, ${why}`);
      throw new GameError(message);
    };
    let snapshot: SealedSnapshot | null = null;
    try {
      snapshot = open(blob, code, key);
    } catch (err) {
      return refuse(String(err));
    }
    const { state } = snapshot;
    if (snapshot.code !== code.toUpperCase()) {
      return refuse(`its snapshot is of room ${snapshot.code}`);
    }
    const closed = this.closedFor(snapshot);
    if (closed !== null) {
      return refuse(closed.why, closed.message);
    }
    if (now - snapshot.at > SNAPSHOT_MAX_AGE_MS) {
      return refuse('its snapshot is over a day old', 'Der Spielstand ist älter als einen Tag.');
    }
    if (state.phase === 'won' || state.phase === 'lost') {
      return refuse('its run is over', 'Dieser Einsatz ist schon vorbei.');
    }
    try {
      viewForSpectator(state);
      state.players.forEach((player) => viewFor(state, player.id));
    } catch (err) {
      return refuse(`its game shows no views: ${String(err)}`);
    }
    return snapshot;
  }

  /**
   * Why `snapshot` is of a room this instance closed (`sweep`), for the log and for its resume —
   * the run over by then, or not; null for one of a room it never closed.
   */
  private closedFor(snapshot: RoomSnapshot): { why: string; message: string } | null {
    const closed = this.closed.get(closedKey(snapshot.code, snapshot.createdAt));
    if (closed === undefined) {
      return null;
    }
    return closed.over
      ? { why: 'its run was over when its room was closed', message: RUN_ENDED }
      : { why: 'its room was closed, standing empty', message: ROOM_CLOSED };
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
   * anything else, else in a lobby; null for neither. Only a room that binds the pass counts
   * (`Room.binds`): one taken up again that the pass has not come back to does not.
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

  /**
   * The rooms but `staying` that bind `pass` (`Room.binds`): one taken up again that the pass
   * has not come back to neither keeps it from another room nor loses its seat to one.
   */
  private elsewhere(pass: CrewPass, staying: Room | null): Room[] {
    return [...this.rooms.values()].filter((room) => room !== staying && room.binds(pass));
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

  /**
   * Closes the rooms that have stood empty for EMPTY_ROOM_TTL_MS at `now`, each leaving a
   * tombstone that refuses its snapshots from then on (`closedFor`), and lets go of the
   * tombstones SNAPSHOT_MAX_AGE_MS old; call periodically.
   */
  sweep(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
        room.dispose();
        this.rooms.delete(code);
        const over = room.phase === 'won' || room.phase === 'lost';
        this.closed.set(closedKey(code, room.createdAt), { at: now, over });
      }
    }
    for (const [key, closed] of this.closed) {
      if (now - closed.at > SNAPSHOT_MAX_AGE_MS) {
        this.closed.delete(key);
      }
    }
  }

  private freshCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code) && !this.parked.has(code)) {
        return code;
      }
    }
    throw new Error('Keine freien Raumcodes — Server ist voll.');
  }
}
