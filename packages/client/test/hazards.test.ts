import { describe, expect, it } from 'vitest';
import { worldText, type WorldText } from '../src/world/art.js';
import { carryableKind, drawCarryable } from '../src/world/hazards.js';

/** One call on the 2D context: the method, and for fillText the text and the font then set. */
type Call = { method: string; text?: string; font?: unknown; rule?: unknown };

/**
 * A 2D context that draws nothing and keeps a log of the calls made on it:
 * enough canvas for a carryable, which sets styles, builds paths, fills and
 * strokes them and prints a label. Gradients take their stops and are dropped.
 */
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const styles: Record<string | symbol, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(styles, {
    get: (target, key) => {
      if (key in target) {
        return target[key];
      }
      const method = String(key);
      return (first?: unknown) => {
        calls.push(
          method === 'fillText'
            ? { method, text: String(first), font: target.font }
            : { method, rule: first },
        );
        return { addColorStop: () => undefined };
      };
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** What drawing the carryable `label` does, on the floor or in hand. */
function draw(label: string, carried: boolean, text?: WorldText): Call[] {
  const { ctx, calls } = recorder();
  drawCarryable(ctx, { label, pulse: 0.5, carried, ...(text === undefined ? {} : { text }) });
  return calls;
}

const printed = (calls: Call[]): string[] =>
  calls.filter((call) => call.method === 'fillText').map((call) => call.text ?? '');

describe('carryableKind — a carryable’s look, told from its label', () => {
  it('makes a fuse of a Sicherung and a key of a Schlüssel, however it is spelt', () => {
    for (const label of ['SICHERUNG', 'Ersatzsicherung', 'sicherung']) {
      expect(carryableKind(label)).toBe('fuse');
    }
    for (const label of ['SCHLÜSSEL', 'Schlüssel', 'SCHLUESSEL']) {
      expect(carryableKind(label)).toBe('key');
    }
  });

  it('makes a crate of anything else', () => {
    for (const label of ['SPEICHERKERN', 'KÜHLMITTEL', '']) {
      expect(carryableKind(label)).toBe('crate');
    }
  });
});

describe('drawCarryable', () => {
  it('draws a fuse, a key and a crate each its own way', () => {
    const looks = ['SICHERUNG', 'SCHLÜSSEL', 'SPEICHERKERN'].map((label) =>
      draw(label, false)
        .map((call) => call.method)
        .join(' '),
    );
    expect(new Set(looks).size).toBe(3);
    // the key's bow is a ring: its hole is cut by the even-odd rule
    expect(draw('SCHLÜSSEL', false)).toContainEqual({ method: 'fill', rule: 'evenodd' });
  });

  it('labels an item on the floor as other props are labelled, in capitals', () => {
    expect(printed(draw('Sicherung', false))).toEqual(['SICHERUNG']);
    expect(printed(draw('SCHLÜSSEL', false))).toEqual(['SCHLÜSSEL']);
  });

  it('labels nothing in hand: the item rides over its carrier’s head', () => {
    expect(printed(draw('SICHERUNG', true))).toEqual([]);
  });

  it('prints the label at the world’s text size for the zoom', () => {
    const text = worldText(170, 1);
    const [label] = draw('SICHERUNG', false, text).filter((call) => call.method === 'fillText');
    expect(label?.font).toBe(text.label.font);
  });
});
