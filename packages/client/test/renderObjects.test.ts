import { describe, expect, it } from 'vitest';
import type { Find, MapNote, MapPart, MapSource } from '@escapelab/core';
import {
  drawDoor,
  drawEmergencyLamp,
  drawExitHatch,
  drawFusebox,
  drawLeverBox,
  drawManualObject,
  drawPinnedNote,
  drawPlate,
  drawSign,
  drawStation,
  LABEL_BELOW,
  plateCaption,
  textBox,
  worldText,
} from '../src/world/art.js';
import { doorOpenness, type DoorMotion } from '../src/world/doors.js';
import { drawCarryable, drawDropZone, drawSabotagePanel } from '../src/world/hazards.js';
import { objectGlows } from '../src/world/render/darkness.js';
import { tubeAt } from '../src/world/render/looks.js';
import { draw } from '../src/world/render/objects.js';
import { callEntries, callsOf, drawnAt, fakeCanvas, recording, strip } from './fakeCanvas.js';
import { frameWith, lightWith, player, TILES } from './frames.js';
import { mapWith, type Item, type Manual, type Plate } from './fixtures.js';

/** The lab with `parts` in it. */
const lab = (parts: Parameters<typeof mapWith>[0]) =>
  mapWith({ width: 10, height: 6, tiles: TILES, ...parts });

/** Light has fallen on the left room only. */
const leftOnly = lightWith({ shown: (x) => x < 5 });

const plate = (parts: Partial<Plate>): Plate => ({
  id: 'p',
  x: 2,
  y: 2,
  label: 'HALTEN',
  pressed: false,
  freezesDrone: false,
  ...parts,
});

const manual = (parts: Partial<Manual>): Manual => ({
  found: true,
  known: true,
  id: 'm',
  kind: 'book',
  x: 3,
  y: 1,
  label: 'HANDBUCH',
  puzzleIds: [],
  opened: true,
  needsKey: null,
  ...parts,
});

const item = (parts: Partial<Item>): Item => ({
  found: true,
  known: true,
  id: 'fuse',
  kind: 'fuse',
  label: 'SICHERUNG',
  x: 2.5,
  y: 3.5,
  carriedBy: null,
  delivered: false,
  deliverTo: null,
  requiredFor: null,
  ...parts,
});

/** What the pass drew for `frame`. */
function drawn(frame: ReturnType<typeof frameWith>) {
  const { ctx, log } = fakeCanvas(800, 600);
  draw(ctx, frame);
  return log;
}

describe('objects — the lab’s things, in tile space', () => {
  it('draws in tiles as the camera looks', () => {
    const log = drawn(frameWith({ camera: { x: 4, y: 2, scale: 50 } }));
    expect(strip(log.slice(0, 1))).toEqual([
      ['setTransform', [50, 0, 0, 50, 400 - 200, 300 - 100]],
    ]);
  });

  it('draws a plate only where light has fallen, as the art draws it', () => {
    const near = plate({ id: 'near', pressed: true });
    const far = plate({ id: 'far', x: 7, y: 3, freezesDrone: true });
    const frame = frameWith({ map: lab({ plates: [near, far] }), light: leftOnly });
    const log = drawn(frame);
    const look = { pressed: true, label: plateCaption(near), camera: false, text: frame.text };
    expect(strip(drawnAt(log, 2.5, 2.5))).toEqual(recording((c) => drawPlate(c, look)));
    expect(drawnAt(log, 7.5, 3.5)).toEqual([]);
  });

  it('draws every door, seen or not, as far open as its slide has come by the frame', () => {
    const now = 1_000_000;
    const motion: DoorMotion = { from: 0, to: 1, since: now - 100 };
    const doors = [
      { id: 'sliding', x: 5, y: 2, open: true },
      { id: 'still', x: 2, y: 5, open: false },
    ];
    const frame = frameWith({ map: lab({ doors }), now, doors: new Map([['sliding', motion]]) });
    const log = drawn(frame);
    const openT = doorOpenness(motion, now);
    expect(openT).toBeGreaterThan(0);
    expect(openT).toBeLessThan(1);
    expect(strip(drawnAt(log, 5.5, 2.5))).toEqual(
      recording((c) => drawDoor(c, { openT, horizontal: false })),
    );
    expect(strip(drawnAt(log, 2.5, 5.5))).toEqual(
      recording((c) => drawDoor(c, { openT: 0, horizontal: true })),
    );
  });

  it('hides a locked station in the dark; a main switch has a lever per connected player', () => {
    type Station = Parameters<typeof lab>[0]['stations'];
    const stations: Station = [
      {
        puzzleId: 'licht',
        x: 2,
        y: 1,
        title: 'Notlicht',
        status: 'armed',
        look: 'lever',
        found: false,
        known: true,
      },
      {
        puzzleId: 'kasten',
        x: 7,
        y: 1,
        title: 'Kasten',
        status: 'armed',
        console: 'b',
        found: false,
        known: true,
      },
      {
        puzzleId: 'kasten',
        x: 6,
        y: 4,
        title: 'Kasten',
        status: 'done',
        found: false,
        known: true,
      },
      {
        puzzleId: 'tasten',
        x: 8,
        y: 3,
        title: 'Tasten',
        status: 'locked',
        found: false,
        known: true,
      },
    ];
    const players = [
      player('p1', 'Anna', '#fff'),
      player('p2', 'Ben', '#f0f'),
      player('p3', 'Cleo', '#0ff', false),
    ];
    const frame = frameWith({ map: lab({ stations }), light: leftOnly, players, pulse: 0.3 });
    const log = drawn(frame);
    expect(strip(drawnAt(log, 2.5, 1.5))).toEqual(
      recording((c) => drawLeverBox(c, { status: 'armed', pulse: 0.3, levers: 2 })),
    );
    const kasten = { status: 'armed' as const, pulse: 0.3, console: 'b' as const };
    expect(strip(drawnAt(log, 7.5, 1.5))).toEqual(
      recording((c) => drawStation(c, { ...kasten, tube: tubeAt(frame, 7, 1) })),
    );
    const done = { status: 'done' as const, pulse: 0.3, console: null };
    expect(strip(drawnAt(log, 6.5, 4.5))).toEqual(
      recording((c) => drawStation(c, { ...done, tube: tubeAt(frame, 6, 4) })),
    );
    expect(drawnAt(log, 8.5, 3.5)).toEqual([]);
  });

  it('lights up a manual object while it prints the armed station’s rules', () => {
    const kasten = { puzzleId: 'kasten', x: 7, y: 1, title: 'Kasten' };
    const armed = { ...kasten, status: 'armed' as const, found: false, known: true as const };
    const rules = manual({ id: 'rules', puzzleIds: ['kasten'] });
    const other = manual({ id: 'other', kind: 'locker', x: 8, y: 4, opened: false });
    const map = lab({ stations: [armed], manuals: [rules, other] });
    const frame = frameWith({ map, light: leftOnly });
    const log = drawn(frame);
    const { pulse, text } = frame;
    const book = { kind: 'book' as const, label: 'HANDBUCH' };
    const look = { ...book, active: true, opened: true, pulse, text };
    const locker = { ...look, kind: 'locker' as const, active: false, opened: false };
    expect(strip(drawnAt(log, 3.5, 1.5))).toEqual(recording((c) => drawManualObject(c, look)));
    expect(strip(drawnAt(log, 8.5, 4.5))).toEqual(recording((c) => drawManualObject(c, locker)));
  });

  describe('labels on a phone', () => {
    // A phone held sideways: 30.7 CSS px a tile, drawn at 2 device px each — a label 10 px
    // high, „HALTEN · TÜR" under the Flur's plate and „KLEMMBRETT" under the clipboard two
    // tiles on run into each other.
    const text = worldText(61.4, 2);
    const holding = plate({ id: 'flur', x: 6, y: 4 });
    const board = manual({ id: 'klemmbrett', kind: 'clipboard', x: 8, y: 4, label: 'KLEMMBRETT' });
    const kette = { puzzleId: 'kette', x: 1, y: 1, title: 'Kette' };
    const armed = { ...kette, status: 'armed' as const, found: false, known: true as const };

    /** Where each label was drawn, its top under its thing, tiles: from the text's y. */
    function labelTops(log: ReturnType<typeof drawn>): Map<string, number> {
      const tops = new Map<string, number>();
      for (const [at, words] of [
        [[6.5, 4.5], 'HALTEN · TÜR'],
        [[8.5, 4.5], 'KLEMMBRETT'],
      ] as const) {
        const call = callsOf(drawnAt(log, at[0], at[1]), 'fillText').find((a) => a[0] === words);
        if (call !== undefined) {
          // The world's text is drawn 32 times larger inside a matching down-scale (art.ts).
          tops.set(words, Number(call[2]) / 32);
        }
      }
      return tops;
    }

    it('moves the label that matters less a line down, clear of the other', () => {
      const map = lab({ plates: [holding], manuals: [board] });
      const tops = labelTops(drawn(frameWith({ map, text })));
      expect(plateCaption(holding)).toBe('HALTEN · TÜR');
      expect(tops.get('HALTEN · TÜR')).toBe(LABEL_BELOW);
      const { height } = textBox(fakeCanvas().ctx, 'KLEMMBRETT', text.label);
      expect(tops.get('KLEMMBRETT')).toBeGreaterThan(LABEL_BELOW + height);
    });

    it('lets the armed station’s source keep its place, the plate’s label moving instead', () => {
      const rules = { ...board, puzzleIds: ['kette'] };
      const map = lab({ plates: [holding], manuals: [rules], stations: [armed] });
      const tops = labelTops(drawn(frameWith({ map, text })));
      expect(tops.get('KLEMMBRETT')).toBe(LABEL_BELOW);
      expect(tops.get('HALTEN · TÜR')).toBeGreaterThan(LABEL_BELOW);
    });

    it('leaves both in their places where they lie apart', () => {
      const far = { ...board, x: 1 };
      const map = lab({ plates: [holding], manuals: [far] });
      const tops = labelTops(drawn(frameWith({ map, text })));
      expect(tops.get('HALTEN · TÜR')).toBe(LABEL_BELOW);
    });

    it('gives a thing not found yet no room: the plate keeps its place beside it', () => {
      const rules = { ...board, puzzleIds: ['kette'] };
      const map = lab({ plates: [holding], manuals: [rules], stations: [armed] });
      const unfound = (find: Find) => (find.of === 'source' ? 0 : 1);
      const tops = labelTops(drawn(frameWith({ map, text, labels: unfound })));
      expect(tops.has('KLEMMBRETT')).toBe(false);
      expect(tops.get('HALTEN · TÜR')).toBe(LABEL_BELOW);
    });
  });

  it('pins a found note to its wall’s face, or lays it on the floor, unread ones calling', () => {
    // (2,0) is wall over the floor at (2,1); (7,2) is floor; (5,5) wall with no floor beside.
    const notes: MapNote[] = [
      { index: 0, x: 2, y: 0, read: false, found: true, known: true },
      { index: 1, x: 7, y: 2, read: true, found: true, known: true },
      { index: 2, x: 5, y: 5, read: false, found: true, known: true },
    ];
    const frame = frameWith({ map: lab({ notes }), light: lightWith({ shown: () => false }) });
    const log = drawn(frame);
    const { pulse } = frame;
    expect(strip(drawnAt(log, 2.5, 1))).toEqual(
      recording((c) => drawPinnedNote(c, { facing: Math.PI / 2, read: false, pulse })),
    );
    expect(strip(drawnAt(log, 7.5, 2.5))).toEqual(
      recording((c) => drawPinnedNote(c, { facing: null, read: true, pulse })),
    );
    expect(drawnAt(log, 5.5, 5.5)).toEqual([]);
    // Read or not is told apart: the call for attention goes once somebody has read it.
    const unread = recording((c) => drawPinnedNote(c, { facing: null, read: false, pulse: 0.5 }));
    const read = recording((c) => drawPinnedNote(c, { facing: null, read: true, pulse: 0.5 }));
    expect(unread).not.toEqual(read);
    expect(callsOf(log, 'save').length).toBe(callsOf(log, 'restore').length);
  });

  it('lets a found note glow in the dark, on its wall’s face, fainter once read', () => {
    const notes: MapNote[] = [
      { index: 0, x: 2, y: 0, read: false, found: true, known: true },
      { index: 1, x: 7, y: 2, read: true, found: true, known: true },
    ];
    const glows = objectGlows(frameWith({ map: lab({ notes }) }));
    expect(glows).toEqual(
      expect.arrayContaining([
        { x: 2.5, y: 1 - 0.35, radius: 0.9, strength: 0.5 },
        { x: 7.5, y: 2.5, radius: 0.9, strength: 0.3 },
      ]),
    );
  });

  it('lets nothing nobody has come across glow in the dark: no note, source or sign', () => {
    const glimpse = { seen: true, found: false, known: false } as const;
    const notes: MapNote[] = [{ index: 1, x: 7, y: 2, ...glimpse }];
    const glimpsed: MapSource = { id: 'tafel', kind: 'chart', x: 3, y: 4, ...glimpse };
    const glows = objectGlows(frameWith({ map: lab({ notes, manuals: [glimpsed] }) }));
    expect(glows.filter((glow) => glow.radius === 0.9 || glow.radius === 1.3)).toEqual([]);
    const tafel = manual({ id: 'tafel', kind: 'chart', x: 3, y: 4, found: false });
    const known = objectGlows(frameWith({ map: lab({ manuals: [tafel] }) }));
    expect(known).toContainEqual({ x: 3.5, y: 4.5, radius: 1.3, strength: 0.5 });
    // A part lies unfound in the light: drawn as it is, no beacon round it until found.
    const part: MapPart = { id: 'fuse', kind: 'fuse', x: 2.5, y: 3.5, ...glimpse };
    expect(objectGlows(frameWith({ map: lab({ items: [part] }) }))).toEqual([]);
    expect(objectGlows(frameWith({ map: lab({ items: [item({ found: true })] }) }))).toEqual([
      { x: 2.5, y: 3.5, radius: 1.6, strength: 0.7 },
    ]);
    // Nor the sign, through its walls, before somebody of the crew has found it.
    const sign = (known: boolean) => lab({ edgeworkSign: { x: 1, y: 4, found: false, known } });
    expect(objectGlows(frameWith({ map: sign(false) }))).toEqual([]);
    expect(objectGlows(frameWith({ map: sign(true) }))).toEqual([
      { x: 1.5, y: 4.5, radius: 1.4, strength: 0.6 },
    ]);
  });

  it('always shows the sign, the hatch as far open as the frame says, and the valves', () => {
    const panels = [{ id: 'v', x: 7, y: 2, occupied: true }];
    const map = lab({
      edgeworkSign: { x: 1, y: 4, found: true, known: true },
      exit: { x: 8, y: 4, open: true, openedAt: 1, atExit: [] },
      sabotage: { label: 'Notfall', hint: '', endsAt: 0, panels },
    });
    const light = lightWith({ shown: () => false });
    const frame = frameWith({ map, light, hatch: 0.4, signSeen: true });
    const log = drawn(frame);
    const sign = { label: 'LABORKENNUNG', seen: true, pulse: frame.pulse, text: frame.text };
    expect(strip(drawnAt(log, 1.5, 4.5))).toEqual(recording((c) => drawSign(c, sign)));
    expect(strip(drawnAt(log, 8.5, 4.5))).toEqual(
      recording((c) => drawExitHatch(c, { open: 0.4, pulse: frame.pulse })),
    );
    expect(strip(drawnAt(log, 7.5, 2.5))).toEqual(
      recording((c) => drawSabotagePanel(c, true, frame.pulse)),
    );
  });

  it('draws loose items and drop-offs where light fell — none for a cabinet’s key', () => {
    const fuse = item({ deliverTo: { x: 3, y: 4 } });
    const keyAt = { x: 1.5, y: 1.5, deliverTo: { x: 4, y: 1 } };
    const key = item({ id: 'key', kind: 'key', label: 'SCHLÜSSEL', ...keyAt });
    const crate = { id: 'crate', kind: 'crate' as const, label: 'KISTE' };
    const carried = item({ ...crate, x: 3.5, y: 2.5, carriedBy: 'p2' });
    const dark = item({ id: 'far', x: 7.5, y: 3.5, deliverTo: { x: 8, y: 1 } });
    const cabinet = manual({ id: 'cab', kind: 'cabinet', x: 4, y: 1, needsKey: 'key' });
    const map = lab({ items: [fuse, key, carried, dark], manuals: [cabinet] });
    const frame = frameWith({ map, light: leftOnly });
    const log = drawn(frame);
    const { pulse, text } = frame;
    expect(strip(drawnAt(log, 3.5, 4.5))).toEqual(recording((c) => drawDropZone(c, false, pulse)));
    expect(strip(drawnAt(log, 2.5, 3.5))).toEqual(
      recording((c) =>
        drawCarryable(c, { kind: 'fuse', label: 'SICHERUNG', pulse, carried: false, text }),
      ),
    );
    expect(strip(drawnAt(log, 1.5, 1.5))).toEqual(
      recording((c) =>
        drawCarryable(c, { kind: 'key', label: 'SCHLÜSSEL', pulse, carried: false, text }),
      ),
    );
    expect(drawnAt(log, 3.5, 2.5)).toEqual([]);
    expect(drawnAt(log, 7.5, 3.5)).toEqual([]);
    expect(drawnAt(log, 8.5, 1.5)).toEqual([]);
    // The cabinet itself is drawn at (4, 1); its key's drop-off is not drawn over it.
    expect(drawnAt(log, 4.5, 1.5)).not.toEqual([]);
    expect(drawnAt(log, 4.5, 1.5, 1)).toEqual([]);
  });

  it('draws a circuit’s box as a fuse box', () => {
    type Station = Parameters<typeof lab>[0]['stations'];
    const stations: Station = [
      {
        found: false,
        known: true,
        puzzleId: 'kasten',
        x: 2,
        y: 1,
        title: 'Kasten',
        status: 'armed',
        console: 'a',
        look: 'fusebox',
      },
    ];
    const log = drawn(frameWith({ map: lab({ stations }), pulse: 0.3 }));
    expect(strip(drawnAt(log, 2.5, 1.5))).toEqual(
      recording((c) => drawFusebox(c, { status: 'armed', pulse: 0.3, console: 'a' })),
    );
  });

  it('leaves the furniture to the floor it is baked with (render/tiles.ts)', () => {
    const decor = [
      { kind: 'shelf' as const, x: 1, y: 1, variant: 2 },
      { kind: 'barrel' as const, x: 7, y: 3 },
    ];
    const frame = frameWith({ map: lab({ decor }) });
    expect(callsOf(drawn(frame), 'drawImage')).toEqual([]);
    expect(frame.kit.art.atlas.levels.size).toBe(0);
  });

  it('burns an emergency lamp in a dark room — dark with the power on or the room lit', () => {
    const mounts = [
      { x: 1.5, y: 1.5, facing: null },
      { x: 8.05, y: 2.5, facing: Math.PI },
    ];
    const frame = frameWith({ mounts, litTiles: new Set(['8,2']), burn: 0.8 });
    const dark = drawn(frame);
    expect(strip(drawnAt(dark, 1.5, 1.5))).toEqual(
      recording((c) => drawEmergencyLamp(c, { glow: 0.8, facing: null })),
    );
    expect(strip(drawnAt(dark, 8.05, 2.5))).toEqual(
      recording((c) => drawEmergencyLamp(c, { glow: 0, facing: Math.PI })),
    );
    const powered = drawn({ ...frame, scene: { lit: true, cover: 0 } });
    expect(strip(drawnAt(powered, 1.5, 1.5))).toEqual(
      recording((c) => drawEmergencyLamp(c, { glow: 0, facing: null })),
    );
    const won = drawn({ ...frame, ending: { lit: 0.1, pull: 0, dark: 0 }, whole: 0.1 });
    expect(strip(drawnAt(won, 1.5, 1.5))).toEqual(strip(drawnAt(powered, 1.5, 1.5)));
  });
});

describe('objects — names wait for discovery', () => {
  /** The Kasten up, and a chart printing its rules. */
  const armed = {
    puzzleId: 'kasten',
    x: 7,
    y: 1,
    title: 'Kasten',
    status: 'armed' as const,
    found: true,
    known: true as const,
  };
  /** The chart as the crew knows it: whole, with its name and the rules it prints. */
  const tafel = manual({ id: 'tafel', kind: 'chart', label: 'TAFEL', puzzleIds: ['kasten'] });
  /** The chart in sight, nobody having found it: what it is and where, no more. */
  const glimpse = { seen: true, found: false, known: false } as const;
  const glimpsed: MapSource = { id: 'tafel', kind: 'chart', x: tafel.x, y: tafel.y, ...glimpse };

  it('draws a source nobody has found where light fell, as what it is: no name, no glow', () => {
    const map = lab({ stations: [armed], manuals: [glimpsed] });
    const frame = frameWith({ map, light: leftOnly, labels: () => 0 });
    const here = drawnAt(drawn(frame), 3.5, 1.5);
    const { pulse, text } = frame;
    // What it prints is not on the map: unlit and shut, nothing about it calls for attention.
    const look = { kind: 'chart' as const, active: false, opened: false, pulse, text };
    const plain = { ...look, tube: tubeAt(frame, 3, 1), found: 0 };
    expect(strip(here)).toEqual(recording((c) => drawManualObject(c, plain)));
    expect(callsOf(here, 'fillText')).toEqual([]);
    // Found, it is whole: named, and lit for the armed station whose rules it prints.
    const whole = lab({ stations: [armed], manuals: [tafel] });
    const lights = frameWith({ map: whole, light: leftOnly, labels: () => 1 });
    const lit = { ...plain, label: 'TAFEL', active: true, opened: true, found: 1 };
    expect(strip(drawnAt(drawn(lights), 3.5, 1.5))).toEqual(
      recording((c) => drawManualObject(c, lit)),
    );
    // In the dark and unknown to the crew it is not drawn at all; known, it is — unnamed.
    const dark = lightWith({ shown: () => false });
    expect(drawnAt(drawn(frameWith({ map, light: dark, labels: () => 0 })), 3.5, 1.5)).toEqual([]);
    const known = lab({ manuals: [{ ...tafel, found: false }] });
    const lookedAt = frameWith({ map: known, light: dark, labels: () => 0 });
    const unnamed = drawnAt(drawn(lookedAt), 3.5, 1.5);
    expect(unnamed).not.toEqual([]);
    expect(callsOf(unnamed, 'fillText')).toEqual([]);
  });

  it('lights a source for the armed station only once this player has found it', () => {
    // The crew knows the chart, the armed station's rules on it, but this player has not found it.
    const map = lab({ stations: [armed], manuals: [{ ...tafel, found: false }] });
    const drawnWith = (found: number) => {
      const frame = frameWith({ map, light: leftOnly, labels: () => found });
      return { frame, here: strip(drawnAt(drawn(frame), 3.5, 1.5)) };
    };
    const before = drawnWith(0);
    const { pulse, text } = before.frame;
    const tube = tubeAt(before.frame, 3, 1);
    const look = { kind: 'chart' as const, label: 'TAFEL', opened: true, pulse, text, tube };
    expect(before.here).toEqual(
      recording((c) => drawManualObject(c, { ...look, active: false, found: 0 })),
    );
    expect(drawnWith(1).here).toEqual(
      recording((c) => drawManualObject(c, { ...look, active: true, found: 1 })),
    );
  });

  it('draws a part nobody has found as what it is: no name to show, whatever the fade', () => {
    const part: MapPart = { id: 'fuse', kind: 'fuse', x: 2.5, y: 3.5, ...glimpse };
    const log = drawn(frameWith({ map: lab({ items: [part] }), labels: () => 1 }));
    const here = drawnAt(log, 2.5, 3.5);
    expect(here).not.toEqual([]);
    expect(callsOf(here, 'fillText')).toEqual([]);
  });

  it('brings a name up as far as its fade has come', () => {
    const map = lab({ manuals: [tafel] });
    const texts = (found: number) =>
      callEntries(drawnAt(drawn(frameWith({ map, labels: () => found })), 3.5, 1.5), 'fillText');
    expect(texts(0.5).map((call) => [call.args[0], call.alpha])).toEqual([['TAFEL', 0.5]]);
    expect(texts(1).map((call) => [call.args[0], call.alpha])).toEqual([['TAFEL', 1]]);
    expect(texts(0)).toEqual([]);
  });

  it('names a part and the sign only once found; a note unfound calls for nobody', () => {
    const fuse = item({});
    const notes: MapNote[] = [{ index: 0, x: 7, y: 2, ...glimpse }];
    const sign = { x: 1, y: 4, found: false, known: false };
    const map = lab({ items: [fuse], notes, edgeworkSign: sign });
    const log = drawn(frameWith({ map, labels: () => 0 }));
    expect(callsOf(drawnAt(log, 2.5, 3.5), 'fillText')).toEqual([]);
    expect(callsOf(drawnAt(log, 1.5, 4.5), 'fillText')).toEqual([]);
    const { pulse } = frameWith({});
    const silent = { facing: null, read: false, pulse, found: 0 };
    expect(strip(drawnAt(log, 7.5, 2.5))).toEqual(recording((c) => drawPinnedNote(c, silent)));
    expect(recording((c) => drawPinnedNote(c, silent))).toEqual(
      recording((c) => drawPinnedNote(c, { ...silent, read: true })),
    );
    const named = drawn(frameWith({ map, labels: () => 1 }));
    expect(callsOf(drawnAt(named, 2.5, 3.5), 'fillText')).toEqual([['SICHERUNG', 0, 0.41 * 32]]);
    expect(callsOf(drawnAt(named, 1.5, 4.5), 'fillText').map((args) => args[0])).toEqual([
      'LABORKENNUNG',
    ]);
  });
});
