import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIBLE_FLOOR_DBFS as SCRIPT_AUDIBLE,
  CATALOG_FILE,
  DIRS,
  MANIFEST,
  MASKED_WITHIN_DB as SCRIPT_MASKED,
  noisyTakes,
  optionsOf,
  readCatalog,
  TAKES_DIR,
  type Manifest,
  type TakeRecord,
  type TakesList,
} from '../scripts/sfx.js';
import {
  AUDIBLE_FLOOR_DBFS,
  CANDIDATES,
  commandFor,
  ENV_FILE,
  listingOf,
  MASKED_WITHIN_DB,
  SECTIONS,
  shellWord,
  soundsOf,
  type CatalogSound,
} from '../src/sounds/listing.js';
import { opensSounds, SOUNDS_PATH } from '../src/sounds/path.js';
import { factsOf, SoundsBoard, takeFactsOf, type BoardProps } from '../src/sounds/SoundsBoard.js';
import {
  chooseTake,
  keepCommandFor,
  loadTakes,
  TAKES_BASE,
  takeFails,
  takeKey,
  takesOf,
  takeUrl,
  UNSERVED,
  type TakeInfo,
} from '../src/sounds/takes.js';
import type { SampleEntry } from '../src/world/samples.js';

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
const CALM: CatalogSound = { ...HUM, id: 'calm', kind: 'stem', durationSeconds: 72 };

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
      'Musik',
      'Endkarte',
      'Nach der Endkarte',
    ]);
    const listed = sections.flatMap((section) => section.rows.map((row) => row.sound.id));
    expect(listed.sort()).toEqual(catalog.map((sound) => sound.id).sort());
    expect(catalog).toHaveLength(readCatalog().length);
    for (const section of sections) {
      expect(section.rows.every((row) => row.sound.kind === section.kind)).toBe(true);
    }
    expect(SECTIONS.map((section) => section.kind)).toEqual([
      'oneshot',
      'bed',
      'stem',
      'sting',
      'theme',
    ]);
  });

  it('gives each sound its recording, and hears its floor as the sound script does', () => {
    expect([AUDIBLE_FLOOR_DBFS, MASKED_WITHIN_DB]).toEqual([SCRIPT_AUDIBLE, SCRIPT_MASKED]);
    const [effects, loops, music] = listingOf([CLICK, HUM, CALM], {
      'key-click': recording(12, 480, -70, -30), // its tail brought up to −48.4 dBFS
      'mains-hum': recording(8, 6000, -40, -38), // its quietest 100 ms: the hum itself
    });
    expect(effects?.rows[0]).toMatchObject({ noisy: true, recording: { gain: 12 } });
    expect(effects?.rows[0]?.floorDbfs).toBeCloseTo(-48.42, 2);
    expect(loops?.rows[0]).toMatchObject({ noisy: false, floorDbfs: null });
    const none = { sound: CALM, recording: null, floorDbfs: null, noisy: false };
    expect(music?.rows[0]).toEqual(none);
  });

  it('flags just the lab’s recordings the sound script flags', () => {
    const catalog = readCatalog();
    const read = (dir: string): Manifest =>
      JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as Manifest;
    const manifests = { sfx: read(DIRS.sfx), music: read(DIRS.music) };
    const rows = listingOf(soundsOf(catalog), { ...manifests.sfx, ...manifests.music });
    const flagged = rows.flatMap((section) => section.rows.filter((row) => row.noisy));
    const ids = (list: readonly { readonly id: string }[]): string[] =>
      list.map(({ id }) => id).sort();
    expect(ids(flagged.map((row) => row.sound))).toEqual(ids(noisyTakes(catalog, manifests)));
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
    takes: {},
    takesNote: null,
    playing: null,
    loaded: (id) => id === 'key-click',
    selected: new Set(),
    keeping: {},
    envFile: ENV_FILE,
    command: null,
    copied: null,
    on: {
      play: () => undefined,
      playTake: () => undefined,
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
    const command = commandFor(['key-click']);
    const ticked = props({ playing: 'key-click', selected: new Set(['key-click']), command });
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
  const CALM_TAKES = { calm: [takeOf(1), takeOf(2, { misses: ['length'] })] };
  const props = (over: Partial<BoardProps> = {}): BoardProps => ({
    sections: listingOf([CLICK, CALM], { 'key-click': recording(1), calm: recording(1, 72_000) }),
    takes: CALM_TAKES,
    takesNote: null,
    playing: null,
    loaded: () => true,
    selected: new Set(),
    keeping: {},
    envFile: ENV_FILE,
    command: null,
    copied: null,
    on: {
      play: () => undefined,
      playTake: () => undefined,
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
    expect(html.match(/>Diesen Take behalten</g)).toHaveLength(2);
    const calm = html.slice(html.indexOf('<code class="sounds-id">calm</code>'));
    expect(calm).toContain('<ol class="sounds-take-list" aria-label="Takes von calm">');
    expect(calm).toContain('<span class="sounds-take-name">Take 1</span>');
    expect(calm).toContain(`<span class="sounds-facts">${takeFactsOf(takeOf(1))}</span>`);
    expect(html.match(/class="sounds-take sounds-take--fails"/g)).toHaveLength(1);
    expect(html).toContain('Neue Takes der Musik stehen unter ihrem Stück');
    // Nothing is chosen, so no command keeps anything.
    expect(html).not.toContain('--keep');
    const click = html.slice(0, html.indexOf('<code class="sounds-id">calm</code>'));
    expect(click).not.toContain('sounds-takes');
  });

  it('shows the command that keeps the take chosen, and plays a take as a recording', () => {
    const chosen = props({ keeping: { calm: 2 }, playing: takeKey('calm', 1) });
    const html = renderToStaticMarkup(<SoundsBoard {...chosen} />);
    expect(html).toContain('Im Ordner packages/client behält dieser Befehl Take 2');
    expect(html).toContain('<pre class="sounds-cli">node scripts/sfx.ts --keep calm=2</pre>');
    const keeps = [...html.matchAll(/class="sounds-keep" aria-pressed="(\w+)"/g)];
    expect(keeps.map((match) => match[1])).toEqual(['false', 'true']);
    const plays = [...html.matchAll(/class="sounds-play" aria-pressed="(\w+)"[^>]*>(\w+)</g)];
    expect(plays.map((match) => [match[1], match[2]])).toEqual([
      ['false', 'Abspielen'], // the click
      ['false', 'Abspielen'], // the calm stem as the game plays it
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
