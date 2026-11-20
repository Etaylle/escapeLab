import { describe, expect, it } from 'vitest';
import { H, MODES, W } from '../../../src/arcade/flush/rules.js';
import { GAMES, menuAt, menuSpots } from '../../../src/arcade/flush/hud.js';

/**
 * Ferret Flush's menus are pictures on a canvas: a click finds the choice under it and nothing
 * beside it (the reference's test/menu.test.js), with the cards' words in German.
 */
describe('Ferret Flush menus', () => {
  it('offers the three games on the first screen, each under its own card', () => {
    const spots = menuSpots('title');
    expect(spots.map((spot) => spot.choose)).toEqual(Object.keys(MODES));
    for (const spot of spots) {
      expect(menuAt({ screen: 'title' }, spot.x + spot.w / 2, spot.y + spot.h / 2)).toBe(spot.choose);
      expect(menuAt({ screen: 'title' }, spot.x + spot.w + 6, spot.y + spot.h / 2)).toBeNull();
      expect(spot.x >= 0 && spot.x + spot.w <= W && spot.y >= 0 && spot.y + spot.h <= H).toBe(true);
    }
    expect(menuAt({ screen: 'title' }, 5, 5)).toBeNull();
  });

  it('offers another game or the way back at the end, and nothing during play', () => {
    const spots = menuSpots('over');
    expect(spots.map((spot) => spot.choose)).toEqual(['again', 'menu']);
    for (const spot of spots) {
      expect(menuAt({ screen: 'over' }, spot.x + 4, spot.y + 4)).toBe(spot.choose);
      expect(menuAt({ screen: 'playing' }, spot.x + 4, spot.y + 4)).toBeNull();
    }
    expect(menuAt({ screen: 'over' }, W / 2, (spots[0]?.y ?? 0) + 4)).toBeNull();
  });

  it('names every game in German without addressing anyone', () => {
    for (const entry of GAMES) {
      const words = Object.values(entry).filter((value) => typeof value === 'string').join(' ');
      expect(words).not.toMatch(/\b(du|dich|dir|dein\w*|ihr|euch|euer\w*|Sie|Ihnen|Ihr\w*)\b/);
    }
  });
});
