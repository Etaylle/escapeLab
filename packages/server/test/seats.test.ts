import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseMission,
  TAKEOVER_WAIT_MS,
  type Mission,
  type PlayerView,
  type ServerMessage,
} from '@escapelab/core';
import { ASK_AGAIN_MS, Room } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';
import { SeatBook } from '../src/seats.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

/** The tutorial, for two. */
const mission: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);

/** Blackout, for two or three. */
const blackout: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

/** The server's sockets, a room Anna opened on hers and Ben joined on his, in its lobby. */
function lobby() {
  const server = new FakeServer();
  const manager = new RoomManager();
  serveSockets(server, { catalog: { get: () => mission, default: mission }, manager });
  const anna = server.connect();
  anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna') });
  const { code } = joinedOf(anna);
  const ben = server.connect();
  ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben') });
  return { server, manager, anna, ben, code };
}

describe('the crew pass on the line', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('seats whoever shows a pass on it in a room, by the pass and nothing else', () => {
    const { manager, anna, ben, code } = lobby();
    expect(joinedOf(anna)).toEqual({ kind: 'joined', code, instanceId: manager.instanceId });
    expect(joinedOf(ben)).toEqual({ kind: 'joined', code, instanceId: manager.instanceId });
    expect(ben.view.you.name).toBe('Ben');
    expect(JSON.stringify(anna.heard)).not.toContain(passFor('Ben').secret);
    expect(JSON.stringify(anna.heard)).not.toContain(passFor('Ben').id);
  });

  it('brings the seat back on a second socket that shows its pass: a tab, a new browser', () => {
    const { server, manager, anna, ben, code } = lobby();
    const tab = server.connect();
    tab.say({ kind: 'resume', code, pass: passFor('Ben') });
    expect(joinedOf(tab)).toEqual({ kind: 'joined', code, instanceId: manager.instanceId });
    expect(tab.view.you).toMatchObject({ id: ben.view.you.id, name: 'Ben' });
    expect(anna.view.players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    // The first socket hears that the seat went to the second, and from then on takes nothing.
    expect(ben.heard.at(-1)).toEqual({
      kind: 'left',
      code,
      message: 'Dieser Platz spielt jetzt in einem anderen Fenster.',
    });
    const heard = ben.heard.length;
    ben.say({ kind: 'set-ready', ready: true });
    expect(ben.heard.at(-1)).toMatchObject({ kind: 'error', of: 'set-ready' });
    expect(anna.view.players.find((p) => p.name === 'Ben')?.ready).toBe(false);
    ben.say({ kind: 'pos', run: 1, x: 1, y: 1, facing: 0, moving: false, t: 1 });
    expect(ben.heard).toHaveLength(heard + 1);
    tab.say({ kind: 'set-ready', ready: true });
    expect(anna.view.players.find((p) => p.name === 'Ben')?.ready).toBe(true);
    // The first socket closing lets go of nothing: the seat plays on the second.
    ben.close();
    expect(anna.view.players.find((p) => p.name === 'Ben')?.connected).toBe(true);
    manager.get(code).dispose();
  });

  it('sits a pass that already holds a seat here down on it again, not on a second', () => {
    const { server, manager, anna, code } = lobby();
    const again = server.connect();
    again.say({ kind: 'join-room', code, name: 'Benjamin', pass: passFor('Ben') });
    expect(again.view.you.name).toBe('Ben');
    expect(anna.view.players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    manager.get(code).dispose();
  });

  it('keeps the resume of the socket that sits there already to itself: it is told nothing', () => {
    const { manager, ben, code } = lobby();
    ben.say({ kind: 'resume', code, pass: passFor('Ben') });
    expect(ben.heard.filter((m) => m.kind === 'left')).toEqual([]);
    expect(ben.view.you.name).toBe('Ben');
    manager.get(code).dispose();
  });

  it('takes no seat from a pass for one made up after its id: refused, the seat kept', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // Blackout's lobby has room for a third.
    const room = new Room('TEST', blackout);
    room.join('Anna', passFor('Anna'));
    const ben = room.join('Ben', passFor('Ben'));
    const forged = { id: passFor('Ben').id, secret: passFor('Mallory').secret };
    expect(() => room.join('Mallory', forged)).toThrow('Dieser Ausweis gilt hier nicht.');
    expect(room.summary().players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    expect(room.seatOf(passFor('Ben'))).toBe(ben.playerId);
    room.dispose();
    vi.restoreAllMocks();
  });

  it('binds no seat to a pass made up after another’s id, and lets that one keep its own', () => {
    const book = new SeatBook();
    book.bind('p-ben', passFor('Ben'));
    const forged = { id: passFor('Ben').id, secret: passFor('Mallory').secret };
    expect(() => book.bind('p-mallory', forged)).toThrow('Dieser Ausweis gilt hier nicht.');
    expect(book.seatOf(passFor('Ben'))).toBe('p-ben');
    expect(book.seatOf(forged)).toBeNull();
  });

  it('turns away a pass that holds no seat there, or shows the wrong secret', () => {
    const { server, manager, code } = lobby();
    const stranger = server.connect();
    stranger.say({ kind: 'resume', code, pass: passFor('Mallory') });
    expect(stranger.heard).toEqual([
      {
        kind: 'error',
        of: 'resume',
        message: 'Wiederverbinden fehlgeschlagen — Raum neu beitreten.',
      },
    ]);
    const forger = server.connect();
    const forged = { ...passFor('Ben'), secret: passFor('Mallory').secret };
    forger.say({ kind: 'resume', code, pass: forged });
    expect(forger.heard.at(-1)).toMatchObject({ kind: 'error', of: 'resume' });
    manager.get(code).dispose();
  });
});

/** The lobby's run started: Ben confirmed, Anna pressed start. */
function running() {
  const room = lobby();
  room.ben.say({ kind: 'set-ready', ready: true });
  room.anna.say({ kind: 'start-mission' });
  expect(room.anna.view.phase).toBe('playing');
  return room;
}

/** What `socket` was last told about where Ben's pass sits. */
function whereIsBen(socket: FakeSocket) {
  socket.say({ kind: 'whereami', pass: passFor('Ben') });
  const last = socket.heard.at(-1);
  if (last?.kind !== 'seated') {
    throw new Error(`whereami answered ${JSON.stringify(last)}`);
  }
  return last.seat;
}

describe('where a pass sits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is nowhere for a pass that sits nowhere, or shows the wrong secret', () => {
    const { server, manager, code } = lobby();
    const page = server.connect();
    page.say({ kind: 'whereami', pass: passFor('Mallory') });
    expect(page.heard).toEqual([{ kind: 'seated', seat: null }]);
    const forged = { ...passFor('Ben'), secret: passFor('Mallory').secret };
    page.say({ kind: 'whereami', pass: forged });
    expect(page.heard.at(-1)).toEqual({ kind: 'seated', seat: null });
    manager.get(code).dispose();
  });

  it('is the lobby for a pass seated there: its mission and its crew, no clock yet', () => {
    const { server, manager, code } = lobby();
    expect(whereIsBen(server.connect())).toEqual({
      code,
      missionTitle: mission.title,
      phase: 'lobby',
      paused: false,
      crew: ['Anna', 'Ben'],
      leftMs: null,
    });
    manager.get(code).dispose();
  });

  it('is the run on, with its clock as it stands, paused or not', () => {
    const { server, manager, ben, code } = running();
    vi.advanceTimersByTime(20_000);
    const page = server.connect();
    expect(whereIsBen(page)).toMatchObject({
      phase: 'playing',
      paused: false,
      leftMs: (mission.timeLimitSec - 20) * 1000,
    });
    ben.close();
    vi.advanceTimersByTime(30_000);
    expect(whereIsBen(page)).toMatchObject({
      phase: 'playing',
      paused: true,
      leftMs: (mission.timeLimitSec - 20) * 1000,
    });
    manager.get(code).dispose();
  });

  it('binds nobody once the run is over', () => {
    const { server, manager, code } = running();
    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 100);
    expect(manager.get(code).phase).toBe('lost');
    expect(whereIsBen(server.connect())).toBeNull();
    manager.get(code).dispose();
  });
});

describe('a pass bound to a run on', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens no room and joins no other, a line naming the run', () => {
    const { server, manager, code } = running();
    const other = server.connect();
    other.say({ kind: 'create-room', name: 'Cem', pass: passFor('Cem') });
    const elsewhere = joinedOf(other).code;
    const tab = server.connect();
    const line = `Gebunden an den Einsatz „${mission.title}“ in Raum ${code}.`;
    tab.say({ kind: 'create-room', name: 'Ben', pass: passFor('Ben') });
    expect(tab.heard).toEqual([{ kind: 'error', of: 'create-room', message: line }]);
    tab.say({ kind: 'join-room', code: elsewhere, name: 'Ben', pass: passFor('Ben') });
    expect(tab.heard.at(-1)).toEqual({ kind: 'error', of: 'join-room', message: line });
    expect(manager.list().map((room) => room.code).sort()).toEqual([code, elsewhere].sort());
    expect(manager.get(elsewhere).summary().players.map((p) => p.name)).toEqual(['Cem']);
    manager.get(code).dispose();
  });

  it('gives a seat in a lobby up as it sits down elsewhere', () => {
    const { server, manager, anna, code } = lobby();
    const other = server.connect();
    other.say({ kind: 'create-room', name: 'Cem', pass: passFor('Cem') });
    const elsewhere = joinedOf(other).code;
    const tab = server.connect();
    tab.say({ kind: 'join-room', code: elsewhere, name: 'Ben', pass: passFor('Ben') });
    expect(anna.view.players.map((p) => p.name)).toEqual(['Anna']);
    expect(other.view.players.map((p) => p.name)).toEqual(['Cem', 'Ben']);
    expect(whereIsBen(server.connect())?.code).toBe(elsewhere);
    manager.get(code).dispose();
  });

  it('keeps its seat in a lobby where the join into another room is refused', () => {
    const { server, manager, anna, ben, code } = lobby();
    const dora = server.connect();
    dora.say({ kind: 'create-room', name: 'Dora', pass: passFor('Dora') });
    const full = joinedOf(dora).code;
    server.connect().say({ kind: 'join-room', code: full, name: 'Emil', pass: passFor('Emil') });
    ben.say({ kind: 'join-room', code: full, name: 'Ben', pass: passFor('Ben') });
    expect(ben.heard.at(-1)).toMatchObject({ kind: 'error', of: 'join-room' });
    expect(anna.view.players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    expect(whereIsBen(ben)?.code).toBe(code);
    manager.get(code).dispose();
  });
});

describe('a seat given up', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('from the join screen of another tab: freed, the pass unbound, both sockets told', () => {
    const { server, manager, anna, ben, code } = lobby();
    const tab = server.connect();
    tab.say({ kind: 'abandon', code, pass: passFor('Ben') });
    expect(tab.heard).toEqual([{ kind: 'left', code, message: null }]);
    expect(ben.heard.at(-1)).toEqual({ kind: 'left', code, message: null });
    expect(anna.view.players.map((p) => p.name)).toEqual(['Anna']);
    expect(whereIsBen(tab)).toBeNull();
    tab.say({ kind: 'resume', code, pass: passFor('Ben') });
    expect(tab.heard.at(-1)).toMatchObject({ kind: 'error', of: 'resume' });
    ben.say({ kind: 'set-ready', ready: true });
    expect(ben.heard.at(-1)).toMatchObject({ kind: 'error', of: 'set-ready' });
    manager.get(code).dispose();
  });

  it('from a socket the seat went from: it is told, and so is the tab it plays on', () => {
    const { server, manager, anna, ben, code } = lobby();
    const tab = server.connect();
    tab.say({ kind: 'resume', code, pass: passFor('Ben') });
    const before = ben.heard.length;
    ben.say({ kind: 'abandon', code, pass: passFor('Ben') });
    expect(ben.heard.slice(before)).toEqual([{ kind: 'left', code, message: null }]);
    expect(tab.heard.at(-1)).toEqual({ kind: 'left', code, message: null });
    expect(anna.view.players.map((p) => p.name)).toEqual(['Anna']);
    manager.get(code).dispose();
  });

  it('from its own socket: told once, the socket in no room from then on', () => {
    const { manager, anna, ben, code } = lobby();
    ben.say({ kind: 'abandon', code, pass: passFor('Ben') });
    expect(ben.heard.filter((m) => m.kind === 'left')).toEqual([
      { kind: 'left', code, message: null },
    ]);
    ben.say({ kind: 'set-ready', ready: true });
    expect(ben.heard.at(-1)).toEqual({
      kind: 'error',
      of: 'set-ready',
      message: 'Noch in keinem Raum.',
    });
    ben.close();
    expect(anna.view.players.map((p) => p.name)).toEqual(['Anna']);
    manager.get(code).dispose();
  });

  it('from another device in a run on: the crew below its size, the run ends for everyone', () => {
    const { server, manager, anna, ben, code } = running();
    const phone = server.connect();
    phone.say({ kind: 'whereami', pass: passFor('Ben') });
    phone.say({ kind: 'abandon', code, pass: passFor('Ben') });
    expect(phone.heard.at(-1)).toEqual({ kind: 'left', code, message: null });
    expect(ben.heard.at(-1)).toEqual({ kind: 'left', code, message: null });
    expect(anna.view).toMatchObject({ phase: 'lost', calledOff: 'Ben hat den Einsatz verlassen.' });
    expect(whereIsBen(phone)).toBeNull();
    manager.get(code).dispose();
  });

  it('is refused for a pass with no seat in the room', () => {
    const { server, manager, code } = lobby();
    const page = server.connect();
    page.say({ kind: 'abandon', code, pass: passFor('Mallory') });
    expect(page.heard).toEqual([
      { kind: 'error', of: 'abandon', message: 'Dieser Ausweis hat in diesem Raum keinen Platz.' },
    ]);
    manager.get(code).dispose();
  });
});

describe('a seat taken over by its name (Jackbox), let in by the crew', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The run with Ben's line dropped, and a phone of Ben's that never held his pass. */
  function benAway() {
    const room = running();
    room.ben.close();
    expect(room.anna.view.pausedFor?.map((away) => away.name)).toEqual(['Ben']);
    return { ...room, phone: room.server.connect(), seat: room.ben.view.you.id };
  }

  /** The phone asks for Ben's seat by the room's code and his name. */
  const ask = (phone: FakeSocket, code: string): void =>
    phone.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Bens Telefon') });

  it('asks the crew on the line; let in, the phone resumes the seat on its pass', () => {
    const { manager, anna, phone, seat, code } = benAway();
    ask(phone, code);
    const until = Date.now() + TAKEOVER_WAIT_MS;
    expect(phone.heard.at(-1)).toEqual({ kind: 'takeover-pending', code, name: 'Ben', until });
    expect(anna.view.takeovers).toEqual([{ id: seat, name: 'Ben', until }]);
    anna.say({ kind: 'takeover-answer', seat, allow: true });
    expect(phone.heard.at(-1)).toEqual({ kind: 'takeover-allowed', code });
    expect(anna.view).not.toHaveProperty('takeovers');
    phone.say({ kind: 'resume', code, pass: passFor('Bens Telefon') });
    expect(joinedOf(phone)).toEqual({ kind: 'joined', code, instanceId: manager.instanceId });
    expect(phone.view.you).toMatchObject({ id: seat, name: 'Ben' });
    expect(anna.view.pausedFor).toBeNull();
    expect(whereIsBen(phone)).toBeNull();
    manager.get(code).dispose();
  });

  it('refuses the old pass once the phone is in, saying the seat went to another device', () => {
    const { server, manager, anna, phone, seat, code } = benAway();
    ask(phone, code);
    anna.say({ kind: 'takeover-answer', seat, allow: true });
    const laptop = server.connect();
    laptop.say({ kind: 'resume', code, pass: passFor('Ben') });
    expect(laptop.heard).toEqual([
      {
        kind: 'error',
        of: 'resume',
        message: 'Der Platz wurde auf einem anderen Gerät übernommen.',
      },
    ]);
    manager.get(code).dispose();
  });

  it('turns the phone away when the crew refuses it, or answers nothing within 30 s', () => {
    const { server, manager, anna, phone, seat, code } = benAway();
    const refused = {
      kind: 'error',
      of: 'join-room',
      message: 'Die Crew hat die Übernahme nicht bestätigt.',
    };
    ask(phone, code);
    anna.say({ kind: 'takeover-answer', seat, allow: false });
    expect(phone.heard.at(-1)).toEqual(refused);
    expect(anna.view).not.toHaveProperty('takeovers');
    vi.advanceTimersByTime(ASK_AGAIN_MS);
    ask(phone, code);
    vi.advanceTimersByTime(TAKEOVER_WAIT_MS - 1);
    expect(phone.heard.at(-1)).toMatchObject({ kind: 'takeover-pending' });
    vi.advanceTimersByTime(1);
    expect(phone.heard.at(-1)).toEqual(refused);
    // Ben's own pass still holds the seat.
    const laptop = server.connect();
    laptop.say({ kind: 'resume', code, pass: passFor('Ben') });
    expect(joinedOf(laptop)).toEqual({ kind: 'joined', code, instanceId: manager.instanceId });
    manager.get(code).dispose();
  });

  it('turns the phone away where Ben is back first, and forgets a phone that went away', () => {
    const { server, manager, anna, phone, code } = benAway();
    ask(phone, code);
    server.connect().say({ kind: 'resume', code, pass: passFor('Ben') });
    expect(phone.heard.at(-1)).toEqual({
      kind: 'error',
      of: 'join-room',
      message: 'Ben ist wieder verbunden.',
    });
    const again = benAway();
    ask(again.phone, again.code);
    expect(again.anna.view.takeovers).toHaveLength(1);
    again.phone.close();
    expect(again.anna.view).not.toHaveProperty('takeovers');
    expect(anna.view).not.toHaveProperty('takeovers');
    manager.get(code).dispose();
    again.manager.get(again.code).dispose();
  });

  it('gives the audience no say: its answer is refused, the ask still waits for the crew', () => {
    const { server, manager, anna, phone, seat, code } = benAway();
    ask(phone, code);
    const audience = server.connect();
    audience.say({ kind: 'spectate', code });
    audience.say({ kind: 'takeover-answer', seat, allow: true });
    expect(audience.heard.at(-1)).toEqual({
      kind: 'error',
      of: 'takeover-answer',
      message: 'Über eine Übernahme entscheidet nur, wer im Einsatz verbunden ist.',
    });
    expect(phone.heard.at(-1)).toMatchObject({ kind: 'takeover-pending' });
    expect(anna.view.takeovers).toHaveLength(1);
    manager.get(code).dispose();
  });

  it('keeps an ask and its clock through the wait the run takes up again', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const room = new Room('TEST', blackout);
    const views: Record<string, PlayerView> = {};
    const seats = ['Anna', 'Ben', 'Cem'].map((name) => {
      const { playerId } = room.join(name, passFor(name));
      const detach = room.attach(playerId, (msg) => {
        if (msg.kind === 'view') {
          views[name] = msg.view;
        }
      });
      return { playerId, detach };
    });
    const [anna, ben, cem] = seats;
    room.setReady(ben?.playerId ?? '', true);
    room.setReady(cem?.playerId ?? '', true);
    room.act(anna?.playerId ?? '', { kind: 'start-mission' });
    cem?.detach();
    vi.advanceTimersByTime(61_000);
    room.act(anna?.playerId ?? '', { kind: 'continue-without', absentId: cem?.playerId ?? '' });
    const told: ServerMessage[] = [];
    room.claim('Cem', passFor('Cems Telefon'), (msg) => told.push(msg));
    // Ben gives up: Anna alone on the line, the run waits for Cem again.
    room.abandon(passFor('Ben'));
    expect(views['Anna']?.pausedFor?.map((away) => away.name)).toEqual(['Cem']);
    expect(views['Anna']?.takeovers?.map((ask) => ask.name)).toEqual(['Cem']);
    expect(() => room.claim('Cem', passFor('Zweites Telefon'), () => undefined)).toThrow(
      'Für Cem wartet schon eine Übernahme auf Antwort.',
    );
    vi.advanceTimersByTime(TAKEOVER_WAIT_MS);
    expect(told.at(-1)).toEqual({
      kind: 'error',
      of: 'join-room',
      message: 'Die Crew hat die Übernahme nicht bestätigt.',
    });
    expect(views['Anna']).not.toHaveProperty('takeovers');
    room.dispose();
  });

  it('lets a device turned away ask for that seat again a minute on only, quietly', () => {
    const { server, manager, anna, phone, seat, code } = benAway();
    ask(phone, code);
    anna.say({ kind: 'takeover-answer', seat, allow: false });
    ask(phone, code);
    expect(phone.heard.at(-1)).toEqual({
      kind: 'error',
      of: 'join-room',
      message: 'Für Ben geht eine neue Anfrage erst in 60 s.',
    });
    expect(anna.view).not.toHaveProperty('takeovers');
    // It is the pass that waits: another device may ask meanwhile.
    const tablet = server.connect();
    tablet.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Bens Tablet') });
    expect(tablet.heard.at(-1)).toMatchObject({ kind: 'takeover-pending' });
    anna.say({ kind: 'takeover-answer', seat, allow: false });
    vi.advanceTimersByTime(ASK_AGAIN_MS);
    ask(phone, code);
    expect(phone.heard.at(-1)).toMatchObject({ kind: 'takeover-pending' });
    manager.get(code).dispose();
  });

  it('makes a device wait a minute after its ask went unanswered as well', () => {
    const { manager, anna, phone, code } = benAway();
    ask(phone, code);
    vi.advanceTimersByTime(TAKEOVER_WAIT_MS);
    ask(phone, code);
    expect(phone.heard.at(-1)).toMatchObject({
      kind: 'error',
      message: 'Für Ben geht eine neue Anfrage erst in 60 s.',
    });
    expect(anna.view).not.toHaveProperty('takeovers');
    manager.get(code).dispose();
  });

  it('refuses the name of a seat still on the line, and an ask nobody could answer', () => {
    const { server, manager, anna, ben, code } = running();
    const phone = server.connect();
    phone.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Bens Telefon') });
    expect(phone.heard).toEqual([
      { kind: 'error', of: 'join-room', message: 'Ben ist noch verbunden.' },
    ]);
    anna.close();
    ben.close();
    phone.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Bens Telefon') });
    expect(phone.heard.at(-1)).toEqual({
      kind: 'error',
      of: 'join-room',
      message: 'Gerade ist niemand verbunden, der die Übernahme bestätigen könnte.',
    });
    manager.get(code).dispose();
  });

  it('keeps every other join into a run refused, naming the way to take a seat over', () => {
    const { manager, phone, code } = benAway();
    for (const name of ['Cem', 'ben', 'Ben ']) {
      phone.say({ kind: 'join-room', code, name, pass: passFor('Cem') });
      expect(phone.heard.at(-1)).toEqual({
        kind: 'error',
        of: 'join-room',
        message:
          'Die Mission läuft bereits — Beitritt ist nur in der Lobby möglich. Ein getrennter ' +
          'Platz lässt sich mit seinem Namen übernehmen.',
      });
    }
    manager.get(code).dispose();
  });
});
