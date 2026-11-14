import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import { rosterSchema } from '@escapelab/core';
import {
  ELEVEN_FORMAT,
  type DesignClient,
  type SpeechClient,
  type VoiceInfo,
} from '../scripts/elevenlabs.js';
import {
  CAST_FILE,
  DESIGN_MODEL,
  DESIGN_TEXT,
  DESIGNED_READS,
  designVoice,
  fetchPreviews,
  keepLibraryVoice,
  keepVoice,
  LIBRARY_DIR,
  LIBRARY_READS,
  promptOf,
  readCasting,
  readRoster,
  readSamples,
  ROLES,
  SAMPLES_DIR,
  slotOf,
  slotsOf,
  VOICE_ID,
  voiceless,
} from '../scripts/cast.js';
import {
  choiceOf,
  dropTakes,
  entryOf,
  readManifest,
  refuseStale,
  remakeCharacters,
  shippedLines,
  staleTakes,
} from '../scripts/voice.js';

/**
 * The cast's voices before they are kept (scripts/cast.ts): every person named on the command
 * line, how each voice is asked for (casting.json: the prompts, the owner's library voices), three
 * samples of a person's voice from their prompt, one of them — or a library voice — kept in a
 * roster of the test's own, the library voices' previews fetched — every request to a client of
 * the test's own. Nothing here loads the SDK.
 */

// Were anything here to make a real client, the SDK would load: it may not.
const sdkLoaded = vi.hoisted(() => ({ times: 0 }));
vi.mock('@elevenlabs/elevenlabs-js', () => {
  sdkLoaded.times += 1;
  return {};
});

const roster = readRoster();
const casting = readCasting();

describe('the persons of the cast, as the command line names them', () => {
  it('names a role with one person by the role, and one with several by role and id', () => {
    expect(slotsOf(roster).map(({ name, dir }) => [name, dir])).toEqual([
      ['pa', 'pa'],
      ['operator:helmut', 'operator-helmut'],
      ['operator:laura', 'operator-laura'],
      ['operator:ben', 'operator-ben'],
      ['lead', 'lead'],
    ]);
    expect(slotOf(roster, 'operator:laura').person.name).toBe('Laura');
    expect(slotOf(roster, 'pa').person.id).toBe('anlage');
    // A role's one person by role and id as well.
    expect(slotOf(roster, 'lead:mila').name).toBe('lead');
  });

  it('refuses a name of nobody, a role of several and nothing, naming everybody', () => {
    const everybody = /pa, operator:helmut, operator:laura, operator:ben, lead/;
    expect(() => slotOf(roster, 'operator')).toThrow(everybody);
    expect(() => slotOf(roster, 'operator:nina')).toThrow(/"operator:nina" names nobody/);
    expect(() => slotOf(roster, undefined)).toThrow(everybody);
  });

  it('says what to run for a person without a voice: a library voice, or a design kept', () => {
    const said = voiceless(slotOf(roster, 'lead'));
    expect(said).toMatch(/Mila \(lead\) has no voice yet/);
    expect(said).toContain('voice --keep lead=<voice id>');
    expect(said).toContain('voice --design lead  then  ');
    expect(said).toContain('voice --keep lead=<n>');
  });
});

describe('how a voice is asked for (casting.json)', () => {
  it('has a Voice-Design prompt in English for every person of the cast', () => {
    const slots = slotsOf(roster);
    expect(Object.keys(casting.prompts).sort()).toEqual(slots.map((s) => s.person.id).sort());
    for (const slot of slots) {
      const prompt = promptOf(casting, slot);
      // Voice Design takes a description of 20 to 1,000 characters.
      expect(prompt.length, slot.name).toBeGreaterThanOrEqual(20);
      expect(prompt.length, slot.name).toBeLessThanOrEqual(1000);
      expect(prompt, slot.name).toMatch(/German/);
      expect(prompt, slot.name).toMatch(/studio recording without background noise/);
    }
    const person = { id: 'niemand', name: 'N', character: '' };
    const nobody = { ...slotOf(roster, 'lead'), person };
    expect(() => promptOf(casting, nobody)).toThrow(/no prompt for niemand \(lead\)/);
  });

  it('offers the owner’s seven library voices, each for a person of the cast', () => {
    const names = new Set(slotsOf(roster).map((slot) => slot.name));
    const ids = casting.library.map((voice) => voice.voiceId);
    expect(new Set(ids).size).toBe(7);
    for (const voice of casting.library) {
      expect(voice.voiceId, voice.name).toMatch(VOICE_ID);
      expect(names.has(voice.slot), voice.name).toBe(true);
    }
    const offered = (slot: string) =>
      casting.library.filter((voice) => voice.slot === slot).map((voice) => voice.voiceId);
    // Helmut keeps the voice he has, with another of his name beside it; Laura, Ben and Mila
    // each the voice they are named for; the plant two, beside a voice of its own design.
    expect(offered('operator:helmut')).toEqual(['g1jpii0iyvtRs8fqXsd1', '5KvpaGteYkNayiswuX2h']);
    expect(roster.operator[0]?.voiceId).toBe('g1jpii0iyvtRs8fqXsd1');
    expect([offered('operator:laura'), offered('operator:ben'), offered('lead')]).toEqual([
      ['Qy4b2JlSGxY7I9M9Bqxb'],
      ['aTTiK3YzK3dXETpuDE2h'],
      ['dCnu06FiOZma2KVNUoPZ'],
    ]);
    expect(offered('pa')).toEqual(['OCDYul75SEKSUI3jtFCT', 'rAmra0SCIYOxYmRNDSm3']);
  });

  it('stays out of the game: no module of the client or of core imports it', () => {
    const imports = /from ['"][^'"]*casting\.json['"]/;
    const reading = ['../src', '../../core/src'].flatMap((folder) => {
      const root = fileURLToPath(new URL(folder, import.meta.url));
      return readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter((file) => /\.(ts|tsx)$/.test(file))
        .filter((file) => imports.test(readFileSync(join(root, file), 'utf8')));
    });
    expect(reading).toEqual([]);
    expect(imports.test("import casting from '../scripts/casting.json';")).toBe(true);
  });
});

/** The scratch folder a test's samples go to, and the copy of the roster a keep writes. */
let dir = '';
let cast = '';

/** A scratch folder with a copy of the roster for each test of the group, gone after it. */
function inScratch(): void {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'escapelab-cast-'));
    cast = join(dir, 'cast.json');
    copyFileSync(CAST_FILE, cast);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

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

const laura = slotOf(roster, 'operator:laura');
const PROMPT = promptOf(casting, laura);
const NOW = (): Date => new Date('2026-11-14T08:00:00.000Z');

describe('a person’s voice, made from their prompt (Voice Design)', () => {
  inScratch();

  it('asks once for three samples, from the person’s prompt and the role’s text', async () => {
    const { client, asked } = designer();
    const made = await designVoice(client, laura, PROMPT, dir, NOW);
    expect(asked).toEqual([
      {
        voiceDescription: PROMPT,
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
    const folder = join(dir, 'operator-laura');
    expect(readFileSync(join(folder, '2.mp3'), 'utf8')).toBe('mp3 1.2');
    expect(readSamples(folder)).toEqual({ role: 'operator', person: 'laura', samples: made });
    expect(made[0]).toMatchObject({
      seconds: 9.1,
      prompt: PROMPT,
      text: DESIGN_TEXT.operator,
      model: DESIGN_MODEL,
      madeAt: '2026-11-14T08:00:00.000Z',
    });
  });

  it('numbers a second design on after the first, and keeps both in the list', async () => {
    const { client } = designer();
    await designVoice(client, laura, PROMPT, dir, NOW);
    const more = await designVoice(client, laura, PROMPT, dir, NOW);
    expect(more.map(({ n }) => n)).toEqual([4, 5, 6]);
    const list = readSamples(join(dir, 'operator-laura'));
    expect(list?.samples.map(({ n }) => n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(readFileSync(join(dir, 'operator-laura', '5.mp3'), 'utf8')).toBe('mp3 2.2');
  });

  it('has each role say a few of its own lines, as long as a design takes', () => {
    for (const role of ROLES) {
      expect(DESIGN_TEXT[role].length, role).toBeGreaterThanOrEqual(100);
      expect(DESIGN_TEXT[role].length, role).toBeLessThanOrEqual(1000);
    }
    expect(DESIGN_TEXT.lead).toMatch(/Noch fünf Minuten/);
  });
});

describe('a sample kept as the person’s voice (--keep)', () => {
  inScratch();

  it('keeps a sample as the person’s voice, in the roster, reading with Eleven v3', async () => {
    const { client, asked } = designer();
    await designVoice(client, laura, PROMPT, dir, NOW);
    asked.length = 0;
    const kept = await keepVoice(client, laura, 2, { samples: dir, cast });
    expect(asked).toEqual([
      {
        voiceName: 'EscapeLab Laura',
        voiceDescription: PROMPT,
        generatedVoiceId: 'preview1200000000000',
      },
    ]);
    expect(kept).toEqual({ ...laura.person, voiceId: 'madeVoice00000000000', model: 'eleven_v3' });
    expect(DESIGNED_READS).toBe('eleven_v3');
    // The roster as core reads it: Laura kept, everybody else as they were, core's schema met.
    const after = readRoster(cast);
    expect(after.operator.map(({ id, voiceId }) => [id, voiceId])).toEqual([
      ['helmut', 'g1jpii0iyvtRs8fqXsd1'],
      ['laura', 'madeVoice00000000000'],
      ['ben', undefined],
    ]);
    expect({ ...after, operator: roster.operator }).toEqual(roster);
    expect(rosterSchema.safeParse(after).success).toBe(true);
    expect(readFileSync(cast, 'utf8')).toMatch(/\n {2}"pa": \[\n/);
    // The sample kept is marked in its list, the others stay to be heard again.
    const list = readSamples(join(dir, 'operator-laura'));
    expect(list?.kept).toEqual({ n: 2, voiceId: 'madeVoice00000000000' });
    expect(list?.samples).toHaveLength(3);
  });

  it('refuses a sample it has not, or one whose file is gone, before asking anything', async () => {
    const { client, asked } = designer();
    await expect(keepVoice(client, laura, 1, { samples: dir, cast })).rejects.toThrow(
      /operator:laura has no sample 1 \(it has none\) — --design operator:laura makes three/,
    );
    await designVoice(client, laura, PROMPT, dir, NOW);
    asked.length = 0;
    await expect(keepVoice(client, laura, 7, { samples: dir, cast })).rejects.toThrow(
      /has no sample 7 \(it has 1, 2, 3\)/,
    );
    rmSync(join(dir, 'operator-laura', '3.mp3'));
    await expect(keepVoice(client, laura, 3, { samples: dir, cast })).rejects.toThrow(
      /the sample 3 of operator:laura is gone/,
    );
    expect(asked).toEqual([]);
    expect(readFileSync(cast, 'utf8')).toBe(readFileSync(CAST_FILE, 'utf8'));
  });

  it('writes nothing where ElevenLabs answers with no voice id at all', async () => {
    const { client } = designer('../not-a-voice');
    await designVoice(client, laura, PROMPT, dir, NOW);
    await expect(keepVoice(client, laura, 1, { samples: dir, cast })).rejects.toThrow(
      /made the voice "..\/not-a-voice", which is no voice id/,
    );
    expect(readFileSync(cast, 'utf8')).toBe(readFileSync(CAST_FILE, 'utf8'));
    expect(readSamples(join(dir, 'operator-laura'))?.kept).toBeUndefined();
  });
});

/** An account of the test's own with `voices`, and how often its voices were asked for. */
function account(voices: readonly VoiceInfo[]) {
  let asked = 0;
  const fail = () => Promise.reject(new Error('no call'));
  const client: SpeechClient = {
    voices: {
      getAll: () => {
        asked += 1;
        return Promise.resolve({ voices });
      },
    },
    textToSpeech: { convert: fail },
  };
  return { client, asked: () => asked };
}

/** Laura's library voice as the account lists it, its preview at a file of ElevenLabs' own. */
const LAURA = {
  voiceId: 'Qy4b2JlSGxY7I9M9Bqxb',
  name: 'Laura - Calm and Smooth',
  previewUrl: 'https://storage.example/voices/Qy4b2JlSGxY7I9M9Bqxb/preview.mp3',
};

describe('a library voice kept as the person’s voice (--keep)', () => {
  inScratch();

  it('keeps an account’s voice by its id, reading with Eleven v4, nothing else asked', async () => {
    const { client, asked } = account([LAURA]);
    const kept = await keepLibraryVoice(client, laura, LAURA.voiceId, cast);
    expect(kept).toEqual({ ...laura.person, voiceId: LAURA.voiceId, model: 'eleven_v4' });
    expect(LIBRARY_READS).toBe('eleven_v4');
    expect(asked()).toBe(1);
    const after = readRoster(cast);
    expect(after.operator[1]).toEqual(kept);
    expect(rosterSchema.safeParse(after).success).toBe(true);
    // By its name exactly, as --list-voices prints it, too.
    const byName = await keepLibraryVoice(client, slotOf(roster, 'operator:ben'), LAURA.name, cast);
    expect(byName.voiceId).toBe(LAURA.voiceId);
  });

  it('refuses a voice the account has not, naming those it has, and writes nothing', async () => {
    const { client } = account([LAURA]);
    await expect(keepLibraryVoice(client, laura, 'dCnu06FiOZma2KVNUoPZ', cast)).rejects.toThrow(
      /has no voice "dCnu06FiOZma2KVNUoPZ" — it has "Laura - Calm and Smooth"/,
    );
    expect(readFileSync(cast, 'utf8')).toBe(readFileSync(CAST_FILE, 'utf8'));
  });

  it('is asked for by a sample’s number or a voice’s id, and refuses anything else', () => {
    expect(choiceOf('operator:laura=2')).toEqual({ slot: 'operator:laura', choice: { sample: 2 } });
    expect(choiceOf(`lead=${LAURA.voiceId}`)).toEqual({
      slot: 'lead',
      choice: { voice: LAURA.voiceId },
    });
    for (const wrong of [undefined, 'lead', 'lead=', 'lead=0', 'lead=../voice', '=2']) {
      expect(() => choiceOf(wrong), String(wrong)).toThrow(/--keep takes a person and a sample/);
    }
  });
});

describe('a new voice over takes the person has (--replace)', () => {
  inScratch();
  const manifest = readManifest();
  const helmut = slotOf(roster, 'operator:helmut');
  const other = { voice: '5KvpaGteYkNayiswuX2h' };

  it('finds the takes a voice made of each person, and what making them anew costs', () => {
    const his = staleTakes(manifest, 'helmut');
    expect(his).toHaveLength(47);
    expect(remakeCharacters(his)).toBe(3983);
    // The announcement's five, in Helmut's voice under the plant's name, and nobody else's.
    const plant = staleTakes(manifest, 'anlage');
    expect([plant.length, remakeCharacters(plant)]).toEqual([5, 368]);
    expect(staleTakes(manifest, 'laura')).toEqual([]);
    // A person's own recording is no voice's: it stays whatever voice is kept.
    const [id = '', take] = his[0] ?? [];
    const line = shippedLines().get(take?.text ?? '');
    const byHand = { file: take?.file ?? '', source: 'human' } as const;
    const said = line === undefined ? [] : [entryOf(line.said, 1000, line, 'helmut', byHand)];
    const human = Object.fromEntries(said.map((entry) => [id, entry]));
    expect(Object.keys(human)).toHaveLength(1);
    expect(staleTakes({ lines: human }, 'helmut')).toEqual([]);
  });

  it('refuses, before asking anything, to make takes stale without --replace', () => {
    const his = staleTakes(manifest, 'helmut');
    expect(() => refuseStale(helmut, other, his, false)).toThrow(
      'voice: Helmut has 47 takes by the voice they have now, 3,983 characters to make anew in ' +
        'another — keep it all the same with --replace, which drops them for the next render ' +
        'to make: pnpm --filter @escapelab/client voice --keep operator:helmut=' +
        '5KvpaGteYkNayiswuX2h --replace',
    );
    expect(() => refuseStale(helmut, { sample: 2 }, his, false)).toThrow(/operator:helmut=2/);
    // With --replace, for the voice they have, or for nobody's takes: kept.
    expect(() => refuseStale(helmut, other, his, true)).not.toThrow();
    expect(() => refuseStale(helmut, { voice: 'g1jpii0iyvtRs8fqXsd1' }, his, false)).not.toThrow();
    expect(() => refuseStale(laura, { sample: 2 }, [], false)).not.toThrow();
  });

  it('drops the stale takes from the list and their files, and nothing else', () => {
    const plant = staleTakes(manifest, 'anlage');
    const files = plant.map(([, entry]) => join(dir, entry.file));
    for (const file of files) copyFileSync(CAST_FILE, file);
    const left = dropTakes(manifest, plant, dir);
    expect(Object.keys(left.lines)).toHaveLength(Object.keys(manifest.lines).length - 5);
    expect(Object.values(left.lines).some((entry) => entry.person === 'anlage')).toBe(false);
    expect(files.filter((file) => existsSync(file))).toEqual([]);
    expect(staleTakes(left, 'helmut')).toHaveLength(47);
  });
});

describe('the library voices’ previews (--previews)', () => {
  inScratch();

  it('fetches each one’s preview the account names, and says why where there is none', async () => {
    const mila = { voiceId: 'dCnu06FiOZma2KVNUoPZ', name: 'Mila' };
    const ben = { voiceId: 'aTTiK3YzK3dXETpuDE2h', name: 'Ben', previewUrl: 'https://x/ben.mp3' };
    const { client } = account([LAURA, mila, ben]);
    const fetched: string[] = [];
    const download = (url: string): Promise<Buffer> => {
      fetched.push(url);
      return url === ben.previewUrl
        ? Promise.reject(new Error('HTTP 403'))
        : Promise.resolve(Buffer.from('mp3 preview'));
    };
    const folder = join(dir, LIBRARY_DIR);
    const previews = await fetchPreviews(client, casting, folder, download);
    const of = (voiceId: string) => previews.find((preview) => preview.voiceId === voiceId);
    expect(of(LAURA.voiceId)).toEqual({
      voiceId: LAURA.voiceId,
      file: join(folder, `${LAURA.voiceId}.mp3`),
    });
    expect(readFileSync(join(folder, `${LAURA.voiceId}.mp3`), 'utf8')).toBe('mp3 preview');
    expect(of(mila.voiceId)).toEqual({ voiceId: mila.voiceId, missing: 'it has no preview' });
    expect(of(ben.voiceId)).toEqual({
      voiceId: ben.voiceId,
      missing: 'its preview did not come: HTTP 403',
    });
    expect(of('OCDYul75SEKSUI3jtFCT')).toMatchObject({ missing: 'the account has no such voice' });
    // Every library voice is said, in the casting's order; only the previews named are fetched.
    expect(previews.map((preview) => preview.voiceId)).toEqual(
      casting.library.map((voice) => voice.voiceId),
    );
    expect(fetched).toEqual([LAURA.previewUrl, ben.previewUrl]);
    expect(existsSync(join(folder, `${ben.voiceId}.mp3`))).toBe(false);
  });

  // Last, after every design, keep and preview above.
  it('leaves the samples to a folder git ignores, and makes no real client doing any of it', () => {
    const ignored = readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8');
    expect(SAMPLES_DIR).toMatch(/packages\/client\/takes\/voices$/);
    expect(ignored).toMatch(/^packages\/client\/takes\/?$/m);
    expect(sdkLoaded.times).toBe(0);
  });
});
