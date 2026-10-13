import { describe, expect, it } from 'vitest';
import type { PlayerPosition } from '@escapelab/core';
import {
  correction,
  ECHO_MS,
  positionsOf,
  SNAP_DISTANCE,
  startingSpot,
  type KnownPositions,
} from '../src/world/movement.js';

const at = (x: number, y: number): PlayerPosition => ({ x, y, facing: 0, moving: false });

/** Two runs by their `startedAt`: the one before „Nochmal", and the one it started. */
const LAST_RUN = 1_000;
const THIS_RUN = 9_000;
/** Blackout's spawn in the Flur, west of the Flurschott. */
const map = { yourSpawn: { x: 6, y: 5 } };
const spawn = { x: 6.5, y: 5.5 };

describe('where your avatar starts a run', () => {
  it('stands on its spawn while the latest positions are still from the run before', () => {
    // Where the last run ended for Anna: in the east Flur, behind the Flurschott.
    const known: KnownPositions = { run: LAST_RUN, players: { anna: at(13.5, 6.5) } };
    expect(startingSpot(known, 'anna', map, THIS_RUN)).toEqual(spawn);
  });

  it('stands where the server has you in this run, as when coming back mid-run', () => {
    const known: KnownPositions = { run: THIS_RUN, players: { anna: at(13.5, 6.5) } };
    expect(startingSpot(known, 'anna', map, THIS_RUN)).toEqual({ x: 13.5, y: 6.5 });
  });

  it('stands on its spawn while nothing is known of you', () => {
    expect(startingSpot({ run: null, players: {} }, 'anna', map, THIS_RUN)).toEqual(spawn);
    const others: KnownPositions = { run: THIS_RUN, players: { ben: at(3.5, 2.5) } };
    expect(startingSpot(others, 'anna', map, THIS_RUN)).toEqual(spawn);
  });
});

describe('following the server', () => {
  const self = { x: 8.5, y: 6.5 };
  const serverHas = (x: number, y: number, run = THIS_RUN): KnownPositions => ({
    run,
    players: { anna: at(x, y), ben: at(2.5, 2.5) },
  });

  it('leaves you where you stand while the server has you within a tile', () => {
    expect(correction(serverHas(8.5, 6.5), 'anna', THIS_RUN, self, [], 0)).toBeNull();
    const edge = serverHas(8.5 + SNAP_DISTANCE, 6.5);
    expect(correction(edge, 'anna', THIS_RUN, self, [], 0)).toBeNull();
  });

  it('puts you back where the server kept you once that lies more than a tile away', () => {
    // The step through the shut Flurschott was refused: the server still has you in front of it.
    const kept = serverHas(8.5, 6.5);
    const through = { x: 10.2, y: 6.5 };
    expect(correction(kept, 'anna', THIS_RUN, through, [], 0)).toEqual({ x: 8.5, y: 6.5 });
  });

  it('takes nothing from positions of another run', () => {
    const stale = serverHas(13.5, 6.5, LAST_RUN);
    expect(correction(stale, 'anna', THIS_RUN, self, [], 0)).toBeNull();
    expect(correction({ run: THIS_RUN, players: {} }, 'anna', THIS_RUN, self, [], 0)).toBeNull();
  });

  it('takes a step of yours still on its way back for no correction, but not for ever', () => {
    // Anna streamed (8.5, 6.5) and walked on east; the broadcasts lag behind her.
    const lagging = serverHas(8.5, 6.5);
    const streamed = [{ x: 8.5, y: 6.5, at: 2_000 }];
    const ahead = { x: 9.9, y: 6.5 };
    expect(correction(lagging, 'anna', THIS_RUN, ahead, streamed, 2_000 + ECHO_MS)).toBeNull();
    // Long after any echo, the server still keeps her there: it refused her steps since.
    expect(correction(lagging, 'anna', THIS_RUN, ahead, streamed, 2_001 + ECHO_MS)).toEqual({
      x: 8.5,
      y: 6.5,
    });
  });
});

describe('positions of a run', () => {
  it('shows the latest positions for their own run and none for another', () => {
    const known: KnownPositions = { run: THIS_RUN, players: { ben: at(2.5, 2.5) } };
    expect(positionsOf(known, THIS_RUN)).toEqual({ ben: at(2.5, 2.5) });
    expect(positionsOf(known, LAST_RUN)).toEqual({});
  });
});
