import { isValidElement, type ReactElement, type ReactNode } from 'react';
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
import {
  FLEETING_PAUSE_MS,
  FLEETING_SIGN_MS,
  fleetingAt,
} from '../src/puzzles/SignalPanel.js';
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
    readers: [],
  };
  const state = station.init(def, rng, setup);
  const viewer = { playerId: who, operating, reading: false, console: seat };
  const view = station.view(def, state, viewer, { edgework, alarms: 0, crew });
  const common = { index: 0, total: 1, title: def.title, manual: null, console: seat };
  return { ...view, ...common, backup: null };
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

  /**
   * Stage 1 of a Signalkette with the def's `fields` — console a sends it —
   * at console `seat`, or as the audience sees it with `seat` null.
   */
  function signalAt(seat: ConsoleId | null, fields: Record<string, unknown> = {}): SignalSeen {
    const view = seen('signal', true, fields, seat, seat === null ? null : 'p1');
    if (view.kind !== 'signal') {
      throw new Error(`expected the signal chain, got ${view.kind}`);
    }
    return view;
  }

  /** Stage 1 at console `seat` — console a sends it — with what `change` says happened since. */
  const at = (seat: ConsoleId, change: Partial<SignalSeen> = {}): SignalSeen => ({
    ...signalAt(seat),
    ...change,
  });

  /** What the panel prints under each sign, in the order it shows them. */
  const words = (html: string): string[] =>
    [...html.matchAll(/<span class="signal-word">([^<]*)<\/span>/g)].map((m) => m[1] ?? '');

  const lit = (html: string): number => html.match(/signal-lamp--lit/g)?.length ?? 0;

  /** The keys of shapes as drawn — buttons, or the audience's spans — by row and form. */
  function rowKeys(html: string, tag: 'button' | 'span') {
    const key = new RegExp(
      `<${tag} class="signal-key signal-key--shape" data-row="(\\d)" data-shape="([a-z]+)"`,
      'g',
    );
    return [...html.matchAll(key)].map((m) => ({ row: Number(m[1]), shape: m[2] }));
  }

  const rowNumbers = (html: string): string[] =>
    [...html.matchAll(/<span class="signal-row-number">(\d)<\/span>/g)].map((m) => m[1] ?? '');

  /** The names under the keys of shapes, row by row. */
  const FORMS_BY_ROW = Array.from({ length: 4 }, () => ['Kreis', 'Dreieck', 'Quadrat']).flat();

  /** A colour anywhere: drawn, or named. */
  const COLOURED = /fill="#|\b(rot|blau|grün|gruen|gelb)/i;

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
    // Side by side, every sign at once: nothing fleeting about it.
    expect(html).not.toMatch(/fleeting|signal-sign--shown|signal-glyph--dark/);
  });

  it('shows a fleeting stage one sign at a time in its own place, every lamp kept', () => {
    const sending = { ...signalAt('a', { fleetingFrom: 1 }), done: 1 };
    expect(sending.fleeting).toBe(true);
    const [first, ...rest] = sending.sequence ?? [];
    expect(rest).toHaveLength(3);
    const html = panel(sending);
    expect(html).toContain('Stufe 1 von 4 — dieses Pult sendet');
    expect(html).toContain('<ol class="signal-strip signal-strip--fleeting"');
    // As the strip appears, its first sign shows; the other places are dark.
    const places = [...html.matchAll(/<li class="([^"]*)">/g)].map((m) => m[1]);
    expect(places).toEqual([
      'signal-sign signal-sign--shown',
      'signal-sign',
      'signal-sign',
      'signal-sign',
    ]);
    expect(words(html)).toEqual([tokenLabel(first ?? 'rot-kreis')]);
    expect(html.match(/signal-glyph--dark/g)).toHaveLength(3);
    expect(html.match(/class="signal-lamp/g)).toHaveLength(4);
    expect(lit(html)).toBe(1);
    expect(html).not.toContain('<button');
  });

  it('keeps the strip side by side in the stages before the fleeting one', () => {
    const sending = signalAt('a', { fleetingFrom: 2 });
    expect(sending.fleeting).toBe(false);
    const html = panel(sending);
    expect(words(html)).toEqual((sending.sequence ?? []).map(tokenLabel));
    expect(html).not.toContain('signal-strip--fleeting');
  });

  it('gives the receiving console its twelve signs as keys, and no sequence', () => {
    const receiving = at('b');
    const html = panel(receiving);
    expect(html).toContain('Stufe 1 von 4 — dieses Pult gibt ein');
    const key = /<button class="signal-key" data-token="([a-z]+-[a-z]+)">/g;
    expect([...html.matchAll(key)].map((m) => m[1])).toEqual(receiving.grid);
    expect(words(html)).toEqual((receiving.grid ?? []).map(tokenLabel));
    expect(html).not.toContain('signal-strip');
    expect(html).not.toMatch(/signal-key--shape|signal-row-number|Legende/);
  });

  it('gives the receiving console with the legend 12 grey keys in numbered rows, no colour', () => {
    const receiving = signalAt('b', { legend: true });
    const html = panel(receiving);
    expect(html).toContain('Stufe 1 von 4 — dieses Pult gibt ein');
    expect(rowKeys(html, 'button')).toEqual(receiving.keys);
    expect(rowKeys(html, 'button')).toHaveLength(12);
    expect(rowNumbers(html)).toEqual(['1', '2', '3', '4']);
    expect(words(html)).toEqual(FORMS_BY_ROW);
    expect(html.match(/fill="currentColor"/g)).toHaveLength(12);
    expect(html).not.toMatch(COLOURED);
    expect(html).not.toContain('data-token');
    expect(html).not.toContain('signal-strip');
    expect(html).toContain('Erst bei Ansage drücken; die Zeile zur Farbe nennt die Legende.');
    expect(html.match(/class="signal-lamp( signal-lamp--lit)?"/g)).toHaveLength(4);
  });

  /**
   * Every element `node` renders to, its function components called through:
   * enough to reach a panel's keys and press them without a DOM. Only for
   * parts that use no hooks, as the receiving console's do.
   */
  function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) {
      return node.flatMap((child: ReactNode) => elementsOf(child));
    }
    if (!isValidElement<Record<string, unknown>>(node)) {
      return [];
    }
    if (typeof node.type === 'function') {
      return elementsOf((node.type as (props: unknown) => ReactNode)(node.props));
    }
    return [node, ...elementsOf(node.props['children'] as ReactNode)];
  }

  /** What the receiving console sends for each of its keys, pressed in turn. */
  function pressEvery(puzzle: SignalSeen): unknown[] {
    const sent: unknown[] = [];
    const Panel = PANELS.signal;
    const tree = <Panel puzzle={puzzle} send={(input) => sent.push(input)} deadlineAt={null} />;
    const keys = elementsOf(tree).filter((element) => element.type === 'button');
    expect(keys).toHaveLength(12);
    for (const key of keys) {
      (key.props['onClick'] as () => void)();
    }
    return sent;
  }

  it('sends a sign’s key as the sign, and a key of shapes as its row and its form', () => {
    const plain = at('b');
    expect(pressEvery(plain)).toEqual((plain.grid ?? []).map((token) => ({ press: token })));
    const legend = signalAt('b', { legend: true });
    expect(pressEvery(legend)).toEqual(
      (legend.keys ?? []).map(({ row, shape }) => ({ key: { row, shape } })),
    );
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
    const rows = panel({ ...signalAt('b', { legend: true }), lastResult: 'wrong' });
    expect(rows).toContain(`<p class="warn" role="status">${message}</p>`);
    expect(rows).toContain('class="signal-grid signal-grid--rows signal-grid--wrong"');
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

  it('shows the audience with the legend the strip and the rows both consoles share', () => {
    const watched = signalAt(null, { legend: true, fleetingFrom: 1 });
    const sequence = watched.sequence ?? [];
    expect(sequence).toHaveLength(4);
    const html = panel(watched);
    expect(html).toContain('Stufe 1 von 4 — Pult A sendet');
    // The audience follows the whole sequence, fleeting or not.
    expect(html).toContain('<ol class="signal-strip"');
    const names = [...html.matchAll(/<h4 class="signal-console-name">([^<]*)<\/h4>/g)];
    expect(names.map((m) => m[1])).toEqual(['Pult A und Pult B']);
    expect(rowKeys(html, 'span')).toEqual(watched.keys);
    expect(rowNumbers(html)).toEqual(['1', '2', '3', '4']);
    expect(words(html)).toEqual([...sequence.map(tokenLabel), ...FORMS_BY_ROW]);
    expect(html).not.toContain('<button');
  });
});

describe('a fleeting strip', () => {
  it('shows each sign for 1.2 s in turn, then stays dark for 2 s and starts over', () => {
    expect([FLEETING_SIGN_MS, FLEETING_PAUSE_MS]).toEqual([1200, 2000]);
    const shownAt = (ms: number) => fleetingAt(ms, 4).shown;
    expect([0, 1199, 1200, 2399, 2400, 3600, 4799].map(shownAt)).toEqual([0, 0, 1, 1, 2, 3, 3]);
    expect([4800, 6799].map(shownAt)).toEqual([null, null]);
    expect([6800, 8000, 3 * 6800 + 4799, 3 * 6800 + 4800].map(shownAt)).toEqual([0, 1, 3, null]);
  });

  it('counts a time before its start as the start', () => {
    expect(fleetingAt(-500, 4)).toEqual(fleetingAt(0, 4));
  });

  it('says how long until it changes, so that one timer per change keeps it going', () => {
    expect(fleetingAt(0, 3)).toEqual({ shown: 0, untilNext: 1200 });
    expect(fleetingAt(1000, 3)).toEqual({ shown: 0, untilNext: 200 });
    expect(fleetingAt(3600, 3)).toEqual({ shown: null, untilNext: 2000 });
    expect(fleetingAt(5000, 3)).toEqual({ shown: null, untilNext: 600 });
    // From change to change: every sign, the pause, and round again.
    let ms = 0;
    const steps: (number | null)[] = [];
    for (let step = 0; step < 8; step++) {
      const { shown, untilNext } = fleetingAt(ms, 3);
      steps.push(shown);
      ms += untilNext;
    }
    expect(steps).toEqual([0, 1, 2, null, 0, 1, 2, null]);
    expect(ms).toBe(2 * (3 * 1200 + 2000));
  });

  it.each([3, 4, 5, 6])('gives each of %i signs the same time over a cycle', (count) => {
    const time = new Map<number | null, number>();
    for (let ms = 0; ms < count * 1200 + 2000; ms += 100) {
      const { shown } = fleetingAt(ms, count);
      time.set(shown, (time.get(shown) ?? 0) + 100);
    }
    expect([...time]).toEqual([
      ...Array.from({ length: count }, (_, i): [number, number] => [i, 1200]),
      [null, 2000],
    ]);
  });
});
