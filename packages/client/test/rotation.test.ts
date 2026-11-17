import { describe, expect, it } from 'vitest';
import type { MapView } from '@escapelab/core';
import { drawFusebox, drawLeverBox, drawStation } from '../src/world/art.js';
import { contextAction } from '../src/world/interact.js';
import { armedGoal } from '../src/world/known.js';
import { foundIn } from '../src/world/labelFade.js';
import { markerTargets } from '../src/world/markers.js';
import { objectGlows } from '../src/world/render/darkness.js';
import { draw as drawHud, minimapGoal, minimapLayout } from '../src/world/render/hud.js';
import { propLabels } from '../src/world/render/labels.js';
import { draw } from '../src/world/render/objects.js';
import { callsOf, fakeCanvas, recording } from './fakeCanvas.js';
import { frameWith, lightWith, TILES } from './frames.js';
import { mapWith, type Manual, type Station } from './fixtures.js';

/**
 * A lab of a run whose Wechselplatz drew the Funkfeuer: its console armed at (7,1), the
 * Signalkette out of service at (2,1) and (2,4), the Notstromkasten out of service at (4,1), each
 * with its book.
 */
const station = (parts: Partial<Station>): Station => ({
  puzzleId: 'funkfeuer',
  x: 7,
  y: 1,
  title: 'Funkfeuer',
  status: 'armed',
  found: true,
  known: true,
  ...parts,
});

const outA = station({ puzzleId: 'signalkette', title: 'Signalkette', x: 2, status: 'out' });
const outB = { ...outA, y: 4, console: 'b' as const };
const fusebox = station({
  puzzleId: 'notstrom',
  title: 'Notstromkasten',
  x: 4,
  status: 'out',
  look: 'fusebox',
});
const armed = station({});

const book = (parts: Partial<Manual>): Manual => ({
  found: true,
  known: true,
  id: 'buch-funkfeuer',
  kind: 'book',
  x: 7,
  y: 4,
  label: 'FUNKBUCH',
  puzzleIds: ['funkfeuer'],
  opened: true,
  needsKey: null,
  ...parts,
});

const deadBook = book({
  id: 'buch-signalkette',
  x: 3,
  y: 4,
  label: 'SIGNALBUCH',
  puzzleIds: [],
  outOfService: true,
});

const lab = (parts: Partial<MapView> = {}): MapView =>
  mapWith({
    width: 10,
    height: 6,
    tiles: TILES,
    stations: [{ ...outA, console: 'a' }, outB, fusebox, armed],
    manuals: [book({}), deadBook],
    ...parts,
  });

const TAG = 'AUSSER BETRIEB';

/** The texts the objects pass writes for `frame`. */
function texts(frame: ReturnType<typeof frameWith>): unknown[] {
  const { ctx, log } = fakeCanvas(800, 600);
  draw(ctx, frame);
  return callsOf(log, 'fillText').map((args) => args[0]);
}

describe('a station out of service: its console in the world', () => {
  it('stands dark with its tag: no lock, no glow, the card across its front', () => {
    const look = { pulse: 0.5, console: null };
    const out = recording((ctx) => drawStation(ctx, { ...look, status: 'out' }));
    const locked = recording((ctx) => drawStation(ctx, { ...look, status: 'locked' }));
    const up = recording((ctx) => drawStation(ctx, { ...look, status: 'armed' }));
    expect(out).not.toEqual(locked);
    expect(out).not.toEqual(up);
    // The tag hangs askew; neither a locked console nor an armed one turns anything.
    const turns = (log: unknown[]): number => JSON.stringify(log).split('"rotate"').length - 1;
    expect([turns(out), turns(locked), turns(up)]).toEqual([1, 0, 0]);
    // A lock says „later"; a console out of service has none on its blank screen.
    const arcs = (log: unknown[]): number => JSON.stringify(log).split('"arc"').length - 1;
    expect(arcs(locked)).toBeGreaterThan(arcs(out));
  });

  it('hangs the tag on a fuse box and a main switch out of service too', () => {
    const turns = (log: unknown[]): number => JSON.stringify(log).split('"rotate"').length - 1;
    for (const status of ['out', 'locked'] as const) {
      const box = recording((ctx) => drawFusebox(ctx, { status, pulse: 0, console: 'a' }));
      const lever = recording((ctx) => drawLeverBox(ctx, { status, pulse: 0, levers: 2 }));
      expect([turns(box), turns(lever)], status).toEqual(status === 'out' ? [1, 1] : [0, 0]);
    }
  });

  it('reads AUSSER BETRIEB under every console of it this player has found', () => {
    const tags = texts(frameWith({ map: lab() })).filter((text) => text === TAG);
    expect(tags).toHaveLength(3);
    expect(texts(frameWith({ map: lab({ stations: [armed] }) }))).not.toContain(TAG);
    // Known to the crew, not found by this player yet: the device, no words.
    expect(texts(frameWith({ map: lab(), labels: () => 0 }))).not.toContain(TAG);
    const locked = lab({ stations: [{ ...outA, status: 'locked' }] });
    expect(texts(frameWith({ map: locked }))).not.toContain(TAG);
  });

  it('gives its tag a place among the labels, clear of the others', () => {
    const { ctx } = fakeCanvas(800, 600);
    const placed = propLabels(ctx, frameWith({ map: lab() }));
    for (const key of ['station:2,1', 'station:2,4', 'station:4,1']) {
      expect(placed.spots.has(key), key).toBe(true);
    }
    expect(placed.spots.has('station:7,1')).toBe(false);
  });

  it('shows only where light has fallen, as a locked console does, and gives off no glow', () => {
    const dark = lightWith({ shown: () => false });
    expect(texts(frameWith({ map: lab(), light: dark }))).not.toContain(TAG);
    const glows = objectGlows(frameWith({ map: lab({ manuals: [] }) }));
    expect(glows.map((glow) => [glow.x, glow.y])).toEqual([[7.5, 1.5]]);
  });

  it('fades its tag in as a find does', () => {
    expect(foundIn(lab()).filter((find) => find.of === 'console')).toEqual([
      { of: 'console', puzzleId: 'signalkette', console: 'a' },
      { of: 'console', puzzleId: 'signalkette', console: 'b' },
      { of: 'console', puzzleId: 'notstrom', console: null },
    ]);
    const unfound = lab({ stations: [{ ...outA, found: false }, armed] });
    expect(foundIn(unfound).filter((find) => find.of === 'console')).toEqual([]);
  });
});

describe('a station out of service: the goal, the markers, the minimap', () => {
  it('is never the goal, and no station left to count', () => {
    expect(armedGoal({ puzzleCount: 3, currentPuzzleIndex: 1 }, lab())).toBe('Funkfeuer');
    const picking = lab({
      stations: [outA, armed, station({ puzzleId: 'ziel', title: 'Ziel', x: 8 })],
    });
    expect(armedGoal({ puzzleCount: 3, currentPuzzleIndex: 1 }, picking)).toBe(
      'Noch 2 Stationen',
    );
    expect(armedGoal({ puzzleCount: 3, currentPuzzleIndex: 1 }, lab({ stations: [outA] }))).toBe(
      null,
    );
  });

  it('gets no arrow, and neither does a source of one', () => {
    const targets = markerTargets(lab(), 'p1', { x: 5.5, y: 3.5 });
    expect(targets.map((target) => [target.x, target.y])).toEqual([
      [7.5, 1.5],
      [7.5, 4.5],
    ]);
    const none = markerTargets(lab({ stations: [outA, fusebox] }), 'p1', { x: 5.5, y: 3.5 });
    expect(none).toEqual([]);
  });

  it('stays off the minimap with its source, and is no goal dot', () => {
    const layout = minimapLayout(lab(), 800, 600, 1, { top: 0, controls: [] });
    const cellOf = (x: number, y: number): [number, number] => [
      layout.ox + x * layout.cell,
      layout.oy + y * layout.cell,
    ];
    const fillsOf = (map: MapView): string[] => {
      const { ctx, log } = fakeCanvas();
      drawHud(ctx, frameWith({ map, minimap: layout }));
      return callsOf(log, 'fillRect').map((args) => `${String(args[0])},${String(args[1])}`);
    };
    const drawnCells = fillsOf(lab());
    const bare = fillsOf(lab({ stations: [], manuals: [] }));
    const marked = (x: number, y: number): boolean => {
      const cell = cellOf(x, y).join(',');
      const count = (cells: string[]): number => cells.filter((c) => c === cell).length;
      return count(drawnCells) > count(bare);
    };
    expect([marked(7, 1), marked(7, 4)]).toEqual([true, true]);
    expect([marked(2, 1), marked(2, 4), marked(4, 1), marked(3, 4)]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(minimapGoal(lab(), 'p1').map((dot) => [dot.x, dot.y])).toEqual([[7.5, 1.5]]);
  });
});

describe('a station out of service: what E says there', () => {
  const HERE_OUT = { x: 2.5, y: 2.2 };
  const AT_BOOK = { id: 'buch-signalkette', kind: 'book', opened: true, needsKey: null } as const;
  const AT_DEAD_BOOK = [{ ...AT_BOOK, outOfService: true }] as const;

  it('reads the tag at its console, and does nothing', () => {
    expect(contextAction(lab(), HERE_OUT, 'p1', [], false, null)).toEqual({
      kind: 'locked',
      label: TAG,
      x: 2.5,
      y: expect.closeTo(0.45),
      subject: { of: 'station', x: 2, y: 1 },
    });
    const locked = lab({ stations: [{ ...outA, status: 'locked' }] });
    expect(contextAction(locked, HERE_OUT, 'p1', [], false, null)).toBeNull();
  });

  it('lets the armed station beside it speak first', () => {
    const beside = lab({ stations: [outA, station({ x: 3 })] });
    expect(contextAction(beside, HERE_OUT, 'p1', [], false, null)).toMatchObject({
      kind: 'operate',
      subject: { of: 'station', x: 3, y: 1 },
    });
  });

  it('says of a source of one what it belongs to, open or shut, and opens nothing', () => {
    const here = { x: 3.5, y: 3.3 };
    const said = { kind: 'locked', label: 'Zu einer Anlage außer Betrieb' };
    expect(contextAction(lab(), here, 'p1', AT_DEAD_BOOK, false, null)).toMatchObject(said);
    const locker = lab({ manuals: [{ ...deadBook, kind: 'locker', opened: false }] });
    const atLocker = [{ ...AT_DEAD_BOOK[0], kind: 'locker', opened: false }] as const;
    expect(contextAction(locker, here, 'p1', atLocker, false, null)).toMatchObject(said);
    // The same book in service reads as ever.
    expect(contextAction(lab(), here, 'p1', [AT_BOOK], false, null)).toMatchObject({
      kind: 'read',
    });
  });
});
