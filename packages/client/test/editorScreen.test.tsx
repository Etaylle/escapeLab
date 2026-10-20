import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MissionInfo } from '@escapelab/core';
import { fitTile } from '../src/editor/EditorCanvas.js';
import { EditorScreen, TOOLS } from '../src/editor/EditorScreen.js';
import { newDraft, type Draft } from '../src/editor/draft.js';
import { ID_TAKEN_NOTE } from '../src/editor/MissionForm.js';
import { workOf, type EditorWork } from '../src/editor/session.js';
import { lineBetween, paint, place, type PlacingTool } from '../src/editor/tools.js';
import { validateDraft, type Finding, type Validation } from '../src/editor/validate.js';
import { ValidatorPanel } from '../src/editor/ValidatorPanel.js';
import { MapThumb } from '../src/screens/MapThumb.js';
import { PICTOGRAPH } from './fixtures.js';

const noop = (): void => undefined;

function probe(...steps: [PlacingTool, { x: number; y: number }][]): Draft {
  let draft = newDraft();
  for (let y = 2; y <= 6; y++) {
    draft = paint(draft, lineBetween({ x: 2, y }, { x: 8, y }), '.');
  }
  for (const [tool, at] of steps) {
    draft = place(draft, tool, at, null, { puzzleId: null, console: null }).draft;
  }
  return draft;
}

/** Two starts, the keypad's station and a book for its rules: a sound mission. */
const SOUND: [PlacingTool, { x: number; y: number }][] = [
  ['spawn', { x: 3, y: 4 }],
  ['spawn', { x: 4, y: 4 }],
  ['station', { x: 7, y: 3 }],
  ['source', { x: 7, y: 5 }],
];

const finding = (severity: Finding['severity'], text: string, pointed = true): Finding => ({
  severity,
  text,
  message: text,
  path: '',
  target: pointed ? { kind: 'spawn', index: 0 } : null,
  spots: pointed ? [{ x: 3, y: 4 }] : [],
});

function panel(validation: Validation, active: string | null = null): string {
  return renderToStaticMarkup(
    <ValidatorPanel validation={validation} active={active} onPick={noop} />,
  );
}

describe('the validator panel', () => {
  it('groups findings by severity, errors first, each group counted', () => {
    const html = panel({
      findings: [
        finding('info', 'Kein Notausgang.', false),
        finding('warning', 'Platte „p“ öffnet nichts.'),
        finding('error', 'map: no station for puzzle "x"'),
        finding('error', 'title: Too small'),
      ],
      errors: 2,
      ms: 3.6,
    });
    const headings = ['Fehler <span class="editor-check-count">2</span>', 'Warnungen', 'Hinweise'];
    const order = headings.map((h) => html.indexOf(h));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('2 Fehler');
    expect(html).toContain('4 ms');
  });

  it('lets a finding that points at the map be picked, and marks the picked one', () => {
    const html = panel(
      {
        findings: [finding('error', 'hier'), finding('info', 'nirgends', false)],
        errors: 1,
        ms: 1,
      },
      'hier',
    );
    const picked = 'aria-pressed="true" title="Auf der Karte zeigen">hier</button>';
    expect(html).toContain(`<button class="editor-finding" ${picked}`);
    expect(html).toContain(
      '<button class="editor-finding" aria-pressed="false" disabled="">nirgends</button>',
    );
  });

  it('says so when the mission is sound', () => {
    const html = panel({ findings: [], errors: 0, ms: 0.4 });
    expect(html).toContain('lösbar · speicherbar');
    expect(html).toContain('Jede Crew kommt von jedem Start durch');
    expect(html).toContain('&lt; 1 ms');
  });

  it('shows what the validator says of a real draft', () => {
    const draft = probe(['spawn', { x: 3, y: 4 }], ['station', { x: 7, y: 3 }]);
    const html = panel(validateDraft(draft));
    expect(html).toContain('map.spawns: Too small: expected array to have &gt;=2 items');
    expect(html).toContain('no manual object covers puzzle &quot;tastenfeld&quot;');
  });
});

describe('MapThumb with a draft', () => {
  it('shows the floor painted so far, and nothing for a lab of wall', () => {
    const html = renderToStaticMarkup(<MapThumb tiles={probe().map.tiles} height={64} />);
    expect(html).toContain('viewBox="0 0 20 13"');
    expect(html.match(/M\d+ \d+h1v1h-1z/g)).toHaveLength(35);
    expect(html).toContain('M2 2h1v1h-1z');
    expect(html).toContain('M8 6h1v1h-1z');
    const blank = renderToStaticMarkup(<MapThumb tiles={newDraft().map.tiles} />);
    expect(blank).toContain('<path d="" class="map-thumb-floor"></path>');
  });
});

describe('the editor screen', () => {
  const missions: MissionInfo[] = [
    {
      id: 'custom-probe',
      title: 'Probe',
      subtitle: '',
      players: { min: 2, max: 2 },
      timeLimitSec: 600,
      puzzleCount: 1,
      tiles: [],
      custom: true,
    },
  ];
  const screen = (work: EditorWork, connected = true): string =>
    renderToStaticMarkup(
      <EditorScreen
        missions={missions}
        reloadMissions={noop}
        openHandbook={noop}
        back={noop}
        work={work}
        onWork={noop}
        connected={connected}
        startTestRun={noop}
      />,
    );
  const html = screen(workOf(newDraft()));

  it('opens on a new mission with every tool, the mission form and the validator', () => {
    for (const { tool, label } of TOOLS) {
      expect(html).toContain(`data-tool="${tool}"`);
      expect(html).toContain(`<span>${label}</span>`);
    }
    expect(html).toContain('<strong>Neue Mission</strong>');
    expect(html).toContain('<code class="editor-id">custom-neue-mission</code>');
    expect(html).toContain('aria-label="Prüfung"');
    expect(html).toContain(
      '<canvas class="editor-canvas editor-canvas-floor" data-cols="20" data-rows="13"',
    );
  });

  it('offers saving only for a sound mission, and the handbook only for a saved one', () => {
    expect(html).toContain(
      '<button class="primary" disabled="" title="Erst die Fehler beheben">Speichern</button>',
    );
    expect(html).toMatch(/<button disabled="" title="Erst speichern">Handbuch<\/button>/);
  });

  it('offers a test run only to a mission without errors, counting them otherwise', () => {
    // A new draft lacks starts, a station and a source for its keypad.
    const errors = validateDraft(newDraft()).errors;
    expect(errors).toBeGreaterThan(1);
    expect(html).toContain(
      `<button disabled="" aria-expanded="false" title="Erst die ${errors} Fehler beheben">` +
        'Probespiel</button>',
    );
    const sound = screen(workOf(probe(...SOUND)));
    expect(sound).toContain(
      '<button aria-expanded="false" ' +
        'title="Speichern und eine Runde mit dieser Mission eröffnen">Probespiel</button>',
    );
  });

  it('offers a link to share, and marks a mission opened from one until it is saved', () => {
    expect(html).toContain('Teilen</button>');
    expect(html).not.toContain('GETEILT');
    const shared = screen({ ...workOf(probe()), shared: true });
    expect(shared).toContain('<span class="editor-shared">GETEILT · nicht gespeichert</span>');
    expect(shared).not.toContain('ungespeichert</span>');
    const changed = screen({ ...workOf(newDraft()), draft: probe() });
    expect(changed).toContain('<span class="editor-dirty">ungespeichert</span>');
  });

  it('notes under the title of a shared mission that its id is taken here', () => {
    const titled = { ...probe(), title: 'Probe' };
    expect(screen({ ...workOf(titled), shared: true })).toContain(ID_TAKEN_NOTE);
    expect(screen(workOf(titled))).not.toContain(ID_TAKEN_NOTE);
  });

  it('speaks German without pictographs', () => {
    expect(html).not.toMatch(PICTOGRAPH);
  });
});

describe('fitting the map', () => {
  it('takes the largest whole tile that fits, within bounds', () => {
    expect(fitTile({ width: 860, height: 600 }, 20, 13)).toBe(43);
    expect(fitTile({ width: 4000, height: 4000 }, 20, 13)).toBe(48);
    expect(fitTile({ width: 100, height: 100 }, 60, 40)).toBe(10);
    expect(fitTile({ width: 0, height: 0 }, 20, 13)).toBe(24);
  });
});
