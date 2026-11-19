import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_PINS,
  type ClientMessage,
  type DemoDoing,
  type DemoPin,
  type DemoShot,
  type PlayerView,
  type SpectatorView,
} from '@escapelab/core';
import { WORLD, offVoice } from '../../core/test/voice.js';
import {
  CUT_FADE_MS,
  DEMO_LABEL,
  DEMO_LINE,
  DemoScreen,
  doingLine,
  keptPin,
  labStage,
  LOBBY_LINE,
  OVERVIEW_LINE,
  PIN_LABELS,
  pictureOf,
  seatShown,
} from '../src/screens/Demo.js';
import { demoFeedWith, type DemoFeed } from '../src/ws.js';
import { mapWith } from './fixtures.js';
import { storage } from './page.js';
import { playingView } from './playerView.js';

/**
 * The demo room's own screen: which picture a viewer is shown — the director's, a seat pinned,
 * the whole lab —, what the line under it says, and the viewer's choice told the server. The
 * seat's screen itself, read-only, is demoSeat.test.tsx's.
 */

const stage = vi.hoisted(() => ({
  /** the props each game screen and each world shown was given, in order */
  games: [] as Record<string, unknown>[],
  worlds: [] as Record<string, unknown>[],
  effects: [] as (() => void | (() => void))[],
}));

vi.mock('../src/world/GameWorld.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  GameWorld: (props: Record<string, unknown>) => {
    stage.worlds.push(props);
    return null;
  },
}));

vi.mock('../src/screens/Game.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  GameScreen: (props: Record<string, unknown>) => {
    stage.games.push(props);
    return null;
  },
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEffect: (effect: () => void | (() => void)) => void stage.effects.push(effect),
}));

const noop = (): void => undefined;
const what = (name: DemoDoing['what'], sourceId: string | null = null): DemoDoing => ({
  what: name,
  sourceId,
});

/** The two seats' views: Anna reads the Betriebsbuch, Ben stands at console b of two. */
const ANNA = playingView({
  map: mapWith({
    manuals: [
      {
        id: 'buch',
        kind: 'book',
        x: 3,
        y: 3,
        label: 'Betriebsbuch',
        puzzleIds: ['anlauf'],
        opened: true,
        needsKey: null,
        found: true,
        known: true,
      },
    ],
  }),
});
const BEN: PlayerView = {
  ...playingView(),
  you: { id: 'p2', name: 'Ben', color: '#f472b6', ready: true, isHost: false },
  presence: { stationId: 'anlauf', console: 'b', manualId: null, signSeen: false },
};

/** What is on air: `onAir`, Anna reading and Ben at his console, the lab heard from `ear`. */
function shot(onAir: string | null, ear = 'p1', caption: DemoShot['caption'] = null): DemoShot {
  return { onAir, ear, doing: { p1: what('read', 'buch'), p2: what('operate') }, caption };
}

const feed = (onAir: string | null, more: Partial<DemoShot> = {}): DemoFeed => ({
  shot: { ...shot(onAir), ...more },
  views: { p1: ANNA, p2: BEN },
});

const PLAYING = { phase: 'playing' } as const;

afterEach(() => {
  vi.unstubAllGlobals();
  stage.games = [];
  stage.worlds = [];
  stage.effects = [];
});

describe('the picture a viewer of the demo is shown', () => {
  it.each<[DemoPin, string | null, string | null, boolean]>([
    ['regie', 'p1', 'p1', false],
    ['regie', 'p2', 'p2', false],
    // The whole lab on air: over the seat last on air, which is heard on.
    ['regie', null, 'p1', true],
    ['one', 'p2', 'p1', false],
    ['two', null, 'p2', false],
    ['two', 'p1', 'p2', false],
    ['overview', 'p2', 'p1', true],
  ])('pinned to %s with %s on air: the seat %s, the lab over it: %s', (pin, onAir, seat, lab) => {
    const picture = pictureOf(pin, feed(onAir), PLAYING);
    expect([picture.seat?.you.id ?? null, picture.lab]).toEqual([seat, lab]);
    expect(picture.doing).toEqual(seat === 'p1' ? what('read', 'buch') : what('operate'));
  });

  it('is the whole lab alone before any seat’s view came, and in the room’s lobby', () => {
    const none = { seat: null, doing: what('idle'), lab: true };
    expect(pictureOf('regie', { shot: null, views: {} }, PLAYING)).toEqual(none);
    expect(pictureOf('one', { shot: shot('p1'), views: {} }, PLAYING)).toEqual(none);
    // A seat just pinned, its view not come yet: the seat heard so far stays up meanwhile.
    const waiting = pictureOf('two', { shot: shot('p1'), views: { p1: ANNA } }, PLAYING);
    expect(waiting).toEqual({ seat: ANNA, doing: what('read', 'buch'), lab: false });
    expect(pictureOf('regie', feed('p1'), { phase: 'lobby' })).toEqual(none);
    const lobby: DemoFeed = { ...feed('p1'), views: { p1: { ...ANNA, phase: 'lobby' } } };
    expect(pictureOf('regie', lobby, PLAYING)).toEqual(none);
  });

  it('goes by the seats in the crew’s order: „Spieler 1" is the first, whoever is on air', () => {
    expect(seatShown('one', shot('p2'))).toBe('p1');
    expect(seatShown('two', shot('p1'))).toBe('p2');
    expect(seatShown('overview', shot('p2', 'p2'))).toBe('p2');
    expect(seatShown('regie', null)).toBeNull();
  });

  it('keeps the feed as it comes: the shot replaced, each seat’s view by its id', () => {
    const empty: DemoFeed = { shot: null, views: {} };
    const one = demoFeedWith(empty, { kind: 'demo-view', seat: 'p1', view: ANNA, at: 1 });
    const two = demoFeedWith(one, { kind: 'demo-view', seat: 'p2', view: BEN, at: 2 });
    const on = demoFeedWith(two, { kind: 'demo-shot', shot: shot('p2'), at: 3 });
    expect(on).toEqual({ shot: shot('p2'), views: { p1: ANNA, p2: BEN } });
    expect(empty).toEqual({ shot: null, views: {} });
  });
});

describe('the line under the picture', () => {
  it('says what the seat does: the source read by its name, the console by its letter', () => {
    expect(doingLine(ANNA, what('read', 'buch'))).toBe('liest: Betriebsbuch');
    expect(doingLine(ANNA, what('read', 'unbekannt'))).toBe('liest');
    expect(doingLine(BEN, what('operate'))).toBe('am Pult');
    const two = mapWith({
      stations: ['a', 'b'].map((console, x) => ({
        puzzleId: 'anlauf',
        x,
        y: 1,
        title: 'Anlaufsteuerung',
        status: 'armed' as const,
        console: console as 'a' | 'b',
        found: true as const,
        known: true as const,
      })),
    });
    expect(doingLine({ ...BEN, map: two }, what('operate'))).toBe('am Pult B');
    expect(doingLine({ ...BEN, map: two }, what('walk'))).toBe('unterwegs');
  });

  it('has a word for everything the crew does, each in the world’s voice', () => {
    const lines = [
      ['idle', 'wartet'],
      ['intro', 'Schichtbeginn'],
      ['walk', 'unterwegs'],
      ['carry', 'bringt ein Teil'],
      ['sign', 'liest die Laborkennung'],
      ['plate', 'hält die Tür offen'],
      ['read', 'liest'],
      ['operate', 'am Pult'],
      ['escape', 'auf dem Weg zur Luke'],
    ] as const;
    for (const [doing, line] of lines) {
      expect(doingLine(BEN, what(doing))).toBe(line);
    }
    const said = [...lines.map(([, line]) => line), OVERVIEW_LINE, LOBBY_LINE];
    expect(offVoice(said, WORLD)).toEqual([]);
    expect(OVERVIEW_LINE).toBe('Übersicht · die ganze Anlage');
    expect(LOBBY_LINE).toBe('Schichtwechsel: Der nächste Einsatz beginnt gleich.');
    expect(PIN_LABELS).toEqual({
      regie: 'Regie',
      one: 'Spieler 1',
      two: 'Spieler 2',
      overview: 'Übersicht',
    });
  });
});

/** The audience's view of the demo room in a run. */
const AUDIENCE = {
  phase: 'playing',
  missionTitle: 'Blackout im Labor',
  difficulty: 'normal',
  startedAt: 1,
  finishedAt: null,
  lights: { out: true, outAt: 1 },
  players: [
    { id: 'p1', name: 'Anna', color: '#2dd4bf', connected: true },
    { id: 'p2', name: 'Ben', color: '#f472b6', connected: true },
  ],
  events: [],
  away: [],
  map: mapWith({}),
} as unknown as SpectatorView;

/** The demo's screen on `given`, its line up; what it rendered and what it sent. */
function demo(given: DemoFeed, view: SpectatorView = AUDIENCE, kept: DemoPin | null = null) {
  const sent: ClientMessage[] = [];
  const session = new Map<string, string>(kept === null ? [] : [['escapelab.demoPin', kept]]);
  vi.stubGlobal('sessionStorage', storage(session));
  vi.stubGlobal('window', {
    location: { origin: 'https://escapelab.test', pathname: '/' },
    matchMedia: () => ({ matches: false }),
    addEventListener: noop,
    removeEventListener: noop,
  });
  vi.stubGlobal('fetch', () => Promise.resolve());
  const html = renderToStaticMarkup(
    <DemoScreen
      view={view}
      feed={given}
      finale={null}
      positionsRef={{ current: { run: null, players: {} } }}
      dronesRef={{ current: {} }}
      pingsRef={{ current: [] }}
      chatsRef={{ current: [] }}
      send={(msg) => void sent.push(msg)}
      listen={() => noop}
      line={{ status: 'open', retry: null, wake: noop, giveUp: noop }}
      leaveRoom={noop}
    />,
  );
  stage.effects.splice(0).forEach((effect) => effect());
  return { html, sent, session };
}

describe('the demo’s screen', () => {
  it('shows the seat on air on its own screen, and says under it who that is', () => {
    const { html, sent } = demo(feed('p1'));
    expect(html).toContain('<div class="demo demo--seat">');
    expect(html).toContain('<span class="demo-label">Demo</span>');
    expect(html).toContain('<strong>Anna</strong> · liest: Betriebsbuch</p>');
    expect(html).not.toContain('class="demo-lab"');
    // The seat's own screen: watched, seen, on the view of the seat on air — and it is handed
    // nothing to send by.
    const [game] = stage.games;
    expect(stage.games).toHaveLength(1);
    expect(stage.worlds).toEqual([]);
    expect(game).toMatchObject({ watch: { doing: what('read', 'buch'), covered: false } });
    expect((game?.view as PlayerView).you.id).toBe('p1');
    (game?.send as (msg: ClientMessage) => void)({ kind: 'drop-item' });
    expect(sent).toEqual([]);
  });

  it('lays the whole lab over the seat last on air, which is heard on under it', () => {
    const { html } = demo(feed(null, { ear: 'p2' }));
    expect(html).toContain('<div class="demo demo--lab">');
    expect(html).toContain(`<p class="demo-onair" aria-live="polite">${OVERVIEW_LINE}</p>`);
    const [seat] = stage.games;
    const [lab] = stage.worlds;
    expect([stage.games.length, stage.worlds.length]).toEqual([1, 1]);
    expect(seat).toMatchObject({ watch: { doing: what('operate'), covered: true } });
    expect((seat?.view as PlayerView).you.id).toBe('p2');
    // The lab's picture makes no sound of its own, and stops none as it goes.
    expect(lab).toMatchObject({ spectator: true, silent: true, inputLocked: true });
  });

  it('says so while the crew stands in its lobby, with no world at all', () => {
    const lobby = { ...AUDIENCE, phase: 'lobby', map: null } as unknown as SpectatorView;
    const { html } = demo({ shot: shot(null), views: {} }, lobby);
    expect(html).toContain(`<p class="demo-wait">${LOBBY_LINE}</p>`);
    expect([stage.games, stage.worlds]).toEqual([[], []]);
    expect(labStage(lobby, null)).toBe('wait');
    expect(labStage(AUDIENCE, null)).toBe('world');
    expect(labStage({ ...AUDIENCE, phase: 'won' }, null)).toBe('card');
  });

  it('offers the four pictures as buttons, the one chosen pressed, and the way out', () => {
    const { html } = demo(feed('p1'), AUDIENCE, 'two');
    const button =
      /<button type="button" class="demo-pin[^"]*" aria-pressed="(true|false)">([^<]+)</g;
    expect([...html.matchAll(button)].map(([, pressed, label]) => `${label}:${pressed}`)).toEqual([
      'Regie:false',
      'Spieler 1:false',
      'Spieler 2:true',
      'Übersicht:false',
    ]);
    expect(html).toContain(
      '<button class="link demo-leave" aria-label="Zuschauen beenden">',
    );
    expect(html).toContain('<span class="demo-leave-text">Zuschauen beenden</span></button>');
    // Pinned to the second seat, that one is shown whoever is on air.
    expect((stage.games[0]?.view as PlayerView).you.id).toBe('p2');
    expect(html).toContain('<strong>Ben</strong> · am Pult</p>');
  });

  it('tells the server the picture kept for the session — and nothing for the director’s', () => {
    expect(demo(feed('p1'), AUDIENCE, 'two').sent).toEqual([{ kind: 'demo-pin', pin: 'two' }]);
    expect(demo(feed('p1'), AUDIENCE, 'overview').sent).toEqual([
      { kind: 'demo-pin', pin: 'overview' },
    ]);
    expect(demo(feed('p1')).sent).toEqual([]);
    expect(demo(feed('p1'), AUDIENCE, 'regie').sent).toEqual([]);
  });

  it('keeps the choice for the session, and takes nothing else for one', () => {
    for (const pin of DEMO_PINS) {
      vi.stubGlobal('sessionStorage', storage(new Map([['escapelab.demoPin', pin]])));
      expect(keptPin()).toBe(pin);
    }
    vi.stubGlobal('sessionStorage', storage(new Map([['escapelab.demoPin', 'three']])));
    expect(keptPin()).toBe('regie');
    vi.stubGlobal('sessionStorage', storage(new Map()));
    expect(keptPin()).toBe('regie');
    vi.unstubAllGlobals();
    expect(keptPin()).toBe('regie');
  });

  it('says of itself what it is: the label, the plant’s line, the site’s address', () => {
    const { html } = demo(feed('p1'));
    expect(html).toContain(`<span class="demo-label">${DEMO_LABEL}</span>`);
    expect(html).toContain(`<aside class="demo-side"><p class="demo-line">${DEMO_LINE}</p>`);
    expect(html).toContain('<section class="demo-qr"><svg class="qr"');
    expect(html).toContain('// Zum Mitnehmen</div><p class="qr-address">escapelab.test</p>');
    expect(DEMO_LABEL).toBe('Demo');
    expect(DEMO_LINE).toBe('Vorführbetrieb: Die Anlage fährt diesen Einsatz selbst.');
    expect(offVoice([DEMO_LINE], WORLD)).toEqual([]);
  });

  it('shows what one of the crew tells the other as a subtitle, in that one’s colour', () => {
    const caption = { by: 'p2', text: 'Erst messen, dann schneiden.' };
    const { html } = demo(feed('p1', { caption }));
    expect(html).toContain(
      '<p class="demo-caption" aria-live="polite"><strong style="color:#f472b6">Ben: </strong>' +
        '„Erst messen, dann schneiden.“</p>',
    );
    expect(demo(feed('p1')).html).not.toContain('demo-caption');
  });
});

describe('the demo’s screen as the stylesheet lays it out', () => {
  const sheet = readFileSync(new URL('../src/styles/demo.css', import.meta.url), 'utf8');
  /** The body of the first rule of the sheet whose selector line is `selector`. */
  const rule = (selector: string, from = sheet): string => {
    const at = from.indexOf(`\n${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return from.slice(from.indexOf('{', at) + 1, from.indexOf('}', at));
  };
  /** The block of the sheet that opens with `media`, to its end. */
  const block = (media: string): string => {
    const at = sheet.indexOf(`\n${media} {\n`);
    expect(at, media).toBeGreaterThan(0);
    return sheet.slice(at, sheet.indexOf('\n}\n', at));
  };
  const PHONE = '@media (max-width: 560px), (orientation: landscape) and (max-height: 500px)';

  it('makes every way a fingertip tall and wide, and every word 14 px by the size set', () => {
    for (const target of ['.demo-pin', '.demo-leave']) {
      expect(rule(target), target).toMatch(/min-width: 44px;\s*min-height: 44px;/);
    }
    for (const small of ['.demo-pin', '.demo-label', '.demo-line', '.demo-qr .qr-address']) {
      expect(rule(small), small).toContain('font-size: calc(14px * var(--text-scale));');
    }
    for (const large of ['.demo-onair', '.demo-caption', '.demo-wait']) {
      expect(rule(large), large).toContain('font-size: calc(16px * var(--text-scale));');
    }
  });

  it('keeps what a seat’s screen lays over the window inside the picture’s frame', () => {
    expect(rule('.demo-picture')).toContain('transform: translateZ(0);');
    expect(rule('.demo-picture')).toContain('overflow: hidden;');
    expect(rule('.demo-picture .puzzle-modal .panel')).toContain('max-height: 100%;');
    // The subtitle and the fading picture lie over all of it, and take no finger.
    for (const over of ['.demo-caption', '.demo-fade']) {
      expect(rule(over), over).toContain('pointer-events: none;');
    }
  });

  it('shows no control of a seat watched: no way to put down, no notepad, info or menu', () => {
    const hidden = ['put-down', 'device-step-back', 'device-tabs', 'hud-info', 'book-nav button'];
    const list = hidden.map((control) => `.demo .${control}`).join(',\n');
    expect(sheet).toContain(`${list} {\n  display: none;`);
  });

  it('hides the seat’s screen under the whole lab, and keeps it in the page', () => {
    expect(rule('.demo--lab .demo-seat')).toMatch(/^\s*visibility: hidden;\s*$/);
    expect(rule('.demo-lab')).toContain('position: absolute;');
    expect(rule('.demo-lab')).toContain('inset: 0;');
  });

  it('cuts with a fade of 400 ms, and plainly for whoever asked for less motion', () => {
    expect(CUT_FADE_MS).toBe(400);
    expect(rule('.demo-fade--on')).toContain('animation: demo-out 400ms ease-out;');
    expect(rule('.demo-lab')).toContain('animation: demo-in 400ms ease-out;');
    const calm = ":where([data-motion='reduce'])";
    expect(sheet).toContain(`${calm} .demo-lab,\n${calm} .demo-fade--on {\n  animation: none;`);
  });

  it('gives a phone the whole window, upright or sideways: no top bar, the way out an icon', () => {
    const phone = block(PHONE);
    expect(phone).toMatch(/\.app:has\(\.demo\) > \.topbar \{\s*display: none;/);
    expect(phone).toMatch(/\.demo-sound \{\s*display: contents;/);
    expect(phone).toMatch(/\.demo-leave-text \{\s*display: none;/);
    // Off a phone the sound's switch is the top bar's.
    expect(rule('.demo-sound')).toMatch(/^\s*display: none;\s*$/);
    // Upright the choice of picture takes a row of its own, across the window.
    const upright = block('@media (max-width: 560px)');
    expect(upright).toMatch(/\.demo-pins \{\s*flex: 1 1 100%;/);
    expect(upright).toMatch(/\.demo-pin \{\s*flex: 1 1 auto;/);
  });

  it('stands its line and the QR code beside the picture only where there is room', () => {
    expect(rule('.demo-qr .qr')).toContain('width: 146px;');
    expect(block('@media (max-width: 1100px), (max-height: 600px)')).toMatch(
      /\.demo-side \{\s*display: none;/,
    );
  });
});
