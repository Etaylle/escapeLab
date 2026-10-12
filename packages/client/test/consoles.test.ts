import { describe, expect, it } from 'vitest';
import type { MapView } from '@escapelab/core';
import { drawStation, type StationOpts } from '../src/world/art.js';
import { consoleName, spotTitle } from '../src/world/consoles.js';

type Spot = MapView['stations'][number];

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

describe('a station with two consoles in the world', () => {
  const spot = (parts: Partial<Spot> = {}): Spot => ({
    puzzleId: 'signalprobe',
    x: 8,
    y: 5,
    title: 'Signalprobe',
    status: 'armed',
    ...parts,
  });

  it('names a console by its letter, and titles each of its spots with it', () => {
    expect(consoleName('a')).toBe('Pult A');
    expect(spotTitle(spot({ console: 'a' }))).toBe('Signalprobe · Pult A');
    expect(spotTitle(spot({ console: 'b' }))).toBe('Signalprobe · Pult B');
    expect(spotTitle(spot())).toBe('Signalprobe');
  });

  it('letters each console on the glyph, armed or not, under the armed one’s title', () => {
    const armed = { status: 'armed', pulse: 0.5 } as const;
    expect(textOf({ ...armed, title: 'Signalprobe · Pult A', console: 'a' })).toEqual([
      'A',
      'Signalprobe · Pult A',
    ]);
    for (const status of ['locked', 'done'] as const) {
      expect(textOf({ status, pulse: 0.5, title: 'Signalprobe · Pult B', console: 'b' })).toEqual([
        'B',
      ]);
    }
  });

  it('draws a station with one console as before: no letter, the title when armed', () => {
    expect(textOf({ status: 'armed', pulse: 0.5, title: 'Notstrom', console: null })).toEqual([
      'Notstrom',
    ]);
    expect(textOf({ status: 'locked', pulse: 0.5, title: 'Notstrom', console: null })).toEqual([]);
  });
});
