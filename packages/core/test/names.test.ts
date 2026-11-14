import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission } from '../src/index.js';

const blackout = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

describe('crew names', () => {
  it('keeps names unique so a relay instruction can name one player', () => {
    let state = initialState(blackout);
    for (const [playerId, name] of [
      ['p1', 'Anna'],
      ['p2', 'Anna'],
      ['p3', ' anna '],
    ] as const) {
      state = applyAction(state, { type: 'player-join', playerId, name });
    }
    expect(state.players.map((p) => p.name)).toEqual(['Anna', 'Anna 2', 'anna 3']);
  });
});

describe('crew colours on joining', () => {
  it('wears the colour a join asks for where nobody wears it, else the first free one', () => {
    let state = initialState(blackout);
    for (const [playerId, color] of [
      ['p1', '#A78BFA'],
      ['p2', '#a78bfa'],
      ['p3', '#123456'],
    ] as const) {
      state = applyAction(state, { type: 'player-join', playerId, name: playerId, color });
    }
    expect(state.players.map((p) => p.color)).toEqual(['#a78bfa', '#2dd4bf', '#f472b6']);
  });
});
