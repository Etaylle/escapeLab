import { describe, expect, it } from 'vitest';
import { generateEdgework } from '../src/index.js';
import type { PuzzleContext } from '../src/index.js';
import {
  buttonSyncModule,
  type ButtonSyncDef,
  type ButtonSyncState,
} from '../src/puzzles/buttonSync.js';
import { mulberry32 } from '../src/rng.js';
import { T0 } from './lab.js';

const edgework = generateEdgework(mulberry32(1));

function defOf(windowMs?: number): ButtonSyncDef {
  const raw = { type: 'button-sync', id: 'sync', title: 'Synchron' };
  return buttonSyncModule.defSchema.parse(windowMs === undefined ? raw : { ...raw, windowMs });
}

/** The printed example of a def, line by line. */
function exampleOf(def: ButtonSyncDef): string[] {
  const example = buttonSyncModule
    .manual(def)
    .flatMap((section) => section.blocks)
    .find((block) => block.kind === 'example');
  return example?.kind === 'example' ? example.lines : [];
}

/** „2,5" as printed, in milliseconds. */
const ms = (seconds = ''): number => Number(seconds.replace(',', '.')) * 1000;

/** Presses through `apply`, one after another: by whom and when, with this crew at the panel. */
function play(
  def: ButtonSyncDef,
  crew: string[],
  presses: { by: string; at: number }[],
): { state: ButtonSyncState; solved: boolean; penalty: string | null }[] {
  let state = buttonSyncModule.init(def, mulberry32(1), ctx(crew, T0));
  return presses.map(({ by, at }) => {
    const result = buttonSyncModule.apply(def, state, { press: true }, by, ctx(crew, at));
    state = result.state;
    return result;
  });
}

function ctx(crew: string[], at: number): PuzzleContext {
  return {
    edgework,
    alarms: 0,
    remainingSec: 600,
    at,
    crew,
    console: 'a',
    atConsoles: { a: [], b: [] },
  };
}

describe('button-sync: the printed example', () => {
  it('without a window: everyone once, at any pace, closes the switch', () => {
    const def = defOf();
    const lines = exampleOf(def);
    const [size, paced, closed] = [
      /^Crew aus (\d) Personen\.$/,
      new RegExp(
        '^Gedrückt: die erste sofort, die zweite (\\d+) Sekunden später, die dritte nach ' +
          '(\\d+) Minuten?\\.$',
      ),
      /^Alle (\d) haben gedrückt: Die Schaltung schließt\.$/,
    ].map((pattern, i) => pattern.exec(lines[i] ?? ''));
    if (!size || !paced || !closed) {
      throw new Error(`unreadable example: ${JSON.stringify(lines)}`);
    }
    expect([Number(size[1]), Number(closed[1])]).toEqual([3, 3]);
    const crew = ['a', 'b', 'c'];
    const results = play(def, crew, [
      { by: 'a', at: T0 },
      { by: 'b', at: T0 + Number(paced[1]) * 1000 },
      { by: 'c', at: T0 + Number(paced[2]) * 60_000 },
    ]);
    expect(results.map((result) => result.solved)).toEqual([false, false, true]);
    expect(results.every((result) => result.penalty === null)).toBe(true);
  });

  it.each([500, 1000, 2000, 2500, 3000])('with a %i ms window: a late press expires', (window) => {
    const def = defOf(window);
    const lines = exampleOf(def);
    const [size, late, again] = [
      /^Crew aus (\d) Personen\.$/,
      /^Die zweite drückt ([\d,]+) Sekunden? nach der ersten: Der erste Druck ist verfallen\.$/,
      new RegExp(
        '^Die erste drückt erneut, ([\\d,]+) Sekunden? später: Beide liegen innerhalb von ' +
          '([\\d,]+) Sekunden?, die Schaltung schließt\\.$',
      ),
    ].map((pattern, i) => pattern.exec(lines[i] ?? ''));
    if (!size || !late || !again) {
      throw new Error(`unreadable example: ${JSON.stringify(lines)}`);
    }
    expect([Number(size[1]), ms(again[2])]).toEqual([2, window]);
    const lateAt = T0 + ms(late[1]);
    const [first, second, third] = play(def, ['a', 'b'], [
      { by: 'a', at: T0 },
      { by: 'b', at: lateAt },
      { by: 'a', at: lateAt + ms(again[1]) },
    ]);
    // The first press expired with the second: only b's is left, and the attempt is counted.
    expect(first?.solved).toBe(false);
    expect(second?.state).toMatchObject({ pressed: { b: lateAt }, attempts: 1 });
    expect(Object.keys(second?.state.pressed ?? {})).toEqual(['b']);
    expect(third?.solved).toBe(true);
    expect([first, second, third].every((result) => result?.penalty === null)).toBe(true);
  });
});
