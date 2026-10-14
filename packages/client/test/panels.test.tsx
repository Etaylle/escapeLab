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

describe('the fuse box and the meter', () => {
  type CircuitSeen = Extract<PuzzleView, { kind: 'circuit' }>;

  /** The box of five at console `seat`, with what `change` says happened since. */
  function at(seat: ConsoleId, change: Partial<CircuitSeen> = {}): CircuitSeen {
    const view = seen('circuit', true, { wires: { min: 5, max: 5 } }, seat);
    if (view.kind !== 'circuit') {
      throw new Error(`expected the fuse box, got ${view.kind}`);
    }
    return { ...view, ...change };
  }

  const COLOURS = ['rot', 'blau', 'gelb', 'weiß', 'schwarz'];
  /** A voltage anywhere in the markup. */
  const VOLTS = /\d+ V\b/;
  /** This round's readings as the meter lists them, wire by wire. */
  const listed = (html: string): string[] =>
    [...html.matchAll(/<span class="circuit-reading">([^<]*)<\/span>/g)].map((m) => m[1] ?? '');

  it('gives the box a button per wire, numbered from the top in its colour, and no voltage', () => {
    const box = at('a');
    const wires = box.wires ?? [];
    expect(wires).toHaveLength(5);
    const html = panel(box);
    const buttons = [...html.matchAll(/<button class="circuit-wire [^"]*" data-index="(\d)"/g)];
    expect(buttons.map((m) => Number(m[1]))).toEqual([0, 1, 2, 3, 4]);
    const names = [...html.matchAll(/<span class="wiring-name">([^<]*)<\/span>/g)];
    expect(names.map((m) => m[1])).toEqual(wires.map((wire) => wire.colour));
    expect(html.match(/<span class="wiring-pos">\d<\/span>/g)).toHaveLength(5);
    expect(html).toContain('Noch unter Spannung: 4');
    expect(html).not.toMatch(VOLTS);
    expect(html).not.toMatch(/circuit-(probe|readout|reading)/);
  });

  it('shows a cut wire cut, and lets nobody cut it again', () => {
    const box = at('a');
    const wires = (box.wires ?? []).map((wire, i) => ({ ...wire, cut: i === 2 }));
    const html = panel({ ...box, wires, liveLeft: 3 });
    const cut = /<button class="circuit-wire [^"]*wiring-cut" data-index="(\d)" disabled=""/g;
    expect([...html.matchAll(cut)].map((m) => m[1])).toEqual(['2']);
    expect(html).toContain('Noch unter Spannung: 3');
  });

  it('gives the meter a key per wire, the display and the readings, and no colour', () => {
    const meter = at('b');
    const html = panel(meter);
    const keys = [...html.matchAll(/<button class="circuit-probe" data-index="(\d)"[^>]*>(\d)</g)];
    expect(keys.map((m) => [Number(m[1]), Number(m[2])])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    expect(html).toContain('<output class="circuit-readout" aria-live="polite">—</output>');
    expect(listed(html)).toEqual(['—', '—', '—', '—', '—']);
    expect(html).toContain('Noch unter Spannung: 4');
    expect(html).not.toMatch(VOLTS);
    expect(html).not.toMatch(/circuit-wire|wiring-/);
    for (const colour of COLOURS) {
      expect(html).not.toContain(colour);
    }
  });

  it('reads out the wire measured last, and lists the round’s readings', () => {
    const html = panel(at('b', { readings: [24, 0, 110, null, null], probed: 2 }));
    const readout = /<output class="circuit-readout" aria-live="polite">([^<]*)<\/output>/;
    expect(readout.exec(html)?.[1]).toBe('Kabel 3: 110 V');
    expect(listed(html)).toEqual(['24 V', '0 V', '110 V', '—', '—']);
    // A new round clears the readings: the display keeps the wire, without a voltage.
    expect(readout.exec(panel(at('b', { probed: 2 })))?.[1]).toBe('Kabel 3: —');
  });

  it('says a short rewired the box and shakes it, and what a burnout costs', () => {
    const shorted = panel(at('a', { lastResult: 'short', shorts: 1 }));
    expect(shorted).toContain('<div class="circuit circuit--short">');
    expect(shorted).toContain('<p class="warn" role="status">Kurzschluss — neu verdrahtet.</p>');
    const burnt = panel(at('b', { lastResult: 'burnout', shorts: 3, burnoutSec: 75 }));
    expect(burnt).toContain('<div class="circuit circuit--short">');
    expect(burnt).toContain('<p class="warn" role="status">Kasten durchgebrannt — −75 s.</p>');
    for (const calm of [panel(at('a')), panel(at('b'))]) {
      expect(calm).toContain('<div class="circuit">');
      expect(calm).not.toMatch(/Kurzschluss|durchgebrannt/);
    }
  });

  it('tells a console nobody stands at that it is not connected', () => {
    expect(panel(seen('circuit', false))).toBe(
      '<p class="muted">Dieses Pult ist nicht angeschlossen.</p>',
    );
  });

  it('shows the audience both consoles, every voltage and the dead wire, none to press', () => {
    const watched = seen('circuit', true, { wires: { min: 5, max: 5 } }, null, null);
    if (watched.kind !== 'circuit' || watched.voltages === null || watched.dead === null) {
      throw new Error('expected the audience to see every voltage');
    }
    const { voltages, dead } = watched;
    const html = panel(watched);
    const names = [...html.matchAll(/<h4 class="circuit-console-name">([^<]*)<\/h4>/g)];
    expect(names.map((m) => m[1])).toEqual(['Pult A', 'Pult B']);
    const shown = [...html.matchAll(/<span class="circuit-volts">([^<]*)<\/span>/g)];
    expect(shown.map((m) => m[1])).toEqual(voltages.map((v, i) => (dead[i] ? 'tot' : `${v} V`)));
    expect(dead.filter(Boolean)).toHaveLength(1);
    const rows = /<span class="circuit-wire [^"]*circuit-wire--watched" data-index/g;
    expect(html.match(rows)).toHaveLength(5);
    expect(html).not.toContain('<button');
  });
});
