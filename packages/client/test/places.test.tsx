import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Edgework, ManualHere, PlayerView, PuzzleView } from '@escapelab/core';
import { Book } from '../src/screens/Book.js';
import {
  AlarmMarks,
  backupNote,
  GameScreen,
  StationModal,
  stationLabel,
} from '../src/screens/Game.js';
import { InfoPanel, Legend } from '../src/screens/InfoPanel.js';
import { ReadingOverlay } from '../src/screens/Reading.js';
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

  it('prints the manual’s line at the foot of every page, the contents too', () => {
    const foot =
      '<footer class="page-foot" aria-hidden="true">ESCAPELAB · HANDBUCH · REV. 3</footer>';
    const contents = leaf(bound(), 1);
    expect(contents).toContain('<span class="contents-kicker">Inhalt</span>');
    expect(contents).toContain(`<span class="page-folio">1</span>${foot}`);
    const spread = leaf(bound(), 0, true);
    expect(spread.split(foot)).toHaveLength(3);
    // The blank leaf after the last page is no page of the book.
    const last = leaf(bound(), 2, true);
    expect(last).toContain('page-blank');
    expect(last.split(foot)).toHaveLength(2);
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
