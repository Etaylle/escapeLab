import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Edgework, ManualHere, PlayerView, PuzzleView } from '@escapelab/core';
import { leafFor, type Leaf } from '../src/pages.js';
import { Book, TurningLeaf, type Binding, type Imprint } from '../src/screens/Book.js';
import {
  AlarmMarks,
  backupNote,
  GameScreen,
  StationModal,
  stationLabel,
} from '../src/screens/Game.js';
import { InfoPanel, Legend } from '../src/screens/InfoPanel.js';
import { ReadingOverlay, roomOf } from '../src/screens/Reading.js';
import { titleSize } from '../src/screens/Seal.js';
import { WorldModal } from '../src/screens/WorldModal.js';
import { mapWith, type Item, type Manual, type Plate } from './fixtures.js';

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
    console: null,
    backup: null,
  };
}

/** A source of each kind where the tests put them: two rooms, a door between, one named. */
function source(id: string, kind: Manual['kind'], x: number, y: number): Manual {
  return { id, kind, x, y, label: id, puzzleIds: ['kabel', 'netz'], opened: true, needsKey: null };
}

const lab = mapWith({
  tiles: ['#######', '#..#..#', '#.....#', '#######'],
  doors: [{ id: 'tuer', x: 3, y: 2, open: false }],
  labels: [{ text: 'ARCHIV', x: 1, y: 1 }],
  manuals: [source('buch', 'book', 2, 2), source('plan', 'terminal', 5, 1)],
});

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
      mission="Blackout im Labor"
      map={lab}
      edgework={seen}
      onAskNote={noop}
      onClose={noop}
    />,
  );
}

const imprint: Imprint = { mission: 'Blackout im Labor', room: 'ARCHIV' };

/** The book as it opens, at whichever page it opens at. */
function opened(
  manual: ManualHere,
  current: number,
  spread = false,
  binding: Binding = 'bound',
): string {
  return renderToStaticMarkup(
    <Book
      manual={manual}
      puzzle={null}
      current={current}
      spread={spread}
      binding={binding}
      imprint={imprint}
      onAskNote={noop}
    />,
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
    const html = opened(bound(), 2);
    expect(html).toContain(
      '<h2 class="page-title"><span class="page-badge">§3</span> Leitungsnetz</h2>',
    );
    expect(html).toContain('class="page-ribbon"');
    expect(html).toContain('Seite 3 von 3');
    expect(html).not.toContain('Rot zuerst.');
    expect(html).not.toContain('page-cover');
  });

  it('opens on the cover where the station that is up lies elsewhere, its contents on it', () => {
    const html = opened(bound(), 1);
    expect(html).toContain(
      '<article class="page page-single page-cover" aria-label="Seite 1"><div class="page-in">' +
        '<div class="page-text"><div class="cover cover-contents">' +
        '<h2 class="cover-title">HANDBUCH</h2><svg class="seal"',
    );
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

  it('prints the source, the seal round the mission, the revision and the room on it', () => {
    const html = opened(bound(), 1);
    expect(html).toContain('role="img" aria-label="Laborsiegel: Blackout im Labor"');
    expect(html).toMatch(/<textPath href="#[^"]+-top" startOffset="50%">LABOR<\/textPath>/);
    expect(html).toMatch(/<textPath [^>]*>BLACKOUT IM LABOR<\/textPath>/);
    expect(html).toContain(
      '<p class="cover-imprint"><span>Rev. 3</span><span>Liegt aus: ARCHIV</span></p>',
    );
    // A cover has no page number, no foot line, no running head.
    expect(html).not.toContain('page-folio');
    expect(html).not.toContain('page-foot');
    expect(html).not.toContain('page-head');
    const nowhere = renderToStaticMarkup(
      <Book
        manual={bound()}
        puzzle={null}
        current={1}
        spread={false}
        binding="bound"
        imprint={{ mission: 'Blackout im Labor', room: null }}
        onAskNote={noop}
      />,
    );
    expect(nowhere).toContain('<p class="cover-imprint"><span>Rev. 3</span></p>');
  });

  it('sets a long label smaller on the cover, and a long mission smaller round the seal', () => {
    expect(opened({ ...bound(), label: 'AKTENSCHRANK' }, 1)).toContain(
      '<h2 class="cover-title cover-title-long">AKTENSCHRANK</h2>',
    );
    expect(opened(bound(), 1)).toContain('<h2 class="cover-title">HANDBUCH</h2>');
    expect(titleSize('BLACKOUT IM LABOR')).toBe(8.5);
    const long = 'TUTORIAL: SYSTEMCHECK UND NOCH VIEL MEHR';
    expect(titleSize(long)).toBeLessThan(8.5);
    // 136 degrees of the circle of radius 51.5 hold it, at 0.78 em a capital.
    expect(long.length * 0.78 * titleSize(long)).toBeLessThanOrEqual(122.3);
  });

  it('gives a book of one station a cover without contents, and opens it on the station', () => {
    const single: ManualHere = { ...bound(), sections: bound().sections.slice(0, 1) };
    // The station is done: no bookmark here, and still the book opens on its rules.
    const html = opened(single, 3);
    expect(html).toContain(
      '<h2 class="page-title"><span class="page-badge">§1</span> Kabel</h2>',
    );
    expect(html).toContain('Seite 2 von 2');
    expect(html).not.toContain('page-cover');
    const spread = opened(single, 3, true);
    expect(spread).toContain('<div class="cover"><h2 class="cover-title">HANDBUCH</h2>');
    expect(spread).not.toContain('class="contents"');
    expect(spread).toContain('<span class="page-badge">§1</span>');
  });

  it('shows two pages side by side where there is room, one where there is not', () => {
    const spread = opened(bound(), 0, true);
    expect(spread).toContain('class="book book-spread"');
    expect(spread).toContain('class="page page-left page-cover"');
    expect(spread).toContain('<span class="page-badge">§1</span> Kabel</h2>');
    expect(spread).toContain('Seite 1–2 von 3');
    const single = opened(bound(), 0);
    expect(single).toContain('class="book book-single"');
    expect(single).not.toContain('page-cover');
    expect(single).toContain('<span class="page-badge">§1</span> Kabel</h2>');
    expect(single).toMatch(/<button class="turn-next"[^>]*>›<\/button>/);
  });

  it('puts a thumb tab per station on the fore-edge, coloured by how far the run is', () => {
    const html = opened(bound(), 2);
    expect(html).toContain(
      '<nav class="book-tabs" aria-label="Register">' +
        '<button class="book-tab book-tab-done" aria-label="§1 — Kabel, Seite 2" ' +
        'title="§1 — Kabel · Seite 2">§1</button>' +
        '<button class="book-tab book-tab-now book-tab-open" ' +
        'aria-label="§3 — Leitungsnetz, Seite 3" aria-current="step" ' +
        'title="§3 — Leitungsnetz · Seite 3">§3</button></nav>',
    );
    // Before the run reaches them both lie ahead; on the cover neither is pulled out.
    const early = opened(bound(), 0, true);
    expect(early).toContain('class="book-tab book-tab-now book-tab-open"');
    expect(early).toContain('class="book-tab book-tab-ahead"');
    const cover = opened(bound(), 1);
    expect(cover.match(/class="book-tab [^"]*"/g)).toEqual([
      'class="book-tab book-tab-done"',
      'class="book-tab book-tab-ahead"',
    ]);
  });

  it('clips a clipboard to a board, a sheet at a time however wide the window', () => {
    const html = read(null, 2, null, bound({}, 'clipboard'));
    expect(html).toContain('class="puzzle-modal reading-modal reading-clipboard"');
    expect(html).toContain('<div class="book book-single book-clip">');
    expect(html).toContain('Seite 3 von 3');
    expect(read(null, 2, null, bound())).toContain('<div class="book book-single">');
  });

  it('writes the revealed notes beside the open station, with the way to ask for the next', () => {
    const html = opened(
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
    const waiting = opened(bound({ notesLeft: 1, noteReadyAt: Date.now() + 30_000 }), 2);
    expect(waiting).toMatch(/<button class="note-ask" disabled="">Notiz in (29|30) s<\/button>/);
    const done = opened(bound({ notes: ['Eins.', 'Zwei.'], notesLeft: 0 }), 2);
    expect(done.match(/class="margin-note"/g)).toHaveLength(2);
    expect(done).not.toContain('note-ask');
  });

  it('keeps the margin clean beside a station that is not open', () => {
    const elsewhere = opened(bound({ notes: ['Nur hier.'], notesLeft: 1 }), 0);
    expect(elsewhere).not.toContain('class="margin"');
  });

  it('prints the manual’s line at the foot of every page but the cover', () => {
    const foot =
      '<footer class="page-foot" aria-hidden="true">ESCAPELAB · HANDBUCH · REV. 3</footer>';
    expect(opened(bound(), 2)).toContain(`<span class="page-folio">3</span>${foot}`);
    // The cover beside the first station's page: one foot line, under the page.
    const spread = opened(bound(), 0, true);
    expect(spread.split(foot)).toHaveLength(2);
    expect(spread).toContain(`<span class="page-folio">2</span>${foot}`);
    // The blank leaf after the last page is no page of the book.
    const last = opened(bound(), 2, true);
    expect(last).toContain('page-blank');
    expect(last.split(foot)).toHaveLength(2);
  });
});

/** A leaf as drawn, each face naming the page and side it shows. */
function turned(leaf: Leaf, spread: boolean): string {
  return renderToStaticMarkup(
    <TurningLeaf leaf={leaf} spread={spread} face={(page, side) => <i>{`${page} ${side}`}</i>} />,
  );
}

describe('a leaf turning over', () => {
  it('turns the right page of a spread over to the left, its back the new left page', () => {
    const leaf = leafFor(2, 3, true);
    expect(leaf).not.toBeNull();
    expect(turned(leaf!, true)).toBe(
      '<div class="book-leaf book-leaf-next" style="--leaf-ms:450ms" aria-hidden="true" ' +
        'inert=""><div class="leaf-face leaf-front leaf-right"><i>2 right</i></div>' +
        '<div class="leaf-face leaf-back leaf-left"><i>3 left</i></div></div>',
    );
  });

  it('turns the left page back over to the right, its back the new right page', () => {
    const html = turned(leafFor(3, 1, true)!, true);
    expect(html).toContain('class="book-leaf book-leaf-back"');
    expect(html).toContain(
      '<div class="leaf-face leaf-front leaf-left"><i>3 left</i></div>' +
        '<div class="leaf-face leaf-back leaf-right"><i>2 right</i></div>',
    );
  });

  it('lifts a single page with one face, and lays the one before down the same way', () => {
    expect(turned(leafFor(2, 3, false)!, false)).toContain(
      '<div class="leaf-face leaf-front leaf-single"><i>2 single</i></div></div>',
    );
    const back = turned(leafFor(3, 2, false)!, false);
    expect(back).toContain('class="book-leaf book-leaf-back"');
    expect(back).toContain('<i>2 single</i>');
    expect(back.match(/class="leaf-face/g)).toHaveLength(1);
  });

  it('lays no copy of a page over the book while nothing turns', () => {
    expect(opened(bound(), 2)).not.toContain('book-leaf');
    expect(opened(bound(), 0, true)).not.toContain('book-leaf');
  });
});

describe('where a source lies', () => {
  it('names the room by the label on its floor, behind no door', () => {
    expect(roomOf(lab, 'buch')).toBe('ARCHIV');
  });

  it('names nothing where no label is in the room, or the source is not on the map', () => {
    expect(roomOf(lab, 'plan')).toBeNull();
    expect(roomOf(lab, 'nirgends')).toBeNull();
  });

  it('prints the room on the cover of a book read there, and none where there is none', () => {
    expect(read(null, 1, null, bound())).toContain('<span>Liegt aus: ARCHIV</span>');
    const elsewhere = { ...bound(), id: 'plan' };
    expect(read(null, 1, null, elsewhere)).toContain(
      '<p class="cover-imprint"><span>Rev. 3</span></p>',
    );
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

  it('names the console this player works where the station has two, and only there', () => {
    const atB: PuzzleView = {
      kind: 'signal',
      stage: 1,
      stages: 4,
      length: 4,
      done: 0,
      lastResult: null,
      role: 'receiver',
      sends: 'a',
      sequence: null,
      grid: null,
      grids: null,
      fleeting: false,
      keys: null,
      index: 1,
      total: 5,
      title: 'Signalkette',
      manual: null,
      console: 'b',
      backup: null,
    };
    const consoles = mapWith({
      stations: [
        { puzzleId: 'kette', x: 8, y: 5, title: 'Signalkette', status: 'armed', console: 'a' },
        { puzzleId: 'kette', x: 13, y: 5, title: 'Signalkette', status: 'armed', console: 'b' },
      ],
    });
    expect(stationLabel(atB, consoles)).toBe('§2 — Signalkette · Pult B');
    // The view names console a at a station with one as well; the label leaves it out.
    const single = mapWith({
      stations: [{ puzzleId: 'netz', x: 4, y: 1, title: 'Leitungsnetz', status: 'armed' }],
    });
    expect(stationLabel({ ...maze(2, null), console: 'a' }, single)).toBe('§3 — Leitungsnetz');
  });

  /** The frame the station opens in, as the game shows it, at a station with one console. */
  function stationFrame(puzzle: PuzzleView): string {
    const single = mapWith({
      stations: [{ puzzleId: 'netz', x: 4, y: 1, title: 'Leitungsnetz', status: 'armed' }],
    });
    return renderToStaticMarkup(
      <StationModal
        puzzle={puzzle}
        map={single}
        edgework={null}
        deadlineAt={null}
        send={noop}
        onClose={noop}
      />,
    );
  }

  it('says under the label who backs this player up, and where', () => {
    const atMaze: PuzzleView = { ...maze(2, null), console: 'a' };
    const backed = stationFrame({ ...atMaze, backup: { name: 'Ben', where: 'SPIND' } });
    expect(backed).toContain(
      '<div class="panel-label">// §3 — Leitungsnetz</div>' +
        '<p class="modal-note muted">Mit Ben bei: SPIND</p>',
    );
    // At a station with two consoles, the other console backs this one up.
    expect(backupNote({ ...atMaze, backup: { name: 'Ben', where: 'Pult B' } })).toEqual({
      text: 'Mit Ben an Pult B',
      tone: 'muted',
    });
    expect(backupNote({ ...atMaze, backup: { name: 'Anna', where: 'Pult A' } })?.text).toBe(
      'Mit Anna an Pult A',
    );
  });

  it('warns while nobody backs this player up', () => {
    const alone = stationFrame({ ...maze(2, null), console: 'a', backup: null });
    expect(alone).toContain(
      '<p class="modal-note warn">Allein — jemand muss zu den Regeln oder ans andere Pult</p>',
    );
  });

  it('says nothing about it where the whole crew presses, nor over a book', () => {
    const reactor: PuzzleView = {
      kind: 'button-sync',
      youPressed: false,
      pressedCount: 1,
      requiredCount: 2,
      attempts: 0,
      lastResult: null,
      index: 4,
      total: 5,
      title: 'Reaktor-Neustart',
      manual: null,
      console: 'a',
      backup: null,
    };
    expect(stationFrame(reactor)).toContain('// §5 — Reaktor-Neustart');
    expect(stationFrame(reactor)).not.toContain('modal-note');
    expect(read(null)).not.toContain('modal-note');
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
    alarms: { count: 0, limit: 5 },
    hintsUsed: 0,
    credits: {},
    edgework: null,
    presence: { stationId: null, console: null, manualId: null, signSeen: false },
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
      positionsRef={{ current: { run: null, players: {} } }}
      dronesRef={{ current: {} }}
      pingsRef={{ current: [] }}
      chatsRef={{ current: [] }}
      send={noop}
    />,
  );
}

describe('the start of a run', () => {
  it('briefs with the mission, the start room and the alarm limit only', () => {
    const html = game(justStarted());
    expect(html).toContain(
      '<div class="overlay briefing"><h1>Blackout im Labor</h1>' +
        '<p>Du startest im <strong>MASCHINENRAUM</strong></p>' +
        '<p class="briefing-alarms">Alarme: höchstens 5</p><div class="briefing-count">',
    );
    expect(html).not.toContain('Du bist');
  });

  it('opens no modal by itself, not even standing at the open station', () => {
    const html = game(
      justStarted({
        presence: { stationId: 'kabel', console: 'a', manualId: null, signSeen: false },
        puzzle: maze(0, null),
      }),
    );
    expect(html).not.toContain('puzzle-modal');
  });

  it('shows no edgework anywhere before the sign, and the chip in the HUD after it', () => {
    expect(game(justStarted())).not.toContain('edgework');
    const seen = game(
      justStarted({
        presence: { stationId: null, console: null, manualId: null, signSeen: true },
        edgework,
      }),
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

describe('what the crew still has to bring', () => {
  const fuse: Item = {
    id: 'fuse',
    label: 'SICHERUNG',
    x: 2.5,
    y: 2.5,
    carriedBy: null,
    delivered: false,
    deliverTo: { x: 4, y: 2 },
    requiredForTitle: 'Notstrom',
  };
  /** A cabinet's key: where it goes stays unknown until the cabinet is found. */
  const key: Item = { ...fuse, id: 'key', label: 'SCHLÜSSEL', deliverTo: null };

  function lying(items: Item[]): PlayerView {
    const view = justStarted();
    return { ...view, map: view.map === null ? null : { ...view.map, items } };
  }

  function info(view: PlayerView): string {
    return renderToStaticMarkup(<InfoPanel view={view} onClose={noop} />);
  }

  it('names no key before its cabinet is found, on the objective bar or in the info panel', () => {
    const view = lying([fuse, key]);
    expect(game(view)).toContain('<span class="stage-sub">SICHERUNG fehlt noch</span>');
    expect(info(view)).toContain('<dt>Noch zu bringen</dt><dd>SICHERUNG</dd>');
    expect(game(view) + info(view)).not.toContain('SCHLÜSSEL');
  });

  it('names the key once its cabinet has been found', () => {
    const view = lying([fuse, { ...key, deliverTo: { x: 5, y: 1 } }]);
    expect(game(view)).toContain('<span class="stage-sub">SICHERUNG, SCHLÜSSEL fehlt noch</span>');
    expect(info(view)).toContain('<dt>Noch zu bringen</dt><dd>SICHERUNG, SCHLÜSSEL</dd>');
  });

  it('tells a part a later station needs apart from what this one lacks', () => {
    const later = { ...fuse, requiredForTitle: 'Reaktor-Neustart' };
    expect(game(lying([later]))).toContain('<span class="stage-sub">SICHERUNG mitnehmen</span>');
    const both = lying([later, { ...key, deliverTo: { x: 5, y: 1 } }]);
    expect(game(both)).toContain(
      '<span class="stage-sub">SCHLÜSSEL fehlt noch · SICHERUNG mitnehmen</span>',
    );
  });

  it('says nothing is missing while only an unfound key is left', () => {
    const view = lying([{ ...fuse, delivered: true }, key]);
    expect(game(view)).not.toContain('stage-sub');
    expect(info(view)).not.toContain('Noch zu bringen');
  });
});

describe('the alarm limit', () => {
  const marks = (count: number, limit: number | null): string =>
    renderToStaticMarkup(<AlarmMarks alarms={{ count, limit }} />);
  const LIT = '<span class="alarm-mark alarm-mark-lit">✕</span>';
  const FREE = '<span class="alarm-mark">○</span>';
  const LAST_FREE = '<span class="alarm-mark alarm-mark-warn">○</span>';

  it('marks every alarm the limit allows, all free before the first', () => {
    expect(marks(0, 5)).toBe(
      '<div class="alarm-marks" role="img" aria-label="Alarme: 0 von höchstens 5">' +
        `${FREE.repeat(5)}</div>`,
    );
  });

  it('lights a mark for every alarm so far', () => {
    expect(marks(2, 5)).toContain(`>${LIT.repeat(2)}${FREE.repeat(3)}</div>`);
  });

  it('turns the last free mark the warning colour', () => {
    expect(marks(4, 5)).toContain(`>${LIT.repeat(4)}${LAST_FREE}</div>`);
    expect(marks(0, 1)).toContain(`>${LAST_FREE}</div>`);
  });

  it('has every mark lit at the limit', () => {
    expect(marks(5, 5)).toContain(`>${LIT.repeat(5)}</div>`);
  });

  it('shows nothing without a limit', () => {
    expect(marks(3, null)).toBe('');
  });

  it('sits under the clock in the objective bar', () => {
    const html = game(justStarted({ alarms: { count: 1, limit: 3 } }));
    expect(html).toMatch(
      new RegExp(
        '<div class="stage-clock"><div class="countdown [^"]*">\\d\\d:\\d\\d</div>' +
          `<div class="alarm-marks"[^>]*>${LIT}${FREE.repeat(2)}</div></div>`,
      ),
    );
  });

  it('names the limit in the info panel', () => {
    const html = renderToStaticMarkup(<InfoPanel view={justStarted()} onClose={noop} />);
    expect(html).toContain('<dt>Alarme</dt><dd>höchstens 5</dd>');
  });

  it('leaves out marks, briefing line and info line where there is no limit', () => {
    const view = justStarted({ alarms: { count: 2, limit: null } });
    const html = game(view) + renderToStaticMarkup(<InfoPanel view={view} onClose={noop} />);
    expect(html).toContain('<div class="stage-clock"><div class="countdown ');
    expect(html).not.toContain('alarm-mark');
    expect(html).not.toContain('Alarme');
  });
});
