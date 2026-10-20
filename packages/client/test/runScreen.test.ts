import { describe, expect, it } from 'vitest';
import { shouldGoFullscreen, touchOf, type FullscreenCheck } from '../src/runScreen.js';

/** A finger's press for a run on a phone that can go fullscreen: the lobby's start, a first tap. */
const FIRST_TOUCH: FullscreenCheck = {
  forRun: true,
  coarsePointer: true,
  touch: true,
  fullscreenEnabled: true,
  fullscreen: false,
  asked: false,
};

describe('going fullscreen', () => {
  it("asks on the start or ready press, or a run's first touch, on a phone", () => {
    expect(shouldGoFullscreen(FIRST_TOUCH)).toBe(true);
  });

  it.each<[string, Partial<FullscreenCheck>]>([
    ['the gesture leads into no run: the join screen, the lobby, the end', { forRun: false }],
    ['the main pointer is a mouse', { coarsePointer: false }],
    ['the press came from a mouse or a pen', { touch: false }],
    ['the browser has no fullscreen for a page, as on an iPhone', { fullscreenEnabled: false }],
    ['the page is fullscreen already', { fullscreen: true }],
    ['this run asked already: who left fullscreen stays out', { asked: true }],
  ])('does not ask when %s', (_when, change) => {
    expect(shouldGoFullscreen({ ...FIRST_TOUCH, ...change })).toBe(false);
  });
});

describe('a touch', () => {
  it('is a gesture whose pointer was a finger', () => {
    expect(touchOf({ pointerType: 'touch' })).toBe(true);
  });

  it('is not a mouse, a pen, or a click that names no pointer, as older browsers send', () => {
    expect(touchOf({ pointerType: 'mouse' })).toBe(false);
    expect(touchOf({ pointerType: 'pen' })).toBe(false);
    expect(touchOf({})).toBe(false);
  });
});
