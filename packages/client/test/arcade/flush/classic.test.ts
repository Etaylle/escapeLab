import { describe, expect, it } from 'vitest';
import * as oracle from './rules-b22d4e4.js';
import { seeded } from '../../../src/arcade/flush/kit.js';
import { createGame, update, type Game, type Rules } from '../../../src/arcade/flush/rules.js';
import { MODERN } from '../../../src/arcade/flush/modern.js';

/**
 * Ferret Flush's Classic rules play exactly as Uros's original (commit b22d4e4), as his own test
 * proves it: a small bot plays all three games against the frozen original rules and the port,
 * frame for frame with the same dice and frames of uneven length, every cue of every frame and
 * every field the original knew compared; the modern rules' first round as well.
 */

const CAN_BE_HIT = new Set(['rising', 'flying']);

/** Aims at a target now and then, with a hand that is steady or shaky, and clicks menus. */
function bot(game: oracle.OracleGame, dice: () => number, shaky: number) {
  if (game.screen === 'title') return { x: 0, y: 0, fire: false, choose: game.mode };
  if (game.screen === 'over') return { x: 0, y: 0, fire: false, choose: 'again' };
  const targets = game.birds.filter((bird) => CAN_BE_HIT.has(bird.state));
  const fire = dice() < 0.06;
  const target = targets[Math.floor(dice() * targets.length)];
  if (!target) return { x: dice() * 1280, y: dice() * 720, fire, choose: null };
  const off = (dice() - 0.5) * shaky;
  return { x: target.x + off, y: target.y - off / 2, fire, choose: null };
}

/** Everything of `value` the original state also has, in the same shape. */
function pick(value: unknown, reference: unknown): unknown {
  if (Array.isArray(reference)) {
    if (!Array.isArray(value) || value.length !== reference.length) return value;
    return value.map((item, i) => pick(item, reference[i]));
  }
  if (reference !== null && typeof reference === 'object') {
    if (value === null || typeof value !== 'object') return value;
    const from = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(reference).map(([k, ref]) => [k, pick(from[k], ref)]));
  }
  return value;
}

const plain = (game: object): unknown => JSON.parse(JSON.stringify(game));
const cues = (list: readonly { type: string; value?: number | undefined }[]) =>
  list.map(({ type, value }) => ({ type, value }));

interface Race {
  mode: string;
  seed: number;
  shaky: number;
  rules?: Rules;
  seconds: number;
  every?: number;
  going?: (game: Game) => boolean;
}

/** Plays both rule books side by side; `going` says when to stop. Returns what was seen. */
function race({ mode, seed, shaky, rules, seconds, every = 10, going = () => true }: Race) {
  const old = oracle.createGame({ rng: seeded(seed) });
  const now = createGame({ rng: seeded(seed), ...(rules ? { rules } : {}) });
  old.mode = mode;
  now.mode = mode as Game['mode'];
  const dice = seeded(seed + 100);
  const frames = seeded(seed + 200);
  const seen = { rounds: new Set<number>(), overs: 0, compared: 0 };
  for (let i = 0, time = 0; time < seconds && going(now); i++) {
    const dt = 1 / 240 + frames() * (0.05 - 1 / 240);
    time += dt;
    const input = bot(old, dice, shaky);
    oracle.update(old, dt, input);
    update(now, dt, input);
    expect(cues(now.events), `frame ${i}`).toEqual(cues(old.events));
    seen.overs += old.events.filter((event) => event.type === 'over').length;
    old.events.length = now.events.length = 0;
    seen.rounds.add(old.round);
    if (i % every) continue;
    const expected = plain(old);
    expect(pick(plain(now), expected), `frame ${i}`).toEqual(expected);
    seen.compared++;
  }
  return seen;
}

describe('Ferret Flush’s Classic rules', () => {
  it('play all three games exactly as the original, through rounds and game over', () => {
    for (const mode of ['single', 'pair', 'clay']) {
      for (const [seed, shaky] of [
        [1, 190],
        [2, 240],
        [3, 300],
      ] as const) {
        const seen = race({ mode, seed, shaky, seconds: 900 });
        expect(seen.overs, `${mode} ${seed}: a game must end`).toBeGreaterThanOrEqual(1);
        expect(seen.compared, `${mode} ${seed}`).toBeGreaterThan(1000);
      }
      const steady = race({ mode, seed: 4, shaky: 30, seconds: 600 });
      expect(Math.max(...steady.rounds), `${mode}: a steady hand`).toBeGreaterThanOrEqual(3);
    }
  });

  it('are what the modern rules play in the first round', () => {
    for (const mode of ['single', 'pair', 'clay']) {
      for (const seed of [5, 6, 7]) {
        const seen = race({
          mode,
          seed,
          shaky: 60,
          rules: MODERN,
          seconds: 300,
          every: 1,
          going: (game) => game.round <= 1 && game.screen !== 'over',
        });
        expect(seen.compared, `${mode} ${seed}`).toBeGreaterThan(500);
      }
    }
  });
});
