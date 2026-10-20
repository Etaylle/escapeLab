import { describe, expect, it } from 'vitest';
import { shouldGoFullscreen, type FullscreenCheck } from '../src/runScreen.js';

/** The first touch of a run on a phone that can go fullscreen. */
const FIRST_TOUCH: FullscreenCheck = {
  running: true,
  coarsePointer: true,
  touch: true,
  fullscreenEnabled: true,
  fullscreen: false,
  asked: false,
};

describe('going fullscreen', () => {
  it('asks on the first touch of a run on a phone', () => {
    expect(shouldGoFullscreen(FIRST_TOUCH)).toBe(true);
  });

  it.each<[string, Partial<FullscreenCheck>]>([
    ['no run is on: the join screen, the lobby, the end', { running: false }],
    ['the main pointer is a mouse', { coarsePointer: false }],
    ['the tap came from a mouse or a pen', { touch: false }],
    ['the browser has no fullscreen for a page, as on an iPhone', { fullscreenEnabled: false }],
    ['the page is fullscreen already', { fullscreen: true }],
    ['this run asked already: who left fullscreen stays out', { asked: true }],
  ])('does not ask when %s', (_when, change) => {
    expect(shouldGoFullscreen({ ...FIRST_TOUCH, ...change })).toBe(false);
  });
});
