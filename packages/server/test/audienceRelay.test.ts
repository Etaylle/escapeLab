import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type PlayerView, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { passFor } from './passes.js';

/**
 * A corridor for two or three whose emergencies run at the relay from the start — the first a
 * minute after the lights, which are out at once — with a clock of 90 s, so that the run can
 * run out of time while one is on.
 */
const lab = parseMission({
  id: 'gang',
  title: 'Gang',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 90,
  players: { min: 2, max: 3 },
  puzzles: [{ type: 'button-sync', id: 'eins', title: 'Eins' }],
  map: {
    tiles: ['##########', '#........#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ],
    stations: [{ puzzleId: 'eins', x: 4, y: 1 }],
    exit: { x: 8, y: 2 },
    sabotage: {
      mode: 'relay',
      label: 'RELAIS',
      hint: 'laut',
      afterSolved: 0,
      firstAfterSec: 60,
      durationSec: 45,
      penaltySec: 60,
    },
  },
});

/** The seeds the review found the leave to break the room in, three of four. */
const SEEDS = [1, 2, 3, 4];

/** What a connection was told, its latest view read off it. */
function hearing() {
  const heard: ServerMessage[] = [];
  const view = (): PlayerView => {
    const last = heard.filter((msg) => msg.kind === 'view').at(-1);
    if (last?.kind !== 'view') {
      throw new Error('no view heard');
    }
    return last.view;
  };
  return { heard, listen: (msg: ServerMessage) => heard.push(msg), view };
}

/**
 * The run of room seed `seed` for `names`, the first its host, an audience watching from the
 * start, a minute in: the emergency at the relay on.
 */
function emergencyFor(seed: number, names: string[]) {
  const room = new Room('TEST', lab, undefined, seed);
  const crew = names.map((name) => {
    const { playerId } = room.join(name, passFor(name));
    const ear = hearing();
    room.attach(playerId, ear.listen);
    return { name, playerId, ...ear };
  });
  for (const { playerId } of crew.slice(1)) {
    room.setReady(playerId, true);
  }
  room.act(crew[0]?.playerId ?? '', { kind: 'start-mission' });
  const audience: ServerMessage[] = [];
  room.attachSpectator((msg) => audience.push(msg));
  vi.advanceTimersByTime(61_000);
  expect(crew[0]?.view().map?.sabotage?.relay).toBeDefined();
  return { room, crew, audience };
}

/** The phase the audience was last shown. */
function audienceSees(audience: readonly ServerMessage[]): string | undefined {
  const last = audience.filter((msg) => msg.kind === 'spectator-view').at(-1);
  return last?.kind === 'spectator-view' ? last.view.phase : undefined;
}

describe('an audience watching a run that ends mid-emergency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sees a give-up below the smallest crew end the run cleanly, the leaver told', () => {
    for (const seed of SEEDS) {
      const { room, crew, audience } = emergencyFor(seed, ['Anna', 'Ben']);
      const [anna, ben] = crew;
      expect(() => room.abandon(passFor('Ben'))).not.toThrow();
      expect(ben?.heard.at(-1)).toEqual({ kind: 'left', code: 'TEST', message: null });
      expect(anna?.view().phase).toBe('lost');
      expect(audienceSees(audience)).toBe('lost');
      expect(() => room.attachSpectator(() => undefined)).not.toThrow();
      room.dispose();
    }
  });

  it('keeps a room lost on time mid-emergency going after an end-screen leave', () => {
    for (const seed of SEEDS) {
      const { room, crew, audience } = emergencyFor(seed, ['Anna', 'Ben', 'Cem']);
      const [anna, ben] = crew;
      vi.advanceTimersByTime(30_000);
      expect(anna?.view().phase).toBe('lost');
      expect(() => room.abandon(passFor('Cem'))).not.toThrow();
      expect(anna?.view().players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
      expect(audienceSees(audience)).toBe('lost');
      // Both say yes on the end screen, and the next run starts.
      room.setReady(anna?.playerId ?? '', true);
      room.setReady(ben?.playerId ?? '', true);
      expect(anna?.view().phase).toBe('playing');
      expect(audienceSees(audience)).toBe('playing');
      expect(() => room.attachSpectator(() => undefined)).not.toThrow();
      room.dispose();
    }
  });
});
