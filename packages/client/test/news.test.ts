import { describe, expect, it } from 'vitest';
import { worldNews } from '../src/world/news.js';
import { mapWith, type Item, type Manual } from './fixtures.js';

const book: Manual = {
  found: true,
  known: true,
  id: 'buch',
  kind: 'book',
  x: 2,
  y: 3,
  label: 'HANDBUCH',
  puzzleIds: ['notstrom'],
  opened: true,
  needsKey: null,
};
const locker: Manual = { ...book, id: 'spind', kind: 'locker', x: 6, opened: false };

describe('worldNews — what the lab shows that it did not before', () => {
  it('has nothing on the first look: that was all there already', () => {
    const now = mapWith({ manuals: [book, { ...locker, opened: true }], litRooms: ['ARCHIV'] });
    expect(worldNews(null, now)).toEqual({ opened: [], lit: [], delivered: [], dropped: [] });
  });

  it('opens a locker once: closed before, open now', () => {
    const before = mapWith({ manuals: [book, locker] });
    const now = mapWith({ manuals: [book, { ...locker, opened: true }] });
    expect(worldNews(before, now).opened.map((m) => m.id)).toEqual(['spind']);
    expect(worldNews(now, now).opened).toEqual([]);
  });

  it('takes a source come into the view already open as nothing opened', () => {
    expect(worldNews(mapWith({}), mapWith({ manuals: [book] })).opened).toEqual([]);
  });

  it('seats a part where it belongs once, and leaves a key in a cabinet to the cabinet', () => {
    const fuse: Item = {
      found: true,
      known: true,
      id: 'sicherung',
      kind: 'fuse',
      label: 'SICHERUNG',
      x: 9.5,
      y: 4.5,
      carriedBy: 'ada',
      delivered: false,
      deliverTo: { x: 14, y: 2 },
      requiredFor: { title: 'Notstrom', ahead: 0 },
    };
    const key: Item = {
      ...fuse,
      id: 'schluessel',
      kind: 'key',
      label: 'SCHLÜSSEL',
      deliverTo: { x: 6, y: 3 },
    };
    const cabinet: Manual = { ...locker, kind: 'cabinet', needsKey: 'schluessel' };
    const before = mapWith({ manuals: [cabinet], items: [fuse, key] });
    const seated = { ...fuse, carriedBy: null, delivered: true, x: 14.5, y: 2.5 };
    const unlocked = { ...key, carriedBy: null, delivered: true, x: 6.5, y: 3.5 };
    const now = mapWith({ manuals: [{ ...cabinet, opened: true }], items: [seated, unlocked] });
    const news = worldNews(before, now);
    expect(news.delivered).toEqual([seated]);
    expect(news.opened.map((m) => m.id)).toEqual(['spind']);
    expect(worldNews(now, now).delivered).toEqual([]);
  });

  it('puts a part down off somebody’s hands once, where it now lies — not one set in place', () => {
    const fuse: Item = {
      found: true,
      known: true,
      id: 'sicherung',
      kind: 'fuse',
      label: 'SICHERUNG',
      x: 9.5,
      y: 4.5,
      carriedBy: 'ada',
      delivered: false,
      deliverTo: { x: 14, y: 2 },
      requiredFor: { title: 'Notstrom', ahead: 0 },
    };
    const down = { ...fuse, carriedBy: null, x: 9.7, y: 4.4 };
    const before = mapWith({ items: [fuse] });
    expect(worldNews(before, mapWith({ items: [down] })).dropped).toEqual([down]);
    expect(worldNews(mapWith({ items: [down] }), mapWith({ items: [down] })).dropped).toEqual([]);
    const seated = { ...fuse, carriedBy: null, delivered: true };
    expect(worldNews(before, mapWith({ items: [seated] })).dropped).toEqual([]);
  });

  it('lights the rooms that joined the list, each once', () => {
    const before = mapWith({ litRooms: ['ARCHIV'] });
    const now = mapWith({ litRooms: ['ARCHIV', 'LABOR', 'FLUR'] });
    expect(worldNews(before, now).lit).toEqual(['LABOR', 'FLUR']);
    expect(worldNews(now, now).lit).toEqual([]);
  });
});
