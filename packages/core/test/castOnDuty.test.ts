import { describe, expect, it, vi } from 'vitest';
import {
  applyAction,
  castOf,
  initialState,
  parseMission,
  viewFor,
  type GameState,
} from '../src/index.js';
import { labMission, T0 } from './lab.js';

/**
 * The cast on duty once every operator's voice is kept: a roster of the test's own, as cast.json
 * reads after `--keep operator:marta=<n>` and `--keep operator:jonas=<n>`. The lobby's Funkprobe
 * is said by the operator who then has the run, every line of the run names the night's person,
 * and the nights spread over the three.
 */

vi.mock('../src/cast.json', () => {
  const voiced = (id: string) => ({
    id,
    name: id,
    character: 'Arbeitet in der Leitstelle.',
    prompt: 'A calm German voice on a two-way radio, clean studio recording.',
    voiceId: `${id}Voice0000000`,
  });
  return {
    default: {
      pa: [voiced('anlage')],
      operator: [voiced('helmut'), voiced('marta'), voiced('jonas')],
      lead: [voiced('kessler')],
    },
  };
});

const lab = JSON.parse(
  JSON.stringify(labMission([{ type: 'button-sync', id: 'eins', title: 'Eins' }], 'dienst')),
);
const mission = parseMission({ ...lab, radio: { start: 'Los.', lobby: 'Funkprobe.' } });

/** A room's lobby on the night `castSeed` begins with, its crew of two ready. */
function lobby(castSeed: number): GameState {
  return [
    { type: 'player-join', playerId: 'p1', name: 'Anna' } as const,
    { type: 'player-join', playerId: 'p2', name: 'Ben' } as const,
    { type: 'set-ready', playerId: 'p2', ready: true } as const,
  ].reduce(applyAction, initialState(mission, null, 'normal', castSeed));
}

const start = (state: GameState, seed: number): GameState =>
  applyAction(state, { type: 'start-mission', playerId: 'p1', at: T0, seed });

const castSeeds = Array.from({ length: 60 }, (_, i) => i * 104_729 + 3);

describe('the operator on duty, every voice kept', () => {
  it('says the Funkprobe in the lobby and then has the run, whatever seed the run draws', () => {
    for (const [i, castSeed] of castSeeds.entries()) {
      const room = lobby(castSeed);
      const probe = viewFor(room, 'p1');
      expect(probe.radioCheck).toBe('Funkprobe.');
      const run = start(room, 1000 + i);
      const opener = run.events.find((event) => event.moment === 'start');
      expect(opener?.speaker, `night ${castSeed}`).toEqual({
        role: 'operator',
        person: probe.cast.operator,
      });
      expect(viewFor(run, 'p2').cast).toEqual(probe.cast);
    }
  });

  it('changes with the night: back in the lobby, the next one is drawn', () => {
    const nights = castSeeds.map((castSeed) => {
      const over = applyAction(start(lobby(castSeed), 5), { type: 'time-expired', at: T0 + 1e6 });
      const back = applyAction(over, { type: 'back-to-lobby', playerId: 'p1' });
      expect(viewFor(back, 'p1').cast).toEqual(castOf(castSeed + 1));
      return [viewFor(over, 'p1').cast.operator, viewFor(back, 'p1').cast.operator];
    });
    // Crews hear different people on different nights: every operator, and nights that differ.
    expect(new Set(nights.flat())).toEqual(new Set(['helmut', 'marta', 'jonas']));
    expect(nights.some(([first, next]) => first !== next)).toBe(true);
  });

  it('follows the run’s seed in a room pinned to one', () => {
    for (const roomSeed of [11, 4242, 2 ** 31 - 2]) {
      let room = initialState(mission, roomSeed);
      room = [
        { type: 'player-join', playerId: 'p1', name: 'Anna' } as const,
        { type: 'player-join', playerId: 'p2', name: 'Ben' } as const,
        { type: 'set-ready', playerId: 'p2', ready: true } as const,
      ].reduce(applyAction, room);
      const run = start(room, 0);
      expect(viewFor(run, 'p1').cast).toEqual(castOf(run.seed ?? -1));
      const over = applyAction(run, { type: 'time-expired', at: T0 + 1e6 });
      const confirmed = applyAction(over, { type: 'set-ready', playerId: 'p2', ready: true });
      const rematch = applyAction(confirmed, {
        type: 'rematch',
        playerId: 'p1',
        at: T0 + 2e6,
        seed: 0,
      });
      expect(rematch.seed).toBe((roomSeed + 1) >>> 0);
      expect(viewFor(rematch, 'p1').cast).toEqual(castOf(rematch.seed ?? -1));
    }
  });
});
