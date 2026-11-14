import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseMission,
  sealedSnapshotSchema,
  type ClientMessage,
  type Mission,
  type ServerMessage,
} from '@escapelab/core';
import { AccountDesk } from '../src/accounts.js';
import { SignInGuard } from '../src/login.js';
import { Room, SEAT_ELSEWHERE, SIGNED_OUT } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';
import { roomKey } from '../src/seal.js';
import { SeatBook } from '../src/seats.js';
import { serveSockets } from '../src/sockets.js';
import { JsonlStore } from '../src/store/jsonl.js';
import { recordRuns, type Store } from '../src/store/store.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';
import { identityOf } from './storeContract.js';

/**
 * The seat follows the account (docs/gameplay.md, „Verbindung und Wiedereintritt"): a seat taken
 * by a pass with an account is bound to the account as well, any device signed into it takes the
 * seat back without the crew's yes, and the room's snapshot carries the binding.
 */

/** The tutorial, for two. */
const mission: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);
const catalog = { get: () => mission, default: mission };

const KENNWORT = 'Kaltenbrunn 1986';
const KEY = roomKey({ ROOM_SECRET: 'f00d'.repeat(16) }).key;

/** A server over `store`: its sockets, its rooms — sealed under KEY, as instance `instance`. */
function serverOn(store: Store, instance = 'eins') {
  const server = new FakeServer();
  const manager = new RoomManager(recordRuns(store).record, false, null, KEY, instance);
  const accounts = new AccountDesk(store);
  serveSockets(server, { catalog, manager, accounts, signIns: new SignInGuard() });
  return { server, manager };
}

/** A store of its own: the run log in a folder of its own, the accounts in memory. */
const freshStore = (): JsonlStore =>
  JsonlStore.open(join(mkdtempSync(join(tmpdir(), 'escapelab-seat-')), 'runs.jsonl'));

/** Lets the account work under way come to an end: the stores answer in promises. */
const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** `socket` says `msg`, and the first message of `kind` it hears after, waited for. */
async function heardAfter<K extends ServerMessage['kind']>(
  socket: FakeSocket,
  msg: ClientMessage,
  kind: K,
): Promise<Extract<ServerMessage, { kind: K }>> {
  const before = socket.heard.length;
  socket.say(msg);
  const found = (): ServerMessage | undefined =>
    socket.heard.slice(before).find((m) => m.kind === kind);
  await vi.waitFor(() => expect(found()).toBeDefined(), { timeout: 10_000, interval: 5 });
  return found() as Extract<ServerMessage, { kind: K }>;
}

/** The refusal `socket` heard of `of` last; null for none. */
const refusalOf = (socket: FakeSocket, of: ClientMessage['kind']): string | null => {
  const last = socket.heard.filter((m) => m.kind === 'error' && m.of === of).at(-1);
  return last?.kind === 'error' ? last.message : null;
};

/**
 * Anna, her Kennwort set, and Ben in a run of the tutorial on `server`, each on a socket of their
 * own: Anna's Ausweisnummer and her seat.
 */
async function runOfTwo(server: FakeServer) {
  const anna = server.connect();
  anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna') });
  const { code } = joinedOf(anna);
  const set = await heardAfter(
    anna,
    { kind: 'set-password', pass: passFor('Anna'), password: KENNWORT },
    'login',
  );
  const ben = server.connect();
  ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben') });
  await settled();
  ben.say({ kind: 'set-ready', ready: true });
  anna.say({ kind: 'start-mission' });
  expect(anna.view.phase).toBe('playing');
  return { anna, ben, code, number: set.account?.login ?? '', seat: anna.view.you.id };
}

/** A device signed into the account of `number` on its pass of `name`'s: its socket. */
async function signedIn(server: FakeServer, name: string, number: string): Promise<FakeSocket> {
  const device = server.connect();
  const signIn: ClientMessage = {
    kind: 'sign-in',
    pass: passFor(name),
    login: number,
    password: KENNWORT,
  };
  const answer = await heardAfter(device, signIn, 'login');
  expect(answer.done).toBe('signed-in');
  return device;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a seat bound to the account', () => {
  it('binds a seat to the account of the pass that sat down; its snapshot carries it', async () => {
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const anna = server.connect();
    anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna') });
    await settled();
    const room = manager.get(joinedOf(anna).code);
    const annas = (await store.findByIdentity(identityOf('Anna')))?.id;
    const snapshot = room.snapshot();
    expect(snapshot.seats.map((seat) => [seat.name, seat.accountId])).toEqual([['Anna', annas]]);
    // Sealed and opened as a server taking the room up again reads it, and taken up again.
    const sealed = JSON.parse(JSON.stringify({ ...snapshot, instance: 'eins', final: true }));
    expect(sealedSnapshotSchema.parse(sealed).seats[0]?.accountId).toBe(annas);
    const restored = Room.restore(snapshot, Date.now());
    expect(restored.snapshot().seats[0]?.accountId).toBe(annas);
    room.dispose();
    restored.dispose();
  });

  it('takes the seat back on another device of the account, without the crew’s yes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, ben, code, number, seat } = await runOfTwo(server);
    anna.close(1006);
    expect(ben.view.players.find((p) => p.name === 'Anna')?.connected).toBe(false);
    // Anna's phone signs in, and its menu shows the run of her account.
    const phone = await signedIn(server, 'Phone', number);
    const seated = await heardAfter(phone, { kind: 'whereami', pass: passFor('Phone') }, 'seated');
    await vi.waitFor(() => expect(phone.heard.filter((m) => m.kind === 'seated')).toHaveLength(2));
    expect(phone.heard.filter((m) => m.kind === 'seated').map((m) => m.seat?.code)).toEqual([
      seated.seat?.code,
      code,
    ]);
    // Back to the run from the phone: Anna's seat, at once, nobody asked.
    const back: ClientMessage = { kind: 'resume', code, pass: passFor('Phone') };
    const joined = await heardAfter(phone, back, 'joined');
    expect(joined.code).toBe(code);
    expect(phone.view.you.id).toBe(seat);
    expect(ben.view.players.find((p) => p.name === 'Anna')?.connected).toBe(true);
    expect([...phone.heard, ...ben.heard].some((m) => m.kind === 'takeover-pending')).toBe(false);
    // Her laptop, back meanwhile, finds the seat playing on the phone.
    const laptop = server.connect();
    laptop.say({ kind: 'resume', code, pass: passFor('Anna') });
    await vi.waitFor(() => expect(refusalOf(laptop, 'resume')).toBe(SEAT_ELSEWHERE));
    expect(phone.view.you.id).toBe(seat);
    // The run, given up by Ben, counts for Anna's account by the phone's pass.
    ben.say({ kind: 'abandon', code, pass: passFor('Ben') });
    await vi.waitFor(async () => {
      const annas = (await store.findByIdentity(identityOf('Anna')))?.id ?? '';
      expect((await store.runsOfAccount(annas, 5)).runs.map((run) => run.seat)).toEqual([0]);
    });
    manager.get(code).dispose();
  });

  it('leaves the seat to the crew’s yes for a guest, and a pass of another account', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, code } = await runOfTwo(server);
    anna.close(1006);
    const guest = server.connect();
    guest.say({ kind: 'whereami', pass: passFor('Cleo') });
    await settled();
    guest.say({ kind: 'resume', code, pass: passFor('Cleo') });
    // Dan's account, with a Kennwort of its own, signed in on a phone.
    const dan = server.connect();
    await heardAfter(
      dan,
      { kind: 'set-password', pass: passFor('Dan'), password: KENNWORT },
      'login',
    );
    const number = dan.heard.find((m) => m.kind === 'login')?.account?.login ?? '';
    const phone = await signedIn(server, 'Phone', number);
    phone.say({ kind: 'resume', code, pass: passFor('Phone') });
    const nowhere = 'Wiederverbinden fehlgeschlagen — Raum neu beitreten.';
    await vi.waitFor(() => {
      expect([refusalOf(guest, 'resume'), refusalOf(phone, 'resume')]).toEqual([nowhere, nowhere]);
    });
    // Anna's name asks the crew as ever.
    guest.say({ kind: 'join-room', code, name: 'Anna', pass: passFor('Cleo') });
    expect(guest.heard.at(-1)).toMatchObject({ kind: 'takeover-pending', name: 'Anna' });
    manager.get(code).dispose();
  });

  it('shows the account’s run on a device signed into it, and nothing to a guest', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { code, number } = await runOfTwo(server);
    const phone = await signedIn(server, 'Phone', number);
    phone.say({ kind: 'whereami', pass: passFor('Phone') });
    const guest = server.connect();
    guest.say({ kind: 'whereami', pass: passFor('Cleo') });
    await vi.waitFor(() => expect(phone.heard.filter((m) => m.kind === 'seated')).toHaveLength(2));
    const seats = (socket: FakeSocket) =>
      socket.heard.flatMap((m) => (m.kind === 'seated' ? [m.seat?.code ?? null] : []));
    expect(seats(phone)).toEqual([null, code]);
    await settled();
    expect(seats(guest)).toEqual([null]);
    manager.get(code).dispose();
  });

  it('shows no lobby of the account’s on another device: only a run on binds it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const anna = server.connect();
    anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna') });
    const { code } = joinedOf(anna);
    const set = await heardAfter(
      anna,
      { kind: 'set-password', pass: passFor('Anna'), password: KENNWORT },
      'login',
    );
    const phone = await signedIn(server, 'Phone', set.account?.login ?? '');
    phone.say({ kind: 'whereami', pass: passFor('Phone') });
    await vi.waitFor(() => expect(phone.heard.some((m) => m.kind === 'account')).toBe(true));
    const seated = phone.heard.filter((m) => m.kind === 'seated');
    expect(seated).toEqual([{ kind: 'seated', seat: null }]);
    manager.get(code).dispose();
  });

  it('binds a lobby seat to the account its pass signs into', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const cleo = server.connect();
    const set = await heardAfter(
      cleo,
      { kind: 'set-password', pass: passFor('Cleo'), password: KENNWORT },
      'login',
    );
    const ben = server.connect();
    ben.say({ kind: 'create-room', name: 'Ben', pass: passFor('Ben') });
    const { code } = joinedOf(ben);
    await settled();
    const login = set.account?.login ?? '';
    const pass = passFor('Ben');
    await heardAfter(ben, { kind: 'sign-in', pass, login, password: KENNWORT }, 'login');
    const cleos = (await store.findByIdentity(identityOf('Cleo')))?.id;
    expect(manager.get(code).snapshot().seats.map((seat) => seat.accountId)).toEqual([cleos]);
    manager.get(code).dispose();
  });
});

describe('a seat bound to the account, its pass signed out', () => {
  /** Anna's account's runs, by her seat in each. */
  async function annasSeats(store: Store): Promise<number[]> {
    const annas = (await store.findByIdentity(identityOf('Anna')).catch(() => null))?.id;
    const phones = (await store.findByIdentity(identityOf('Phone')).catch(() => null))?.id;
    const id = annas ?? phones ?? '';
    return (await store.runsOfAccount(id, 5)).runs.map((run) => run.seat);
  }

  it('drops the line of a run signed out of: the seat waits for the account', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, ben, code, number, seat } = await runOfTwo(server);
    const out = await heardAfter(anna, { kind: 'sign-out', pass: passFor('Anna') }, 'login');
    expect(out).toEqual({ kind: 'login', done: 'signed-out', account: null });
    expect(anna.heard).toContainEqual({ kind: 'left', code, message: SIGNED_OUT });
    expect(ben.view.players.find((p) => p.name === 'Anna')?.connected).toBe(false);
    // The pass signed out gets nothing back — not the seat, not a card of it.
    const copy = server.connect();
    copy.say({ kind: 'resume', code, pass: passFor('Anna') });
    copy.say({ kind: 'whereami', pass: passFor('Anna') });
    const nowhere = 'Wiederverbinden fehlgeschlagen — Raum neu beitreten.';
    await vi.waitFor(() => expect(refusalOf(copy, 'resume')).toBe(nowhere));
    expect(copy.heard.find((m) => m.kind === 'seated')).toEqual({ kind: 'seated', seat: null });
    // A device signed into the account takes it back, and the run counts for the account.
    const phone = await signedIn(server, 'Phone', number);
    await heardAfter(phone, { kind: 'resume', code, pass: passFor('Phone') }, 'joined');
    expect(phone.view.you.id).toBe(seat);
    ben.say({ kind: 'abandon', code, pass: passFor('Ben') });
    await vi.waitFor(async () => expect(await annasSeats(store)).toEqual([0]));
    manager.get(code).dispose();
  });

  it('counts a run that ends while its seat waits for the account', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, ben, code, number } = await runOfTwo(server);
    await heardAfter(anna, { kind: 'sign-out', pass: passFor('Anna') }, 'login');
    ben.say({ kind: 'abandon', code, pass: passFor('Ben') });
    // Anna's account, found again by its Ausweisnummer, has the run.
    await signedIn(server, 'Phone', number);
    await vi.waitFor(async () => expect(await annasSeats(store)).toEqual([0]));
    manager.get(code).dispose();
  });

  it('leaves the old account its seat as a device switches away mid-run', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, code, number, seat } = await runOfTwo(server);
    const dan = server.connect();
    const set = await heardAfter(
      dan,
      { kind: 'set-password', pass: passFor('Dan'), password: KENNWORT },
      'login',
    );
    const switched = await heardAfter(
      anna,
      {
        kind: 'switch-account',
        pass: passFor('Anna'),
        next: passFor('Eva'),
        login: set.account?.login ?? '',
        password: KENNWORT,
      },
      'login',
    );
    expect(switched.done).toBe('switched');
    expect(anna.heard).toContainEqual({ kind: 'left', code, message: SIGNED_OUT });
    // Dan's account sits nowhere; Anna's seat waits for a device of hers.
    const eva = server.connect();
    eva.say({ kind: 'whereami', pass: passFor('Eva') });
    await vi.waitFor(() => expect(eva.heard.some((m) => m.kind === 'account')).toBe(true));
    expect(eva.heard.filter((m) => m.kind === 'seated')).toEqual([{ kind: 'seated', seat: null }]);
    const phone = await signedIn(server, 'Phone', number);
    await heardAfter(phone, { kind: 'resume', code, pass: passFor('Phone') }, 'joined');
    expect(phone.view.you.id).toBe(seat);
    manager.get(code).dispose();
  });
});

describe('a seat bound to the account, over a restart', () => {
  it('goes back to a device of the account from the room taken up again', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const before = serverOn(store, 'eins');
    const { anna, ben, code, number, seat } = await runOfTwo(before.server);
    // The server goes down: every seat on the line hands over the room's last snapshot.
    before.manager.shutDown(Date.now());
    const last = ben.heard.filter((m) => m.kind === 'restart').at(-1);
    if (last?.kind !== 'restart') {
      throw new Error('Ben heard no last snapshot');
    }
    anna.close(1012);
    ben.close(1012);
    before.manager.get(code).dispose();
    // The new instance takes the room up again from Ben's; Anna's phone comes back to her seat.
    const after = serverOn(store, 'zwei');
    const benBack = after.server.connect();
    const resume: ClientMessage = { kind: 'resume', code, pass: passFor('Ben'), blob: last.blob };
    await heardAfter(benBack, resume, 'joined');
    const phone = await signedIn(after.server, 'Phone', number);
    await heardAfter(phone, { kind: 'resume', code, pass: passFor('Phone') }, 'joined');
    expect(phone.view.you.id).toBe(seat);
    after.manager.get(code).dispose();
  });
});

describe('the seat book', () => {
  it('binds a seat to an account, and takes it back on another pass of it, keeping it', () => {
    const book = new SeatBook();
    book.bind('p-anna', passFor('Anna'));
    // The account comes for the pass that holds the seat, not for one shown with another secret.
    book.bindAccount({ ...passFor('Anna'), secret: passFor('Mallory').secret }, 'mallorys');
    expect(book.seatOfAccount('mallorys')).toBeNull();
    book.bindAccount(passFor('Anna'), 'annas');
    expect([book.seatOfAccount('annas'), book.holdsAccounts]).toEqual(['p-anna', true]);
    book.takeBack('p-anna', passFor('Phone'));
    expect(book.seatOf(passFor('Phone'))).toBe('p-anna');
    expect(book.seatOfAccount('annas')).toBe('p-anna');
    expect([book.seatOf(passFor('Anna')), book.lostSeat(passFor('Anna'))]).toEqual([null, true]);
    const phones = { playerId: 'p-anna', passId: passFor('Phone').id, accountId: 'annas' };
    expect(book.snapshot().bound).toEqual([expect.objectContaining(phones)]);
  });
});
