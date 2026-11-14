import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROSTER, type Roster } from '@escapelab/core';
import { readRoster, slotsOf as scriptSlots } from '../scripts/cast.js';
import { readManifest } from '../scripts/voice.js';
import { opensVoices, VOICES_PATH } from '../src/voices/path.js';
import {
  designCommandFor,
  keepCommandFor,
  LIBRARY_BASE,
  libraryOf,
  linesByMoment,
  loadSamples,
  previewKey,
  previewsCommandFor,
  previewUrl,
  renderCommandFor,
  SAMPLES_BASE,
  sampleKey,
  samplesOf,
  sampleUrl,
  slotsOf,
  UNSERVED,
  type LibraryVoice,
  type SamplesByDir,
} from '../src/voices/samples.js';
import { VoicesBoard, type VoicesBoardProps } from '../src/voices/VoicesBoard.js';
import { chooseVoice } from '../src/voices/VoicesScreen.js';
import type { VoiceEntry, VoiceManifest } from '../src/world/radioVoice.js';
import { iconsAsWords } from './fixtures.js';

/**
 * The radio's cast on its audition page (/voices): every role and who can fill it, the library
 * voices offered for each with their previews, the samples of a voice the dev server lists, the
 * command that keeps one, and every rendered line by its moment in the voice of whoever says it —
 * the page shows commands and runs none.
 */

const ENV = '/Users/uros/Documents/Req.Eng./escapelab/.env.local';

/** A line of the list, said by `person` at `moment`. */
const entry = (text: string, person: string, moment: VoiceEntry['moment']): VoiceEntry => ({
  text,
  ms: 2400,
  missions: ['blackout'],
  role: moment === 'clock' ? 'lead' : 'operator',
  person,
  moment,
  model: person === 'laura' ? 'eleven_v3' : 'eleven_v4',
  render: 'aaaaaaaaaaaa',
  file: `${person}-${text.length}.mp3`,
});

const MANIFEST: VoiceManifest = {
  lines: {
    'laura-1': entry('Notstrom steht.', 'laura', 'solved'),
    'helmut-1': entry('Notstrom steht.', 'helmut', 'solved'),
    'helmut-2': entry('Leitstelle an Nachtschicht.', 'helmut', 'start'),
    'mila-1': entry('Noch fünf Minuten.', 'mila', 'clock'),
    // Spoken on the /record page: a person's recording, no model's.
    'helmut-3': {
      text: 'Ein Funkspruch von Hand.',
      ms: 2400,
      missions: ['blackout'],
      role: 'operator',
      person: 'helmut',
      moment: 'nudge',
      source: 'human',
      file: 'helmut-3.m4a',
    },
  },
};

/** Laura's three samples, the second kept; nobody else's. */
const SAMPLES: SamplesByDir = {
  'operator-laura': {
    samples: [1, 2, 3].map((n) => ({ n, file: `${n}.mp3`, seconds: 9 + n / 10 })),
    kept: 2,
  },
};

/** A library voice offered for `slot`, its preview fetched where `preview`. */
const offer = (voiceId: string, name: string, slot: string, preview = true): LibraryVoice => ({
  voiceId,
  name,
  about: `${name.toLowerCase()} voice`,
  slot,
  preview,
});

/** Helmut's voice, kept; Laura's offered, its preview fetched; Mila's, not yet. */
const LIBRARY: readonly LibraryVoice[] = [
  offer('g1jpii0iyvtRs8fqXsd1', 'Trailer', 'operator:helmut'),
  offer('Qy4b2JlSGxY7I9M9Bqxb', 'Calm', 'operator:laura'),
  offer('dCnu06FiOZma2KVNUoPZ', 'Confident', 'lead', false),
];

/** The roster as the page reads it, Laura's voice kept besides Helmut's. */
const KEPT: Roster = {
  ...ROSTER,
  operator: ROSTER.operator.map((p) =>
    p.id === 'laura' ? { ...p, voiceId: 'lauraVoice0000000000', model: 'eleven_v3' } : p,
  ),
};

const board = (props: Partial<VoicesBoardProps> = {}): string =>
  iconsAsWords(
    renderToStaticMarkup(
      <VoicesBoard
        roster={KEPT}
        samples={SAMPLES}
        library={LIBRARY}
        samplesNote={null}
        lines={linesByMoment(MANIFEST)}
        playing={null}
        keeping={{}}
        envFile={ENV}
        on={{
          playSample: vi.fn(),
          playPreview: vi.fn(),
          playLine: vi.fn(),
          keep: vi.fn(),
          envFile: vi.fn(),
        }}
        {...props}
      />,
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the cast as the page names it', () => {
  it('opens at /voices, and only there', () => {
    expect(VOICES_PATH).toBe('/voices');
    expect([opensVoices('/voices'), opensVoices('/voices/')]).toEqual([true, true]);
    expect([opensVoices('/sounds'), opensVoices('/voice'), opensVoices('/')]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('names each person as the voice script’s command line does, and their folder', () => {
    const page = slotsOf(ROSTER).map(({ name, dir, role }) => [name, dir, role]);
    const script = scriptSlots(readRoster()).map(({ name, dir, role }) => [name, dir, role]);
    expect(page).toEqual(script);
    expect(page.map(([name]) => name)).toEqual([
      'pa',
      'operator:helmut',
      'operator:laura',
      'operator:ben',
      'lead',
    ]);
  });

  it('gives the commands that fetch, design, keep and render, the key file quoted', () => {
    const run = `node --env-file=${ENV} scripts/voice.ts`;
    expect(designCommandFor('operator:laura', ENV)).toBe(`${run} --design operator:laura`);
    expect(keepCommandFor('lead', 2, '/a b/.env.local')).toBe(
      "node --env-file='/a b/.env.local' scripts/voice.ts --keep lead=2",
    );
    expect(keepCommandFor('lead', 'dCnu06FiOZma2KVNUoPZ', ENV)).toBe(
      `${run} --keep lead=dCnu06FiOZma2KVNUoPZ`,
    );
    expect(previewsCommandFor(ENV)).toBe(`${run} --previews`);
    // The render a keep is followed by: the plain run, which keeps the takes there.
    expect(renderCommandFor(ENV)).toBe(`VOICE_ENGINE=elevenlabs ${run}`);
    const sample = sampleUrl('operator-laura', { file: '2.mp3' });
    const urls = [sample, previewUrl('Qy4b2JlSGxY7I9M9Bqxb')];
    expect(urls).toEqual([
      '/takes/voices/operator-laura/2.mp3',
      '/takes/voices/library/Qy4b2JlSGxY7I9M9Bqxb.mp3',
    ]);
    expect([sampleKey('pa', 3), previewKey('Qy4b2JlSGxY7I9M9Bqxb')]).toEqual([
      'pa#3',
      'library#Qy4b2JlSGxY7I9M9Bqxb',
    ]);
    // A choice is a sample's number or a library voice's id; the same one again lets it go.
    expect(chooseVoice({}, 'pa', 2)).toEqual({ pa: 2 });
    expect(chooseVoice({ pa: 2, lead: 1 }, 'pa', 2)).toEqual({ lead: 1 });
    expect(chooseVoice({ pa: 2 }, 'pa', 'OCDYul75SEKSUI3jtFCT')).toEqual({
      pa: 'OCDYul75SEKSUI3jtFCT',
    });
  });
});

describe('the samples and the library voices the dev server lists', () => {
  it('reads each person’s samples and the one kept, leaving out what reads as none', () => {
    const lists = {
      'operator-laura': {
        role: 'operator',
        person: 'laura',
        samples: [
          { n: 1, file: '1.mp3', seconds: 9.1, generatedVoiceId: 'x' },
          { n: 2, file: '7.mp3', seconds: 9.2 },
          { n: 3, file: '3.mp3' },
        ],
        kept: { n: 1, voiceId: 'lauraVoice0000000000' },
      },
      pa: { samples: [] },
      lead: 'nonsense',
    };
    expect(samplesOf(lists)).toEqual({
      'operator-laura': { samples: [{ n: 1, file: '1.mp3', seconds: 9.1 }], kept: 1 },
    });
    expect(samplesOf(null)).toEqual({});
    // The library voices as listed; what does not read as one is left out.
    const listed = { library: [LIBRARY[1], { voiceId: 'x' }, 'nonsense'] };
    expect(libraryOf(listed)).toEqual([LIBRARY[1]]);
    expect([libraryOf(null), libraryOf({ library: 'none' })]).toEqual([[], []]);
  });

  it('asks the dev server for the lists alone, and says why where it serves none', async () => {
    const asked: string[] = [];
    const answer = (status: number, body: unknown) => (url: string) => {
      asked.push(url);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    };
    const pa = { samples: [{ n: 1, file: '1.mp3', seconds: 8 }] };
    const lists = (url: string) => (url === LIBRARY_BASE ? { library: [LIBRARY[0]] } : { pa });
    vi.stubGlobal('fetch', vi.fn((url: string) => answer(200, lists(url))(url)));
    expect(await loadSamples()).toEqual({
      kind: 'served',
      samples: { pa: { samples: [{ n: 1, file: '1.mp3', seconds: 8 }], kept: null } },
      library: [LIBRARY[0]],
    });
    expect(asked.sort()).toEqual([SAMPLES_BASE, LIBRARY_BASE].sort());
    vi.stubGlobal('fetch', vi.fn(answer(404, {})));
    expect(await loadSamples()).toEqual({ kind: 'unserved', why: UNSERVED });
    expect(UNSERVED).toBe('Stimmproben liefert nur der Entwicklungsserver (pnpm dev).');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await loadSamples()).toEqual({
      kind: 'unserved',
      why: 'Die Stimmproben ließen sich nicht laden: offline',
    });
  });
});

describe('the rendered lines', () => {
  it('stand by their moment in a run’s order, the cast’s takes of one line together', () => {
    const groups = linesByMoment(MANIFEST);
    expect(groups.map(({ moment, lines }) => [moment, lines.map(({ id }) => id)])).toEqual([
      ['start', ['helmut-2']],
      ['nudge', ['helmut-3']],
      ['solved', ['helmut-1', 'laura-1']],
      ['clock', ['mila-1']],
    ]);
    expect(linesByMoment({ lines: {} })).toEqual([]);
  });

  it('are every line of the shipped list, each once', () => {
    const shipped = readManifest();
    const listed = linesByMoment(shipped).flatMap(({ lines }) => lines.map(({ id }) => id));
    expect(listed.sort()).toEqual(Object.keys(shipped.lines).sort());
  });
});

describe('the page', () => {
  it('lists each role and who can fill it: their character and their voice', () => {
    const html = board();
    for (const title of [
      'Durchsage · die Lautsprecher der Anlage',
      'Leitstelle · der Dienst am Funk',
      'Schichtleitung · die zweite Stimme, wenn es ernst wird',
    ]) {
      expect(html).toContain(`<h2>${title}</h2>`);
    }
    const laura = KEPT.operator[1];
    expect(html).toContain(`Laura: ${laura?.character ?? '!'}`);
    expect(html).toContain('besetzt · eleven_v4');
    expect(html).toContain('besetzt · eleven_v3');
    expect(html.match(/noch ohne Stimme/g)).toHaveLength(3);
  });

  it('plays a person’s samples, marks the one kept, shows the design where there are none', () => {
    const html = board({ library: [] });
    expect(html).toContain('aria-label="Proben von Laura"');
    expect(html.match(/Diese Stimme besetzen/g)).toHaveLength(3);
    expect(html).toContain('Probe 2</span><span class="sounds-facts">9,2 s · besetzt</span>');
    // Ben has no samples yet: the command that makes three, and no keep.
    expect(html).toContain(designCommandFor('operator:ben', ENV));
    expect(html).not.toContain('--keep');
    expect(html).toContain('Noch keine Proben aus Voice Design. Drei macht dieser Befehl:');
    expect(board({ playing: sampleKey('operator-laura', 3) })).toMatch(
      /aria-pressed="true">Stopp<\/button><span class="sounds-take-name">Probe 3/,
    );
    // Without the dev server, the page says why it plays none.
    expect(board({ samples: {}, samplesNote: UNSERVED })).toContain(UNSERVED);
  });

  it('shows the keep command under the sample chosen, and the render that puts it on duty', () => {
    const html = board({ keeping: { 'operator:laura': 3 } });
    expect(html).toContain(keepCommandFor('operator:laura', 3, ENV));
    expect(html).toContain(renderCommandFor(ENV));
    expect(html).toContain('macht dieser Befehl Probe 3 zur Stimme von Laura');
    expect(html).toContain('aria-pressed="true">Diese Stimme besetzen');
  });

  it('plays every rendered line by its moment, naming who says it and what made it', () => {
    const html = board();
    expect(html).toContain('Gesprochene Zeilen <span class="muted">(5)</span>');
    for (const moment of ['Start', 'Hinweis', 'Gelöst', 'Restzeit']) {
      expect(html).toContain(`<h3>${moment}</h3>`);
    }
    expect(html).toMatch(/Laura<\/code><span class="sounds-facts">2,4 s · eleven_v3<\/span>/);
    expect(html).toMatch(/Mila<\/code><span class="sounds-facts">2,4 s · eleven_v4/);
    expect(html).toMatch(/Helmut<\/code><span class="sounds-facts">2,4 s · Mensch/);
    expect(html).toContain('<p class="sounds-prompt">Notstrom steht.</p>');
  });
});

describe('the library voices on the page', () => {
  it('offers each person the voices picked for them, each with its preview or none yet', () => {
    const html = board();
    for (const name of ['Helmut', 'Laura', 'Mila']) {
      expect(html).toContain(`aria-label="Bibliotheksstimmen für ${name}"`);
    }
    // Helmut speaks with his already: no keep beside it.
    expect(html).toContain(
      'Trailer</span><span class="sounds-facts">trailer voice · besetzt</span></li>',
    );
    // Laura's plays; Mila's is not fetched yet, and the command that fetches it says so.
    expect(html).toMatch(/Abspielen<\/button><span class="sounds-take-name">Calm</);
    expect(html).toMatch(/Hörprobe fehlt<\/span><span class="sounds-take-name">Confident</);
    expect(html.match(/Hörproben der Bibliothek holt dieser Befehl/g)).toHaveLength(1);
    expect(html).toContain(previewsCommandFor(ENV));
    expect(board({ playing: previewKey('Qy4b2JlSGxY7I9M9Bqxb') })).toMatch(
      /aria-pressed="true">Stopp<\/button><span class="sounds-take-name">Calm/,
    );
    // Without the dev server no voice is listed.
    expect(board({ library: [] })).not.toContain('Bibliotheksstimmen');
  });

  it('shows the keep command for a library voice chosen, without credits, and the render', () => {
    const html = board({ keeping: { lead: 'dCnu06FiOZma2KVNUoPZ' } });
    expect(html).toContain(keepCommandFor('lead', 'dCnu06FiOZma2KVNUoPZ', ENV));
    expect(html).toContain(
      'macht dieser Befehl „Confident“ zur Stimme von Mila, in der Besetzung — ohne Credits, ' +
        'die Stimme ist schon im Konto:',
    );
    expect(html).toContain(renderCommandFor(ENV));
  });

  it('keeps over takes the person has with --replace, saying so, and plainly where none', () => {
    const ben = offer('aTTiK3YzK3dXETpuDE2h', 'Casual', 'operator:ben');
    const kept = offer('5KvpaGteYkNayiswuX2h', 'Distinctive', 'operator:helmut');
    const library = [...LIBRARY, ben, kept];
    const keeping = { 'operator:helmut': kept.voiceId, 'operator:ben': ben.voiceId };
    const html = board({ library, keeping });
    // Helmut has two takes a voice made (and one by hand, which stays): they go stale.
    expect(html).toContain(keepCommandFor('operator:helmut', kept.voiceId, ENV, true));
    expect(html).toContain('Mit --replace gibt Helmut die 2 Aufnahmen der bisherigen Stimme ab');
    // Ben has none: his keep needs nothing more.
    expect(html).toContain(`${keepCommandFor('operator:ben', ben.voiceId, ENV)}</pre>`);
    expect(html.match(/Mit --replace gibt/g)).toHaveLength(1);
  });

  it('says that the desk speaks for the Schichtleitung while it has no voice', () => {
    const note = 'Bis hier eine Stimme besetzt ist, spricht die Leitstelle im Dienst diese Zeilen.';
    expect(board().match(new RegExp(note, 'g'))).toHaveLength(1);
    const voice = { voiceId: 'dCnu06FiOZma2KVNUoPZ', model: 'eleven_v4' };
    const led: Roster = { ...KEPT, lead: KEPT.lead.map((p) => ({ ...p, ...voice })) };
    expect(board({ roster: led })).not.toContain(note);
  });
});
