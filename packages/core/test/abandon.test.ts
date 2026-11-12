import { describe, expect, it } from 'vitest';
import { applyAction, initialState } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { consoleLab, started, T0 } from './lab.js';

/** A lab for three: Anna hosts, Ben and Cem joined after her. */
const mission = consoleLab(3);

const join = (playerId: string): Action => ({ type: 'player-join', playerId, name: playerId });
const ready = (playerId: string): Action => ({ type: 'set-ready', playerId, ready: true });
const abandon = (playerId: string, at = T0): Action => ({ type: 'abandon', playerId, at });

function run(actions: Action[], from: GameState = initialState(mission)): GameState {
  return actions.reduce(applyAction, from);
}

const lobby = run([join('anna'), join('ben'), join('cem'), ready('ben'), ready('cem')]);

describe('leaving a room before a run', () => {
  it('takes the player out, and everyone confirms anew', () => {
    const left = run([abandon('cem')], lobby);
    expect(left.players.map((p) => p.id)).toEqual(['anna', 'ben']);
    expect(left.players.every((p) => !p.ready)).toBe(true);
  });

  it('passes the host’s part on to whoever joined next', () => {
    const left = run([abandon('anna')], lobby);
    expect(left.players.map((p) => [p.id, p.isHost])).toEqual([
      ['ben', true],
      ['cem', false],
    ]);
  });

  it('knows nobody it has never seen', () => {
    expect(() => run([abandon('zoe')], lobby)).toThrow(/Unbekannter Spieler/);
  });
});

describe('leaving a room after a run', () => {
  it('is as free: the end screen’s crew goes on without them', () => {
    const lost = applyAction(started(mission), { type: 'time-expired', at: T0 + 700_000 });
    expect(lost.phase).toBe('lost');
    const left = run([abandon('p2')], lost);
    expect(left.players.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(left.phase).toBe('lost');
  });
});

describe('leaving while a run is on', () => {
  it('is no free leave', () => {
    expect(() => run([abandon('p2')], started(mission))).toThrow(/laufender Einsatz/);
  });
});
