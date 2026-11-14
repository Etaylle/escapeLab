import { describe, expect, it } from 'vitest';
import { applyAction, viewFor, viewForSpectator } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { labMission, lineBack, lineDrops, started, T0 } from './lab.js';

/** A corridor lab for three, its one station worked by the whole crew. */
const mission = labMission([{ type: 'button-sync', id: 'eins', title: 'Eins' }], 'menu', 3);

const running = started(mission);

/** `playerId` opens the pause menu over the run, or closes it (`open`). */
const menu = (playerId: string, open: boolean): Action => ({ type: 'set-menu', playerId, open });

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

/** The menu each of the crew has open, as `viewer`'s view lists them; '' for none. */
function menusSeenBy(state: GameState, viewer: string): string[] {
  return viewFor(state, viewer).players.map((p) => p.menu ?? '');
}

/** Anna (p1) has the pause menu open over the run. */
const atMenu = applyAction(running, menu('p1', true));

describe('the pause menu over a run', () => {
  it('shows the crew who has it open, and lets the run go on: no pause, the clock as is', () => {
    expect(atMenu.menus).toEqual({ p1: 'pause' });
    expect(atMenu.paused).toBeNull();
    expect(atMenu.deadlineAt).toBe(running.deadlineAt);
    for (const viewer of ['p1', 'p2', 'p3']) {
      expect(menusSeenBy(atMenu, viewer)).toEqual(['pause', '', '']);
    }
    expect(viewForSpectator(atMenu).players.map((p) => p.menu ?? '')).toEqual(['pause', '', '']);
  });

  it('closes again, and a word that changes nothing leaves the game as it was', () => {
    expect(applyAction(atMenu, menu('p1', true))).toBe(atMenu);
    expect(applyAction(running, menu('p1', false))).toBe(running);
    const closed = applyAction(atMenu, menu('p1', false));
    expect(closed.menus).toEqual({});
    expect(menusSeenBy(closed, 'p2')).toEqual(['', '', '']);
  });

  it('keeps each member’s apart', () => {
    const both = run([menu('p2', true), menu('p1', false)], atMenu);
    expect(both.menus).toEqual({ p2: 'pause' });
  });

  it('closes with a line that drops, and stays closed once it is back', () => {
    const dropped = applyAction(atMenu, lineDrops('p1', T0 + 5000));
    expect(dropped.menus).toEqual({});
    expect(applyAction(dropped, lineBack('p1', T0 + 9000)).menus).toEqual({});
  });

  it('goes with a seat given up, and with the server going down', () => {
    const gaveUp = applyAction(atMenu, { type: 'abandon', playerId: 'p1', at: T0, where: null });
    expect(gaveUp.menus).toEqual({});
    const down = applyAction(atMenu, { type: 'maintenance', at: T0 + 1000, waitFrom: T0 + 1000 });
    expect(down.menus).toEqual({});
  });

  it('opens for nobody off the line, and nowhere but in a run', () => {
    const off = applyAction(running, lineDrops('p2', T0 + 1000));
    expect(applyAction(off, menu('p2', true))).toEqual(off);
    const lobby = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'p1' },
        { type: 'player-join', playerId: 'p2', name: 'p2' },
      ],
      { ...running, phase: 'lobby', players: [] },
    );
    expect(applyAction(lobby, menu('p1', true)).menus).toEqual({});
    expect(() => applyAction(running, menu('nobody', true))).toThrow(/Unbekannter Spieler/);
  });

  it('shows nobody at the menu once the run is over, and a new run starts with none open', () => {
    const lost = applyAction(atMenu, { type: 'time-expired', at: T0 + 700_000 });
    expect(lost.phase).toBe('lost');
    expect(menusSeenBy(lost, 'p2')).toEqual(['', '', '']);
    const ready = (playerId: string): Action => ({ type: 'set-ready', playerId, ready: true });
    const again = run(
      [ready('p2'), ready('p3'), { type: 'rematch', playerId: 'p1', at: T0 + 800_000, seed: 3 }],
      lost,
    );
    expect(again.phase).toBe('playing');
    expect(again.menus).toEqual({});
  });
});
