import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission } from '@escapelab/core';
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
    guest.say({ kind: 'set-ready', ready: true });
  });
  host.say({ kind: 'start-mission' });
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
    nobody.say({ kind: 'pause-menu', open: true });
    expect(nobody.heard.at(-1)).toEqual({
      kind: 'error',
      message: 'Noch in keinem Raum.',
      of: 'pause-menu',
    });
  });
});
