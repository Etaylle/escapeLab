import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chime, MapView } from '@escapelab/core';
import { chimeEar, findWords, hearChimes, type Listening } from '../src/world/finds.js';
import type { Caption } from '../src/world/render/frame.js';
import { fakeAudio, freshAudio, startsOf } from './fakeAudio.js';
import { mapWith, type Item, type Manual } from './fixtures.js';

const T = 1_000_000;
const RUN = 7;

const locker: Manual = {
  id: 'spind',
  kind: 'locker',
  x: 6,
  y: 3,
  label: 'SPIND',
  puzzleIds: ['kabel'],
  opened: false,
  needsKey: null,
  found: true,
  known: true,
};
const fuse: Item = {
  id: 'sicherung',
  label: 'SICHERUNG',
  x: 3.5,
  y: 4.5,
  carriedBy: null,
  delivered: false,
  deliverTo: null,
  requiredForTitle: null,
  found: true,
};
type Station = MapView['stations'][number];
const station = (parts: Partial<Station>): Station => ({
  puzzleId: 'kabel',
  x: 9,
  y: 2,
  title: 'Kabel',
  status: 'armed',
  found: true,
  ...parts,
});

const SPIND: Chime = { find: { of: 'source', id: 'spind' }, at: T };
const SIGN: Chime = { find: { of: 'sign' }, at: T + 1500 };

/** A screen that has looked before, its run under way, nothing holding it, the server at `now`. */
const looking = (serverNow: number, parts: Partial<Listening> = {}): Listening => ({
  run: RUN,
  first: false,
  held: false,
  serverNow,
  ...parts,
});

describe('hearChimes — which of the view’s chimes this screen answers', () => {
  it('answers a new chime once, there and then', () => {
    const first = hearChimes(chimeEar(RUN), [SPIND], looking(T + 40));
    expect(first.due).toEqual([SPIND]);
    expect(hearChimes(first.ear, [SPIND], looking(T + 80)).due).toEqual([]);
    const next = hearChimes(first.ear, [SPIND, SIGN], looking(T + 1540));
    expect(next.due).toEqual([SIGN]);
    expect(next.ear.heard.map((h) => [h.find.of, h.sounded])).toEqual([
      ['source', true],
      ['sign', true],
    ]);
  });

  it('answers nothing that chimed before the screen first looked', () => {
    const { ear, due } = hearChimes(chimeEar(null), [SPIND], looking(T + 40, { first: true }));
    expect(due).toEqual([]);
    expect(hearChimes(ear, [SPIND, SIGN], looking(T + 1540)).due).toEqual([SIGN]);
  });

  it('lets a chime go while the opening holds the screen, or once it comes late, for good', () => {
    const held = hearChimes(chimeEar(RUN), [SPIND], looking(T + 40, { held: true }));
    expect(held.due).toEqual([]);
    expect(held.ear.heard.map((h) => h.sounded)).toEqual([false]);
    expect(hearChimes(held.ear, [SPIND], looking(T + 400)).due).toEqual([]);
    // Kept back past the gap by a stalled line, it is no chime of this moment.
    expect(hearChimes(chimeEar(RUN), [SPIND], looking(T + 1501)).due).toEqual([]);
    expect(hearChimes(chimeEar(RUN), [SPIND], looking(T + 1500)).due).toEqual([SPIND]);
  });

  it('starts afresh with a run of its own', () => {
    const before = hearChimes(chimeEar(RUN), [SPIND], looking(T + 40)).ear;
    const next = hearChimes(before, [SIGN], looking(T + 1540, { run: RUN + 1 }));
    expect(next.due).toEqual([SIGN]);
    expect(next.ear).toEqual({ run: RUN + 1, taken: 1, heard: [{ ...SIGN, sounded: true }] });
  });
});

describe('findWords — what rises over a find', () => {
  const map = mapWith({
    manuals: [locker],
    notes: [{ index: 0, x: 2, y: 0, read: false, found: true, known: true }],
    items: [fuse, { ...fuse, id: 'key', label: 'SCHLÜSSEL' }],
    stations: [
      station({ puzzleId: 'licht', x: 11, y: 7, look: 'lever' }),
      station({ x: 1, y: 12, console: 'a', look: 'fusebox' }),
      station({ x: 2, y: 7, console: 'b' }),
      station({ puzzleId: 'code', x: 9, y: 3 }),
    ],
    edgeworkSign: { x: 2, y: 3, found: true },
    tiles: ['#####', '#...#', '#####'],
  });

  it('names each kind of thing as the lab does, over it', () => {
    expect(findWords(map, { of: 'source', id: 'spind' })).toEqual({
      x: 6.5,
      y: 3,
      text: 'Spind entdeckt',
    });
    expect(findWords(map, { of: 'item', id: 'sicherung' })).toEqual({
      x: 3.5,
      y: 4,
      text: 'Sicherung entdeckt',
    });
    const say = (find: Parameters<typeof findWords>[1]) => findWords(map, find)?.text;
    expect(say({ of: 'note', index: 0 })).toBe('Notiz entdeckt');
    expect(say({ of: 'item', id: 'key' })).toBe('Schlüssel entdeckt');
    expect(say({ of: 'console', puzzleId: 'licht', console: null })).toBe('Hauptschalter entdeckt');
    const box = say({ of: 'console', puzzleId: 'kabel', console: 'a' });
    expect(box).toBe('Sicherungskasten entdeckt');
    expect(say({ of: 'console', puzzleId: 'kabel', console: 'b' })).toBe('Pult B entdeckt');
    expect(say({ of: 'console', puzzleId: 'code', console: null })).toBe('Pult entdeckt');
    expect(say({ of: 'sign' })).toBe('Laborkennung entdeckt');
    expect(findWords(map, { of: 'source', id: 'nix' })).toBeNull();
  });
});

describe('answerChimes — the chime and its caption, on the fake engine', () => {
  beforeEach(() => fakeAudio());
  afterEach(() => vi.unstubAllGlobals());

  const map = (chimes: Chime[]) => mapWith({ manuals: [locker], chimes, edgeworkSign: null });

  it('sounds the recorded chime for each find that chimes, with its caption', async () => {
    await freshAudio();
    const { answerChimes } = await import('../src/world/finds.js');
    const captions: Caption[] = [];
    // The first look: what chimed before stays silent.
    let ear = answerChimes(chimeEar(null), map([SPIND]), looking(T, { first: true }), captions, 1);
    expect(startsOf('discovery')).toHaveLength(0);
    const locker2: Chime = { find: { of: 'source', id: 'spind' }, at: T + 3000 };
    ear = answerChimes(ear, map([SPIND, locker2]), looking(T + 3040), captions, 2);
    expect(startsOf('discovery')).toHaveLength(1);
    expect(captions).toEqual([{ x: 6.5, y: 3, text: 'Spind entdeckt', at: 2 }]);
    // The same view again: nothing new, nothing sounds.
    ear = answerChimes(ear, map([SPIND, locker2]), looking(T + 3100), captions, 3);
    expect(startsOf('discovery')).toHaveLength(1);
    // Held by the opening: let go, silent, no caption.
    const held: Chime = { find: { of: 'source', id: 'spind' }, at: T + 5000 };
    answerChimes(ear, map([SPIND, locker2, held]), looking(T + 5040, { held: true }), captions, 4);
    expect(startsOf('discovery')).toHaveLength(1);
    expect(captions).toHaveLength(1);
  });
});
