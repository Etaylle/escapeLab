import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  generateEdgework,
  moduleFor,
  puzzleDefSchema,
  tokenLabel,
  type ConsoleId,
  type PuzzleView,
} from '@escapelab/core';
import { PANELS } from '../src/puzzles/index.js';
import { PuzzlePanel, ReaderPanel } from '../src/screens/PuzzlePanel.js';

/** A small deterministic generator, enough to set an instance up. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

/**
 * The open puzzle of `type` as player `who` sees it, at its station — at
 * console `seat` where it has two — or away from it; with `who` null, as the
 * audience sees it.
 */
function seen(
  type: string,
  operating = true,
  fields: Record<string, unknown> = {},
  seat: ConsoleId | null = operating ? 'a' : null,
  who: string | null = 'p1',
): PuzzleView {
  const def = puzzleDefSchema.parse({ type, id: type, title: 'Station', ...fields });
  const station = moduleFor(def.type);
  const rng = lcg(7);
  const edgework = generateEdgework(rng);
  const crew = ['p1', 'p2'];
  const setup = {
    edgework,
    alarms: 0,
    remainingSec: 600,
    at: 0,
    crew,
    console: null,
    atConsoles: { a: [], b: [] },
  };
  const state = station.init(def, rng, setup);
  const viewer = { playerId: who, operating, reading: false, console: seat };
  const view = station.view(def, state, viewer, { edgework, alarms: 0, crew });
  return { ...view, index: 0, total: 1, title: def.title, manual: null, console: seat };
}

function panel(puzzle: PuzzleView): string {
  return renderToStaticMarkup(
    <PuzzlePanel puzzle={puzzle} send={() => undefined} deadlineAt={null} />,
  );
}

/** Every station module: the relay emergency has no station. */
const STATIONS = Object.keys(PANELS).filter((type) => type !== 'relay');

describe('station panels', () => {
  it.each(STATIONS)('%s speaks to the operator, not to someone who cannot see it', (type) => {
    // Only the operator gets a panel now; a view without the machine says nothing to anyone.
    for (const html of [panel(seen(type)), panel(seen(type, false))]) {
      expect(html).not.toMatch(/lass (dir|sie dir)|frag |anderen Station|siehst du nicht/i);
      expect(html).not.toMatch(/sieht nur|dein Team|hör mit|aus der Crew/i);
    }
  });

  it.each(STATIONS.filter((type) => type !== 'button-sync'))(
    '%s tells the operator to act on the reader’s word',
    (type) => {
      expect(panel(seen(type))).toContain('Ansage');
    },
  );
});

describe('the switch bank', () => {
  it('shows LED and Markierung only on a bank of two features', () => {
    const html = panel(seen('switches', true, { features: 2 }));
    expect(html.match(/class="switches-item/g)).toHaveLength(6);
    expect(html).toContain('Jeden Schalter ansagen: LED, Markierung. Bei Ansage umlegen');
    expect(html).not.toContain('switches-star');
    expect(html).not.toContain('Stern');
  });

  it('keeps the star’s row and word on a bank of three', () => {
    const html = panel(seen('switches', true, { features: 3 }));
    expect(html).toContain('Jeden Schalter ansagen: LED, Markierung, Stern. Bei Ansage umlegen');
    expect(html.match(/class="switches-star"/g)).toHaveLength(6);
    expect(html.match(/<span>(kein )?Stern<\/span>/g)).toHaveLength(6);
  });
});

describe('the maze', () => {
  type Label = { at: number; name: string };

  /** The grid's labels as drawn: column letters by x, row numbers by y. */
  function labelsOf(html: string): { columns: Label[]; rows: Label[] } {
    const column = /<text x="([\d.]+)" y="[\d.]+" text-anchor="middle">([A-H])<\/text>/g;
    const row = /<text x="[\d.]+" y="([\d.]+)" text-anchor="end">(\d)<\/text>/g;
    const read = (m: RegExpMatchArray): Label => ({ at: Number(m[1]), name: m[2] ?? '' });
    return {
      columns: [...html.matchAll(column)].map(read),
      rows: [...html.matchAll(row)].map(read),
    };
  }

  const inOrder = (labels: Label[]): string =>
    [...labels].sort((p, q) => p.at - q.at).map((label) => label.name).join('');

  /** The name of the label lying closest to `at`. */
  function nearest(labels: Label[], at: number): string {
    const away = (label: Label): number => Math.abs(label.at - at);
    return labels.reduce((best, label) => (away(label) < away(best) ? label : best)).name;
  }

  it('letters columns from the left and numbers rows from the top, as its rules say', () => {
    const view = seen('maze');
    if (view.kind !== 'maze' || view.pos === null) {
      throw new Error('expected the navigation console');
    }
    const html = panel(view);
    const { columns, rows } = labelsOf(html);
    expect(inOrder(columns)).toBe('ABCDEF');
    expect(inOrder(rows)).toBe('123456');
    // The marker stands in the column and the row the panel names it by.
    const here = `${'ABCDEF'.charAt(view.pos.x)}${view.pos.y + 1}`;
    expect(html).toContain(`Du stehst auf <strong>${here}</strong>`);
    const marker = /<circle class="maze-marker[^"]*" cx="([\d.]+)" cy="([\d.]+)"/.exec(html);
    const [cx, cy] = [Number(marker?.[1]), Number(marker?.[2])];
    expect(`${nearest(columns, cx)}${nearest(rows, cy)}`).toBe(here);
    // The plan at a manual object counts the same way.
    const plan = labelsOf(
      renderToStaticMarkup(
        <ReaderPanel puzzle={{ ...view, pos: null, cells: new Array<number>(36).fill(15) }} />,
      ),
    );
    expect(inOrder(plan.columns)).toBe('ABCDEF');
    expect(inOrder(plan.rows)).toBe('123456');
  });
});

describe('the signal chain', () => {
  type SignalSeen = Extract<PuzzleView, { kind: 'signal' }>;

  /** Stage 1 at console `seat` — console a sends it — with what `change` says happened since. */
  function at(seat: ConsoleId, change: Partial<SignalSeen> = {}): SignalSeen {
    const view = seen('signal', true, {}, seat);
    if (view.kind !== 'signal') {
      throw new Error(`expected the signal chain, got ${view.kind}`);
    }
    return { ...view, ...change };
  }

  /** What the panel prints under each sign, in the order it shows them. */
  const words = (html: string): string[] =>
    [...html.matchAll(/<span class="signal-word">([^<]*)<\/span>/g)].map((m) => m[1] ?? '');

  const lit = (html: string): number => html.match(/signal-lamp--lit/g)?.length ?? 0;

  it('shows the sending console the sequence in words, a lamp under each sign, no key', () => {
    const sending = at('a');
    const sequence = sending.sequence ?? [];
    expect(sequence).toHaveLength(4);
    const html = panel(sending);
    expect(html).toContain('Stufe 1 von 4 — dieses Pult sendet');
    expect(words(html)).toEqual(sequence.map(tokenLabel));
    expect(html.match(/class="signal-lamp/g)).toHaveLength(4);
    expect(lit(html)).toBe(0);
    expect(html).not.toContain('<button');
  });

  it('gives the receiving console its twelve signs as keys, and no sequence', () => {
    const receiving = at('b');
    const html = panel(receiving);
    expect(html).toContain('Stufe 1 von 4 — dieses Pult gibt ein');
    const key = /<button class="signal-key" data-token="([a-z]+-[a-z]+)">/g;
    expect([...html.matchAll(key)].map((m) => m[1])).toEqual(receiving.grid);
    expect(words(html)).toEqual((receiving.grid ?? []).map(tokenLabel));
    expect(html).not.toContain('signal-strip');
  });

  it('lights a lamp for every sign pressed, at both consoles', () => {
    expect(lit(panel(at('a', { done: 2 })))).toBe(2);
    expect(lit(panel(at('b', { done: 3 })))).toBe(3);
  });

  it('says a wrong sign starts the stage again, and shakes the keys', () => {
    const message = '⚠ Falsches Zeichen — Stufe von vorn.';
    const wrong = panel(at('b', { lastResult: 'wrong' }));
    expect(wrong).toContain(`<p class="warn" role="status">${message}</p>`);
    expect(wrong).toContain('class="signal-grid signal-grid--wrong"');
    expect(panel(at('a', { lastResult: 'wrong' }))).toContain(message);
    const right = panel(at('b'));
    expect(right).not.toContain('Falsches Zeichen');
    expect(right).not.toContain('signal-grid--wrong');
  });

  it('tells a console nobody stands at that it is not connected', () => {
    expect(panel(seen('signal', false))).toContain('Dieses Pult ist nicht angeschlossen.');
  });

  it('shows the audience the strip and both consoles’ keys by name, none to press', () => {
    const watched = seen('signal', true, {}, null, null);
    if (watched.kind !== 'signal' || watched.sequence === null || watched.grids === null) {
      throw new Error('expected the audience to see the sequence and both consoles');
    }
    const { sequence, grids } = watched;
    const html = panel({ ...watched, done: 1 });
    expect(html).toContain('Stufe 1 von 4 — Pult A sendet');
    const names = [...html.matchAll(/<h4 class="signal-console-name">([^<]*)<\/h4>/g)];
    expect(names.map((m) => m[1])).toEqual(['Pult A', 'Pult B']);
    const key = /<span class="signal-key" data-token="([a-z]+-[a-z]+)">/g;
    expect([...html.matchAll(key)].map((m) => m[1])).toEqual([...grids.a, ...grids.b]);
    expect(words(html)).toEqual([...sequence, ...grids.a, ...grids.b].map(tokenLabel));
    expect(lit(html)).toBe(1);
    expect(html).not.toContain('<button');
  });
});
