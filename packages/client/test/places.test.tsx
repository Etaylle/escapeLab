import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Edgework, ManualHere, PlayerView, PuzzleView } from '@escapelab/core';
import { GameScreen } from '../src/screens/Game.js';
import { Legend } from '../src/screens/InfoPanel.js';
import { ReadingOverlay } from '../src/screens/Reading.js';
import { PresenceTags } from '../src/screens/Spectate.js';
import { WorldModal } from '../src/screens/WorldModal.js';
import { mapWith, type Manual, type Plate } from './fixtures.js';

const noop = (): void => undefined;

const edgework: Edgework = {
  serial: 'K7G3A-2',
  indicators: [
    { id: 'FRQ', lit: true },
    { id: 'SIG', lit: false },
    { id: 'CAR', lit: true },
  ],
  cells: 3,
};

/** A terminal printing the first and the third station. */
const terminal: ManualHere = {
  id: 'plan',
  label: 'SCHALTPLAN',
  kind: 'terminal',
  sections: [
    {
      puzzleId: 'kabel',
      index: 0,
      title: 'Kabel',
      manual: [{ heading: 'Kabel', blocks: [{ kind: 'p', text: 'Rot zuerst.' }] }],
    },
    {
      puzzleId: 'netz',
      index: 2,
      title: 'Leitungsnetz',
      manual: [{ heading: 'Netz', blocks: [{ kind: 'p', text: 'Wände zeigt der Plan.' }] }],
    },
  ],
};

/** The maze as seen from a manual object: walls when it covers the maze, never the marker. */
function maze(index: number, cells: number[] | null): PuzzleView {
  return {
    kind: 'maze',
    size: 4,
    pos: null,
    goal: { x: 3, y: 3 },
    cells,
    lastResult: null,
    index,
    total: 3,
    title: 'Leitungsnetz',
    manual: null,
    hints: { shown: [], left: 0, readyAt: null, costSec: 20 },
  };
}

function read(puzzle: PuzzleView | null, current = 2, seen: Edgework | null = null): string {
  return renderToStaticMarkup(
    <ReadingOverlay
      manual={terminal}
      puzzle={puzzle}
      current={current}
      edgework={seen}
      onClose={noop}
    />,
  );
}

describe('the reading overlay', () => {
  it('is headed by the object and has a paragraph for every station it covers', () => {
    const html = read(null);
    expect(html).toContain('class="puzzle-modal reading-modal"');
    expect(html).toContain('<div class="panel-label">// SCHALTPLAN</div>');
    expect(html).toContain('<h3 class="reading-title">§1 — Kabel</h3>');
    expect(html).toContain('<h3 class="reading-title">§3 — Leitungsnetz</h3>');
    expect(html).toContain('<p>Rot zuerst.</p>');
    expect(html).toContain('<p>Wände zeigt der Plan.</p>');
  });

  it('greys out the paragraphs of solved stations and marks the one that is up', () => {
    const html = read(null, 2);
    expect(html).toContain('class="reading-section reading-done"><h3 class="reading-title">§1');
    expect(html).toContain('class="reading-section reading-now"><h3 class="reading-title">§3');
  });

  it("adds the open maze's wall plan to its own paragraph — walls and goal, no marker", () => {
    const html = read(maze(2, new Array<number>(16).fill(0)));
    expect(html.match(/<svg class="maze"/g)).toHaveLength(1);
    const plan = html.indexOf('<svg class="maze"');
    expect(plan).toBeGreaterThan(html.indexOf('Wände zeigt der Plan.'));
    expect(html).toContain('maze-wall');
    expect(html).toContain('maze-goal');
    expect(html).not.toContain('maze-marker');
  });

  it('shows no plan for a station that is not open here, nor without the walls', () => {
    expect(read(maze(1, new Array<number>(16).fill(0)))).not.toContain('<svg');
    expect(read(maze(2, null))).not.toContain('<svg');
  });

  it('carries the Laborkennung in its header only once the sign was read', () => {
    expect(read(null)).not.toContain('class="edgework"');
    expect(read(null, 2, edgework)).toContain('class="edgework"');
  });
});

describe('the station frame', () => {
  it('names the station by paragraph, has a way out and no chip before the sign', () => {
    const html = renderToStaticMarkup(
      <WorldModal kind="station" label="§1 — Notstrom" edgework={null} onClose={noop}>
        <p>Pult</p>
      </WorldModal>,
    );
    expect(html).toContain('class="puzzle-modal station-modal"');
    expect(html).toContain('<div class="panel-label">// §1 — Notstrom</div>');
    expect(html).toContain('aria-label="Schließen"');
    expect(html).toContain('<p>Pult</p>');
    expect(html).not.toContain('edgework');
  });
});

describe('the map legend', () => {
  const book: Manual = { id: 'b', kind: 'book', x: 1, y: 1, label: 'HANDBUCH', puzzleIds: ['k'] };
  const camera: Plate = {
    id: 'kamera',
    x: 2,
    y: 2,
    label: 'KAMERA HALTEN',
    pressed: false,
    freezesDrone: true,
  };
  const door: Plate = { ...camera, id: 'tuer', label: 'HALTEN', freezesDrone: false };

  it('says in one line each what the things on this map are for', () => {
    const html = renderToStaticMarkup(
      <Legend
        map={mapWith({
          manuals: [book, { ...book, id: 't', kind: 'terminal' }, { ...book, id: 'b2' }],
          edgeworkSign: { x: 3, y: 3 },
          plates: [camera, door],
        })}
      />,
    );
    expect(html.match(/class="legend-row"/g)).toHaveLength(4);
    expect(html).toContain('Buch · Terminal</dt><dd>Regeln der Stationen</dd>');
    expect(html).toContain('Schild</dt><dd>Laborkennung</dd>');
    expect(html).toContain('Kamera-Platte</dt><dd>hält die Drohne an</dd>');
    expect(html).toContain('HALTEN-Platte</dt><dd>hält eine Tür offen</dd>');
  });

  it('leaves out what the map does not have', () => {
    const bare = renderToStaticMarkup(<Legend map={mapWith({ manuals: [book] })} />);
    expect(bare.match(/class="legend-row"/g)).toHaveLength(1);
    expect(bare).not.toContain('Platte');
    expect(bare).not.toContain('Schild');
    const doorsOnly = renderToStaticMarkup(<Legend map={mapWith({ plates: [door] })} />);
    expect(doorsOnly.match(/class="legend-row"/g)).toHaveLength(1);
    expect(doorsOnly).toContain('HALTEN-Platte');
    expect(doorsOnly).not.toContain('Kamera');
  });
});

describe('presence tags for the audience', () => {
  it('say who stands at a panel, who reads and who has seen the sign', () => {
    const at = renderToStaticMarkup(
      <PresenceTags presence={{ stationId: 'kabel', manualId: null, signSeen: true }} />,
    );
    expect(at).toContain('PULT');
    expect(at).toContain('KENNUNG');
    expect(at).not.toContain('LIEST');
    const away = renderToStaticMarkup(
      <PresenceTags presence={{ stationId: null, manualId: 'plan', signSeen: false }} />,
    );
    expect(away).toBe('<span class="presence-tag presence-read">LIEST</span>');
  });
});

/** A run of Blackout that has just started, seen by the player in the Maschinenraum. */
function justStarted(parts: Partial<PlayerView> = {}): PlayerView {
  const now = Date.now();
  return {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: 'Stromausfall.',
    you: {
      id: 'p2',
      name: 'Ben',
      roleId: 'steuerpult',
      color: '#f472b6',
      ready: true,
      isHost: false,
    },
    players: [
      {
        id: 'p2',
        name: 'Ben',
        roleId: 'steuerpult',
        roleName: 'Steuerpult',
        color: '#f472b6',
        ready: true,
        connected: true,
        isHost: false,
      },
    ],
    palette: [],
    roles: [],
    deadlineAt: now + 600_000,
    startedAt: now,
    finishedAt: null,
    timeLimitSec: 600,
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    pausedFor: null,
    events: [],
    grade: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    hintsUsed: 0,
    edgework: null,
    presence: { stationId: null, manualId: null, signSeen: false },
    manualsHere: [],
    puzzle: null,
    map: mapWith({
      tiles: ['#######', '#.....#', '#.....#', '#######'],
      yourSpawn: { x: 1, y: 2 },
      labels: [{ text: 'MASCHINENRAUM', x: 2, y: 1 }],
      stations: [{ puzzleId: 'kabel', x: 4, y: 1, title: 'Notstrom', status: 'armed' }],
    }),
    ...parts,
  };
}

function game(view: PlayerView): string {
  return renderToStaticMarkup(
    <GameScreen
      view={view}
      positionsRef={{ current: {} }}
      dronesRef={{ current: {} }}
      pingsRef={{ current: [] }}
      chatsRef={{ current: [] }}
      send={noop}
    />,
  );
}

describe('the start of a run', () => {
  it('briefs with the mission and the start room only', () => {
    const html = game(justStarted());
    expect(html).toContain(
      '<div class="overlay briefing"><h1>Blackout im Labor</h1>' +
        '<p>Start: <strong>MASCHINENRAUM</strong></p>',
    );
    expect(html).not.toContain('Du bist');
  });

  it('opens no modal by itself, not even standing at the open station', () => {
    const html = game(
      justStarted({
        presence: { stationId: 'kabel', manualId: null, signSeen: false },
        puzzle: maze(0, null),
      }),
    );
    expect(html).not.toContain('puzzle-modal');
  });

  it('shows no edgework anywhere before the sign, and the chip in the HUD after it', () => {
    expect(game(justStarted())).not.toContain('edgework');
    const seen = game(
      justStarted({ presence: { stationId: null, manualId: null, signSeen: true }, edgework }),
    );
    expect(seen).toMatch(/<section class="hud">.*class="edgework"/s);
  });
});
