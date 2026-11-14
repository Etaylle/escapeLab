import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_WAIT_MS, parseMission } from '@escapelab/core';
import { LOBBY_AWAY_MS } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

/**
 * A corridor lab for two or three: one station the whole crew presses at (3,1), the hatch at
 * its east end, no intro — the clock runs from the start.
 */
const lab = parseMission({
  id: 'flur',
  title: 'Flur',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 2, max: 3 },
  puzzles: [{ type: 'button-sync', id: 'eins', title: 'Eins' }],
  map: {
    tiles: ['##########', '#........#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
    stations: [{ puzzleId: 'eins', x: 3, y: 1 }],
    exit: { x: 8, y: 2 },
  },
});

/** The menu each of the crew has open, as `socket`'s latest view lists them; '' for none. */
const menusOn = (socket: FakeSocket): string[] => socket.view.players.map((p) => p.menu ?? '');

/** `names` in a run of the corridor over sockets of their own, the first of them its host. */
function served(names: string[]) {
  const line = new FakeServer();
  const manager = new RoomManager();
  serveSockets(line, { catalog: { get: () => lab, default: lab }, manager });
  const [host, ...guests] = names.map(() => line.connect()) as [FakeSocket, ...FakeSocket[]];
  host.say({ kind: 'create-room', name: names[0] ?? 'Anna', pass: passFor(names[0] ?? 'Anna') });
  const { code } = joinedOf(host);
  guests.forEach((guest, i) => {
    const name = names[i + 1] ?? '';
    guest.say({ kind: 'join-room', code, name, pass: passFor(name) });
  });
  // Every join asks everybody to confirm anew: the crew says ready once it is whole.
  for (const guest of guests) {
    guest.say({ kind: 'set-ready', ready: true });
  }
  host.say({ kind: 'start-mission' });
  if (host.view.phase !== 'playing') {
    throw new Error(`the run did not start: ${JSON.stringify(host.heard.at(-1))}`);
  }
  return { line, manager, code, crew: [host, ...guests] };
}

describe('the pause menu over a run, as the server hears it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the crew who stands at the menu, while the run and its clock go on', () => {
    const { manager, code, crew } = served(['Anna', 'Ben']);
    const [anna, ben] = crew as [FakeSocket, FakeSocket];
    expect(ben.view.phase).toBe('playing');
    anna.say({ kind: 'pause-menu', open: true });
    expect(menusOn(ben)).toEqual(['pause', '']);
    expect(menusOn(anna)).toEqual(['pause', '']);
    expect(ben.view.pausedAt).toBeNull();
    anna.say({ kind: 'pause-menu', open: false });
    expect(menusOn(ben)).toEqual(['', '']);
    // Said again, a word that changes nothing sends nobody anything.
    const heard = ben.heard.length;
    anna.say({ kind: 'pause-menu', open: false });
    expect(ben.heard.length).toBe(heard);
    manager.get(code).dispose();
  });

  it('closes the mark with a line that drops: the crew sees them away, not at the menu', () => {
    const { manager, code, crew } = served(['Anna', 'Ben', 'Cem']);
    const [anna, ben] = crew as [FakeSocket, FakeSocket, FakeSocket];
    ben.say({ kind: 'pause-menu', open: true });
    ben.terminate();
    expect(anna.view.players.map((p) => [p.name, p.connected, p.menu ?? ''])).toEqual([
      ['Anna', true, ''],
      ['Ben', false, ''],
      ['Cem', true, ''],
    ]);
    manager.get(code).dispose();
  });

  it('is refused from a socket in no room', () => {
    const line = new FakeServer();
    serveSockets(line, { catalog: { get: () => lab, default: lab }, manager: new RoomManager() });
    const nobody = line.connect();
    for (const kind of ['pause-menu', 'to-menu'] as const) {
      nobody.say(kind === 'to-menu' ? { kind } : { kind, open: true });
      const refused = { kind: 'error', message: 'Noch in keinem Raum.', of: kind };
      expect(nobody.heard.at(-1)).toEqual(refused);
    }
  });
});

describe('leaving a run for the main menu', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes the line on purpose: the seat stays bound, the crew waits, sees where it went', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { manager, code, crew } = served(['Anna', 'Ben', 'Cem']);
    const [anna, ben] = crew as [FakeSocket, FakeSocket, FakeSocket];
    const benId = ben.view.you.id;
    const at = Date.now();
    ben.say({ kind: 'to-menu' });
    expect(ben.heard.at(-1)).toEqual({ kind: 'at-menu', code });
    expect(anna.view.pausedFor).toEqual([
      { id: benId, name: 'Ben', since: at, waivableAt: at + FIRST_WAIT_MS, menu: true },
    ]);
    expect(anna.view.players.find((p) => p.name === 'Ben')).toMatchObject({
      connected: false,
      menu: 'main',
    });
    const said = `[escapelab] room ${code}: Ben left to the main menu, the seat kept`;
    expect(log.mock.calls.flat()).toContain(said);
    // At the door, the socket's pass is bound to the run, and nothing of the run's goes from it.
    ben.say({ kind: 'whereami', pass: passFor('Ben') });
    expect(ben.heard.at(-1)).toMatchObject({
      kind: 'seated',
      seat: { code, phase: 'playing', paused: true },
    });
    ben.say({ kind: 'request-hint' });
    expect(ben.heard.at(-1)).toMatchObject({ kind: 'error', of: 'request-hint' });
    // The menu card's way back: the seat's own pass resumes it, and the run goes on.
    ben.say({ kind: 'resume', code, pass: passFor('Ben') });
    expect(anna.view.pausedFor).toBeNull();
    expect(anna.view.players.find((p) => p.name === 'Ben')).toMatchObject({ connected: true });
    expect(anna.view.players.find((p) => p.name === 'Ben')?.menu).toBeUndefined();
    manager.get(code).dispose();
  });

  it('lets the crew go on without the player after the same wait as a drop', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { manager, code, crew } = served(['Anna', 'Ben', 'Cem']);
    const [anna, ben] = crew as [FakeSocket, FakeSocket, FakeSocket];
    const benId = ben.view.you.id;
    ben.say({ kind: 'to-menu' });
    vi.advanceTimersByTime(FIRST_WAIT_MS - 1000);
    anna.say({ kind: 'continue-without', absentId: benId });
    expect(anna.heard.at(-1)).toMatchObject({ kind: 'error', of: 'continue-without' });
    vi.advanceTimersByTime(1000);
    anna.say({ kind: 'continue-without', absentId: benId });
    expect(anna.view.pausedFor).toBeNull();
    expect(anna.view.players.find((p) => p.name === 'Ben')).toMatchObject({ waived: true });
    manager.get(code).dispose();
  });

  it('holds a lobby seat as a drop does, the lobby naming who is in the main menu', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const line = new FakeServer();
    const manager = new RoomManager();
    serveSockets(line, { catalog: { get: () => lab, default: lab }, manager });
    const anna = line.connect();
    anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna') });
    const { code } = joinedOf(anna);
    const ben = line.connect();
    ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben') });
    ben.say({ kind: 'set-ready', ready: true });
    ben.say({ kind: 'to-menu' });
    expect(ben.heard.at(-1)).toEqual({ kind: 'at-menu', code });
    anna.say({ kind: 'start-mission' });
    expect(anna.heard.at(-1)).toMatchObject({ kind: 'error', message: 'Ben ist im Hauptmenü.' });
    ben.say({ kind: 'whereami', pass: passFor('Ben') });
    expect(ben.heard.at(-1)).toMatchObject({ kind: 'seated', seat: { code, phase: 'lobby' } });
    vi.advanceTimersByTime(LOBBY_AWAY_MS);
    expect(anna.view.players.map((p) => p.name)).toEqual(['Anna']);
    manager.get(code).dispose();
  });
});
