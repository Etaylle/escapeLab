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
import { PuzzlePanel } from '../src/screens/PuzzlePanel.js';

/** A small deterministic generator, enough to set an instance up. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

/**
 * The open puzzle of `type` as a player sees it, at its station — at console
 * `seat` where it has two — or away from it.
 */
function seen(
  type: string,
  operating = true,
  fields: Record<string, unknown> = {},
  seat: ConsoleId | null = operating ? 'a' : null,
): PuzzleView {
  const def = puzzleDefSchema.parse({ type, id: type, title: 'Station', ...fields });
  const station = moduleFor(def.type);
  const rng = lcg(7);
  const edgework = generateEdgework(rng);
  const crew = ['p1', 'p2'];
  const setup = { edgework, alarms: 0, remainingSec: 600, at: 0, crew, console: null };
  const state = station.init(def, rng, setup);
  const viewer = { playerId: 'p1', operating, reading: false, console: seat };
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
});
