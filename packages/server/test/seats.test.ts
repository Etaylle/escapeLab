import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission } from '@escapelab/core';
import { RoomManager } from '../src/roomManager.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

/** The tutorial, for two. */
const mission: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
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
    const { anna, ben, code } = lobby();
    expect(joinedOf(anna)).toEqual({ kind: 'joined', code });
    expect(joinedOf(ben)).toEqual({ kind: 'joined', code });
    expect(ben.view.you.name).toBe('Ben');
    expect(JSON.stringify(anna.heard)).not.toContain(passFor('Ben').secret);
    expect(JSON.stringify(anna.heard)).not.toContain(passFor('Ben').id);
  });

  it('brings the seat back on a second socket that shows its pass: a tab, a new browser', () => {
    const { server, manager, anna, ben, code } = lobby();
    const tab = server.connect();
    tab.say({ kind: 'resume', code, pass: passFor('Ben') });
    expect(joinedOf(tab)).toEqual({ kind: 'joined', code });
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
    const line = `Gebunden an den Einsatz „${mission.title}" in Raum ${code}.`;
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
