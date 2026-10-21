import { describe, expect, it } from 'vitest';
import {
  drawDoor,
  drawEmergencyLamp,
  drawExitHatch,
  drawFusebox,
  drawLeverBox,
  drawManualObject,
  drawPlate,
  drawSign,
  drawStation,
  plateCaption,
} from '../src/world/art.js';
import { doorOpenness, type DoorMotion } from '../src/world/doors.js';
import { drawCarryable, drawDropZone, drawSabotagePanel } from '../src/world/hazards.js';
import { draw } from '../src/world/render/objects.js';
import { callsOf, drawnAt, fakeCanvas, recording, strip } from './fakeCanvas.js';
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
  id: 'fuse',
  label: 'SICHERUNG',
  x: 2.5,
  y: 3.5,
  carriedBy: null,
  delivered: false,
  deliverTo: null,
  requiredForTitle: null,
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
      { puzzleId: 'licht', x: 2, y: 1, title: 'Notlicht', status: 'armed', look: 'lever' },
      { puzzleId: 'kasten', x: 7, y: 1, title: 'Kasten', status: 'armed', console: 'b' },
      { puzzleId: 'kasten', x: 6, y: 4, title: 'Kasten', status: 'done' },
      { puzzleId: 'tasten', x: 8, y: 3, title: 'Tasten', status: 'locked' },
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
    expect(strip(drawnAt(log, 7.5, 1.5))).toEqual(
      recording((c) => drawStation(c, { status: 'armed', pulse: 0.3, console: 'b' })),
    );
    expect(strip(drawnAt(log, 6.5, 4.5))).toEqual(
      recording((c) => drawStation(c, { status: 'done', pulse: 0.3, console: null })),
    );
    expect(drawnAt(log, 8.5, 3.5)).toEqual([]);
  });

  it('lights up a manual object while it prints the armed station’s rules', () => {
    const armed = { puzzleId: 'kasten', x: 7, y: 1, title: 'Kasten', status: 'armed' as const };
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

  it('always shows the sign, the hatch as far open as the frame says, and the valves', () => {
    const panels = [{ id: 'v', x: 7, y: 2, occupied: true }];
    const map = lab({
      edgeworkSign: { x: 1, y: 4 },
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
    const key = item({ id: 'key', label: 'SCHLÜSSEL', x: 1.5, y: 1.5, deliverTo: { x: 4, y: 1 } });
    const carried = item({ id: 'crate', label: 'KISTE', x: 3.5, y: 2.5, carriedBy: 'p2' });
    const dark = item({ id: 'far', x: 7.5, y: 3.5, deliverTo: { x: 8, y: 1 } });
    const cabinet = manual({ id: 'cab', kind: 'cabinet', x: 4, y: 1, needsKey: 'key' });
    const map = lab({ items: [fuse, key, carried, dark], manuals: [cabinet] });
    const frame = frameWith({ map, light: leftOnly });
    const log = drawn(frame);
    const { pulse, text } = frame;
    expect(strip(drawnAt(log, 3.5, 4.5))).toEqual(recording((c) => drawDropZone(c, false, pulse)));
    expect(strip(drawnAt(log, 2.5, 3.5))).toEqual(
      recording((c) => drawCarryable(c, { label: 'SICHERUNG', pulse, carried: false, text })),
    );
    expect(strip(drawnAt(log, 1.5, 1.5))).toEqual(
      recording((c) => drawCarryable(c, { label: 'SCHLÜSSEL', pulse, carried: false, text })),
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

  it('stands the furniture where light has fallen, from the atlas, lit where its tile is', () => {
    const decor = [
      { kind: 'shelf' as const, x: 1, y: 1, variant: 2 },
      { kind: 'barrel' as const, x: 7, y: 3 },
    ];
    const light = lightWith({ shown: (x) => x < 5, powered: (x, y) => x === 1 && y === 1 });
    const frame = frameWith({ map: lab({ decor }), light });
    const log = drawn(frame);
    const sprites = [...(frame.kit.art.atlas.levels.get(96) ?? new Map()).entries()];
    const shelf = sprites.find(([key]) => key === 'decor:shelf:2:lit')?.[1];
    expect(shelf).toBeDefined();
    expect(callsOf(log, 'drawImage')).toEqual([[shelf?.canvas, 1, 1, 1, 1]]);
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
    const won = drawn({ ...frame, ending: { lit: 0.1, pull: 0, dark: 0 } });
    expect(strip(drawnAt(won, 1.5, 1.5))).toEqual(strip(drawnAt(powered, 1.5, 1.5)));
  });
});
