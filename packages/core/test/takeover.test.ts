import { describe, expect, it } from 'vitest';
import { applyAction, initialState, TAKEOVER_WAIT_MS, viewFor } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { consoleLab, lineBack, lineDrops, started, T0 } from './lab.js';

/** A run for three — p1, p2, p3 — p3's line down since T0 + 1 s. */
const p3Away = applyAction(started(consoleLab(3)), lineDrops('p3', T0 + 1000));

const claim = (playerId: string, at = T0 + 5000): Action => ({
  type: 'takeover-claimed',
  playerId,
  at,
});
const settle = (playerId: string): Action => ({ type: 'takeover-settled', playerId });

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

describe('a new device asking for a seat whose line is down', () => {
  it('asks the crew on the line, until 30 s on, and their views say whose seat', () => {
    const asked = run([claim('p3')], p3Away);
    const until = T0 + 5000 + TAKEOVER_WAIT_MS;
    expect(asked.away['p3']?.claimUntil).toBe(until);
    for (const id of ['p1', 'p2']) {
      expect(viewFor(asked, id).takeovers).toEqual([{ id: 'p3', name: 'p3', until }]);
    }
    // The run still waits for p3: the ask lets nobody in by itself.
    expect(viewFor(asked, 'p1').pausedFor?.map((away) => away.id)).toEqual(['p3']);
  });

  it('is gone from every view once settled, and settles nothing where none waits', () => {
    const settled = run([claim('p3'), settle('p3')], p3Away);
    expect(settled.away['p3']).toEqual({
      since: T0 + 1000,
      waivableAt: p3Away.away['p3']?.waivableAt,
      waived: false,
    });
    expect(viewFor(settled, 'p1')).not.toHaveProperty('takeovers');
    expect(run([settle('p3')], p3Away)).toBe(p3Away);
  });

  it('goes with the seat’s line back', () => {
    const back = run([claim('p3'), lineBack('p3', T0 + 9000)], p3Away);
    expect(back.away).toEqual({});
    expect(viewFor(back, 'p1')).not.toHaveProperty('takeovers');
  });

  it('refuses a seat on the line, a second ask, nobody to answer, and outside a run', () => {
    expect(() => run([claim('p2')], p3Away)).toThrow('p2 ist noch verbunden.');
    expect(() => run([claim('p3'), claim('p3', T0 + 6000)], p3Away)).toThrow(
      'Für p3 wartet schon eine Übernahme auf Antwort.',
    );
    const alone = run([lineDrops('p1', T0 + 2000), lineDrops('p2', T0 + 3000)], p3Away);
    expect(() => run([claim('p3')], alone)).toThrow(/niemand verbunden/);
    const lobby = initialState(consoleLab(3));
    expect(() => run([claim('p3')], lobby)).toThrow('Nur während des Einsatzes.');
  });
});
