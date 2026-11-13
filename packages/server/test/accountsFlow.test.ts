import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseMission,
  type AccountView,
  type Mission,
  type ServerMessage,
} from '@escapelab/core';
import { AccountDesk, TOO_MANY_NEW } from '../src/accounts.js';
import { RateLimiter, type Front, type Sender } from '../src/rateLimiter.js';
import { RoomManager } from '../src/roomManager.js';
import {
  ACCOUNT_WRITES_PER_SOCKET,
  ACCOUNTS_MADE_PER_MINUTE,
  ONE_PASS,
  serveSockets,
  TOO_MANY_WRITES,
} from '../src/sockets.js';
import { JsonlStore } from '../src/store/jsonl.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';
import { DAY, finished } from './storeContract.js';

/** The tutorial, for two. */
const mission: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);
const catalog = { get: () => mission, default: mission };

/** What a lab limits: the new accounts of an address, the writes of a socket. */
interface Limits {
  accountsMade?: RateLimiter;
  writesPerSocket?: number;
}

/**
 * The server's sockets over a manager of rooms, with the accounts in a store of their own and,
 * where given, limits on the writes to them.
 */
function lab(manager = new RoomManager(), limits: Limits = {}, front: Front = 'none') {
  const server = new FakeServer();
  const store = JsonlStore.open(join(mkdtempSync(join(tmpdir(), 'escapelab-acc-')), 'runs.jsonl'));
  const accounts = new AccountDesk(store);
  serveSockets(server, { catalog, manager, accounts, ...limits, front });
  return { server, manager, store };
}

/** A request from `machine` on the LAN, its X-Forwarded-For naming `claimed` where given. */
const onTheLan = (machine: string, claimed?: string): Sender => ({
  headers: claimed === undefined ? {} : { 'x-forwarded-for': claimed },
  socket: { remoteAddress: machine },
});

/**
 * A request from `client` through Render's proxy, the socket the balancer's: Cloudflare names the
 * client, and appends it to whatever X-Forwarded-For the client sent (`claimed`).
 */
const throughRender = (client: string, claimed = '192.0.2.1'): Sender => ({
  headers: { 'cf-connecting-ip': client, 'x-forwarded-for': `${claimed}, ${client}` },
  socket: { remoteAddress: '10.226.90.65' },
});

/** Every account the socket heard of, in order: none for a deleted one. */
const accounts = (socket: FakeSocket): (AccountView | null)[] =>
  socket.heard.flatMap((m) => (m.kind === 'account' ? [m.account] : []));

/** The account the socket heard of last; throws where it heard of none. */
function accountOf(socket: FakeSocket): AccountView {
  const last = accounts(socket).at(-1);
  if (last === undefined || last === null) {
    throw new Error('this socket heard of no account');
  }
  return last;
}

/** Lets the account work under way come to an end: the stores answer in promises. */
const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** The refusals the socket heard, as their words and the kind each refused. */
const refusals = (socket: FakeSocket) =>
  socket.heard.flatMap((m: ServerMessage) => (m.kind === 'error' ? [[m.message, m.of]] : []));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('an account per crew pass', () => {
  it('makes the account as the device kept it at its first question, finds it after', async () => {
    const { server } = lab();
    const anna = server.connect();
    anna.say({ kind: 'whereami', pass: passFor('Anna'), name: ' Anna ', color: '#a78bfa' });
    await settled();
    expect(anna.heard.map((m) => m.kind)).toEqual(['seated', 'account']);
    const made = accountOf(anna);
    expect(made).toEqual({
      name: 'Anna',
      color: '#a78bfa',
      since: made.since,
      runs: 0,
      achievements: {},
      store: 'run-log',
    });
    // Another tab of the same browser, its kept name changed meanwhile: the account is the record.
    const tab = server.connect();
    tab.say({ kind: 'whereami', pass: passFor('Anna'), name: 'Andere' });
    await settled();
    expect(accountOf(tab)).toEqual(made);
  });

  it('goes by the name its pass sits down under, the seat in its colour where free', async () => {
    const { server } = lab();
    const anna = server.connect();
    anna.say({ kind: 'whereami', pass: passFor('Anna'), name: 'Anna', color: '#a78bfa' });
    anna.say({ kind: 'create-room', name: 'Anna K.', pass: passFor('Anna'), color: '#a78bfa' });
    await settled();
    expect(anna.view.you).toMatchObject({ name: 'Anna K.', color: '#a78bfa' });
    expect(accountOf(anna)).toMatchObject({ name: 'Anna K.', color: '#a78bfa' });
    const ben = server.connect();
    const code = joinedOf(anna).code;
    ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben'), color: '#a78bfa' });
    await settled();
    // Anna wears it already: Ben's seat takes the first colour free, his account keeps his own.
    expect(ben.view.you).toMatchObject({ name: 'Ben', color: '#2dd4bf' });
    expect(accountOf(ben)).toMatchObject({ name: 'Ben', color: '#a78bfa' });
  });

  it('keeps the colour chosen in a lobby with the account, and the name typed', async () => {
    const { server } = lab();
    const anna = server.connect();
    anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna') });
    anna.say({ kind: 'select-color', color: '#60a5fa' });
    await settled();
    expect(accountOf(anna)).toMatchObject({ name: 'Anna', color: '#60a5fa' });
    anna.say({ kind: 'profile', pass: passFor('Anna'), name: '  Anna Berg ' });
    await settled();
    expect(accountOf(anna)).toMatchObject({ name: 'Anna Berg', color: '#60a5fa' });
    // A colour the room refuses — another seat wears it — is none the account takes.
    const ben = server.connect();
    ben.say({ kind: 'join-room', code: joinedOf(anna).code, name: 'Ben', pass: passFor('Ben') });
    ben.say({ kind: 'select-color', color: '#60a5fa' });
    await settled();
    expect(refusals(ben)).toEqual([['Die Farbe trägt schon Anna.', 'select-color']]);
    expect(accounts(ben).map((account) => account?.color)).toEqual([null]);
  });

  it('starts the account of a pass back on a seat before it had one with the seat', async () => {
    // The seat is taken where no account is kept, and come back to where accounts are.
    const manager = new RoomManager();
    const before = new FakeServer();
    serveSockets(before, { catalog, manager });
    const seat = before.connect();
    seat.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna'), color: '#fbbf24' });
    const { server } = lab(manager);
    const back = server.connect();
    back.say({ kind: 'resume', code: joinedOf(seat).code, pass: passFor('Anna') });
    await settled();
    expect(joinedOf(back).code).toBe(joinedOf(seat).code);
    expect(accountOf(back)).toMatchObject({ name: 'Anna', color: '#fbbf24' });
  });

  it('makes no account for a seat refused, nor for a pass with another’s secret', async () => {
    const { server } = lab();
    const anna = server.connect();
    anna.say({ kind: 'join-room', code: 'ZZZZ', name: 'Anna', pass: passFor('Anna') });
    await settled();
    expect(accounts(anna)).toEqual([]);
    anna.say({ kind: 'whereami', pass: passFor('Anna') });
    await settled();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const forged = { ...passFor('Anna'), secret: passFor('Mallory').secret };
    const mallory = server.connect();
    mallory.say({ kind: 'whereami', pass: forged });
    mallory.say({ kind: 'profile', pass: forged, name: 'Mallory' });
    await settled();
    expect(accounts(mallory)).toEqual([]);
    expect(refusals(mallory)).toEqual([['Dieser Ausweis gilt hier nicht.', 'profile']]);
    expect(logged).toHaveBeenCalledWith(
      '[escapelab] an account not told its pass: Dieser Ausweis gilt hier nicht.',
    );
  });

  it('deletes the account at its pass’s word, a new one at the next question', async () => {
    const { server } = lab();
    const anna = server.connect();
    anna.say({ kind: 'whereami', pass: passFor('Anna'), name: 'Anna', color: '#a78bfa' });
    await settled();
    const gone = accountOf(anna);
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const forged = { ...passFor('Anna'), secret: passFor('Mallory').secret };
    anna.say({ kind: 'delete-account', pass: forged });
    await settled();
    expect(refusals(anna)).toEqual([['Dieser Ausweis gilt hier nicht.', 'delete-account']]);
    anna.say({ kind: 'delete-account', pass: passFor('Anna') });
    await settled();
    expect(accounts(anna).at(-1)).toBeNull();
    expect(said).toHaveBeenCalledWith('[escapelab] an account was deleted, as its pass asked');
    // Deleting it again finds none, and says so the same.
    anna.say({ kind: 'delete-account', pass: passFor('Anna') });
    await settled();
    expect(accounts(anna).at(-1)).toBeNull();
    anna.say({ kind: 'whereami', pass: passFor('Anna') });
    await settled();
    expect(accountOf(anna)).toMatchObject({ name: '', color: null, runs: 0 });
    expect(accountOf(anna).since).toBeGreaterThanOrEqual(gone.since);
  });

  it('answers a question about an account with a refusal where the server keeps none', async () => {
    const server = new FakeServer();
    serveSockets(server, { catalog, manager: new RoomManager() });
    const anna = server.connect();
    anna.say({ kind: 'whereami', pass: passFor('Anna') });
    anna.say({ kind: 'delete-account', pass: passFor('Anna') });
    anna.say({ kind: 'my-runs', pass: passFor('Anna') });
    await settled();
    expect(anna.heard.map((m) => m.kind)).toEqual(['seated', 'error', 'error']);
    expect(refusals(anna)).toEqual([
      ['Konten führt dieser Server nicht.', 'delete-account'],
      ['Konten führt dieser Server nicht.', 'my-runs'],
    ]);
  });

  it('lists the runs an account played, the newest first; none without one', async () => {
    const { server, store } = lab();
    const anna = server.connect();
    anna.say({ kind: 'my-runs', pass: passFor('Anna') });
    await settled();
    expect(anna.heard.at(-1)).toEqual({ kind: 'my-runs', runs: [], total: 0 });
    anna.say({ kind: 'whereami', pass: passFor('Anna'), name: 'Anna' });
    await settled();
    await store.appendRun(finished({ at: DAY, outcome: 'lost:time' }, ['Anna', null]));
    await store.appendRun(finished({ at: DAY + 1, crew: ['Cleo', 'Anna'] }, [null, 'Anna']));
    anna.say({ kind: 'my-runs', pass: passFor('Anna') });
    await settled();
    const answer = anna.heard.at(-1);
    expect(answer?.kind === 'my-runs' ? answer.total : null).toBe(2);
    const listed = answer?.kind === 'my-runs' ? answer.runs : [];
    expect(listed.map((run) => [run.finishedAt, run.seat])).toEqual([
      [DAY + 1, 1],
      [DAY, 0],
    ]);
    // A pass shown with another's secret hears of no runs.
    const forged = { ...passFor('Anna'), secret: passFor('Mallory').secret };
    anna.say({ kind: 'my-runs', pass: forged });
    await settled();
    expect(refusals(anna)).toEqual([['Dieser Ausweis gilt hier nicht.', 'my-runs']]);
  });
});

describe('the accounts’ door', () => {
  it('lets a socket speak for one pass: another is refused there, welcome on its own', async () => {
    const { server } = lab();
    const anna = server.connect();
    anna.say({ kind: 'whereami', pass: passFor('Anna') });
    anna.say({ kind: 'whereami', pass: passFor('Ben') });
    anna.say({ kind: 'profile', pass: passFor('Ben'), name: 'Ben' });
    await settled();
    expect(refusals(anna)).toEqual([
      [ONE_PASS, 'whereami'],
      [ONE_PASS, 'profile'],
    ]);
    expect(accounts(anna)).toHaveLength(1);
    const ben = server.connect();
    ben.say({ kind: 'whereami', pass: passFor('Ben') });
    await settled();
    expect([refusals(ben), accounts(ben).length]).toEqual([[], 1]);
  });

  it('makes so many new accounts an address a minute; a known one always arrives', async () => {
    const limits = { accountsMade: new RateLimiter(2, 60_000) };
    const { server } = lab(new RoomManager(), limits, 'render');
    const arrive = (name: string, client = '203.0.113.7'): FakeSocket => {
      const socket = server.connect(throughRender(client));
      socket.say({ kind: 'whereami', pass: passFor(name), name });
      return socket;
    };
    // Anna's page, loaded anew twice: her account is made once, then only visited.
    const annas = [arrive('Anna')];
    await settled();
    annas.push(arrive('Anna'), arrive('Anna'));
    await settled();
    const ben = arrive('Ben');
    await settled();
    const cleo = arrive('Cleo');
    const dan = arrive('Dan', '198.51.100.4');
    await settled();
    expect([...annas, ben, dan].map((socket) => accountOf(socket).name)).toEqual([
      'Anna',
      'Anna',
      'Anna',
      'Ben',
      'Dan',
    ]);
    // Cleo's seat is answered, her account waits; asked for by its name, it is refused.
    expect(cleo.heard.map((m) => m.kind)).toEqual(['seated']);
    cleo.say({ kind: 'profile', pass: passFor('Cleo'), name: 'Cleo' });
    await settled();
    expect(refusals(cleo)).toEqual([[TOO_MANY_NEW, 'profile']]);
  });

  it('bounds the writes of a socket, and no other socket’s behind the same address', async () => {
    const { server } = lab(new RoomManager(), { writesPerSocket: 3 });
    const anna = server.connect(onTheLan('192.168.1.20'));
    anna.say({ kind: 'whereami', pass: passFor('Anna'), name: 'Anna' });
    anna.say({ kind: 'profile', pass: passFor('Anna'), name: 'Anna K.' });
    anna.say({ kind: 'profile', pass: passFor('Anna'), name: 'Anna Berg' });
    anna.say({ kind: 'profile', pass: passFor('Anna'), name: 'Anna Bergmann' });
    // Reading the runs writes nothing.
    anna.say({ kind: 'my-runs', pass: passFor('Anna') });
    const ben = server.connect(onTheLan('192.168.1.20'));
    ben.say({ kind: 'whereami', pass: passFor('Ben'), name: 'Ben' });
    await settled();
    expect(refusals(anna)).toEqual([[TOO_MANY_WRITES, 'profile']]);
    expect(accountOf(anna)).toMatchObject({ name: 'Anna Berg' });
    expect(anna.heard.at(-1)).toMatchObject({ kind: 'my-runs', total: 0 });
    expect(accountOf(ben)).toMatchObject({ name: 'Ben' });
  });

  it('lets a lecture behind one address in: thirty new students, five writes each', async () => {
    const limits = {
      accountsMade: new RateLimiter(ACCOUNTS_MADE_PER_MINUTE, 60_000),
      writesPerSocket: ACCOUNT_WRITES_PER_SOCKET,
    };
    const { server } = lab(new RoomManager(), limits, 'render');
    const students = Array.from({ length: 30 }, (_, i) => {
      const name = `Student ${i + 1}`;
      const socket = server.connect(throughRender('203.0.113.7'));
      socket.say({ kind: 'whereami', pass: passFor(name), name });
      socket.say({ kind: 'profile', pass: passFor(name), name: `${name}a` });
      socket.say({ kind: 'profile', pass: passFor(name), name: `${name}b` });
      socket.say({ kind: 'whereami', pass: passFor(name) });
      socket.say({ kind: 'profile', pass: passFor(name), name });
      return { name, socket };
    });
    await settled();
    expect(students.flatMap(({ socket }) => refusals(socket))).toEqual([]);
    expect(students.every(({ name, socket }) => accountOf(socket).name === name)).toBe(true);
  });

  it('counts a machine by its own address, whatever its headers claim', async () => {
    const { server } = lab(new RoomManager(), { accountsMade: new RateLimiter(2, 60_000) });
    // One machine on the LAN, five sockets, each claiming an address of its own.
    const names = ['Anna', 'Ben', 'Cleo', 'Dan', 'Eva'];
    const sockets = names.map((name, i) => {
      const socket = server.connect(onTheLan('192.168.1.20', `192.0.2.${i + 1}`));
      socket.say({ kind: 'whereami', pass: passFor(name) });
      return socket;
    });
    // A classmate whose address the machine claimed writes on all the same.
    const finn = server.connect(onTheLan('192.0.2.1'));
    finn.say({ kind: 'whereami', pass: passFor('Finn') });
    await settled();
    expect(sockets.map((socket) => accounts(socket).length)).toEqual([1, 1, 0, 0, 0]);
    expect(accounts(finn)).toHaveLength(1);
  });
});
