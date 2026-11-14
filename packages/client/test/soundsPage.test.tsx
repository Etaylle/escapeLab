import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIBLE_FLOOR_DBFS as SCRIPT_AUDIBLE,
  CATALOG_FILE,
  DIRS,
  isSuite,
  MANIFEST,
  MASKED_WITHIN_DB as SCRIPT_MASKED,
  noisyTakes,
  optionsOf,
  readCatalog,
  TAKES_DIR,
  takesPerRun,
  type Manifest,
  type TakeRecord,
  type TakesList,
} from '../scripts/sfx.js';
import {
  AUDIBLE_FLOOR_DBFS,
  CANDIDATES,
  commandFor,
  commandsFor,
  ENV_FILE,
  listingOf,
  MASKED_WITHIN_DB,
  packKey,
  packListingOf,
  SECTIONS,
  shellWord,
  soundsOf,
  SUITE_TAKES,
  suiteListingOf,
  suitesOf,
  type CatalogSound,
  type PackRow,
} from '../src/sounds/listing.js';
import { opensSounds, SOUNDS_PATH } from '../src/sounds/path.js';
import { linked } from '../src/screens/linked.js';
import {
  factsOf,
  packFactsOf,
  pieceFactsOf,
  pieceRowFactsOf,
  SoundsBoard,
  suiteTakeFactsOf,
  takeFactsOf,
  type BoardProps,
} from '../src/sounds/SoundsBoard.js';
import {
  chooseTake,
  keepCommandFor,
  loadTakes,
  pieceFails,
  pieceKey,
  TAKES_BASE,
  takeFails,
  takeKey,
  takesOf,
  takeUrl,
  UNSERVED,
  type PieceInfo,
  type TakeInfo,
} from '../src/sounds/takes.js';
import { installedPacks } from '../src/world/musicPacks.js';
import { SLOTS } from '../src/world/packFile.js';
import type { SampleEntry } from '../src/world/samples.js';
import { fakeGraph, lastContext, type FakeGain, type FakeNode } from './fakeGraph.js';
import { elements, fakeMedia } from './fakeMedia.js';
import { foundPack, SCORE_PACK } from './fakePacks.js';
import { elementsOf, press } from './probe.js';

/**
 * The audition page (/sounds): what it lists, what it says of each recording, and the command it
 * puts together for the user — no request leaves the page.
 */

/** A recording at `gain`, `ms` long, its floor and its RMS as dBFS before the gain. */
const recording = (gain: number, ms = 480, floorDbfs = -90, rmsDbfs = -20): SampleEntry => ({
  file: 'x.mp3',
  ms,
  gain,
  startMs: 0,
  floor: 10 ** (floorDbfs / 20),
  rms: 10 ** (rmsDbfs / 20),
  loop: false,
  hash: '000000000000',
  source: 'elevenlabs',
});

const CLICK: CatalogSound = {
  id: 'key-click',
  kind: 'oneshot',
  prompt: 'A single hard plastic key on an industrial keypad pressed down.',
  durationSeconds: 0.5,
  loop: false,
};
const HUM: CatalogSound = {
  id: 'mains-hum',
  kind: 'bed',
  prompt: 'The steady electrical mains hum of a large facility.',
  durationSeconds: 6,
  loop: true,
};
const WON: CatalogSound = { ...HUM, id: 'won', kind: 'sting', durationSeconds: 10, loop: false };

describe('the page’s address', () => {
  it('is /sounds, with or without its slash, and nothing else', () => {
    expect(SOUNDS_PATH).toBe('/sounds');
    expect(opensSounds('/sounds')).toBe(true);
    expect(opensSounds('/sounds/')).toBe(true);
    expect(opensSounds('/')).toBe(false);
    expect(opensSounds('/record')).toBe(false);
  });

  it('is linked from none of the game’s screens', () => {
    const screens = ['App.tsx', 'screens/Lobby.tsx', 'screens/Game.tsx', 'screens/End.tsx'];
    for (const file of screens) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/\/sounds\b/);
    }
  });
});

describe('the command for the sounds ticked', () => {
  it('runs the sound script with the key file, three candidates and the ids, in order', () => {
    expect(commandFor(['a', 'b', 'c'])).toBe(
      'node --env-file=/Users/uros/Documents/Req.Eng./escapelab/.env.local scripts/sfx.ts' +
        ' --candidates 3 --only a,b,c',
    );
    expect([ENV_FILE, CANDIDATES]).toEqual([
      '/Users/uros/Documents/Req.Eng./escapelab/.env.local',
      3,
    ]);
    expect(commandFor(['step-1', 'bed-archive'], '../../.env.local', 2)).toBe(
      'node --env-file=../../.env.local scripts/sfx.ts --candidates 2 --only step-1,bed-archive',
    );
  });

  it('is none where nothing is ticked, and quotes a key file the shell would split', () => {
    expect(commandFor([])).toBeNull();
    expect(shellWord('/Users/a b/.env.local')).toBe("'/Users/a b/.env.local'");
    expect(shellWord("it's")).toBe(`'it'\\''s'`);
    const quoted = /^node --env-file='\/a b\/\.env\.local' /;
    expect(commandFor(['ping'], '/a b/.env.local')).toMatch(quoted);
  });
});

describe('the listing', () => {
  it('names every sound of the catalog once, in sections by kind, in the catalog’s order', () => {
    const catalog = soundsOf(readCatalog());
    const sections = listingOf(catalog, {});
    expect(sections.map((section) => section.title)).toEqual([
      'Effekte',
      'Räume und Schleifen',
      'Endkarte',
    ]);
    const listed = sections.flatMap((section) => section.rows.map((row) => row.sound.id));
    expect(listed.sort()).toEqual(catalog.map((sound) => sound.id).sort());
    // Every item but a suite, whose pieces the page lists apart, in the plan's order.
    expect(catalog).toHaveLength(readCatalog().filter((item) => !isSuite(item)).length);
    expect(suitesOf(readCatalog()).map((suite) => suite.id)).toEqual(['score']);
    for (const section of sections) {
      expect(section.rows.every((row) => row.sound.kind === section.kind)).toBe(true);
    }
    expect(SECTIONS.map((section) => section.kind)).toEqual(['oneshot', 'bed', 'sting']);
  });

  it('gives each sound its recording, and hears its floor as the sound script does', () => {
    expect([AUDIBLE_FLOOR_DBFS, MASKED_WITHIN_DB]).toEqual([SCRIPT_AUDIBLE, SCRIPT_MASKED]);
    const [effects, loops, music] = listingOf([CLICK, HUM, WON], {
      'key-click': recording(12, 480, -70, -30), // its tail brought up to −48.4 dBFS
      'mains-hum': recording(8, 6000, -40, -38), // its quietest 100 ms: the hum itself
    });
    expect(effects?.rows[0]).toMatchObject({ noisy: true, recording: { gain: 12 } });
    expect(effects?.rows[0]?.floorDbfs).toBeCloseTo(-48.42, 2);
    expect(loops?.rows[0]).toMatchObject({ noisy: false, floorDbfs: null });
    const none = { sound: WON, recording: null, floorDbfs: null, noisy: false };
    expect(music?.rows[0]).toEqual(none);
  });

  it('flags just the lab’s recordings the sound script flags', () => {
    const catalog = readCatalog();
    const read = (dir: string): Manifest =>
      JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as Manifest;
    const manifests = { sfx: read(DIRS.sfx), music: read(DIRS.music) };
    const recordings = { ...manifests.sfx, ...manifests.music };
    // As the page lists them: the sounds by kind, a suite's pieces apart.
    const rows = listingOf(soundsOf(catalog), recordings).flatMap((section) => section.rows);
    const pieces = suiteListingOf(suitesOf(catalog), recordings).flatMap((each) => each.rows);
    const flagged = [
      ...rows.filter((row) => row.noisy).map((row) => row.sound),
      ...pieces.filter((row) => row.noisy).map((row) => row.piece),
    ];
    const ids = (list: readonly { readonly id: string }[]): string[] =>
      list.map(({ id }) => id).sort();
    expect(ids(flagged)).toEqual(ids(noisyTakes(catalog, manifests)));
  });

  it('reads only the kinds it knows from the catalog', () => {
    const odd = { ...CLICK, id: 'odd', kind: 'jingle' };
    expect(soundsOf([CLICK, odd]).map((sound) => sound.id)).toEqual(['key-click']);
  });

  it('says of a recording its length, its gain, its floor and a loop, in German', () => {
    const facts = (sound: CatalogSound, take: SampleEntry): string => {
      const [section] = listingOf([sound], { [sound.id]: take }).filter((s) => s.rows.length);
      return factsOf(section?.rows[0] as never);
    };
    const soft = '0,5 s · Verstärkung 8,25× · Grundrauschen −51,7 dBFS';
    expect(facts(CLICK, recording(8.25, 480, -70, -30))).toBe(soft);
    const heard = '0,5 s · Verstärkung 12,00× · Grundrauschen −48,4 dBFS, hörbar';
    expect(facts(CLICK, recording(12, 480, -70, -30))).toBe(heard);
    const hum = '6,0 s · Verstärkung 0,19× · Grundrauschen vom Klang verdeckt · Schleife';
    expect(facts(HUM, recording(0.19, 6000, -10.2, -5.5))).toBe(hum);
    const still = '0,5 s · Verstärkung 1,00× · kein Grundrauschen';
    expect(facts(CLICK, recording(1, 480, -Infinity, -20))).toBe(still);
    const [none] = listingOf([CLICK], {});
    expect(factsOf(none?.rows[0] as never)).toBe('keine Aufnahme');
  });
});

describe('the board', () => {
  const props = (over: Partial<BoardProps> = {}): BoardProps => ({
    sections: listingOf([CLICK, HUM], {
      'key-click': recording(12, 480, -70, -30),
      'mains-hum': recording(1),
    }),
    suites: [],
    packs: [],
    takes: {},
    takesNote: null,
    playing: null,
    loaded: (id) => id === 'key-click',
    selected: new Set(),
    keeping: {},
    envFile: ENV_FILE,
    commands: [],
    copied: null,
    on: {
      play: () => undefined,
      playTake: () => undefined,
      playPiece: () => undefined,
      playPack: () => undefined,
      toggle: () => undefined,
      keep: () => undefined,
      envFile: () => undefined,
      copy: () => undefined,
    },
    ...over,
  });

  it('lists each sound with its play button, its prompt and its box to tick', () => {
    const html = renderToStaticMarkup(<SoundsBoard {...props()} />);
    expect(html).toContain('Klänge des Labors');
    expect(html).toContain(CLICK.prompt);
    expect(html).toContain(HUM.prompt);
    expect(html.match(/neu rendern/g)).toHaveLength(2);
    expect(html.match(/>Abspielen</g)).toHaveLength(2);
    expect(html).toContain('sounds-row sounds-row--noisy');
    expect(html).toContain('Nichts angekreuzt.');
    // The hum is not loaded: its button cannot play it.
    const button = /disabled=""[^>]*>Abspielen<\/button>/.source;
    const silent = new RegExp(`${button}<div class="sounds-what"><code[^>]*>mains-hum`);
    expect(html).toMatch(silent);
  });

  it('shows what plays, what is ticked and the command for it', () => {
    const command = commandFor(['key-click']) ?? '';
    const ticked = props({
      playing: 'key-click',
      selected: new Set(['key-click']),
      commands: [command],
    });
    const html = renderToStaticMarkup(<SoundsBoard {...ticked} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('>Stopp<');
    expect(html).toContain('checked=""');
    expect(html).toContain(`<pre class="sounds-cli">${command}</pre>`);
    expect(html).not.toContain('Nichts angekreuzt.');
  });
});

/** A take as the sound script lists it: menu-theme's second, as the first render measured it. */
const RECORD: TakeRecord = {
  n: 2,
  file: '2.mp3',
  hash: '7376acdcf4c7',
  settings: {
    musicLengthMs: 60_000,
    forceInstrumental: true,
    modelId: 'music_v2_5',
    outputFormat: 'mp3_44100_192',
  },
  madeAt: '2026-11-13T17:40:00.000Z',
  ms: 60_029,
  gain: 0.5303,
  startMs: 0,
  peak: 0.98,
  rms: 0.189,
  floor: 0.104,
  silence: 0,
  misses: [],
};
const LIST: TakesList = { id: 'menu-theme', takes: [RECORD] };

/** A take of the page's own: `n`, its measurements as `over` says, else RECORD's. */
const takeOf = (n: number, over: Partial<TakeInfo> = {}): TakeInfo => ({
  ...RECORD,
  n,
  file: `${n}.mp3`,
  ...over,
});

describe('the takes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('are read from the lists the sound script writes, and nothing else', () => {
    expect(takesOf({ 'menu-theme': LIST })).toEqual({ 'menu-theme': [RECORD] });
    const odd = [
      { ...RECORD, n: 3 }, // its file is not its number's
      { ...RECORD, n: 4, file: '4.mp3', gain: 'laut' },
      { ...RECORD, n: 5, file: '5.mp3', misses: 'length' },
      null,
    ];
    const lists = {
      'menu-theme': { ...LIST, takes: [RECORD, ...odd] },
      'end-won': { id: 'end-won' },
      'end-lost': { id: 'end-lost', takes: [] },
      won: null,
    };
    expect(takesOf(lists)).toEqual({ 'menu-theme': [RECORD] });
    expect([takesOf(null), takesOf('[]'), takesOf([RECORD])]).toEqual([{}, {}, {}]);
  });

  it('are asked of the dev server alone, its lists with a plain GET', async () => {
    const asked: unknown[][] = [];
    const answer = (res: object | Error) => {
      vi.stubGlobal(
        'fetch',
        vi.fn((...args: unknown[]) => {
          asked.push(args);
          return res instanceof Error ? Promise.reject(res) : Promise.resolve(res);
        }),
      );
    };
    answer({ ok: true, status: 200, json: () => Promise.resolve({ 'menu-theme': LIST }) });
    expect(await loadTakes()).toEqual({ kind: 'served', takes: { 'menu-theme': [RECORD] } });
    expect(asked).toEqual([['/takes/']]);
    // A production server serves none: 404 under /takes, never the page in their place.
    answer({ ok: false, status: 404 });
    expect(await loadTakes()).toEqual({ kind: 'unserved', why: UNSERVED });
    expect(UNSERVED).toBe('Takes liefert nur der Entwicklungsserver (pnpm dev).');
    answer({ ok: false, status: 502 });
    const failed = 'Die Takes ließen sich nicht laden: ';
    expect(await loadTakes()).toEqual({ kind: 'unserved', why: `${failed}HTTP 502` });
    answer(new Error('Failed to fetch'));
    expect(await loadTakes()).toEqual({ kind: 'unserved', why: `${failed}Failed to fetch` });
    expect(asked.every((args) => args.length === 1 && args[0] === TAKES_BASE)).toBe(true);
  });

  it('play from the dev server, each under a key of its own', () => {
    expect(TAKES_BASE).toBe('/takes/');
    expect(takeUrl('menu-theme', RECORD)).toBe('/takes/menu-theme/2.mp3');
    expect(takeKey('menu-theme', 2)).toBe('menu-theme#2');
    expect(readCatalog().some((entry) => entry.id.includes('#'))).toBe(false);
  });

  it('are said in one line each: their measurements, and the rules they miss', () => {
    const plain =
      '60,0 s · Verstärkung 0,53× · Spitze −0,2 dBFS · RMS −14,5 dBFS · ' +
      'Grundrauschen vom Klang verdeckt · Stille 0 %';
    expect(takeFactsOf(RECORD)).toBe(plain);
    const off = takeOf(3, {
      ms: 74_000,
      gain: 1,
      startMs: 553,
      rms: 0.2,
      floor: 0.01,
      silence: 0.123,
      misses: ['length', 'floor', 'peak'],
    });
    expect(takeFactsOf(off)).toBe(
      '74,0 s · Verstärkung 1,00× · Spitze −0,2 dBFS · RMS −14,0 dBFS · ' +
        'Grundrauschen −40,0 dBFS, hörbar · Stille 12 % · Einsatz nach 0,6 s · ' +
        'Regeln verfehlt: Länge, Grundrauschen, Spitze',
    );
    // Kept, a take off its length or with its floor heard fails the game's recordings.
    expect([takeFails(off), takeFails(RECORD)]).toEqual([true, false]);
    expect(takeFails(takeOf(4, { misses: ['peak', 'start', 'silence'] }))).toBe(false);
    expect(takeFails(takeOf(5, { misses: ['floor'] }))).toBe(true);
  });

  it('are kept by the command the sound script reads, one take of a piece at a time', () => {
    expect(keepCommandFor('menu-theme', 2)).toBe('node scripts/sfx.ts --keep menu-theme=2');
    const [, , ...args] = keepCommandFor('end-lost', 3).split(' ');
    expect(optionsOf(args).keep).toEqual({ id: 'end-lost', n: 3 });
    expect(chooseTake({}, 'menu-theme', 2)).toEqual({ 'menu-theme': 2 });
    expect(chooseTake({ 'menu-theme': 2 }, 'menu-theme', 3)).toEqual({ 'menu-theme': 3 });
    expect(chooseTake({ 'menu-theme': 2, won: 1 }, 'menu-theme', 2)).toEqual({ won: 1 });
  });

  it('lie beside the build, never in it', () => {
    const client = join(CATALOG_FILE, '../..');
    expect(relative(client, TAKES_DIR)).toBe('takes');
    expect(relative(join(client, 'public'), TAKES_DIR).startsWith('..')).toBe(true);
    const ignored = readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8');
    expect(ignored).toMatch(/^packages\/client\/takes\/$/m);
  });
});

describe('the board’s takes', () => {
  const WON_TAKES = { won: [takeOf(1), takeOf(2, { misses: ['length'] })] };
  const props = (over: Partial<BoardProps> = {}): BoardProps => ({
    sections: listingOf([CLICK, WON], { 'key-click': recording(1), won: recording(1, 10_000) }),
    suites: [],
    packs: [],
    takes: WON_TAKES,
    takesNote: null,
    playing: null,
    loaded: () => true,
    selected: new Set(),
    keeping: {},
    envFile: ENV_FILE,
    commands: [],
    copied: null,
    on: {
      play: () => undefined,
      playTake: () => undefined,
      playPiece: () => undefined,
      playPack: () => undefined,
      toggle: () => undefined,
      keep: () => undefined,
      envFile: () => undefined,
      copy: () => undefined,
    },
    ...over,
  });

  it('lists each take under its piece: a play button, its measurements, a choice to keep', () => {
    const html = renderToStaticMarkup(<SoundsBoard {...props()} />);
    expect(html.match(/>Abspielen</g)).toHaveLength(4); // two recordings, two takes
    expect(html.match(/>Diesen Take wählen</g)).toHaveLength(2);
    const won = html.slice(html.indexOf('<code class="sounds-id">won</code>'));
    expect(won).toContain('<ol class="sounds-take-list" aria-label="Takes von won">');
    expect(won).toContain('<span class="sounds-take-name">Take 1</span>');
    expect(won).toContain(`<span class="sounds-facts">${takeFactsOf(takeOf(1))}</span>`);
    expect(html.match(/class="sounds-take sounds-take--fails"/g)).toHaveLength(1);
    expect(html).toContain('Neue Takes der Musik stehen unter ihrem Stück');
    // Nothing is chosen, so no command keeps anything.
    expect(html).not.toContain('--keep');
    const click = html.slice(0, html.indexOf('<code class="sounds-id">won</code>'));
    expect(click).not.toContain('sounds-takes');
  });

  it('shows the command that keeps the take chosen, and plays a take as a recording', () => {
    const chosen = props({ keeping: { won: 2 }, playing: takeKey('won', 1) });
    const html = renderToStaticMarkup(<SoundsBoard {...chosen} />);
    expect(html).toContain('Im Ordner packages/client behält dieser Befehl Take 2');
    expect(html).toContain('<pre class="sounds-cli">node scripts/sfx.ts --keep won=2</pre>');
    // The page reads its lists as it opens: the take kept plays as the game's once it reloads.
    const reload = 'Danach die Seite neu laden: Der Take spielt dann als Aufnahme des Spiels.';
    expect(html).toContain(`</pre><p class="muted">${reload}</p>`);
    const keeps = [...html.matchAll(/class="sounds-keep" aria-pressed="(\w+)"/g)];
    expect(keeps.map((match) => match[1])).toEqual(['false', 'true']);
    const plays = [...html.matchAll(/class="sounds-play" aria-pressed="(\w+)"[^>]*>(\w+)</g)];
    expect(plays.map((match) => [match[1], match[2]])).toEqual([
      ['false', 'Abspielen'], // the click
      ['false', 'Abspielen'], // the sting as the game plays it
      ['true', 'Stopp'], // its take 1
      ['false', 'Abspielen'],
    ]);
  });

  it('says why no take is heard, where the server serves none', () => {
    const none = props({ takes: {}, takesNote: UNSERVED });
    const html = renderToStaticMarkup(<SoundsBoard {...none} />);
    expect(html).toContain(`<p class="muted sounds-note">${UNSERVED}</p>`);
    expect(html).not.toContain('sounds-takes');
    expect(html).not.toContain('Neue Takes der Musik');
  });
});

describe('the page and the network', () => {
  it('asks for its lists alone and runs neither a render nor a keep', () => {
    const dir = new URL('../src/sounds/', import.meta.url);
    const sources = readdirSync(dir)
      .sort()
      .map((name) => readFileSync(new URL(name, dir), 'utf8'));
    const fetches = sources.flatMap((code) => [...code.matchAll(/\bfetch\(([^)]*)\)/g)]);
    const asked = fetches.map((match) => match[1]).sort();
    expect(asked).toEqual(['TAKES_BASE', '`${base}manifest.json`']);
    const asking = /\bmethod\s*:|\bPOST\b|sendBeacon|XMLHttpRequest|WebSocket|EventSource/;
    expect(sources.filter((code) => asking.test(code))).toEqual([]);
  });
});

describe('a take played', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams from the dev server at the gain the game would give it, a stem looped', async () => {
    fakeGraph();
    fakeMedia();
    vi.resetModules();
    const { auditionTake, AUDITION_LEVEL } = await import('../src/sounds/SoundsScreen.js');
    const ended = vi.fn();
    const played = auditionTake('menu-theme', takeOf(2, { gain: 0.53 }), true, ended);
    const element = elements.find((each) => each.src === '/takes/menu-theme/2.mp3');
    expect(element?.loop).toBe(true);
    const source = lastContext()
      .all<FakeNode & { mediaElement: unknown }>('media')
      .find((node) => node.mediaElement === element);
    // As the recordings: half way down for headroom, times the gain that brings it to its level.
    expect(AUDITION_LEVEL).toBe(0.5);
    expect((source?.outputs[0] as FakeGain | undefined)?.gain.value).toBeCloseTo(0.5 * 0.53, 9);
    played?.stop();
    expect(ended).toHaveBeenCalledTimes(1);
    const once = auditionTake('end-won', takeOf(1, { gain: 1.92 }), false, () => undefined);
    expect(elements.find((each) => each.src === '/takes/end-won/1.mp3')?.loop).toBe(false);
    once?.stop();
  });
});

/** A piece of the score's take as the sound script lists it, where the plan cuts it. */
const pieceOf = (id: string, fromMs: number, ms: number, over: Partial<PieceInfo> = {}) => ({
  id,
  fromMs,
  ms,
  loop: false,
  gain: 1.2,
  loudness: -22.3,
  peak: 0.6,
  rms: 0.08,
  floor: 0.0001,
  silence: 0,
  misses: [],
  ...over,
});

/** The score's first take as its list keeps it: the whole, and its eight pieces. */
const SCORE_TAKE: TakeInfo = {
  n: 1,
  file: '1.mp3',
  ms: 490_667,
  gain: 1,
  startMs: 0,
  peak: 0.9,
  rms: 0.1,
  floor: 0.0001,
  silence: 0,
  misses: [],
  pieces: [
    pieceOf('menu-theme', 0, 93_333, { loop: true }),
    pieceOf('lobby', 93_333, 61_334, { loop: true }),
    pieceOf('title', 154_667, 40_000),
    pieceOf('calm', 194_667, 72_000, { loop: true }),
    pieceOf('tense', 266_667, 72_000, { loop: true }),
    pieceOf('critical', 338_667, 72_000, { loop: true }),
    pieceOf('end-lost', 410_667, 40_000),
    pieceOf('end-won', 450_667, 40_000),
  ],
};

/** The board with the score as the catalog writes it, its pieces unrecorded, as `over` says. */
const boardOf = (over: Partial<BoardProps> = {}): BoardProps => ({
  sections: listingOf([], {}),
  suites: suiteListingOf(suitesOf(readCatalog()), {}),
  packs: [],
  takes: {},
  takesNote: null,
  playing: null,
  loaded: () => false,
  selected: new Set(),
  keeping: {},
  envFile: ENV_FILE,
  commands: [],
  copied: null,
  on: {
    play: () => undefined,
    playTake: () => undefined,
    playPiece: () => undefined,
    playPack: () => undefined,
    toggle: () => undefined,
    keep: () => undefined,
    envFile: () => undefined,
    copy: () => undefined,
  },
  ...over,
});

describe('the score on the page', () => {
  const suites = suitesOf(readCatalog());
  const order = ['menu-theme', 'lobby', 'title', 'calm', 'tense', 'critical'];
  order.push('end-lost', 'end-won');

  it('reads the catalog’s suite: its pieces in the plan’s order, each with its recording', () => {
    expect(suites.map((suite) => [suite.id, suite.key, suite.bpm])).toEqual([
      ['score', 'A minor', 90],
    ]);
    const [listing] = suiteListingOf(suites, {
      'menu-theme': recording(12, 93_333, -70, -30), // its floor brought up to −48.4 dBFS
      calm: { ...recording(1.2, 72_000), loop: true },
    });
    expect(listing?.rows.map((row) => row.piece.id)).toEqual(order);
    expect(listing?.rows[0]).toMatchObject({ noisy: true });
    expect(listing?.rows[1]).toMatchObject({ recording: null, noisy: false });
    const [calm] = listing?.rows.filter((row) => row.piece.id === 'calm') ?? [];
    expect(calm === undefined ? '' : pieceRowFactsOf(calm)).toBe(
      '72,0 s · Verstärkung 1,20× · Grundrauschen −88,4 dBFS · Schleife',
    );
  });

  it('asks the script for the score in as many takes as a run makes, beside the sounds', () => {
    const score = readCatalog().find(isSuite);
    expect(score === undefined ? 0 : takesPerRun(score)).toBe(SUITE_TAKES);
    const node = `node --env-file=${ENV_FILE} scripts/sfx.ts`;
    expect(commandsFor(['ping'], ['score'])).toEqual([
      `${node} --candidates 3 --only ping`,
      `${node} --candidates 2 --only score`,
    ]);
    expect(commandsFor([], [])).toEqual([]);
    const [, , , ...args] = (commandsFor([], ['score'])[0] ?? '').split(' ');
    expect(optionsOf(args)).toMatchObject({ candidates: 2, only: ['score'], keep: null });
  });

  it('reads a suite’s takes with their pieces, and none whose pieces do not read', () => {
    const odd = { ...SCORE_TAKE, n: 2, file: '2.mp3', pieces: [{ id: 'calm', fromMs: 'x' }] };
    expect(takesOf({ score: { id: 'score', takes: [SCORE_TAKE, odd] } })).toEqual({
      score: [SCORE_TAKE],
    });
    const still = [pieceOf('calm', 0, 1, { loudness: null })];
    const silent = { ...SCORE_TAKE, n: 3, file: '3.mp3', pieces: still };
    expect(takesOf({ score: { id: 'score', takes: [silent] } })['score']).toHaveLength(1);
    expect(pieceKey('score', 2, 'calm')).toBe('score#2/calm');
  });

  it('says a take of the score and each piece in a line, and which cannot be kept whole', () => {
    expect(suiteTakeFactsOf(SCORE_TAKE)).toBe('490,7 s · 8 Stücke');
    const off = { ...SCORE_TAKE, ms: 480_000, misses: ['length'] };
    expect(suiteTakeFactsOf(off)).toBe('480,0 s · 8 Stücke · Regeln verfehlt: Länge');
    const [menu] = SCORE_TAKE.pieces ?? [];
    expect(menu === undefined ? '' : pieceFactsOf(menu)).toBe(
      '93,3 s · Verstärkung 1,20× · Lautheit −22,3 LUFS · Grundrauschen −78,4 dBFS · ' +
        'Stille 0 % · Schleife',
    );
    expect(pieceFactsOf(pieceOf('end-lost', 0, 40_000, { loudness: null, misses: ['silence'] })))
      .toBe(
        '40,0 s · Verstärkung 1,20× · Lautheit: still · Grundrauschen −78,4 dBFS · Stille 0 % · ' +
          'Regeln verfehlt: Stille',
      );
    const loud = pieceOf('calm', 0, 72_000, { misses: ['floor'] });
    const noisy = { ...SCORE_TAKE, pieces: [loud] };
    expect([takeFails(SCORE_TAKE), takeFails(off), takeFails(noisy)]).toEqual([false, true, true]);
    expect([pieceFails(loud), pieceFails(pieceOf('calm', 0, 72_000))]).toEqual([true, false]);
    const flagged = renderToStaticMarkup(
      <SoundsBoard {...boardOf({ takes: { score: [noisy] } })} />,
    );
    expect(flagged.match(/class="sounds-piece sounds-piece--fails"/g)).toHaveLength(1);
  });

});

describe('the score on the board', () => {
  const order = ['menu-theme', 'lobby', 'title', 'calm', 'tense', 'critical'];
  order.push('end-lost', 'end-won');

  it('lists the score: a row a take, every piece playable in order, one command keeps it', () => {
    const second = { ...SCORE_TAKE, n: 2, file: '2.mp3' };
    const html = renderToStaticMarkup(
      <SoundsBoard
        {...boardOf({
          takes: { score: [SCORE_TAKE, second] },
          playing: pieceKey('score', 1, 'calm'),
          selected: new Set(['score']),
          keeping: { score: 2 },
          commands: commandsFor([], ['score']),
        })}
      />,
    );
    expect(html).toContain('Partitur <span class="muted">(8 Stücke)</span>');
    expect(html).toContain('<ol class="sounds-take-list" aria-label="Takes von score">');
    expect(html.match(/>Diesen Take wählen</g)).toHaveLength(2);
    const first = html.slice(html.indexOf('aria-label="Stücke von Take 1"'));
    const piece = /<li class="sounds-piece">.*?<code class="sounds-id">([\w-]+)</g;
    const ids = [...first.matchAll(piece)];
    expect(ids.slice(0, 8).map((match) => match[1])).toEqual(order);
    expect(first.slice(0, first.indexOf('</ol>'))).toContain('aria-pressed="true">Stopp<');
    expect(html).toContain('<pre class="sounds-cli">node scripts/sfx.ts --keep score=2</pre>');
    expect(html).toContain('behält dieser Befehl Take 2 der ganzen Partitur, schneidet ihn');
    expect(html.match(/entsteht mit der Partitur/g)).toHaveLength(8);
    expect(html).not.toContain('sounds-piece--fails'); // no piece of either take would fail
    expect(html).not.toContain('Musik <span class="muted">(0)</span>');
    expect(html).toContain('--candidates 2 --only score</pre>');
  });

  it('plays a piece of a take from where the plan cuts it, at its gain, to its end', async () => {
    fakeGraph();
    fakeMedia();
    vi.useFakeTimers();
    vi.resetModules();
    try {
      const { auditionPiece, AUDITION_LEVEL } = await import('../src/sounds/SoundsScreen.js');
      const ended = vi.fn();
      const calm = pieceOf('calm', 194_667, 72_000, { loop: true, gain: 0.8 });
      auditionPiece('score', SCORE_TAKE, calm, ended);
      const element = elements.find((each) => each.src === '/takes/score/1.mp3');
      expect(element?.currentTime).toBeCloseTo(194.667, 6);
      const source = lastContext()
        .all<FakeNode & { mediaElement: unknown }>('media')
        .find((node) => node.mediaElement === element);
      const level = (source?.outputs[0] as FakeGain | undefined)?.gain.value;
      expect(level).toBeCloseTo(AUDITION_LEVEL * 0.8, 9);
      vi.advanceTimersByTime(20);
      expect(element?.plays).toBe(1);
      vi.advanceTimersByTime(71_970);
      expect(ended).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30);
      expect([ended.mock.calls.length, element?.src]).toEqual([1, '']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the music packs on the page', () => {
  const PROBE = foundPack('probe', { critical: { loop: { bars: { bpm: 76, count: 19 } } } });
  const listing = (): ReturnType<typeof packListingOf> =>
    packListingOf([SCORE_PACK, PROBE], {
      calm: { ...recording(1.8, 72_046), file: 'c.mp3' },
      'end-won': recording(1.9, 32_026),
    });

  it('lists every pack with its piece for each place, a found one from its pack’s folder', () => {
    const [score, probe] = listing();
    expect(probe?.rows.map((row) => row.slot)).toEqual([...SLOTS]);
    expect(probe?.rows[3]?.sound).toEqual({
      file: 'packs/probe/calm.m4a',
      ms: 70_000,
      startMs: 0,
      gain: 0.5,
    });
    // The score's pieces play as the music's manifest lists them; one unrecorded has none.
    expect(score?.rows[3]?.sound).toEqual({ file: 'c.mp3', ms: 72_046, startMs: 0, gain: 1.8 });
    expect(score?.rows[1]?.sound).toBeNull();
  });

  it('says of a piece its length, loudness, gain, licence, and how the game loops it', () => {
    const [score, probe] = listing();
    const facts = (rows: readonly PackRow[] | undefined, slot: string): string =>
      packFactsOf(rows?.find((row) => row.slot === slot) as PackRow);
    expect(facts(probe?.rows, 'calm')).toBe(
      '70,0 s · Lautheit −20,0 LUFS · Verstärkung 0,50× · CC BY 4.0 · ' +
        'Schleife ab 3,0 s alle 60,0 s, Überblendung 3,0 s',
    );
    expect(facts(probe?.rows, 'critical')).toContain('· Schleife: 19 Takte zu 76 bpm');
    expect(facts(probe?.rows, 'end-won')).toBe(
      '35,0 s · Lautheit −20,0 LUFS · Verstärkung 0,80× · CC BY 4.0 · einmal',
    );
    expect(facts(score?.rows, 'calm')).toBe(
      '72,0 s · Verstärkung 1,80× · eigene Partitur · Schleife auf Takten',
    );
    const ending = '32,0 s · Verstärkung 1,90× · eigene Partitur · einmal';
    expect(facts(score?.rows, 'end-won')).toBe(ending);
    expect(facts(score?.rows, 'lobby')).toBe('keine Aufnahme: wartet auf die Partitur');
  });

  it('stand on the board after the score: each piece playable, its attribution linked', () => {
    const playPack = vi.fn();
    const props = boardOf({
      packs: listing(),
      playing: packKey('probe', 'tense'),
      on: { ...boardOf().on, playPack },
    });
    const html = renderToStaticMarkup(<SoundsBoard {...props} />);
    const packs = html.slice(html.indexOf('aria-label="Musikpakete"'));
    expect(html.indexOf('aria-label="Partitur score"')).toBeLessThan(html.length - packs.length);
    expect(packs).toContain('Musikpakete <span class="muted">(2)</span>');
    expect(packs).toContain('Schicht X · probe <span class="muted">(probe · Ada Example)</span>');
    expect(packs.match(/class="sounds-prompt sounds-credit"/g)).toHaveLength(16);
    expect(packs).toContain(
      '<a href="https://opengameart.org/content/probe" target="_blank" rel="noreferrer">',
    );
    // The score's six pieces without a recording cannot be played; the one playing says so.
    expect(packs.match(/disabled="">Abspielen</g)).toHaveLength(6);
    const row = /aria-pressed="true">Stopp<\/button><div class="sounds-what"><code[^>]*>tense</;
    expect(packs).toMatch(row);
    const found = elementsOf(() => <SoundsBoard {...props} />).filter(
      (element) => element.type === 'button' && element.props['className'] === 'sounds-play',
    );
    press(found.at(-1));
    expect(playPack).toHaveBeenCalledWith('probe', 'end-lost');
  });

});

describe('the music packs’ credits and sound on the page', () => {
  it('give the whole list of the music’s credits: every piece of every pack shipped', () => {
    const shipped = packListingOf(installedPacks(), {});
    const html = renderToStaticMarkup(<SoundsBoard {...boardOf({ packs: shipped })} />);
    for (const { pack } of shipped) {
      for (const slot of SLOTS) {
        const credit = renderToStaticMarkup(<>{linked(pack.pieces[slot].attribution)}</>);
        expect(html, `${pack.id} ${slot}`).toContain(credit);
      }
    }
  });

  it('streams a piece once, from where its sound starts, at the game’s gain', async () => {
    fakeGraph();
    fakeMedia();
    vi.useFakeTimers();
    vi.resetModules();
    try {
      const { auditionPack, AUDITION_LEVEL } = await import('../src/sounds/SoundsScreen.js');
      const ended = vi.fn();
      const sound = { file: 'packs/probe/calm.m4a', ms: 70_000, startMs: 2500, gain: 0.5 };
      const played = auditionPack(sound, ended);
      const element = elements.find((each) => each.src === '/music/packs/probe/calm.m4a');
      expect([element?.currentTime, element?.loop]).toEqual([2.5, false]);
      const source = lastContext()
        .all<FakeNode & { mediaElement: unknown }>('media')
        .find((node) => node.mediaElement === element);
      const level = (source?.outputs[0] as FakeGain | undefined)?.gain.value;
      expect(level).toBeCloseTo(AUDITION_LEVEL * 0.5, 9);
      vi.advanceTimersByTime(20);
      expect(element?.plays).toBe(1);
      element?.fire('ended');
      expect([ended.mock.calls.length, element?.src]).toEqual([1, '']);
      expect(played).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
