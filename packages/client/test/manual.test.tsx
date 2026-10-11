import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Edgework, ManualSection } from '@escapelab/core';
import { EdgeworkChip } from '../src/screens/EdgeworkChip.js';
import { Manual } from '../src/screens/Manual.js';

describe('Manual', () => {
  it('renders every kind of block the modules can print', () => {
    const sections: ManualSection[] = [
      {
        heading: 'Tastenfeld',
        blocks: [
          { kind: 'p', text: 'Vier Tasten.' },
          { kind: 'rules', items: ['Erst A.', 'Dann B.'] },
          { kind: 'table', head: ['Farbe', 'Taste'], rows: [['rot', '2'], ['blau', '4']] },
          { kind: 'columns', columns: [['Ω', 'Ж'], ['☖']] },
        ],
      },
    ];
    const html = renderToStaticMarkup(<Manual sections={sections} />);
    expect(html).toContain('<h3>Tastenfeld</h3>');
    expect(html).toContain('<p>Vier Tasten.</p>');
    expect(html).toContain('<ol class="manual-rules"><li>Erst A.</li><li>Dann B.</li></ol>');
    expect(html).toContain('<th scope="col">Farbe</th>');
    expect(html).toContain('<tr><td>blau</td><td>4</td></tr>');
    expect(html).toContain('aria-label="Spalte 2"><li>☖</li></ol>');
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
