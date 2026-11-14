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
import { PARKED, recordRuns, type Store } from '../src/store/store.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';
import { identityOf, seatPassOf } from './storeContract.js';

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

/** Where a store's call waits: `reached` once it is there, till `release` lets it on. */
function waitingCall() {
  let reach = (): void => undefined;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  let release = (): void => undefined;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reach, reached, open, release };
}

/** `store`'s sign-out held till `release`: `before` it writes, or `after`. */
function holdSignOut(store: JsonlStore, when: 'before' | 'after') {
  const signOut = store.signOut.bind(store);
  const call = waitingCall();
  vi.spyOn(store, 'signOut').mockImplementation(async (leaving) => {
    const left = when === 'after' ? await signOut(leaving) : null;
    call.reach();
    await call.open;
    return when === 'after' ? left : signOut(leaving);
  });
  return call;
}

/** `store`'s sign-in held till `release`, once it is written: a switch's. */
function holdSignIn(store: JsonlStore) {
  const signIn = store.signIn.bind(store);
  const call = waitingCall();
  vi.spyOn(store, 'signIn').mockImplementation(async (...args) => {
    const deleted = await signIn(...args);
    call.reach();
    await call.open;
    return deleted;
  });
  return call;
}

/** `store`'s new Kennwort held till `release`, once it is written. */
function holdChange(store: JsonlStore) {
  const replace = store.replaceLoginSecret.bind(store);
  const call = waitingCall();
  vi.spyOn(store, 'replaceLoginSecret').mockImplementation(async (...args) => {
    const signedOut = await replace(...args);
    call.reach();
    await call.open;
    return signedOut;
  });
  return call;
}

/** The runs of the account `accountId` in `store`, by the seat it held in each. */
const seatsOf = async (store: Store, accountId: string): Promise<number[]> =>
  (await store.runsOfAccount(accountId, 5)).runs.map((run) => run.seat);

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

});

describe('a resume while the store looks up its account', () => {
  /**
   * The store holds back what it says of the pass of `name`'s till `answer` is called: `looked`
   * settles once it said it.
   */
  function holdLookup(store: Store, name: string) {
    const find = store.findByIdentity.bind(store);
    let answer = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    let said = (): void => undefined;
    const looked = new Promise<void>((resolve) => {
      said = resolve;
    });
    vi.spyOn(store, 'findByIdentity').mockImplementation((identity) =>
      identity.subject === passFor(name).id
        ? held.then(() => find(identity)).finally(said)
        : find(identity),
    );
    return { answer, looked };
  }

  it('drops the resume of a device that is gone before the store answered', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, ben, code, number, seat } = await runOfTwo(server);
    anna.close(1006);
    const phone = await signedIn(server, 'Phone', number);
    const { answer, looked } = holdLookup(store, 'Phone');
    phone.say({ kind: 'resume', code, pass: passFor('Phone') });
    phone.close(1006);
    answer();
    await looked;
    await settled();
    // Nobody plays on Anna's seat: the crew waits for her, and her laptop comes back to it.
    expect(ben.view.players.find((p) => p.name === 'Anna')?.connected).toBe(false);
    const laptop = server.connect();
    laptop.say({ kind: 'resume', code, pass: passFor('Anna') });
    await vi.waitFor(() => {
      expect(laptop.heard.some((m) => m.kind === 'joined') || refusalOf(laptop, 'resume')).toBe(
        true,
      );
    });
    expect([refusalOf(laptop, 'resume'), laptop.view.you.id]).toEqual([null, seat]);
    manager.get(code).dispose();
  });

  it('looks the room up again once the store answered: a room closed seats nobody', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, ben, code, number } = await runOfTwo(server);
    anna.close(1006);
    const phone = await signedIn(server, 'Phone', number);
    const { answer, looked } = holdLookup(store, 'Phone');
    phone.say({ kind: 'resume', code, pass: passFor('Phone') });
    // The crew gone, the room stands empty till the server closes it.
    ben.close(1006);
    manager.sweep(Date.now() + 60 * 60_000);
    answer();
    await looked;
    await vi.waitFor(() => expect(refusalOf(phone, 'resume')).not.toBeNull());
    expect(refusalOf(phone, 'resume')).toMatch(/existiert nicht/);
    expect(phone.heard.some((m) => m.kind === 'joined')).toBe(false);
  });
});

describe('the account’s run on its devices', () => {
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
    // The pass signed out gets nothing back — not the seat, not a card of it: it is told so.
    const copy = server.connect();
    const signedOut = { kind: 'login', done: 'signed-out', account: null };
    const resume: ClientMessage = { kind: 'resume', code, pass: passFor('Anna') };
    expect(await heardAfter(copy, resume, 'login')).toEqual(signedOut);
    copy.say({ kind: 'whereami', pass: passFor('Anna') });
    await vi.waitFor(() => expect(copy.heard.filter((m) => m.kind === 'login')).toHaveLength(2));
    expect(copy.heard.find((m) => m.kind === 'seated')).toEqual({ kind: 'seated', seat: null });
    expect(copy.heard.some((m) => m.kind === 'joined' || m.kind === 'account')).toBe(false);
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

describe('a seat bound to the account, its Kennwort changed on another device', () => {
  it('signs the device on the seat out: it is told so, and the seat waits', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, ben, code, number, seat } = await runOfTwo(server);
    // Anna's phone, signed in, changes the Kennwort: her laptop in the run is signed out.
    const phone = await signedIn(server, 'Phone', number);
    const change: ClientMessage = {
      kind: 'change-password',
      pass: passFor('Phone'),
      old: KENNWORT,
      password: 'Neues Kennwort',
    };
    expect((await heardAfter(phone, change, 'login')).done).toBe('changed');
    expect(anna.heard).toContainEqual({ kind: 'left', code, message: SIGNED_OUT });
    expect(ben.view.players.find((p) => p.name === 'Anna')?.connected).toBe(false);
    // The laptop's next ask finds it signed out, back to its seat or not.
    const before = anna.heard.length;
    const told = await heardAfter(anna, { kind: 'resume', code, pass: passFor('Anna') }, 'login');
    expect(told).toEqual({ kind: 'login', done: 'signed-out', account: null });
    const where = await heardAfter(anna, { kind: 'whereami', pass: passFor('Anna') }, 'login');
    expect(where.done).toBe('signed-out');
    expect(anna.heard.slice(before).some((m) => m.kind === 'joined')).toBe(false);
    // The seat waits for the account: the phone takes it back, and the run counts for it.
    await heardAfter(phone, { kind: 'resume', code, pass: passFor('Phone') }, 'joined');
    expect(phone.view.you.id).toBe(seat);
    ben.say({ kind: 'abandon', code, pass: passFor('Ben') });
    await vi.waitFor(async () => {
      const annas = (await store.findByIdentity(identityOf('Phone')))?.id ?? '';
      expect((await store.runsOfAccount(annas, 5)).runs.map((run) => run.seat)).toEqual([0]);
    });
    manager.get(code).dispose();
  });
});

describe('a run that ends as its seat’s pass signs out', () => {
  it('credits the account with a run that ends once the sign-out is in the store', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, ben, code } = await runOfTwo(server);
    const annas = (await store.findByIdentity(identityOf('Anna')))?.id ?? '';
    const call = holdSignOut(store, 'after');
    anna.say({ kind: 'sign-out', pass: passFor('Anna') });
    await call.reached;
    // The store has signed the pass out, the answer not gone yet: the run ends.
    ben.say({ kind: 'abandon', code, pass: passFor('Ben') });
    await vi.waitFor(async () => expect(await seatsOf(store, annas)).toEqual([0]));
    call.release();
    await vi.waitFor(() => expect(anna.heard.some((m) => m.kind === 'login')).toBe(true));
    manager.get(code).dispose();
  });

  it('credits the account with a run that ends before the sign-out reaches the store', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, ben, code } = await runOfTwo(server);
    const annas = (await store.findByIdentity(identityOf('Anna')))?.id ?? '';
    const call = holdSignOut(store, 'before');
    anna.say({ kind: 'sign-out', pass: passFor('Anna') });
    await call.reached;
    // The seat parked first, the store not written yet: the run ends.
    expect(ben.view.players.find((p) => p.name === 'Anna')?.connected).toBe(false);
    ben.say({ kind: 'abandon', code, pass: passFor('Ben') });
    await vi.waitFor(async () => expect(await seatsOf(store, annas)).toEqual([0]));
    call.release();
    await vi.waitFor(() => expect(anna.heard.some((m) => m.kind === 'login')).toBe(true));
    manager.get(code).dispose();
  });

  it('credits the account with a run that ends as a new Kennwort signs its seat out', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { ben, code, number } = await runOfTwo(server);
    const annas = (await store.findByIdentity(identityOf('Anna')))?.id ?? '';
    const phone = await signedIn(server, 'Phone', number);
    const call = holdChange(store);
    const change: ClientMessage = {
      kind: 'change-password',
      pass: passFor('Phone'),
      old: KENNWORT,
      password: 'Neues Kennwort',
    };
    phone.say(change);
    await call.reached;
    // The laptop's pass signed out in the store, the answer not gone yet: the run ends.
    ben.say({ kind: 'abandon', code, pass: passFor('Ben') });
    await vi.waitFor(async () => expect(await seatsOf(store, annas)).toEqual([0]));
    call.release();
    await vi.waitFor(() => expect(phone.heard.some((m) => m.kind === 'login')).toBe(true));
    manager.get(code).dispose();
  });
});

describe('a run that ends as its seat’s pass switches away, or stays', () => {
  it('credits the old account with a run that ends as the device switches away', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, ben, code } = await runOfTwo(server);
    const annas = (await store.findByIdentity(identityOf('Anna')))?.id ?? '';
    const dan = server.connect();
    const set = await heardAfter(
      dan,
      { kind: 'set-password', pass: passFor('Dan'), password: KENNWORT },
      'login',
    );
    const call = holdSignIn(store);
    anna.say({
      kind: 'switch-account',
      pass: passFor('Anna'),
      next: passFor('Eva'),
      login: set.account?.login ?? '',
      password: KENNWORT,
    });
    await call.reached;
    // The switch is in the store, its answer not gone yet: the run ends.
    ben.say({ kind: 'abandon', code, pass: passFor('Ben') });
    await vi.waitFor(async () => expect(await seatsOf(store, annas)).toEqual([0]));
    call.release();
    await vi.waitFor(() => expect(anna.heard.some((m) => m.kind === 'login')).toBe(true));
    manager.get(code).dispose();
  });

  it('leaves the seat of the device that changes the Kennwort on its line', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const store = freshStore();
    const { server, manager } = serverOn(store);
    const { anna, ben, code, number } = await runOfTwo(server);
    const phone = await signedIn(server, 'Phone', number);
    const change: ClientMessage = {
      kind: 'change-password',
      pass: passFor('Anna'),
      old: KENNWORT,
      password: 'Neues Kennwort',
    };
    expect((await heardAfter(anna, change, 'login')).done).toBe('changed');
    expect(anna.heard.some((m) => m.kind === 'left')).toBe(false);
    expect(ben.view.players.find((p) => p.name === 'Anna')?.connected).toBe(true);
    const told = await heardAfter(phone, { kind: 'whereami', pass: passFor('Phone') }, 'login');
    expect(told.done).toBe('signed-out');
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

  it('parks a seat found by its pass’s id and kept hash both, under PARKED', () => {
    const book = new SeatBook();
    book.bind('p-anna', passFor('Anna'));
    const kept = seatPassOf('Anna');
    expect(book.seatOfPass({ ...kept, secretHash: seatPassOf('Mallory').secretHash })).toBeNull();
    expect(book.seatOfPass(kept)).toBe('p-anna');
    book.park('p-anna', 'annas');
    expect([book.seatOf(passFor('Anna')), book.seatOfAccount('annas')]).toEqual([null, 'p-anna']);
    expect(book.passOf('p-anna')).toEqual({ id: kept.id, secretHash: PARKED });
  });
});
