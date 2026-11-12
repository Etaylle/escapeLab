import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission } from '@escapelab/core';
import { RoomManager } from '../src/roomManager.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf } from './line.js';
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
