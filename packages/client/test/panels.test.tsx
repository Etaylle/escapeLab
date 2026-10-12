import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { generateEdgework, moduleFor, puzzleDefSchema, type PuzzleView } from '@escapelab/core';
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

/** The open puzzle of `type` as a player sees it, at its station or away from it. */
function seen(type: string, operating = true, fields: Record<string, unknown> = {}): PuzzleView {
  const def = puzzleDefSchema.parse({ type, id: type, title: 'Station', ...fields });
  const station = moduleFor(def.type);
  const rng = lcg(7);
  const edgework = generateEdgework(rng);
  const crew = ['p1', 'p2'];
  const state = station.init(def, rng, { edgework, alarms: 0, remainingSec: 600, at: 0, crew });
  const viewer = { playerId: 'p1', operating, reading: false };
  const view = station.view(def, state, viewer, { edgework, alarms: 0, crew });
  return { ...view, index: 0, total: 1, title: def.title, manual: null };
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
