import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  MapView,
  MissionInfo,
  PlayerPosition,
  PlayerView,
  RoomSummary,
  SpectatorView,
} from '@escapelab/core';
import { RoomCode } from '../src/App.js';
import { crewSizeText, crewTags, presenceNear } from '../src/screens/Crew.js';
import { lineup, type Place } from '../src/screens/CrewRoom.js';
import { EndScreen } from '../src/screens/End.js';
import { JoinScreen } from '../src/screens/Join.js';
import { LobbyScreen, startBlocker } from '../src/screens/Lobby.js';
import { MissionHud } from '../src/screens/MissionHud.js';
import { audienceTags, SpectateScreen } from '../src/screens/Spectate.js';
import { iconsAsWords, mapWith, PICTOGRAPH } from './fixtures.js';

const noop = (): void => undefined;

type Seat = PlayerView['players'][number];

function seat(id: string, name: string, parts: Partial<Seat> = {}): Seat {
  return { id, name, color: '#2dd4bf', ready: false, connected: true, isHost: false, ...parts };
}

const anna = seat('p1', 'Anna', { isHost: true });
const ben = seat('p2', 'Ben', { color: '#f472b6' });
const carla = seat('p3', 'Carla', { color: '#fbbf24' });

/** Anna's view, as host, of a room for two to three. */
function annaSees(players: Seat[], parts: Partial<PlayerView> = {}): PlayerView {
  return {
    phase: 'lobby',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: 'Stromausfall.',
    crewSize: { min: 2, max: 3 },
    you: { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: false, isHost: true },
    players,
    palette: [],
    deadlineAt: null,
    startedAt: null,
    finishedAt: null,
    timeLimitSec: 480,
    currentPuzzleIndex: 0,
    puzzleCount: 5,
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
    map: null,
    ...parts,
  };
}

/** Ben's view, as a guest, of the same room. */
function benSees(players: Seat[], ready: boolean): PlayerView {
  return annaSees(players, {
    you: { id: 'p2', name: 'Ben', color: '#f472b6', ready, isHost: false },
  });
}

const blackout: MissionInfo = {
  id: 'blackout',
  title: 'Blackout im Labor',
  subtitle: 'Für zwei oder drei.',
  players: { min: 2, max: 3 },
  timeLimitSec: 480,
  puzzleCount: 5,
  tiles: [],
};
const tutorial: MissionInfo = {
  id: 'systemcheck',
  title: 'Tutorial: Systemcheck',
  subtitle: 'Zum Warmwerden.',
  players: { min: 2, max: 2 },
  timeLimitSec: 420,
  puzzleCount: 3,
  tiles: [],
};

const LOBBY_CSS = readFileSync(new URL('../src/styles/lobby.css', import.meta.url), 'utf8');

/** The block a stylesheet opens with `head`, braces and all; nested blocks included. */
function blockOf(sheet: string, head: string): string {
  const start = sheet.indexOf(head);
  if (start < 0) {
    throw new Error(`the stylesheet has no "${head}"`);
  }
  let depth = 0;
  for (let i = start + head.length - 1; i < sheet.length; i++) {
    depth += sheet.charAt(i) === '{' ? 1 : sheet.charAt(i) === '}' ? -1 : 0;
    if (depth === 0) {
      return sheet.slice(start, i + 1);
    }
  }
  throw new Error(`"${head}" is never closed`);
}

function lobby(view: PlayerView, missions: MissionInfo[] = []): string {
  return iconsAsWords(
    renderToStaticMarkup(
      <LobbyScreen view={view} send={noop} leaveRoom={noop} missions={missions} />,
    ),
  );
}

/** The places in the row, left to right. */
const seatsOf = (html: string): string[] => html.match(/<li class="seat[ "].*?<\/li>/g) ?? [];

describe('how many play', () => {
  it('reads as one count where the mission takes exactly that many, else as a range', () => {
    expect(crewSizeText({ min: 2, max: 2 })).toBe('2 Spieler');
    expect(crewSizeText({ min: 2, max: 3 })).toBe('2–3 Spieler');
  });
});

describe('starting from the lobby', () => {
  it('needs as many as the mission takes, and only who is connected counts', () => {
    expect(startBlocker(annaSees([anna]))).toBe('Noch 1 Person nötig');
    expect(startBlocker(annaSees([anna], { crewSize: { min: 3, max: 3 } }))).toBe(
      'Noch 2 Personen nötig',
    );
    const gone = { ...ben, ready: true, connected: false };
    expect(startBlocker(annaSees([anna, gone]))).toBe('Noch 1 Person nötig');
  });

  it('refuses a crew larger than the mission takes', () => {
    const crew = [anna, { ...ben, ready: true }, { ...carla, ready: true }];
    expect(startBlocker(annaSees(crew, { crewSize: { min: 2, max: 2 } }))).toBe(
      'Zu viele für diese Mission',
    );
  });

  it('waits for everyone but the host to confirm', () => {
    expect(startBlocker(annaSees([anna, ben]))).toBe('Warten auf Ben …');
    expect(startBlocker(annaSees([anna, { ...ben, ready: true }]))).toBeNull();
  });
});

describe('the row in the crew room', () => {
  /** A place as words: who stands there and which way they look. */
  const word = (place: Place): string => {
    if (place.kind === 'free') {
      return place.needed ? 'frei (nötig)' : 'frei';
    }
    const name = place.member.name;
    return { right: `${name} →`, left: `← ${name}`, front: name }[place.facing];
  };

  it('puts you in the middle, the others turned toward you', () => {
    expect(lineup(annaSees([anna, ben, carla])).map(word)).toEqual(['Ben →', 'Anna', '← Carla']);
    expect(lineup(benSees([anna, ben, carla], false)).map(word)).toEqual([
      'Anna →',
      'Ben',
      '← Carla',
    ]);
  });

  it('fills the places the mission has left, marking those it cannot start without', () => {
    const alone = lineup(annaSees([anna], { crewSize: { min: 2, max: 2 } }));
    expect(alone.map(word)).toEqual(['Anna', 'frei (nötig)']);
    const four = lineup(annaSees([anna, ben], { crewSize: { min: 4, max: 4 } }));
    expect(four.map(word)).toEqual(['Ben →', 'Anna', 'frei (nötig)', 'frei (nötig)']);
    // Only the first free place asks for the code to be shared.
    expect(four.filter((place) => place.kind === 'free' && place.first)).toHaveLength(1);
  });

  it('keeps who is gone in the row, and counts them as missing', () => {
    const gone = { ...ben, connected: false };
    expect(lineup(annaSees([anna, gone])).map(word)).toEqual(['Ben →', 'Anna', 'frei (nötig)']);
  });
});

describe('the lobby', () => {
  it('stands every player in the room with a name tag over a badge over the figure', () => {
    const seats = seatsOf(lobby(annaSees([anna, { ...ben, ready: true }, carla])));
    expect(seats).toHaveLength(3);
    expect(seats[0]).toBe(
      '<li class="seat"><span class="seat-name">Ben</span>' +
        '<span class="seat-badge seat-badge-ready">[check] bereit</span>' +
        '<canvas class="seat-figure" aria-hidden="true"></canvas></li>',
    );
    expect(seats[1]).toContain('<li class="seat seat-you"><span class="seat-name">Anna</span>');
    expect(seats[1]).toContain(
      '<span class="seat-badge seat-badge-host">[star] Host</span><canvas',
    );
    expect(seats[2]).toContain('<span class="seat-badge seat-badge-wait">noch nicht bereit</span>');
    expect(lobby(annaSees([anna]))).toContain('Startplätze werden beim Start verlost.');
  });

  it('draws a free place as a dashed outline, the first asking for the code to be shared', () => {
    const seats = seatsOf(lobby(annaSees([anna])));
    expect(seats.map((s) => s.match(/^<li class="([^"]*)"/)?.[1])).toEqual([
      'seat seat-open',
      'seat seat-you',
      'seat seat-open',
    ]);
    expect(seats[0]).toContain('<span class="seat-name">frei — Code oben teilen</span>');
    expect(seats[0]).toContain('<span class="seat-badge seat-badge-need">nötig</span>');
    expect(seats[0]).toContain('<svg class="seat-figure seat-outline"');
    expect(seats[2]).toContain('<span class="seat-name">frei</span><svg');
  });

  it('dims who is gone under „getrennt", host or not', () => {
    const view = annaSees([anna, { ...ben, ready: true }, { ...carla, connected: false }]);
    const seats = seatsOf(lobby(view));
    expect(seats[2]).toContain('<li class="seat seat-gone"><span class="seat-name">Carla</span>');
    expect(seats[2]).toContain('seat-badge-gone">getrennt<');
    const goneHost = seatsOf(lobby(benSees([{ ...anna, connected: false }, ben], false)));
    expect(goneHost[0]).toContain('seat-badge-gone">getrennt<');
    expect(goneHost[0]).not.toContain('Host');
  });

  it('lays the colours out as keys: yours ticked, others locked under their initial', () => {
    const palette = [
      { color: '#2dd4bf', takenByName: 'Anna' },
      { color: '#f472b6', takenByName: 'Ben' },
      { color: '#fbbf24', takenByName: null },
    ];
    const html = lobby(annaSees([anna, ben], { palette }));
    const chips = html.match(/<button class="chip[ "].*?<\/button>/g) ?? [];
    expect(chips).toHaveLength(3);
    expect(chips[0]).toBe(
      '<button class="chip chip-mine" style="--chip:#2dd4bf" aria-pressed="true" ' +
        'aria-label="Türkis — deine Farbe" title="Türkis — deine Farbe">[check]</button>',
    );
    expect(chips[1]).toBe(
      '<button class="chip chip-taken" style="--chip:#f472b6" disabled="" aria-pressed="false" ' +
        'aria-label="Pink — trägt Ben" title="Pink — trägt Ben">B</button>',
    );
    expect(chips[2]).toBe(
      '<button class="chip" style="--chip:#fbbf24" aria-pressed="false" ' +
        'aria-label="Gelb" title="Gelb"></button>',
    );
  });

  it('keeps a taken colour in its full hue, struck through under the initial', () => {
    const taken = blockOf(LOBBY_CSS, '.chip-taken:disabled {');
    // The chip's own colour is the ground; over it only a slash, clear at both ends.
    expect(taken).toMatch(/background:[^;]*var\(--chip\);/);
    expect(taken).toContain('transparent 0 44%');
    expect(taken).toContain('transparent 56%');
    // No rule darkens every taken chip as a whole any more.
    expect(LOBBY_CSS).not.toContain('.chip:disabled');
  });

  it('keeps the start locked with the reason on it, and has no roles to pick', () => {
    const html = lobby(annaSees([anna]));
    expect(html).toContain(
      '<button class="primary lobby-start" disabled="">Noch 1 Person nötig</button>',
    );
    expect(html).not.toMatch(/Rolle/);
    const waiting = lobby(annaSees([anna, ben, { ...carla, ready: true }]));
    expect(waiting).toContain('disabled="">Warten auf Ben …</button>');
    const ready = lobby(annaSees([anna, { ...ben, ready: true }]));
    expect(ready).toContain('<button class="primary lobby-start">[play] Mission starten</button>');
  });

  it('lets a guest say ready and tells them what the start still waits for', () => {
    const unready = lobby(benSees([anna, ben, carla], false));
    expect(unready).toContain('<button class="primary lobby-start">Ich bin bereit</button>');
    expect(unready).toContain('Lies die Mission — dann melde dich bereit.');
    expect(unready).not.toContain('Mission starten');
    const waiting = lobby(benSees([anna, { ...ben, ready: true }, carla], true));
    expect(waiting).toContain('<button class="lobby-start">[check] Bereit — doch nicht?</button>');
    expect(waiting).toContain('Warten auf Carla …');
    expect(lobby(benSees([anna, { ...ben, ready: true }], true))).toContain(
      'Alle bereit — der Host startet.',
    );
  });

  it('gives the host the mission switch and the difficulty to pick, the others only to see', () => {
    const host = lobby(annaSees([anna, ben]), [blackout, tutorial]);
    expect(host).toContain('Mission wechseln<select');
    expect(host.match(/<button class="level-chip[ "]/g)).toHaveLength(3);
    expect(host).toContain('aria-pressed="true">Normal</button>');
    const guest = lobby(benSees([anna, ben], false), [blackout, tutorial]);
    expect(guest).not.toContain('<select');
    expect(guest).toContain('Schwierigkeit (wählt der Host)');
    expect(guest).toContain('<div class="level-chips level-chips-shown">');
    expect(guest.match(/<span class="level-chip[ "]/g)).toHaveLength(3);
    expect(guest).toContain('<span class="level-chip level-chip-on"');
  });

  it('names the mission with its map and one line of facts', () => {
    const withMap = { ...blackout, tiles: ['###', '#.#', '###'] };
    const html = lobby(annaSees([anna]), [withMap, tutorial]);
    expect(html).toContain(
      '<h1>Blackout im Labor</h1><div class="lobby-map"><svg class="map-thumb"',
    );
    expect(html).toContain(
      '<p class="lobby-facts"><span>[clock] 8 min</span><span>[crew] 2–3 Spieler</span>' +
        '<span>[station] 5 Stationen</span></p>',
    );
  });

  it('cuts a long story to two lines with „mehr", and leaves a short one whole', () => {
    const story =
      '23:47 Uhr: ein Knall, dann Dunkelheit — nur die Notbeleuchtung glimmt rot. ' +
      'Ihr seid quer durchs Labor verstreut.';
    const long = lobby(annaSees([anna], { storyText: story }));
    expect(long).toContain('<p class="story story-short">23:47 Uhr');
    expect(long).toContain('<button class="link lobby-more" aria-expanded="false">mehr</button>');
    const short = lobby(annaSees([anna]));
    expect(short).toContain('<p class="story">Stromausfall.</p>');
    // Only a phone needs „mehr" under a story that fits: there it opens the map too.
    expect(short).toContain(
      '<button class="link lobby-more lobby-more-phone" aria-expanded="false">mehr</button>',
    );
    expect(short).toContain('<aside class="lobby-panel" aria-label="Mission">');
  });

  it('keeps the crew in view on a phone: the start at the foot, the map behind „mehr"', () => {
    const stacked = blockOf(LOBBY_CSS, '@media (max-width: 860px) {');
    const bar = blockOf(stacked, '.lobby-go {');
    expect(bar).toContain('position: sticky;');
    expect(bar).toContain('bottom: 0;');
    const phone = blockOf(LOBBY_CSS, '@media (max-width: 480px) {');
    const hidden = blockOf(
      phone,
      '.lobby-panel:not(.lobby-panel-more) .lobby-map,\n' +
        '  .lobby-panel:not(.lobby-panel-more) .lobby-story .story {',
    );
    expect(hidden).toContain('display: none;');
    expect(blockOf(phone, '.lobby-more-phone {')).toContain('display: inline-block;');
  });

  it('leaves the room code to the header, where the free place points, and has the way out', () => {
    const html = lobby(annaSees([anna]));
    expect(html).toContain('frei — Code oben teilen');
    expect(html).not.toMatch(/lobby-code|lobby-invite|room-code|Link kopieren/);
    expect(html).toContain('<div class="lobby-foot"><button class="link">Raum verlassen</button>');
  });

  it('draws its icons, never the platform’s emoji', () => {
    const palette = [
      { color: '#2dd4bf', takenByName: 'Anna' },
      { color: '#f472b6', takenByName: 'Ben' },
    ];
    const views = [
      annaSees([anna, { ...ben, ready: true }], { palette }),
      benSees([anna, { ...ben, ready: true }, carla], true),
    ];
    for (const view of views) {
      const html = renderToStaticMarkup(
        <LobbyScreen view={view} send={noop} leaveRoom={noop} missions={[blackout, tutorial]} />,
      );
      expect(html).toContain('class="icon icon-');
      expect(html).not.toMatch(PICTOGRAPH);
    }
  });
});

describe('the room code in the header', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stands once, to read out, with the link to copy', () => {
    vi.stubGlobal('window', { location: { origin: 'http://lab', pathname: '/' } });
    const html = iconsAsWords(renderToStaticMarkup(<RoomCode code="QXT4" />));
    expect(html).toBe(
      '<button class="room-code" title="Einladungslink kopieren: http://lab/?room=QXT4">' +
        '<span class="room-code-prefix">Raum: </span><strong>QXT4</strong>' +
        '<span class="room-code-action"> [copy] Link</span></button>',
    );
  });
});

describe('the join screen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The join screen's markup as drawn: its icons by name, or as they are with `raw`. */
  function joinScreen(missions: MissionInfo[], rooms: RoomSummary[] = [], raw = false): string {
    vi.stubGlobal('window', { location: { search: '' } });
    const html = renderToStaticMarkup(
      <JoinScreen
        send={noop}
        connected
        missions={missions}
        rooms={rooms}
        stats={[]}
        openHandbook={noop}
        openHistory={noop}
      />,
    );
    return raw ? html : iconsAsWords(html);
  }

  /** A room of two for three, waiting in its lobby, or with `phase` already running. */
  const room = (phase: RoomSummary['phase'] = 'lobby', code = 'QXT4'): RoomSummary => ({
    code,
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    phase,
    players: [
      { name: 'Anna', color: '#2dd4bf', connected: true },
      { name: 'Ben', color: '#f472b6', connected: true },
    ],
    capacity: 3,
    free: 1,
  });

  /** The mission cards, in order. */
  const cards = (html: string): string[] =>
    html.match(/<button class="mission[ "].*?<\/button>/g) ?? [];

  it('lays the missions out as a grid of cards, each with one line of facts', () => {
    const html = joinScreen([blackout, tutorial]);
    expect(html).toContain('<div class="mission-grid">');
    const both = cards(html);
    expect(both.map((card) => card.match(/class="mission-meta"/g)?.length)).toEqual([1, 1]);
    expect(both[1]).toContain('<span class="mission-meta">2 Spieler · 7 min · 3 Stationen</span>');
  });

  it('counts Stationen, as the lobby and the run do — never Rätsel', () => {
    expect(joinScreen([blackout, tutorial], [room()])).not.toContain('Rätsel');
  });

  it('spells out the subtitle on the picked card only, the others carry it as a tooltip', () => {
    // Nobody has picked yet, so the first mission is.
    const [picked, other] = cards(joinScreen([blackout, tutorial]));
    expect(picked).toContain('aria-pressed="true"');
    expect(picked).toContain('<span class="mission-sub">Für zwei oder drei.</span>');
    expect(other).toContain('aria-pressed="false"');
    expect(other).toContain('title="Zum Warmwerden."');
    expect(other).not.toContain('mission-sub');
  });

  it('says how many play each mission and how full each room is', () => {
    const html = joinScreen([blackout], [room()]);
    expect(html).toContain('2–3 Spieler · 8 min · 5 Stationen');
    expect(html).toContain('<span class="room-meta">[crew] 2/3 · normal · Code QXT4</span>');
    expect(html).not.toMatch(/Rolle/);
    const running = joinScreen([blackout], [room('playing')]);
    expect(running).toContain('[crew] 2/3 · [play] läuft gerade · normal · Code QXT4');
    expect(running).toContain('[eye] Zuschauen</button>');
  });

  it('draws its icons, never the platform’s emoji', () => {
    const html = joinScreen([blackout, tutorial], [room(), room('playing', 'ZK9P')], true);
    expect(html).toContain('class="icon icon-');
    expect(html).not.toMatch(PICTOGRAPH);
  });
});

/** A lab with an armed station, a done one, a held plate, an open book and a closed locker. */
const lab: MapView = mapWith({
  stations: [
    { puzzleId: 'kabel', x: 2, y: 2, title: 'Notstrom', status: 'done' },
    { puzzleId: 'code', x: 8, y: 2, title: 'Zugangscode', status: 'armed' },
  ],
  plates: [
    { id: 'tuer', x: 5, y: 8, label: 'HALTEN', pressed: true, freezesDrone: false },
    { id: 'kamera', x: 9, y: 8, label: 'KAMERA', pressed: false, freezesDrone: true },
  ],
  manuals: [
    {
      id: 'buch',
      kind: 'book',
      x: 14,
      y: 2,
      label: 'HANDBUCH',
      puzzleIds: ['code'],
      opened: true,
      needsKey: null,
    },
    {
      id: 'spind',
      kind: 'locker',
      x: 14,
      y: 8,
      label: 'SPIND',
      puzzleIds: ['kabel'],
      opened: false,
      needsKey: null,
    },
  ],
  items: [
    {
      id: 'sicherung',
      label: 'Ersatzsicherung',
      x: 1,
      y: 1,
      carriedBy: 'p2',
      delivered: false,
      deliverTo: { x: 3, y: 3 },
      requiredForTitle: null,
    },
  ],
});

/** Standing on tile (x, y). */
const on = (x: number, y: number): PlayerPosition => ({
  x: x + 0.5,
  y: y + 0.5,
  facing: 0,
  moving: false,
});

const nowhere = { stationId: null, manualId: null };

/** The Signalkette, armed at both its consoles: a at (8,5), b at (13,5). */
const kette: MapView = mapWith({
  stations: [
    { puzzleId: 'kette', x: 8, y: 5, title: 'Signalkette', status: 'armed', console: 'a' },
    { puzzleId: 'kette', x: 13, y: 5, title: 'Signalkette', status: 'armed', console: 'b' },
  ],
});

describe('presence tags', () => {
  const texts = (tags: { text: string }[]): string[] => tags.map((tag) => tag.text);

  it('put a player at the armed station at the Pult, not one at a station already done', () => {
    expect(texts(crewTags(lab, ben, { stationId: 'code', manualId: null }, on(8, 3)))).toEqual([
      'am Pult',
      'trägt Ersatzsicherung',
    ]);
    expect(texts(crewTags(lab, carla, { stationId: 'kabel', manualId: null }, on(2, 3)))).toEqual(
      [],
    );
  });

  it('say who reads, who holds a plate down and who carries what', () => {
    expect(texts(crewTags(lab, carla, { stationId: null, manualId: 'buch' }, on(14, 3)))).toEqual([
      'liest',
    ]);
    expect(texts(crewTags(lab, carla, nowhere, on(5, 8)))).toEqual(['hält Platte']);
    expect(texts(crewTags(lab, carla, nowhere, on(9, 8)))).toEqual([]);
  });

  it('name the console at a station with two where the presence tells it, and only there', () => {
    const atB = { stationId: 'kette', console: 'b', manualId: null } as const;
    expect(texts(crewTags(kette, carla, atB, on(13, 6)))).toEqual(['am Pult B']);
    // Guessed from where someone stands, it names no console.
    const guessed = presenceNear(kette, on(13, 6));
    expect(guessed).toEqual({ stationId: 'kette', manualId: null });
    expect(texts(crewTags(kette, carla, guessed, on(13, 6)))).toEqual(['am Pult']);
    // A station with one console is console a to the view, and stays „am Pult".
    const atCode = { stationId: 'code', console: 'a', manualId: null } as const;
    expect(texts(crewTags(lab, carla, atCode, on(8, 3)))).toEqual(['am Pult']);
  });

  it('say nothing but that a disconnected player is gone', () => {
    const gone = { ...ben, connected: false };
    expect(crewTags(lab, gone, { stationId: 'code', manualId: null }, on(8, 3))).toEqual([
      { text: 'getrennt', tone: 'away' },
    ]);
  });

  it('read where others stand from their position: the armed station, an open source', () => {
    expect(presenceNear(lab, on(8, 3))).toEqual({ stationId: 'code', manualId: null });
    expect(presenceNear(lab, on(2, 3))).toEqual(nowhere);
    expect(presenceNear(lab, on(14, 3))).toEqual({ stationId: null, manualId: 'buch' });
    expect(presenceNear(lab, on(14, 7))).toEqual(nowhere);
    expect(presenceNear(lab, undefined)).toEqual(nowhere);
  });
});

describe('the crew strip', () => {
  it("tags each player: you by the server's word, the others by where they stand", () => {
    const dora = seat('p4', 'Dora', { color: '#60a5fa' });
    const view = annaSees([anna, ben, { ...carla, connected: false }, dora], {
      phase: 'playing',
      presence: { stationId: null, console: null, manualId: 'buch', signSeen: false },
      map: lab,
    });
    const html = renderToStaticMarkup(
      <MissionHud
        view={view}
        positionsRef={{
          current: { run: null, players: { p1: on(20, 20), p2: on(5, 8), p4: on(11, 11) } },
        }}
        chatsRef={{ current: [] }}
        onAir={false}
        onOpenInfo={noop}
        notesOpen={false}
        onToggleNotes={() => undefined}
      />,
    );
    const entries = html.match(/<li.*?<\/li>/g) ?? [];
    expect(entries).toHaveLength(4);
    expect(entries[0]).toContain('presence-read">liest<');
    expect(entries[1]).toContain('presence-hold">hält Platte<');
    expect(entries[1]).toContain('presence-carry">trägt Ersatzsicherung<');
    expect(entries[2]).toContain('presence-away">getrennt<');
    expect(entries[3]).toContain('<span class="hud-idle">unterwegs</span>');
  });

  it('names your own console at a station with two, the others’ only „am Pult"', () => {
    const view = annaSees([anna, ben], {
      phase: 'playing',
      presence: { stationId: 'kette', console: 'b', manualId: null, signSeen: false },
      map: kette,
    });
    const html = renderToStaticMarkup(
      <MissionHud
        view={view}
        positionsRef={{ current: { run: null, players: { p1: on(13, 6), p2: on(8, 6) } } }}
        chatsRef={{ current: [] }}
        onAir={false}
        onOpenInfo={noop}
        notesOpen={false}
        onToggleNotes={noop}
      />,
    );
    const entries = html.match(/<li.*?<\/li>/g) ?? [];
    expect(entries[0]).toContain('presence-pult">am Pult B<');
    expect(entries[1]).toContain('presence-pult">am Pult<');
  });
});

describe('the end screen', () => {
  it('credits every player under the grade, before the run report', () => {
    const view = annaSees([anna, ben], {
      phase: 'won',
      startedAt: 1_000,
      finishedAt: 301_000,
      deadlineAt: 481_000,
      grade: { rank: 'A', label: 'Starke Leistung' },
      events: [{ at: 61_000, kind: 'puzzle', label: 'Notstrom läuft', seconds: null }],
      credits: {
        p1: { operated: 3, read: 1, found: 0, delivered: 1, alarms: 0, hints: 0 },
        p2: { operated: 2, read: 4, found: 1, delivered: 0, alarms: 2, hints: 1 },
      },
    });
    const html = renderToStaticMarkup(<EndScreen view={view} send={noop} leaveRoom={noop} />);
    const grade = html.indexOf('class="grade grade-a"');
    const table = html.indexOf('<table>');
    expect(grade).toBeGreaterThan(-1);
    expect(table).toBeGreaterThan(grade);
    expect(html.indexOf('Einsatzprotokoll')).toBeGreaterThan(table);
    expect(html).toContain(
      '<th scope="col">Crew</th><th scope="col">bedient</th><th scope="col">gelesen</th>' +
        '<th scope="col">gefunden</th><th scope="col">geliefert</th><th scope="col">Alarme</th>' +
        '<th scope="col">Notizen</th>',
    );
    const rows = html.match(/<tr( class="[^"]*")?><th scope="row">.*?<\/tr>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^<tr class="credits-you">.*Anna/);
    expect(rows[1]).toContain('<td class="credits-alarm">2</td>');
    expect(rows[1]).toContain('<td>4</td>');
    expect(rows[0]).toContain('<td class="credits-none">0</td>');
    expect(html).not.toMatch(/Rolle/);
  });

  it('ends the report of a run lost to alarms with the reason', () => {
    const reason = 'Zu viele Alarme — Notversorgung abgeschaltet.';
    const view = annaSees([anna, ben], {
      phase: 'lost',
      startedAt: 1_000,
      finishedAt: 181_000,
      deadlineAt: 400_000,
      penaltySeq: 3,
      alarms: { count: 3, limit: 3 },
      events: [
        { at: 61_000, kind: 'penalty', label: 'Von einer Drohne erfasst', seconds: 21 },
        { at: 121_000, kind: 'penalty', label: 'Falsche Taste', seconds: 7 },
        { at: 181_000, kind: 'penalty', label: 'Notfall nicht rechtzeitig behoben', seconds: 84 },
        { at: 181_000, kind: 'finish', label: reason, seconds: null },
      ],
    });
    const html = renderToStaticMarkup(<EndScreen view={view} send={noop} leaveRoom={noop} />);
    expect(html).toContain('✖ GESCHEITERT');
    const lines = html.match(/<li class="report-[a-z]+">.*?<\/li>/g) ?? [];
    expect(lines).toHaveLength(4);
    expect(lines.at(-1)).toBe(
      '<li class="report-finish"><span class="report-time">3:00</span>' +
        `<span class="report-icon">🏁</span><span class="report-text">${reason}</span></li>`,
    );
  });
});

describe('the audience', () => {
  type Watched = SpectatorView['players'][number];
  const watch = (p: Seat, signSeen: boolean): Watched => ({
    id: p.id,
    name: p.name,
    color: p.color,
    connected: true,
    presence: { stationId: null, console: null, manualId: null, signSeen },
  });
  /** Anna has read the sign, Ben has not. */
  const watchedAnna = watch(anna, true);
  const watchedBen = watch(ben, false);

  /** What a spectator gets once Anna and Ben are out. */
  function finished(): SpectatorView {
    return {
      phase: 'won',
      missionTitle: 'Blackout im Labor',
      difficulty: 'normal',
      storyText: 'Licht.',
      deadlineAt: 481_000,
      startedAt: 1_000,
      finishedAt: 301_000,
      timeLimitSec: 480,
      currentPuzzleIndex: 5,
      puzzleCount: 5,
      penaltySeq: 2,
      alarms: { count: 2, limit: 5 },
      hintsUsed: 1,
      pausedFor: null,
      events: [],
      grade: { rank: 'B', label: 'Solide' },
      players: [watchedAnna, watchedBen],
      credits: {
        p1: { operated: 3, read: 1, found: 0, delivered: 1, alarms: 0, hints: 0 },
        p2: { operated: 2, read: 4, found: 1, delivered: 0, alarms: 2, hints: 1 },
      },
      map: null,
      puzzle: null,
      edgework: null,
      panels: [],
    };
  }

  it('tags who has read the sign besides where they stand', () => {
    const view: SpectatorView = { ...finished(), phase: 'playing', map: lab };
    expect(audienceTags(view, watchedAnna, on(5, 8))).toEqual([
      { text: 'hält Platte', tone: 'hold' },
      { text: 'Kennung', tone: 'sign' },
    ]);
    expect(audienceTags(view, watchedBen, undefined)).toEqual([
      { text: 'trägt Ersatzsicherung', tone: 'carry' },
    ]);
  });

  it('sees the credits in place of the station once the run is over', () => {
    const html = renderToStaticMarkup(
      <SpectateScreen
        view={finished()}
        positionsRef={{ current: { run: null, players: {} } }}
        dronesRef={{ current: {} }}
        pingsRef={{ current: [] }}
        chatsRef={{ current: [] }}
        leaveRoom={noop}
      />,
    );
    expect(html).toContain('// Beiträge');
    expect(html.match(/<th scope="row">/g)).toHaveLength(2);
    expect(html).not.toContain('gerade keine Station offen');
  });
});
