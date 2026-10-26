import { describe, expect, it } from 'vitest';
import { ALARM, AMBER, css, READ_BLUE, TEAL, WHITE } from '../src/world/palette.js';
import type { MapView } from '@escapelab/core';
import type { Frame } from '../src/world/render/frame.js';
import { draw, minimapBox, minimapGoal, minimapLayout } from '../src/world/render/hud.js';
import { callEntries, callsOf, fakeCanvas, setsOf } from './fakeCanvas.js';
import { frameWith, player, TILES } from './frames.js';
import { mapWith, type Item } from './fixtures.js';

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

  it('marks the armed station and its sources bright', () => {
    const map = mapWith({
      width: 10,
      height: 6,
      tiles: TILES,
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
    // The armed station teal, its rules blue.
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

/**
 * A lab with a door in each kind of wall: (5,2) in the wall running up and down between the
 * rooms, (3,4) in the one running left to right over the room below.
 */
const DOOR_TILES = [
  '##########',
  '#....#...#',
  '#........#',
  '#....#...#',
  '###.######',
  '#........#',
  '##########',
];

/** The fills of `log`, each with the rectangle it fills: style, x, y, width, height. */
function filled(log: ReturnType<typeof fakeCanvas>['log']): unknown[][] {
  let style: unknown = null;
  return log.flatMap((entry) => {
    if (entry.kind === 'set' && entry.name === 'fillStyle') {
      style = entry.value;
    }
    return entry.kind === 'call' && entry.name === 'fillRect' ? [[style, ...entry.args]] : [];
  });
}

describe('hud — the doors on the minimap, as the view knows them', () => {
  const doorsAt = (open: boolean) =>
    mapWith({
      width: 10,
      height: 7,
      tiles: DOOR_TILES,
      doors: [
        { id: 'flur', x: 5, y: 2, open },
        { id: 'keller', x: 3, y: 4, open },
      ],
    });

  it('bars a shut door in amber across its doorway, along its wall', () => {
    const { ctx, log } = fakeCanvas();
    draw(ctx, frameWith({ map: doorsAt(false), minimap: layout }));
    const fills = filled(log);
    // (5,2), the wall upright: a bar 4 px wide down the cell's middle.
    expect(fills).toContainEqual([css(AMBER), 653, 120, 4, 10]);
    // (3,4), the wall lying: a bar 4 px high across it.
    expect(fills).toContainEqual([css(AMBER), 630, 143, 10, 4]);
  });

  it('leaves an open door a gap: its floor between two jambs, no amber anywhere', () => {
    const { ctx, log } = fakeCanvas();
    draw(ctx, frameWith({ map: doorsAt(true), minimap: layout }));
    const fills = filled(log);
    expect(fills.filter(([style]) => style === css(AMBER))).toEqual([]);
    // The doorway's floor is drawn with the rest of the floor.
    expect(fills.some(([, x, y, w, h]) => x === 650 && y === 120 && w === 10 && h === 10)).toBe(
      true,
    );
    // Jambs at the ends of the gap: across the upright wall's door, beside the lying one's.
    const jambs = fills.filter(([, x, y]) => (x === 650 && y === 120) || (x === 630 && y === 140));
    expect(jambs.map(([, , , w, h]) => [w, h])).toEqual(
      expect.arrayContaining([
        [10, 2],
        [2, 10],
      ]),
    );
  });
});

describe('hud — the goal on the minimap', () => {
  const consoles: MapView['stations'] = [
    { puzzleId: 'kette', x: 2, y: 1, title: 'Kette', status: 'armed', console: 'a' },
    { puzzleId: 'kette', x: 7, y: 3, title: 'Kette', status: 'armed', console: 'b' },
    { puzzleId: 'reaktor', x: 8, y: 1, title: 'Reaktor', status: 'locked' },
  ];
  const fuse: Item = {
    id: 'fuse',
    label: 'SICHERUNG',
    x: 3.5,
    y: 4.5,
    carriedBy: null,
    delivered: false,
    deliverTo: { x: 6, y: 4 },
    requiredForTitle: null,
  };
  const labWith = (parts: Partial<MapView>) =>
    mapWith({ width: 10, height: 6, tiles: TILES, stations: consoles, ...parts });

  it('points at the station up next — at both its consoles where it has two', () => {
    expect(minimapGoal(labWith({}), 'p1')).toEqual([
      { x: 2.5, y: 1.5, color: css(TEAL) },
      { x: 7.5, y: 3.5, color: css(TEAL) },
    ]);
  });

  it('points at where the part in hand goes instead, a key at its cabinet once found', () => {
    const carrying = labWith({ items: [{ ...fuse, carriedBy: 'p1' }] });
    expect(minimapGoal(carrying, 'p1')).toEqual([{ x: 6.5, y: 4.5, color: css(READ_BLUE) }]);
    // In somebody else's hands the part is theirs to bring: the station stays the goal.
    expect(minimapGoal(labWith({ items: [{ ...fuse, carriedBy: 'p2' }] }), 'p1')).toHaveLength(2);
  });

  it('adds nothing the view keeps back: a key whose cabinet nobody has found yet', () => {
    const key = { ...fuse, id: 'key', label: 'SCHLÜSSEL', carriedBy: 'p1', deliverTo: null };
    expect(minimapGoal(labWith({ items: [key] }), 'p1').map((dot) => dot.color)).toEqual([
      css(TEAL),
      css(TEAL),
    ]);
  });

  it('points at nothing once the hatch stands open: the exit glows instead', () => {
    const exit = { x: 8, y: 4, open: true, openedAt: 1, atExit: [] };
    expect(minimapGoal(labWith({ exit }), 'p1')).toEqual([]);
    const { ctx, log } = fakeCanvas();
    draw(ctx, frameWith({ map: labWith({ exit }), minimap: layout, pulse: 1 }));
    const glow = callEntries(log, 'createRadialGradient')[0];
    // Round the exit's middle at (685, 145): from 3 px out to 1.9 cells at the beat's top.
    expect(glow?.args).toEqual([685, 145, 3, 685, 145, expect.closeTo(19, 9)]);
    const shut = fakeCanvas();
    const locked = labWith({ exit: { ...exit, open: false } });
    draw(shut.ctx, frameWith({ map: locked, minimap: layout }));
    expect(callEntries(shut.log, 'createRadialGradient')).toEqual([]);
  });

  it('pulses each dot: a ring swelling with the beat over a dot rimmed dark', () => {
    const ringsAt = (parts: Partial<Frame>): unknown[][] => {
      const { ctx, log } = fakeCanvas();
      draw(ctx, frameWith({ map: labWith({}), minimap: layout, ...parts }));
      return callsOf(log, 'arc').filter(([x, y]) => x === 625 && y === 115);
    };
    // The console at (2,1): its middle at (625, 115) on the minimap.
    expect(ringsAt({ pulse: 0 })).toEqual([
      [625, 115, 7.5, 0, Math.PI * 2],
      [625, 115, 4.2, 0, Math.PI * 2],
    ]);
    expect(ringsAt({ pulse: 1 })[0]).toEqual([625, 115, 12.5, 0, Math.PI * 2]);
    // Less motion: the ring holds still, whatever the beat.
    const still = ringsAt({ pulse: 0, reduced: true })[0];
    expect(ringsAt({ pulse: 1, reduced: true })[0]).toEqual(still);
  });

  it('fades in with the page’s HUD after the run’s opening, all of it as much', () => {
    const { ctx, log } = fakeCanvas();
    draw(ctx, frameWith({ map: labWith({}), minimap: layout, pulse: 0, hud: 0.5 }));
    // The panel at half its 0.86, the floor laid on it as much.
    expect(callEntries(log, 'roundRect')[0]?.alpha).toBeCloseTo(0.43);
    const floor = callEntries(log, 'fillRect').find(({ args }) => args[2] === 10);
    expect(floor?.alpha).toBeCloseTo(0.43);
    // The goal's ring at half its 0.9 at the beat's foot, the dot and what follows at half.
    const goal = callEntries(log, 'arc').filter(({ args }) => args[0] === 625 && args[1] === 115);
    expect(goal.map(({ alpha }) => alpha)).toEqual([0.45, 0.5]);
    expect(setsOf(log, 'globalAlpha').at(-1)).toBe(1);
  });
});
