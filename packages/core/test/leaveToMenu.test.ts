import { describe, expect, it } from 'vitest';
import {
  applyAction,
  FIRST_WAIT_MS,
  heirOf,
  initialState,
  inMainMenu,
  seatsOff,
  viewFor,
} from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { labMission, lineBack, lineDrops, started, T0 } from './lab.js';

/** A corridor lab for three, its one station worked by the whole crew. */
const mission = labMission([{ type: 'button-sync', id: 'eins', title: 'Eins' }], 'menu', 3);

/** `playerId` closes their line on purpose at `at`, gone to the main menu. */
const toMenu = (playerId: string, at: number): Action => ({
  type: 'player-disconnected',
  playerId,
  at,
  menu: true,
});

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

/** A lobby of `names` (p1, p2, …, joined in that order, p1 the host). */
function lobby(count: number): GameState {
  const joins = Array.from(
    { length: count },
    (_, i): Action => ({ type: 'player-join', playerId: `p${i + 1}`, name: `p${i + 1}` }),
  );
  return run(joins, initialState(mission));
}

const LEFT_AT = T0 + 10_000;
const running = started(mission);
/** Ben (p2) went to the main menu: the run waits for him as for a drop. */
const waiting = applyAction(running, toMenu('p2', LEFT_AT));

describe('a line closed for the main menu', () => {
  it('stands the run still as a drop does, with the same wait before the crew may go on', () => {
    const dropped = applyAction(running, lineDrops('p2', LEFT_AT));
    expect(waiting.paused).toEqual(dropped.paused);
    expect(waiting.away).toEqual(dropped.away);
    expect(waiting.away['p2']?.waivableAt).toBe(LEFT_AT + FIRST_WAIT_MS);
    expect(waiting.players.find((p) => p.id === 'p2')?.connected).toBe(false);
  });

  it('tells the crew where the player went, and nothing of the kind for a drop', () => {
    expect(waiting.menus).toEqual({ p2: 'main' });
    expect(viewFor(waiting, 'p1').pausedFor).toEqual([
      { id: 'p2', name: 'p2', since: LEFT_AT, waivableAt: LEFT_AT + FIRST_WAIT_MS, menu: true },
    ]);
    expect(viewFor(waiting, 'p3').players.map((p) => p.menu ?? '')).toEqual(['', 'main', '']);
    const dropped = applyAction(running, lineDrops('p2', LEFT_AT));
    expect(viewFor(dropped, 'p1').pausedFor?.[0]?.menu).toBeUndefined();
    expect(dropped.menus).toEqual({});
  });

  it('is over once the player is back on the line, the run going on', () => {
    const back = applyAction(waiting, lineBack('p2', LEFT_AT + 30_000));
    expect(back.menus).toEqual({});
    expect(back.paused).toBeNull();
  });

  it('closes a pause menu the player had open', () => {
    const atPause = applyAction(running, { type: 'set-menu', playerId: 'p2', open: true });
    expect(applyAction(atPause, toMenu('p2', LEFT_AT)).menus).toEqual({ p2: 'main' });
  });

  it('outlasts the server going down, where every pause menu closes', () => {
    const atPause = applyAction(waiting, { type: 'set-menu', playerId: 'p1', open: true });
    expect(atPause.menus).toEqual({ p1: 'pause', p2: 'main' });
    const down = applyAction(atPause, { type: 'maintenance', at: LEFT_AT, waitFrom: LEFT_AT });
    expect(down.menus).toEqual({ p2: 'main' });
  });

  it('goes with the seat given up from the main menu', () => {
    const giveUp: Action = { type: 'abandon', playerId: 'p2', at: LEFT_AT, where: null };
    const gaveUp = applyAction(waiting, giveUp);
    expect(gaveUp.menus).toEqual({});
  });
});

describe('a lobby seat in the main menu', () => {
  const room = run([toMenu('p3', T0)], lobby(3));

  it('stays the player’s, the lobby showing where they are', () => {
    expect(room.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(viewFor(room, 'p1').players.map((p) => p.menu ?? '')).toEqual(['', '', 'main']);
  });

  it('holds the start back, saying who is in the main menu and whose line is down', () => {
    const ready = run(
      [
        { type: 'set-ready', playerId: 'p2', ready: true },
        { type: 'set-ready', playerId: 'p3', ready: true },
      ],
      lobby(3),
    );
    const start: Action = { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 };
    expect(() => applyAction(run([toMenu('p3', T0)], ready), start)).toThrow(
      'p3 ist im Hauptmenü.',
    );
    const both = run([toMenu('p3', T0), lineDrops('p2', T0)], ready);
    expect(() => applyAction(both, start)).toThrow(
      'p2s Leitung ist unterbrochen · p3 ist im Hauptmenü.',
    );
  });

  it('keeps the mark on the way back from a run to the lobby', () => {
    const goOn: Action = {
      type: 'continue-without',
      playerId: 'p1',
      absentId: 'p2',
      at: LEFT_AT + FIRST_WAIT_MS,
    };
    const lost = run([goOn, { type: 'time-expired', at: T0 + 2_000_000 }], waiting);
    expect(lost.phase).toBe('lost');
    const back = applyAction(lost, { type: 'back-to-lobby', playerId: 'p1' });
    expect(back.phase).toBe('lobby');
    expect(back.menus).toEqual({ p2: 'main' });
    expect(viewFor(back, 'p1').players.map((p) => p.menu ?? '')).toEqual(['', 'main', '']);
  });
});

describe('the host’s part, the host gone', () => {
  it('passes to the longest seated of those on the line', () => {
    const room = run([lineDrops('p2', T0)], lobby(3));
    const left = applyAction(room, { type: 'abandon', playerId: 'p1', at: T0, where: null });
    expect(left.players.map((p) => [p.id, p.isHost])).toEqual([
      ['p2', false],
      ['p3', true],
    ]);
  });

  it('passes to the longest seated where nobody is on the line', () => {
    const room = run([lineDrops('p2', T0), lineDrops('p3', T0)], lobby(3));
    const left = applyAction(room, { type: 'abandon', playerId: 'p1', at: T0, where: null });
    expect(left.players.find((p) => p.isHost)?.id).toBe('p2');
  });

  it('stays where it is while the host stays, and leaves exactly one host', () => {
    const left = applyAction(lobby(3), { type: 'abandon', playerId: 'p2', at: T0, where: null });
    expect(left.players.filter((p) => p.isHost).map((p) => p.id)).toEqual(['p1']);
    expect(heirOf([])).toBeNull();
  });
});

describe('what holds a start back', () => {
  it('names who is in the main menu, one or several', () => {
    expect(inMainMenu(['Cem'])).toBe('Cem ist im Hauptmenü');
    expect(inMainMenu(['Cem', 'Dora', 'Eva'])).toBe('Cem, Dora und Eva sind im Hauptmenü');
    expect(seatsOff(['Ben'], [])).toBe('Bens Leitung ist unterbrochen');
    expect(seatsOff([], ['Cem'])).toBe('Cem ist im Hauptmenü');
  });
});
