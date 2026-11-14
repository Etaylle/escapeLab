import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import { rosterSchema } from '@escapelab/core';
import { ELEVEN_FORMAT, type DesignClient } from '../scripts/elevenlabs.js';
import {
  CAST_FILE,
  DESIGN_MODEL,
  DESIGN_TEXT,
  DESIGNED_READS,
  designVoice,
  keepVoice,
  readRoster,
  readSamples,
  ROLES,
  SAMPLES_DIR,
  slotOf,
  slotsOf,
  voiceless,
} from '../scripts/cast.js';

/**
 * The cast's voices before they are kept (scripts/cast.ts): every person named on the command
 * line, three samples of a person's voice from their prompt, one of them kept in a roster of the
 * test's own — every request to a client of the test's own. Nothing here loads the SDK.
 */

// Were anything here to make a real client, the SDK would load: it may not.
const sdkLoaded = vi.hoisted(() => ({ times: 0 }));
vi.mock('@elevenlabs/elevenlabs-js', () => {
  sdkLoaded.times += 1;
  return {};
});

const roster = readRoster();

describe('the persons of the cast, as the command line names them', () => {
  it('names a role with one person by the role, and one with several by role and id', () => {
    expect(slotsOf(roster).map(({ name, dir }) => [name, dir])).toEqual([
      ['pa', 'pa'],
      ['operator:helmut', 'operator-helmut'],
      ['operator:marta', 'operator-marta'],
      ['operator:jonas', 'operator-jonas'],
      ['lead', 'lead'],
    ]);
    expect(slotOf(roster, 'operator:marta').person.name).toBe('Marta');
    expect(slotOf(roster, 'pa').person.id).toBe('anlage');
    // A role's one person by role and id as well.
    expect(slotOf(roster, 'lead:kessler').name).toBe('lead');
  });

  it('refuses a name of nobody, a role of several and nothing, naming everybody', () => {
    const everybody = /pa, operator:helmut, operator:marta, operator:jonas, lead/;
    expect(() => slotOf(roster, 'operator')).toThrow(everybody);
    expect(() => slotOf(roster, 'operator:nina')).toThrow(/"operator:nina" names nobody/);
    expect(() => slotOf(roster, undefined)).toThrow(everybody);
  });

  it('says what to run for a person without a voice: the design, then the keep', () => {
    const said = voiceless(slotOf(roster, 'lead'));
    expect(said).toMatch(/Kessler \(lead\) has no voice yet/);
    expect(said).toContain('scripts/voice.ts --design lead');
    expect(said).toContain('scripts/voice.ts --keep lead=<n>');
  });
});

describe('a person’s voice, made from their prompt (Voice Design)', () => {
  let dir = '';
  let cast = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'escapelab-cast-'));
    cast = join(dir, 'cast.json');
    copyFileSync(CAST_FILE, cast);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A client of the test's own: three samples a time, a voice made of one; what it was asked. */
  function designer(voiceId = 'madeVoice00000000000') {
    const asked: unknown[] = [];
    let round = 0;
    const client: DesignClient = {
      textToVoice: {
        design: (request: ElevenLabs.VoiceDesignRequestModel) => {
          asked.push(request);
          round += 1;
          const previews = [1, 2, 3].map((n) => ({
            audioBase64: Buffer.from(`mp3 ${round}.${n}`).toString('base64'),
            generatedVoiceId: `preview${round}${n}00000000000`,
            mediaType: 'audio/mpeg',
            durationSecs: 9 + n / 10,
          }));
          return Promise.resolve({ previews, text: request.text ?? '' });
        },
        create: (request: ElevenLabs.BodyCreateANewVoiceFromVoicePreviewV1TextToVoicePost) => {
          asked.push(request);
          return Promise.resolve({ voiceId, name: request.voiceName });
        },
      },
    };
    return { client, asked };
  }

  const marta = slotOf(roster, 'operator:marta');
  const NOW = (): Date => new Date('2026-11-14T08:00:00.000Z');

  it('asks once for three samples, from the person’s prompt and the role’s text', async () => {
    const { client, asked } = designer();
    const made = await designVoice(client, marta, dir, NOW);
    expect(asked).toEqual([
      {
        voiceDescription: marta.person.prompt,
        modelId: DESIGN_MODEL,
        text: DESIGN_TEXT.operator,
        outputFormat: ELEVEN_FORMAT,
      },
    ]);
    expect(DESIGN_MODEL).toBe('eleven_ttv_v3');
    expect(made.map(({ n, file, generatedVoiceId }) => [n, file, generatedVoiceId])).toEqual([
      [1, '1.mp3', 'preview1100000000000'],
      [2, '2.mp3', 'preview1200000000000'],
      [3, '3.mp3', 'preview1300000000000'],
    ]);
    const folder = join(dir, 'operator-marta');
    expect(readFileSync(join(folder, '2.mp3'), 'utf8')).toBe('mp3 1.2');
    expect(readSamples(folder)).toEqual({
      role: 'operator',
      person: 'marta',
      samples: made,
    });
    expect(made[0]).toMatchObject({
      seconds: 9.1,
      prompt: marta.person.prompt,
      text: DESIGN_TEXT.operator,
      model: DESIGN_MODEL,
      madeAt: '2026-11-14T08:00:00.000Z',
    });
  });

  it('numbers a second design on after the first, and keeps both in the list', async () => {
    const { client } = designer();
    await designVoice(client, marta, dir, NOW);
    const more = await designVoice(client, marta, dir, NOW);
    expect(more.map(({ n }) => n)).toEqual([4, 5, 6]);
    const list = readSamples(join(dir, 'operator-marta'));
    expect(list?.samples.map(({ n }) => n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(readFileSync(join(dir, 'operator-marta', '5.mp3'), 'utf8')).toBe('mp3 2.2');
  });

  it('has each role say a few of its own lines, as long as a design takes', () => {
    for (const role of ROLES) {
      expect(DESIGN_TEXT[role].length, role).toBeGreaterThanOrEqual(100);
      expect(DESIGN_TEXT[role].length, role).toBeLessThanOrEqual(1000);
    }
    expect(DESIGN_TEXT.lead).toMatch(/Noch fünf Minuten/);
  });

  it('keeps a sample as the person’s voice, in the roster, reading with Eleven v3', async () => {
    const { client, asked } = designer();
    await designVoice(client, marta, dir, NOW);
    asked.length = 0;
    const kept = await keepVoice(client, marta, 2, { samples: dir, cast });
    expect(asked).toEqual([
      {
        voiceName: 'EscapeLab Marta',
        voiceDescription: marta.person.prompt,
        generatedVoiceId: 'preview1200000000000',
      },
    ]);
    expect(kept).toEqual({ ...marta.person, voiceId: 'madeVoice00000000000', model: 'eleven_v3' });
    expect(DESIGNED_READS).toBe('eleven_v3');
    // The roster as core reads it: Marta kept, everybody else as they were, core's schema met.
    const after = readRoster(cast);
    expect(after.operator.map(({ id, voiceId }) => [id, voiceId])).toEqual([
      ['helmut', 'g1jpii0iyvtRs8fqXsd1'],
      ['marta', 'madeVoice00000000000'],
      ['jonas', undefined],
    ]);
    expect({ ...after, operator: roster.operator }).toEqual(roster);
    expect(rosterSchema.safeParse(after).success).toBe(true);
    expect(readFileSync(cast, 'utf8')).toMatch(/\n {2}"pa": \[\n/);
    // The sample kept is marked in its list, the others stay to be heard again.
    const list = readSamples(join(dir, 'operator-marta'));
    expect(list?.kept).toEqual({ n: 2, voiceId: 'madeVoice00000000000' });
    expect(list?.samples).toHaveLength(3);
  });

  it('refuses a sample it has not, or one whose file is gone, before asking anything', async () => {
    const { client, asked } = designer();
    await expect(keepVoice(client, marta, 1, { samples: dir, cast })).rejects.toThrow(
      /operator:marta has no sample 1 \(it has none\) — --design operator:marta makes three/,
    );
    await designVoice(client, marta, dir, NOW);
    asked.length = 0;
    await expect(keepVoice(client, marta, 7, { samples: dir, cast })).rejects.toThrow(
      /has no sample 7 \(it has 1, 2, 3\)/,
    );
    rmSync(join(dir, 'operator-marta', '3.mp3'));
    await expect(keepVoice(client, marta, 3, { samples: dir, cast })).rejects.toThrow(
      /the sample 3 of operator:marta is gone/,
    );
    expect(asked).toEqual([]);
    expect(readFileSync(cast, 'utf8')).toBe(readFileSync(CAST_FILE, 'utf8'));
  });

  it('writes nothing where ElevenLabs answers with no voice id at all', async () => {
    const { client } = designer('../not-a-voice');
    await designVoice(client, marta, dir, NOW);
    await expect(keepVoice(client, marta, 1, { samples: dir, cast })).rejects.toThrow(
      /made the voice "..\/not-a-voice", which is no voice id/,
    );
    expect(readFileSync(cast, 'utf8')).toBe(readFileSync(CAST_FILE, 'utf8'));
    expect(readSamples(join(dir, 'operator-marta'))?.kept).toBeUndefined();
  });

  it('leaves the samples to a folder git ignores, and makes no real client doing any of it', () => {
    const ignored = readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8');
    expect(SAMPLES_DIR).toMatch(/packages\/client\/takes\/voices$/);
    expect(ignored).toMatch(/^packages\/client\/takes\/?$/m);
    expect(sdkLoaded.times).toBe(0);
  });
});
