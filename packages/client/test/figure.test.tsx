import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MODULES } from '@escapelab/core';
import { Figure } from '../src/screens/Figure.js';

/** What each drawing says it shows, in German: every module the core knows. */
const SAYS: Record<string, RegExp> = {
  wiring: /^Sicherungskasten: 4 Kabel/,
  keypad: /^Tastenfeld: 4 quadratische Tasten/,
  switches: /^Schalterbank: 6 Hebel/,
  simon: /^Farbtasten: 4 Tasten im Quadrat.*Alarmzähler/,
  button: /^Großer runder Knopf mit Aufschrift.*Farbstreifen/,
  memory: /^Speicherfeld: Display mit einer Ziffer/,
  morse: /^Funkgerät: Signallampe, Sendetaste TX und Frequenzregler/,
  maze: /^Labyrinth: Raster aus 6 × 6 Feldern/,
  'button-sync': /^Großer Knopf unter 2 Lampen/,
  relay: /^Schaltpult: 4 beschriftete Schieberegler/,
  signal: /^Zwei Pulte nebeneinander/,
};

function drawing(of: string): { html: string; label: string } {
  const html = renderToStaticMarkup(<Figure of={of} />);
  return { html, label: /aria-label="([^"]*)"/.exec(html)?.[1] ?? '' };
}

describe('Figure', () => {
  it('has a drawing for every module the core knows', () => {
    const types = MODULES.map((module) => module.type);
    expect(Object.keys(SAYS).sort()).toEqual([...types].sort());
  });

  it.each(Object.entries(SAYS))(
    'draws %s in lines of the ink, saying what it shows',
    (type, says) => {
      const { html, label } = drawing(type);
      expect(html).toMatch(/^<svg class="figure" viewBox="0 0 376 140" role="img" aria-label="/);
      expect(label).toMatch(says);
      // Its own drawing, not the frame that names an unknown device.
      expect(html).not.toContain(`>${type}</text>`);
      expect(html).toMatch(/<(path|rect|circle) /);
      // Monochrome: every stroke and fill is the colour of the text around it.
      expect(html).toContain('stroke="currentColor"');
      expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    },
  );

  it('tells every device apart in words', () => {
    const labels = Object.keys(SAYS).map((type) => drawing(type).label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('frames a device it has no drawing for, naming its type, and never throws', () => {
    for (const of of ['teleporter', 'constructor', '__proto__', '']) {
      const { html, label } = drawing(of);
      expect(html).toMatch(/^<svg class="figure" viewBox="0 0 376 140" role="img"/);
      expect(label).toBe(`Gerät „${of}“, ohne Zeichnung`);
      expect(html).toContain('stroke-dasharray="5 4"');
      expect(html).toContain(`>${of}</text>`);
    }
  });
});
