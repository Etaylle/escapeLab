import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Edgework, ManualBlock, ManualSection } from '@escapelab/core';
import { EdgeworkChip } from '../src/screens/EdgeworkChip.js';
import { Block, Manual } from '../src/screens/Manual.js';

const drawing: ManualBlock = { kind: 'figure', of: 'keypad', caption: 'Abb. 1 — Tastenfeld' };
const worked: ManualBlock = {
  kind: 'example',
  title: 'Beispiel',
  lines: ['Gesehen: Ω, Ж, ☆, ¶.', 'Spalte 2 enthält alle vier.', 'Gedrückt: Ж, ☆, ¶, Ω.'],
};

describe('Manual', () => {
  it('renders every kind of block the modules can print', () => {
    const sections: ManualSection[] = [
      {
        heading: 'Tastenfeld',
        blocks: [
          drawing,
          { kind: 'p', text: 'Vier Tasten.' },
          { kind: 'rules', items: ['Erst A.', 'Dann B.'] },
          { kind: 'table', head: ['Farbe', 'Taste'], rows: [['rot', '2'], ['blau', '4']] },
          { kind: 'columns', columns: [['Ω', 'Ж'], ['☖']] },
          worked,
        ],
      },
    ];
    const html = renderToStaticMarkup(<Manual sections={sections} />);
    expect(html).toContain('<h3>Tastenfeld</h3><figure class="manual-figure"><svg class="figure"');
    expect(html).toContain('<p>Vier Tasten.</p>');
    expect(html).toContain('<ol class="manual-rules"><li>Erst A.</li><li>Dann B.</li></ol>');
    expect(html).toContain('<th scope="col">Farbe</th>');
    expect(html).toContain('<tr><td>blau</td><td>4</td></tr>');
    expect(html).toContain('aria-label="Spalte 2"><li>☖</li></ol>');
    expect(html).toMatch(/<aside class="manual-example">.*<\/aside><\/article>/);
  });
});

describe('Block', () => {
  it('sets a worked example as a box: its title, then the lines in order, one each', () => {
    expect(renderToStaticMarkup(<Block block={worked} />)).toBe(
      '<aside class="manual-example"><strong class="manual-example-title">Beispiel</strong>' +
        '<ol class="manual-example-lines"><li>Gesehen: Ω, Ж, ☆, ¶.</li>' +
        '<li>Spalte 2 enthält alle vier.</li><li>Gedrückt: Ж, ☆, ¶, Ω.</li></ol></aside>',
    );
  });

  it('sets a device drawing with its caption under it', () => {
    const html = renderToStaticMarkup(<Block block={drawing} />);
    expect(html).toMatch(
      /^<figure class="manual-figure"><svg class="figure" [^>]*role="img" aria-label="Tastenfeld: /,
    );
    expect(html).toMatch(/<\/svg><figcaption>Abb\. 1 — Tastenfeld<\/figcaption><\/figure>$/);
  });

  it('frames a device it has no drawing for and still prints the caption', () => {
    const html = renderToStaticMarkup(
      <Block block={{ kind: 'figure', of: 'teleporter', caption: 'Abb. 1 — Gerät' }} />,
    );
    expect(html).toContain('aria-label="Gerät „teleporter“, ohne Zeichnung"');
    expect(html).toContain('<figcaption>Abb. 1 — Gerät</figcaption>');
  });
});

describe('EdgeworkChip', () => {
  it('shows serial, lamps and cells, and says them in words for screen readers', () => {
    const edgework: Edgework = {
      serial: 'K7G3A-2',
      indicators: [
        { id: 'FRQ', lit: true },
        { id: 'SIG', lit: false },
        { id: 'CAR', lit: true },
      ],
      cells: 3,
    };
    const html = renderToStaticMarkup(<EdgeworkChip edgework={edgework} />);
    expect(html).toContain(
      'aria-label="Laborkennung K7G3A-2; Kontrollleuchten FRQ an, SIG aus, CAR an; Notstromzellen 3"',
    );
    expect(html).toContain('>K7G3A-2<');
    expect(html.match(/edgework-cell on/g)).toHaveLength(3);
    expect(html.match(/class="edgework-cell"/g)).toHaveLength(1);
  });
});
