import { describe, expect, it } from 'vitest';
import { worldNews } from '../src/world/news.js';
import { mapWith, type Manual } from './fixtures.js';

const book: Manual = {
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
    expect(worldNews(null, now)).toEqual({
      found: [],
      notes: [],
      opened: [],
      lit: [],
      delivered: [],
    });
  });

  it('finds a note of the last shift the moment the view carries it, read or not', () => {
    const lever = { index: 0, x: 12, y: 6, read: false };
    const hatch = { index: 2, x: 2, y: 0, read: true };
    const before = mapWith({ notes: [lever] });
    const now = mapWith({ notes: [lever, hatch] });
    expect(worldNews(before, now).notes).toEqual([hatch]);
    expect(worldNews(now, now).notes).toEqual([]);
    expect(worldNews(null, now).notes).toEqual([]);
  });

  it('finds a source the moment the view carries it, and only then', () => {
    const before = mapWith({ manuals: [book] });
    const now = mapWith({ manuals: [book, locker] });
    expect(worldNews(before, now).found).toEqual([locker]);
    expect(worldNews(now, now).found).toEqual([]);
  });

  it('opens a locker once: closed before, open now', () => {
    const before = mapWith({ manuals: [book, locker] });
    const now = mapWith({ manuals: [book, { ...locker, opened: true }] });
    expect(worldNews(before, now).opened.map((m) => m.id)).toEqual(['spind']);
    expect(worldNews(now, now).opened).toEqual([]);
  });

  it('counts a source found already open as found, not as opened', () => {
    const news = worldNews(mapWith({}), mapWith({ manuals: [book] }));
    expect(news.found).toEqual([book]);
    expect(news.opened).toEqual([]);
  });

  it('seats a part where it belongs once, and leaves a key in a cabinet to the cabinet', () => {
    const fuse = {
      id: 'sicherung',
      label: 'SICHERUNG',
      x: 9.5,
      y: 4.5,
      carriedBy: 'ada',
      delivered: false,
      deliverTo: { x: 14, y: 2 },
      requiredForTitle: 'Notstrom',
    };
    const key = { ...fuse, id: 'schluessel', label: 'SCHLÜSSEL', deliverTo: { x: 6, y: 3 } };
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

  it('lights the rooms that joined the list, each once', () => {
    const before = mapWith({ litRooms: ['ARCHIV'] });
    const now = mapWith({ litRooms: ['ARCHIV', 'LABOR', 'FLUR'] });
    expect(worldNews(before, now).lit).toEqual(['LABOR', 'FLUR']);
    expect(worldNews(now, now).lit).toEqual([]);
  });
});
