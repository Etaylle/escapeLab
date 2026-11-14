import type * as Crypto from 'node:crypto';
import { scrypt } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseMission,
  PASSWORD_SIZE,
  type AccountView,
  type ClientMessage,
  type Mission,
  type ServerMessage,
} from '@escapelab/core';
import {
  AccountDesk,
  CHANGED_MEANWHILE,
  NO_LOGIN,
  OLD_WRONG,
  SIGN_OUT_LOSES,
  TOO_MANY_CHANGES,
  WRONG_LOGIN,
} from '../src/accounts.js';
import {
  BUSY,
  changeLocked,
  DeriveQueue,
  DERIVES_AT_ONCE,
  DERIVES_WAITING,
  numberLocked,
  SignInGuard,
  WRONG_PER_ADDRESS,
  WRONG_PER_LOCK,
} from '../src/login.js';
import type { Sender } from '../src/rateLimiter.js';
import { RoomManager } from '../src/roomManager.js';
import { BOUND_SIGN_IN, ONE_PASS, serveSockets } from '../src/sockets.js';
import { JsonlStore } from '../src/store/jsonl.js';
import { HAS_LOGIN, PASS_REFUSED } from '../src/store/store.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';
import { DAY, finished, identityOf } from './storeContract.js';

// The real crypto, watched: how many keys scrypt derives.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof Crypto>();
  return { ...actual, scrypt: vi.fn(actual.scrypt) };
});

/** The tutorial, for two. */
const mission: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);
const catalog = { get: () => mission, default: mission };

/** Anna's Kennwort, and one nobody set. */
const KENNWORT = 'Kaltenbrunn 1986';
const OTHER = 'Kaltenbrunn 1987';

/**
 * The server's sockets with the accounts in a store of their own and the limits on signing in
 * (login.ts), each address's wrong tries counted — and so many changes a socket, and the turns at
 * deriving a Kennwort, where `options` says.
 */
function lab(options: { changesPerSocket?: number; derives?: DeriveQueue } = {}) {
  const server = new FakeServer();
  const manager = new RoomManager();
  const folder = mkdtempSync(join(tmpdir(), 'escapelab-login-'));
  const store = JsonlStore.open(join(folder, 'runs.jsonl'));
  const signIns = new SignInGuard();
  const accounts = new AccountDesk(store, options.derives);
  const { changesPerSocket } = options;
  const limits = changesPerSocket === undefined ? {} : { changesPerSocket };
  serveSockets(server, { catalog, manager, accounts, signIns, ...limits });
  return { server, manager, store, signIns };
}

/** A request from the machine `address` on the LAN. */
const from = (address: string): Sender => ({ headers: {}, socket: { remoteAddress: address } });

/** What a socket is told of an ask of `of`: its `login` answer, or its refusal. */
type Answer = Extract<ServerMessage, { kind: 'login' }> | { refused: string };

/**
 * `socket` says `msg`, and what it is answered — waited for, as scrypt takes its time: the `login`
 * it hears, or the refusal of `msg`.
 */
async function ask(socket: FakeSocket, msg: ClientMessage): Promise<Answer> {
  const before = socket.heard.length;
  socket.say(msg);
  const answer = (): ServerMessage | undefined =>
    socket.heard
      .slice(before)
      .find((m) => m.kind === 'login' || (m.kind === 'error' && m.of === msg.kind));
  await vi.waitFor(() => expect(answer()).toBeDefined(), { timeout: 10_000, interval: 5 });
  const heard = answer();
  if (heard?.kind === 'login') {
    return heard;
  }
  return { refused: heard?.kind === 'error' ? heard.message : '' };
}

/** Lets the account work under way come to an end: the stores answer in promises. */
const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** The account the socket heard of last; throws where it heard of none. */
function accountOf(socket: FakeSocket): AccountView {
  const told = socket.heard.flatMap((m) =>
    m.kind === 'account' || m.kind === 'login' ? [m.account] : [],
  );
  const last = told.at(-1);
  if (last === undefined || last === null) {
    throw new Error('this socket heard of no account');
  }
  return last;
}

/** Anna's device, her account with its Kennwort set: her socket and her Ausweisnummer. */
async function annaWithKennwort(server: FakeServer): Promise<{ anna: FakeSocket; number: string }> {
  const anna = server.connect();
  anna.say({ kind: 'whereami', pass: passFor('Anna'), name: 'Anna' });
  await settled();
  const set = await ask(anna, { kind: 'set-password', pass: passFor('Anna'), password: KENNWORT });
  const number = 'kind' in set ? set.account?.login : null;
  if (number === undefined || number === null) {
    throw new Error(`no Kennwort set: ${JSON.stringify(set)}`);
  }
  return { anna, number };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a Kennwort for an account', () => {
  it('mints the Ausweisnummer at the first and shows it to the account’s pass', async () => {
    const { server } = lab();
    const { anna, number } = await annaWithKennwort(server);
    expect(number).toMatch(/^EL-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(anna.heard.at(-1)).toMatchObject({
      kind: 'login',
      done: 'set',
      account: { name: 'Anna', login: number },
    });
    // Every account the pass is told from now on names it; another pass hears nothing of it.
    anna.say({ kind: 'whereami', pass: passFor('Anna') });
    const ben = server.connect();
    ben.say({ kind: 'whereami', pass: passFor('Ben'), name: 'Ben' });
    await settled();
    expect(accountOf(anna).login).toBe(number);
    expect(accountOf(ben).login).toBeNull();
    expect(JSON.stringify(ben.heard)).not.toContain(number);
  });

  it('takes one first Kennwort, of 8 to 128 characters', async () => {
    const { server } = lab();
    const { anna } = await annaWithKennwort(server);
    const pass = passFor('Anna');
    expect(await ask(anna, { kind: 'set-password', pass, password: OTHER })).toEqual({
      refused: HAS_LOGIN,
    });
    const ben = server.connect();
    for (const password of ['1234567', 'x'.repeat(129)]) {
      expect(await ask(ben, { kind: 'set-password', pass: passFor('Ben'), password })).toEqual({
        refused: PASSWORD_SIZE,
      });
    }
  });

  it('changes the Kennwort where the present one is shown; the old opens nothing', async () => {
    const { server } = lab();
    const { anna, number } = await annaWithKennwort(server);
    const pass = passFor('Anna');
    const change = (old: string, password: string): ClientMessage => ({
      kind: 'change-password',
      pass,
      old,
      password,
    });
    expect(await ask(anna, change(OTHER, 'Neues Kennwort'))).toEqual({ refused: OLD_WRONG });
    expect(await ask(anna, change(KENNWORT, 'kurz'))).toEqual({ refused: PASSWORD_SIZE });
    expect(await ask(anna, change(KENNWORT, 'Neues Kennwort'))).toMatchObject({
      kind: 'login',
      done: 'changed',
      account: { login: number },
    });
    const ben = server.connect();
    const signIn = (password: string): ClientMessage => ({
      kind: 'sign-in',
      pass: passFor('Ben'),
      login: number,
      password,
    });
    expect(await ask(ben, signIn(KENNWORT))).toEqual({ refused: WRONG_LOGIN });
    expect(await ask(ben, signIn('Neues Kennwort'))).toMatchObject({ done: 'signed-in' });
    // An account without a Kennwort has none to change.
    const cleo = server.connect();
    cleo.say({ kind: 'whereami', pass: passFor('Cleo') });
    await settled();
    const none = { ...change(KENNWORT, 'Neues Kennwort'), pass: passFor('Cleo') };
    expect(await ask(cleo, none)).toEqual({ refused: NO_LOGIN });
  });

  it('says a Kennwort changed meanwhile on another device', async () => {
    const { server, store } = lab();
    const { anna } = await annaWithKennwort(server);
    // The other device's change lands between the check and the write.
    vi.spyOn(store, 'replaceLoginSecret').mockResolvedValueOnce(null);
    const change: ClientMessage = {
      kind: 'change-password',
      pass: passFor('Anna'),
      old: KENNWORT,
      password: 'Neues Kennwort',
    };
    expect(await ask(anna, change)).toEqual({ refused: CHANGED_MEANWHILE });
  });

});

describe('the Kennwort, kept to itself', () => {
  it('never says the Kennwort or its hash: not on the line, not in the log', async () => {
    const said = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    const { server, store } = lab();
    const { anna, number } = await annaWithKennwort(server);
    const ben = server.connect();
    const pass = passFor('Ben');
    await ask(ben, { kind: 'sign-in', pass, login: number, password: OTHER });
    await ask(ben, { kind: 'sign-in', pass, login: number, password: KENNWORT });
    // A store that fails, naming what it was handed: the log says why, without the hash.
    const cleo = server.connect();
    vi.spyOn(store, 'addLogin').mockRejectedValueOnce(
      new Error(`could not write identity { secretHash: "scrypt$32768$8$1$ab$cd" }`),
    );
    const set: ClientMessage = { kind: 'set-password', pass: passFor('Cleo'), password: OTHER };
    expect(await ask(cleo, set)).toEqual({ refused: 'Das Konto ist gerade nicht erreichbar.' });
    const heard = JSON.stringify([...anna.heard, ...ben.heard, ...cleo.heard]);
    const logged = JSON.stringify(said.flatMap((spy) => spy.mock.calls));
    expect(logged).toContain('set-password not done: could not write identity');
    for (const secret of [KENNWORT, OTHER, 'scrypt$3', 'ab$cd']) {
      expect(heard).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
    expect(logged).not.toContain(number);
  });
});

describe('signing in', () => {
  it('leads a device’s pass into the account: runs, Erfolge, its guest account gone', async () => {
    const { server, store } = lab();
    const { anna, number } = await annaWithKennwort(server);
    await store.appendRun(finished({ at: DAY, crew: ['Anna'] }, ['Anna']));
    // Ben's phone, a guest of its own until it signs in.
    const phone = server.connect();
    phone.say({ kind: 'whereami', pass: passFor('Ben'), name: 'Ben' });
    await settled();
    const guest = (await store.findByIdentity(identityOf('Ben')))?.id ?? '';
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const signIn: ClientMessage = {
      kind: 'sign-in',
      pass: passFor('Ben'),
      login: number.toLowerCase().replaceAll('-', ' '),
      password: KENNWORT,
    };
    const answer = await ask(phone, signIn);
    expect(answer).toMatchObject({
      kind: 'login',
      done: 'signed-in',
      account: { name: 'Anna', runs: 1, login: number },
    });
    const earned = 'kind' in answer ? Object.keys(answer.account?.achievements ?? {}) : [];
    expect(earned).toEqual(['blackout']);
    expect(said).toHaveBeenCalledWith(
      '[escapelab] a pass signed into an account, the empty account it left deleted',
    );
    const annas = (await store.findByIdentity(identityOf('Anna')))?.id;
    expect((await store.findByIdentity(identityOf('Ben')))?.id).toBe(annas);
    await expect(store.updateProfile(guest, { displayName: 'Ben' })).rejects.toThrow();
    phone.say({ kind: 'my-runs', pass: passFor('Ben') });
    await settled();
    expect(phone.heard.at(-1)).toMatchObject({ kind: 'my-runs', total: 1 });
    // Both devices are one account now: a name typed on one is the other's.
    phone.say({ kind: 'profile', pass: passFor('Ben'), name: 'Anna B.' });
    await settled();
    anna.say({ kind: 'whereami', pass: passFor('Anna') });
    await settled();
    expect([accountOf(phone).name, accountOf(anna).name]).toEqual(['Anna B.', 'Anna B.']);
  });

  it('signs in again as it was: nothing changes, nothing else goes', async () => {
    const { server } = lab();
    const { number } = await annaWithKennwort(server);
    const phone = server.connect();
    const signIn: ClientMessage = {
      kind: 'sign-in',
      pass: passFor('Ben'),
      login: number,
      password: KENNWORT,
    };
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await ask(phone, signIn)).toMatchObject({ done: 'signed-in' });
    const again = await ask(phone, signIn);
    expect(again).toMatchObject({ done: 'signed-in', account: { name: 'Anna' } });
    expect(said.mock.calls.flat()).toEqual([
      '[escapelab] a pass signed into an account',
      '[escapelab] a pass signed into an account',
    ]);
  });

  it('says the same of a wrong Ausweisnummer and a wrong Kennwort', async () => {
    const { server } = lab();
    const { number } = await annaWithKennwort(server);
    const phone = server.connect();
    const pass = passFor('Ben');
    const unknown = number.replace(/.$/, (last) => (last === '2' ? '3' : '2'));
    for (const [login, password] of [
      [number, OTHER],
      [unknown, KENNWORT],
      ['EL-0000-0000', KENNWORT],
    ] as const) {
      expect(await ask(phone, { kind: 'sign-in', pass, login, password })).toEqual({
        refused: WRONG_LOGIN,
      });
    }
  });

});

describe('the limits on signing in, over the line', () => {
  it(`locks an Ausweisnummer at ${WRONG_PER_LOCK} wrong Kennwörter, for all`, async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { server } = lab();
    const { number } = await annaWithKennwort(server);
    const pass = passFor('Ben');
    for (let i = 0; i < WRONG_PER_LOCK; i += 1) {
      const phone = server.connect(from(`192.168.1.${i + 10}`));
      expect(await ask(phone, { kind: 'sign-in', pass, login: number, password: OTHER })).toEqual({
        refused: WRONG_LOGIN,
      });
    }
    const late = server.connect(from('192.168.1.99'));
    const locked = await ask(late, { kind: 'sign-in', pass, login: number, password: KENNWORT });
    expect([{ refused: numberLocked(60) }, { refused: numberLocked(59) }]).toContainEqual(locked);
  });

  it('starts an Ausweisnummer’s count over at a right Kennwort', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { server } = lab();
    const { number } = await annaWithKennwort(server);
    const tryFrom = (machine: number, pass: string, password: string): Promise<Answer> =>
      ask(server.connect(from(`192.168.1.${machine}`)), {
        kind: 'sign-in',
        pass: passFor(pass),
        login: number,
        password,
      });
    for (let i = 0; i < WRONG_PER_LOCK - 1; i += 1) {
      await tryFrom(10 + i, 'Mallory', OTHER);
    }
    expect(await tryFrom(20, 'Ben', KENNWORT)).toMatchObject({ done: 'signed-in' });
    for (let i = 0; i < WRONG_PER_LOCK - 1; i += 1) {
      await tryFrom(30 + i, 'Mallory', OTHER);
    }
    expect(await tryFrom(40, 'Cleo', KENNWORT)).toMatchObject({ done: 'signed-in' });
  });

  it('counts every try as a change on its socket: so many a minute, tried or not', async () => {
    const { server } = lab({ changesPerSocket: 2 });
    const { number } = await annaWithKennwort(server);
    const phone = server.connect();
    const pass = passFor('Mallory');
    const guess: ClientMessage = { kind: 'sign-in', pass, login: number, password: OTHER };
    expect(await ask(phone, guess)).toEqual({ refused: WRONG_LOGIN });
    expect(await ask(phone, guess)).toEqual({ refused: WRONG_LOGIN });
    const right: ClientMessage = { ...guess, password: KENNWORT };
    expect(await ask(phone, right)).toEqual({ refused: TOO_MANY_CHANGES });
  });

  it('refuses a pass a run on binds, before any Kennwort is tried', async () => {
    const { server, manager, signIns } = lab();
    const { number } = await annaWithKennwort(server);
    // Ben in a run of the tutorial with Cleo.
    const cleo = server.connect();
    cleo.say({ kind: 'create-room', name: 'Cleo', pass: passFor('Cleo') });
    const { code } = joinedOf(cleo);
    const ben = server.connect();
    ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben') });
    ben.say({ kind: 'set-ready', ready: true });
    cleo.say({ kind: 'start-mission' });
    expect(ben.view.phase).toBe('playing');
    const pass = passFor('Ben');
    const right: ClientMessage = { kind: 'sign-in', pass, login: number, password: OTHER };
    expect(await ask(ben, right)).toEqual({ refused: BOUND_SIGN_IN });
    expect(signIns.size).toBe(0);
    manager.get(code).dispose();
  });
});

describe('the limits, tried at once', () => {
  /** How many keys scrypt derived since the count was cleared: a Kennwort checked or kept each. */
  const derived = (): number => vi.mocked(scrypt).mock.calls.length;

  /** What each of `answers` says: the refusal, or what was done. */
  const lines = (answers: Answer[]): string[] =>
    answers.map((answer) => ('refused' in answer ? answer.refused : answer.done));

  it(`checks ${WRONG_PER_LOCK} tries sent at once on an Ausweisnummer, no more`, async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { server } = lab();
    const { number } = await annaWithKennwort(server);
    vi.mocked(scrypt).mockClear();
    // Forty machines behind one address send at once: 39 guesses, then Anna's Kennwort.
    const answers = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        ask(server.connect(from('192.168.1.66')), {
          kind: 'sign-in',
          pass: passFor(`Mallory ${i}`),
          login: number,
          password: i === 39 ? KENNWORT : OTHER,
        }),
      ),
    );
    expect(derived()).toBe(WRONG_PER_LOCK);
    const told = lines(answers);
    expect(told.filter((line) => line === WRONG_LOGIN)).toHaveLength(WRONG_PER_LOCK);
    const held = told.filter((line) => line === numberLocked(60) || line === BUSY);
    expect(held).toHaveLength(40 - WRONG_PER_LOCK);
  });

  it(`checks ${WRONG_PER_ADDRESS} tries sent at once from an address; others get in`, async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // A queue that holds every try, and an address's share of it: the address's limit is what
    // holds them back.
    const { server, store } = lab({ derives: new DeriveQueue(DERIVES_AT_ONCE, 200) });
    const { number } = await annaWithKennwort(server);
    vi.mocked(scrypt).mockClear();
    const answers = await Promise.all(
      Array.from({ length: WRONG_PER_ADDRESS + 10 }, (_, i) =>
        ask(server.connect(from('192.168.1.66')), {
          kind: 'sign-in',
          pass: passFor(`Mallory ${i}`),
          login: 'unleserlich',
          password: OTHER,
        }),
      ),
    );
    expect(derived()).toBe(WRONG_PER_ADDRESS);
    const fromHere = /^Zu viele falsche Anmeldungen von dieser Adresse/;
    expect(lines(answers).filter((line) => fromHere.test(line))).toHaveLength(10);
    // Refused before the store is asked, or any Kennwort tried.
    const looked = vi.spyOn(store, 'findLogin');
    const right = { kind: 'sign-in', pass: passFor('Mallory'), login: number, password: KENNWORT };
    const guesser = server.connect(from('192.168.1.66'));
    expect(await ask(guesser, right as ClientMessage)).toEqual({
      refused: expect.stringMatching(fromHere),
    });
    expect(looked).not.toHaveBeenCalled();
    const neighbour = server.connect(from('192.168.1.67'));
    const theirs = { ...right, pass: passFor('Ben') } as ClientMessage;
    expect(await ask(neighbour, theirs)).toMatchObject({ done: 'signed-in' });
  });

  it('lets a pass signed in change its Kennwort past a number its guessers locked', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { server } = lab();
    const { anna, number } = await annaWithKennwort(server);
    for (let i = 0; i < WRONG_PER_LOCK; i += 1) {
      const guess = { kind: 'sign-in', pass: passFor('Mallory'), login: number, password: OTHER };
      await ask(server.connect(from(`192.168.1.${i + 10}`)), guess as ClientMessage);
    }
    const change = (old: string, password: string): ClientMessage => ({
      kind: 'change-password',
      pass: passFor('Anna'),
      old,
      password,
    });
    expect(await ask(anna, change(KENNWORT, 'Neues Kennwort'))).toMatchObject({ done: 'changed' });
    // Its own wrong present Kennwörter lock its „Kennwort ändern", counted against the pass.
    for (let i = 0; i < WRONG_PER_LOCK; i += 1) {
      expect(await ask(anna, change(OTHER, 'Drittes Kennwort'))).toEqual({ refused: OLD_WRONG });
    }
    const locked = await ask(anna, change('Neues Kennwort', 'Drittes Kennwort'));
    expect([{ refused: changeLocked(60) }, { refused: changeLocked(59) }]).toContainEqual(locked);
  });
});

describe('the turns at deriving, over the line', () => {
  /** scrypt as it is, with how many keys it derived at once at most: `most`. */
  async function counted() {
    const actual = await vi.importActual<typeof Crypto>('node:crypto');
    const seen = { running: 0, most: 0 };
    type Done = (err: Error | null, key: Buffer) => void;
    const watched = (...[password, salt, length, options, done]: [
      Crypto.BinaryLike,
      Crypto.BinaryLike,
      number,
      Crypto.ScryptOptions,
      Done,
    ]): void => {
      seen.running += 1;
      seen.most = Math.max(seen.most, seen.running);
      actual.scrypt(password, salt, length, options, (err, key) => {
        seen.running -= 1;
        done(err, key);
      });
    };
    vi.mocked(scrypt).mockImplementation(watched as unknown as typeof scrypt);
    return { seen, restore: () => vi.mocked(scrypt).mockImplementation(actual.scrypt) };
  }

  it(`derives ${DERIVES_AT_ONCE} at once, lets ${DERIVES_WAITING} wait, refuses more`, async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { server } = lab();
    const { seen, restore } = await counted();
    try {
      // A crowd from as many machines, none of their numbers readable: only the turns hold them.
      const answers = await Promise.all(
        Array.from({ length: DERIVES_AT_ONCE + DERIVES_WAITING + 4 }, (_, i) =>
          ask(server.connect(from(`10.0.${i}.1`)), {
            kind: 'sign-in',
            pass: passFor(`Gast ${i}`),
            login: 'unleserlich',
            password: OTHER,
          }),
        ),
      );
      expect(seen.most).toBe(DERIVES_AT_ONCE);
      const told = answers.map((answer) => ('refused' in answer ? answer.refused : answer.done));
      expect(told.filter((line) => line === BUSY)).toHaveLength(4);
      const checked = told.filter((line) => line === WRONG_LOGIN);
      expect(checked).toHaveLength(DERIVES_AT_ONCE + DERIVES_WAITING);
    } finally {
      restore();
    }
  });
});

describe('the turns at deriving, shared between addresses', () => {
  it('keeps half the turns for other machines while one floods them', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { server } = lab();
    const { number } = await annaWithKennwort(server);
    // One machine sends forty at once, none of their numbers readable; then a neighbour signs in.
    const flood = Array.from({ length: 40 }, (_, i) =>
      ask(server.connect(from('192.168.1.66')), {
        kind: 'sign-in',
        pass: passFor(`Mallory ${i}`),
        login: 'unleserlich',
        password: OTHER,
      }),
    );
    const neighbour = ask(server.connect(from('192.168.1.67')), {
      kind: 'sign-in',
      pass: passFor('Ben'),
      login: number,
      password: KENNWORT,
    });
    const share = (DERIVES_AT_ONCE + DERIVES_WAITING) / 2;
    const told = (await Promise.all(flood)).map((answer) =>
      'refused' in answer ? answer.refused : answer.done,
    );
    expect(told.filter((line) => line === WRONG_LOGIN)).toHaveLength(share);
    expect(told.filter((line) => line === BUSY)).toHaveLength(40 - share);
    expect(await neighbour).toMatchObject({ done: 'signed-in' });
  });
});

describe('a run that starts while a sign-in is checked', () => {
  /** scrypt's next key held back till `release`: the derive of the next Kennwort checked. */
  async function holdNextDerive() {
    const actual = await vi.importActual<typeof Crypto>('node:crypto');
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let begun = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      begun = resolve;
    });
    const waiting = (...args: Parameters<typeof actual.scrypt>): void => {
      begun();
      void held.then(() => Reflect.apply(actual.scrypt, undefined, args));
    };
    vi.mocked(scrypt).mockImplementationOnce(waiting as typeof scrypt);
    return { started, release };
  }

  it('refuses the sign-in once its Kennwort is checked: the run binds the pass', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { server, manager, store } = lab();
    const { number } = await annaWithKennwort(server);
    // Ben in the tutorial's lobby with Cleo, ready; his guest account binds his seat.
    const cleo = server.connect();
    cleo.say({ kind: 'create-room', name: 'Cleo', pass: passFor('Cleo') });
    const { code } = joinedOf(cleo);
    const ben = server.connect();
    ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben') });
    ben.say({ kind: 'set-ready', ready: true });
    await settled();
    const guest = (await store.findByIdentity(identityOf('Ben')))?.id;
    const { started, release } = await holdNextDerive();
    const pass = passFor('Ben');
    const answer = ask(ben, { kind: 'sign-in', pass, login: number, password: KENNWORT });
    await started;
    // The run starts while the Kennwort is checked.
    cleo.say({ kind: 'start-mission' });
    expect(ben.view.phase).toBe('playing');
    release();
    expect(await answer).toEqual({ refused: BOUND_SIGN_IN });
    expect((await store.findByIdentity(identityOf('Ben')))?.id).toBe(guest);
    expect(manager.get(code).snapshot().seats.find((seat) => seat.name === 'Ben')?.accountId).toBe(
      guest,
    );
    manager.get(code).dispose();
  });
});

describe('signing out, and switching accounts', () => {
  it('signs a pass out: the account whole, the pass a stranger, the number opens it', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { server, store } = lab();
    const { anna, number } = await annaWithKennwort(server);
    await store.appendRun(finished({ at: DAY, crew: ['Anna'] }, ['Anna']));
    expect(await ask(anna, { kind: 'sign-out', pass: passFor('Anna') })).toEqual({
      kind: 'login',
      done: 'signed-out',
      account: null,
    });
    expect(said).toHaveBeenCalledWith('[escapelab] a pass signed out of its account');
    expect(await store.findByIdentity(identityOf('Anna'))).toBeNull();
    const laptop = server.connect();
    const signIn: ClientMessage = {
      kind: 'sign-in',
      pass: passFor('Laptop'),
      login: number,
      password: KENNWORT,
    };
    expect(await ask(laptop, signIn)).toMatchObject({ account: { name: 'Anna', runs: 1 } });
  });

  it('keeps a guest from signing out of an account no device would reach again', async () => {
    const { server, store } = lab();
    const guest = server.connect();
    guest.say({ kind: 'whereami', pass: passFor('Ben'), name: 'Ben' });
    await settled();
    expect(await ask(guest, { kind: 'sign-out', pass: passFor('Ben') })).toEqual({
      refused: SIGN_OUT_LOSES,
    });
    expect((await store.findByIdentity(identityOf('Ben')))?.displayName).toBe('Ben');
    // A pass with no account at all has nothing to sign out of.
    const fresh = server.connect();
    const nothing = await ask(fresh, { kind: 'sign-out', pass: passFor('Cleo') });
    expect(nothing).toMatchObject({ done: 'signed-out' });
  });

  it('switches a device in one go: the new pass into the account, the old one out', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { server, store } = lab();
    const { anna, number: annas } = await annaWithKennwort(server);
    const dan = server.connect();
    const set = await ask(dan, { kind: 'set-password', pass: passFor('Dan'), password: OTHER });
    const dans = 'kind' in set ? (set.account?.login ?? '') : '';
    const switched = await ask(anna, {
      kind: 'switch-account',
      pass: passFor('Anna'),
      next: passFor('Eva'),
      login: dans,
      password: OTHER,
    });
    expect(switched).toMatchObject({ kind: 'login', done: 'switched', account: { login: dans } });
    const danId = (await store.findByIdentity(identityOf('Dan')))?.id;
    expect((await store.findByIdentity(identityOf('Eva')))?.id).toBe(danId);
    expect(await store.findByIdentity(identityOf('Anna'))).toBeNull();
    // Anna's account waits for its Kennwort.
    const laptop = server.connect();
    const back: ClientMessage = {
      kind: 'sign-in',
      pass: passFor('Laptop'),
      login: annas,
      password: KENNWORT,
    };
    expect(await ask(laptop, back)).toMatchObject({ account: { name: 'Anna', login: annas } });
  });

  it('changes nothing where the switch’s Kennwort is wrong, or its pass no new one', async () => {
    const { server, store } = lab();
    const { anna, number } = await annaWithKennwort(server);
    const annaId = (await store.findByIdentity(identityOf('Anna')))?.id;
    const switchTo = (next: string, password: string): ClientMessage => ({
      kind: 'switch-account',
      pass: passFor('Anna'),
      next: passFor(next),
      login: number,
      password,
    });
    expect(await ask(anna, switchTo('Eva', OTHER))).toEqual({ refused: WRONG_LOGIN });
    expect(await ask(anna, switchTo('Anna', KENNWORT))).toEqual({ refused: PASS_REFUSED });
    expect((await store.findByIdentity(identityOf('Anna')))?.id).toBe(annaId);
    expect(await store.findByIdentity(identityOf('Eva'))).toBeNull();
  });
});

describe('a Kennwort changed, and the account’s other devices', () => {
  /** The sign-in of the pass of `name`'s into the account of `number`, with `password`. */
  const signInAs = (name: string, number: string, password: string): ClientMessage => ({
    kind: 'sign-in',
    pass: passFor(name),
    login: number,
    password,
  });

  /** What `socket` heard of its account and its login since `from`. */
  const toldSince = (socket: FakeSocket, from: number): ServerMessage[] =>
    socket.heard.slice(from).filter((m) => m.kind === 'login' || m.kind === 'account');

  it('signs the other devices out: each is told so the next time it shows its pass', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { server } = lab();
    const { anna, number } = await annaWithKennwort(server);
    const phone = server.connect();
    expect(await ask(phone, signInAs('Phone', number, KENNWORT))).toMatchObject({
      done: 'signed-in',
    });
    const change: ClientMessage = {
      kind: 'change-password',
      pass: passFor('Anna'),
      old: KENNWORT,
      password: 'Neues Kennwort',
    };
    expect(await ask(anna, change)).toMatchObject({ done: 'changed', account: { login: number } });
    expect(said).toHaveBeenCalledWith('[escapelab] a Kennwort changed, 1 other pass signed out');
    // The phone, back on a line of its own: told it signed out, and nothing of the account.
    const back = server.connect();
    back.say({ kind: 'whereami', pass: passFor('Phone') });
    await vi.waitFor(() => expect(toldSince(back, 0)).not.toEqual([]));
    expect(toldSince(back, 0)).toEqual([{ kind: 'login', done: 'signed-out', account: null }]);
    // Whatever it asks of the account on its old line, it is told the same.
    const runs = phone.heard.length;
    phone.say({ kind: 'my-runs', pass: passFor('Phone') });
    await vi.waitFor(() => expect(toldSince(phone, runs)).not.toEqual([]));
    expect(toldSince(phone, runs)).toEqual([{ kind: 'login', done: 'signed-out', account: null }]);
    // The device that changed it stays in; the phone's next pass signs in by the new Kennwort.
    anna.say({ kind: 'whereami', pass: passFor('Anna') });
    await settled();
    expect(accountOf(anna).login).toBe(number);
    expect(await ask(back, signInAs('Phone 2', number, KENNWORT))).toEqual({
      refused: WRONG_LOGIN,
    });
    expect(await ask(back, signInAs('Phone 2', number, 'Neues Kennwort'))).toMatchObject({
      done: 'signed-in',
    });
  });
});

describe('one socket, as its device signs out or switches', () => {
  it('speaks for the device’s next pass once its pass signed out, or switched', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { server } = lab();
    const { anna, number } = await annaWithKennwort(server);
    const out = await ask(anna, { kind: 'sign-out', pass: passFor('Anna') });
    expect(out).toMatchObject({ done: 'signed-out' });
    // The device's next pass, on the same socket: a guest of its own, nothing refused.
    anna.say({ kind: 'whereami', pass: passFor('Anna 2'), name: 'Anna' });
    await settled();
    expect(accountOf(anna).login).toBeNull();
    expect(anna.heard.filter((m) => m.kind === 'error')).toEqual([]);
    // Switched back into the account on the same socket: it speaks for that pass, and no other.
    const switched = await ask(anna, {
      kind: 'switch-account',
      pass: passFor('Anna 2'),
      next: passFor('Anna 3'),
      login: number,
      password: KENNWORT,
    });
    expect(switched).toMatchObject({ done: 'switched', account: { login: number } });
    anna.say({ kind: 'whereami', pass: passFor('Anna 3') });
    await settled();
    expect(accountOf(anna).login).toBe(number);
    expect(anna.heard.filter((m) => m.kind === 'error')).toEqual([]);
    anna.say({ kind: 'whereami', pass: passFor('Anna 2') });
    expect(anna.heard.at(-1)).toEqual({ kind: 'error', message: ONE_PASS, of: 'whereami' });
  });
});
