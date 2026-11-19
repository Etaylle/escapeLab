import { describe, expect, it } from 'vitest';
import * as oracle from './rules-49dc727.js';
import { createGame, current, step, type Difficulty, type Game } from '../../src/arcade/rules.js';
import { advanceGame } from '../../src/arcade/clock.js';

/**
 * The break-room machine's Classic rules play exactly as Uros's original (commit 49dc727): a bot
 * plays the frozen original and the port side by side, every field the original knew compared a
 * tenth of a second apart, through cleared waves, deaths and game over; modern wave 1 as well.
 */

const DT = 1 / 120;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Chases the nearest duck that can be hit and fires when lined up beneath it. */
function bot(g: oracle.OracleGame, random: () => number) {
  const p = g.players[g.active];
  if (p === undefined) return {};
  const targets = oracle.exposed(p);
  if (!targets.length) return { fire: true };
  const target = targets.reduce((a, b) => (Math.abs(a.x - p.x) < Math.abs(b.x - p.x) ? a : b));
  const fire = random() < 0.9;
  if (Math.abs(target.x - p.x) < 8) return { fire };
  return { left: target.x < p.x, right: target.x > p.x, fire };
}

/** A new-style state projected onto the fields the original knew. */
function pick(value: unknown, reference: unknown): unknown {
  if (Array.isArray(reference)) {
    return Array.isArray(value) && value.length === reference.length
      ? value.map((v, i) => pick(v, reference[i]))
      : value;
  }
  if (reference !== null && typeof reference === 'object') {
    if (value === null || typeof value !== 'object') return value;
    const from = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(reference).map(([k, ref]) => [k, pick(from[k], ref)]),
    );
  }
  return value;
}

/** A state as JSON keeps it; events by cue and place, a duck's new firing cue left out. */
function plain(g: object): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
  const events = copy['events'] as { type: string; x: number; y: number }[];
  copy['events'] = events
    .filter((e) => e.type !== 'duck-fire')
    .map(({ type, x, y }) => ({ type, x, y }));
  return copy;
}

interface Race {
  difficulty: Difficulty;
  players: number;
  seconds: number;
  seed: number;
  run: 'classic' | 'modern' | 'step';
  keepGoing?: (g: Game) => boolean;
}

/** Plays both side by side, comparing every tenth of a second; the oracle's end state. */
function race({ difficulty, players, seconds, seed, run, keepGoing }: Race) {
  const old = oracle.createGame(difficulty, players);
  const now = createGame(difficulty, players, { classic: run === 'classic' });
  old.random = seeded(seed);
  now.random = seeded(seed);
  const inputs = seeded(seed + 1);
  const play = run === 'step' ? step : advanceGame;
  const going = keepGoing ?? (() => true);
  let compared = 0;
  for (let i = 0; i < seconds * 120 && going(now) && old.state !== 'game-over'; i++) {
    if (old.state === 'turn-change') old.state = now.state = 'playing';
    const input = bot(old, inputs);
    oracle.step(old, input, DT);
    play(now, input, DT);
    if (i % 12 && old.state !== 'game-over') continue;
    const expected = plain(old);
    expect(pick(plain(now), expected), `step ${i}`).toEqual(expected);
    compared++;
  }
  return { old, compared };
}

describe('the machine’s Classic rules', () => {
  it('replay the original through waves, deaths and game over on every difficulty', () => {
    const seen = new Set<string>();
    for (const difficulty of ['Easy', 'Normal', 'Hard'] as const) {
      const { old, compared } = race({ difficulty, players: 1, seconds: 400, seed: 7, run: 'classic' });
      seen.add(old.state);
      seen.add(`wave ${old.players[0]?.wave ?? 0}`);
      expect(compared).toBeGreaterThan(100);
    }
    expect(seen).toContain('game-over');
    expect([...seen].some((s) => /wave [2-9]/.test(s))).toBe(true);
  });

  it('replay alternating two-player games', () => {
    const { old } = race({ difficulty: 'Normal', players: 2, seconds: 600, seed: 11, run: 'classic' });
    expect(old.state).toBe('game-over');
    expect(old.players.every((p) => p.dead)).toBe(true);
  });

  it('are what rules.step plays', () => {
    race({ difficulty: 'Hard', players: 1, seconds: 120, seed: 3, run: 'step' });
  });

  it('are what the modern rules play in the first wave', () => {
    for (const seed of [1, 2, 5]) {
      const { old } = race({
        difficulty: 'Normal',
        players: 1,
        seconds: 400,
        seed,
        run: 'modern',
        keepGoing: (g) => current(g).wave === 1 && g.state !== 'wave-clear',
      });
      expect(old.time).toBeGreaterThan(5);
    }
  });
});
