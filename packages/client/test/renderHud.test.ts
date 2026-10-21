import { describe, expect, it } from 'vitest';
import { ALARM, AMBER, css, READ_BLUE, TEAL, WHITE } from '../src/world/palette.js';
import { draw, minimapBox, minimapLayout } from '../src/world/render/hud.js';
import { callEntries, callsOf, fakeCanvas, setsOf } from './fakeCanvas.js';
import { frameWith, player, TILES } from './frames.js';
import { mapWith } from './fixtures.js';

const layout = { ox: 600, oy: 100, cell: 10, mw: 100, mh: 60 };

describe('minimapLayout — where the corner minimap goes', () => {
  const map = mapWith({ width: 20, height: 13 });

  it('sits top right below the objective bar, a sixth of the window wide, at most 190 px', () => {
    // 1440 px: a sixth is 230, held to 190; 190 px over 20 tiles is 9.5, rounded to 10 a cell.
    expect(minimapLayout(map, 1440, 820, 1, { top: 120, bottom: 100 })).toEqual({
      ox: 1440 - 200 - 14,
      oy: 120,
      cell: 10,
      mw: 200,
      mh: 130,
    });
  });

  it('keeps 84 px down at least, and shrinks its cells where the window is short', () => {
    const short = minimapLayout(map, 1440, 200, 1, { top: 0, bottom: 0 });
    expect(short.oy).toBe(84);
    // Below 84 px there are 200 - 84 - 10 left for 13 rows: 8 px a cell.
    expect(short.cell).toBe(8);
    expect(minimapLayout(map, 1440, 100, 1, { top: 0, bottom: 0 }).cell).toBe(3);
  });

  it('works in device pixels: the bar, the size and the air at the edge all at the density', () => {
    // 190 CSS px at 2 is 380 device px: 19 a cell over 20 tiles.
    const sharp = minimapLayout(map, 2880, 1640, 2, { top: 120, bottom: 100 });
    expect(sharp).toEqual({ ox: 2880 - 380 - 28, oy: 240, cell: 19, mw: 380, mh: 247 });
  });

  it('covers its dark frame too, which the arrows and room names keep off', () => {
    expect(minimapBox(layout, 2)).toEqual({ left: 590, top: 90, right: 710, bottom: 170 });
  });
});

describe('hud — the corner minimap on the canvas', () => {
  it('draws nothing while it is off, nor while the run ends on screen', () => {
    const off = fakeCanvas();
    draw(off.ctx, frameWith());
    expect(off.log).toEqual([]);
    const ending = fakeCanvas();
    draw(ending.ctx, frameWith({ minimap: layout, ending: { lit: 0, pull: 0, dark: 0.5 } }));
    expect(ending.log).toEqual([]);
  });

  it('lays its panel over its box, a cell per floor tile, and puts the alpha back', () => {
    const { ctx, log } = fakeCanvas();
    draw(ctx, frameWith({ minimap: layout }));
    expect(callEntries(log, 'roundRect')[0]).toMatchObject({
      args: [595, 95, 110, 70, 6],
      alpha: 0.86,
    });
    const floors = TILES.join('').split('').filter((tile) => tile === '.').length;
    const cells = callsOf(log, 'fillRect').filter(([, , w, h]) => w === 10 && h === 10);
    expect(cells).toHaveLength(floors);
    expect(cells).toContainEqual([600 + 1 * 10, 100 + 1 * 10, 10, 10]);
    expect(setsOf(log, 'globalAlpha').at(-1)).toBe(1);
  });

  it('marks shut doors amber, and the armed station and its sources bright', () => {
    const map = mapWith({
      width: 10,
      height: 6,
      tiles: TILES,
      doors: [
        { id: 'shut', x: 5, y: 1, open: false },
        { id: 'open', x: 5, y: 2, open: true },
      ],
      stations: [{ puzzleId: 'kasten', x: 7, y: 1, title: 'Kasten', status: 'armed' }],
      manuals: [
        {
          id: 'm',
          kind: 'book',
          x: 2,
          y: 1,
          label: 'HANDBUCH',
          puzzleIds: ['kasten'],
          opened: true,
          needsKey: null,
        },
      ],
    });
    const { ctx, log } = fakeCanvas();
    draw(ctx, frameWith({ map, minimap: layout }));
    const fills = log.flatMap((entry, i) => {
      const next = log[i + 1];
      return entry.kind === 'set' && entry.name === 'fillStyle' && next?.kind === 'call'
        ? [[entry.value, ...next.args.slice(0, 2)]]
        : [];
    });
    // Shut amber, open a dim shade of the floor's teal; the armed station teal, its rules blue.
    expect(fills).toContainEqual([css(AMBER), 650, 110]);
    const open = fills.find(([, x, y]) => x === 650 && y === 120)?.[0];
    expect(open).not.toBe(css(AMBER));
    expect(fills).toContainEqual([css(TEAL), 670, 110]);
    expect(fills).toContainEqual([css(READ_BLUE), 620, 110]);
  });

  it('dots the drones by their state and the crew in their colours, yours ringed in white', () => {
    const drones = {
      frozen: { x: 3, y: 3, facing: 0, range: 3, halfAngleDeg: 30, alerted: false, frozen: true },
      alert: { x: 6, y: 3, facing: 0, range: 3, halfAngleDeg: 30, alerted: true, frozen: false },
    };
    const ben = { x: 7, y: 4, facing: 0, moving: false, rx: 7.5, ry: 4.5, phase: 0 };
    const others = new Map([['p2', ben]]);
    const players = [player('p1', 'Anna', '#2dd4bf'), player('p2', 'Ben', '#f472b6')];
    const { ctx, log } = fakeCanvas();
    draw(ctx, frameWith({ minimap: layout, drones, others, players }));
    const arcs = callsOf(log, 'arc');
    const dot = 10 * 0.55;
    expect(arcs).toContainEqual([630, 130, 10 * 0.5, 0, Math.PI * 2]);
    expect(arcs).toContainEqual([675, 145, dot, 0, Math.PI * 2]);
    expect(arcs.at(-1)).toEqual([625, 125, dot, 0, Math.PI * 2]);
    const fills = setsOf(log, 'fillStyle');
    expect(fills).toEqual(expect.arrayContaining([css(ALARM), '#f472b6', '#2dd4bf']));
    // A frozen drone is grey: neither its patrol's amber nor the alarm's red.
    const fillBefore = (x: number, y: number): unknown => {
      const at = log.findIndex(
        (e) => e.kind === 'call' && e.name === 'arc' && e.args[0] === x && e.args[1] === y,
      );
      return log.slice(0, at).reverse().find((e) => e.kind === 'set' && e.name === 'fillStyle');
    };
    const frozen = fillBefore(630, 130);
    expect(frozen).toMatchObject({ value: expect.any(String) });
    expect([css(AMBER), css(ALARM)]).not.toContain((frozen as { value: string }).value);
    expect(setsOf(log, 'strokeStyle').at(-1)).toBe(css(WHITE));
    expect(callsOf(log, 'stroke')).toHaveLength(2);
  });
});
