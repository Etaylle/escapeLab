import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Discovery, MapView } from '@escapelab/core';
import { findWords, freshEar, hearDiscoveries, type Listening } from '../src/world/finds.js';
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
  seen: true,
  found: true,
  known: true,
};
const fuse: Item = {
  id: 'sicherung',
  label: 'SICHERUNG',
  kind: 'fuse',
  x: 3.5,
  y: 4.5,
  carriedBy: null,
  delivered: false,
  deliverTo: null,
  requiredFor: null,
  seen: true,
  found: true,
  known: true,
};
type Station = MapView['stations'][number];
const station = (parts: Partial<Station>): Station => ({
  puzzleId: 'kabel',
  x: 9,
  y: 2,
  title: 'Kabel',
  status: 'armed',
  seen: true,
  found: true,
  known: true,
  ...parts,
});

const SPIND: Discovery = { find: { of: 'source', id: 'spind' }, at: T, chime: true };
/** Found 400 ms after the locker, in its gap: listed all the same, its chime silent. */
const FUSE: Discovery = { find: { of: 'item', id: 'sicherung' }, at: T + 400, chime: false };
const SIGN: Discovery = { find: { of: 'sign' }, at: T + 1500, chime: true };

/** A screen that has looked before, its run under way, nothing holding it, the server at `now`. */
const looking = (serverNow: number, parts: Partial<Listening> = {}): Listening => ({
  run: RUN,
  first: false,
  held: false,
  serverNow,
  ...parts,
});

describe('hearDiscoveries — what of the view’s discoveries is news to this screen', () => {
  it('takes a new discovery once, there and then, sounding the ones that chime', () => {
    const first = hearDiscoveries(freshEar(RUN), [SPIND], looking(T + 40));
    expect(first.news).toEqual([{ ...SPIND, sounded: true }]);
    expect(hearDiscoveries(first.ear, [SPIND], looking(T + 80)).news).toEqual([]);
    const next = hearDiscoveries(first.ear, [SPIND, FUSE, SIGN], looking(T + 1540));
    expect(next.news.map((one) => [one.find.of, one.sounded])).toEqual([
      ['item', false],
      ['sign', true],
    ]);
    expect(next.ear.heard.map((one) => one.find.of)).toEqual(['source', 'item', 'sign']);
  });

  it('on its first look takes as news only what was found just now', () => {
    const before = { ...SPIND, at: T - 1501 };
    const now = { ...FUSE, at: T - 1500 };
    const { ear, news } = hearDiscoveries(freshEar(null), [before, now], looking(T, { first: true }));
    expect(news).toEqual([{ ...now, sounded: false }]);
    expect(hearDiscoveries(ear, [before, now, SIGN], looking(T + 1540)).news).toEqual([
      { ...SIGN, sounded: true },
    ]);
  });

  it('lets a chime go while the opening holds the screen, or once it comes late: never later', () => {
    const held = hearDiscoveries(freshEar(RUN), [SPIND], looking(T + 40, { held: true }));
    expect(held.news).toEqual([{ ...SPIND, sounded: false }]);
    expect(hearDiscoveries(held.ear, [SPIND], looking(T + 400)).news).toEqual([]);
    // Kept back past the gap by a stalled line, it is no chime of this moment; its caption shows.
    const late = hearDiscoveries(freshEar(RUN), [SPIND], looking(T + 1501)).news;
    expect(late).toEqual([{ ...SPIND, sounded: false }]);
    const inTime = hearDiscoveries(freshEar(RUN), [SPIND], looking(T + 1500)).news;
    expect(inTime).toEqual([{ ...SPIND, sounded: true }]);
  });

  it('starts afresh with a run of its own', () => {
    const before = hearDiscoveries(freshEar(RUN), [SPIND], looking(T + 40)).ear;
    const next = hearDiscoveries(before, [SIGN], looking(T + 1540, { run: RUN + 1 }));
    expect(next.news).toEqual([{ ...SIGN, sounded: true }]);
    expect(next.ear).toEqual({ run: RUN + 1, taken: 1, heard: [{ ...SIGN, sounded: true }] });
  });
});

describe('findWords — what rises over a find', () => {
  const map = mapWith({
    manuals: [locker],
    notes: [{ index: 0, x: 2, y: 0, read: false, seen: true, found: true, known: true }],
    items: [fuse, { ...fuse, id: 'key', kind: 'key', label: 'SCHLÜSSEL' }],
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

describe('answerDiscoveries — every caption, the chime where it chimes, on the fake engine', () => {
  beforeEach(() => fakeAudio());
  afterEach(() => vi.unstubAllGlobals());

  const sign = { x: 2, y: 3, found: true };
  const map = (discoveries: Discovery[]) =>
    mapWith({ manuals: [locker], items: [fuse], discoveries, edgeworkSign: sign });

  it('sounds the recorded chime for one that chimes, and captions every one', async () => {
    await freshAudio();
    const { answerDiscoveries } = await import('../src/world/finds.js');
    const captions: Caption[] = [];
    // The first look: what was found well before stays as it was, silent and uncaptioned.
    const box = { of: 'console', puzzleId: 'kabel', console: null } as const;
    const old: Discovery = { find: box, at: T - 5000, chime: true };
    let ear = answerDiscoveries(freshEar(null), map([old]), looking(T, { first: true }), captions, 1);
    expect([startsOf('discovery').length, captions.length]).toEqual([0, 0]);
    const spind: Discovery = { ...SPIND, at: T + 3000 };
    ear = answerDiscoveries(ear, map([old, spind]), looking(T + 3040), captions, 2);
    expect(startsOf('discovery')).toHaveLength(1);
    expect(captions).toEqual([{ x: 6.5, y: 3, text: 'Spind entdeckt', at: 2 }]);
    // The fuse, found in the gap: its caption rises, and no chime with it.
    const inTheGap: Discovery = { ...FUSE, at: T + 3400 };
    const three = map([old, spind, inTheGap]);
    ear = answerDiscoveries(ear, three, looking(T + 3440), captions, 3);
    expect(startsOf('discovery')).toHaveLength(1);
    expect(captions.at(-1)).toEqual({ x: 3.5, y: 4, text: 'Sicherung entdeckt', at: 3 });
    // The same view again: nothing new, nothing sounds.
    ear = answerDiscoveries(ear, three, looking(T + 3500), captions, 4);
    expect([startsOf('discovery').length, captions.length]).toEqual([1, 2]);
    // Held by the opening: the caption all the same, the chime let go.
    const held: Discovery = { ...SIGN, at: T + 5000 };
    const four = map([old, spind, inTheGap, held]);
    answerDiscoveries(ear, four, looking(T + 5040, { held: true }), captions, 5);
    expect(startsOf('discovery')).toHaveLength(1);
    expect(captions.map((one) => one.text)).toEqual([
      'Spind entdeckt',
      'Sicherung entdeckt',
      'Laborkennung entdeckt',
    ]);
  });
});
