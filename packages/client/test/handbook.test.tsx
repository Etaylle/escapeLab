import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MissionInfo, MissionManual, MissionManualStation } from '@escapelab/core';
import { Handbook, HandbookScreen } from '../src/screens/Handbook.js';
import { iconsAsWords } from './fixtures.js';

const keypad: MissionManualStation = {
  index: 0,
  title: 'Zugangscode',
  readAt: ['HANDBUCH'],
  usesEdgework: true,
  manual: [
    {
      heading: 'Tastenfeld',
      blocks: [
        { kind: 'figure', of: 'keypad', caption: 'Abb. 1 — Tastenfeld' },
        { kind: 'p', text: 'Vier Tasten.' },
        { kind: 'rules', items: ['Erst A.', 'Dann B.'] },
        { kind: 'table', head: ['Farbe', 'Taste'], rows: [['rot', '2'], ['blau', '4']] },
        { kind: 'columns', columns: [['Ω', 'Ж'], ['☖']] },
        { kind: 'example', title: 'Beispiel', lines: ['Gesehen: Ω, Ж.', 'Gedrückt: Ж, Ω.'] },
      ],
    },
  ],
};

const sync: MissionManualStation = {
  index: 1,
  title: 'Reaktor-Neustart',
  readAt: [],
  usesEdgework: false,
  manual: [{ heading: 'Synchronschaltung', blocks: [{ kind: 'p', text: 'Alle zugleich.' }] }],
};

const manual: MissionManual = {
  missionTitle: 'Blackout im Labor',
  hintCostSec: 20,
  stations: [keypad, sync],
};

describe('Handbook', () => {
  it('opens with a title page naming the mission, where it lies and the edgework', () => {
    const html = renderToStaticMarkup(<Handbook manual={manual} />);
    expect(html).toContain('NOTFALL-HANDBUCH');
    expect(html).toContain('<h1>Blackout im Labor</h1>');
    expect(html).toContain('<dt>Liegt aus</dt><dd>HANDBUCH</dd>');
    expect(html).toContain('je 20 s Missionszeit');
    expect(html).toContain('Laborkennung, Kontrollleuchten und Notstromzellen wechseln');
  });

  it('gives every station a chapter and renders every kind of block', () => {
    const html = renderToStaticMarkup(<Handbook manual={manual} />);
    expect(html.match(/<section class="handbook-chapter">/g)).toHaveLength(2);
    expect(html).toContain('<h2>§1 — Zugangscode</h2>');
    expect(html).toContain('Nachzulesen: HANDBUCH');
    expect(html).toContain('<h2>§2 — Reaktor-Neustart</h2>');
    expect(html).toContain(
      '<p class="handbook-crew">' +
        'Schaltet nur, wenn jeder angemeldete Ausweis vor Ort bestätigt.</p>',
    );
    expect(html).toContain('<h3>Tastenfeld</h3>');
    expect(html).toContain('<p>Vier Tasten.</p>');
    expect(html).toContain('<ol class="manual-rules"><li>Erst A.</li><li>Dann B.</li></ol>');
    expect(html).toContain('<th scope="col">Farbe</th>');
    expect(html).toContain('<tr><td>blau</td><td>4</td></tr>');
    expect(html).toContain('aria-label="Spalte 2"><li>☖</li></ol>');
    expect(html).toContain('<p>Alle zugleich.</p>');
    expect(html).toMatch(/<figure class="manual-figure"><svg class="figure" [^>]*role="img"/);
    expect(html).toContain('<figcaption>Abb. 1 — Tastenfeld</figcaption>');
    expect(html).toContain(
      '<ol class="manual-example-lines"><li>Gesehen: Ω, Ж.</li><li>Gedrückt: Ж, Ω.</li></ol>',
    );
  });

  it('skips the edgework note when no station reads it; nothing to read lies nowhere', () => {
    const html = renderToStaticMarkup(
      <Handbook manual={{ ...manual, stations: [{ ...sync, index: 0 }] }} />,
    );
    expect(html).not.toContain('Laborkennung');
    expect(html).toContain('<dd>nirgends</dd>');
  });

  it('lists each place once, in chapter order', () => {
    const html = renderToStaticMarkup(
      <Handbook
        manual={{
          ...manual,
          stations: [
            keypad,
            { ...keypad, index: 1, readAt: ['TERMINAL', 'HANDBUCH'] },
            { ...keypad, index: 2 },
          ],
        }}
      />,
    );
    expect(html).toContain('<dd>HANDBUCH, TERMINAL</dd>');
  });
});

describe('HandbookScreen', () => {
  const mission = (id: string, title: string): MissionInfo => ({
    id,
    title,
    subtitle: '',
    players: { min: 2, max: 2 },
    timeLimitSec: 600,
    puzzleCount: 1,
    tiles: [],
  });
  const missions = [
    mission('systemcheck', 'Tutorial: Systemcheck'),
    mission('blackout', 'Blackout im Labor'),
  ];

  it('offers every mission with the open one picked, and holds printing until loaded', () => {
    const html = renderToStaticMarkup(
      <HandbookScreen
        missions={missions}
        missionId="blackout"
        selectMission={() => undefined}
        back={() => undefined}
      />,
    );
    expect(html).toContain('<option value="systemcheck">Tutorial: Systemcheck</option>');
    expect(html).toContain('<option value="blackout" selected="">Blackout im Labor</option>');
    expect(html).toContain('← Zurück');
    expect(iconsAsWords(html)).toContain(
      '<button class="primary handbook-print" disabled="">[printer] Drucken</button>',
    );
    expect(html).toContain('Lade Handbuch …');
  });
});
