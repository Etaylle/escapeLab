import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROSTER, type Roster } from '@escapelab/core';
import { readRoster, slotsOf as scriptSlots } from '../scripts/cast.js';
import { readManifest } from '../scripts/voice.js';
import { opensVoices, VOICES_PATH } from '../src/voices/path.js';
import {
  designCommandFor,
  keepCommandFor,
  linesByMoment,
  loadSamples,
  renderCommandFor,
  SAMPLES_BASE,
  sampleKey,
  samplesOf,
  sampleUrl,
  slotsOf,
  UNSERVED,
  type SamplesByDir,
} from '../src/voices/samples.js';
import { VoicesBoard, type VoicesBoardProps } from '../src/voices/VoicesBoard.js';
import { chooseSample } from '../src/voices/VoicesScreen.js';
import type { VoiceEntry, VoiceManifest } from '../src/world/radioVoice.js';
import { iconsAsWords } from './fixtures.js';

/**
 * The radio's cast on its audition page (/voices): every role and who can fill it, the samples
 * of a voice the dev server lists with the command that keeps one, and every rendered line by
 * its moment in the voice of whoever says it — the page shows commands and runs none.
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
  model: person === 'marta' ? 'eleven_v3' : 'eleven_v4',
  render: 'aaaaaaaaaaaa',
  file: `${person}-${text.length}.mp3`,
});

const MANIFEST: VoiceManifest = {
  lines: {
    'marta-1': entry('Notstrom steht.', 'marta', 'solved'),
    'helmut-1': entry('Notstrom steht.', 'helmut', 'solved'),
    'helmut-2': entry('Leitstelle an Nachtschicht.', 'helmut', 'start'),
    'kessler-1': entry('Noch fünf Minuten.', 'kessler', 'clock'),
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

/** Marta's three samples, the second kept; nobody else's. */
const SAMPLES: SamplesByDir = {
  'operator-marta': {
    samples: [1, 2, 3].map((n) => ({ n, file: `${n}.mp3`, seconds: 9 + n / 10 })),
    kept: 2,
  },
};

/** The roster as the page reads it, Marta's voice kept besides Helmut's. */
const KEPT: Roster = {
  ...ROSTER,
  operator: ROSTER.operator.map((p) =>
    p.id === 'marta' ? { ...p, voiceId: 'martaVoice0000000000', model: 'eleven_v3' } : p,
  ),
};

const board = (props: Partial<VoicesBoardProps> = {}): string =>
  iconsAsWords(
    renderToStaticMarkup(
      <VoicesBoard
        roster={KEPT}
        samples={SAMPLES}
        samplesNote={null}
        lines={linesByMoment(MANIFEST)}
        playing={null}
        keeping={{}}
        envFile={ENV}
        on={{ playSample: vi.fn(), playLine: vi.fn(), keep: vi.fn(), envFile: vi.fn() }}
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
      'operator:marta',
      'operator:jonas',
      'lead',
    ]);
  });

  it('gives the commands that design, keep and render, the key file quoted where needed', () => {
    expect(designCommandFor('operator:marta', ENV)).toBe(
      `node --env-file=${ENV} scripts/voice.ts --design operator:marta`,
    );
    expect(keepCommandFor('lead', 2, '/a b/.env.local')).toBe(
      "node --env-file='/a b/.env.local' scripts/voice.ts --keep lead=2",
    );
    expect(renderCommandFor(ENV)).toBe(
      `VOICE_ENGINE=elevenlabs node --env-file=${ENV} scripts/voice.ts --fresh`,
    );
    const url = sampleUrl('operator-marta', { file: '2.mp3' });
    expect(url).toBe('/takes/voices/operator-marta/2.mp3');
    expect(sampleKey('pa', 3)).toBe('pa#3');
    expect(chooseSample({}, 'pa', 2)).toEqual({ pa: 2 });
    expect(chooseSample({ pa: 2, lead: 1 }, 'pa', 2)).toEqual({ lead: 1 });
    expect(chooseSample({ pa: 2 }, 'pa', 3)).toEqual({ pa: 3 });
  });
});

describe('the samples the dev server lists', () => {
  it('reads each person’s samples and the one kept, leaving out what reads as none', () => {
    const lists = {
      'operator-marta': {
        role: 'operator',
        person: 'marta',
        samples: [
          { n: 1, file: '1.mp3', seconds: 9.1, generatedVoiceId: 'x' },
          { n: 2, file: '7.mp3', seconds: 9.2 },
          { n: 3, file: '3.mp3' },
        ],
        kept: { n: 1, voiceId: 'martaVoice0000000000' },
      },
      pa: { samples: [] },
      lead: 'nonsense',
    };
    expect(samplesOf(lists)).toEqual({
      'operator-marta': { samples: [{ n: 1, file: '1.mp3', seconds: 9.1 }], kept: 1 },
    });
    expect(samplesOf(null)).toEqual({});
  });

  it('asks the dev server for the lists alone, and says why where it serves none', async () => {
    const asked: string[] = [];
    const answer = (status: number, body: unknown) => (url: string) => {
      asked.push(url);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    };
    const pa = { samples: [{ n: 1, file: '1.mp3', seconds: 8 }] };
    vi.stubGlobal('fetch', vi.fn(answer(200, { pa })));
    expect(await loadSamples()).toEqual({
      kind: 'served',
      samples: { pa: { samples: [{ n: 1, file: '1.mp3', seconds: 8 }], kept: null } },
    });
    expect(asked).toEqual([SAMPLES_BASE]);
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
      ['solved', ['helmut-1', 'marta-1']],
      ['clock', ['kessler-1']],
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
  it('lists each role and who can fill it: their character, their prompt, their voice', () => {
    const html = board();
    for (const title of [
      'Durchsage · die Lautsprecher der Anlage',
      'Leitstelle · der Dienst am Funk',
      'Schichtleitung · die zweite Stimme, wenn es ernst wird',
    ]) {
      expect(html).toContain(`<h2>${title}</h2>`);
    }
    const marta = KEPT.operator[1];
    expect(html).toContain(`Marta: ${marta?.character ?? '!'}`);
    expect(html).toContain(marta?.prompt);
    expect(html).toContain('besetzt · eleven_v4');
    expect(html).toContain('besetzt · eleven_v3');
    expect(html.match(/noch ohne Stimme/g)).toHaveLength(3);
  });

  it('plays a person’s samples, marks the one kept, shows the design where there are none', () => {
    const html = board();
    expect(html).toContain('aria-label="Proben von Marta"');
    expect(html.match(/Diese Stimme besetzen/g)).toHaveLength(3);
    expect(html).toContain('Probe 2</span><span class="sounds-facts">9,2 s · besetzt</span>');
    // Jonas has no samples yet: the command that makes three, and no keep.
    expect(html).toContain(designCommandFor('operator:jonas', ENV));
    expect(html).not.toContain('--keep');
    expect(board({ playing: sampleKey('operator-marta', 3) })).toMatch(
      /aria-pressed="true">Stopp<\/button><span class="sounds-take-name">Probe 3/,
    );
    // Without the dev server, the page says why it plays none.
    expect(board({ samples: {}, samplesNote: UNSERVED })).toContain(UNSERVED);
  });

  it('shows the keep command under the sample chosen, and the render that puts it on duty', () => {
    const html = board({ keeping: { 'operator:marta': 3 } });
    expect(html).toContain(keepCommandFor('operator:marta', 3, ENV));
    expect(html).toContain(renderCommandFor(ENV));
    expect(html).toContain('macht dieser Befehl Probe 3 zur Stimme von Marta');
    expect(html).toContain('aria-pressed="true">Diese Stimme besetzen');
  });

  it('plays every rendered line by its moment, naming who says it and what made it', () => {
    const html = board();
    expect(html).toContain('Gesprochene Zeilen <span class="muted">(5)</span>');
    for (const moment of ['Start', 'Hinweis', 'Gelöst', 'Restzeit']) {
      expect(html).toContain(`<h3>${moment}</h3>`);
    }
    expect(html).toMatch(/Marta<\/code><span class="sounds-facts">2,4 s · eleven_v3<\/span>/);
    expect(html).toMatch(/Kessler<\/code><span class="sounds-facts">2,4 s · eleven_v4/);
    expect(html).toMatch(/Helmut<\/code><span class="sounds-facts">2,4 s · Mensch/);
    expect(html).toContain('<p class="sounds-prompt">Notstrom steht.</p>');
  });
});
