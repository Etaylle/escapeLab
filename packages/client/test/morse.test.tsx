import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PuzzleView } from '@escapelab/core';
import { lampRuns, MorsePanel } from '../src/puzzles/MorsePanel.js';

type MorseView = Extract<PuzzleView, { kind: 'morse' }>;

const noop = (): void => undefined;

function view(pattern: string | null, dial: number): MorseView {
  return {
    kind: 'morse',
    pattern,
    dial,
    steps: 16,
    frequency: '3,545 MHz',
    index: 0,
    total: 1,
    title: 'Funkfeuer',
    manual: null,
    console: 'a',
    backup: null,
  };
}

function render(puzzle: MorseView): string {
  return renderToStaticMarkup(
    <MorsePanel puzzle={puzzle} change={null} send={noop} deadlineAt={null} />,
  );
}

/** The opening tag of the button with this label. */
function button(html: string, label: string): string {
  return html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';
}

describe('morse lamp', () => {
  it('blinks short 1, long 3; dark 1 in a letter, 3 between letters, 7 before repeating', () => {
    expect(lampRuns('-.. .-')).toEqual([
      { on: true, units: 3 },
      { on: false, units: 1 },
      { on: true, units: 1 },
      { on: false, units: 1 },
      { on: true, units: 1 },
      { on: false, units: 3 },
      { on: true, units: 1 },
      { on: false, units: 1 },
      { on: true, units: 3 },
      { on: false, units: 7 },
    ]);
  });

  it('loops a whole word: SOS takes 34 units', () => {
    const runs = lampRuns('... --- ...');
    expect(runs.reduce((sum, run) => sum + run.units, 0)).toBe(34);
    expect(runs.filter((run) => run.on)).toHaveLength(9);
  });
});

describe('MorsePanel', () => {
  it('gives the operator lamp, dial and SENDEN, with ◀ off at the bottom of the band', () => {
    const html = render(view('-.. .-', 0));
    expect(html).toContain('aria-label="Signallampe"');
    expect(html).toContain('3,545 MHz');
    expect(html).toContain('SENDEN');
    expect(button(html, 'Frequenz runter')).toContain('disabled');
    expect(button(html, 'Frequenz hoch')).not.toContain('disabled');
    expect(html.match(/morse-tick-on/g)).toHaveLength(1);
  });

  it('turns ▶ off at the top of the band', () => {
    const html = render(view('-.. .-', 15));
    expect(button(html, 'Frequenz runter')).not.toContain('disabled');
    expect(button(html, 'Frequenz hoch')).toContain('disabled');
  });

  it('shows everyone else the dial reading but no lamp and no controls', () => {
    const html = render(view(null, 8));
    expect(html).toContain('Regler: 3,545 MHz');
    expect(html).not.toContain('Signallampe"');
    expect(html).not.toContain('<button');
  });
});
