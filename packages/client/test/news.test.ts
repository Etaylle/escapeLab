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
    expect(worldNews(null, now)).toEqual({ found: [], opened: [], lit: [] });
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

  it('lights the rooms that joined the list, each once', () => {
    const before = mapWith({ litRooms: ['ARCHIV'] });
    const now = mapWith({ litRooms: ['ARCHIV', 'LABOR', 'FLUR'] });
    expect(worldNews(before, now).lit).toEqual(['LABOR', 'FLUR']);
    expect(worldNews(now, now).lit).toEqual([]);
  });
});
