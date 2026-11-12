import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_WAIT_MS, TAKEOVER_WAIT_MS } from '@escapelab/core';
import { HEARTBEAT_MS, SILENT_MS, startHeartbeat } from '../src/heartbeat.js';
import { MissionCatalog } from '../src/missions.js';
import { RoomManager } from '../src/roomManager.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

/** The shipped missions: the Systemcheck for two, Blackout for two or three. */
const shipped = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));

/**
 * The server as index.ts wires it — the sockets served, the heartbeat beating, each socket it
 * cuts logged — and what it says on the console, listened to.
 */
function server() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const line = new FakeServer();
  const manager = new RoomManager();
  const { cut } = serveSockets(line, { catalog: shipped, manager });
  const stop = startHeartbeat(line, manager.instanceId, HEARTBEAT_MS, cut);
  const lines = (): string[] => log.mock.calls.map(([said]) => String(said));
  return { line, manager, stop, lines };
}

/** `name` on a socket of their own: opening a room of `missionId`, or joining the room `code`. */
function sitDown(line: FakeServer, name: string, to: { code: string } | { missionId: string }) {
  const socket = line.connect();
  const pass = passFor(name);
  socket.say(
    'code' in to
      ? { kind: 'join-room', code: to.code, name, pass }
      : { kind: 'create-room', name, pass, missionId: to.missionId },
  );
  return socket;
}

/** Anna's room of `missionId` with Ben in it, and Cem where `three`; the run started where `go`. */
function crew(line: FakeServer, missionId: string, { three = false, go = true } = {}) {
  const anna = sitDown(line, 'Anna', { missionId });
  const { code } = joinedOf(anna);
  const ben = sitDown(line, 'Ben', { code });
  const cem = three ? sitDown(line, 'Cem', { code }) : null;
  if (go) {
    for (const socket of [ben, cem]) {
      socket?.say({ kind: 'set-ready', ready: true });
    }
    anna.say({ kind: 'start-mission' });
    expect(anna.view.phase).toBe('playing');
  }
  return { code, anna, ben, cem };
}

/** The id of the player named `name`, as `socket`'s view has them. */
function idOf(socket: FakeSocket, name: string): string {
  const player = socket.view.players.find((p) => p.name === name);
  if (player === undefined) {
    throw new Error(`no ${name} in this view`);
  }
  return player.id;
}

/** The fake clock for every test, and the console's own log back after it. */
function onTheClock(): void {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
}

describe('the server’s log of seats, a line an event with its room and name', () => {
  onTheClock();

  it('names every seat as it joins its room', () => {
    const { line, manager, stop, lines } = server();
    const { code } = crew(line, 'systemcheck', { go: false });
    expect(lines()).toEqual([
      `[escapelab] room ${code}: Anna joined`,
      `[escapelab] room ${code}: Ben joined`,
    ]);
    manager.get(code).dispose();
    stop();
  });

  it('says a line closed, and how long it was away once the seat is back on another', () => {
    const { line, manager, stop, lines } = server();
    const { code, ben } = crew(line, 'systemcheck');
    ben.close();
    vi.advanceTimersByTime(12_300);
    const back = line.connect();
    back.say({ kind: 'resume', code, pass: passFor('Ben') });
    // A second tab of his while the first is on the line: no gap to tell.
    line.connect().say({ kind: 'resume', code, pass: passFor('Ben') });
    expect(lines().slice(-3)).toEqual([
      `[escapelab] room ${code}: Ben's line closed`,
      `[escapelab] room ${code}: Ben resumed, 12.3 s after its line closed`,
      `[escapelab] room ${code}: Ben resumed, its old line still open`,
    ]);
    manager.get(code).dispose();
    stop();
  });

  it('says which socket the heartbeat cut and why, then that its line closed', () => {
    const { line, manager, stop, lines } = server();
    const { code, anna, ben } = crew(line, 'systemcheck');
    // A socket in no room is cut as well, and goes unnamed. Both pages are held offline.
    for (const page of [line.connect(), ben]) {
      page.asking = false;
      page.listening = false;
    }
    vi.advanceTimersByTime(SILENT_MS);
    anna.answering = false;
    vi.advanceTimersByTime(3 * HEARTBEAT_MS);
    expect(lines().slice(2)).toEqual([
      `[escapelab] room ${code}: Ben cut by the heartbeat, nothing heard for 20 s`,
      `[escapelab] room ${code}: Ben's line closed`,
      `[escapelab] room ${code}: Anna cut by the heartbeat, 2 pings unanswered`,
      `[escapelab] room ${code}: Anna's line closed`,
    ]);
    manager.get(code).dispose();
    stop();
  });

  it('says who went on without whom', () => {
    const { line, manager, stop, lines } = server();
    const { code, anna, cem } = crew(line, 'blackout', { three: true });
    cem?.close();
    vi.advanceTimersByTime(FIRST_WAIT_MS);
    anna.say({ kind: 'continue-without', absentId: idOf(anna, 'Cem') });
    expect(lines().slice(-2)).toEqual([
      `[escapelab] room ${code}: Cem's line closed`,
      `[escapelab] room ${code}: Anna went on without Cem`,
    ]);
    manager.get(code).dispose();
    stop();
  });

  it('says a seat asked for by another device, and who let it in or how it was kept', () => {
    const { line, manager, stop, lines } = server();
    const { code, anna, ben } = crew(line, 'systemcheck');
    const seat = idOf(anna, 'Ben');
    ben.close();
    vi.advanceTimersByTime(5000);
    line.connect().say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Bens Telefon') });
    vi.advanceTimersByTime(TAKEOVER_WAIT_MS);
    const tablet = line.connect();
    const pass = passFor('Bens Tablet');
    tablet.say({ kind: 'join-room', code, name: 'Ben', pass });
    anna.say({ kind: 'takeover-answer', seat, allow: true });
    tablet.say({ kind: 'resume', code, pass });
    expect(tablet.view.you.name).toBe('Ben');
    expect(lines().slice(-5)).toEqual([
      `[escapelab] room ${code}: Ben's seat asked for by another device`,
      `[escapelab] room ${code}: Ben's seat kept from another device, unanswered for 30 s`,
      `[escapelab] room ${code}: Ben's seat asked for by another device`,
      `[escapelab] room ${code}: Ben's seat taken over by another device, let in by Anna`,
      `[escapelab] room ${code}: Ben resumed, 35.0 s after its line closed`,
    ]);
    manager.get(code).dispose();
    stop();
  });
});

describe('the server’s log of refusals and runs', () => {
  onTheClock();

  it('says what it refused at the door and the way on refused, not the game’s refusals', () => {
    const { line, manager, stop, lines } = server();
    const { code, anna, ben } = crew(line, 'systemcheck');
    const stranger = line.connect();
    const pass = passFor('Cem');
    stranger.say({ kind: 'join-room', code, name: 'Cem', pass });
    // The code as typed, in small letters: the log names the room as it is.
    stranger.say({ kind: 'join-room', code: code.toLowerCase(), name: 'Anna', pass });
    stranger.say({ kind: 'resume', code, pass });
    // Ben's pass is bound to the run: he opens no other room.
    line.connect().say({ kind: 'create-room', name: 'Ben', pass: passFor('Ben') });
    ben.close();
    anna.say({ kind: 'continue-without', absentId: idOf(anna, 'Ben') });
    anna.say({ kind: 'start-mission' });
    const refused = lines().filter((said) => said.includes(' refused, '));
    expect(refused).toEqual([
      `[escapelab] room ${code}: join-room as Cem refused, Die Mission läuft bereits — ` +
        'Beitritt ist nur in der Lobby möglich. Ein getrennter Platz lässt sich mit seinem ' +
        'Namen übernehmen.',
      `[escapelab] room ${code}: join-room as Anna refused, Anna ist noch verbunden.`,
      `[escapelab] room ${code}: resume refused, Wiederverbinden fehlgeschlagen — ` +
        'Raum neu beitreten.',
      `[escapelab] no room: create-room as Ben refused, Gebunden an den Einsatz ` +
        `„Tutorial: Systemcheck“ in Raum ${code}.`,
      `[escapelab] room ${code}: continue-without by Anna refused, Die Wartezeit läuft noch.`,
    ]);
    expect(anna.heard.at(-1)).toMatchObject({ kind: 'error', of: 'start-mission' });
    manager.get(code).dispose();
    stop();
  });

  it('says who left a lobby, and who gave a run up before the run ended for the rest', () => {
    const { line, manager, stop, lines } = server();
    const lobby = crew(line, 'systemcheck', { go: false });
    lobby.ben.say({ kind: 'abandon', code: lobby.code, pass: passFor('Ben') });
    expect(lines().at(-1)).toBe(`[escapelab] room ${lobby.code}: Ben left the room`);
    lobby.anna.close();
    const run = crew(line, 'systemcheck');
    vi.advanceTimersByTime(30_000);
    run.ben.say({ kind: 'abandon', code: run.code, pass: passFor('Ben') });
    expect(lines().slice(-2)).toEqual([
      `[escapelab] room ${run.code}: Ben gave the run up`,
      `[escapelab] room ${run.code}: run over, lost:abandoned after 30 s, crew Anna — ` +
        'Ben hat den Einsatz verlassen.',
    ]);
    for (const code of [lobby.code, run.code]) {
      manager.get(code).dispose();
    }
    stop();
  });

  it('says how every run ends: its outcome, its time, its crew and why it was called off', () => {
    const { line, manager, stop, lines } = server();
    const timed = crew(line, 'systemcheck');
    vi.advanceTimersByTime(420_000);
    expect(lines().at(-1)).toBe(
      `[escapelab] room ${timed.code}: run over, lost:time after 420 s, crew Anna, Ben`,
    );
    const called = crew(line, 'systemcheck');
    called.ben.close();
    vi.advanceTimersByTime(FIRST_WAIT_MS);
    called.anna.say({ kind: 'call-off' });
    expect(lines().at(-1)).toBe(
      `[escapelab] room ${called.code}: run over, lost:abandoned after 60 s, crew Anna, Ben — ` +
        'Abgebrochen ohne Ben.',
    );
    for (const code of [timed.code, called.code]) {
      manager.get(code).dispose();
    }
    stop();
  });
});
