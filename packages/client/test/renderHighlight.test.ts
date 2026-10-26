import { describe, expect, it } from 'vitest';
import {
  drawFusebox,
  drawLeverBox,
  drawManualObject,
  drawPinnedNote,
  drawStation,
} from '../src/world/art.js';
import { artKit } from '../src/world/artKit.js';
import type { CanvasMaker } from '../src/world/atlas.js';
import { drawCarryable, drawDropZone } from '../src/world/hazards.js';
import type { ContextAction } from '../src/world/interact.js';
import type { Frame } from '../src/world/render/frame.js';
import {
  BOB,
  bobLift,
  CORE_ALPHA,
  DROP_SHAPE,
  drawGlow,
  haloAlpha,
  highlightProbe,
  itemShape,
  manualShape,
  noteShape,
  stationShape,
} from '../src/world/render/highlight.js';
import { draw } from '../src/world/render/objects.js';
import { CORE, glowSprite, HALO, type Shape } from '../src/world/silhouette.js';
import {
  callEntries,
  callsOf,
  drawnAt,
  fakeCanvas,
  FakeGradient,
  recording,
  strip,
  type Entry,
  type FakeCanvas,
} from './fakeCanvas.js';
import { frameWith, kitWith, lightWith, TILES } from './frames.js';
import { mapWith, type Item, type Manual } from './fixtures.js';

/** The armed station at (3, 2), a clipboard at (7, 1), a note on the wall over (2, 1), the fuse. */
const STATION = { puzzleId: 'kasten', x: 3, y: 2, title: 'Kasten', status: 'armed' as const };
const CLIPBOARD: Manual = {
  id: 'klemmbrett',
  kind: 'clipboard',
  x: 7,
  y: 1,
  label: 'KLEMMBRETT',
  puzzleIds: ['kasten'],
  opened: true,
  needsKey: null,
};
const NOTE = { index: 0, x: 2, y: 0, read: false };
const FUSE: Item = {
  id: 'fuse',
  label: 'SICHERUNG',
  x: 6.5,
  y: 3.5,
  carriedBy: null,
  delivered: false,
  deliverTo: { x: 8, y: 4 },
  requiredForTitle: null,
};
const LAB = mapWith({
  width: 10,
  height: 6,
  tiles: TILES,
  stations: [STATION],
  manuals: [CLIPBOARD],
  notes: [NOTE],
  items: [FUSE],
});

/** What E does at each of them, as interact.ts says it. */
const OPERATE: ContextAction = {
  kind: 'operate',
  label: 'Bedienen',
  x: 3.5,
  y: 1.45,
  subject: { of: 'station', x: 3, y: 2 },
};
const READ: ContextAction = {
  kind: 'read',
  manualId: 'klemmbrett',
  label: 'Lesen',
  x: 7.5,
  y: 0.45,
  subject: { of: 'manual', id: 'klemmbrett' },
};
const READ_NOTE: ContextAction = {
  kind: 'note',
  index: 0,
  label: 'Lesen',
  x: 2.5,
  y: 0.15,
  subject: { of: 'note', index: 0 },
};
const PICK: ContextAction = {
  kind: 'pick',
  label: 'SICHERUNG aufnehmen',
  x: 6.5,
  y: 2.55,
  subject: { of: 'item', id: 'fuse' },
};
const DELIVER: ContextAction = {
  kind: 'deliver',
  label: 'SICHERUNG einsetzen',
  x: 8.5,
  y: 3.55,
  subject: { of: 'drop', id: 'fuse' },
};

/** The zoom level the frames' 100 px a tile bake at (atlas.ts). */
const LEVEL = 96;

/** What the objects pass drew for `frame`. */
function drawn(frame: Frame): Entry[] {
  const { ctx, log } = fakeCanvas(800, 600);
  draw(ctx, frame);
  return log;
}

/** Where the `nth` `translate(x, y)` of `log` is, from 0; -1 for none. */
function translateAt(log: readonly Entry[], x: number, y: number, nth = 0): number {
  const moves = (entry: Entry): boolean =>
    entry.kind === 'call' &&
    entry.name === 'translate' &&
    entry.args[0] === x &&
    entry.args[1] === y;
  const starts = log.flatMap((entry, i) => (moves(entry) ? [i] : []));
  return starts[nth] ?? -1;
}

/** `log` without what was drawn at (x, y) the `nth` time: save, translate, all to the restore. */
function without(log: readonly Entry[], x: number, y: number, nth = 0): Entry[] {
  const inner = drawnAt(log, x, y, nth);
  const start = translateAt(log, x, y, nth) - 1;
  return [...log.slice(0, start), ...log.slice(start + inner.length + 3)];
}

/** The blits a glow of `shape` lays on at `alpha`, as `frame`'s kit baked it: halo, then core. */
function glowOf(frame: Frame, shape: Shape, alpha: number): unknown[] {
  const halo = glowSprite(frame.kit.art.glows, LEVEL, shape, HALO);
  const core = glowSprite(frame.kit.art.glows, LEVEL, shape, CORE);
  return [
    ['save', []],
    ['globalCompositeOperation=', 'lighter'],
    ['globalAlpha=', expect.closeTo(alpha, 9)],
    ['drawImage', [halo.canvas, halo.x, halo.y, halo.w, halo.h]],
    ['globalAlpha=', CORE_ALPHA],
    ['drawImage', [core.canvas, core.x, core.y, core.w, core.h]],
    ['restore', []],
  ];
}

describe('haloAlpha and bobLift — how the glow breathes and a pickable bobs', () => {
  it('breathes the halo from 0.45 to 0.9 and back over 1.2 s, a sine', () => {
    expect(haloAlpha(0, false)).toBeCloseTo(0.675, 9);
    expect(haloAlpha(0.3, false)).toBeCloseTo(0.9, 9);
    expect(haloAlpha(0.6, false)).toBeCloseTo(0.675, 9);
    expect(haloAlpha(0.9, false)).toBeCloseTo(0.45, 9);
    expect(haloAlpha(0.3 + 1.2 * 7, false)).toBeCloseTo(0.9, 9);
    const breath = Array.from({ length: 600 }, (_, i) => haloAlpha(i / 60, false));
    expect(Math.min(...breath)).toBeGreaterThanOrEqual(0.45 - 1e-9);
    expect(Math.max(...breath)).toBeLessThanOrEqual(0.9 + 1e-9);
    // Smooth: from one frame at 60 Hz to the next it moves no more than the sine's slope allows.
    const steps = breath.slice(1).map((alpha, i) => Math.abs(alpha - (breath[i] ?? alpha)));
    const steepest = (0.225 * 2 * Math.PI) / 1.2;
    expect(Math.max(...steps)).toBeLessThanOrEqual(steepest / 60 + 1e-9);
  });

  it('bobs a pixel of the art up and down over 2 s', () => {
    expect(BOB).toBe(1 / 64);
    expect(bobLift(0, false)).toBeCloseTo(0, 12);
    expect(bobLift(0.5, false)).toBe(1 / 64);
    expect(bobLift(1, false)).toBeCloseTo(0, 12);
    expect(bobLift(1.5, false)).toBeCloseTo(-1 / 64, 12);
    expect(bobLift(2.5, false)).toBeCloseTo(1 / 64, 12);
    // A second apart, the part stands as far below its middle as it stood above it.
    for (const t of [0.2, 0.5, 1.1, 3.7]) {
      expect(bobLift(t + 1, false)).toBeCloseTo(-bobLift(t, false), 12);
    }
  });

  it('holds the halo at 0.7 and bobs nothing where motion is reduced', () => {
    for (const t of [0, 0.3, 0.5, 0.9, 1.5, 12.34]) {
      expect(haloAlpha(t, true)).toBe(0.7);
      expect(bobLift(t, true)).toBe(0);
    }
  });
});

describe('the objects pass — the named thing glows in its own shape, under it', () => {
  it('lays two blits of the station’s bake under it, then draws the station as ever', () => {
    const frame = frameWith({ map: LAB, action: OPERATE, time: 0.3 });
    const log = drawn(frame);
    expect(strip(drawnAt(log, 3.5, 2.5, 0))).toEqual(glowOf(frame, stationShape(STATION, 1), 0.9));
    const look = { status: 'armed' as const, pulse: frame.pulse, console: null };
    expect(strip(drawnAt(log, 3.5, 2.5, 1))).toEqual(recording((c) => drawStation(c, look)));
  });

  it('draws no box: the glow adds its two blits and nothing else to the picture', () => {
    for (const [action, x, y] of [
      [OPERATE, 3.5, 2.5],
      [READ, 7.5, 1.5],
      [READ_NOTE, 2.5, 1],
    ] as const) {
      const plain = drawn(frameWith({ map: LAB, action: null }));
      const named = drawn(frameWith({ map: LAB, action }));
      expect(strip(without(named, x, y))).toEqual(strip(plain));
      const glow = drawnAt(named, x, y);
      const calls = new Set(glow.flatMap((e) => (e.kind === 'call' ? [e.name] : [])));
      const sets = new Set(glow.flatMap((e) => (e.kind === 'set' ? [e.name] : [])));
      expect([...calls].sort()).toEqual(['drawImage', 'restore', 'save']);
      expect([...sets].sort()).toEqual(['globalAlpha', 'globalCompositeOperation']);
      expect(callsOf(named, 'drawImage')).toHaveLength(2);
    }
  });

  it('glows the one thing named, never two: of two consoles, the one E works', () => {
    const consoles = [
      { ...STATION, console: 'a' as const },
      { ...STATION, x: 7, console: 'b' as const },
    ];
    const map = mapWith({ width: 10, height: 6, tiles: TILES, stations: consoles });
    const action = { ...OPERATE, subject: { of: 'station' as const, x: 7, y: 2 } };
    const log = drawn(frameWith({ map, action }));
    expect(callEntries(drawnAt(log, 7.5, 2.5, 0), 'drawImage')).toHaveLength(2);
    expect(callsOf(log, 'drawImage')).toHaveLength(2);
    // Console a is drawn once, by the stations: no glow went before it.
    expect(drawnAt(log, 3.5, 2.5, 1)).toEqual([]);
  });

  it('glows a source, a note and a drop-off each in its own shape, under it', () => {
    const carried = { ...FUSE, carriedBy: 'p1' };
    const held = mapWith({ ...LAB, items: [carried] });
    const cases: [ContextAction, Frame['map'], number, number, Shape][] = [
      [READ, LAB, 7.5, 1.5, manualShape(CLIPBOARD)],
      [READ_NOTE, LAB, 2.5, 1, noteShape(Math.PI / 2)],
      [DELIVER, held, 8.5, 4.5, DROP_SHAPE],
    ];
    for (const [action, map, x, y, shape] of cases) {
      const frame = frameWith({ map, action, time: 0.9 });
      const log = drawn(frame);
      expect(strip(drawnAt(log, x, y, 0))).toEqual(glowOf(frame, shape, 0.45));
      expect(drawnAt(log, x, y, 1)).not.toEqual([]);
    }
    const zone = drawn(frameWith({ map: held, action: DELIVER }));
    expect(strip(drawnAt(zone, 8.5, 4.5, 1))).toEqual(
      recording((c) => drawDropZone(c, false, 0.5)),
    );
  });

  it('bakes a thing from its drawing alone — no shadow, glow or label round it', () => {
    const made: FakeCanvas[] = [];
    const make: CanvasMaker = (width, height) => {
      const fake = fakeCanvas(width, height, `glow ${made.length}`);
      made.push(fake);
      return fake.canvas;
    };
    const kit = { ...kitWith(), art: artKit(make) };
    drawn(frameWith({ map: LAB, action: READ, kit }));
    // The halo's silhouette first: the clipboard as manualShape draws it, at 96 px a tile.
    const silhouette = strip(made[0]?.log ?? []);
    expect(silhouette[0]).toEqual(['setTransform', [LEVEL, 0, 0, LEVEL, 65, 75]]);
    expect(silhouette.slice(1)).toEqual(recording(manualShape(CLIPBOARD).draw));
    const dressed = recording((c) =>
      drawManualObject(c, {
        kind: 'clipboard',
        label: 'KLEMMBRETT',
        active: true,
        opened: true,
        pulse: 0.5,
      }),
    );
    const bare = silhouette.slice(1);
    const isText = (e: unknown): boolean => Array.isArray(e) && e[0] === 'fillText';
    const isLight = (e: unknown): boolean =>
      Array.isArray(e) && e[0] === 'globalCompositeOperation=' && e[1] === 'lighter';
    expect(dressed.some(isText) && dressed.some(isLight)).toBe(true);
    expect(bare.some(isText) || bare.some(isLight)).toBe(false);
  });

  it('bakes once: the frames after the first lay the same bake on', () => {
    const made: string[] = [];
    const make: CanvasMaker = (width, height) => {
      made.push(`${width}x${height}`);
      return fakeCanvas(width, height).canvas;
    };
    const kit = { ...kitWith(), art: artKit(make) };
    const first = drawn(frameWith({ map: LAB, action: OPERATE, kit, time: 0 }));
    // The halo: its silhouette, grown, blurred; the core: its silhouette, blurred.
    expect(made).toHaveLength(5);
    for (const time of [0.016, 0.033, 0.5, 1.2]) {
      const later = drawn(frameWith({ map: LAB, action: OPERATE, kit, time }));
      expect(callsOf(later, 'drawImage')).toEqual(callsOf(first, 'drawImage'));
    }
    expect(made).toHaveLength(5);
  });

  it('lifts the named part off its shadow with its glow; its shadow and label stay put', () => {
    const frame = frameWith({ map: LAB, action: PICK, time: 0.5 });
    const block = drawnAt(drawn(frame), 6.5, 3.5);
    const shape = itemShape('SICHERUNG');
    const look = { label: 'SICHERUNG', pulse: frame.pulse, carried: false, text: frame.text };
    const glow = (g: CanvasRenderingContext2D) => drawGlow(g, frame, shape);
    expect(strip(block)).toEqual(
      recording((c) => drawCarryable(c, { ...look, lift: 1 / 64, glow })),
    );
    const calls = block.flatMap((e, i) => (e.kind === 'call' ? [{ ...e, i }] : []));
    const first = (name: string) => calls.find((e) => e.name === name)?.i ?? -1;
    const up = calls.find((e) => e.name === 'translate' && e.args[1] === -1 / 64);
    // Put back where it was lifted from: the restore at the depth the lift was made at.
    const back = calls.find(
      (e) => e.i > (up?.i ?? 0) && e.name === 'restore' && e.depth === up?.depth,
    );
    const order = [first('ellipse'), up?.i, first('drawImage'), back?.i, first('fillText')];
    // Its shadow, the lift, the glow's blits and the part, back down, then its label.
    expect(order.every((i) => i !== undefined && i >= 0)).toBe(true);
    expect([...order].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(order);
  });

  it('bobs nothing where motion is reduced: the part lies still, its halo held at 0.7', () => {
    const frame = frameWith({ map: LAB, action: PICK, time: 0.5, reduced: true });
    const block = drawnAt(drawn(frame), 6.5, 3.5);
    expect(callsOf(block, 'translate')).toEqual([]);
    expect(callEntries(block, 'drawImage').map((e) => e.alpha)).toEqual([0.7, CORE_ALPHA]);
  });

  it('never moves a station or a source: only parts that can be picked up bob', () => {
    for (const [action, x, y] of [
      [OPERATE, 3.5, 2.5],
      [READ, 7.5, 1.5],
    ] as const) {
      const log = drawn(frameWith({ map: LAB, action, time: 0.5 }));
      expect(translateAt(log, x, y, 0)).toBeGreaterThanOrEqual(0);
      expect(callsOf(drawnAt(log, x, y, 0), 'translate')).toEqual([]);
      expect(highlightProbe(frameWith({ map: LAB, action, time: 0.5 }))?.lift).toBe(0);
    }
  });

  it('glows nothing while the prompt names nothing, or names a part light has not found', () => {
    expect(callsOf(drawn(frameWith({ map: LAB, action: null })), 'drawImage')).toEqual([]);
    const dark = frameWith({ map: LAB, action: PICK, light: lightWith({ shown: () => false }) });
    expect(callsOf(drawn(dark), 'drawImage')).toEqual([]);
    expect(highlightProbe(dark)).toBeNull();
  });
});

describe('the shapes — what each thing is baked from', () => {
  /** Whether a recording fills with a soft radial gradient: a foot shadow or a glow. */
  const soft = (entries: unknown[]): boolean =>
    entries.some(
      (e) =>
        Array.isArray(e) &&
        e[0] === 'fillStyle=' &&
        e[1] instanceof FakeGradient &&
        e[1].gradient === 'radial',
    );

  it('leaves the station’s foot shadow and its own glow out, never its letter', () => {
    const shape = stationShape({ ...STATION, console: 'b' }, 2);
    const full = recording((c) => drawStation(c, { status: 'armed', pulse: 0, console: 'b' }));
    expect(soft(full)).toBe(true);
    expect(soft(recording(shape.draw))).toBe(false);
    const letters = callsOf(fakeDraw(shape), 'fillText').map(([text]) => text);
    expect(letters).toEqual(['B']);
    expect(stationShape({ ...STATION, look: 'lever' }, 3).key).toBe('lever:armed:3');
    expect(stationShape({ ...STATION, look: 'fusebox' }, 3).key).toBe('fusebox:armed:-');
  });

  it('leaves a note’s call for attention out, and turns with its wall', () => {
    const full = recording((c) => drawPinnedNote(c, { facing: null, read: false, pulse: 0.5 }));
    expect(soft(full)).toBe(true);
    expect(soft(recording(noteShape(null).draw))).toBe(false);
    expect(noteShape(Math.PI / 2).key).not.toBe(noteShape(null).key);
  });

  it('leaves a part’s shadow, its blue glow and its label out', () => {
    const bare = fakeDraw(itemShape('SICHERUNG'));
    expect(callsOf(bare, 'ellipse')).toEqual([]);
    expect(callsOf(bare, 'fillText')).toEqual([]);
    expect(callsOf(bare, 'arc')).toEqual([]);
    expect(itemShape('Schlüssel').key).toBe('item:key');
  });

  it('leaves the dressing out of every kind of thing the prompt can name', () => {
    const kinds = ['book', 'terminal', 'chart', 'clipboard', 'locker', 'cabinet'] as const;
    const shapes = [
      stationShape(STATION, 2),
      stationShape({ ...STATION, status: 'done' }, 2),
      stationShape({ ...STATION, look: 'lever' }, 2),
      stationShape({ ...STATION, look: 'fusebox', console: 'a' }, 2),
      ...kinds.flatMap((kind) =>
        [false, true].map((opened) => manualShape({ kind, opened, label: 'QUELLE' })),
      ),
      noteShape(null),
      noteShape(Math.PI / 2),
      noteShape(0),
      itemShape('SICHERUNG'),
      itemShape('SCHLÜSSEL'),
      itemShape('KISTE'),
      DROP_SHAPE,
    ];
    for (const shape of shapes) {
      const log = fakeDraw(shape);
      expect(soft(strip(log)), shape.key).toBe(false);
      const texts = callsOf(log, 'fillText').map(([text]) => text);
      expect(texts.filter((text) => text !== 'A' && text !== 'B'), shape.key).toEqual([]);
      expect(callsOf(log, 'ellipse'), shape.key).toEqual([]);
      expect(callsOf(log, 'arc').filter(([, , r]) => r === 0.8), shape.key).toEqual([]);
    }
    // What is left out is there in the full drawings: the check sees it where it is.
    const lever = recording((c) => drawLeverBox(c, { status: 'armed', pulse: 0, levers: 2 }));
    const fuseBox = recording((c) => drawFusebox(c, { status: 'armed', pulse: 0, console: 'a' }));
    const look = { label: 'QUELLE', active: false, opened: true, pulse: 0 };
    const book = recording((c) => drawManualObject(c, { ...look, kind: 'book' }));
    expect([soft(lever), soft(fuseBox), soft(book)]).toEqual([true, true, true]);
  });
});

/** What `shape` draws on a fresh fake context, with the state of each call. */
function fakeDraw(shape: Shape): Entry[] {
  const { ctx, log } = fakeCanvas();
  shape.draw(ctx);
  return log;
}

describe('highlightProbe — the glow as the walkthrough reads it', () => {
  it('names the thing, where it stands, its halo and lift, and reads its bake back', () => {
    const frame = frameWith({ map: LAB, action: PICK, time: 0.5 });
    drawn(frame);
    const probe = highlightProbe(frame);
    expect(probe).toMatchObject({
      subject: { of: 'item', id: 'fuse' },
      x: 6.5,
      y: 3.5,
      halo: expect.closeTo(haloAlpha(0.5, false), 9),
      lift: 1 / 64,
    });
    const pixels = probe?.pixels();
    const halo = glowSprite(frame.kit.art.glows, LEVEL, itemShape('SICHERUNG'), HALO);
    expect(pixels?.level).toBe(LEVEL);
    expect([pixels?.width, pixels?.height]).toEqual([halo.canvas.width, halo.canvas.height]);
    expect(pixels?.halo).toHaveLength(halo.canvas.width * halo.canvas.height);
    expect(pixels?.silhouette).toHaveLength(halo.canvas.width * halo.canvas.height);
    expect(highlightProbe(frameWith({ map: LAB, action: null }))).toBeNull();
  });
});
