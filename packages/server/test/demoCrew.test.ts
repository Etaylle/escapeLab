import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawPools, type ClientMessage } from '@escapelab/core';
import { DemoHost, demoSeeds, type Wire } from '../src/demo/host.js';
import { blackoutMission, clockOf, over, playUntil, seenBy, watch } from './demo.js';

/**
 * The demo crew wins Blackout in a real room in real time — on fake timers, a tick of the
 * crew's at a time: walking at a player's pace, pressing E, each station worked by its module's
 * solver on what the two seats see, past the drones and through the emergencies, with no alarm.
 */

const mission = blackoutMission();

/** The seed each station of the Wechselplatz is proved on (core test/blackoutPlan.ts). */
const DRAW_SEEDS = { signalkette: 12, frequenz: 56, notstrom: 93 } as const;

beforeEach(() => {
  // The run's timers and its clock are faked; setImmediate stays real, for the long test's breath.
  const toFake = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;
  vi.useFakeTimers({ toFake: [...toFake] });
  vi.setSystemTime(Date.UTC(2026, 10, 19, 22, 0, 0));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A run of the demo on `seed` to its end: its last view, and what the crew complained of. */
function runOn(seed: number, wire?: Wire) {
  const complaints: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((line: string) => void complaints.push(line));
  const host = new DemoHost(mission, [seed], wire);
  const view = playUntil(watch(host), over);
  host.stop();
  return { view, complaints };
}

describe('the demo crew', () => {
  it.each(Object.entries(DRAW_SEEDS))(
    'wins Blackout with the %s at the Wechselplatz, in five to eight minutes, with no alarm',
    (drawn, seed) => {
      const { view, complaints } = runOn(seed);
      expect(view.phase).toBe('won');
      expect(view.penaltySeq).toBe(0);
      expect(view.hintsUsed).toBe(0);
      expect(drawPools(mission.puzzles, seed)).toEqual({ wechsel: drawn });
      expect(view.events.filter((e) => e.kind === 'puzzle')).toHaveLength(6);
      // Nothing went wrong on the way: no step refused, no script started over.
      expect(complaints).toEqual([]);
      expect(clockOf(view)).toBeGreaterThan(5 * 60);
      expect(clockOf(view)).toBeLessThan(8 * 60);
    },
  );

});

describe('the demo crew at work', () => {
  it('stands before the consoles it works, never on one, and never two on a tile', () => {
    const host = new DemoHost(mission, [DRAW_SEEDS.notstrom]);
    const consoles = new Set(mission.map.stations.map((spot) => `${spot.x},${spot.y}`));
    const tileOf = ({ x, y }: { x: number; y: number }): string =>
      `${Math.floor(x)},${Math.floor(y)}`;
    let stood: string[] = [];
    let stations = 0;
    let working = false;
    const watcher = watch(host);
    host.watch((msg) => {
      if (msg.kind === 'positions') {
        stood = Object.values(msg.players).map(tileOf);
      } else if (msg.kind === 'spectator-view') {
        working = msg.view.phase === 'playing' && msg.view.puzzle !== null;
      }
    });
    playUntil(watcher, (view) => {
      if (working) {
        stations += 1;
        expect(new Set(stood).size, `on ${stood.join(' and ')}`).toBe(2);
        expect(stood.filter((tile) => consoles.has(tile))).toEqual([]);
      }
      return over(view);
    });
    host.stop();
    expect(stations).toBeGreaterThan(1000);
  });

  it('weathers the emergencies its run meets', () => {
    const { view } = runOn(DRAW_SEEDS.signalkette);
    const emergencies = view.events.filter((e) => e.kind === 'sabotage').map((e) => e.label);
    expect(emergencies.length).toBeGreaterThan(0);
    expect(emergencies.filter((label) => label === 'Notfall behoben')).toHaveLength(
      emergencies.length / 2,
    );
  });

  it('drops the rest of a handgrip an emergency cuts into, and takes it up anew after', () => {
    const complaints: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((line: string) => void complaints.push(line));
    const host = new DemoHost(mission, [DRAW_SEEDS.frequenz]);
    const watcher = watch(host);
    // The Funkpult's dial is turned step by step, then the frequency sent: one handgrip.
    let dial: number | null = null;
    playUntil(watcher, ({ puzzle }) => {
      if (puzzle?.kind !== 'morse') {
        return false;
      }
      dial ??= puzzle.dial;
      return puzzle.dial !== dial;
    });
    const before = seenBy(watcher).events.filter((e) => e.kind === 'sabotage').length;
    // The emergency comes with the dial one step on, as the room starts one when it is due.
    const room = host.room as unknown as { dispatch: (action: object) => void };
    room.dispatch({ type: 'sabotage-start', at: Date.now() });
    expect(seenBy(watcher).map?.sabotage).not.toBeNull();
    const view = playUntil(watcher, over);
    host.stop();
    expect(view.events.filter((e) => e.kind === 'sabotage').length).toBeGreaterThan(before);
    expect(view.phase).toBe('won');
    expect(view.penaltySeq).toBe(0);
    // No move went to a console the emergency had: the room refused the crew nothing.
    expect(complaints).toEqual([]);
  });

});

describe('the demo crew over its hundred seeds', () => {
  it('wins every seed of the first hundred, every draw among them, with no alarm', async () => {
    const drawn = new Set<string>();
    const clocks: number[] = [];
    for (let seed = 0; seed < 100; seed++) {
      if (seed % 10 === 0) {
        // The worker's other work gets through: vitest hears from it (core missionsPlayed.ts).
        await new Promise((resolve) => setImmediate(resolve));
      }
      const { view, complaints } = runOn(seed);
      expect(view.phase, `seed ${seed}`).toBe('won');
      expect(view.penaltySeq, `seed ${seed}`).toBe(0);
      expect(complaints, `seed ${seed}`).toEqual([]);
      clocks.push(clockOf(view));
      Object.values(drawPools(mission.puzzles, seed)).forEach((id) => drawn.add(id));
    }
    expect([...drawn].sort()).toEqual(['frequenz', 'notstrom', 'signalkette']);
    expect(Math.min(...clocks)).toBeGreaterThan(5 * 60);
    expect(Math.max(...clocks)).toBeLessThan(8 * 60);
  }, 240_000);

  it('plays the stations of the Wechselplatz in turn, a seed of the hundred each', () => {
    const seeds = demoSeeds(mission);
    const draws = seeds.map((seed) => drawPools(mission.puzzles, seed)['wechsel']);
    expect(draws.slice(0, 6)).toEqual([
      'signalkette',
      'frequenz',
      'notstrom',
      'signalkette',
      'frequenz',
      'notstrom',
    ]);
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(seeds.length).toBeGreaterThanOrEqual(60);
    expect(seeds.every((seed) => seed >= 0 && seed < 100)).toBe(true);
  });
});

describe('the demo crew has no hand on the room', () => {
  it('says only what a page says, over lines that carry copies', () => {
    const said = new Set<ClientMessage['kind']>();
    const wire: Wire = {
      up: (msg) => {
        said.add(msg.kind);
        return structuredClone(msg);
      },
      down: (msg) => structuredClone(msg),
    };
    const { view } = runOn(DRAW_SEEDS.frequenz, wire);
    expect(view.phase).toBe('won');
    expect(view.penaltySeq).toBe(0);
    expect([...said].sort()).toEqual([
      'interact',
      'intro-done',
      'open-source',
      'pos',
      'puzzle-input',
      'set-ready',
      'start-mission',
    ]);
  });

  it('knows the room by its lines alone: but for the host, no file names room or game', () => {
    const dir = new URL('../src/demo/', import.meta.url);
    const files = readdirSync(dir).filter((file) => file !== 'host.ts');
    expect(files.sort()).toEqual([
      'crew.ts',
      'patrol.ts',
      'places.ts',
      'route.ts',
      'script.ts',
      'seat.ts',
      'station.ts',
      'walks.ts',
    ]);
    for (const file of files) {
      const text = readFileSync(new URL(file, dir), 'utf8');
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');
      for (const from of imports) {
        const allowed = from === '@escapelab/core' || /^\.\/[a-z]+\.js$/.test(from);
        expect(allowed, `${file}: ${from}`).toBe(true);
      }
      expect(text, file).not.toMatch(/\b(GameState|applyAction|viewFor|Room)\b/);
    }
  });
});

describe('what the first of the audience sees', () => {
  it('is a run from its start: the lobby, the opening with the lights on, the lights out', () => {
    const host = new DemoHost(mission, [DRAW_SEEDS.signalkette]);
    const watcher = watch(host);
    expect(seenBy(watcher).phase).toBe('lobby');
    expect(seenBy(watcher).players.map((p) => p.name)).toEqual(['Automat A', 'Automat B']);
    const opening = playUntil(watcher, (view) => view.phase === 'playing', 10);
    expect(opening.lights.out).toBe(false);
    const dark = playUntil(watcher, (view) => view.lights.out, 20);
    expect((dark.lights.outAt ?? 0) - (dark.startedAt ?? 0)).toBeGreaterThan(10_000);
    host.stop();
  });
});
