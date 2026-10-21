/**
 * A canvas whose 2D context records what it is asked to do, in order — every
 * call with the alpha, the compositing and the save depth it had then, every
 * property set — for tests of what the world's passes draw. Gradients are
 * plain data, so that two recordings of the same drawing compare equal.
 */

/** One thing a fake context was asked to do. */
export type Entry =
  | { kind: 'call'; name: string; args: unknown[]; alpha: number; op: string; depth: number }
  | { kind: 'set'; name: string; value: unknown };

export interface FakeCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  log: Entry[];
}

/** A gradient as a fake context makes it: its kind, where it lies, and its stops. */
export class FakeGradient {
  readonly gradient: 'linear' | 'radial';
  readonly args: unknown[];
  readonly stops: [number, string][] = [];

  constructor(gradient: 'linear' | 'radial', args: unknown[]) {
    this.gradient = gradient;
    this.args = args;
  }

  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
  }
}

/** A path for tests without a DOM (stub `Path2D` with it): what it was built of. */
export class FakePath2D {
  readonly ops: unknown[][] = [];

  moveTo(...args: number[]): void {
    this.ops.push(['moveTo', ...args]);
  }

  lineTo(...args: number[]): void {
    this.ops.push(['lineTo', ...args]);
  }

  arc(...args: (number | boolean)[]): void {
    this.ops.push(['arc', ...args]);
  }

  arcTo(...args: number[]): void {
    this.ops.push(['arcTo', ...args]);
  }

  quadraticCurveTo(...args: number[]): void {
    this.ops.push(['quadraticCurveTo', ...args]);
  }

  rect(...args: number[]): void {
    this.ops.push(['rect', ...args]);
  }

  closePath(): void {
    this.ops.push(['closePath']);
  }
}

/**
 * The calls that make a gradient: art.ts keeps the gradients it built for a
 * context, so whether one is made depends on what was drawn before — what a
 * drawing shows is the gradient it fills with.
 */
const MAKING = new Set(['createLinearGradient', 'createRadialGradient']);

/** The context's properties and what a fresh one holds. */
const STATE = {
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  imageSmoothingEnabled: true,
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1,
  lineJoin: 'miter',
  lineCap: 'butt',
  lineDashOffset: 0,
  miterLimit: 10,
  shadowColor: 'rgba(0, 0, 0, 0)',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  filter: 'none',
};

/** A canvas `width` × `height` handing out a recording 2D context; `name` tells it apart. */
export function fakeCanvas(width = 0, height = 0, name = 'canvas'): FakeCanvas {
  const log: Entry[] = [];
  const state: Record<string, unknown> = { ...STATE };
  const saved: Record<string, unknown>[] = [];
  const canvas = { width, height, name } as unknown as HTMLCanvasElement;
  const answers: Record<string, (...args: unknown[]) => unknown> = {
    save: () => saved.push({ ...state }),
    restore: () => Object.assign(state, saved.pop()),
    measureText: (text) => ({ width: String(text).length * 7 }),
    createLinearGradient: (...args) => new FakeGradient('linear', args),
    createRadialGradient: (...args) => new FakeGradient('radial', args),
    createImageData: (w, h) => {
      const data = new Uint8ClampedArray(Number(w) * Number(h) * 4);
      return { width: w, height: h, data };
    },
  };
  const ctx = new Proxy(
    {},
    {
      get: (_, prop) => {
        if (prop === 'canvas') {
          return canvas;
        }
        if (typeof prop !== 'string') {
          return undefined;
        }
        if (prop in state) {
          return state[prop];
        }
        return (...args: unknown[]) => {
          const alpha = Number(state['globalAlpha']);
          const op = String(state['globalCompositeOperation']);
          log.push({ kind: 'call', name: prop, args, alpha, op, depth: saved.length });
          return answers[prop]?.(...args);
        };
      },
      set: (_, prop, value) => {
        if (typeof prop === 'string') {
          state[prop] = value;
          log.push({ kind: 'set', name: prop, value });
        }
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  Object.assign(canvas, { getContext: () => ctx });
  return { canvas, ctx, log };
}

/** The arguments of every call of `name` in `log`, in order. */
export function callsOf(log: readonly Entry[], name: string): unknown[][] {
  return log.flatMap((entry) => (entry.kind === 'call' && entry.name === name ? [entry.args] : []));
}

/** The calls of `name` in `log` themselves, with the state each was made in. */
export function callEntries(
  log: readonly Entry[],
  name: string,
): Extract<Entry, { kind: 'call' }>[] {
  return log.filter(
    (entry): entry is Extract<Entry, { kind: 'call' }> =>
      entry.kind === 'call' && entry.name === name,
  );
}

/** The values set to property `name` in `log`, in order. */
export function setsOf(log: readonly Entry[], name: string): unknown[] {
  return log.flatMap((entry) => (entry.kind === 'set' && entry.name === name ? [entry.value] : []));
}

/**
 * What was drawn with the origin moved to (x, y), as a pass draws a thing:
 * the entries after the `nth` `translate(x, y)` (from 0) up to the restore
 * that ends it. Empty where nothing was drawn there.
 */
export function drawnAt(log: readonly Entry[], x: number, y: number, nth = 0): Entry[] {
  type Call = Extract<Entry, { kind: 'call' }>;
  const isCall = (entry: Entry | undefined, name: string): entry is Call =>
    entry?.kind === 'call' && entry.name === name;
  const starts = log.flatMap((entry, i) =>
    isCall(entry, 'translate') && entry.args[0] === x && entry.args[1] === y ? [i] : [],
  );
  const start = starts[nth] ?? -1;
  const opened = log[start];
  if (!isCall(opened, 'translate')) {
    return [];
  }
  const end = log.findIndex(
    (entry, i) => i > start && isCall(entry, 'restore') && entry.depth === opened.depth,
  );
  return log.slice(start + 1, end === -1 ? undefined : end);
}

/**
 * The entries without the state they were made in — and without the making
 * of gradients, which show as the fills set: what was drawn, to compare two drawings.
 */
export function strip(entries: readonly Entry[]): unknown[] {
  return entries
    .filter((entry) => entry.kind === 'set' || !MAKING.has(entry.name))
    .map((entry) =>
      entry.kind === 'call' ? [entry.name, entry.args] : [`${entry.name}=`, entry.value],
    );
}

/** What `draw` draws on a fresh fake context, stripped: what a pass should have drawn. */
export function recording(draw: (ctx: CanvasRenderingContext2D) => void): unknown[] {
  const { ctx, log } = fakeCanvas();
  draw(ctx);
  return strip(log);
}
