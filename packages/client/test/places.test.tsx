import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Edgework, ManualHere, PlayerView, PuzzleView } from '@escapelab/core';
import { Book } from '../src/screens/Book.js';
import { GameScreen } from '../src/screens/Game.js';
import { Legend } from '../src/screens/InfoPanel.js';
import { ReadingOverlay } from '../src/screens/Reading.js';
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
      notes: [],
      noteReadyAt: null,
      notesLeft: 0,
      costSec: 20,
    },
    {
      puzzleId: 'netz',
      index: 2,
      title: 'Leitungsnetz',
      manual: [{ heading: 'Netz', blocks: [{ kind: 'p', text: 'Wände zeigt der Plan.' }] }],
      notes: [],
      noteReadyAt: null,
      notesLeft: 0,
      costSec: 20,
    },
  ],
};

type Section = ManualHere['sections'][number];

/** The same two stations bound as a book; `open` goes into the third station's section. */
function bound(open: Partial<Section> = {}, kind: ManualHere['kind'] = 'book'): ManualHere {
  const [first, third] = terminal.sections as [Section, Section];
  const sections = [first, { ...third, ...open }];
  return { ...terminal, id: 'buch', label: 'HANDBUCH', kind, sections };
}

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
  };
}

function read(
  puzzle: PuzzleView | null,
  current = 2,
  seen: Edgework | null = null,
  manual = terminal,
): string {
  return renderToStaticMarkup(
    <ReadingOverlay
      manual={manual}
      puzzle={puzzle}
      current={current}
      edgework={seen}
      onAskNote={noop}
      onClose={noop}
    />,
  );
}

function leaf(manual: ManualHere, current: number, spread = false): string {
  return renderToStaticMarkup(
    <Book manual={manual} puzzle={null} current={current} spread={spread} onAskNote={noop} />,
  );
}

describe('reading at a terminal', () => {
  it('shows one station per screen and starts at the one that is up', () => {
    const now = read(null, 2);
    expect(now).toContain('class="puzzle-modal reading-modal reading-terminal"');
    expect(now).toContain('<div class="panel-label">// SCHALTPLAN</div>');
    expect(now).toContain('<span>§3 — Leitungsnetz</span><span>BILDSCHIRM 2/2</span>');
    expect(now).toContain('<p>Wände zeigt der Plan.</p>');
    expect(now).not.toContain('Rot zuerst.');
    const first = read(null, 0);
    expect(first).toContain('<span>§1 — Kabel</span><span>BILDSCHIRM 1/2</span>');
    expect(first).toContain('<p>Rot zuerst.</p>');
    expect(first).toMatch(/<button class="turn-back" disabled="">◂ ZURÜCK<\/button>/);
  });

  it("puts the open maze's wall plan above the rules — walls and goal, no marker", () => {
    const html = read(maze(2, new Array<number>(16).fill(0)));
    expect(html.match(/<svg class="maze"/g)).toHaveLength(1);
    expect(html.indexOf('<svg class="maze"')).toBeLessThan(html.indexOf('Wände zeigt der Plan.'));
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

describe('reading a book', () => {
  it('opens at the bookmark: the first page of the station that is up', () => {
    const html = leaf(bound(), 2);
    expect(html).toContain('<h2 class="page-title">§3 — Leitungsnetz</h2>');
    expect(html).toContain('class="page-ribbon"');
    expect(html).toContain('Seite 3 von 3');
    expect(html).not.toContain('Rot zuerst.');
    expect(html).not.toContain('Inhalt');
  });

  it('opens at the contents where the station that is up lies elsewhere', () => {
    const html = leaf(bound(), 1);
    expect(html).toContain('<span class="contents-kicker">Inhalt</span>');
    expect(html).toContain(
      '<li class="contents-done"><button class="contents-entry"><span class="contents-name">' +
        '§1 — Kabel</span><span class="contents-dots" aria-hidden="true"></span>' +
        '<span class="contents-page">Seite 2</span>',
    );
    expect(html).toContain('§3 — Leitungsnetz</span>');
    expect(html).toContain('<span class="contents-page">Seite 3</span>');
    expect(html).not.toContain('page-ribbon');
  });

  it('shows two pages side by side where there is room, one where there is not', () => {
    const spread = leaf(bound(), 0, true);
    expect(spread).toContain('class="book book-spread"');
    expect(spread).toContain('Inhalt');
    expect(spread).toContain('<h2 class="page-title">§1 — Kabel</h2>');
    expect(spread).toContain('Seite 1–2 von 3');
    const single = leaf(bound(), 0);
    expect(single).not.toContain('Inhalt');
    expect(single).toContain('<h2 class="page-title">§1 — Kabel</h2>');
    expect(single).toMatch(/<button class="turn-next"[^>]*>›<\/button>/);
  });

  it('writes the revealed notes beside the open station, with the way to ask for the next', () => {
    const html = leaf(
      bound({ notes: ['Erst die Farben ansagen.'], notesLeft: 2, noteReadyAt: Date.now() - 1000 }),
      2,
    );
    expect(html).toContain('<aside class="margin" aria-label="Notizen der letzten Crew">');
    expect(html).toContain('<li class="margin-note">Erst die Farben ansagen.</li>');
    expect(html).toContain(
      '<button class="note-ask">Notiz der letzten Crew erbitten · −20 s</button>',
    );
  });

  it('counts down to the next note, and offers none once all are out', () => {
    const waiting = leaf(bound({ notesLeft: 1, noteReadyAt: Date.now() + 30_000 }), 2);
    expect(waiting).toMatch(/<button class="note-ask" disabled="">Notiz in (29|30) s<\/button>/);
    const done = leaf(bound({ notes: ['Eins.', 'Zwei.'], notesLeft: 0 }), 2);
    expect(done.match(/class="margin-note"/g)).toHaveLength(2);
    expect(done).not.toContain('note-ask');
  });

  it('keeps the margin clean beside a station that is not open', () => {
    expect(leaf(bound({ notes: ['Nur hier.'], notesLeft: 1 }), 0)).not.toContain('class="margin"');
  });
});

describe('reading a wall chart', () => {
  it('shows every station it covers at once, the notes beside the open one', () => {
    const chart = bound({ notes: ['Plan vom Ziel aus lesen.'], notesLeft: 0 }, 'chart');
    const html = read(null, 2, null, chart);
    expect(html).toContain('class="puzzle-modal reading-modal reading-chart"');
    expect(html).toContain('<h3 class="chart-heading">§1 — Kabel</h3>');
    expect(html).toContain('<h3 class="chart-heading">§3 — Leitungsnetz</h3>');
    expect(html).toContain('<p>Rot zuerst.</p>');
    expect(html.match(/class="margin-note"/g)).toHaveLength(1);
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
  const book: Manual = {
    id: 'b',
    kind: 'book',
    x: 1,
    y: 1,
    label: 'HANDBUCH',
    puzzleIds: ['k'],
    opened: true,
    needsKey: null,
  };
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

/** A run of Blackout that has just started, seen by the player in the Maschinenraum. */
function justStarted(parts: Partial<PlayerView> = {}): PlayerView {
  const now = Date.now();
  return {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: 'Stromausfall.',
    crewSize: { min: 2, max: 2 },
    you: {
      id: 'p2',
      name: 'Ben',
      color: '#f472b6',
      ready: true,
      isHost: false,
    },
    players: [
      {
        id: 'p2',
        name: 'Ben',
        color: '#f472b6',
        ready: true,
        connected: true,
        isHost: false,
      },
    ],
    palette: [],
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
    credits: {},
    edgework: null,
    presence: { stationId: null, manualId: null, signSeen: false },
    sourcesHere: [],
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
      roomCode="KX4P"
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
        '<p>Du startest im <strong>MASCHINENRAUM</strong></p>',
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

  it('offers the notepad in the HUD and keeps it closed until asked for', () => {
    const html = game(justStarted());
    expect(html).toContain(
      '<button class="hud-info hud-notes" aria-pressed="false">✎ Notizen [N]</button>',
    );
    expect(html).not.toContain('class="notepad"');
  });
});
