import { describe, expect, it } from 'vitest';
import { drawStation, type StationOpts } from '../src/world/art.js';
import { consoleName } from '../src/world/consoles.js';

/**
 * A 2D context that draws nothing and keeps the text it is asked to fill:
 * enough canvas for a station, which only sets styles, builds paths and
 * fills or strokes them. Gradients take their stops and are dropped.
 */
function textRecorder(): { ctx: CanvasRenderingContext2D; filled: string[] } {
  const filled: string[] = [];
  const gradient = { addColorStop: () => undefined };
  const styles: Record<string | symbol, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(styles, {
    get: (target, key) => {
      if (key in target) {
        return target[key];
      }
      return key === 'fillText' ? (text: string) => filled.push(text) : () => gradient;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, filled };
}

/** The text a station is drawn with, in the order it is filled. */
function textOf(opts: StationOpts): string[] {
  const { ctx, filled } = textRecorder();
  drawStation(ctx, opts);
  return filled;
}

describe('a station in the world', () => {
  it('names a console by its letter', () => {
    expect(consoleName('a')).toBe('Pult A');
    expect(consoleName('b')).toBe('Pult B');
  });

  it('letters each console of a station with two, armed or not, and prints no title', () => {
    for (const status of ['armed', 'locked', 'done'] as const) {
      expect(textOf({ status, pulse: 0.5, console: 'a' })).toEqual(['A']);
      expect(textOf({ status, pulse: 0.5, console: 'b' })).toEqual(['B']);
    }
  });

  it('prints nothing on a station with one console: the operator stands right above it', () => {
    for (const status of ['armed', 'locked', 'done'] as const) {
      expect(textOf({ status, pulse: 0.5, console: null })).toEqual([]);
    }
  });
});
