import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Move } from '../src/input/bindings.js';
import { PAD_CELLS, PadSteer, padMoves, type PadTouch } from '../src/world/touchPad.js';

/** The pad's cells, 48 px each: a finger in the middle of the cell `col`, `row` (0 to 2). */
const CELL = 48;
function on(col: number, row: number, id = 1): PadTouch {
  return { id, dx: (col - 1) * CELL, dy: (row - 1) * CELL, cell: CELL };
}

describe('padMoves — the way a cell of the steering pad walks', () => {
  it('walks the eight ways round the middle, a corner two keys at once, and stands in it', () => {
    const ways = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => padMoves(...offset(col, row))));
    expect(ways).toEqual([
      ['up', 'left'],
      ['up'],
      ['up', 'right'],
      ['left'],
      [],
      ['right'],
      ['down', 'left'],
      ['down'],
      ['down', 'right'],
    ]);
    expect(ways).toEqual(PAD_CELLS.map(([, moves]) => moves));
  });

  it('turns at half a cell from the middle, and keeps the nearest way past the pad’s edge', () => {
    expect(padMoves(23, -23, CELL)).toEqual([]);
    expect(padMoves(25, -25, CELL)).toEqual(['up', 'right']);
    expect(padMoves(400, 3, CELL)).toEqual(['right']);
    expect(padMoves(-30, 500, CELL)).toEqual(['down', 'left']);
  });
});

/** A finger's offset from the pad's middle at the middle of the cell `col`, `row`. */
function offset(col: number, row: number): [number, number, number] {
  return [(col - 1) * CELL, (row - 1) * CELL, CELL];
}

/** A pad and what it pressed and let go, in order: `+up`, `-up`. */
function padWithLog(): { steer: PadSteer; log: string[] } {
  const log: string[] = [];
  const steer = new PadSteer((move: Move, down: boolean) => log.push(`${down ? '+' : '-'}${move}`));
  return { steer, log };
}

describe('PadSteer — a finger sliding over the pad', () => {
  it('turns the walk as the finger slides, without lifting, and stops it as it lifts', () => {
    const { steer, log } = padWithLog();
    steer.down(on(1, 0));
    expect(log).toEqual(['+up']);
    steer.move(on(2, 0));
    expect(log).toEqual(['+up', '+right']);
    steer.move(on(2, 1));
    expect(log).toEqual(['+up', '+right', '-up']);
    expect(steer.held).toEqual(['right']);
    steer.up(1);
    expect(log).toEqual(['+up', '+right', '-up', '-right']);
    expect(steer.held).toEqual([]);
  });

  it('holds nothing in the still middle, and presses nothing twice while a cell holds', () => {
    const { steer, log } = padWithLog();
    steer.down(on(1, 1));
    steer.move(on(1, 1));
    expect(log).toEqual([]);
    steer.move(on(0, 1));
    steer.move({ ...on(0, 1), dx: -60 });
    expect(log).toEqual(['+left']);
  });

  it('steers by the first finger only: a second one on the pad meanwhile changes nothing', () => {
    const { steer, log } = padWithLog();
    steer.down(on(1, 2, 1));
    steer.down(on(2, 1, 2));
    steer.move(on(0, 0, 2));
    steer.up(2);
    expect(log).toEqual(['+down']);
    steer.up(1);
    expect(log).toEqual(['+down', '-down']);
    // Once the first has lifted, the next finger steers.
    steer.down(on(2, 1, 2));
    expect(log).toEqual(['+down', '-down', '+right']);
  });

  it('lets go of everything when the browser takes the finger away', () => {
    const { steer, log } = padWithLog();
    steer.down(on(0, 0));
    steer.up(1);
    expect(log).toEqual(['+up', '+left', '-up', '-left']);
  });
});

describe('the pad and the thumb’s buttons as the stylesheets set them', () => {
  const read = (path: string): string =>
    readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  /** The px of each declaration `property` holds in the first rule `selector` opens in `css`. */
  function pxOf(css: string, selector: string, property: string): number[] {
    const from = css.indexOf(`\n${selector} {`);
    const rule = from < 0 ? '' : css.slice(from, css.indexOf('}', from));
    const value = new RegExp(`\\n\\s*${property}: ([^;]+);`).exec(rule)?.[1] ?? '';
    return [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  }

  it('makes each of the pad’s cells 48 px square, Material’s least target', () => {
    const ui = read('ui.css');
    expect(pxOf(ui, '.world-pad', 'grid-template-columns')).toEqual([48]);
    expect(pxOf(ui, '.world-pad', 'grid-template-rows')).toEqual([48]);
    expect(ui).toMatch(/\.world-pad \{[^}]*grid-template-columns: repeat\(3, 48px\);/);
  });

  it('gives every button under the right thumb 52 px at least, over Apple’s 44', () => {
    const ui = read('ui.css');
    const world = read('styles/world.css');
    for (const selector of ['.world-interact', '.world-chat-toggle']) {
      expect(pxOf(ui, selector, 'min-width'), selector).toEqual([52]);
      expect(pxOf(ui, selector, 'min-height'), selector).toEqual([52]);
    }
    expect(pxOf(world, '.world-drop', 'width')).toEqual([52]);
    expect(pxOf(world, '.world-drop', 'height')).toEqual([52]);
    expect(world).toMatch(/\.world-sprint \{[^}]*width: 52px;[^}]*height: 52px;/);
    expect(read('styles/voice.css')).toMatch(/\.world-talk \{[^}]*width: 52px;[^}]*height: 52px;/);
  });
});
