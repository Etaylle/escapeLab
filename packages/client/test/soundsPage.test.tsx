import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MAX_GAIN, readCatalog } from '../scripts/sfx.js';
import {
  CANDIDATES,
  commandFor,
  ENV_FILE,
  listingOf,
  QUIET_GAIN,
  SECTIONS,
  shellWord,
  soundsOf,
  type CatalogSound,
} from '../src/sounds/listing.js';
import { opensSounds, SOUNDS_PATH } from '../src/sounds/path.js';
import { factsOf, SoundsBoard, type BoardProps } from '../src/sounds/SoundsBoard.js';
import type { SampleEntry } from '../src/world/samples.js';

/**
 * The audition page (/sounds): what it lists, what it says of each recording, and the command it
 * puts together for the user — no request leaves the page.
 */

const recording = (gain: number, ms = 480): SampleEntry => ({
  file: 'x.mp3',
  ms,
  gain,
  startMs: 0,
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
    ]);
    const listed = sections.flatMap((section) => section.rows.map((row) => row.sound.id));
    expect(listed.sort()).toEqual(catalog.map((sound) => sound.id).sort());
    expect(catalog).toHaveLength(readCatalog().length);
    for (const section of sections) {
      expect(section.rows.every((row) => row.sound.kind === section.kind)).toBe(true);
    }
    expect(SECTIONS.map((section) => section.kind)).toEqual(['oneshot', 'bed', 'stem', 'sting']);
  });

  it('gives each sound its recording, and calls one too quiet as the sound script does', () => {
    expect(QUIET_GAIN).toEqual(MAX_GAIN);
    const [effects, loops, music] = listingOf([CLICK, HUM, CALM], {
      'key-click': recording(6.5),
      'mains-hum': recording(4, 6000),
    });
    expect(effects?.rows[0]).toMatchObject({ quiet: true, recording: { gain: 6.5 } });
    expect(loops?.rows[0]).toMatchObject({ quiet: false });
    expect(music?.rows[0]).toEqual({ sound: CALM, recording: null, quiet: false });
  });

  it('reads only the kinds it knows from the catalog', () => {
    const odd = { ...CLICK, id: 'odd', kind: 'jingle' };
    expect(soundsOf([CLICK, odd]).map((sound) => sound.id)).toEqual(['key-click']);
  });

  it('says of a recording its length, its gain, a loop and too quiet, in German', () => {
    const [effects, loops] = listingOf([CLICK, HUM], {
      'key-click': recording(8.25),
      'mains-hum': recording(0.19, 6000),
    });
    const quiet = '0,5 s · Verstärkung 8,25× · zu leise (über 6×)';
    expect(factsOf(effects?.rows[0] as never)).toBe(quiet);
    expect(factsOf(loops?.rows[0] as never)).toBe('6,0 s · Verstärkung 0,19× · Schleife');
    const [none] = listingOf([CLICK], {});
    expect(factsOf(none?.rows[0] as never)).toBe('keine Aufnahme');
  });
});

describe('the board', () => {
  const props = (over: Partial<BoardProps> = {}): BoardProps => ({
    sections: listingOf([CLICK, HUM], { 'key-click': recording(8.25), 'mains-hum': recording(1) }),
    playing: null,
    loaded: (id) => id === 'key-click',
    selected: new Set(),
    envFile: ENV_FILE,
    command: null,
    copied: null,
    on: {
      play: () => undefined,
      toggle: () => undefined,
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
    expect(html).toContain('sounds-row sounds-row--quiet');
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
